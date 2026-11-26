// Browser test for the foundation of the Answered UI (sign-up, sign-in, guards,
// invite, reset, phone width). Run scripts/e2e/setup.sh first, then:
//   node scripts/e2e/foundation.mjs        (E2E_PORT / E2E_DIR as for setup.sh)
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const PORT = process.env.E2E_PORT || "8899";
const DIR = process.env.E2E_DIR || `/tmp/twin-e2e-${PORT}`;
const B = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/snap/bin/chromium";
const stamp = Date.now().toString(36);
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
  await page.type(sel, value);
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
// The business dashboard (/app): its tiles, next steps and recent calls.
async function waitDashboard(page) {
  await page.waitForSelector("[data-app-shell] .client-overview");
  for (const t of ["Answered calls", "Your next steps", "Recent calls"]) await waitText(page, t);
}
// A new demo receptionist's sample calls reach call_log on the next sync (server/callsync.ts,
// once a minute), so reload the dashboard until they show.
async function waitSampleCalls(page, ms = 90000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await page.$('.overview-calls ul[aria-label="Calls"] li')) return;
    if (Date.now() > end) throw new Error("no sample calls on the dashboard after 90s");
    await sleep(10000);
    await page.reload({ waitUntil: "networkidle0" });
    await waitDashboard(page);
  }
}
async function signOut(page) {
  await page.click('button[aria-label="Account menu"]');
  await clickText(page, '[role="menuitem"]', "Sign out");
  await waitPath(page, "/login");
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const fresh = async (width = 1280, height = 900) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  page.on("pageerror", (e) => results.push(`  page error on ${page.url()}: ${e.message.split("\n")[0]}`));
  return page;
};

const agency = { name: "Ann Agency", email: `ann-${stamp}@agency.test`, password: "agency-password-1", agencyName: `Brightline ${stamp}` };
const biz = { name: "Bob Business", email: `bob-${stamp}@biz.test`, password: "business-password-1", businessName: `Bob's Plumbing ${stamp}` };

