// Browser test for the receptionist page (area R). Run scripts/e2e/setup.sh first, then:
//   E2E_PORT=8907 E2E_DB=e2e_r node scripts/e2e/r-receptionist.mjs
// Covers: every tab renders; persona, conversation, booking/leads, transfers and hours
// edits save and persist after a reload; the new fields reach the generated
// instructions; the preview updates live; Discard reverts; pause and resume (script,
// greeting and status); a viewer is read-only (UI and API); a refused provider update
// on a live receptionist is an error, not a success; no horizontal overflow at 390px;
// no page errors.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const PORT = process.env.E2E_PORT || "8907";
const DIR = process.env.E2E_DIR || `/tmp/twin-e2e-${PORT}`;
const B = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/snap/bin/chromium";
const DB = readFileSync(`${DIR}/dburl`, "utf8").trim().split("/").pop().split("?")[0];
const alpha = readFileSync(`${DIR}/clientid`, "utf8").trim();
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const path = (page) => new URL(page.url()).pathname;
async function waitPath(page, want, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (path(page) === want) return;
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
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  if (value) await page.type(sel, value);
}
// For number inputs (no text selection): React's own value setter, then an input event.
async function setValue(page, sel, v) {
  await page.$eval(
    sel,
    (e, val) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, val);
      e.dispatchEvent(new Event("input", { bubbles: true }));
    },
    v,
  );
}
async function clickText(page, selector, text) {
  await page.waitForFunction(
    (s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t) && !e.disabled),
    { timeout: 10000 },
    selector,
    text,
  );
  await page.evaluate((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t) && !e.disabled).click(), selector, text);
}
async function clickTab(page, text) {
  await page.waitForSelector('[role="tab"]');
  const tabs = await page.$$('[role="tab"]');
  for (const t of tabs) if ((await t.evaluate((e) => e.textContent)).includes(text)) return t.click();
  throw new Error(`no tab ${text}`);
}
async function choose(page, trigger, option) {
  await page.click(trigger);
  await clickText(page, '[role="option"]', option);
  await page.waitForFunction(() => !document.querySelector('[role="listbox"]'));
  await sleep(200);
}
async function noOverflow(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert(sw <= iw, `${label}: page is ${sw}px wide on a ${iw}px screen`);
  // Nothing clipped inside a panel either (a panel hides its overflow).
  const clipped = await page.$$eval(".panel", (ps) => ps.filter((p) => p.offsetParent && p.scrollWidth > p.clientWidth + 1).map((p) => p.innerText.slice(0, 40)));
  assert(clipped.length === 0, `${label}: content wider than its panel: ${clipped.join(" | ")}`);
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
const press = (page, sel) => page.$eval(sel, (e) => e.click());
const checked = (page, sel) => page.$eval(sel, (e) => e.getAttribute("aria-checked"));
const value = (page, sel) => page.$eval(sel, (e) => e.value);
const isDisabled = (page, sel) => page.$eval(sel, (e) => e.disabled || e.hasAttribute("disabled") || e.getAttribute("aria-disabled") === "true");
const previewText = (page) => page.$eval("[data-preview]", (e) => e.innerText);
const statusText = (page) => page.$eval("[data-receptionist-status]", (e) => e.textContent);
function sqlOne(q) {
  return execFileSync("docker", ["exec", "twin-pg", "psql", "-U", "twin", "-d", DB, "-tAc", q], { encoding: "utf8" }).trim();
}
const instructionsOf = (id) => sqlOne(`select data->>'instructions' from clients where id = '${id}'`);
async function openPage(page, tab = "persona") {
  await page.goto(`${B}/app/receptionist?tab=${tab}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-page="receptionist"]', { timeout: 15000 });
}
async function save(page) {
  await clickText(page, "button", "Save changes");
  await page
    .waitForFunction(() => !document.body.innerText.includes("Unsaved changes") && !document.body.innerText.includes("Saving…"), { timeout: 15000 })
    .catch(async (e) => {
      const toasts = await page.evaluate(() => window.__toasts.slice(-3).join(" | "));
      const bar = await page.evaluate(() => document.querySelector(".sticky.bottom-3")?.innerText.replace(/\s+/g, " "));
      throw new Error(`${e.message}: ${toasts || "no toast"} [bar: ${bar}]`);
    });
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const fresh = async (width = 1280, height = 900) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message.split("\n")[0]}`));
  // Speech is the browser's; stub it so headless runs don't depend on audio.
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    new MutationObserver(() => {
      for (const t of document.querySelectorAll("[data-sonner-toast]")) {
        const text = t.innerText.replace(/\s+/g, " ");
        if (!window.__toasts.includes(text)) window.__toasts.push(text);
      }
    }).observe(document, { childList: true, subtree: true });
    window.__spoken = [];
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.speak = (u) => {
      window.__spoken.push(u.text);
      setTimeout(() => u.onend && u.onend(new Event("end")), 10);
    };
  });
  return page;
};

