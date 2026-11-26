// Browser test for the console (area C): platform admin and agencies.
// Run scripts/e2e/setup.sh first (E2E_PORT / E2E_DIR as there), then:
//   node scripts/e2e/c-console.mjs
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
async function signIn(page, email, password) {
  await page.goto(`${B}/login`, { waitUntil: "networkidle0" });
  await type(page, "#email", email);
  await type(page, "#password", password);
  await clickText(page, "button[type=submit]", "Sign in");
}
async function accept(page, url, name, password) {
  await page.goto(url, { waitUntil: "networkidle0" });
  await type(page, "#name", name);
  await type(page, "#password", password);
  await clickText(page, "button[type=submit]", "Accept invite");
}
const linkValue = (page, sel = "[data-invite-link]") => page.$eval(sel, (e) => e.value);
async function setColour(page, key, value) {
  await page.evaluate(
    (k, v) => {
      const el = [...document.querySelectorAll(`input[data-colour="${k}"]`)].find((e) => e.offsetParent !== null);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    key,
    value,
  );
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const fresh = async (width = 1280, height = 900) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message.split("\n")[0]}`));
  return page;
};

const alphaId = readFileSync(`${DIR}/clientid`, "utf8").trim();
const agencyName = `Northside Digital ${stamp}`;
const owner = { email: `nora-${stamp}@northside.test`, password: "northside-password-1" };
const business = `Harbour Physio ${stamp}`;
const customer = { email: `cara-${stamp}@harbour.test`, password: "customer-password-1" };
let agencyInvite = "";
let companyPath = "";
let customerInvite = "";

try {
  const pa = await fresh();
  await step("platform admin signs in to the platform console", async () => {
    await signIn(pa, "ronan@test.dev", "correct-horse-battery");
    await waitPath(pa, /^\/admin/);
    await pa.waitForSelector('[data-console="platform"]');
  });

  await step("platform invites an agency and gets a link to copy", async () => {
    await pa.goto(`${B}/admin/agencies`, { waitUntil: "networkidle0" });
    await click(pa, '[data-action="new-agency"]');
    await type(pa, "#ag-name", agencyName);
    await type(pa, "#ag-email", owner.email);
    await click(pa, '[data-action="create-agency"]');
    await pa.waitForSelector("[data-agency-invite] [data-invite-link]");
    agencyInvite = await linkValue(pa, "[data-agency-invite] [data-invite-link]");
    assert(agencyInvite.includes("/invite/"), `no invite link: ${agencyInvite}`);
    await pa.waitForSelector(`[data-agency="${agencyName}"] [data-flow]`);
  });

  const ag = await fresh();
  await step("agency owner accepts and lands on the agency console", async () => {
    await accept(ag, agencyInvite, "Nora Owner", owner.password);
    await waitPath(ag, /^\/admin/);
    await ag.waitForSelector('[data-console="agency"]');
  });

  await step("agency can't open platform pages (UI and API)", async () => {
    for (const p of ["/admin/agencies", "/admin/test-lab"]) {
      await ag.goto(`${B}${p}`, { waitUntil: "networkidle0" });
      await waitPath(ag, "/admin");
    }
    for (const [m, u] of [["GET", "/api/admin/agencies"], ["GET", "/api/admin/number-requests"], ["POST", "/api/admin/sandbox"], ["GET", "/api/console/platform-admins"]]) {
      const r = await apiFetch(ag, m, u);
      assert(r.status === 403, `${m} ${u} gave ${r.status}`);
    }
    const nav = await ag.$$eval("aside a", (as) => as.map((a) => a.textContent.trim()));
    assert(!nav.some((t) => /Agencies|Test Lab/.test(t)), `platform items in agency nav: ${nav}`);
  });

  await step("agencies are isolated from each other", async () => {
    const list = await apiFetch(ag, "GET", "/api/console/companies");
    assert(list.status === 200 && !JSON.stringify(list.body).includes("Alpha Plumbing"), "sees another agency's client");
    for (const u of [`/api/console/companies/${alphaId}`, `/api/console/businesses/${alphaId}`, `/api/workspace/${alphaId}/calls`]) {
      const r = await apiFetch(ag, "GET", u);
      assert(r.status === 404 || r.status === 403, `${u} gave ${r.status}`);
    }
    const write = await apiFetch(ag, "PUT", `/api/console/companies/${alphaId}/brand`, { primary: "#000000" });
    assert(write.status === 404, `brand write on other agency gave ${write.status}`);
  });

  await step("agency creates a receptionist with the wizard (new client)", async () => {
    await ag.goto(`${B}/admin/clients`, { waitUntil: "networkidle0" });
    await click(ag, '[data-action="new-receptionist"]');
    await waitPath(ag, "/admin/clients/new");
    await type(ag, "#w-name", business);
    await clickText(ag, '[role="radio"]', "Clinic or allied health");
    await click(ag, '[data-action="continue"]');
    await ag.waitForSelector('[data-step="1"]');
    await click(ag, '[data-action="continue"]');
    await ag.waitForSelector('[data-step="2"]'); // How it handles calls
    await click(ag, '[data-action="continue"]');
    await ag.waitForSelector('[data-step="3"]');
    await sleep(500);
    await click(ag, '[data-action="continue"]');
    await ag.waitForSelector('[data-step="4"]');
    await click(ag, '[data-action="continue"]');
    await ag.waitForSelector("[data-review]");
    await click(ag, '[data-action="create-receptionist"]');
    await ag.waitForSelector("[data-company]", { timeout: 30000 });
    companyPath = path(ag);
    await waitText(ag, business);
    await ag.waitForSelector('[data-list="automations"] [data-automation-row="voice"]');
  });

  await step("client list shows the company with its automations", async () => {
    await ag.goto(`${B}/admin/clients`, { waitUntil: "networkidle0" });
    await waitText(ag, business);
    await ag.waitForSelector('[data-automation="voice"][data-status="live"]');
  });

  await step("agency brands the client (colours, live preview)", async () => {
    await ag.goto(`${B}${companyPath}`, { waitUntil: "networkidle0" });
    await ag.waitForSelector("[data-brand-editor]");
    await setColour(ag, "primaryColor", "#0f766e");
    await setColour(ag, "sidebarColor", "#0b3b36");
    const preview = await ag.$eval("[data-brand-preview]", (e) => e.style.getPropertyValue("--primary"));
    assert(preview === "#0f766e", `preview --primary is ${preview}`);
    await click(ag, '[data-action="save-colours"]');
    await waitText(ag, "Colours saved");
  });

  await step("agency invites a customer (manager) and gets a link", async () => {
    await type(ag, "#share-email", customer.email);
    await click(ag, '[data-action="share"]');
    await ag.waitForSelector("[data-share-link] [data-invite-link]");
    customerInvite = await linkValue(ag, "[data-share-link] [data-invite-link]");
    assert(customerInvite.includes("/invite/"), "no invite link");
    await ag.waitForSelector(`[data-invite="${customer.email}"]`);
  });

  const cu = await fresh();
  await step("customer accepts, lands on /app as a manager with the client's branding", async () => {
    await accept(cu, customerInvite, "Cara Customer", customer.password);
    await waitPath(cu, /^\/app/);
    await waitText(cu, business);
    await cu.waitForFunction(() => document.documentElement.style.getPropertyValue("--primary") === "#0f766e", { timeout: 8000 }).catch(() => {});
    const primary = await cu.evaluate(() => document.documentElement.style.getPropertyValue("--primary"));
    assert(primary === "#0f766e", `--primary on /app is ${primary}`);
    const sess = await apiFetch(cu, "GET", "/api/session");
    assert(sess.body.access?.[0]?.role === "manager", `access ${JSON.stringify(sess.body.access)}`);
    const sidebar = await cu.$eval("[data-app-shell] aside", (e) => getComputedStyle(e).backgroundColor);
    assert(sidebar === "rgb(11, 59, 54)", `sidebar ${sidebar}`);
    const admin = await apiFetch(cu, "GET", "/api/console/companies");
    assert(admin.status === 403, `customer reached the console: ${admin.status}`);
  });

  await step("agency: See what the client sees (read only), then Exit view", async () => {
    await ag.goto(`${B}${companyPath}`, { waitUntil: "networkidle0" });
    await waitText(ag, "Cara Customer");
    await click(ag, '[data-action="view-as-customer"]');
    await waitPath(ag, /^\/app/);
    await waitText(ag, "their agency");
    const write = await apiFetch(ag, "PUT", `/api/console/companies/${companyPath.split("/").pop()}`, { name: "x" });
    assert(write.status === 403, `console write while viewing gave ${write.status}`);
    await clickText(ag, "button", "Exit view");
    await waitPath(ag, "/admin");
    await ag.waitForSelector('[data-console="agency"]');
  });

  await step("agency sends an onboarding link for a new client; list says waiting", async () => {
    await ag.goto(`${B}/admin/clients`, { waitUntil: "networkidle0" });
    await click(ag, '[data-action="add-client"]');
    await click(ag, '[data-mode="link"]');
    await type(ag, "#co-name", `Seaside Cafe ${stamp}`);
    await type(ag, "#co-email", `sam-${stamp}@seaside.test`);
    await click(ag, '[data-action="create-client"]');
    await ag.waitForSelector("[data-onboarding-sent] [data-invite-link]", { timeout: 30000 });
    const url = await linkValue(ag, "[data-onboarding-sent] [data-invite-link]");
    assert(url.includes("/invite/"), "no onboarding link");
    await clickText(ag, "button", "Done");
    await ag.waitForSelector('[data-onboarding="pending"]');
    const s = await fresh();
    await accept(s, url, "Sam Seaside", "seaside-password-1");
    await waitPath(s, /^\/app/);
    const sess = await apiFetch(s, "GET", "/api/session");
    assert(sess.body.access?.[0]?.role === "manager", "onboarding invite is not a manager");
    await s.browserContext().close();
  });

  await step("agency requests a number; the platform declines it", async () => {
    await ag.goto(`${B}${companyPath}`, { waitUntil: "networkidle0" });
    await click(ag, '[data-action="request-number"]');
    await waitText(ag, "Number requested");
    await pa.goto(`${B}/admin/number-requests`, { waitUntil: "networkidle0" });
    await waitText(pa, business);
    await pa.evaluate((b) => {
      const li = [...document.querySelectorAll("[data-request]")].find((e) => e.textContent.includes(b));
      li.querySelector('[data-action="decline"]').click();
    }, business);
    await type(pa, "#decline-reason", "No numbers this week");
    await click(pa, '[data-action="confirm-decline"]');
    await sleep(800);
    await ag.goto(`${B}${companyPath}`, { waitUntil: "networkidle0" });
    await waitText(ag, "No numbers this week");
  });

  await step("platform sees every agency's clients and can View as a customer", async () => {
    await pa.goto(`${B}/admin/clients`, { waitUntil: "networkidle0" });
    await waitText(pa, business);
    await waitText(pa, "Alpha Plumbing");
    await pa.goto(`${B}${companyPath}`, { waitUntil: "networkidle0" });
    await click(pa, '[data-action="view-as-customer"]');
    await waitPath(pa, /^\/app/);
    await waitText(pa, "the platform team");
    await clickText(pa, "button", "Exit view");
    await waitPath(pa, "/admin");
  });

  await step("platform: View as an agency, then exit", async () => {
    await pa.goto(`${B}/admin/agencies`, { waitUntil: "networkidle0" });
    await pa.evaluate((n) => [...document.querySelectorAll("[data-agency]")].find((e) => e.dataset.agency === n).querySelector('[data-action="view-as"]').click(), agencyName);
    await pa.waitForSelector('[data-console="agency"]');
    await waitText(pa, "Read only");
    await clickText(pa, "button", "Exit view");
    await pa.waitForSelector('[data-console="platform"]');
  });

  await step("test lab: create, test logins shown once, reset", async () => {
    await pa.goto(`${B}/admin/test-lab`, { waitUntil: "networkidle0" });
    await click(pa, '[data-action="create-sandbox"]');
    await pa.waitForSelector('[data-action="view-sandbox"]');
    await click(pa, '[data-action="test-logins"]');
    await pa.waitForSelector("[data-test-logins] [data-login]");
    const n = await pa.$$eval("[data-test-logins] [data-login]", (e) => e.length);
    assert(n === 2, `${n} test logins`);
    await click(pa, '[data-action="reset-sandbox"]');
    await click(pa, '[data-action="confirm-reset-sandbox"]');
    await pa.waitForSelector('[data-action="create-sandbox"]');
  });

  await step("no horizontal overflow at 1280 and 390", async () => {
    for (const [w, h] of [[1280, 900], [390, 844]]) {
      await ag.setViewport({ width: w, height: h });
      await pa.setViewport({ width: w, height: h });
      for (const p of ["/admin", "/admin/clients", companyPath, "/admin/clients/new", "/admin/calls", "/admin/receptionists", "/admin/usage", "/admin/settings", "/admin/system", "/admin/audit"]) {
        await ag.goto(`${B}${p}`, { waitUntil: "networkidle0" });
        await sleep(200);
        await noOverflow(ag, `agency ${p} @${w}`);
      }
      for (const p of ["/admin/agencies", "/admin/test-lab", "/admin/number-requests", "/admin/clients"]) {
        await pa.goto(`${B}${p}`, { waitUntil: "networkidle0" });
        await sleep(200);
        await noOverflow(pa, `platform ${p} @${w}`);
      }
      await cu.setViewport({ width: w, height: h });
      await cu.goto(`${B}/app`, { waitUntil: "networkidle0" });
      await noOverflow(cu, `customer /app @${w}`);
    }
  });

  await step("no page errors", async () => {
    assert(pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  });
} finally {
  await browser.close();
  console.log(results.join("\n"));
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exitCode = failed ? 1 : 0;
}
