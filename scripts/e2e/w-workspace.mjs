// Browser test for area W (workspace read: dashboard, calls, bookings, follow-ups,
// reports). Run scripts/e2e/w-setup.sh first (it seeds calls, bookings and follow-ups), then:
//   node scripts/e2e/w-workspace.mjs      (E2E_PORT / E2E_DIR as for w-setup.sh)
// Checks each page at 1280 and 390 wide: renders with data, filters and the date range
// work, the call drawer shows the transcript, a manager's stage change persists, a viewer
// can't change anything, another agency can't see the business, no horizontal overflow,
// no page errors.
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const PORT = process.env.E2E_PORT || "8901";
const DIR = process.env.E2E_DIR || "/tmp/twin-e2e-w";
const B = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/snap/bin/chromium";
const CL = readFileSync(`${DIR}/clientid`, "utf8").trim();
const results = [];
let failed = 0;

async function step(name, fn) {
  try {
    await fn();
    results.push(`PASS ${name}`);
  } catch (err) {
    failed++;
    results.push(`FAIL ${name}: ${String(err.message).split("\n")[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitText(page, text, ms = 10000) {
  await page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout: ms }, text);
}
async function waitNoText(page, text, ms = 10000) {
  await page.waitForFunction((t) => !document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout: ms }, text);
}
async function type(page, sel, value) {
  await page.waitForSelector(sel, { visible: true });
  await page.click(sel, { count: 3 });
  await page.type(sel, value);
}
async function clearAndType(page, sel, value) {
  await page.waitForSelector(sel, { visible: true });
  await page.$eval(sel, (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (value) await page.type(sel, value);
}
/** Click the first visible element matching selector whose text includes text. */
async function clickText(page, selector, text, ms = 10000) {
  const find = (s, t) =>
    [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t) && !e.disabled && (e.offsetWidth > 0 || e.offsetHeight > 0));
  await page.waitForFunction((s, t, f) => !!new Function("s", "t", `return (${f})(s, t)`)(s, t), { timeout: ms }, selector, text, find.toString());
  await page.evaluate((s, t, f) => new Function("s", "t", `return (${f})(s, t)`)(s, t).click(), selector, text, find.toString());
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
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 10000 });
}
/** The "N calls" counter on the calls page. */
async function callCount(page) {
  await page.waitForFunction(() => /\b\d+ calls\b/.test(document.querySelector("[aria-live=polite]")?.textContent ?? ""), { timeout: 10000 });
  return page.evaluate(() => Number(document.querySelector("[aria-live=polite]").textContent.match(/(\d+) calls/)[1]));
}
async function waitCallCount(page, n, ms = 10000) {
  await page.waitForFunction((want) => (document.querySelector("[aria-live=polite]")?.textContent ?? "").includes(`${want} calls`), { timeout: ms }, n);
}
async function setRange(page, label) {
  // Each preset has a short (phone) and long label; click whichever button holds it.
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('[role=radiogroup][aria-label="Date range"] [role=radio]')].find((b) => [...b.querySelectorAll("span")].some((s) => s.textContent === l));
    btn.click();
  }, label);
}
/** Click an Export button and return the CSV text it would download. */
async function exportCsv(page) {
  await page.evaluate(() => {
    window.__csv = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      b.text().then((t) => (window.__csv = t));
      return orig(b);
    };
    HTMLAnchorElement.prototype.click = function () {}; // no real download
  });
  await clickText(page, "button", "Export");
  await page.waitForFunction(() => typeof window.__csv === "string", { timeout: 5000 });
  return page.evaluate(() => window.__csv);
}
async function closeSheet(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("[role=dialog]"), { timeout: 5000 });
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const errors = [];

async function newUser(width) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height: 900 });
  page.on("pageerror", (e) => errors.push(`[${width}] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`[${width}] console: ${m.text()}`);
  });
  return { ctx, page };
}

const W = (p) => `/api/workspace/${CL}${p}`;

