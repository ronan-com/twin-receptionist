// Full local end-to-end test of the hosted setup wizard on its default hosting, Railway.
// No real provider is called: MOCK_RAILWAY/CF/RESEND/TELNYX/OAUTH point everything at
// mock/serve.ts. The fake Railway really builds the app's image from the uploaded source
// (deploy/Dockerfile) and runs it with a local postgres:16, so each buyer ends with a real,
// working dashboard (containers wiz-test-rail-*).
//   bash download-site/test/run-e2e.sh        (runs this, then cleans up)
// Scenarios:
//   guards  PREVIEW_JUMP / MOCK_* on a public address refuse to start; bad SITE_URL warns
//   E  bad code, old link, CSRF, tunnel/proxy origin, per-IP rate limit
//   A  Cloudflare path at 390px with every provider error, a failed build then Try again,
//      tab closed + site restarted mid-build, Done, secrets gone, the app answers
//   B  "add the records myself" path in parallel with A: email records tick off one by one,
//      the app's two records (a wrong one first), Done
//   C  Delete the project
//   D  read-only Cloudflare token, existing record, nameservers pending -> active, per-buyer limit
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(HERE, "..");
const SHOTS = process.env.E2E_SHOTS || join(SITE_DIR, "test-shots");
const PORT = Number(process.env.E2E_PORT || 4520);
const SITE = `http://localhost:${PORT}`;
const MOCK = `http://127.0.0.1:${PORT + 1}`;
const APP_PORTS = process.env.E2E_APP_PORTS || `${PORT + 30}-${PORT + 39}`;
const DATA = process.env.E2E_DATA || join(process.env.TMPDIR || "/tmp", `wiz-e2e-${Date.now()}`);
const BUNDLE = process.env.E2E_BUNDLE || join(SITE_DIR, "../deploy/selfhost/out/selfhost-bundle.tgz");
const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255)).toString("base64");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(DATA, { recursive: true });

const results = [];
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail });
  log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail).slice(0, 300)})` : ""}`);
  return !!cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A real PNG (size x size, coloured blocks) made here, so the logo upload needs no fixture file. */
function makePng(size, rgb) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = (y) => { const r = Buffer.alloc(1 + size * 3); for (let x = 0; x < size; x++) { const on = ((x >> 5) + (y >> 5)) % 2; r[1 + x * 3] = on ? rgb[0] : 255; r[2 + x * 3] = on ? rgb[1] : 255; r[3 + x * 3] = on ? rgb[2] : 255; } return r; };
  const raw = Buffer.concat(Array.from({ length: size }, (_, y) => row(y)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------- processes ----------------
const env = {
  ...process.env, DATA_DIR: DATA, SITE_URL: SITE, PORT: String(PORT), HOST: "127.0.0.1", SETUP_SECRET_KEY: KEY,
  MOCK_PORT_BASE: String(PORT), DNS_SERVERS: `127.0.0.1:${PORT + 5}`, MOCK_APP_PORTS: APP_PORTS, TMPDIR: DATA,
  MOCK_RAILWAY: "1", MOCK_CF: "1", MOCK_RESEND: "1", MOCK_TELNYX: "1", MOCK_OAUTH: "1",
  CHECKS_PER_10_MIN: "15", LOOKUPS_PER_MINUTE: "20", SUPPORT_EMAIL: "support@example.com", PRODUCT_NAME: "AI Receptionist",
};
delete env.PREVIEW_JUMP; delete env.TEST_SITE;
const procLog = join(DATA, "procs.log");
function startProc(args, name) {
  const p = spawn("bun", args, { cwd: SITE_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
  const w = (d) => { try { writeFileSync(procLog, `[${name}] ${d}`, { flag: "a" }); } catch {} };
  p.stdout.on("data", w); p.stderr.on("data", w);
  return p;
}
let mock, site;
async function waitUp(url) { for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) return; } catch {} await sleep(250); } throw new Error("not up: " + url); }
async function startSite() { site = startProc(["server.ts"], "site"); await waitUp(`${SITE}/healthz`); }
async function stopSite() { site.kill("SIGTERM"); await new Promise((r) => site.once("exit", r)); }
const admin = (...a) => execFileSync("bun", ["admin.ts", ...a], { cwd: SITE_DIR, env }).toString();
const mockState = async () => (await fetch(`${MOCK}/_mock/state`)).json();
const sqlite = (sql) => execFileSync("bun", ["-e", `const {Database}=require("bun:sqlite");const d=new Database(${JSON.stringify(join(DATA, "site.db"))},{readonly:true});console.log(JSON.stringify(d.query(${JSON.stringify(sql)}).all()))`]).toString();

// ---------------- browser helpers ----------------
let browser;
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1 };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2 };
async function newPage(ctx) {
  const p = await ctx.newPage();
  await p.setViewport(PHONE);
  p.on("pageerror", (e) => log("PAGE ERROR", e.message));
  return p;
}
let shotN = 0;
/** 390px screenshot of the page, plus a desktop one; fails the test on any sideways scroll. */
async function shot(p, name) {
  const n = String(++shotN).padStart(2, "0");
  const overflow = [];
  for (const [label, vp] of [["phone", PHONE], ["desktop", DESKTOP]]) {
    await p.setViewport(vp);
    await sleep(120);
    if (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) overflow.push(label);
    await p.screenshot({ path: join(SHOTS, `${n}-${name}-${label}.png`), fullPage: true });
  }
  await p.setViewport(PHONE);
  if (overflow.length) check(`no sideways scroll on ${name}`, false, overflow.join(","));
}
async function submit(p, action, fill = {}) {
  const sel = `form[action$='/a/${action}']`;
  await p.waitForSelector(sel, { timeout: 15000 });
  const missing = await p.$eval(sel, (f, fill) => {
    for (const [k, v] of Object.entries(fill)) {
      const els = [...f.querySelectorAll(`[name='${k}']`)];
      if (!els.length) return k;
      for (const el of els) {
        if (el.type === "radio") el.checked = el.value === String(v);
        else if (el.type === "checkbox") el.checked = !!v;
        else el.value = String(v);
      }
    }
    return "";
  }, fill);
  if (missing) throw new Error(`no field ${missing} in ${action}`);
  const btn = (await p.$(`${sel} button[type=submit]`)) || (await p.$(`button[form='${await p.$eval(sel, (f) => f.id)}']`));
  await Promise.all([p.waitForNavigation({ waitUntil: "load", timeout: 120000 }), btn.click()]);
}
const text = (p, sel) => p.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
const flash = (p) => text(p, ".notice.flash");
const h1 = (p) => text(p, "h1");
async function until(p, what, fn, ms = 20 * 60_000, reload = true) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await sleep(3000);
    if (reload) await p.reload({ waitUntil: "load" }).catch(() => {});
  }
  throw new Error(`timed out waiting for ${what}`);
}
const addRegistrar = (r) => fetch(`${MOCK}/_mock/registrar`, { method: "POST", body: JSON.stringify({ type: r.type, name: r.name, content: r.value, priority: r.prio ? Number(r.prio) : undefined }) });
const tableRows = (p, sel = "table.records tbody tr") => p.$$eval(sel, (rows) => rows.map((r) => {
  const c = r.querySelectorAll("td");
  return { type: c[0].querySelector("b").textContent, prio: (c[0].textContent.match(/priority (\d+)/) || [])[1], name: c[1].querySelector("code").textContent, value: c[2].querySelector("code").textContent };
}));

