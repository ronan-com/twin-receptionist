// Browser test for the workspace's manage side (area S): a business that signed up on
// its own edits its receptionist, knowledge and team. Run scripts/e2e/setup.sh first:
//   E2E_PORT=8902 E2E_DB=e2e_s bash scripts/e2e/setup.sh && E2E_PORT=8902 node scripts/e2e/s-manage.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const PORT = process.env.E2E_PORT || "8899";
const DIR = process.env.E2E_DIR || `/tmp/twin-e2e-${PORT}`;
const B = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/snap/bin/chromium";
const stamp = Date.now().toString(36);
const results = [];
const pageErrors = [];
let failed = 0;

async function step(name, fn) {
  try {
    await fn();
    results.push(`PASS ${name}`);
  } catch (err) {
    failed++;
    results.push(`FAIL ${name}: ${err.message.split("\n")[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const path = (page) => new URL(page.url()).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitPath(page, want, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (want instanceof RegExp ? want.test(path(page)) : path(page) === want) return;
    await sleep(100);
  }
  throw new Error(`expected ${want}, at ${path(page)}`);
}
async function waitText(page, text, ms = 10000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, text);
}
async function type(page, sel, value) {
  await page.waitForSelector(sel, { visible: true });
  await page.click(sel, { count: 3 });
  await page.keyboard.press("Backspace");
  if (value) await page.type(sel, value);
}
async function clickText(page, selector, text) {
  await page.waitForFunction(
    (s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t) && !e.disabled),
    { timeout: 10000 },
    selector,
    text,
  );
  await page.evaluate(
    (s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t) && !e.disabled).click(),
    selector,
    text,
  );
}
// Radix tabs switch on mouse down, so use a real click.
async function clickTab(page, text) {
  const tabs = await page.$$('[role="tab"]');
  for (const t of tabs) if ((await t.evaluate((e) => e.textContent)).includes(text)) return t.click();
  throw new Error(`no tab ${text}`);
}
async function noOverflow(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert(sw <= iw, `${label}: page is ${sw}px wide on a ${iw}px screen`);
}
async function apiFetch(page, method, url, body) {
  return page.evaluate(
    async (m, u, b) => {
      const r = await fetch(u, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    method,
    url,
    body,
  );
}
async function signIn(page, email, password) {
  await page.goto(`${B}/login`, { waitUntil: "networkidle0" });
  await type(page, "#email", email);
  await type(page, "#password", password);
  await clickText(page, "button[type=submit]", "Sign in");
}
// The server-side instructions of a receptionist, read straight from the scratch DB.
import { execFileSync } from "node:child_process";
const DB = readFileSync(`${DIR}/dburl`, "utf8").trim().split("/").pop().split("?")[0];
function instructionsOf(clientId) {
  return execFileSync("docker", ["exec", "twin-pg", "psql", "-U", "twin", "-d", DB, "-tAc", `select data->>'instructions' from clients where id = '${clientId}'`], { encoding: "utf8" });
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const fresh = async (width = 1280, height = 900) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message.split("\n")[0]}`));
  return page;
};

const biz = { name: "Sam Business", email: `sam-${stamp}@biz.test`, password: "business-password-1", businessName: `Sam's Dental ${stamp}` };
const agencyClient = readFileSync(`${DIR}/clientid`, "utf8").trim();
let bid = "";

