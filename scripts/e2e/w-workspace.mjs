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
/** The rows on the calls page. */
async function waitCallCount(page, n, ms = 10000) {
  await page.waitForFunction((want) => document.querySelectorAll('ul[aria-label="Calls"] li').length === want, { timeout: ms }, n);
}
/** Click an Export button and return the CSV text it would download. */
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
    // A new business is sent to its set-up wizard first; this test is about the dashboard.
    await apiFetch(page, "PUT", `/api/manage/${CL}/onboarding`, { status: "done" });
    await page.goto(`${B}/app`, { waitUntil: "networkidle0" });
    await waitText(page, "Calls answered");
    await waitText(page, "Bookings made");
    await waitText(page, "Messages for you");
    await waitText(page, "Recent calls");
    await waitText(page, "Isabella Rossi");
    await waitText(page, "Needs your attention");
    await page.waitForFunction(() => /Isabella Rossi/.test(document.querySelector("[data-home-attention]")?.innerText ?? ""), { timeout: 10000 });
    // Four places to go, no more.
    const tabs = await page.$$eval('nav[aria-label="Primary"] a', (as) => as.filter((a) => a.offsetWidth > 0).map((a) => a.textContent.trim()));
    assert(tabs.join(",") === "Home,Calls,Bookings,Settings", `client nav is ${tabs}`);
    await noOverflow(page, `${tag} dashboard`);
    const now = new Date();
    const from = new Date(now.getTime() - 120 * 86_400_000).toISOString();
    api = {
      calls: (await apiFetch(page, "GET", W(`/calls?from=${from}&to=${now.toISOString()}`))).body.calls,
      leads: (await apiFetch(page, "GET", W("/follow-ups"))).body.leads,
      appts: (await apiFetch(page, "GET", W("/bookings"))).body.appointments,
    };
    assert(api.calls.length >= 6, `expected the seeded calls, got ${api.calls.length}`);
  });

  await step(`${tag} calls page: list, search and the four filters`, async () => {
    await page.goto(`${B}/app/calls`, { waitUntil: "networkidle0" });
    await waitCallCount(page, api.calls.length);
    await type(page, 'input[aria-label="Search calls"]', "Isabella");
    await waitCallCount(page, 1);
    await clearAndType(page, 'input[aria-label="Search calls"]', "");
    await waitCallCount(page, api.calls.length);
    const want = {
      bookings: api.calls.filter((c) => c.outcome === "booked").length,
      messages: api.calls.filter((c) => ["lead_captured", "callback_requested", "voicemail"].includes(c.outcome)).length,
      missed: api.calls.filter((c) => c.status === "missed" || c.status === "failed" || c.outcome === "no_answer").length,
    };
    for (const f of ["bookings", "messages", "missed"]) {
      await page.click(`button[data-filter="${f}"]`);
      await waitCallCount(page, want[f]);
    }
    await page.click('button[data-filter="all"]');
    await waitCallCount(page, api.calls.length);
    await noOverflow(page, `${tag} calls`);
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

  await step(`${tag} bookings: upcoming by day, past, and the booking drawer`, async () => {
    await page.goto(`${B}/app/bookings`, { waitUntil: "networkidle0" });
    await waitText(page, "Grace Lee");
    await waitText(page, "Noah Walker"); // added straight to the calendar
    await page.waitForSelector("[data-bookings-list] [data-day]");
    const upcoming = api.appts.filter((a) => Date.parse(a.starts_at) >= Date.now() - 3600_000 && a.status !== "cancelled").length;
    const shown = await page.$$eval("[data-bookings-list] li", (els) => els.length);
    assert(shown === upcoming, `expected ${upcoming} upcoming bookings, got ${shown}`);
    await page.click('button[data-when="past"]');
    await waitText(page, "Oliver Smith");
    await waitNoText(page, "Grace Lee");
    await noOverflow(page, `${tag} bookings past`);
    await page.click('button[data-when="upcoming"]');
    await clickText(page, "[data-bookings-list] button", "Grace Lee");
    await page.waitForSelector("[role=dialog]", { visible: true });
    await waitText(page, "Open the call that booked this");
    await waitText(page, "Cancel this booking");
    await noOverflow(page, `${tag} booking drawer`);
    await closeSheet(page);
  });

  if (width === 390) {
    await step(`${tag} manager cancels a booking (persists)`, async () => {
      await clickText(page, "[data-bookings-list] button", "Grace Lee");
      await page.waitForSelector('[data-testid="booking-status-actions"]', { visible: true });
      await page.waitForSelector('button[data-action="cancel-booking"]', { visible: true });
      await page.$eval('button[data-action="cancel-booking"]', (b) => b.click());
      await page.waitForSelector('button[data-action="confirm-cancel-booking"]', { visible: true });
      await page.$eval('button[data-action="confirm-cancel-booking"]', (b) => b.click());
      await waitText(page, "Booking cancelled");
      const after = (await apiFetch(page, "GET", W("/bookings"))).body.appointments.find((a) => a.customer_name === "Grace Lee");
      assert(after.status === "cancelled", `booking status is ${after.status}`);
    });
  }

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
  await page.click('button[data-when="past"]');
  await clickText(page, "[data-bookings-list] button", "Oliver Smith");
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