for (const width of [1280, 390]) {
  const tag = `${width}px`;
  const { ctx, page } = await newUser(width);
  let api = null;

  await step(`${tag} manager signs in and lands on the dashboard with data`, async () => {
    await signIn(page, "manager@alpha.test", "password-for-manager");
    await page.goto(`${B}/app`, { waitUntil: "networkidle0" });
    await waitText(page, "Answered calls");
    await waitText(page, "Recent calls");
    await waitText(page, "Isabella Rossi");
    await waitText(page, "Coming up");
    await waitText(page, "Grace Lee");
    await waitText(page, "Your next steps");
    await page.waitForFunction(() => /Isabella Rossi/.test(document.getElementById("dashboard-attention")?.innerText ?? ""), { timeout: 10000 });
    await noOverflow(page, `${tag} dashboard`);
    const now = new Date();
    const from = new Date(now.getTime() - 120 * 86_400_000).toISOString();
    api = {
      calls: (await apiFetch(page, "GET", W(`/calls?from=${from}&to=${now.toISOString()}`))).body.calls,
      leads: (await apiFetch(page, "GET", W("/follow-ups"))).body.leads,
      appts: (await apiFetch(page, "GET", W("/bookings"))).body.appointments,
    };
    assert(api.calls.length === 6, `expected 6 seeded calls (web call hidden), got ${api.calls.length}`);
  });

  await step(`${tag} calls page: list, date range, search and after-hours filter`, async () => {
    await page.goto(`${B}/app/calls`, { waitUntil: "networkidle0" });
    await setRange(page, width < 640 ? "30d" : "Last 30 days");
    const in30 = api.calls.filter((c) => Date.parse(c.started_at) > Date.now() - 29 * 86_400_000).length;
    await waitCallCount(page, in30);
    await setRange(page, width < 640 ? "7d" : "Last 7 days");
    const in7 = api.calls.filter((c) => Date.parse(c.started_at) > Date.now() - 6 * 86_400_000).length;
    await waitCallCount(page, in7);
    assert(in7 < in30, "the 7 day range should show fewer calls than 30 days");
    await setRange(page, width < 640 ? "90d" : "Last 90 days");
    await waitCallCount(page, api.calls.length);
    await type(page, 'input[aria-label="Search calls"]', "Isabella");
    await waitCallCount(page, 1);
    await clearAndType(page, 'input[aria-label="Search calls"]', "");
    await waitCallCount(page, api.calls.length);
    await clickText(page, "button", "Filters");
    await clickText(page, "button", "After hours");
    await waitCallCount(page, api.calls.filter((c) => c.after_hours).length);
    await clickText(page, "button", "Clear");
    await waitCallCount(page, api.calls.length);
    await noOverflow(page, `${tag} calls`);
    const csv = await exportCsv(page);
    const rows = csv.trim().split("\n");
    assert(rows[0].startsWith("Started,"), "calls CSV has no header");
    assert(rows.length === api.calls.length + 1, `calls CSV has ${rows.length - 1} rows`);
    assert(csv.includes("Isabella Rossi"), "calls CSV is missing a caller");
    await page.reload({ waitUntil: "networkidle0" });
  });

  await step(`${tag} call drawer opens with summary and transcript`, async () => {
    await clickText(page, 'ul[aria-label="Calls"] button', "Isabella Rossi");
    await page.waitForSelector('[data-testid="call-detail"]', { visible: true });
    await waitText(page, "What happened");
    await waitText(page, "teeth whitening");
    await page.waitForSelector('[data-testid="transcript"] li', { visible: true, timeout: 10000 });
    const lines = await page.$$eval('[data-testid="transcript"] li', (els) => els.length);
    assert(lines >= 4, `expected the transcript, got ${lines} lines`);
    await waitText(page, "Linked records");
    await waitText(page, "View follow-up");
    await noOverflow(page, `${tag} call drawer`);
    await closeSheet(page);
  });

  await step(`${tag} deep link ?call= opens the drawer`, async () => {
    const id = api.calls.find((c) => c.contact?.full_name === "Grace Lee").id;
    await page.goto(`${B}/app/calls?call=${id}`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="call-detail"]', { visible: true });
    await waitText(page, "New patient check-up");
    await closeSheet(page);
  });

  await step(`${tag} bookings: list filters, week view and booking drawer`, async () => {
    await page.goto(`${B}/app/bookings`, { waitUntil: "networkidle0" });
    await waitText(page, "Grace Lee");
    await waitText(page, "Noah Walker"); // added straight to the calendar
    const upcoming = api.appts.filter((a) => Date.parse(a.starts_at) >= Date.now() - 3600_000).length;
    await waitText(page, `${upcoming} bookings`);
    // Past bookings
    await page.click('button[aria-label="Time"]');
    await clickText(page, "[role=option]", "Past");
    await waitText(page, "Oliver Smith");
    await waitNoText(page, "Grace Lee");
    await noOverflow(page, `${tag} bookings list`);
    await clickText(page, "button", "week");
    await waitText(page, "Week of");
    await noOverflow(page, `${tag} bookings week`);
    await clickText(page, "button", "list");
    await page.click('button[aria-label="Time"]');
    await clickText(page, "[role=option]", "All time");
    await clickText(page, "tr, [role=row], li, button", "Grace Lee");
    await page.waitForSelector("[role=dialog]", { visible: true });
    await waitText(page, "Open the call that booked this");
    await waitText(page, "Update status");
    await closeSheet(page);
  });

  await step(`${tag} manager changes a booking status (persists)`, async () => {
    const target = width === 1280 ? "Completed" : "No-show";
    await clickText(page, "tr, [role=row], li, button", "Oliver Smith");
    await page.waitForSelector('[data-testid="booking-status-actions"]', { visible: true });
    await clickText(page, '[data-testid="booking-status-actions"] button', target);
    await waitText(page, `Marked ${target.toLowerCase()}`);
    const after = (await apiFetch(page, "GET", W("/bookings"))).body.appointments.find((a) => a.customer_name === "Oliver Smith");
    assert(after.status === (width === 1280 ? "completed" : "no_show"), `booking status is ${after.status}`);
    await closeSheet(page);
  });

  await step(`${tag} follow-ups: list, stage filter, pipeline`, async () => {
    await page.goto(`${B}/app/leads`, { waitUntil: "networkidle0" });
    await waitText(page, "Follow-ups");
    await waitText(page, "Isabella Rossi");
    await waitText(page, "Tom Reilly");
    await page.click('button[aria-label="Stage"]');
    await clickText(page, "[role=option]", "Contacted");
    await waitText(page, "Tom Reilly");
    await waitNoText(page, "Isabella Rossi");
    await page.click('button[aria-label="Stage"]');
    await clickText(page, "[role=option]", "All stages");
    await waitText(page, "Isabella Rossi");
    await noOverflow(page, `${tag} follow-ups list`);
    await clickText(page, "button", "pipeline");
    await waitText(page, "Pipeline value");
    await noOverflow(page, `${tag} follow-ups pipeline`);
    await clickText(page, "button", "list");
    const csv = await exportCsv(page);
    assert(csv.startsWith("Created,") && csv.includes("Tom Reilly") && csv.includes("Isabella Rossi"), "follow-ups CSV is missing rows");
    await page.reload({ waitUntil: "networkidle0" });
  });

  await step(`${tag} manager moves a follow-up stage and it persists after reload`, async () => {
    const want = width === 1280 ? "Qualified" : "Proposal";
    await clickText(page, "tr, [role=row], li, button", "Isabella Rossi");
    await page.waitForSelector("[role=dialog]", { visible: true });
    await waitText(page, "Move to");
    await clickText(page, "[role=dialog] button", want);
    await waitText(page, `Moved to ${want}`);
    await closeSheet(page);
    await page.reload({ waitUntil: "networkidle0" });
    await page.click('button[aria-label="Stage"]');
    await clickText(page, "[role=option]", want);
    await waitText(page, "Isabella Rossi");
    const lead = (await apiFetch(page, "GET", W("/follow-ups"))).body.leads.find((l) => l.name === "Isabella Rossi");
    assert(lead.stage === want.toLowerCase(), `stage is ${lead.stage}`);
  });

  await step(`${tag} reports page renders charts`, async () => {
    await page.goto(`${B}/app/analytics`, { waitUntil: "networkidle0" });
    await waitText(page, "Reports");
    await waitText(page, "Call volume");
    await waitText(page, "Text conversations");
    await page.waitForSelector(".recharts-surface", { timeout: 10000 });
    await noOverflow(page, `${tag} reports`);
    const csv = await exportCsv(page);
    const total = csv.trim().split("\n").slice(1).reduce((n, l) => n + Number(l.split(",")[1]), 0);
    assert(csv.startsWith("Date,Total") && total > 0, `reports CSV totals ${total} calls`);
  });

  await ctx.close();
}

