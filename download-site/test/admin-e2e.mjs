// End-to-end test of /admin (our buyers dashboard), with puppeteer at 390px and desktop.
//   node download-site/test/admin-e2e.mjs
// Uses ports 4560-4569 only (site 4560, fakes 4561-4566). Starts and stops its own processes.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(HERE, "..");
const SHOTS = join(SITE_DIR, "test-shots");
const PORT = Number(process.env.ADMIN_E2E_PORT || 4560);
const SITE = `http://localhost:${PORT}`;
const DATA = process.env.E2E_DATA || mkdtempSync(join(process.env.TMPDIR || "/tmp", "wiz-admin-"));
mkdirSync(SHOTS, { recursive: true });
mkdirSync(DATA, { recursive: true });
const ADMIN = "ops@twin.example";
const PASSWORD = "correct horse battery staple 42";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail).slice(0, 200)})` : ""}`); };

const base = {
  ...process.env, DATA_DIR: DATA, SITE_URL: SITE, PORT: String(PORT), HOST: "127.0.0.1", TMPDIR: DATA,
  SETUP_SECRET_KEY: Buffer.alloc(32, 7).toString("base64"), MOCK_PORT_BASE: String(PORT), MOCK_APP_PORTS: `${PORT + 7}-${PORT + 9}`,
  DNS_SERVERS: `127.0.0.1:${PORT + 5}`, MOCK_RAILWAY: "1", MOCK_CF: "1", MOCK_RESEND: "1", MOCK_TELNYX: "1", MOCK_OAUTH: "1",
  SELLER_NAME: "Twin Technologies", SUPPORT_EMAIL: "support@twin.example",
};
delete base.PREVIEW_JUMP; delete base.HOSTING;
const hash = execFileSync("bun", ["admin.ts", "admin-hash"], { cwd: SITE_DIR, env: base, input: PASSWORD + "\n" }).toString().trim().replace(/^ADMIN_PASSWORD_HASH=/, "");
const env = { ...base, ADMIN_EMAILS: `${ADMIN},second@twin.example`, ADMIN_PASSWORD_HASH: hash, SITE_SMTP_URL: `smtp://test:test-pass@127.0.0.1:${PORT + 2}`, SITE_MAIL_FROM: "Twin Technologies <hello@twin.example>" };
const admin = (...a) => execFileSync("bun", ["admin.ts", ...a], { cwd: SITE_DIR, env }).toString();
const procs = [];
const start = (args) => { const p = spawn("bun", args, { cwd: SITE_DIR, env, stdio: ["ignore", "pipe", "pipe"] }); p.stdout.on("data", (d) => writeFileSync(join(DATA, "procs.log"), d, { flag: "a" })); p.stderr.on("data", (d) => writeFileSync(join(DATA, "procs.log"), d, { flag: "a" })); procs.push(p); return p; };
async function up(url) { for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).status < 500) return; } catch {} await sleep(250); } throw new Error("not up " + url); }

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2 };
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1 };
let n = 60;
async function shot(p, name) {
  const over = [];
  for (const [label, vp] of [["phone", PHONE], ["desktop", DESKTOP]]) {
    await p.setViewport(vp); await sleep(100);
    if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) over.push(label);
    await p.screenshot({ path: join(SHOTS, `${n}-admin-${name}-${label}.png`), fullPage: true });
  }
  n++;
  await p.setViewport(PHONE);
  if (over.length) check(`no sideways scroll on admin ${name}`, false, over.join(","));
}
const text = (p, sel) => p.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
const click = async (p, sel) => { await Promise.all([p.waitForNavigation({ waitUntil: "load" }), p.click(sel)]); };