try {
  const bz = await fresh();
  await step("business signs up and lands in the onboarding wizard", async () => {
    await bz.goto(`${B}/signup?as=business`, { waitUntil: "networkidle0" });
    await type(bz, "#name", biz.name);
    await type(bz, "#email", biz.email);
    await type(bz, "#password", biz.password);
    await type(bz, "#business", biz.businessName);
    await bz.click("#industry");
    await clickText(bz, '[role="option"]', "Dental");
    await type(bz, "#suburb", "Manly");
    await clickText(bz, "button[type=submit]", "Create my receptionist");
    await waitPath(bz, "/app/onboarding", 20000);
    await bz.waitForSelector('[data-step="business"]');
    const s = await apiFetch(bz, "GET", "/api/session/businesses");
    bid = s.body.businesses[0].id;
    assert(bid, "no business id");
  });

  await step("wizard: business details and hours save for real, then 'I'll finish later'", async () => {
    await bz.setViewport({ width: 390, height: 844 });
    await noOverflow(bz, "/app/onboarding (business)");
    await bz.setViewport({ width: 1280, height: 900 });
    await type(bz, "#ob-city", "Manly Beach");
    await bz.$eval('[data-action="next"]', (b) => b.click());
    await bz.waitForSelector('[data-step="hours"]', { timeout: 15000 });
    const bs = (await apiFetch(bz, "GET", "/api/session/businesses")).body.businesses[0];
    assert(bs.city === "Manly Beach", `city ${bs.city}`);
    await bz.$eval('[data-action="next"]', (b) => b.click());
    await bz.waitForSelector('[data-step="services"]', { timeout: 15000 });
    const a = (await apiFetch(bz, "GET", `/api/manage/${bid}/receptionist`)).body.agents[0];
    assert(a.onboarding === "pending" && a.onboarding_step === 2, `onboarding ${a.onboarding} ${a.onboarding_step}`);
    await bz.$eval('[data-action="later"]', (b) => b.click());
    await waitPath(bz, "/app");
    await bz.waitForSelector("[data-setup-prompt]", { timeout: 10000 });
    await bz.setViewport({ width: 390, height: 844 });
    await noOverflow(bz, "/app (resume prompt)");
    await bz.setViewport({ width: 1280, height: 900 });
  });

  await step("wizard: resume at services, add a service and a FAQ, greeting, finish -> dashboard", async () => {
    await clickText(bz, "[data-setup-prompt] a", "Resume set-up");
    await bz.waitForSelector('[data-step="services"]', { timeout: 10000 });
    const tag = 'input[placeholder^="e.g. Check-up"]';
    await bz.type(tag, "Emergency visit");
    await bz.keyboard.press("Enter");
    await type(bz, "#ob-q", `Is there parking ${stamp}?`);
    await type(bz, "#ob-a", `Yes, free parking out the back ${stamp}.`);
    await bz.$eval('[data-action="add-faq"]', (b) => b.click());
    await waitText(bz, `Is there parking ${stamp}?`);
    await bz.setViewport({ width: 390, height: 844 });
    await noOverflow(bz, "/app/onboarding (services)");
    await bz.setViewport({ width: 1280, height: 900 });
    await bz.$eval('[data-action="next"]', (b) => b.click());
    await bz.waitForSelector('[data-step="voice"]', { timeout: 15000 });
    await type(bz, "#ob-greeting", `Welcome to Sam's Dental ${stamp}.`);
    await bz.$eval('[data-action="next"]', (b) => b.click());
    await bz.waitForSelector('[data-step="branding"]', { timeout: 15000 }).catch(async (e) => {
      throw new Error(`${e.message}: ${(await bz.$eval("[data-page=onboarding] section", (x) => x.innerText)).slice(-300)}`);
    });
    await bz.waitForSelector("[data-brand-preview]");
    await bz.$eval('[data-action="next"]', (b) => b.click());
    await bz.waitForSelector('[data-step="extras"]', { timeout: 15000 });
    await bz.setViewport({ width: 390, height: 844 });
    await noOverflow(bz, "/app/onboarding (extras)");
    await bz.setViewport({ width: 1280, height: 900 });
    await bz.$eval('[data-action="next"]', (b) => b.click());
    await waitPath(bz, "/app", 15000);
    await sleep(800);
    assert(path(bz) === "/app", `went on to ${path(bz)}`);
    assert(!(await bz.$("[data-setup-prompt]")), "prompt shown after finishing");
    const a = (await apiFetch(bz, "GET", `/api/manage/${bid}/receptionist`)).body.agents[0];
    assert(a.onboarding === "done", `onboarding ${a.onboarding}`);
    assert(a.booking_rules.services.includes("Emergency visit"), "service not saved");
    assert(a.greeting.includes(stamp), "greeting not saved");
    const ins = instructionsOf(bid);
    assert(ins.includes(`free parking out the back ${stamp}`) && ins.includes("Emergency visit"), "wizard changes not in the instructions");
  });

  await step("receptionist: edit details, greeting, tone, services, hours, voice and save", async () => {
    await bz.goto(`${B}/app/receptionist`, { waitUntil: "networkidle0" });
    await bz.waitForSelector("#a-name");
    await type(bz, "#a-name", "Mia");
    await type(bz, "#a-city", "Manly Vale");
    await type(bz, "#a-addr", "1 Test Street");
    // Tone: professional.
    await bz.click("#a-tone");
    await clickText(bz, '[role="option"]', "Professional");
    await bz.waitForFunction(() => !document.querySelector('[role="listbox"]'));
    await sleep(300);
    // Voice: pick the first one offered.
    await bz.waitForSelector('[role="radiogroup"] [role="radio"]');
    await bz.click('[role="radiogroup"] [role="radio"]');
    // Greeting.
    await clickTab(bz, "Conversation");
    await type(bz, 'textarea[aria-label="Greeting"]', "Hi, you've reached Sam's Dental, Mia speaking.");
    await type(bz, 'textarea[aria-label="Business context"]', "Family dental practice; same-day emergencies where possible.");
    // Services: add one.
    await clickTab(bz, "Booking");
    const tag = 'input[placeholder^="e.g. Check-up"]';
    await bz.waitForSelector(tag);
    await bz.type(tag, "Teeth whitening");
    await bz.keyboard.press("Enter");
    // Hours: close Saturday is already closed for most presets; open Saturday 09:00-12:00.
    await clickTab(bz, "Hours");
    await bz.waitForSelector('[aria-label="Saturday open"]');
    const satOpen = await bz.$eval('[aria-label="Saturday open"]', (e) => e.getAttribute("aria-checked") === "true");
    if (!satOpen) await bz.click('[aria-label="Saturday open"]');
    await bz.$eval('[aria-label="Saturday opens"]', (e) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(e, "09:00");
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await bz.$eval('[aria-label="Saturday closes"]', (e) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(e, "12:00");
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // No success shown before saving.
    assert(!(await bz.evaluate(() => document.body.innerText.includes("Applied to your receptionist") || document.body.innerText.includes("nothing is sent to the phone provider"))), "success shown before save");
    await clickText(bz, "button", "Save changes");
    await waitText(bz, "nothing is sent to the phone provider", 15000);
    const r = await apiFetch(bz, "GET", `/api/manage/${bid}/receptionist`);
    const a = r.body.agents[0];
    assert(a.name === "Mia", `name ${a.name}`);
    assert(a.tone === "professional", `tone ${a.tone}`);
    assert(a.greeting.includes("Mia speaking"), "greeting not saved");
    assert(a.booking_rules.services.includes("Teeth whitening"), "service not saved");
    assert(a.setup_fresh === false, "still fresh after save");
    const bs = (await apiFetch(bz, "GET", "/api/session/businesses")).body.businesses[0];
    assert(bs.city === "Manly Vale" && bs.address_line1 === "1 Test Street", `business ${bs.city} ${bs.address_line1}`);
    assert(!bs.business_hours.sat.closed && bs.business_hours.sat.open === "09:00" && bs.business_hours.sat.close === "12:00", `sat ${JSON.stringify(bs.business_hours.sat)}`);
    const ins = instructionsOf(bid);
    assert(ins.includes("Teeth whitening") && ins.includes("Mia"), "instructions not rebuilt");
  });

  await step("receptionist: no wizard or prompt once onboarding is done", async () => {
    await bz.goto(`${B}/app`, { waitUntil: "networkidle0" });
    await bz.waitForSelector('[data-page="app-dashboard"], main');
    await sleep(1000);
    assert(!(await bz.$("[data-setup-prompt]")), "prompt still shown");
  });

  await step("receptionist: a bad save shows an error, not success", async () => {
    const r = await apiFetch(bz, "PUT", `/api/manage/${bid}/receptionist`, { business_hours: { mon: { open: "17:00", close: "09:00", closed: false } } });
    assert(r.status === 400, `bad hours answered ${r.status}`);
    const p = await apiFetch(bz, "PUT", `/api/manage/${bid}/receptionist`, { status: "paused" });
    assert(p.status === 400, `pause answered ${p.status}`);
  });

  await step("phone width: /app/receptionist has no overflow at 390px", async () => {
    await bz.setViewport({ width: 390, height: 844 });
    for (const tab of ["persona", "conversation", "booking", "hours"]) {
      await bz.goto(`${B}/app/receptionist?tab=${tab}`, { waitUntil: "networkidle0" });
      await bz.waitForSelector('[role="tablist"]');
      await noOverflow(bz, `/app/receptionist?tab=${tab}`);
    }
    await bz.setViewport({ width: 1280, height: 900 });
  });

  await step("other org: the business can't read or change another agency's receptionist", async () => {
    const g = await apiFetch(bz, "GET", `/api/manage/${agencyClient}/receptionist`);
    assert(g.status === 404 || g.status === 403, `GET answered ${g.status}`);
    const w = await apiFetch(bz, "PUT", `/api/manage/${agencyClient}/receptionist`, { greeting: "hacked" });
    assert(w.status === 404 || w.status === 403, `PUT answered ${w.status}`);
  });

  await step("agency staff can manage their own receptionist (demo-safe fields only)", async () => {
    const a = await fresh();
    await signIn(a, "a@a.test", "password-for-agency-a");
    await waitPath(a, "/admin");
    const g = await apiFetch(a, "GET", `/api/manage/${agencyClient}/receptionist`);
    assert(g.status === 200, `GET answered ${g.status}`);
    const k = await apiFetch(a, "GET", `/api/manage/${agencyClient}/knowledge`);
    assert(k.status === 200, `knowledge GET answered ${k.status}`);
    const o = await apiFetch(a, "GET", `/api/manage/${bid}/receptionist`);
    assert(o.status === 404 || o.status === 403, `another org's business answered ${o.status}`);
  });

  await step("agency onboarding link: invited manager accepts -> wizard -> receptionist updated -> dashboard", async () => {
    const a = await fresh();
    await signIn(a, "a@a.test", "password-for-agency-a");
    await waitPath(a, "/admin");
    const c = await apiFetch(a, "POST", "/api/clients", { businessName: `Onboard Co ${stamp}`, industry: "Trades", suburb: "Fitzroy", timezone: "Australia/Melbourne", services: ["Blocked drains", "Hot water"], defaultVoice: true });
    assert(c.status === 201, `create answered ${c.status} ${JSON.stringify(c.body)}`);
    const cid = c.body.client.id;
    const o = await apiFetch(a, "PUT", `/api/manage/${cid}/onboarding`, { status: "pending", step: 0 });
    assert(o.status === 200, `onboarding answered ${o.status}`);
    const inv = await apiFetch(a, "POST", `/api/manage/${cid}/team/invites`, { email: `olive-${stamp}@client.test`, role: "manager" });
    assert(inv.status === 201 && inv.body.url, `invite answered ${inv.status}`);
    const m = await fresh();
    await m.goto(inv.body.url.replace(/^https?:\/\/[^/]+/, B), { waitUntil: "networkidle0" });
    await waitText(m, `Onboard Co ${stamp}`);
    await type(m, "#name", "Olive Owner");
    await type(m, "#password", "manager-password-1");
    await clickText(m, "button[type=submit]", "Accept invite");
    await waitPath(m, "/app/onboarding", 15000);
    await m.waitForSelector('[data-step="business"]');
    await type(m, "#ob-name", `Onboard Plumbing ${stamp}`);
    await m.$eval('[data-action="next"]', (b) => b.click());
    for (const k of ["hours", "services", "voice"]) {
      await m.waitForSelector(`[data-step="${k}"]`, { timeout: 15000 });
      if (k === "voice") await type(m, "#ob-greeting", `G'day, Onboard Plumbing ${stamp}.`);
      await m.$eval('[data-action="next"]', (b) => b.click());
    }
    await m.waitForSelector('[data-step="branding"]', { timeout: 15000 });
    await m.$eval('[data-action="next"]', (b) => b.click());
    await m.waitForSelector('[data-step="extras"]', { timeout: 15000 });
    await waitText(m, "Booking calendar on");
    await clickText(m, '[data-extra="number"] button', "Request a number");
    await waitText(m, "Requested.");
    await m.$eval('[data-action="next"]', (b) => b.click());
    await waitPath(m, "/app", 15000);
    await waitText(m, `Onboard Plumbing ${stamp}`);
    const r = (await apiFetch(m, "GET", `/api/manage/${cid}/receptionist`)).body.agents[0];
    assert(r.onboarding === "done" && r.greeting.includes(stamp) && r.booking_rules.configured, `receptionist ${r.onboarding} ${r.greeting}`);
    const ins = instructionsOf(cid);
    assert(ins.includes(`Onboard Plumbing ${stamp}`), "new name not in the instructions");
    const t = (await apiFetch(a, "GET", `/api/manage/${cid}/team`)).body;
    assert(t.members.some((x) => x.profile.email === `olive-${stamp}@client.test` && x.access_role === "manager"), "not a manager");
  });

  // ---- Knowledge ----
  const Q = `Do you take payment plans ${stamp}?`;
  const A1 = `Yes, interest-free over six months ${stamp}.`;
  const A2 = `Yes, interest-free over twelve months ${stamp}.`;
  await step("knowledge: add an item, it is in the receptionist's instructions", async () => {
    await bz.goto(`${B}/app/knowledge`, { waitUntil: "networkidle0" });
    await clickText(bz, "button", "Add knowledge");
    await type(bz, "#k-q", Q);
    await type(bz, "#k-a", A1);
    await clickText(bz, '[role="dialog"] button', "Add");
    await waitText(bz, Q);
    await bz.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    assert(instructionsOf(bid).includes(A1), "answer not in the instructions");
  });
  await step("knowledge: edit the item, the instructions follow", async () => {
    await clickText(bz, "tr", Q);
    await bz.waitForSelector("#k-a");
    await type(bz, "#k-a", A2);
    await clickText(bz, '[role="dialog"] button', "Save changes");
    await bz.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    await sleep(300);
    const ins = instructionsOf(bid);
    assert(ins.includes(A2) && !ins.includes(A1), "edit not in the instructions");
  });
  await step("knowledge: a draft is kept out of the instructions", async () => {
    const r = await apiFetch(bz, "POST", `/api/manage/${bid}/knowledge`, { type: "policy", title: `Draft ${stamp}`, content: `Secret draft ${stamp}`, status: "draft", question: null, answer: null });
    assert(r.status === 201, `draft answered ${r.status}`);
    assert(!instructionsOf(bid).includes(`Secret draft ${stamp}`), "draft in the instructions");
    await apiFetch(bz, "DELETE", `/api/manage/${bid}/knowledge/${r.body.item.id}`);
  });
  await step("phone width: /app/knowledge has no overflow at 390px", async () => {
    await bz.setViewport({ width: 390, height: 844 });
    await bz.goto(`${B}/app/knowledge`, { waitUntil: "networkidle0" });
    await waitText(bz, Q);
    await noOverflow(bz, "/app/knowledge");
    await bz.setViewport({ width: 1280, height: 900 });
    await bz.goto(`${B}/app/knowledge`, { waitUntil: "networkidle0" });
  });
  await step("knowledge: remove the item, it leaves the instructions", async () => {
    await clickText(bz, "tr", Q);
    await clickText(bz, '[role="dialog"] button', "Remove");
    await clickText(bz, '[role="alertdialog"] button', "Remove");
    await bz.waitForFunction((q) => !document.body.innerText.includes(q), { timeout: 10000 }, Q);
    assert(!instructionsOf(bid).includes(A2), "removed answer still in the instructions");
  });

  // ---- Team ----
  const viewerEmail = `vic-${stamp}@biz.test`;
  let viewer = null;
  await step("team: invite a viewer from the Team page", async () => {
    await bz.goto(`${B}/app/team`, { waitUntil: "networkidle0" });
    await clickText(bz, "button", "Invite");
    await type(bz, "#inv-email", viewerEmail);
    await clickText(bz, '[role="dialog"] button', "Send invitation");
    await bz.waitForSelector('[data-testid="invite-link"]');
    await waitText(bz, viewerEmail);
  });
  await step("team: the viewer accepts, lands on /app and is read-only", async () => {
    const url = await bz.$eval('[data-testid="invite-link"]', (e) => e.textContent);
    viewer = await fresh();
    await viewer.goto(url.replace(/^https?:\/\/[^/]+/, B), { waitUntil: "networkidle0" });
    await waitText(viewer, biz.businessName);
    await type(viewer, "#name", "Vic Viewer");
    await type(viewer, "#password", "viewer-password-1");
    await clickText(viewer, "button[type=submit]", "Accept invite");
    await waitPath(viewer, "/app", 15000);
    await waitText(viewer, "View-only access");
    const s = await apiFetch(viewer, "GET", "/api/session/businesses");
    assert(s.body.memberships?.[0]?.access_role === "viewer" || s.body.memberships?.[0]?.role === "read_only", `membership ${JSON.stringify(s.body.memberships)}`);
    await viewer.goto(`${B}/app/receptionist`, { waitUntil: "networkidle0" });
    await viewer.waitForSelector("#a-name");
    assert(await viewer.$eval("#a-name", (e) => e.disabled), "receptionist editable for a viewer");
    assert(!(await viewer.$("[data-setup-prompt]")), "setup prompt shown to a viewer");
    const w = await apiFetch(viewer, "PUT", `/api/manage/${bid}/receptionist`, { greeting: "viewer was here" });
    assert(w.status === 403, `viewer PUT answered ${w.status}`);
    const k = await apiFetch(viewer, "POST", `/api/manage/${bid}/knowledge`, { type: "faq", question: "x", answer: "y", status: "published" });
    assert(k.status === 403, `viewer knowledge POST answered ${k.status}`);
    const g = await apiFetch(viewer, "GET", `/api/manage/${bid}/knowledge`);
    assert(g.status === 200, `viewer knowledge GET answered ${g.status}`);
    const br = await apiFetch(viewer, "PUT", `/api/manage/${bid}/brand`, { primaryColor: "#000000" });
    assert(br.status === 403, `viewer brand PUT answered ${br.status}`);
    await viewer.goto(`${B}/app/team`, { waitUntil: "networkidle0" });
    await waitText(viewer, "Team");
    assert(!(await viewer.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Invite"))), "viewer sees Invite");
  });
  await step("team: cancel a pending invite", async () => {
    const other = `pat-${stamp}@biz.test`;
    const r = await apiFetch(bz, "POST", `/api/manage/${bid}/team/invites`, { email: other, role: "manager" });
    assert(r.status === 201, `invite answered ${r.status}`);
    await bz.goto(`${B}/app/team`, { waitUntil: "networkidle0" });
    await waitText(bz, other);
    await clickText(bz, "button", "Cancel invite");
    await bz.waitForFunction((e) => !document.body.innerText.includes(e), { timeout: 10000 }, other);
    const t = await apiFetch(bz, "GET", `/api/manage/${bid}/team`);
    assert(!t.body.invitations.some((i) => i.email === other), "invite still pending");
  });
  await step("team: remove the viewer; they lose access", async () => {
    await bz.goto(`${B}/app/team`, { waitUntil: "networkidle0" });
    await bz.waitForSelector(`button[aria-label="Actions for ${viewerEmail}"]`);
    await bz.click(`button[aria-label="Actions for ${viewerEmail}"]`);
    await clickText(bz, '[role="menuitem"]', "Remove access");
    await clickText(bz, '[role="alertdialog"] button', "Remove");
    await bz.waitForFunction((e) => !document.body.innerText.includes(e), { timeout: 10000 }, viewerEmail);
    const g = await apiFetch(viewer, "GET", `/api/manage/${bid}/knowledge`);
    assert(g.status === 401 || g.status === 403 || g.status === 404, `removed viewer answered ${g.status}`);
  });
  await step("team: the last manager can't remove themselves", async () => {
    const t = await apiFetch(bz, "GET", `/api/manage/${bid}/team`);
    const me = t.body.members.find((m) => m.profile.email === biz.email);
    const r = await apiFetch(bz, "DELETE", `/api/manage/${bid}/team/members/${me.user_id}`);
    assert(r.status === 400, `last manager removal answered ${r.status}`);
  });
  await step("phone width: /app/team has no overflow at 390px", async () => {
    await bz.setViewport({ width: 390, height: 844 });
    await bz.goto(`${B}/app/team`, { waitUntil: "networkidle0" });
    await waitText(bz, biz.email);
    await noOverflow(bz, "/app/team");
    await bz.setViewport({ width: 1280, height: 900 });
  });

  // ---- Phone numbers, integrations, settings ----
  await step("phone numbers: request a number; it shows as pending", async () => {
    await bz.goto(`${B}/app/phone-numbers`, { waitUntil: "networkidle0" });
    await clickText(bz, "button", "Request a number");
    await type(bz, "#nr-note", "A Sydney 02 number please");
    await clickText(bz, '[role="dialog"] button', "Send request");
    await waitText(bz, "Requested");
    const n = await apiFetch(bz, "GET", `/api/manage/${bid}/phone-numbers`);
    assert(n.body.numbers.some((x) => x.status === "pending"), "no pending request");
    await noOverflow(bz, "/app/phone-numbers");
  });
  await step("integrations: connect the built-in calendar, set a lead webhook; CRMs are coming soon", async () => {
    await bz.goto(`${B}/app/integrations`, { waitUntil: "networkidle0" });
    await bz.waitForSelector('[data-provider="hubspot"]');
    const soon = await bz.$eval('[data-provider="hubspot"]', (e) => e.innerText);
    assert(soon.includes("Coming soon"), "HubSpot not marked coming soon");
    // On from the start: nothing to connect.
    await bz.waitForSelector('[data-provider="builtin_calendar"] #cal-min');
    await bz.waitForSelector('[data-card="calendar-feed"] [data-add="google"]', { timeout: 15000 });
    const i = await apiFetch(bz, "GET", `/api/manage/${bid}/integrations`);
    assert(i.body.integrations.some((x) => x.provider === "builtin_calendar" && x.status === "connected"), "calendar not connected");
    assert(instructionsOf(bid).toLowerCase().includes("book"), "instructions lack booking");
    const h = await apiFetch(bz, "PUT", `/api/manage/${bid}/calendar`, { leadWebhook: "https://example.com/answered" });
    assert(h.status === 200 && h.body.integrations.some((x) => x.provider === "webhook"), `webhook answered ${h.status} ${JSON.stringify(h.body)}`);
    const t = await apiFetch(bz, "POST", `/api/manage/${bid}/calendar/test`);
    assert(t.status === 200, `calendar test answered ${t.status}`);
    await bz.setViewport({ width: 390, height: 844 });
    await bz.goto(`${B}/app/integrations`, { waitUntil: "networkidle0" });
    await bz.waitForSelector('[data-provider="hubspot"]');
    await noOverflow(bz, "/app/integrations");
    await bz.setViewport({ width: 1280, height: 900 });
  });
  await step("settings: business profile and own name save", async () => {
    await bz.goto(`${B}/app/settings?tab=business`, { waitUntil: "networkidle0" });
    await type(bz, "#b-phone", "02 9000 0000");
    await type(bz, "#b-web", "samsdental.example.com");
    await clickText(bz, "button", "Save changes");
    await bz.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Save changes") && b.disabled), { timeout: 10000 });
    const bs = (await apiFetch(bz, "GET", "/api/session/businesses")).body.businesses[0];
    assert(bs.phone === "02 9000 0000" && bs.website === "https://samsdental.example.com", `profile ${bs.phone} ${bs.website}`);
    await clickTab(bz, "Your account");
    await type(bz, "#me-name", "Samantha Business");
    await clickText(bz, "button", "Save name");
    await sleep(800);
    const s = await apiFetch(bz, "GET", "/api/session");
    assert(s.body.user.name === "Samantha Business", `name ${s.body.user.name}`);
    await bz.setViewport({ width: 390, height: 844 });
    await bz.goto(`${B}/app/settings?tab=business`, { waitUntil: "networkidle0" });
    await bz.waitForSelector("#b-name");
    await noOverflow(bz, "/app/settings?tab=business");
    await bz.goto(`${B}/app/settings`, { waitUntil: "networkidle0" });
    await bz.waitForSelector('[data-page="client-settings"]');
    await noOverflow(bz, "/app/settings");
    await bz.setViewport({ width: 1280, height: 900 });
  });
  // ---- Branding ----
  await step("branding: colours preview live, save, and theme the workspace", async () => {
    await bz.goto(`${B}/app/settings?tab=branding`, { waitUntil: "networkidle0" });
    await bz.waitForSelector("#br-primary");
    await type(bz, "#br-primary", "#0f766e");
    await type(bz, "#br-accent", "#f59e0b");
    const pv = await bz.$eval("[data-brand-preview]", (e) => e.style.getPropertyValue("--indigo"));
    assert(pv === "#0f766e", `preview --indigo ${pv}`);
    const before = await bz.evaluate(() => document.documentElement.style.getPropertyValue("--indigo"));
    assert(before !== "#0f766e", "applied before saving");
    await clickText(bz, "button", "Save colours");
    await bz.waitForFunction(() => document.documentElement.style.getPropertyValue("--indigo") === "#0f766e", { timeout: 10000 });
    const r = await apiFetch(bz, "GET", `/api/manage/${bid}/brand`);
    assert(r.body.own.primaryColor === "#0f766e" && r.body.effective.accentColor === "#f59e0b", `brand ${JSON.stringify(r.body.own)}`);
    const bad = await apiFetch(bz, "PUT", `/api/manage/${bid}/brand`, { primaryColor: "red" });
    assert(bad.status === 400, `bad colour answered ${bad.status}`);
  });
  await step("branding: upload a logo; it shows in the sidebar; SVG is refused", async () => {
    const dir = `${process.env.HOME}/s-e2e-fixtures`;
    mkdirSync(dir, { recursive: true });
    const png = `${dir}/logo.png`;
    // 1x1 PNG
    writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    const input = await bz.$('input[data-upload="logo"]');
    await input.uploadFile(png);
    await bz.waitForSelector("[data-workspace-logo] img", { timeout: 10000 });
    const svg = await bz.evaluate(async (u) => (await fetch(u, { method: "POST", body: "<svg xmlns='http://www.w3.org/2000/svg'/>" })).status, `/api/manage/${bid}/brand/logo`);
    assert(svg === 400, `svg answered ${svg}`);
    await bz.setViewport({ width: 390, height: 844 });
    await bz.goto(`${B}/app/settings?tab=branding`, { waitUntil: "networkidle0" });
    await bz.waitForSelector("[data-brand-preview]");
    await noOverflow(bz, "/app/settings?tab=branding");
    await bz.setViewport({ width: 1280, height: 900 });
    await clickText(bz, "[data-branding] button", "Remove");
    await bz.waitForFunction(() => !document.querySelector("[data-workspace-logo] img"), { timeout: 10000 });
  });
  await step("branding: another org's business can't change this one's brand", async () => {
    const w = await apiFetch(bz, "PUT", `/api/manage/${agencyClient}/brand`, { primaryColor: "#000000" });
    assert(w.status === 404 || w.status === 403, `PUT answered ${w.status}`);
  });
} finally {
  await browser.close();
}

if (pageErrors.length) {
  failed++;
  results.push(`FAIL page errors:\n  ${pageErrors.join("\n  ")}`);
} else results.push("PASS no page errors");
console.log(results.join("\n"));
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
