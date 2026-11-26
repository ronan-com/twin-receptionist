// Browser test for an agency's own phone account (area P): Setup, Connections, buying a
// number, who may change the key, booking emails, the product name and the public guide.
// Start the main server with own accounts required, then run this:
//   OWN_PHONE_ACCOUNT=required E2E_PORT=8905 E2E_DB=e2e_q E2E_SKIP_BUILD=1 bash scripts/e2e/setup.sh
//   E2E_PORT=8905 E2E_DB=e2e_q node scripts/e2e/p-phone-setup.mjs
// It starts a second server itself (PRODUCT_NAME=Chloe, no OWN_PHONE_ACCOUNT) on
// E2E_PORT2 / E2E_DB2 (default 8907 / e2e_q3) with setup.sh, and a third one with
// SINGLE_AGENCY=1 (one agency per server, as a self-hosted copy runs) on E2E_PORT3 /
// E2E_DB3 (default 8908 / e2e_q4), on an empty database; it stops both at the end.
// Only malformed keys and the local pretend key are ever sent: a real-looking key
// would be checked with the real Telnyx API.
import { execSync, spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import puppeteer from "puppeteer-core";

const PORT = process.env.E2E_PORT || "8905";
const DIR = process.env.E2E_DIR || `/tmp/twin-e2e-${PORT}`;
const B = `http://localhost:${PORT}`;
const DB = process.env.E2E_DB || "e2e_q";
const PORT2 = process.env.E2E_PORT2 || "8907";
const DB2 = process.env.E2E_DB2 || "e2e_q3";
const B2 = `http://localhost:${PORT2}`;
const PORT3 = process.env.E2E_PORT3 || "8908";
const DB3 = process.env.E2E_DB3 || "e2e_q4";
const B3 = `http://localhost:${PORT3}`;
const CHROME = process.env.CHROME || "/snap/bin/chromium";
const REPO = new URL("../..", import.meta.url).pathname;
const TEST_KEY = "KEYTEST-LOCAL-DEMO-0001";
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
async function waitPath(page, want, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (want instanceof RegExp ? want.test(path(page)) : path(page) === want) return;
    await sleep(100);
  }
  throw new Error(`expected ${want}, at ${path(page)}`);
}
const waitText = (page, text, ms = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, text);
async function type(page, sel, value) {
  await page.waitForSelector(sel, { visible: true });
  await page.click(sel, { count: 3 });
  await page.type(sel, value);
}
async function clickText(page, selector, text) {
  await page.waitForFunction(
    (s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t) && !e.disabled && e.offsetParent !== null),
    { timeout: 15000 },
    selector,
    text,
  );
  await page.evaluate((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t) && !e.disabled && e.offsetParent !== null).click(), selector, text);
}
async function click(page, sel) {
  await page.waitForSelector(sel, { visible: true, timeout: 15000 });
  await page.evaluate((s) => [...document.querySelectorAll(s)].find((e) => e.offsetParent !== null && !e.disabled)?.click(), sel);
}
async function noOverflow(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert(sw <= iw, `${label}: page is ${sw}px wide on a ${iw}px screen`);
}
const apiFetch = (page, method, url, body) =>
  page.evaluate(
    async (m, u, b) => {
      const r = await fetch(u, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    method,
    url,
    body,
  );
async function signUpAgency(page, base, who) {
  await page.goto(`${base}/signup?as=agency`, { waitUntil: "networkidle0" });
  await type(page, "#name", who.name);
  await type(page, "#email", who.email);
  await type(page, "#password", who.password);
  await type(page, "#agency", who.agencyName);
  await clickText(page, "button[type=submit]", "Create agency");
}
async function accept(page, url, name, password) {
  await page.goto(url, { waitUntil: "networkidle0" });
  await type(page, "#name", name);
  await type(page, "#password", password);
  await clickText(page, "button[type=submit]", "Accept invite");
}
const navText = (page) => page.$eval('nav[aria-label="Primary"]', (e) => e.innerText);
const head = (page) =>
  page.evaluate(() => ({ title: document.title, product: document.querySelector('meta[name="product"]')?.getAttribute("content") ?? null }));
const serverLog = () => readFileSync(`${DIR}/server.log`, "utf8");
const psql = (q) => execSync(`docker exec twin-pg psql -U twin -d ${DB} -tA -c ${JSON.stringify(q)}`, { encoding: "utf8" }).trim();
const listening = (port) => {
  try {
    return execSync(`ss -ltnp 2>/dev/null | grep ":${port} " | grep -oE "pid=[0-9]+" | cut -d= -f2`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

// The second server: named Chloe, agencies on the platform's phone account (the default).
let startedSecond = false;
try {
  execSync("bash scripts/e2e/setup.sh", {
    cwd: REPO,
    env: { ...process.env, E2E_PORT: PORT2, E2E_DB: DB2, E2E_DIR: `/tmp/twin-e2e-${PORT2}`, E2E_SKIP_BUILD: "1", PRODUCT_NAME: "Chloe", OWN_PHONE_ACCOUNT: "" },
    stdio: "pipe",
  });
  startedSecond = true;
} catch (err) {
  results.push(`  (second server on ${PORT2} didn't start: ${String(err.message).split("\n")[0]})`);
}

// The third server: SINGLE_AGENCY=1 on an empty database, so its first account is the
// one agency's owner. OWN_PHONE_ACCOUNT=required is set too, to show the single agency
// still runs on the server's own key (the install's) and never sees Setup.
let startedThird = false;
try {
  if (!/^[a-z_][a-z0-9_]*$/.test(DB3) || ["own_phone", "e2e_q2", "twin", "answered", "postgres"].includes(DB3)) throw new Error(`won't use database ${DB3}`);
  for (const pid of listening(PORT3)) execSync(`kill ${pid}`);
  execSync(`docker exec twin-pg psql -U twin -d postgres -q -c "drop database if exists ${DB3}" -c "create database ${DB3}"`, { stdio: "pipe" });
  const dbUrl = readFileSync(`${DIR}/dburl`, "utf8").trim().replace(/\/[A-Za-z0-9_]+(\?.*)?$/, `/${DB3}$1`);
  const dir3 = `/tmp/twin-e2e-${PORT3}`;
  mkdirSync(dir3, { recursive: true });
  const log = openSync(`${dir3}/server.log`, "w");
  spawn("bun", ["server/index.ts"], {
    cwd: REPO,
    detached: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      SINGLE_AGENCY: "1",
      OWN_PHONE_ACCOUNT: "required",
      DATABASE_URL: dbUrl,
      LEGACY_DATA_DIR: `${dir3}/nolegacy`,
      MAILBOX_KEY: randomBytes(32).toString("base64"),
      TELNYX_API_KEY: "platform-fake-key-0000000000",
      API_PORT: PORT3,
      PUBLIC_URL: B3,
      FIRST_ADMIN_EMAIL: "",
      ALLOW_SIGNUP: "true",
      MAILBOX_SIGNIN: "",
      PRODUCT_NAME: "",
      SIGNUP_LIMIT_PER_HOUR: "50",
    },
  }).unref();
  for (let i = 0; i < 40 && !startedThird; i++) {
    startedThird = await fetch(`${B3}/api/health`).then((r) => r.ok, () => false);
    if (!startedThird) await sleep(500);
  }
  if (!startedThird) results.push(`  (single-agency server on ${PORT3} didn't answer)`);
} catch (err) {
  results.push(`  (single-agency server on ${PORT3} didn't start: ${String(err.message).split("\n")[0]})`);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const fresh = async (width = 1280, height = 900) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message.split("\n")[0]}`));
  return page;
};

const owner = { name: "Sam Carter", email: `sam-${stamp}@northside.test`, password: "northside-password-1", agencyName: `Northside AI ${stamp}` };
const member = { email: `mel-${stamp}@northside.test`, password: "member-password-1" };
const admin = { email: `adam-${stamp}@northside.test`, password: "admin-password-12" };
const business = `Bright Smile Dental ${stamp}`;
let receptionistId = "";

try {
  // ---- 1. A new agency must connect its own phone account first ----
  const ag = await fresh();
  await step("new agency signs up and lands on /setup; the console and POST /api/clients wait for it", async () => {
    await signUpAgency(ag, B, owner);
    await waitPath(ag, "/setup", 20000);
    await ag.waitForSelector('[data-page="setup"] [data-step="welcome"]');
    const acct = await apiFetch(ag, "GET", "/api/phone-account");
    assert(acct.status === 200 && acct.body.mode === "none", `phone account ${acct.status} ${acct.body?.mode}`);
    assert(acct.body.required === true, "server isn't running with OWN_PHONE_ACCOUNT=required (start it as in the header)");
    for (const p of ["/admin", "/admin/clients", "/admin/connections"]) {
      await ag.goto(`${B}${p}`, { waitUntil: "networkidle0" });
      await waitPath(ag, "/setup");
    }
    const r = await apiFetch(ag, "POST", "/api/clients", { businessName: "Too Early Dental", industry: "dental", receptionistName: "Grace", defaultVoice: true });
    assert(r.status === 400, `POST /api/clients answered ${r.status}`);
    assert(String(r.body?.error).includes("Connect your Telnyx account first"), `error was: ${r.body?.error}`);
  });

  await step("phone width: /setup has no horizontal overflow at 390px", async () => {
    await ag.setViewport({ width: 390, height: 844 });
    await ag.goto(`${B}/setup`, { waitUntil: "networkidle0" });
    await ag.waitForSelector('[data-step="welcome"]');
    await noOverflow(ag, "/setup");
    await ag.setViewport({ width: 1280, height: 900 });
  });

  // ---- 2. Malformed keys are refused before anything is asked of Telnyx ----
  await step("a malformed key is refused with a readable message (UI and API)", async () => {
    await ag.goto(`${B}/setup`, { waitUntil: "networkidle0" });
    await click(ag, '[data-action="setup-start"]');
    await ag.waitForSelector('[data-step="account"]');
    await click(ag, '[data-action="setup-next"]');
    await ag.waitForSelector('[data-step="credit"]');
    await click(ag, '[data-action="setup-next"]');
    await ag.waitForSelector('[data-step="connect"]');
    await type(ag, '[data-field="api-key"]', "KEY-too-short");
    await click(ag, '[data-action="setup-connect"]');
    await ag.waitForSelector('[data-error="api-key"]');
    const msg = await ag.$eval('[data-error="api-key"]', (e) => e.innerText);
    assert(msg.includes("doesn't look like a whole API key"), `message was: ${msg}`);
    for (const key of ["", "KEY 1234 5678 9012 3456 7890", "abc"]) {
      const r = await apiFetch(ag, "PUT", "/api/phone-account", { key });
      assert(r.status === 400 && /API key/.test(r.body?.error ?? ""), `key ${JSON.stringify(key)}: ${r.status} ${r.body?.error}`);
    }
    const still = await apiFetch(ag, "GET", "/api/phone-account");
    assert(still.body.mode === "none", `mode is ${still.body.mode} after bad keys`);
  });

  // ---- 3. The pretend key connects ----
  await step("the local pretend key connects and the wizard reaches the done step", async () => {
    await click(ag, '[data-action="use-test-key"]');
    const key = await ag.$eval('[data-field="api-key"]', (e) => e.value);
    assert(key === TEST_KEY, `the test-key button filled in ${key}`);
    await click(ag, '[data-action="setup-connect"]');
    await ag.waitForSelector('[data-step="done"] [data-card="connected"]', { timeout: 20000 });
    // Reloading stays on the finished step.
    await ag.goto(`${B}/setup`, { waitUntil: "networkidle0" });
    await ag.waitForSelector('[data-step="done"]');
  });

  await step("Connections shows the account connected; menu has Connections and no Number Requests", async () => {
    await ag.goto(`${B}/admin/connections`, { waitUntil: "networkidle0" });
    await waitPath(ag, "/admin/connections");
    await ag.waitForSelector('[data-card="phone-account"][data-mode="own"]');
    const card = await ag.$eval('[data-card="phone-account"]', (e) => e.innerText);
    assert(card.includes("Connected") && card.includes("0001"), `card says: ${card.replace(/\s+/g, " ").slice(0, 160)}`);
    const ok = await ag.$$eval('[data-list="health"] li', (ls) => ls.map((l) => l.dataset.ok));
    assert(ok[0] === "true", `health rows: ${ok.join(",")}`);
    const nav = await navText(ag);
    assert(nav.includes("Connections"), "Connections missing from the menu");
    assert(!nav.includes("Number Requests"), "Number Requests still in the menu");
  });

  // ---- 4. A first client, and a number bought for it ----
  await step("agency creates a client and buys its demo receptionist a number", async () => {
    await ag.goto(`${B}/admin/clients/new`, { waitUntil: "networkidle0" });
    await type(ag, "#w-name", business);
    await clickText(ag, '[role="radio"]', "Dental clinic");
    await clickText(ag, '[data-action="continue"]', "Continue");
    await ag.waitForSelector('[data-step="1"]');
    await clickText(ag, '[data-action="continue"]', "Continue");
    await ag.waitForSelector('[data-step="2"]'); // How it handles calls (optional details)
    await clickText(ag, '[data-action="continue"]', "Continue");
    await ag.waitForSelector('[data-step="3"]');
    await ag.waitForSelector('[aria-labelledby="w-voice"] [role="radio"][aria-checked="true"]');
    await clickText(ag, '[data-action="continue"]', "Continue");
    await ag.waitForSelector("[data-review]");
    await clickText(ag, '[data-action="create-receptionist"]', "Create receptionist");
    await waitPath(ag, /^\/admin\/clients\/[a-f0-9-]{36}$/, 30000);
    await ag.waitForSelector('[data-page="admin-client"] [data-receptionist]', { timeout: 15000 });
    receptionistId = await ag.$eval('[data-page="admin-client"] [data-receptionist]', (e) => e.dataset.receptionist);
    // Only a demo receptionist is safe here: buying for a real one goes to Telnyx.
    const c = await apiFetch(ag, "GET", `/api/clients/${receptionistId}`);
    assert(String(c.body?.client?.assistantId).startsWith("demo-"), `receptionist isn't a demo one: ${c.body?.client?.assistantId}`);
    await click(ag, '[data-action="buy-number"]');
    await ag.waitForSelector('[data-list="available-numbers"] li button');
    const picked = await ag.$eval('[data-list="available-numbers"] li:nth-child(2) button', (b) => {
      b.click();
      return b.querySelector("span").innerText.trim();
    });
    await ag.waitForSelector('[data-action="confirm-buy-number"]:not([disabled])');
    await click(ag, '[data-action="confirm-buy-number"]');
    await ag.waitForSelector('[data-list="numbers"] li', { timeout: 20000 });
    const listed = await ag.$eval('[data-list="numbers"]', (e) => e.innerText);
    // One format per country: the picker and the client page both show 0480 011 202.
    assert(/^04\d{2} \d{3} \d{3}$/.test(picked), `picker shows ${picked}`);
    assert(listed.includes(picked), `bought ${picked}, page lists ${listed}`);
    assert(listed.includes("Calls + texts"), `an Australian mobile should take texts: ${listed}`);
  });

  await step("Connections counts the client and the number", async () => {
    await ag.goto(`${B}/admin/connections`, { waitUntil: "networkidle0" });
    await ag.waitForSelector('[data-card="phone-numbers"]');
    const count = (k) => ag.$eval(`[data-card="${k}"] .text-\\[24px\\]`, (e) => e.innerText.trim());
    assert((await count("clients")) === "1", `clients count ${await count("clients")}`);
    assert((await count("phone-numbers")) === "1", `numbers count ${await count("phone-numbers")}`);
    const ok = await ag.$$eval('[data-list="health"] li', (ls) => ls.map((l) => l.dataset.ok).join(","));
    assert(ok === "true,true,true,true", `health rows: ${ok}`);
  });

  // ---- 4b. A US receptionist gets a US number ----
  await step("a US-time-zone receptionist buys a US number: country defaults to the US, texting note, no texts", async () => {
    const made = await apiFetch(ag, "POST", "/api/clients", { businessName: `Hudson Dental ${stamp}`, industry: "dental", receptionistName: "Grace", defaultVoice: true, timezone: "America/New_York", services: ["Check-up and clean"] });
    assert(made.status === 201, `POST /api/clients answered ${made.status} ${made.body?.error ?? ""}`);
    const usId = made.body.client.id;
    assert(made.body.client.settings.timezone === "America/New_York", `time zone saved as ${made.body.client.settings.timezone}`);
    assert(String(made.body.client.assistantId).startsWith("demo-"), `receptionist isn't a demo one: ${made.body.client.assistantId}`);
    // The API: US local by default, toll-free on request, no US "mobile"; Australia unchanged.
    const search = async (q) => (await apiFetch(ag, "GET", `/api/numbers/available?${q}`)).body?.numbers ?? [];
    const usLocal = await search("country=US&type=mobile");
    assert(usLocal.length && usLocal.every((n) => /^\+1[2-9]\d{9}$/.test(n.phoneNumber) && n.type === "local" && n.country === "US" && !n.sms), `US search: ${JSON.stringify(usLocal[0])}`);
    const tollFree = await search("country=US&type=toll_free");
    assert(tollFree.length && tollFree.every((n) => /^\+18[0-8]{2}/.test(n.phoneNumber) && n.type === "toll_free"), `toll-free search: ${JSON.stringify(tollFree[0])}`);
    const au = await search("type=mobile");
    assert(au.length && au.every((n) => /^\+614\d{8}$/.test(n.phoneNumber) && n.country === "AU"), `AU search: ${JSON.stringify(au[0])}`);
    for (const bad of ["+1212555010", "+11125550101", "+614800112"]) {
      const r = await apiFetch(ag, "POST", `/api/clients/${usId}/numbers`, { phoneNumber: bad, confirm: true });
      assert(r.status === 400, `buying ${bad} answered ${r.status}`);
    }
    // The page: the dialog starts on the United States.
    await ag.goto(`${B}/admin/clients/${usId}`, { waitUntil: "networkidle0" });
    await click(ag, '[data-action="buy-number"]');
    await ag.waitForSelector('[data-list="available-numbers"][data-country="US"] li button');
    const country = await ag.$eval('[data-field="number-country"]', (e) => e.innerText.trim());
    assert(country === "United States", `country picker shows ${country}`);
    const kind = await ag.$eval('[data-field="number-type"]', (e) => e.innerText.trim());
    assert(kind === "Local", `type picker shows ${kind}`);
    assert(await ag.$('[data-note="us-texting"]'), "no 10DLC texting note for US numbers");
    const pick = await ag.$eval('[data-list="available-numbers"] li:nth-child(1) button', (b) => {
      b.click();
      return { shown: b.querySelector("span").innerText.trim(), number: b.dataset.number };
    });
    assert(/^\(\d{3}\) \d{3}-\d{4}$/.test(pick.shown), `US number shown as ${pick.shown}`);
    await ag.waitForSelector('[data-action="confirm-buy-number"]:not([disabled])');
    await click(ag, '[data-action="confirm-buy-number"]');
    await ag.waitForSelector('[data-list="numbers"] li', { timeout: 20000 });
    const listed = await ag.$eval('[data-list="numbers"]', (e) => e.innerText);
    assert(listed.includes(pick.shown), `bought ${pick.shown}, page lists ${listed}`);
    assert(!listed.includes("texts"), `a US number shouldn't take texts yet: ${listed}`);
    const c = await apiFetch(ag, "GET", `/api/clients/${usId}`);
    assert((c.body?.client?.phoneNumbers ?? []).includes(pick.number), `stored numbers: ${JSON.stringify(c.body?.client?.phoneNumbers)}`);
    // An Australian receptionist still starts on Australia.
    await ag.goto(`${B}/admin/clients/${receptionistId}`, { waitUntil: "networkidle0" });
    await click(ag, '[data-action="buy-number"]');
    await ag.waitForSelector('[data-list="available-numbers"][data-country="AU"] li button');
    assert(!(await ag.$('[data-note="us-texting"]')), "texting note shown for Australia");
    const del = await apiFetch(ag, "DELETE", `/api/clients/${usId}`);
    assert(del.status < 300, `removing the US receptionist answered ${del.status}`);
  });

  // ---- 6. Booking with an email (before the permission checks disconnect the account) ----
  await step("booking through the hook with an email logs the staff notice and the caller's confirmation", async () => {
    const staff = `desk-${stamp}@brightsmile.test`;
    const caller = `pat-${stamp}@caller.test`;
    const set = await apiFetch(ag, "POST", `/api/clients/${receptionistId}/booking`, { provider: "builtin", minutes: 30, notifyEmail: staff });
    assert(set.status === 201, `calendar set-up answered ${set.status} ${set.body?.error ?? ""}`);
    const token = psql(`select data->'booking'->>'token' from clients where id = '${receptionistId}'`);
    assert(token.length > 10, "no booking token stored");
    const hook = async (action, body, key = token) => {
      const r = await fetch(`${B}/hooks/${receptionistId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Twin-Key": key }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const wrong = await hook("availability", { date: "2030-01-01" }, "not-the-key");
    assert(wrong.status === 404, `a wrong key answered ${wrong.status}`);
    let start = "";
    for (let i = 1; i <= 10 && !start; i++) {
      const date = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
      const a = await hook("availability", { date });
      start = a.body?.slots?.[0]?.start ?? "";
    }
    assert(start, "no free slot in the next ten days");
    const before = serverLog().length;
    const booking = { name: "Pat Caller", phone: "+61412000123", service: "Check-up and clean", start, email: caller };
    const first = await hook("book", booking);
    assert(first.body?.booked === true, `first booking: ${JSON.stringify(first.body)}`);
    const end = Date.now() + 10000;
    let log = "";
    while (Date.now() < end) {
      log = serverLog().slice(before);
      if (log.includes(`[mail not configured] To: ${staff}`) && log.includes(`[mail not configured] To: ${caller}`)) break;
      await sleep(250);
    }
    assert(log.includes(`[mail not configured] To: ${staff}`), "no staff notice in the server log");
    assert(log.includes(`[mail not configured] To: ${caller}`), "no caller confirmation in the server log");
    const again = await hook("book", { ...booking, name: "Second Caller", email: `second-${stamp}@caller.test` });
    assert(again.body?.booked === false && /no longer free/.test(again.body?.reason ?? ""), `same slot again: ${JSON.stringify(again.body)}`);
  });

  // ---- 5. Who may change the phone account ----
  const inviteLink = async (email, role) => {
    const r = await apiFetch(ag, "POST", "/api/team/invites", { email, role });
    assert(r.status === 201 && r.body?.url, `invite ${role}: ${r.status} ${r.body?.error ?? ""}`);
    return r.body.url;
  };
  const mb = await fresh();
  await step("agency member can see Connections but can't connect, replace or disconnect the key", async () => {
    await accept(mb, await inviteLink(member.email, "member"), "Mel Member", member.password);
    await waitPath(mb, /^\/admin/, 20000);
    const s = await apiFetch(mb, "GET", "/api/session");
    assert(s.body.role === "member", `role is ${s.body.role}`);
    await mb.goto(`${B}/admin/connections`, { waitUntil: "networkidle0" });
    await mb.waitForSelector('[data-card="phone-account"][data-mode="own"]');
    assert(!(await mb.$('[data-action="replace-key"]')), "member sees Replace key");
    assert(!(await mb.$('[data-action="disconnect"]')), "member sees Disconnect");
    for (const [m, u, b] of [["PUT", "/api/phone-account", { key: TEST_KEY }], ["POST", "/api/phone-account/test", { key: TEST_KEY }], ["DELETE", "/api/phone-account"]]) {
      const r = await apiFetch(mb, m, u, b);
      assert(r.status === 403, `${m} ${u} as member answered ${r.status}`);
    }
  });

  const ad = await fresh();
  await step("agency admin can replace the key but not disconnect it", async () => {
    await accept(ad, await inviteLink(admin.email, "admin"), "Adam Admin", admin.password);
    await waitPath(ad, /^\/admin/, 20000);
    await ad.goto(`${B}/admin/connections`, { waitUntil: "networkidle0" });
    await ad.waitForSelector('[data-card="phone-account"][data-mode="own"]');
    assert(await ad.$('[data-action="replace-key"]'), "admin doesn't see Replace key");
    assert(!(await ad.$('[data-action="disconnect"]')), "admin sees Disconnect");
    const put = await apiFetch(ad, "PUT", "/api/phone-account", { key: TEST_KEY });
    assert(put.status === 200 && put.body.mode === "own", `admin replace answered ${put.status} ${put.body?.error ?? ""}`);
    const del = await apiFetch(ad, "DELETE", "/api/phone-account");
    assert(del.status === 403 && /owner/i.test(del.body?.error ?? ""), `admin disconnect answered ${del.status} ${del.body?.error ?? ""}`);
  });

  const bz = await fresh();
  await step("a business (customer) login gets 403 from /api/phone-account and is sent from /setup to /app", async () => {
    await bz.goto(`${B}/signup?as=business`, { waitUntil: "networkidle0" });
    await type(bz, "#name", "Bea Business");
    await type(bz, "#email", `bea-${stamp}@biz.test`);
    await type(bz, "#password", "business-password-1");
    await type(bz, "#business", `Bea's Bakery ${stamp}`);
    await bz.click("#industry");
    await clickText(bz, '[role="option"]', "Trades");
    await type(bz, "#suburb", "Newtown");
    await clickText(bz, "button[type=submit]", "Create my receptionist");
    await waitPath(bz, /^\/app/, 20000);
    const s = await apiFetch(bz, "GET", "/api/session");
    assert(s.body.role === "customer", `role is ${s.body.role}`);
    for (const [m, u, b] of [["GET", "/api/phone-account"], ["PUT", "/api/phone-account", { key: TEST_KEY }], ["POST", "/api/phone-account/test", { key: TEST_KEY }], ["DELETE", "/api/phone-account"]]) {
      const r = await apiFetch(bz, m, u, b);
      assert(r.status === 403, `${m} ${u} as a business answered ${r.status}`);
    }
    await bz.goto(`${B}/setup`, { waitUntil: "networkidle0" });
    await waitPath(bz, /^\/app/);
  });

  await step("the owner disconnects from Connections and is sent back to /setup", async () => {
    await ag.goto(`${B}/admin/connections`, { waitUntil: "networkidle0" });
    await click(ag, '[data-action="disconnect"]');
    await click(ag, '[data-action="confirm-disconnect"]');
    await ag.waitForSelector('[data-card="phone-account"][data-mode="none"]', { timeout: 15000 });
    await ag.goto(`${B}/admin/clients`, { waitUntil: "networkidle0" });
    await waitPath(ag, "/setup");
    const r = await apiFetch(ag, "GET", "/api/phone-account");
    assert(r.body.mode === "none", `mode is ${r.body.mode}`);
  });

  // ---- 7. Product name ----
  await step("default server says Answered: title, sign-in screen; / is the marketing page", async () => {
    // With no PRODUCT_NAME the built page is served as it is: no product tag, and the
    // screens fall back to "Answered" (src/lib/app/product.ts).
    const html = await (await fetch(`${B}/login`)).text();
    assert(html.includes("<title>Answered") && !html.includes('<meta name="product"'), "served page isn't the plain Answered one");
    const p = await fresh();
    await p.goto(`${B}/login`, { waitUntil: "networkidle0" });
    await waitText(p, "Sign in to Answered");
    await waitText(p, "New to Answered?");
    const h = await head(p);
    assert(h.product === null && h.title.includes("Answered"), `head: ${JSON.stringify(h)}`);
    // The marketing page keeps animating, so the network never goes quiet: wait for its heading.
    await p.goto(`${B}/`, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => document.querySelector("h1")?.innerText.includes("Every call, answered."), { timeout: 20000 });
    await sleep(500);
    assert(path(p) === "/", `/ went to ${path(p)}`);
    assert((await head(p)).title.includes("Answered"), "marketing page title");
  });

  await step("PRODUCT_NAME=Chloe: title, meta tag and screens say Chloe, and / goes to /login", async () => {
    assert(startedSecond, `second server on ${PORT2} isn't running`);
    const html = await (await fetch(`${B2}/`)).text();
    assert(html.includes("<title>Chloe</title>") && html.includes('<meta name="product" content="Chloe"'), "served page isn't named Chloe");
    const p = await fresh();
    await p.goto(`${B2}/`, { waitUntil: "networkidle0" });
    await waitPath(p, "/login");
    await waitText(p, "Sign in to Chloe");
    await waitText(p, "New to Chloe?");
    const h = await head(p);
    assert(h.product === "Chloe" && h.title.includes("Chloe") && !h.title.includes("Answered"), `head: ${JSON.stringify(h)}`);
    const text = await p.evaluate(() => document.body.innerText);
    assert(!text.includes("Answered"), "the sign-in screen still says Answered");
    await p.goto(`${B2}/guide`, { waitUntil: "networkidle0" });
    await waitText(p, "Connect it to Chloe");
  });

  // ---- 8. Default phone mode ----
  await step("default server (no OWN_PHONE_ACCOUNT): a new agency goes straight to /admin", async () => {
    assert(startedSecond, `second server on ${PORT2} isn't running`);
    const p = await fresh();
    await signUpAgency(p, B2, { name: "Dana Default", email: `dana-${stamp}@default.test`, password: "default-password-1", agencyName: `Default Agency ${stamp}` });
    await waitPath(p, "/admin", 20000);
    await p.waitForSelector('[data-cta="first-receptionist"]');
    const acct = await apiFetch(p, "GET", "/api/phone-account");
    assert(acct.body.mode === "platform" && acct.body.required === false, `phone account ${JSON.stringify(acct.body)}`);
    await p.goto(`${B2}/setup`, { waitUntil: "networkidle0" });
    await waitPath(p, "/admin");
    const h = await head(p);
    assert(h.title.includes("Chloe"), `console title: ${h.title}`);
  });

  // ---- 10. SINGLE_AGENCY=1: one agency per server ----
  const solo = { name: "Olive Owner", email: `olive-${stamp}@solo.test`, password: "solo-owner-password-1", agencyName: `Solo Reception ${stamp}` };
  const so = await fresh();
  await step("SINGLE_AGENCY: the first account sets up the agency and lands on a plain agency console", async () => {
    assert(startedThird, `single-agency server on ${PORT3} isn't running`);
    await so.goto(`${B3}/signup`, { waitUntil: "networkidle0" });
    // Straight to the agency form: there's no "I run a business" choice here.
    await so.waitForSelector('[data-form="signup-agency"]');
    assert(!(await so.$('[data-choice="signup-business"]')), "business sign-up offered");
    await type(so, "#name", solo.name);
    await type(so, "#email", solo.email);
    await type(so, "#password", solo.password);
    await type(so, "#agency", solo.agencyName);
    await clickText(so, "button[type=submit]", "Create agency");
    await waitPath(so, "/admin", 20000);
    const s = (await apiFetch(so, "GET", "/api/session")).body;
    assert(s.user.platformAdmin === false && s.console === "agency" && s.role === "owner", `session: ${JSON.stringify({ pa: s.user.platformAdmin, console: s.console, role: s.role })}`);
    assert(s.singleAgency === true && s.serverSettings === true && s.telnyx === "platform", `session: ${JSON.stringify({ single: s.singleAgency, settings: s.serverSettings, telnyx: s.telnyx })}`);
    await so.waitForSelector('[data-console="agency"]');
    const nav = await navText(so);
    for (const want of ["Clients", "Phone Numbers", "Connections", "Settings"]) assert(nav.includes(want), `${want} missing from the menu`);
    for (const gone of ["Agencies", "Number Requests", "Test Lab"]) assert(!nav.includes(gone), `${gone} still in the menu`);
    const body = await so.evaluate(() => document.body.innerText);
    assert(!body.includes("Platform console") && !body.includes("Platform admin"), "the console still says Platform");
    assert(body.includes(solo.agencyName), "the console doesn't show the agency's name");
  });

  await step("SINGLE_AGENCY: platform pages and Setup send the owner back; platform APIs refuse", async () => {
    assert(startedThird, `single-agency server on ${PORT3} isn't running`);
    for (const p of ["/admin/agencies", "/admin/test-lab", "/admin/number-requests", "/setup"]) {
      await so.goto(`${B3}${p}`, { waitUntil: "networkidle0" });
      await waitPath(so, "/admin");
    }
    for (const [m, u] of [["GET", "/api/admin/agencies"], ["GET", "/api/admin/number-requests"], ["POST", "/api/admin/sandbox"]]) {
      const r = await apiFetch(so, m, u);
      assert(r.status === 403, `${m} ${u} answered ${r.status}`);
    }
    const acct = await apiFetch(so, "GET", "/api/phone-account");
    assert(acct.body.mode === "platform" && acct.body.installed === true && acct.body.required === false, `phone account ${JSON.stringify(acct.body)}`);
    const put = await apiFetch(so, "PUT", "/api/phone-account", { key: TEST_KEY });
    assert(put.status === 400 && /installed/.test(put.body?.error ?? ""), `replacing the key answered ${put.status} ${put.body?.error ?? ""}`);
    await so.goto(`${B3}/admin/connections`, { waitUntil: "networkidle0" });
    await so.waitForSelector('[data-card="phone-account"][data-mode="platform"]');
    const card = await so.$eval('[data-card="phone-account"]', (e) => e.innerText);
    assert(card.includes("Set at install"), `card says: ${card.replace(/\s+/g, " ").slice(0, 160)}`);
    assert(!(await so.$('[data-action="replace-key"]')) && !(await so.$('[data-action="disconnect"]')), "Replace key / Disconnect shown");
  });

  await step("SINGLE_AGENCY: the owner has Email and calendars; Google asks for calendar access only", async () => {
    assert(startedThird, `single-agency server on ${PORT3} isn't running`);
    await so.goto(`${B3}/admin/settings?tab=email`, { waitUntil: "networkidle0" });
    await so.waitForSelector('[data-section="email-calendars"] [data-card="google"] [data-list="scopes"] li');
    const scopes = await so.$$eval('[data-card="google"] [data-list="scopes"] li', (ls) => ls.map((l) => l.innerText.trim()));
    assert(JSON.stringify(scopes) === JSON.stringify(["openid", "email", "https://www.googleapis.com/auth/calendar.events"]), `Google scopes: ${scopes.join(" ")}`);
    assert(await so.$('[data-card="google"] [data-google-review="sensitive"]'), "Google card doesn't say calendar only");
    const tabs = await so.$$eval('[role="tab"]', (ts) => ts.map((t) => t.innerText.trim()));
    assert(!tabs.includes("Platform admins"), `tabs: ${tabs.join(", ")}`);
  });

  await step("SINGLE_AGENCY: the owner adds a client and buys its number directly (no request queue)", async () => {
    assert(startedThird, `single-agency server on ${PORT3} isn't running`);
    const made = await apiFetch(so, "POST", "/api/clients", { businessName: `Harbour Physio ${stamp}`, industry: "dental", receptionistName: "Grace", defaultVoice: true, timezone: "Australia/Sydney", services: ["Physio session"] });
    assert(made.status === 201, `POST /api/clients answered ${made.status} ${made.body?.error ?? ""}`);
    const id = made.body.client.id;
    assert(String(made.body.client.assistantId).startsWith("demo-"), `receptionist isn't a demo one: ${made.body.client.assistantId}`);
    await so.goto(`${B3}/admin/clients/${id}`, { waitUntil: "networkidle0" });
    await so.waitForSelector('[data-action="buy-number"]');
    assert(!(await so.$('[data-action="request-number"]')), "the request form is shown");
    await click(so, '[data-action="buy-number"]');
    await so.waitForSelector('[data-list="available-numbers"][data-country="AU"] li button');
    const picked = await so.$eval('[data-list="available-numbers"] li:nth-child(1) button', (b) => {
      b.click();
      return b.querySelector("span").innerText.trim();
    });
    await so.waitForSelector('[data-action="confirm-buy-number"]:not([disabled])');
    await click(so, '[data-action="confirm-buy-number"]');
    await so.waitForSelector('[data-list="numbers"] li', { timeout: 20000 });
    const listed = await so.$eval('[data-list="numbers"]', (e) => e.innerText);
    assert(listed.includes(picked), `bought ${picked}, page lists ${listed}`);
    await so.goto(`${B3}/admin/phone-numbers`, { waitUntil: "networkidle0" });
    await waitText(so, "Buy one from the client's page.");
  });

  await step("SINGLE_AGENCY: an invited admin gets the agency console but not the server settings", async () => {
    assert(startedThird, `single-agency server on ${PORT3} isn't running`);
    const inv = await apiFetch(so, "POST", "/api/team/invites", { email: `ari-${stamp}@solo.test`, role: "admin" });
    assert(inv.status === 201 && inv.body?.url, `invite: ${inv.status} ${inv.body?.error ?? ""}`);
    const p = await fresh();
    await accept(p, inv.body.url, "Ari Admin", "solo-admin-password-1");
    await waitPath(p, /^\/admin/, 20000);
    const s = (await apiFetch(p, "GET", "/api/session")).body;
    assert(s.console === "agency" && s.role === "admin" && s.serverSettings === false, `session: ${JSON.stringify({ console: s.console, role: s.role, settings: s.serverSettings })}`);
    const r = await apiFetch(p, "GET", "/api/admin/platform-settings");
    assert(r.status === 403, `platform settings as admin answered ${r.status}`);
    const search = await apiFetch(p, "GET", "/api/numbers/available?type=mobile");
    assert(search.status === 200 && search.body.numbers.length, `an agency admin can't search numbers: ${search.status}`);
  });

  await step("SINGLE_AGENCY: self-serve sign-up is off once the agency exists", async () => {
    assert(startedThird, `single-agency server on ${PORT3} isn't running`);
    const post = (u, b) => fetch(`${B3}${u}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.status);
    const who = { name: "Eve Extra", email: `eve-${stamp}@solo.test`, password: "another-password-1" };
    assert((await post("/api/signup/agency", { ...who, agencyName: "Second Agency" })) === 403, "agency sign-up still open");
    assert((await post("/api/signup/business", { ...who, businessName: "Eve's Cafe", industry: "Trades" })) === 403, "business sign-up still open");
    assert((await post("/api/signup", { ...who, orgName: "Another team" })) === 403, "ALLOW_SIGNUP still lets people in");
    const p = await fresh();
    await p.goto(`${B3}/signup`, { waitUntil: "networkidle0" });
    await p.waitForSelector('[data-signup="closed"]');
    await p.goto(`${B3}/login`, { waitUntil: "networkidle0" });
    await waitText(p, "Ask for an invite");
    assert(!(await p.$('a[href="/signup"]')), "the sign-in page still links to sign-up");
  });

  // ---- 9. The public guide ----
  await step("/guide opens signed out (and fits a phone)", async () => {
    const p = await fresh(390, 844);
    await p.goto(`${B}/guide`, { waitUntil: "networkidle0" });
    await waitPath(p, "/guide");
    await p.waitForSelector('[data-page="guide"] [data-step]');
    await waitText(p, "Telnyx");
    await noOverflow(p, "/guide");
    const s = await apiFetch(p, "GET", "/api/session");
    assert(s.body.signedIn === false, "the guide test wasn't signed out");
  });
} finally {
  await browser.close();
  if (startedSecond) for (const pid of listening(PORT2)) execSync(`kill ${pid}`);
  for (const pid of listening(PORT3)) execSync(`kill ${pid}`);
}

console.log(results.join("\n"));
if (pageErrors.length) console.log(`\nPage errors:\n  ${[...new Set(pageErrors)].join("\n  ")}`);
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