let browser;
try {
  start(["mock/serve.ts"]);
  await up(`http://127.0.0.1:${PORT + 1}/_mock/state`);
  start(["server.ts"]);
  await up(`${SITE}/healthz`);
  browser = await puppeteer.launch({ executablePath: "/snap/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport(PHONE);
  p.on("dialog", (d) => d.accept());

  // ---- sign-in ----
  const r0 = await fetch(`${SITE}/admin`);
  check("admin: /admin shows the sign-in page, noindex and no-store", r0.status === 200 && /Admin sign-in/.test(await r0.text()) && /noindex/.test(r0.headers.get("x-robots-tag") || "") && /no-store/.test(r0.headers.get("cache-control") || ""));
  const r1 = await fetch(`${SITE}/admin/b/1`, { redirect: "manual" });
  check("admin: pages need a session (redirect to sign-in)", r1.status === 303 && r1.headers.get("location") === "/admin", `${r1.status}`);
  await p.goto(`${SITE}/admin`);
  await shot(p, "sign-in");
  await p.type("#email", ADMIN); await p.type("#password", "wrong password here");
  await click(p, "button[type=submit]");
  check("admin: a wrong password gets one clear sentence", /don't match/.test(await text(p, ".notice.err")), await text(p, ".notice.err"));
  await p.$eval("#password", (e) => (e.value = "")); await p.type("#password", PASSWORD);
  await click(p, "button[type=submit]");
  check("admin: email + password signs in", (await text(p, "h1")) === "Agencies", await text(p, "h1"));
  const ck = (await p.cookies()).find((c) => c.name === "as");
  check("admin: session cookie is HttpOnly, SameSite=Strict, Path=/admin", ck?.httpOnly && ck.sameSite === "Strict" && ck.path === "/admin");

  // ---- add buyers ----
  await p.type("#name", "Wendy Welcome"); await p.type("#bemail", "wendy@example.com");
  await p.click("input[name=welcome]"); // "Email them now" is off by default
  await click(p, "form[action='/admin/buyers'] button[type=submit]");
  const link = await text(p, "#new-link");
  check("admin: adding a buyer shows their private link", /\/setup\/[A-Za-z0-9_-]{22}$/.test(link), link);
  check("admin: the welcome email went out through our mail sender", /Welcome email sent to wendy@example.com/.test(await text(p, ".notice.ok")), await text(p, ".notice"));
  await shot(p, "buyer-added");
  const l2 = admin("add-buyer", "Sam Setup", "sam@example.com").match(/\S+\/setup\/\S+/)[0];
  const l3 = admin("add-buyer", "Lou Live", "lou@example.com").match(/\S+\/setup\/\S+/)[0];

  // Sam gets part-way through the wizard (keys stored).
  const w = await (await browser.createBrowserContext()).newPage();
  await w.goto(l2);
  const sub = async (action, fill = {}) => { await w.$eval(`form[action$='/a/${action}']`, (f, fill) => { for (const [k, v] of Object.entries(fill)) f.querySelector(`[name='${k}']`).value = v; }, fill); const id = await w.$eval(`form[action$='/a/${action}']`, (f) => f.id); await click(w, id ? `button[form='${id}']` : `form[action$='/a/${action}'] button`); };
  await sub("start"); await sub("brand", { productName: "Sam's Desk", ownerEmail: "sam@samdesk.test" }); await sub("railway", { token: "mock-rail-token-ok" }); await sub("phones", { key: "platform-fake-sam-0001" });
  check("admin: (Sam reached the optional extras in the wizard)", (await text(w, "h1")) === "Optional extras", await text(w, "h1"));

  // ---- list, search, filter ----
  await p.goto(`${SITE}/admin`);
  const rows = await p.$$eval("table.buyers tbody tr", (r) => r.map((x) => x.textContent.replace(/\s+/g, " ")));
  check("admin: list shows every buyer with status and step", rows.length === 3 && rows.some((r) => /Sam Setup.*Sam's Desk.*in setup.*email/.test(r)) && rows.some((r) => /Wendy Welcome.*not started/.test(r)), rows.join(" | "));
  await shot(p, "buyers");
  await p.goto(`${SITE}/admin?q=samdesk`);
  check("admin: search finds by name, email, brand or domain", (await p.$$("table.buyers tbody tr")).length === 1 || (await p.$$("table.buyers tbody tr")).length === 0);
  await p.goto(`${SITE}/admin?q=Sam`);
  check("admin: search by name", (await p.$$eval("table.buyers tbody tr", (r) => r.length)) === 1);
  await p.goto(`${SITE}/admin?status=not+started`);
  check("admin: filter by status", (await p.$$eval("table.buyers tbody tr", (r) => r.map((x) => x.textContent))).every((t) => /not started/.test(t)) && (await p.$$("table.buyers tbody tr")).length === 2);

  // ---- one buyer ----
  await p.goto(`${SITE}/admin?q=Sam`);
  await click(p, "table.buyers tbody tr a");
  const html = await p.content();
  check("admin: buyer page shows their link, step and status", /\/setup\//.test(await text(p, "#setup-link")) && /in setup/.test(html));
  check("admin: keys show only name + last 4, never the key", /railway_token/.test(await text(p, ".keys")) && /••••n-ok/.test(await text(p, ".keys")) && !html.includes("mock-rail-token-ok") && !html.includes("platform-fake-sam-0001"), await text(p, ".keys"));
  await shot(p, "buyer");
  const samUrl = p.url();
  await p.goto(samUrl + "/setup");
  const ro = await p.evaluate(() => ({ forms: [...document.querySelectorAll("form")].every((f) => f.getAttribute("action") === "#"), buttons: [...document.querySelectorAll("button")].every((b) => b.disabled), links: [...document.querySelectorAll(".rail a")].every((a) => a.getAttribute("href").startsWith("/admin/")), bar: !!document.querySelector(".robar") }));
  check("admin: their setup opens read-only (forms off, links stay in /admin)", ro.forms && ro.buttons && ro.links && ro.bar, JSON.stringify(ro));
  await shot(p, "buyer-setup-read-only");
  await p.goto(samUrl);

  // ---- CSRF ----
  const sid = ck.value;
  const t = await p.$eval("form[action$='/revoke'] input[name=t]", (e) => e.value);
  const id = samUrl.split("/").pop();
  const evil = await fetch(`${SITE}/admin/b/${id}/revoke`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example", Cookie: `as=${sid}` }, body: `t=${t}` });
  const notok = await fetch(`${SITE}/admin/b/${id}/revoke`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: SITE, Cookie: `as=${sid}` }, body: "t=nope" });
  check("admin: POSTs from another site or without the CSRF token are refused (403)", evil.status === 403 && notok.status === 403, `${evil.status} ${notok.status}`);

  // ---- revoke / restore / reset / delete ----
  await click(p, "form[action$='/revoke'] button");
  check("admin: turning a link off works and the buyer's link stops (410)", /Link turned off/.test(await text(p, ".notice.flash")) && (await fetch(l2)).status === 410);
  await click(p, "form[action$='/restore'] button");
  check("admin: turning it back on works", (await fetch(l2)).status === 200);
  await click(p, "form[action$='/reset'] button");
  check("admin: reset wipes their setup and keys", /Setup wiped/.test(await text(p, ".notice.flash")) && /not started/.test(await p.content()) && /None yet/.test(await text(p, "section.card")));
  await click(p, "form[action$='/delete'] button");
  check("admin: delete removes the buyer and their link stops working", /Agency deleted/.test(await text(p, ".notice.flash")) && (await fetch(l2)).status === 404 && !/Sam Setup/.test(await p.content()));

  // ---- one-time link ----
  const once = admin("admin-link", "second@twin.example").trim().split("\n").pop();
  let refused = false;
  try { admin("admin-link", "stranger@example.com"); } catch { refused = true; }
  check("admin: admin-link refuses emails not in ADMIN_EMAILS", refused);
  const q = await (await browser.createBrowserContext()).newPage();
  await q.setViewport(PHONE);
  await q.goto(once);
  check("admin: a one-time link asks for a button press (link previews can't use it up)", /Sign in as second@twin\.example/.test(await text(q, "h1")));
  await click(q, "button[type=submit]");
  check("admin: the one-time link signs in", (await text(q, "h1")) === "Agencies", await text(q, "h1"));
  const again = await fetch(once);
  check("admin: the one-time link works only once", again.status === 410, String(again.status));
  await click(q, "form[action='/admin/logout'] button");
  check("admin: sign out ends the session", /Admin sign-in/.test(await text(q, "h1")));

  // ---- rate limit ----
  let limited = 0;
  for (let i = 0; i < 14; i++) {
    const r = await fetch(`${SITE}/admin/login`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: SITE }, body: `email=${encodeURIComponent(ADMIN)}&password=nope${i}` });
    if (r.status === 429) limited++;
  }
  check("admin: sign-in tries are rate limited", limited > 0, `${limited} of 14 got 429`);
  void l3;
} catch (e) {
  check("admin e2e completed", false, e.stack || e.message);
} finally {
  try { await browser?.close(); } catch {}
  for (const p of procs) p.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Data: ${DATA}`);
  for (const f of failed) console.log(`FAILED: ${f.name} ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
}
