// Browser test for the workspace's manage side (area S): a business that signed up on
// its own edits its receptionist, knowledge and team. Run scripts/e2e/setup.sh first:
//   E2E_PORT=8902 E2E_DB=e2e_s bash scripts/e2e/setup.sh && E2E_PORT=8902 node scripts/e2e/s-manage.mjs
import { readFileSync } from "node:fs";
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
  await step("business signs up and sees the finish-setting-up prompt on /app", async () => {
    await bz.goto(`${B}/signup?as=business`, { waitUntil: "networkidle0" });
    await type(bz, "#name", biz.name);
    await type(bz, "#email", biz.email);
    await type(bz, "#password", biz.password);
    await type(bz, "#business", biz.businessName);
    await bz.click("#industry");
    await clickText(bz, '[role="option"]', "Dental");
    await type(bz, "#suburb", "Manly");
    await clickText(bz, "button[type=submit]", "Create my receptionist");
    await waitPath(bz, "/app", 20000);
    await bz.waitForSelector("[data-setup-prompt]", { timeout: 15000 });
    const s = await apiFetch(bz, "GET", "/api/session/businesses");
    bid = s.body.businesses[0].id;
    assert(bid, "no business id");
  });

  await step("phone width: /app with the setup prompt has no overflow at 390px", async () => {
    await bz.setViewport({ width: 390, height: 844 });
    await bz.goto(`${B}/app`, { waitUntil: "networkidle0" });
    await bz.waitForSelector("[data-setup-prompt]");
    await noOverflow(bz, "/app");
    await bz.setViewport({ width: 1280, height: 900 });
  });

  await step("receptionist: edit details, greeting, tone, services, hours, voice and save", async () => {
    await bz.goto(`${B}/app`, { waitUntil: "networkidle0" });
    await clickText(bz, "[data-setup-prompt] a", "Set up my receptionist");
    await waitPath(bz, "/app/receptionist");
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

  await step("receptionist: the setup prompt is gone after the first save", async () => {
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

  // ---- Knowledge ----
  if (process.env.S_STEP1_ONLY !== "1") {
    const { knowledgeAndTeam } = await import("./s-manage-more.mjs");
    await knowledgeAndTeam({ step, assert, B, bz, fresh, apiFetch, type, clickText, waitText, waitPath, noOverflow, sleep, instructionsOf, signIn, getBid: () => bid, DIR, stamp, biz });
  }
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
