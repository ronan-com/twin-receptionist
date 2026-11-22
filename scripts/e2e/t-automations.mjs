// Browser test for the automations page (area T). Run scripts/e2e/setup.sh first, then:
//   E2E_PORT=8906 E2E_DB=e2e_t node scripts/e2e/t-automations.mjs
// Covers: a business manager's toggles and settings save and persist, validation,
// a viewer sees them read-only and can't write, another org can't read or write,
// agency staff can save (and the page says honestly when the phone service refused),
// the public dynamic-variables webhook, and no horizontal overflow at 390px.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const PORT = process.env.E2E_PORT || "8906";
const DB = process.env.E2E_DB || "e2e_t";
const DIR = process.env.E2E_DIR || `/tmp/twin-e2e-${PORT}`;
const B = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/snap/bin/chromium";
const stamp = Date.now().toString(36);
const alpha = readFileSync(`${DIR}/clientid`, "utf8").trim();
const results = [];
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
  await page.type(sel, value);
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
// A DOM click, so a toast over the switch can't swallow it.
const press = (page, sel) => page.$eval(sel, (e) => e.click());
const checked = (page, sel) => page.$eval(sel, (e) => e.getAttribute("aria-checked"));
const disabled = (page, sel) => page.$eval(sel, (e) => e.disabled || e.hasAttribute("disabled"));
const statusOf = (page, key) => page.$eval(`[data-automation="${key}"] [data-status]`, (e) => ({ state: e.dataset.status, text: e.textContent }));
async function openPage(page) {
  await page.goto(`${B}/app/automations`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-automations-panel]", { timeout: 15000 });
}
async function save(page) {
  await clickText(page, "button", "Save changes");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes") && !document.body.innerText.includes("Saving…"), { timeout: 15000 });
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const fresh = async (width = 1280, height = 900) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  return page;
};