try {
  const bz = await fresh();
  let bid = "";

  await step("business manager signs up; the receptionist page shows the header, status and every tab", async () => {
    await bz.goto(`${B}/login`, { waitUntil: "networkidle0" });
    const r = await apiFetch(bz, "POST", "/api/signup/business", {
      name: "Rhea Manager",
      email: `rhea-${stamp}@biz.test`,
      password: "business-password-1",
      businessName: `Rhea Plumbing ${stamp}`,
      industry: "Trades",
      suburb: "Paddington",
      timezone: "Australia/Brisbane",
    });
    assert(r.status === 201 || r.status === 200, `sign-up answered ${r.status}`);
    bid = (await apiFetch(bz, "GET", "/api/session/businesses")).body.businesses[0].id;
    await openPage(bz);
    assert((await statusText(bz)) === "Test receptionist", `status ${await statusText(bz)}`);
    await waitText(bz, "isn't on a phone line");
    for (const b of ["Hear a sample", "Edit knowledge", "Pause receptionist"]) await waitText(bz, b);
    const tabs = [
      ["Persona", "#a-personality"],
      ["Conversation", "#c-closing"],
      ["Booking", '[data-collect="email"]'],
      ["Transfers", '[data-toggle="transfer"]'],
      ["Hours", '[data-choice="hours-message_only"]'],
    ];
    for (const [t, sel] of tabs) {
      await clickTab(bz, t);
      await bz.waitForSelector(sel, { visible: true, timeout: 10000 });
    }
    await waitText(bz, "Saved · last updated");
  });

  await step("preview updates live as settings change (before saving)", async () => {
    await openPage(bz, "conversation");
    await type(bz, "#c-closing", `Cheers from Rhea ${stamp}!`);
    await bz.waitForFunction((s) => document.querySelector("[data-preview]").innerText.includes(`Cheers from Rhea ${s}!`), { timeout: 5000 }, stamp);
    await clickTab(bz, "Booking");
    await press(bz, '[data-collect="email"]');
    await bz.waitForFunction(() => document.querySelector("[data-preview]").innerText.includes("email address"), { timeout: 5000 });
    await clickTab(bz, "Transfers");
    await press(bz, '[data-toggle="transfer"]');
    await type(bz, "#t-number", "0412 345 678");
    await type(bz, "#t-name", "Rhea");
    await bz.waitForFunction(() => document.querySelector("[data-preview]").innerText.includes("put you through to Rhea"), { timeout: 5000 });
    await waitText(bz, "Unsaved changes");
  });

  await step("Discard reverts every tab's unsaved edits", async () => {
    await clickText(bz, "button", "Discard");
    await bz.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 5000 });
    assert((await checked(bz, '[data-toggle="transfer"]')) === "false", "transfer still on");
    const p = await previewText(bz);
    assert(!p.includes(`Cheers from Rhea ${stamp}`) && !p.includes("put you through"), "preview kept discarded edits");
    await clickTab(bz, "Conversation");
    assert((await value(bz, "#c-closing")) === "", "closing not reverted");
  });

  await step("Hear a sample reads the current script (browser voice) and says how to hear the real voice", async () => {
    await clickText(bz, "button", "Hear a sample");
    await bz.waitForSelector("[data-sample-script]");
    await waitText(bz, "not a live call or the receptionist's real voice");
    await waitText(bz, "test receptionist with no phone line");
    await clickText(bz, '[role="dialog"] button', "Play sample");
    await bz.waitForFunction(() => window.__spoken.length >= 3, { timeout: 5000 }).catch(() => {});
    const spoken = await bz.evaluate(() => window.__spoken);
    assert(spoken.length >= 3, `spoke ${spoken.length} lines`);
    await bz.keyboard.press("Escape");
    await bz.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  });

  await step("edits on every tab save, persist after a reload, and reach the instructions", async () => {
    await openPage(bz, "persona");
    await type(bz, "#a-name", "Rhea");
    await choose(bz, "#a-tone", "Calm");
    await choose(bz, "#a-lang", "plus the caller");
    await choose(bz, "#a-dialect", "British English");
    await type(bz, "#a-personality", `Patient with older callers ${stamp}.`);
    await clickTab(bz, "Conversation");
    await type(bz, 'textarea[aria-label="Greeting"]', `Hello, Rhea Plumbing ${stamp}, Rhea speaking.`);
    await type(bz, "#c-closing", `Cheers from Rhea ${stamp}!`);
    await press(bz, '[data-choice="faq-detailed"]');
    await bz.type("[data-avoid] input", `Quotes over the phone ${stamp}`);
    await bz.keyboard.press("Enter");
    await clickTab(bz, "Booking");
    await press(bz, '[data-collect="email"]');
    await press(bz, '[data-collect="address"]');
    await bz.type('[data-questions] input', `Is it a house or a unit ${stamp}?`);
    await bz.keyboard.press("Enter");
    await clickTab(bz, "Transfers");
    await press(bz, '[data-toggle="transfer"]');
    await type(bz, "#t-number", "0412 345 678");
    await type(bz, "#t-name", "Rhea");
    await press(bz, '[data-option="cantHelp"]');
    await clickTab(bz, "Hours");
    await press(bz, '[data-choice="hours-message_only"]');
    await bz.waitForSelector("#h-greeting");
    await type(bz, "#h-greeting", `Rhea Plumbing is closed ${stamp}.`);
    await setValue(bz, "#h-max", "12");
    assert((await value(bz, "#h-max")) === "12", `call limit typed as ${await value(bz, "#h-max")}`);
    assert(!(await bz.$("[data-applied]")), "success shown before saving");
    await save(bz);
    await bz.waitForSelector("[data-applied]", { timeout: 15000 });
    await waitText(bz, "so the settings are saved here and nothing is sent to the phone provider");

    await openPage(bz, "persona");
    assert((await value(bz, "#a-name")) === "Rhea", "name not saved");
    assert((await bz.$eval("#a-tone", (e) => e.textContent)).includes("Calm"), "tone not saved");
    assert((await bz.$eval("#a-lang", (e) => e.textContent)).includes("caller"), "language not saved");
    assert((await bz.$eval("#a-dialect", (e) => e.textContent)).includes("British"), "dialect not saved");
    assert((await value(bz, "#a-personality")) === `Patient with older callers ${stamp}.`, "personality not saved");
    await clickTab(bz, "Conversation");
    assert((await value(bz, "#c-closing")) === `Cheers from Rhea ${stamp}!`, "closing not saved");
    assert((await checked(bz, '[data-choice="faq-detailed"]')) === "true", "faq style not saved");
    await waitText(bz, `Quotes over the phone ${stamp}`);
    await clickTab(bz, "Booking");
    assert((await checked(bz, '[data-collect="email"]')) === "true" && (await checked(bz, '[data-collect="address"]')) === "true", "collect not saved");
    assert((await checked(bz, '[data-collect="reason"]')) === "false", "reason switched on");
    await waitText(bz, `Is it a house or a unit ${stamp}?`);
    await clickTab(bz, "Transfers");
    assert((await checked(bz, '[data-toggle="transfer"]')) === "true", "transfer not saved");
    assert((await value(bz, "#t-number")) === "+61412345678", "transfer number not saved");
    assert((await checked(bz, '[data-option="cantHelp"]')) === "true", "cantHelp not saved");
    await clickTab(bz, "Hours");
    assert((await checked(bz, '[data-choice="hours-message_only"]')) === "true", "after-hours mode not saved");
    assert((await value(bz, "#h-greeting")) === `Rhea Plumbing is closed ${stamp}.`, "after-hours greeting not saved");
    assert((await value(bz, "#h-max")) === "12", "call limit not saved");

    const ins = instructionsOf(bid);
    for (const want of [
      "British English",
      "Calm, patient and reassuring",
      `Personality: Patient with older callers ${stamp}.`,
      `"Cheers from Rhea ${stamp}!"`,
      `Never discuss or give opinions on: Quotes over the phone ${stamp}`,
      "give the full answer",
      "their email address",
      "the street address",
      `Is it a house or a unit ${stamp}?`,
    ]) {
      assert(ins.includes(want), `instructions missing: ${want}`);
    }
    const a = (await apiFetch(bz, "GET", `/api/manage/${bid}/receptionist`)).body.agents[0];
    assert(a.tone === "calm" && a.dialect === "en-GB" && a.closing_line.includes(stamp) && a.collect_fields.join() === "email,address", `agent ${JSON.stringify({ t: a.tone, d: a.dialect, c: a.collect_fields })}`);
  });

  await step("preview reflects the saved settings, and the Closed view shows the after-hours greeting", async () => {
    const p = await previewText(bz);
    assert(p.includes(`Hello, Rhea Plumbing ${stamp}, Rhea speaking.`) && p.includes("put you through to Rhea") && p.includes(`Cheers from Rhea ${stamp}!`), `preview: ${p.slice(0, 200)}`);
    assert(p.includes("British English") && p.includes("Calm"), "preview badges");
    await clickText(bz, '[aria-label="Preview time"] button', "Closed");
    await bz.waitForFunction((s) => document.querySelector("[data-preview]").innerText.includes(`Rhea Plumbing is closed ${s}.`), { timeout: 5000 }, stamp);
    assert((await previewText(bz)).includes("can't book that in"), "closed preview offers bookings");
  });

  await step("removing a field (clearing personality) takes it out of the instructions", async () => {
    await openPage(bz, "persona");
    await type(bz, "#a-personality", "");
    await save(bz);
    const ins = instructionsOf(bid);
    assert(!ins.includes("Personality:"), "personality still in the instructions");
    assert(ins.includes(`Cheers from Rhea ${stamp}!`), "other fields lost");
  });

  await step("pause: callers get the pause message, the script only takes messages; resume restores it", async () => {
    await openPage(bz, "persona");
    await clickText(bz, "button", "Pause receptionist");
    await bz.waitForSelector("#pause-message");
    await type(bz, "#pause-message", `Back on Monday ${stamp}.`);
    await press(bz, '[data-action="confirm-pause"]');
    await bz.waitForFunction(() => document.querySelector("[data-receptionist-status]")?.textContent === "Paused", { timeout: 15000 });
    await waitText(bz, `Callers hear: "Back on Monday ${stamp}."`);
    assert((await previewText(bz)).includes(`Back on Monday ${stamp}.`), "preview doesn't show the pause message");
    const a = (await apiFetch(bz, "GET", `/api/manage/${bid}/receptionist`)).body.agents[0];
    assert(a.status === "paused" && a.paused_by === "business", `agent ${a.status} ${a.paused_by}`);
    const ins = instructionsOf(bid);
    assert(ins.includes("paused its receptionist") && ins.includes(`Back on Monday ${stamp}.`) && !ins.includes("check_availability"), "paused script not in the instructions");
    // Settings can still be changed while paused, and stay paused.
    await clickTab(bz, "Conversation");
    await type(bz, "#c-closing", `Bye from Rhea ${stamp}!`);
    assert(await isDisabled(bz, '[data-action="resume"]'), "resume allowed with unsaved edits");
    await save(bz);
    assert((await statusText(bz)) === "Paused", "unpaused by a save");
    // Resume.
    await press(bz, '[data-action="resume"]');
    await bz.waitForFunction(() => document.querySelector("[data-receptionist-status]")?.textContent === "Test receptionist", { timeout: 15000 });
    const back = instructionsOf(bid);
    assert(!back.includes("paused its receptionist") && back.includes(`Bye from Rhea ${stamp}!`) && back.includes("British English"), "resume didn't restore the script");
    const after = (await apiFetch(bz, "GET", `/api/manage/${bid}/receptionist`)).body.agents[0];
    assert(after.status === "active" && after.greeting.includes(stamp), `after resume ${after.status}`);
    const old = await apiFetch(bz, "PUT", `/api/manage/${bid}/receptionist`, { status: "paused" });
    assert(old.status === 400, `status via PUT answered ${old.status}`);
  });

  await step("phone width: every tab has no horizontal overflow at 390px", async () => {
    await bz.setViewport({ width: 390, height: 844 });
    for (const tab of ["persona", "conversation", "booking", "transfers", "hours"]) {
      await openPage(bz, tab);
      await sleep(300);
      await noOverflow(bz, `/app/receptionist?tab=${tab}`);
    }
    await bz.setViewport({ width: 1280, height: 900 });
  });

  await step("viewer: everything read-only on the page and refused by the API", async () => {
    const email = `vic-${stamp}@biz.test`;
    const inv = await apiFetch(bz, "POST", `/api/manage/${bid}/team/invites`, { email, role: "viewer" });
    assert(inv.status === 201 && inv.body.url, `invite answered ${inv.status}`);
    const v = await fresh();
    await v.goto(inv.body.url.replace(/^https?:\/\/[^/]+/, B), { waitUntil: "networkidle0" });
    await type(v, "#name", "Vic Viewer");
    await type(v, "#password", "viewer-password-1");
    await clickText(v, "button[type=submit]", "Accept invite");
    await waitPath(v, "/app", 15000);
    await openPage(v);
    await waitText(v, "view only");
    assert(await isDisabled(v, "#a-name"), "name editable");
    assert(await isDisabled(v, "#a-personality"), "personality editable");
    assert(await isDisabled(v, "#a-lang"), "language editable");
    assert(!(await v.$('[data-action="pause"]')) && !(await v.$('[data-action="resume"]')), "pause shown to a viewer");
    await clickTab(v, "Conversation");
    assert(await isDisabled(v, "#c-closing"), "closing editable");
    await clickTab(v, "Booking");
    assert(await isDisabled(v, '[data-collect="email"]'), "collect editable");
    await clickTab(v, "Transfers");
    await v.waitForSelector('[data-toggle="transfer"]');
    assert(await isDisabled(v, '[data-toggle="transfer"]'), "transfer editable");
    assert((await checked(v, '[data-toggle="transfer"]')) === "true", "viewer doesn't see the saved transfer");
    await clickTab(v, "Hours");
    assert(await isDisabled(v, '[data-choice="hours-always"]'), "hours mode editable");
    assert(await v.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Save changes"))?.disabled === true), "save enabled");
    for (const [m, u, body] of [
      ["PUT", `/api/manage/${bid}/receptionist`, { personality: "viewer" }],
      ["POST", `/api/manage/${bid}/receptionist/pause`, { paused: true }],
      ["PUT", `/api/automations/${bid}`, { transfer: { enabled: false } }],
    ]) {
      const r = await apiFetch(v, m, u, body);
      assert(r.status === 403, `viewer ${m} ${u} answered ${r.status}`);
    }
    await v.setViewport({ width: 390, height: 844 });
    await openPage(v, "transfers");
    await noOverflow(v, "/app/receptionist (viewer)");
  });

  await step("agency staff on a live receptionist: a refused provider update is an error and nothing is saved", async () => {
    const a = await fresh();
    await a.goto(`${B}/login`, { waitUntil: "networkidle0" });
    await type(a, "#email", "a@a.test");
    await type(a, "#password", "password-for-agency-a");
    await clickText(a, "button[type=submit]", "Sign in");
    await waitPath(a, "/admin", 15000);
    const r = await apiFetch(a, "PUT", `/api/manage/${alpha}/receptionist`, { personality: `Should not stick ${stamp}` });
    assert(r.status >= 400, `staff save answered ${r.status}`);
    const p = await apiFetch(a, "POST", `/api/manage/${alpha}/receptionist/pause`, { paused: true });
    assert(p.status >= 400, `staff pause answered ${p.status}`);
    const g = (await apiFetch(a, "GET", `/api/manage/${alpha}/receptionist`)).body.agents[0];
    assert(!g.personality && g.status === "active", `saved anyway: ${g.personality} ${g.status}`);
    assert(!sqlOne(`select data::text from clients where id = '${alpha}'`).includes(stamp), "stored despite the refusal");
  });

  await step("no page errors", async () => {
    assert(pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  });
} finally {
  await browser.close();
}

console.log(results.join("\n"));
console.log(failed ? `\n${failed} failed` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