try {
  // ---- Signed out ----
  await step("signed out: /app sends to /login", async () => {
    const page = await fresh();
    await page.goto(`${B}/app`, { waitUntil: "networkidle0" });
    await waitPath(page, "/login");
    assert(page.url().includes("redirect="), "no redirect parameter");
    await waitText(page, "Sign in to Answered");
  });

  await step("phone width: /login and /signup have no horizontal overflow at 390px", async () => {
    const page = await fresh(390, 844);
    await page.goto(`${B}/login`, { waitUntil: "networkidle0" });
    await waitText(page, "Sign in to Answered");
    await noOverflow(page, "/login");
    await page.goto(`${B}/signup`, { waitUntil: "networkidle0" });
    await waitText(page, "I run a business");
    await noOverflow(page, "/signup");
    await page.click('[data-choice="signup-business"]');
    await page.waitForSelector("#business");
    await noOverflow(page, "/signup (business form)");
  });

  // ---- Agency sign-up ----
  const ag = await fresh();
  await step("agency sign-up lands on /admin with a create-first-receptionist call to action", async () => {
    await ag.goto(`${B}/signup`, { waitUntil: "networkidle0" });
    await ag.click('[data-choice="signup-agency"]');
    await type(ag, "#name", agency.name);
    await type(ag, "#email", agency.email);
    await type(ag, "#password", agency.password);
    await type(ag, "#agency", agency.agencyName);
    await clickText(ag, "button[type=submit]", "Create agency");
    await waitPath(ag, "/admin");
    await ag.waitForSelector('[data-cta="first-receptionist"]');
    await ag.waitForSelector('[data-console="agency"]');
  });

  await step("agency creates its first receptionist from the call to action", async () => {
    // The call to action opens the new-receptionist wizard: business, hours, voice, review.
    await ag.click('[data-cta="first-receptionist"]');
    await waitPath(ag, "/admin/clients/new");
    await type(ag, "#w-name", "Agency Client Dental");
    await clickText(ag, '[role="radio"]', "Dental clinic");
    await clickText(ag, '[data-action="continue"]', "Continue");
    await ag.waitForSelector('[data-step="1"]');
    await clickText(ag, '[data-action="continue"]', "Continue");
    await ag.waitForSelector('[data-step="2"]');
    // The first voice is picked for you once the list has loaded.
    await ag.waitForSelector('[aria-labelledby="w-voice"] [role="radio"][aria-checked="true"]');
    await clickText(ag, '[data-action="continue"]', "Continue");
    await ag.waitForSelector("[data-review]");
    await clickText(ag, '[data-action="create-receptionist"]', "Create receptionist");
    // It lands on the new client's page, with its receptionist listed.
    await waitPath(ag, /^\/admin\/clients\/[a-f0-9-]{36}$/, 30000);
    await ag.waitForSelector('[data-page="admin-client"] [data-receptionist]', { timeout: 15000 });
    await waitText(ag, "Agency Client Dental");
  });

  await step("agency cannot open platform-only pages", async () => {
    for (const p of ["/admin/agencies", "/admin/test-lab"]) {
      await ag.goto(`${B}${p}`, { waitUntil: "networkidle0" });
      await waitPath(ag, "/admin");
    }
    const nav = await ag.evaluate(() => document.querySelector('nav[aria-label="Primary"]').innerText);
    assert(!nav.includes("Agencies") && !nav.includes("Test Lab"), "platform-only items in the agency's nav");
    for (const u of ["/api/admin/agencies", "/api/admin/number-requests"]) {
      const r = await apiFetch(ag, "GET", u);
      assert(r.status === 403, `GET ${u} answered ${r.status}`);
    }
  });

  await step("agency's Number Requests page is its own list, not the platform's queue", async () => {
    // Number Requests is open to agencies on the platform's phone account: they ask
    // for a number there and the platform team buys it.
    await ag.goto(`${B}/admin/number-requests`, { waitUntil: "networkidle0" });
    await waitPath(ag, "/admin/number-requests");
    await ag.waitForSelector('[data-page="admin-number-requests"]');
    await waitText(ag, "Request a number");
    await waitText(ag, "Your requests");
    const text = await ag.$eval('[data-page="admin-number-requests"]', (e) => e.innerText);
    assert(!/Platform console|Agencies ask for numbers/i.test(text), "the platform's queue is showing to an agency");
    const nav = await ag.evaluate(() => document.querySelector('nav[aria-label="Primary"]').innerText);
    assert(nav.includes("Number Requests"), "Number Requests is missing from the agency's nav");
  });

  await step("agency is sent from /app to /admin", async () => {
    await ag.goto(`${B}/app`, { waitUntil: "networkidle0" });
    await waitPath(ag, "/admin");
  });

  await step("phone width: /admin has no horizontal overflow at 390px", async () => {
    await ag.setViewport({ width: 390, height: 844 });
    await ag.goto(`${B}/admin`, { waitUntil: "networkidle0" });
    await ag.waitForSelector('[data-page="admin-overview"]');
    await noOverflow(ag, "/admin");
    await ag.setViewport({ width: 1280, height: 900 });
  });

  await step("sign out, then sign in again as the agency", async () => {
    await ag.goto(`${B}/admin`, { waitUntil: "networkidle0" });
    await signOut(ag);
    await ag.goto(`${B}/admin`, { waitUntil: "networkidle0" });
    await waitPath(ag, "/login");
    await type(ag, "#email", agency.email);
    await type(ag, "#password", "wrong-password-x");
    await clickText(ag, "button[type=submit]", "Sign in");
    await waitText(ag, "don't match");
    await type(ag, "#password", agency.password);
    await clickText(ag, "button[type=submit]", "Sign in");
    await waitPath(ag, "/admin");
  });

  // ---- Business sign-up ----
  const bz = await fresh();
  await step("business sign-up lands on /app with its receptionist's data", async () => {
    await bz.goto(`${B}/signup?as=business`, { waitUntil: "networkidle0" });
    await type(bz, "#name", biz.name);
    await type(bz, "#email", biz.email);
    await type(bz, "#password", biz.password);
    await type(bz, "#business", biz.businessName);
    await bz.click("#industry");
    await clickText(bz, '[role="option"]', "Trades");
    await type(bz, "#suburb", "Newtown");
    await clickText(bz, "button[type=submit]", "Create my receptionist");
    // A new business starts in the onboarding wizard (area S); put it off for now.
    await waitPath(bz, "/app/onboarding", 20000);
    await bz.waitForSelector('[data-action="later"]');
    await bz.$eval('[data-action="later"]', (b) => b.click());
    await waitPath(bz, "/app", 20000);
    await waitDashboard(bz);
    await waitText(bz, biz.businessName);
    // The demo receptionist (fake provider key locally) has five sample calls.
    await waitSampleCalls(bz);
    const s = await apiFetch(bz, "GET", "/api/session");
    assert(s.body.role === "customer" && s.body.access[0]?.role === "manager", "not a customer manager");
  });

  await step("business user cannot open /admin or the console API", async () => {
    await bz.goto(`${B}/admin`, { waitUntil: "networkidle0" });
    await waitPath(bz, "/app");
    await bz.goto(`${B}/admin/agencies`, { waitUntil: "networkidle0" });
    await waitPath(bz, "/app");
    const r = await apiFetch(bz, "GET", "/api/console/anything");
    assert(r.status === 403, `console API answered ${r.status}`);
    const other = await apiFetch(bz, "GET", `/api/workspace/${readFileSync(`${DIR}/clientid`, "utf8").trim()}/calls`);
    assert(other.status === 404, `another business answered ${other.status}`);
  });

  await step("phone width: /app has no horizontal overflow at 390px", async () => {
    await bz.setViewport({ width: 390, height: 844 });
    await bz.goto(`${B}/app`, { waitUntil: "networkidle0" });
    await waitDashboard(bz);
    await waitSampleCalls(bz);
    await noOverflow(bz, "/app");
    await bz.goto(`${B}/app/calls`, { waitUntil: "networkidle0" });
    await bz.waitForSelector('[data-placeholder], main');
    await noOverflow(bz, "/app/calls");
    await bz.setViewport({ width: 1280, height: 900 });
  });

  // ---- Password reset ----
  await step("reset: invalid link page renders", async () => {
    const page = await fresh();
    await page.goto(`${B}/reset-password`, { waitUntil: "networkidle0" });
    await waitText(page, "invalid or has expired");
  });

  await step("reset: forgot password email link sets a new password and signs in", async () => {
    const page = await fresh();
    await page.goto(`${B}/login?mode=forgot`, { waitUntil: "networkidle0" });
    await type(page, "#email", biz.email);
    await clickText(page, "button[type=submit]", "Send reset link");
    await waitText(page, "Reset link sent");
    await sleep(500);
    const log = readFileSync(`${DIR}/server.log`, "utf8");
    const links = [...log.matchAll(/\/reset\/([A-Za-z0-9_-]{20,100})/g)];
    assert(links.length, "no reset link in the server log");
    await page.goto(`${B}/reset/${links.at(-1)[1]}`, { waitUntil: "networkidle0" });
    await type(page, "#pw", "business-password-2");
    await type(page, "#pw2", "business-password-2");
    await clickText(page, "button[type=submit]", "Update password");
    await waitPath(page, "/app", 15000);
    biz.password = "business-password-2";
  });

  // ---- Invite ----
  await step("invite: an agency's customer accepts and lands on /app, view-only", async () => {
    const owner = await fresh();
    await signIn(owner, "a@a.test", "password-for-agency-a");
    await waitPath(owner, "/admin");
    const cl = readFileSync(`${DIR}/clientid`, "utf8").trim();
    const email = `carol-${stamp}@customer.test`;
    const r = await apiFetch(owner, "POST", `/api/clients/${cl}/customers`, { email });
    assert(r.status === 201 && r.body.url, `invite answered ${r.status}`);
    const page = await fresh();
    await page.goto(r.body.url.replace(/^https?:\/\/[^/]+/, B), { waitUntil: "networkidle0" });
    await waitText(page, "Alpha Plumbing");
    await type(page, "#name", "Carol Customer");
    await type(page, "#password", "customer-password-1");
    await clickText(page, "button[type=submit]", "Accept invite");
    await waitPath(page, "/app", 15000);
    await waitText(page, "View-only access");
    await page.goto(`${B}/admin`, { waitUntil: "networkidle0" });
    await waitPath(page, "/app");
    const w = await apiFetch(page, "POST", `/api/manage/${cl}/anything`, {});
    assert(w.status === 403, `viewer write answered ${w.status}`);
  });

  await step("connect link: the business's mailbox page renders without signing in", async () => {
    const owner = await fresh();
    await signIn(owner, "a@a.test", "password-for-agency-a");
    await waitPath(owner, "/admin");
    const cl = readFileSync(`${DIR}/clientid`, "utf8").trim();
    const r = await apiFetch(owner, "POST", `/api/clients/${cl}/connect-link`);
    assert(r.status === 200 && r.body.url, `connect link answered ${r.status}`);
    const page = await fresh(390, 844);
    await page.goto(r.body.url.replace(/^https?:\/\/[^/]+/, B), { waitUntil: "networkidle0" });
    await waitText(page, "Connect your email");
    await waitText(page, "Alpha Plumbing");
    await clickText(page, '[role="radio"]', "Something else");
    await page.waitForSelector("#cx-address");
    await noOverflow(page, "/connect");
  });

  // ---- Platform admin ----
  await step("platform admin: /admin with the platform console, agencies listed, View as a business", async () => {
    const page = await fresh();
    await signIn(page, "ronan@test.dev", "correct-horse-battery");
    await waitPath(page, "/admin");
    await page.waitForSelector('[data-console="platform"]');
    await page.waitForSelector('[data-list="agencies"]');
    await waitText(page, agency.agencyName);
    await page.goto(`${B}/admin/agencies`, { waitUntil: "networkidle0" });
    await waitPath(page, "/admin/agencies");
    await page.goto(`${B}/app`, { waitUntil: "networkidle0" });
    await waitPath(page, "/admin");
    const agencies = (await apiFetch(page, "GET", "/api/admin/agencies")).body.agencies;
    const a = agencies.find((x) => x.name === "Agency A");
    const cl = readFileSync(`${DIR}/clientid`, "utf8").trim();
    const v = await apiFetch(page, "POST", "/api/admin/view-as", { orgId: a.id, clientId: cl });
    assert(v.status === 200, `view-as answered ${v.status}`);
    await page.goto(`${B}/app`, { waitUntil: "networkidle0" });
    await waitPath(page, "/app");
    await waitText(page, "Staff view");
    await clickText(page, "button", "Exit view");
    await waitPath(page, "/admin");
  });
} finally {
  await browser.close();
}

console.log(results.join("\n"));
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