// ---- Viewer: read-only ----
await step("viewer sees the data but can't change a follow-up or booking", async () => {
  const { ctx, page } = await newUser(1280);
  await signIn(page, "viewer@alpha.test", "password-for-viewer");
  await page.goto(`${B}/app/leads`, { waitUntil: "networkidle0" });
  await clickText(page, "tr, [role=row], li, button", "Tom Reilly");
  await page.waitForSelector("[role=dialog]", { visible: true });
  await waitText(page, "view only");
  const hasMove = await page.evaluate(() => document.querySelector("[role=dialog]").innerText.includes("Move to"));
  assert(!hasMove, "viewer is offered stage buttons");
  await closeSheet(page);
  const res = await apiFetch(page, "PATCH", W("/follow-ups/req-cb-2"), { stage: "won" });
  assert(res.status === 403, `viewer PATCH follow-up -> ${res.status}`);
  const res2 = await apiFetch(page, "PATCH", W("/bookings/req-bk-2"), { status: "cancelled" });
  assert(res2.status === 403, `viewer PATCH booking -> ${res2.status}`);
  await page.goto(`${B}/app/bookings`, { waitUntil: "networkidle0" });
  await page.click('button[aria-label="Time"]');
  await clickText(page, "[role=option]", "All time");
  await clickText(page, "tr, [role=row], li, button", "Oliver Smith");
  await page.waitForSelector("[role=dialog]", { visible: true });
  const hasStatus = await page.evaluate(() => !!document.querySelector('[data-testid="booking-status-actions"]'));
  assert(!hasStatus, "viewer is offered booking status buttons");
  await page.goto(`${B}/app/calls`, { waitUntil: "networkidle0" });
  await clickText(page, 'ul[aria-label="Calls"] button', "Isabella Rossi");
  await page.waitForSelector('[data-testid="transcript"] li', { visible: true, timeout: 10000 });
  await ctx.close();
});