// Walk a buyer to the Install screen (Railway order: Railway, Phones, then the optional extras screen; here every extra is added: Email, Domain, Calendars).
async function setupBuyer(p, o, snap = async () => {}) {
  await p.goto(o.link, { waitUntil: "load" });
  await snap("welcome");
  await submit(p, "start");
  await snap("brand");
  if (o.logo) {
    await p.waitForSelector("#logoFile");
    check(`${o.tag}: Brand step offers a logo and a colour in the real (non-demo) wizard`, !!(await p.$("#colour")), "");
    // Chromium here is a snap that can't read /tmp, so the file is handed over in the page itself.
    await p.$eval("#logoFile", (el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bytes], "logo.png", { type: "image/png" }));
      el.files = dt.files; el.dispatchEvent(new Event("change", { bubbles: true }));
    }, readFileSync(o.logo).toString("base64"));
    await until(p, "logo shrunk in the page", async () => (await p.$eval("#logo", (e) => e.value)).startsWith("data:image/png;base64,"), 15_000, false);
    const len = (await p.$eval("#logo", (e) => e.value)).length;
    check(`${o.tag}: the page shrinks a big logo to a small PNG before sending it`, len > 200 && len <= 30_000, String(len));
    await p.$eval("#colour", (e, v) => { e.value = v; }, o.colour);
    await snap("brand-with-logo");
  }
  await submit(p, "brand", { productName: o.brand, ownerEmail: o.owner });
  check(`${o.tag}: reached the Railway step`, (await h1(p)) === "Connect Railway", await h1(p));
  await snap("railway");
  if (o.errors) {
    await submit(p, "railway", { token: "not-a-real-token" });
    check("A: bad Railway token: one clear sentence", /didn't accept that token/.test(await flash(p)), await flash(p));
    await snap("railway-bad-token");
    await submit(p, "railway", { token: "mock-rail-token-nocard" });
    check("A: Railway account without a card / Hobby plan is caught before anything is made", /Hobby plan/.test(await flash(p)), await flash(p));
    await snap("railway-no-card");
  }
  await submit(p, "railway", { token: "mock-rail-token-ok" });
  check(`${o.tag}: reached Phones`, (await h1(p)) === "Connect your Telnyx account", await h1(p));
  check(`${o.tag}: Phones is just the Telnyx key (no "who pays" choice)`, !(await p.$("input[name=pays]")) && /Telnyx account/.test(await text(p, ".lead")), await text(p, ".lead"));
  await snap("phones");
  if (o.errors) {
    await submit(p, "phones", { key: "KEY0123456789ABCDEF0123456789_abcdefghijkl" });
    check("A: an unknown Telnyx key is refused (never sent anywhere in test mode)", /didn't accept that key/.test(await flash(p)), await flash(p));
    await snap("phones-bad-key");
  }
  await submit(p, "phones", { key: o.telnyx });
  check(`${o.tag}: reached the optional extras screen`, (await h1(p)) === "Optional extras", await h1(p));
  await snap("extras");
  await p.goto(`${o.link}?step=email`, { waitUntil: "load" });
  check(`${o.tag}: reached Email`, (await h1(p)) === "Send email from your own address (optional)", await h1(p));
  await snap("email");
  if (o.errors) {
    await submit(p, "email", { key: "re_mock_sending_only_key", address: `hello@mail.${o.zone}` });
    check("A: a send-only Resend key gets the Full access message", /Full access/.test(await flash(p)), await flash(p));
  }
  await submit(p, "email", { key: "re_mock_full_access_key", address: `hello@mail.${o.zone}` });
  check(`${o.tag}: email done, back on the extras screen`, (await h1(p)) === "Optional extras", await h1(p));
  await p.goto(`${o.link}?step=domain`, { waitUntil: "load" });
  check(`${o.tag}: reached Domain, prefilled with the email's domain`, (await h1(p)) === "Your own web address (optional)" && (await p.$eval("#domain", (e) => e.value).catch(() => "")) === o.zone, `${await h1(p)} ${await p.$eval("#domain", (e) => e.value).catch(() => "")}`);
  await snap("domain");
  if (o.manual) {
    await submit(p, "domain", { domain: o.zone, mode: "manual" });
    check(`${o.tag}: "add the records myself" lists the email records`, (await h1(p)) === "Add your email records", await h1(p));
    const recs = await tableRows(p);
    check(`${o.tag}: email records to add by hand (DKIM, MX, SPF without quote marks, DMARC)`, recs.length === 4 && recs.some((r) => r.type === "MX") && recs.some((r) => /^_dmarc\./.test(r.name)) && recs.some((r) => r.value === "v=spf1 include:amazonses.com ~all"), JSON.stringify(recs.map((r) => `${r.type} ${r.name} ${r.value.slice(0, 30)}`)));
    const want = [`resend._domainkey.mail.${o.zone}`, `send.mail.${o.zone}`, `_dmarc.${o.zone}`];
    check(`${o.tag}: Resend's record names are full and not doubled, also when the domain is itself a subdomain (${o.zone})`, recs.every((r) => want.includes(r.name)), JSON.stringify(recs.map((r) => r.name)));
    await snap("domain-email-records");
    for (const r of recs.slice(0, 2)) await addRegistrar(r);
    await until(p, "first two email records ticked", async () => (await p.$$eval("table.records .st.f", (x) => x.length)) >= 2, 90_000);
    check(`${o.tag}: records tick off one by one as they appear in public DNS`, (await p.$$eval("table.records .st.f", (x) => x.length)) === 2);
    await snap("domain-email-records-partly-found");
    for (const r of recs.slice(2)) await addRegistrar(r);
    await until(p, "Resend verified", async () => /Resend verified/.test(await text(p, ".notice.ok")), 120_000);
    check(`${o.tag}: Resend verifies once all records are in`, true);
    await snap("domain-email-verified");
    await submit(p, "domain-continue");
  } else {
    if (o.errors) {
      await submit(p, "domain", { domain: o.zone, mode: "cloudflare", token: "not-a-real-token" });
      check("A: bad Cloudflare token: one clear sentence", /didn't accept that token/.test(await flash(p)), await flash(p));
      await snap("domain-bad-token");
    }
    await submit(p, "domain", { domain: o.zone, mode: "cloudflare", token: "mock-cf-token-ok" });
    const z = (await mockState()).zones.find((x) => x.name === o.zone);
    check(`${o.tag}: Cloudflare got Resend's records (SPF quoted once, not twice) and DMARC`, z.records.some((r) => r.type === "MX") && z.records.some((r) => r.content === '"v=spf1 include:amazonses.com ~all"') && z.records.some((r) => /^_dmarc\./.test(r.name)), z.records.map((r) => `${r.type} ${r.name} ${r.content.slice(0, 40)}`).join(" | "));
  }
  check(`${o.tag}: domain done, back on the extras screen`, (await h1(p)) === "Optional extras", await h1(p));
  await p.goto(`${o.link}?step=calendars`, { waitUntil: "load" });
  check(`${o.tag}: reached Calendars`, (await h1(p)) === "Calendar booking (optional)", await h1(p));
  await snap("calendars");
  if (o.google) {
    await submit(p, "calendars", { googleId: "1234-abc.apps.googleusercontent.com", googleSecret: "nope" });
    check(`${o.tag}: wrong Google secret refused`, /Google didn't recognise/.test(await flash(p)), await flash(p));
    await submit(p, "calendars", { googleId: "1234-abc.apps.googleusercontent.com", googleSecret: "mock-google-secret-1234" });
  } else {
    await submit(p, "cal-skip");
  }
  await submit(p, "extras-continue");
  check(`${o.tag}: reached Install`, (await h1(p)) === "Ready to install", await h1(p));
  await snap("install-summary");
}

/** The installed app (real image, real Postgres) answers on its temporary address. */
async function appCheck(tag, tempUrl, brand, owner) {
  const health = await fetch(`${tempUrl}/api/health`).then((r) => r.text()).catch((e) => String(e));
  check(`${tag}: installed app answers ${tempUrl}/api/health`, /"ok":\s*true/.test(health), health.trim());
  const b2 = await puppeteer.launch({ executablePath: "/snap/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const pg = await b2.newPage();
  await pg.setViewport(PHONE);
  pg.on("pageerror", (e) => log("APP PAGE ERROR", e.message));
  await pg.goto(tempUrl, { waitUntil: "networkidle2", timeout: 60000 });
  check(`${tag}: installed app opens in a browser with the brand in its title`, (await pg.title()).includes(brand), await pg.title());
  const shotApp = async (name) => { const n = String(++shotN).padStart(2, "0"); await pg.screenshot({ path: join(SHOTS, `${n}-${tag}-${name}-phone.png`), fullPage: true }); };
  await shotApp("installed-app");
  if (owner) check(`${tag}: a brand-new installed app sends its owner straight to the set-up page (not a sign-in)`, new URL(pg.url()).pathname === "/signup", pg.url());
  check(`${tag}: installed app has no sideways scroll at 390px`, !(await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  if (owner) {
    // The owner creates their account on the installed copy: only the owner email from the wizard may.
    await pg.goto(`${tempUrl}/signup`, { waitUntil: "networkidle2", timeout: 60000 });
    await pg.waitForSelector("#name", { timeout: 20000 });
    check(`${tag}: the installed app's first sign-up page has the agency name filled in with the brand`, (await pg.$eval("#agency", (e) => e.value)) === brand, await pg.$eval("#agency", (e) => e.value));
    await shotApp("owner-signup");
    const fill = async (email) => {
      for (const [sel, v] of [["#name", owner.name], ["#email", email], ["#password", owner.password]]) {
        await pg.focus(sel); await pg.$eval(sel, (e) => e.select()); await pg.keyboard.press("Backspace"); await pg.type(sel, v);
      }
    };
    await fill("someone-else@example.com");
    await pg.click("form button[type=submit]");
    await pg.waitForFunction(() => /owner email you gave/i.test(document.body.innerText), { timeout: 20000 });
    check(`${tag}: a different email can't take the first account (clear message)`, true);
    await shotApp("owner-signup-wrong-email");
    await fill(owner.email);
    await Promise.all([pg.waitForFunction(() => !/\/signup/.test(location.pathname), { timeout: 30000 }), pg.click("form button[type=submit]")]);
    await pg.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 }).catch(() => {});
    check(`${tag}: the owner email from the wizard creates the owner account and lands in the dashboard`, /\/admin/.test(new URL(pg.url()).pathname), pg.url());
    await shotApp("owner-dashboard");
    const brandJson = await pg.evaluate(() => fetch("/api/org/brand", { credentials: "same-origin" }).then((r) => r.json()));
    if (owner.logo) {
      const logoRes = await pg.evaluate((u) => fetch(u).then(async (r) => ({ type: r.headers.get("content-type"), n: (await r.arrayBuffer()).byteLength })), brandJson.logo || "/none");
      check(`${tag}: the logo from the wizard is on the installed agency (PNG)`, /^\/brand\//.test(brandJson.logo) && logoRes.type === "image/png" && logoRes.n > 100, JSON.stringify({ brandJson, logoRes }));
      check(`${tag}: the colour from the wizard is on the installed agency`, brandJson.primaryColor === owner.colour && brandJson.accentColor === owner.colour, JSON.stringify(brandJson));
      await pg.reload({ waitUntil: "networkidle2" });
      check(`${tag}: the dashboard shows the logo`, await pg.evaluate(() => [...document.images].some((i) => /\/brand\//.test(i.src) && i.naturalWidth > 0)));
      await shotApp("owner-dashboard-branded");
    } else {
      check(`${tag}: no logo chosen in the wizard, so none is set`, !brandJson.logo, JSON.stringify(brandJson));
    }
    // Sign out and back in with the same details.
    await pg.evaluate(() => fetch("/api/logout", { method: "POST", credentials: "same-origin" }));
    await pg.goto(`${tempUrl}/login`, { waitUntil: "networkidle2" });
    await pg.waitForSelector("#email", { timeout: 20000 });
    await shotApp("owner-login");
    await pg.type("#email", owner.email); await pg.type("#password", owner.password);
    await Promise.all([pg.waitForFunction(() => !/\/login/.test(location.pathname), { timeout: 30000 }), pg.click("form button[type=submit]")]);
    check(`${tag}: the owner can sign in again on the installed app`, /\/admin/.test(new URL(pg.url()).pathname), pg.url());
  }
  await b2.close();
}

// ======================= run =======================
async function main() {
  if (!existsSync(BUNDLE)) throw new Error(`no bundle at ${BUNDLE}; run deploy/selfhost/make-bundle.sh`);
  for (const f of readdirSync(SHOTS)) if (f.endsWith(".png")) execFileSync("rm", ["-f", join(SHOTS, f)]);
  mock = startProc(["mock/serve.ts"], "mock");
  await waitUp(`${MOCK}/_mock/state`);
  admin("publish", BUNDLE, "1.0.0-e2e");
  const linkOf = (out) => out.trim().split("\n").pop();
  writeFileSync(join(DATA, "logo-big.png"), makePng(600, [10, 143, 92]));
  const A = { tag: "A", link: linkOf(admin("add-buyer", "Alice Alpha", "alice@example.com")), brand: "Alpha Answering", owner: "alice@alpha-reception.test", zone: "alpha-reception.test", telnyx: "platform-fake-alice-0001", errors: true, google: true, logo: join(DATA, "logo-big.png"), colour: "#0a8f5c" };
  const B = { tag: "B", link: linkOf(admin("add-buyer", "Bob Bravo", "bob@example.com")), brand: "Bravo Clinic Desk", owner: "bob@bravo-clinic.test", zone: "bravo-clinic.test", manual: true, telnyx: "platform-fake-bob-0002" };
  const C = { tag: "C", link: linkOf(admin("add-buyer", "Cara Charlie", "cara@example.com")), brand: "Charlie Calls", owner: "cara@charlie-desk.test", zone: "t1.charlie-desk.test", manual: true, telnyx: "platform-fake-cara-0003" };
  const D = { tag: "D", link: linkOf(admin("add-buyer", "Dan Delta", "dan@example.com")) };
  await startSite();
  check("admin add-buyer prints a /setup/<code> link", /\/setup\/[A-Za-z0-9_-]{22}$/.test(A.link), A.link);
  browser = await puppeteer.launch({ executablePath: "/snap/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-gpu"] });

  // ---------- guards ----------
  {
    const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !/^MOCK_/.test(k)));
    const r = spawnSync("bun", ["server.ts"], { cwd: SITE_DIR, env: { ...clean, PREVIEW_JUMP: "1", PORT: String(PORT + 9), DATA_DIR: join(DATA, "guard") }, timeout: 20000 });
    check("guard: PREVIEW_JUMP=1 without any MOCK_* switch refuses to start", r.status === 1 && /PREVIEW_JUMP=1 is for test sites only/.test(String(r.stderr)), `exit ${r.status} ${String(r.stderr).trim().slice(0, 120)}`);
    const r2 = spawnSync("bun", ["server.ts"], { cwd: SITE_DIR, env: { ...env, SITE_URL: "https://setup.example.com", PORT: String(PORT + 9), DATA_DIR: join(DATA, "guard") }, timeout: 20000 });
    check("guard: MOCK_* switches with a public https SITE_URL refuse to start", r2.status === 1 && /for test sites only/.test(String(r2.stderr)), `exit ${r2.status} ${String(r2.stderr).trim().slice(0, 160)}`);
    const w = spawn("bun", ["server.ts"], { cwd: SITE_DIR, env: { ...clean, SITE_URL: "http://setup.example.test/setup", PORT: String(PORT + 9), DATA_DIR: join(DATA, "guard") }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    w.stdout.on("data", (d) => (out += d)); w.stderr.on("data", (d) => (out += d));
    for (let i = 0; i < 40 && !/Setup site for/.test(out); i++) await sleep(250);
    w.kill("SIGTERM");
    check("guard: a SITE_URL that isn't https or has a path gets a startup warning", /WARNING: SITE_URL http:\/\/setup\.example\.test\/setup is not https/.test(out) && /no path/.test(out), out.split("\n").filter((l) => /WARNING/.test(l)).join(" | ").slice(0, 300));
  }

  // ---------- E: links, CSRF, tunnel origin, rate limits ----------
  {
    const code = A.link.split("/").pop();
    const r = await fetch(`${SITE}/download/${code}`, { redirect: "manual" });
    check("E: old /download/<code> link redirects to /setup/<code>", r.status === 308 && r.headers.get("location") === `/setup/${code}`, `${r.status} ${r.headers.get("location")}`);
    const bad = await fetch(`${SITE}/setup/AAAAAAAAAAAAAAAAAAAAAA`);
    const badHtml = await bad.text();
    check("E: a bad code gets the 'link isn't valid' page (404)", bad.status === 404 && /isn(&#39;|&#x27;|'|’)t valid/.test(badHtml), `${bad.status} ${(badHtml.match(/<h1>[^<]*/) || [""])[0]}`);
    const noTok = await fetch(`${A.link}/a/start`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: SITE }, body: "t=x" });
    check("E: POST without the session's CSRF token is refused (403)", noTok.status === 403);
    const pg = await newPage(browser);
    await pg.goto(A.link);
    const tok = await pg.$eval("input[name=t]", (e) => e.value);
    const cookie = (await pg.cookies()).find((c) => c.name === "ws");
    const post = (origin, extra = {}, t = tok) => fetch(`${A.link}/a/start`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, Cookie: `ws=${cookie.value}`, ...extra }, body: `t=${t}&v=welcome` });
    check("E: POST from another origin is refused even with a valid token (403)", (await post("https://evil.example")).status === 403);
    check("E: same POST from our origin with the token works (303)", (await post(SITE)).status === 303);
    check("E: session cookie is HttpOnly and SameSite=Lax", cookie.httpOnly && cookie.sameSite === "Lax");
    const fwd = { "X-Forwarded-Host": "wiz-tunnel.example.test", "X-Forwarded-Proto": "https" };
    const tun = await post("https://wiz-tunnel.example.test", fwd);
    check("E: POST through a tunnel (Origin = X-Forwarded-Host + Proto, not SITE_URL) is accepted (303)", tun.status === 303, String(tun.status));
    check("E: behind that tunnel, another origin is still refused (403)", (await post("https://evil.example", fwd)).status === 403);
    check("E: behind that tunnel, a POST without the CSRF token is still refused (403)", (await post("https://wiz-tunnel.example.test", fwd, "wrong")).status === 403);
    await pg.close();
    admin("reset", A.link); // the POSTs above moved A past Welcome
    const alt = A.link.replace("//localhost:", "//127.0.0.1:");
    const pg2 = await newPage(await browser.createBrowserContext());
    await pg2.goto(alt, { waitUntil: "load" });
    await submit(pg2, "start");
    check("E: the wizard works in a browser opened on a different address than SITE_URL (no 403)", (await h1(pg2)) === "Name your brand", await h1(pg2));
    check("E: no 'Skip (preview)' links without PREVIEW_JUMP", !(await pg2.$$eval("a", (as) => as.some((a) => /Skip \(preview\)/.test(a.textContent)))));
    await pg2.close();
    await sleep(300);
    check("E: the site logs a clear warning when a form arrives from an address other than SITE_URL", /WARNING: a form was posted from \S+, but SITE_URL is/.test(readFileSync(procLog, "utf8")));
    admin("reset", A.link);
    let limited = 0;
    for (let i = 0; i < 25; i++) { const r = await fetch(`${SITE}/setup/B${String(i).padStart(21, "x")}`); if (r.status === 429) limited++; }
    check("E: guessing codes is rate limited per IP (429 after 20 bad lookups a minute)", limited >= 4, `${limited} of 25 got 429`);
  }

  // ---------- A and B in parallel ----------
  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  let pA = await newPage(ctxA);
  const pB = await newPage(ctxB);
  await setupBuyer(pA, A, (n) => shot(pA, `A-${n}`));
  await fetch(`${MOCK}/_mock/rail/fail-next-deploy`, { method: "POST", body: 'error: Could not resolve "./missing-module" (test switch)' });
  await submit(pA, "install-start");
  await shot(pA, "A-install-creating");
  const runB = (async () => {
    await setupBuyer(pB, B, (n) => (/domain-email-records|install-summary/.test(n) ? shot(pB, `B-${n}`) : Promise.resolve()));
    await submit(pB, "install-start");
    await until(pB, "B's app records", async () => (await pB.$$eval(".recbox table.records tbody tr", (r) => r.length).catch(() => 0)) === 2, 240_000);
    const recs = await tableRows(pB, ".recbox table.records tbody tr");
    check("B: shows the two Railway records to add (CNAME app.<domain> and the TXT check)", recs.some((r) => r.type === "CNAME" && r.name === "app.bravo-clinic.test" && /\.up\.railway\.app$/.test(r.value)) && recs.some((r) => r.type === "TXT" && /^railway-verify=/.test(r.value)), JSON.stringify(recs));
    await shot(pB, "B-install-add-app-records");
    const cn = recs.find((r) => r.type === "CNAME");
    await addRegistrar({ type: "CNAME", name: cn.name, value: "wrong-target.example.net" });
    await until(pB, "B sees the wrong record", async () => /Found wrong-target\.example\.net instead/.test(await text(pB, ".recbox")), 12 * 60_000);
    check("B: a wrong record shows what DNS answers instead, still Waiting", /Waiting/.test(await text(pB, ".recbox")), await text(pB, ".recbox"));
    await shot(pB, "B-install-wrong-record");
    for (const r of recs) await addRegistrar(r);
    await until(pB, "B done", async () => (await h1(pB)) === "Your agency is live", 30 * 60_000);
    check("B: install finished on the add-records-yourself path", true);
    await shot(pB, "B-done");
  })().catch((e) => check("B: flow", false, e.message));

  await until(pA, "A's first build to fail", async () => /stopped/.test(await h1(pA)), 5 * 60_000);
  check("A: a failed build shows Railway's reason in one line, with Try again and Delete the project", /Railway couldn't build the app/.test(await text(pA, ".notice.err")) && !!(await pA.$("form[action$='/a/install-retry']")) && !!(await pA.$("form[action$='/a/server-delete']")), await text(pA, ".notice.err"));
  await shot(pA, "A-install-failed");
  await submit(pA, "install-retry");
  check("A: Try again builds again in the same Railway project", /same Railway project/.test(await flash(pA)), await flash(pA));
  await until(pA, "A retry building", async () => /attempt 2/.test(await text(pA, ".status")), 5 * 60_000);
  const projA = (await mockState()).railway.filter((x) => x.name === A.brand);
  check("A: still one project after the retry (same database and settings)", projA.length === 1, String(projA.length));
  await shot(pA, "A-install-building");
  // Close the tab and restart our site mid-build: nothing should be lost.
  const urlA = pA.url();
  await pA.close();
  await stopSite();
  log("site stopped mid-build; restarting in 5s");
  await sleep(5000);
  await startSite();
  pA = await newPage(ctxA);
  await pA.goto(urlA.split("?")[0], { waitUntil: "load" });
  check("A: reopening the link after closing the tab (and a site restart) shows the install still going", /Setting up|is running|live/.test(await h1(pA)), await h1(pA));
  await until(pA, "A running", async () => /is running|live/.test(await h1(pA)), 20 * 60_000);
  if (/is running/.test(await h1(pA))) await shot(pA, "A-install-running-temp-address");
  await until(pA, "A done", async () => (await h1(pA)) === "Your agency is live", 10 * 60_000);
  await shot(pA, "A-done");
  const tempA = await pA.$eval(".live .hint a", (a) => a.href.replace(/\/$/, "")).catch(() => "");

  // ---------- what A's Railway project got ----------
  const stA = await mockState();
  const pjA = stA.railway.find((x) => x.name === A.brand);
  const appA = pjA?.services.find((s) => s.name === "app");
  const pgA = pjA?.services.find((s) => s.name === "Postgres");
  check("A: Railway project has Postgres (image + volume) and the app (deploy/Dockerfile, health check)", pgA?.image?.includes("postgres") && pgA?.volume === "/var/lib/postgresql/data" && appA?.settings?.dockerfilePath === "deploy/Dockerfile" && appA?.settings?.healthcheckPath === "/api/health", JSON.stringify({ pg: pgA?.image, vol: pgA?.volume, app: appA?.settings }));
  check("A: the app's variables are all there", ["PRODUCT_NAME", "BRAND_LOGO_PNG", "BRAND_COLOUR", "PUBLIC_URL", "FIRST_ADMIN_EMAIL", "TELNYX_API_KEY", "SMTP_URL", "MAIL_FROM", "MAILBOX_KEY", "SINGLE_AGENCY", "DATABASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].every((k) => appA?.variables.includes(k)), appA?.variables.join(","));
  check("A: the app sends email with a send-only Resend key, never the Full access key", appA?.smtpKey === "send-only", appA?.smtpKey);
  check("A: Cloudflare got the app's CNAME (DNS only) and TXT check", stA.zones.find((z) => z.name === A.zone).records.some((r) => r.type === "CNAME" && r.name === "app.alpha-reception.test" && !r.proxied) && stA.zones.find((z) => z.name === A.zone).records.some((r) => /^_railway-verify\./.test(r.name)));

  // ---------- secrets gone ----------
  const idA = JSON.parse(sqlite("select id from buyers where email='alice@example.com'"))[0].id;
  const left = JSON.parse(sqlite(`select name from secrets where buyer_id=${idA}`));
  check("A: no secrets left in SQLite after success", left.length === 0, JSON.stringify(left));
  const kept = JSON.parse(JSON.parse(sqlite(`select data from setups where buyer_id=${idA}`))[0].data);
  check("A: kept only brand/owner, domain, Railway project id and addresses, timestamps", kept.domain.host === "app.alpha-reception.test" && kept.rw?.projectId && kept.tempUrl && kept.installedAt && kept.purgedAt && !kept.rw.records && !kept.email.resend.records);
  await runB;
  const files = readdirSync(DATA).filter((f) => f.startsWith("site.db")).map((f) => readFileSync(join(DATA, f)));
  const plain = ["mock-rail-token-ok", "mock-cf-token-ok", "re_mock_full_access_key", "platform-fake-alice-0001", "mock-google-secret-1234", "platform-fake-bob-0002"];
  const found = plain.filter((s) => files.some((b) => b.includes(Buffer.from(s))));
  check("A+B: no secret appears in plaintext anywhere in site.db / WAL", found.length === 0, found.join(","));
  const allSecrets = JSON.parse(sqlite("select buyer_id, name from secrets"));
  check("A+B: secrets table holds nothing for either finished buyer", !allSecrets.some((r) => r.buyer_id === idA || r.buyer_id === idA + 1), JSON.stringify(allSecrets));
  const logA = await pA.$eval("#log", (e) => e.textContent).catch(() => "");
  check("A: build log kept on the Done page, with no secrets in it", logA.length > 100 && !plain.some((s) => logA.includes(s)), `${logA.length} chars`);

  // ---------- the installed apps ----------
  if (tempA) await appCheck("A", tempA, A.brand, { name: "Alice Alpha", email: A.owner, password: "correct horse battery 9", logo: true, colour: A.colour }); else check("A: Done page shows the temporary address", false);
  const keptB = JSON.parse(JSON.parse(sqlite("select data from setups where buyer_id=(select id from buyers where email='bob@example.com')"))[0].data);
  const appB = (await mockState()).railway.find((x) => x.name === B.brand)?.services.find((x) => x.name === "app");
  check("B: no logo chosen, so no BRAND_LOGO_PNG setting is sent (colour still is)", !!appB && !appB.variables.includes("BRAND_LOGO_PNG") && appB.variables.includes("BRAND_COLOUR"), appB?.variables.join(","));
  if (keptB.phase === "done") await appCheck("B", keptB.tempUrl, B.brand, { name: "Bob Bravo", email: B.owner, password: "correct horse battery 9" });

  // ---------- C: Delete the project (its app records are never added, so it waits) ----------
  {
    const p = await newPage(await browser.createBrowserContext());
    await setupBuyer(p, C);
    await submit(p, "install-start");
    await until(p, "C running", async () => /is running/.test(await h1(p)), 15 * 60_000);
    await shot(p, "C-running-waiting-for-records");
    const containers = (await mockState()).railway.find((x) => x.name === C.brand).services.map((s) => s.container);
    p.on("dialog", (d) => d.accept());
    await submit(p, "server-delete");
    await sleep(500);
    const still = execFileSync("docker", ["ps", "-a", "--format", "{{.Names}}"]).toString().split("\n").filter((n) => containers.includes(n));
    const after = (await mockState()).railway.filter((x) => x.name === C.brand);
    check("C: Delete the project removes it from Railway (app + database gone) and returns to the Install summary", after.length === 0 && still.length === 0 && /Project deleted/.test(await flash(p)) && (await h1(p)) === "Ready to install", `${await flash(p)} | left: ${still.join(",")}`);
    await shot(p, "C-project-deleted");
  }

  // ---------- D: read-only token, existing record, nameservers pending, per-buyer limit ----------
  {
    const p = await newPage(await browser.createBrowserContext());
    await p.goto(D.link);
    await submit(p, "start");
    await submit(p, "brand", { productName: "Delta Desk", ownerEmail: "dan@delta.test" });
    await submit(p, "railway", { token: "mock-rail-token-ok" });
    await submit(p, "phones", { key: "platform-fake-dan-0004" });
    await submit(p, "email", { key: "re_mock_full_access_key", address: "hello@delta-reception.test" });
    await submit(p, "domain", { domain: "delta-reception.test", mode: "cloudflare", token: "mock-cf-token-readonly" });
    check("D: a token without DNS: Edit is caught before anything is built", /can't change its DNS records/.test(await flash(p)), await flash(p));
    await shot(p, "D-domain-token-cant-edit");
    await submit(p, "domain", { domain: "delta-reception.test", mode: "cloudflare", token: "mock-cf-token-ok" });
    check("D: an existing record at app.<domain> asks before replacing it", /already points somewhere/.test(await text(p, ".notice.warn")) && !!(await p.$("input[name=replace]")), await text(p, ".notice.warn"));
    await shot(p, "D-domain-replace-existing");
    await submit(p, "domain", { domain: "delta-reception.test", mode: "cloudflare", replace: "1" });
    check("D: agreeing to replace it moves on", (await h1(p)) === "Optional extras", await h1(p));
    const D2 = linkOf(admin("add-buyer", "Gina Gamma", "gina@example.com"));
    const q = await newPage(await browser.createBrowserContext());
    await q.goto(D2);
    await submit(q, "start");
    await submit(q, "brand", { productName: "Gamma Desk", ownerEmail: "gina@gamma.test" });
    await submit(q, "railway", { token: "mock-rail-token-ok" });
    await submit(q, "phones", { key: "platform-fake-gina-0005" });
    await submit(q, "email", { key: "re_mock_full_access_key", address: "hello@mail.gamma-reception.test" });
    await submit(q, "domain", { domain: "gamma-reception.test", mode: "cloudflare", token: "mock-cf-token-ok" });
    check("D: a domain still waiting for its nameserver change shows the two nameservers", (await h1(q)) === "Switch your nameservers" && /ns\.cloudflare\.com/.test(await text(q, ".ns")), await h1(q));
    await shot(q, "D-domain-waiting-for-nameservers");
    await until(q, "gamma active", async () => /gone through/.test(await flash(q)), 120_000, false);
    check("D: the page notices when the nameserver change goes through", true);
    await shot(q, "D-domain-nameservers-active");
    await submit(q, "domain", { domain: "gamma-reception.test", mode: "cloudflare" });
    check("D: continues once Cloudflare is active", (await h1(q)) === "Optional extras", await h1(q));
    const msg = await q.evaluate(async () => {
      const t = document.querySelector("input[name=t]").value;
      for (let i = 0; i < 20; i++) {
        const r = await fetch(location.pathname.replace(/\/$/, "") + "/a/calendars", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, v: "calendars", googleId: "x.apps.googleusercontent.com", googleSecret: "nope" }) });
        const html = await r.text();
        const m = html.match(/<div class="notice flash err">.*?<div>(.*?)<\/div>/s);
        if (m && /tried that a lot/.test(m[1])) return m[1];
      }
      return "never limited";
    });
    check("D: provider checks are rate limited per buyer", /tried that a lot/.test(msg), msg);
    await q.reload();
    await shot(q, "D-rate-limited");
  }

  // ---------- guide + home ----------
  {
    const p = await newPage(browser);
    await p.goto(`${SITE}/guide`);
    check("guide: has every how-to anchor the wizard links to", await p.evaluate(() => ["cloudflare-domain", "registrar-nameservers", "cloudflare-token", "registrar-dns-records", "railway-token", "telnyx-account", "telnyx-api-key", "resend", "google-oauth", "microsoft-oauth"].every((id) => document.getElementById(id))));
    check("guide: no reseller / sub-agency wording", !/resell|sub-agenc|invite them as agencies/i.test(await p.content()));
    await shot(p, "guide");
    await p.goto(SITE);
    await shot(p, "home");
  }
}

let code = 0;
try {
  await main();
} catch (e) {
  check("e2e run completed", false, e.stack || e.message);
} finally {
  try { await browser?.close(); } catch {}
  try { await fetch(`${MOCK}/_mock/cleanup`, { method: "POST" }); } catch {}
  site?.kill(); mock?.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Screenshots: ${SHOTS}  Data: ${DATA}  Logs: ${procLog}`);
  for (const f of failed) console.log(`FAILED: ${f.name} ${f.detail}`);
  code = failed.length ? 1 : 0;
}
process.exit(code);