try {
  // ---- A business manager (self-serve sign-up: a demo receptionist with the fake key) ----
  const bz = await fresh();
  let bizId = "";
  await step("business manager signs up and opens Automations from the receptionist sub-navigation", async () => {
    await bz.goto(`${B}/login`, { waitUntil: "networkidle0" });
    const r = await apiFetch(bz, "POST", "/api/signup/business", {
      name: "Tess Manager",
      email: `tess-${stamp}@biz.test`,
      password: "business-password-1",
      businessName: `Tess Electrical ${stamp}`,
      industry: "Trades",
      suburb: "Paddington",
      timezone: "Australia/Brisbane",
    });
    assert(r.status === 201 || r.status === 200, `sign-up answered ${r.status}`);
    await bz.goto(`${B}/app/receptionist`, { waitUntil: "networkidle0" });
    await clickText(bz, "a", "Automations");
    await waitPath(bz, "/app/automations");
    await bz.waitForSelector("[data-automations-panel]");
    bizId = (await apiFetch(bz, "GET", "/api/session/businesses")).body.businesses[0].id;
    for (const k of ["transfer", "textBack", "recording", "language", "callLimits", "hoursMode"]) {
      assert(await bz.$(`[data-automation="${k}"]`), `no ${k} card`);
    }
    assert((await checked(bz, '[data-toggle="transfer"]')) === "false", "transfer starts on");
    assert((await statusOf(bz, "transfer")).state === "off", "transfer status not off");
    await waitText(bz, "Demo receptionist");
  });

  await step("validation: transfer on without a number is refused with a clear message", async () => {
    await press(bz, '[data-toggle="transfer"]');
    await clickText(bz, "button", "Save changes");
    await waitText(bz, "Add the number to transfer calls to");
    await type(bz, "#auto-transfer-number", "1234");
    await clickText(bz, "button", "Save changes");
    await waitText(bz, "Enter an Australian phone number");
  });

  await step("manager: toggles and settings save and persist after a reload", async () => {
    await type(bz, "#auto-transfer-number", "0412 345 678");
    await type(bz, "#auto-transfer-name", "Tess");
    await press(bz, '[data-automation="transfer"] [data-option="cantHelp"]');
    await press(bz, '[data-toggle="textBack"]');
    await press(bz, '[data-toggle="recording"]');
    await type(bz, "#auto-rec-notice", "This call is recorded for training.");
    await bz.select("#auto-language", "multi");
    await type(bz, "#auto-max-minutes", "12");
    await press(bz, '[data-toggle="hoursMode"]');
    await save(bz);
    await waitText(bz, "Automations saved");

    await openPage(bz);
    assert((await checked(bz, '[data-toggle="transfer"]')) === "true", "transfer not saved");
    assert((await checked(bz, '[data-toggle="textBack"]')) === "true", "text-back not saved");
    assert((await checked(bz, '[data-toggle="recording"]')) === "true", "recording not saved");
    assert((await checked(bz, '[data-toggle="hoursMode"]')) === "true", "after-hours not saved");
    assert((await checked(bz, '[data-automation="transfer"] [data-option="cantHelp"]')) === "true", "cantHelp not saved");
    assert((await bz.$eval("#auto-transfer-number", (e) => e.value)) === "+61412345678", "number not normalised");
    assert((await bz.$eval("#auto-transfer-name", (e) => e.value)) === "Tess", "name not saved");
    assert((await bz.$eval("#auto-rec-notice", (e) => e.value)) === "This call is recorded for training.", "notice not saved");
    assert((await bz.$eval("#auto-language", (e) => e.value)) === "multi", "language not saved");
    assert((await bz.$eval("#auto-max-minutes", (e) => e.value)) === "12", "max minutes not saved");
    const t = await statusOf(bz, "transfer");
    assert(t.state === "on" && t.text.includes("0412345678"), `transfer status ${JSON.stringify(t)}`);
    assert((await statusOf(bz, "recording")).state === "on", "recording status not on");
    assert((await statusOf(bz, "hoursMode")).state === "on", "after-hours status not on");
  });

  await step("manager: switching one off persists too", async () => {
    await press(bz, '[data-toggle="recording"]');
    await save(bz);
    await openPage(bz);
    assert((await checked(bz, '[data-toggle="recording"]')) === "false", "recording still on");
    assert((await checked(bz, '[data-toggle="transfer"]')) === "true", "transfer lost");
    assert((await statusOf(bz, "recording")).state === "off", "recording status not off");
  });

  await step("the dynamic-variables webhook answers with the right token only", async () => {
    const token = execFileSync("docker", ["exec", "twin-pg", "psql", "-U", "twin", "-d", DB, "-tAc", `select settings->>'_token' from client_automations where client_id = '${bizId}'`])
      .toString()
      .trim();
    assert(token.length >= 16, "no webhook token stored");
    const ok = await fetch(`${B}/hooks/automations/${bizId}/${token}`, { method: "POST", body: "{}" }).then((r) => r.json());
    assert(["yes", "no"].includes(ok.dynamic_variables?.twin_open_now), `webhook answered ${JSON.stringify(ok)}`);
    assert(typeof ok.dynamic_variables?.twin_greeting === "string" && ok.dynamic_variables.twin_greeting.length > 5, "no greeting");
    const bad = await fetch(`${B}/hooks/automations/${bizId}/${"x".repeat(token.length)}`, { method: "POST", body: "{}" });
    assert(bad.status === 404, `wrong token answered ${bad.status}`);
  });

  await step("phone width: /app/automations has no horizontal overflow at 390px", async () => {
    await bz.setViewport({ width: 390, height: 844 });
    await openPage(bz);
    await noOverflow(bz, "/app/automations");
    await bz.setViewport({ width: 1280, height: 900 });
  });

  // ---- Agency staff ----
  const owner = await fresh();
  await step("agency staff can change a receptionist's automations; a refused provider update is shown honestly", async () => {
    await signIn(owner, "a@a.test", "password-for-agency-a");
    await waitPath(owner, "/admin");
    const r = await apiFetch(owner, "PUT", `/api/automations/${alpha}`, { transfer: { enabled: true, number: "07 3333 4444" }, hoursMode: { enabled: true } });
    assert(r.status === 200, `staff save answered ${r.status}`);
    assert(r.body.settings.transfer.number === "+61733334444", "number not saved");
    // Alpha's assistant isn't a demo one and the local key is fake: saved, but not applied.
    assert(typeof r.body.applyError === "string" && r.body.applyError.length > 0, "no apply error shown");
    assert(r.body.status.transfer.state === "needs_setup", `transfer status ${r.body.status.transfer.state} (Alpha has no phone number)`);
    const again = await apiFetch(owner, "GET", `/api/automations/${alpha}`);
    assert(again.body.settings.hoursMode.enabled === true && again.body.canEdit === true, "not persisted");
  });

  await step("another org can't read or change automations", async () => {
    const mine = await apiFetch(bz, "GET", `/api/automations/${alpha}`);
    assert(mine.status === 404, `business user read another org's: ${mine.status}`);
    const w = await apiFetch(bz, "PUT", `/api/automations/${alpha}`, { recording: { enabled: true } });
    assert(w.status === 404, `business user wrote another org's: ${w.status}`);
    const agencyRead = await apiFetch(owner, "GET", `/api/automations/${bizId}`);
    assert(agencyRead.status === 404, `agency read a direct business: ${agencyRead.status}`);
    const agencyWrite = await apiFetch(owner, "PUT", `/api/automations/${bizId}`, { recording: { enabled: true } });
    assert(agencyWrite.status === 404, `agency wrote a direct business: ${agencyWrite.status}`);
    const after = await apiFetch(bz, "GET", `/api/automations/${bizId}`);
    assert(after.body.settings.recording.enabled === false, "the other org's write landed");
  });

  // ---- A viewer (an agency's customer) ----
  await step("viewer: sees the automations read-only and can't save", async () => {
    const email = `vera-${stamp}@customer.test`;
    const inv = await apiFetch(owner, "POST", `/api/clients/${alpha}/customers`, { email });
    assert(inv.status === 201 && inv.body.url, `invite answered ${inv.status}`);
    const page = await fresh();
    await page.goto(inv.body.url.replace(/^https?:\/\/[^/]+/, B), { waitUntil: "networkidle0" });
    await type(page, "#name", "Vera Viewer");
    await type(page, "#password", "customer-password-1");
    await clickText(page, "button[type=submit]", "Accept invite");
    await waitPath(page, "/app", 15000);
    await openPage(page);
    await waitText(page, "View-only");
    assert((await checked(page, '[data-toggle="transfer"]')) === "true", "viewer doesn't see the saved transfer");
    assert(await disabled(page, '[data-toggle="transfer"]'), "transfer switch is editable");
    assert(await disabled(page, "#auto-transfer-number"), "number field is editable");
    assert(!(await page.$$eval("button", (bs) => bs.some((b) => b.textContent.includes("Save changes")))), "save button shown");
    const g = await apiFetch(page, "GET", `/api/automations/${alpha}`);
    assert(g.status === 200 && g.body.canEdit === false, `viewer read answered ${g.status} canEdit=${g.body?.canEdit}`);
    const w = await apiFetch(page, "PUT", `/api/automations/${alpha}`, { transfer: { enabled: false } });
    assert(w.status === 403, `viewer write answered ${w.status}`);
    const still = await apiFetch(owner, "GET", `/api/automations/${alpha}`);
    assert(still.body.settings.transfer.enabled === true, "viewer write landed");
    await page.setViewport({ width: 390, height: 844 });
    await openPage(page);
    await noOverflow(page, "/app/automations (viewer)");
  });
} finally {
  await browser.close();
}

console.log(results.join("\n"));
console.log(failed ? `\n${failed} failed` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