// ---- Agency staff: own org only ----
await step("agency staff can change their own business; another agency gets 404", async () => {
  const a = await newUser(1280);
  await signIn(a.page, "a@a.test", "password-for-agency-a");
  const ok = await apiFetch(a.page, "PATCH", W("/follow-ups/req-cb-2"), { stage: "won" });
  assert(ok.status === 200 && ok.body.lead.stage === "won", `agency A PATCH -> ${ok.status}`);
  await a.ctx.close();
  const b = await newUser(1280);
  await signIn(b.page, "b@b.test", "password-for-agency-b");
  for (const p of ["/calls", "/bookings", "/follow-ups"]) {
    const r = await apiFetch(b.page, "GET", W(p));
    assert(r.status === 404, `agency B GET ${p} -> ${r.status}`);
  }
  const w = await apiFetch(b.page, "PATCH", W("/follow-ups/req-cb-2"), { stage: "lost" });
  assert(w.status === 404, `agency B PATCH -> ${w.status}`);
  await b.ctx.close();
});

// ---- Platform admin viewing as the business: read-only ----
await step("platform admin: full access, but viewing-as is read-only", async () => {
  const { ctx, page } = await newUser(1280);
  await signIn(page, "ronan@test.dev", "correct-horse-battery");
  const ok = await apiFetch(page, "PATCH", W("/follow-ups/req-cb-2"), { stage: "contacted" });
  assert(ok.status === 200, `admin PATCH -> ${ok.status}`);
  const orgs = (await apiFetch(page, "GET", "/api/admin/agencies")).body;
  const agencyA = (orgs.agencies ?? orgs).find((x) => x.name === "Agency A");
  const v = await apiFetch(page, "POST", "/api/admin/view-as", { orgId: agencyA.id, clientId: CL });
  assert(v.status === 200, `view-as -> ${v.status}`);
  const r = await apiFetch(page, "GET", W("/follow-ups"));
  assert(r.status === 200, `viewing GET -> ${r.status}`);
  const w = await apiFetch(page, "PATCH", W("/follow-ups/req-cb-2"), { stage: "won" });
  assert(w.status === 403, `viewing PATCH -> ${w.status}`);
  await apiFetch(page, "DELETE", "/api/admin/view-as");
  await ctx.close();
});

await step("no page errors", async () => {
  assert(errors.length === 0, errors.slice(0, 5).join(" | "));
});

await browser.close();
console.log(results.join("\n"));
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
