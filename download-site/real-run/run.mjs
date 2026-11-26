// First real buyer install, driven end to end in a browser. Also runs against local fakes.
//
//   REAL (live setup site, real Railway / Telnyx / Resend keys):
//     OWNER_EMAIL=you@example.com NODE_PATH=/home/ronan/aibiz/twin-receptionist/node_modules \
//       node download-site/real-run/run.mjs
//   DRY RUN (starts its own local site + fake providers on free ports, touches nothing real):
//     NODE_PATH=... node download-site/real-run/run.mjs --dry-run
//
// What it does: signs in to the setup site's /admin, makes (or reuses) the "Test Buyer" and its
// private link, drives the wizard step by step (brand, Railway, Telnyx, then every optional extra
// skipped, Install). Only Railway and Telnyx are required, so that is the default path and the agency
// is checked at its Railway address (*.up.railway.app). With --with-email and/or --with-domain it also
// adds Resend and the domain (the "I'll add the records myself" path), prints exactly which DNS
// records to add and polls dig every 30 s until they resolve, prints the install log as it grows,
// then on Done opens the installed dashboard, creates / signs in the owner and checks the brand
// name, logo and colour. Stops at the first failure with one clear message. Safe to rerun: it
// resumes the same buyer link and the wizard picks up wherever it was.
//
// Keys come from files and env vars and are never printed:
//   RAILWAY_TOKEN, RESEND_API_KEY   /home/ronan/aibiz/.secrets/test-install.env (or the environment)
//   TELNYX_API_KEY                  /home/ronan/aibiz/.env (or the environment)
//   admin password                  /home/ronan/aibiz/.secrets/transfer-admin.txt (or ADMIN_PASSWORD)
// Options / env:
//   --with-email         also add Resend (needs RESEND_API_KEY; implies --with-domain: Resend sends from your domain)
//   --with-domain        also add the custom domain app.<TEST_DOMAIN> (manual DNS records, polled with dig)
//   --dry-run            use local fakes (mock/serve.ts) with fake keys; DNS records are "added" by the script
//   OWNER_EMAIL          buyer + owner email (required for a real run; dry run uses owner@chloe-dry.test)
//   TEST_DOMAIN          default t1.chloeeai.co (dashboard goes to app.<TEST_DOMAIN>); dry run default chloeeai.co
//   BRAND_NAME           default "Chloe Test"
//   SETUP_SITE           default https://setup.chloeeai.co
//   ADMIN_EMAIL          default ronanyeats21@gmail.com
//   WAIT_MINUTES         per waiting phase (DNS / Resend / install), default 180
//   POLL_SECONDS         dig / page poll interval, default 30 (dry run 3)
//   --finish-now         if the app is running but its two DNS records never resolve, press "Finish now"
//   --keep               dry run: leave the local site and fake containers running afterwards
//   --shots DIR          where screenshots and summary.json go
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(HERE, "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const argVal = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag("--dry-run");
const WITH_EMAIL = flag("--with-email");
const WITH_DOMAIN = flag("--with-domain") || WITH_EMAIL;
const SECRETS = "/home/ronan/aibiz/.secrets";
const SHOTS = argVal("--shots") || "/tmp/claude-1000/-home-ronan-aibiz/532e431f-da0f-47af-8632-947a62e67253/scratchpad/real-run";
const DOMAIN = (process.env.TEST_DOMAIN || (DRY ? "chloeeai.co" : "t1.chloeeai.co")).toLowerCase();
const ROOT = DOMAIN.split(".").slice(-2).join("."); // the zone you edit at GoDaddy
const BRAND = process.env.BRAND_NAME || "Chloe Test";
const COLOUR = "#0b8f6a";
const WAIT_MS = Number(process.env.WAIT_MINUTES || 180) * 60_000;
const POLL_MS = Number(process.env.POLL_SECONDS || (DRY ? 3 : 30)) * 1000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || (DRY ? "dry-admin@example.test" : "ronanyeats21@gmail.com");
const OWNER_EMAIL = process.env.OWNER_EMAIL || (DRY ? "owner@chloe-dry.test" : "");
mkdirSync(SHOTS, { recursive: true });

const t0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => `[${String(Math.round((Date.now() - t0) / 1000)).padStart(5)}s]`;
const say = (...a) => console.log(stamp(), ...a);

// ---------------- summary ----------------
const summary = { mode: DRY ? "dry-run" : "real", startedAt: new Date().toISOString(), domain: WITH_DOMAIN ? DOMAIN : null, withEmail: WITH_EMAIL, brand: BRAND, steps: [], ok: null, stoppedAt: null, error: null };
const summaryFile = join(SHOTS, DRY ? "summary-dry-run.json" : "summary.json");
const saveSummary = () => writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
class Stop extends Error {}
async function step(name, fn) {
  const t = Date.now();
  say(`>> ${name}`);
  try {
    const detail = (await fn()) || "";
    summary.steps.push({ name, ok: true, detail: String(detail).slice(0, 400), seconds: Math.round((Date.now() - t) / 1000) });
    say(`   PASS ${name}${detail ? `  (${String(detail).slice(0, 200)})` : ""}`);
    saveSummary();
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 600);
    summary.steps.push({ name, ok: false, detail: msg, seconds: Math.round((Date.now() - t) / 1000) });
    summary.ok = false; summary.stoppedAt = name; summary.error = msg;
    saveSummary();
    throw new Stop(`${name}: ${msg}`);
  }
}

// ---------------- files / keys ----------------
function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}
function loadKeys() {
  if (DRY) return { railway: "mock-rail-token-ok", telnyx: "platform-fake-realrun-0001", resend: "re_mock_full_access_key" };
  const f1 = readEnvFile(join(SECRETS, "test-install.env")), f2 = readEnvFile("/home/ronan/aibiz/.env");
  const k = {
    railway: process.env.RAILWAY_TOKEN || f1.RAILWAY_TOKEN || "",
    resend: process.env.RESEND_API_KEY || f1.RESEND_API_KEY || "",
    telnyx: process.env.TELNYX_API_KEY || f2.TELNYX_API_KEY || "",
  };
  const missing = [["RAILWAY_TOKEN", k.railway, `${SECRETS}/test-install.env`], ...(WITH_EMAIL ? [["RESEND_API_KEY", k.resend, `${SECRETS}/test-install.env`]] : []), ["TELNYX_API_KEY", k.telnyx, "/home/ronan/aibiz/.env"]].filter((x) => !x[1]);
  if (missing.length) throw new Error(`missing ${missing.map((m) => `${m[0]} (expected in ${m[2]})`).join(", ")}`);
  return k;
}
function adminPassword() {
  if (DRY) return "dry-run admin password 42";
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const f = join(SECRETS, "transfer-admin.txt");
  if (!existsSync(f)) throw new Error(`no admin password: put it in ${f} or set ADMIN_PASSWORD`);
  const raw = readFileSync(f, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))[0] || "";
  return raw.replace(/^(?:ADMIN_)?PASSWORD\s*[=:]\s*/i, "");
}

// Where the buyer link lives between runs (mode 600).
let STATE_FILE = join(SECRETS, "real-run-state.json");
function loadState() { try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return {}; } }
function saveState(patch) {
  const s = { ...loadState(), ...patch };
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
  chmodSync(STATE_FILE, 0o600);
  return s;
}

// ---------------- a small PNG logo ----------------
function makePng(size, rgb) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = (y) => { const r = Buffer.alloc(1 + size * 3); for (let x = 0; x < size; x++) { const on = ((x >> 5) + (y >> 5)) % 2; r[1 + x * 3] = on ? rgb[0] : 255; r[2 + x * 3] = on ? rgb[1] : 255; r[3 + x * 3] = on ? rgb[2] : 255; } return r; };
  const raw = Buffer.concat(Array.from({ length: size }, (_, y) => row(y)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------- dry run: local site + fakes ----------------
const procs = [];
let SITE = (process.env.SETUP_SITE || "https://setup.chloeeai.co").replace(/\/+$/, "");
let MOCK = "", DNS_LOCAL = "", PORT_BASE = 0, LOCAL_ENV = null, LOCAL_BUNDLE = "";
const freePort = (p) => new Promise((res) => { const s = createServer(); s.once("error", () => res(false)); s.listen(p, "127.0.0.1", () => s.close(() => res(true))); });
async function findBase() {
  for (let b = 4700; b < 5400; b += 40) {
    const ports = [...Array.from({ length: 10 }, (_, i) => b + i), ...Array.from({ length: 10 }, (_, i) => b + 30 + i)];
    if ((await Promise.all(ports.map(freePort))).every(Boolean)) return b;
  }
  throw new Error("no free block of ports found between 4700 and 5400");
}
async function waitUp(url, what) {
  for (let i = 0; i < 120; i++) { try { const r = await fetch(url); if (r.status < 500) return; } catch {} await sleep(250); }
  throw new Error(`${what} didn't start (${url})`);
}
function cleanupDry() {
  for (const p of procs) { try { p.kill("SIGTERM"); } catch {} }
  if (PORT_BASE) {
    const sh = (a) => spawnSync(a[0], a.slice(1), { encoding: "utf8" });
    for (const c of sh(["docker", "ps", "-aq", "--filter", `label=wiz-test-port=${PORT_BASE}`]).stdout.split(/\s+/).filter(Boolean)) sh(["docker", "rm", "-f", c]);
    for (const v of sh(["docker", "volume", "ls", "-q", "--filter", `label=wiz-test-port=${PORT_BASE}`]).stdout.split(/\s+/).filter(Boolean)) sh(["docker", "volume", "rm", v]);
    for (const n of sh(["docker", "network", "ls", "-q", "--filter", `label=wiz-test-port=${PORT_BASE}`]).stdout.split(/\s+/).filter(Boolean)) sh(["docker", "network", "rm", n]);
  }
}
async function startLocal() {
  const bundle = join(SITE_DIR, "../deploy/selfhost/out/selfhost-bundle.tgz");
  if (!existsSync(bundle)) throw new Error(`no app bundle at ${bundle}; run deploy/selfhost/make-bundle.sh first`);
  PORT_BASE = await findBase();
  const data = mkdtempSync(join(process.env.TMPDIR || "/tmp", "real-run-dry-"));
  STATE_FILE = join(data, "real-run-state.json");
  SITE = `http://localhost:${PORT_BASE}`;
  MOCK = `http://127.0.0.1:${PORT_BASE + 1}`;
  DNS_LOCAL = `127.0.0.1:${PORT_BASE + 5}`;
  const base = {
    ...process.env, DATA_DIR: data, SITE_URL: SITE, PORT: String(PORT_BASE), HOST: "127.0.0.1", TMPDIR: data,
    SETUP_SECRET_KEY: randomBytes(32).toString("base64"), MOCK_PORT_BASE: String(PORT_BASE), MOCK_APP_PORTS: `${PORT_BASE + 30}-${PORT_BASE + 39}`,
    DNS_SERVERS: DNS_LOCAL, MOCK_RAILWAY: "1", MOCK_CF: "1", MOCK_RESEND: "1", MOCK_TELNYX: "1", MOCK_OAUTH: "1",
    SUPPORT_EMAIL: "support@example.com", PRODUCT_NAME: "AI Receptionist", CHECKS_PER_10_MIN: "30",
  };
  delete base.PREVIEW_JUMP; delete base.HOSTING; delete base.TEST_SITE;
  const hash = execFileSync("bun", ["admin.ts", "admin-hash"], { cwd: SITE_DIR, env: base, input: adminPassword() + "\n" }).toString().trim().replace(/^ADMIN_PASSWORD_HASH=/, "");
  const env = { ...base, ADMIN_EMAILS: ADMIN_EMAIL, ADMIN_PASSWORD_HASH: hash };
  const logFile = join(data, "procs.log");
  const start = (script, name) => {
    const p = spawn("bun", [script], { cwd: SITE_DIR, env, stdio: ["ignore", "pipe", "pipe"], detached: false });
    const w = (d) => { try { writeFileSync(logFile, `[${name}] ${d}`, { flag: "a" }); } catch {} };
    p.stdout.on("data", w); p.stderr.on("data", w);
    procs.push(p);
  };
  start("mock/serve.ts", "mock");
  await waitUp(`${MOCK}/_mock/state`, "the fake providers");
  start("server.ts", "site");
  await waitUp(`${SITE}/healthz`, "the local setup site");
  execFileSync("bun", ["admin.ts", "publish", bundle, "1.0.0-realrun"], { cwd: SITE_DIR, env });
  LOCAL_ENV = env; LOCAL_BUNDLE = bundle;
  return `local site ${SITE} (ports ${PORT_BASE}-${PORT_BASE + 9}, app ports ${PORT_BASE + 30}-${PORT_BASE + 39}), data ${data}`;
}

// ---------------- DNS (dig) ----------------
const unq = (s) => s.replace(/^"|"$/g, "");
const norm = (type, v) => {
  v = String(v).trim().replace(/\s+/g, " ");
  if (type === "TXT") v = v.split(/"\s*"/).join("").replace(/^"|"$/g, "");
  if (type === "CNAME") v = v.replace(/\.$/, "");
  if (type === "MX") { const [p, ...h] = v.split(" "); v = `${p} ${h.join(" ").replace(/\.$/, "")}`; }
  return v.toLowerCase();
};
function digAnswers(type, name) {
  const servers = DRY ? [DNS_LOCAL] : ["1.1.1.1", "8.8.8.8"];
  const out = [];
  for (const sv of servers) {
    const [host, port] = sv.split(":");
    const a = ["+short", "+time=3", "+tries=1", `@${host}`, ...(port ? ["-p", port] : []), type, name];
    const r = spawnSync("dig", a, { encoding: "utf8" });
    if (r.error) throw new Error("dig isn't installed (apt install dnsutils)");
    out.push(...r.stdout.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => norm(type, l)));
  }
  return [...new Set(out)];
}
/** One line per record: ok / missing / wrong. Returns true when every record resolves to the expected value. */
function checkRecords(recs) {
  let all = true;
  for (const r of recs) {
    const want = norm(r.type, r.type === "MX" && r.prio ? `${r.prio} ${r.value}` : r.value);
    let got = [];
    try { got = digAnswers(r.type, r.name); } catch (e) { throw e; }
    const ok = got.includes(want);
    if (!ok) all = false;
    say(`   dns ${ok ? "OK     " : got.length ? "WRONG  " : "missing"} ${r.type.padEnd(5)} ${r.name}${ok || !got.length ? "" : `  (found ${got.join(" | ").slice(0, 120)})`}`);
  }
  return all;
}
const rel = (name) => (name.endsWith("." + ROOT) ? name.slice(0, -ROOT.length - 1) : name === ROOT ? "@" : name);
function printRecords(title, recs) {
  console.log("");
  console.log("=".repeat(78));
  console.log(` ${title}`);
  console.log(` GoDaddy: My Products > ${ROOT} > DNS > Add New Record. For each row pick the Type,`);
  console.log(` paste Name into "Name" (the part before .${ROOT}) and Value into "Value". TTL default is fine.`);
  console.log("=".repeat(78));
  for (const r of recs) console.log(` ${r.type.padEnd(6)} Name: ${rel(r.name).padEnd(34)} ${r.prio ? `Priority: ${r.prio}  ` : ""}\n        Value: ${r.value}\n        (full name ${r.name})`);
  console.log("=".repeat(78));
  console.log("");
}
async function registrarAdd(recs) {
  for (const r of recs) await fetch(`${MOCK}/_mock/registrar`, { method: "POST", body: JSON.stringify({ type: r.type, name: r.name, content: r.value, priority: r.prio ? Number(r.prio) : undefined }) });
}

// ---------------- browser helpers ----------------
let browser, shotN = 0;
const VIEW = { width: 1000, height: 900, deviceScaleFactor: 1 };
async function shot(p, name) {
  const n = String(++shotN).padStart(2, "0");
  const file = join(SHOTS, `${DRY ? "dry-" : ""}${n}-${name}.png`);
  await p.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}
const text = (p, sel) => p.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
async function screen(p) {
  return p.evaluate(() => {
    const f = document.querySelector("form#main");
    const m = f && f.action.match(/\/a\/([\w-]+)$/);
    return { action: m ? m[1] : "", h1: (document.querySelector("h1")?.textContent || "").replace(/\s+/g, " ").trim(), err: (document.querySelector(".notice.err")?.textContent || "").replace(/\s+/g, " ").trim() };
  });
}
async function submit(p, action, fill = {}) {
  const sel = `form[action$='/a/${action}']`;
  await p.waitForSelector(sel, { timeout: 20000 });
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
  if (missing) throw new Error(`the page has no field "${missing}" in ${action} (the wizard may have changed)`);
  const btn = (await p.$(`${sel} button[type=submit]`)) || (await p.$(`button[form='${await p.$eval(sel, (f) => f.id)}']`));
  await Promise.all([p.waitForNavigation({ waitUntil: "load", timeout: 180000 }), btn.click()]);
}
const tableRows = (p, sel = "table.records tbody tr") => p.$$eval(sel, (rows) => rows.map((r) => {
  const c = r.querySelectorAll("td");
  return { type: c[0].querySelector("b").textContent, prio: (c[0].textContent.match(/priority (\d+)/) || [])[1], name: c[1].querySelector("code").textContent, value: c[2].querySelector("code").textContent };
}));

// ---------------- the run ----------------
const keys = (() => { try { return loadKeys(); } catch (e) { return { error: e.message }; } })();
const pwAdmin = () => adminPassword();

async function adminStage(page) {
  let link = "", st = loadState();
  await step("admin: sign in", async () => {
    await page.goto(`${SITE}/admin`, { waitUntil: "load" });
    if ((await screen(page)).h1 !== "Buyers") {
      await page.type("#email", ADMIN_EMAIL);
      await page.type("#password", pwAdmin());
      await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("button[type=submit]")]);
    }
    const h = await text(page, "h1");
    await shot(page, "admin-buyers");
    if (h !== "Buyers") throw new Error(`admin sign-in failed: ${(await text(page, ".notice.err")) || h}`);
    return `signed in as ${ADMIN_EMAIL}`;
  });
  await step("admin: buyer and setup link", async () => {
    if (st.link) {
      const r = await fetch(st.link, { redirect: "manual" });
      if (r.status !== 200) throw new Error(`the saved setup link (${STATE_FILE}) now answers ${r.status}. Delete that file to make a new buyer, or restore the link in admin.`);
      link = st.link;
      return `reusing the saved link (${STATE_FILE})`;
    }
    // Maybe the buyer exists already (state file lost): find it in the list.
    await page.goto(`${SITE}/admin?q=${encodeURIComponent(OWNER_EMAIL)}`, { waitUntil: "load" });
    const href = await page.$$eval("table.buyers tbody tr", (rows, email) => {
      const r = rows.find((x) => /Test Buyer/.test(x.textContent) && x.textContent.toLowerCase().includes(email.toLowerCase()) && !/revoked/.test(x.textContent));
      return r ? r.querySelector("a[href^='/admin/b/']").getAttribute("href") : "";
    }, OWNER_EMAIL).catch(() => "");
    if (href) {
      await page.goto(`${SITE}${href}`, { waitUntil: "load" });
      link = await text(page, "#setup-link");
      if (!link) throw new Error("found the buyer but not their link");
      saveState({ link, ownerEmail: OWNER_EMAIL });
      return `found the existing buyer in admin (${href})`;
    }
    await page.goto(`${SITE}/admin`, { waitUntil: "load" });
    await page.type("#name", "Test Buyer");
    await page.type("#bemail", OWNER_EMAIL);
    await page.$eval("form[action='/admin/buyers']", (f) => { const c = f.querySelector("input[name=welcome]"); if (c) c.checked = false; });
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("form[action='/admin/buyers'] button[type=submit]")]);
    link = await text(page, "#new-link");
    await shot(page, "admin-buyer-added");
    if (!/\/setup\/[A-Za-z0-9_-]{20,}/.test(link)) throw new Error(`no setup link on the page after adding the buyer: ${await text(page, "h1")} ${await text(page, ".notice")}`);
    saveState({ link, ownerEmail: OWNER_EMAIL });
    return `new buyer made; link saved (mode 600) in ${STATE_FILE}`;
  });
  return link;
}

async function wizardStage(p, link, logo64) {
  await p.goto(link, { waitUntil: "load" });
  const done = new Set();
  const visited = new Set(); // extras already opened from the extras screen
  let last = "", repeats = 0;
  for (let guard = 0; guard < 60; guard++) {
    const sc = await screen(p);
    const id = `${sc.action}|${sc.h1}`;
    if (id === last) { if (++repeats >= 2) throw new Stop(`stuck on "${sc.h1}" (${sc.action || "no form"}): ${sc.err || "no error shown"}. Screenshot: ${await shot(p, "stuck")}`); } else { repeats = 0; last = id; }
    if (sc.h1 === "Your agency is live") return;
    if (/^Setting up |is running$|^The install stopped|^We couldn't set up/.test(sc.h1)) { await installStage(p, sc); continue; }
    const once = async (name, fn) => { if (!done.has(name)) done.add(name); return step(`wizard: ${name}`, async () => { const d = await fn(); const e = await text(p, ".notice.err"); if (e) throw new Error(e); return d; }); };
    switch (sc.action) {
      case "start": await once("welcome", async () => { await shot(p, "welcome"); await submit(p, "start"); }); break;
      case "brand": await once("brand, logo and colour", async () => {
        await p.waitForSelector("#logoFile");
        await p.$eval("#logoFile", (el, b64) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const dt = new DataTransfer(); dt.items.add(new File([bytes], "logo.png", { type: "image/png" }));
          el.files = dt.files; el.dispatchEvent(new Event("change", { bubbles: true }));
        }, logo64);
        const end = Date.now() + 20000; let len = 0;
        while (Date.now() < end) { len = (await p.$eval("#logo", (e) => e.value)).length; if (len > 200) break; await sleep(300); }
        if (!(len > 200 && len <= 30000)) throw new Error(`the page didn't shrink the logo into a small PNG (${len} chars)`);
        await p.$eval("#colour", (e, v) => { e.value = v; }, COLOUR);
        await shot(p, "brand");
        await submit(p, "brand", { productName: BRAND, ownerEmail: OWNER_EMAIL });
        return `brand "${BRAND}", owner ${OWNER_EMAIL}, logo ${len} chars, colour ${COLOUR}`;
      }); break;
      case "railway": await once("Railway token", async () => { await shot(p, "railway"); await submit(p, "railway", { token: keys.railway }); }); break;
      case "phones": await once("Telnyx key", async () => { await shot(p, "telnyx"); await submit(p, "phones", { key: keys.telnyx }); }); break;
      case "email": await once("Resend key and sender", async () => { await shot(p, "email"); await submit(p, "email", { key: keys.resend, address: `hello@mail.${DOMAIN}` }); return `sender hello@mail.${DOMAIN}`; }); break;
      case "domain": await once("domain (add-the-records-myself)", async () => { await shot(p, "domain"); await submit(p, "domain", { domain: DOMAIN, mode: "manual" }); return `${DOMAIN}, dashboard at app.${DOMAIN}`; }); break;
      case "domain-continue": await once("email DNS records", async () => emailRecords(p)); break;
      case "extras-continue": {
        // The optional extras screen: skipped by default; with the flags, open the ones asked for first.
        const want = [WITH_EMAIL && "email", WITH_DOMAIN && "domain"].filter((x) => x && !visited.has(x))[0];
        if (want) { visited.add(want); await step(`wizard: open the ${want} extra`, async () => { await shot(p, "extras"); await p.goto(`${link}?step=${want}`, { waitUntil: "load" }); }); break; }
        await once(WITH_DOMAIN ? "extras added, continue" : "optional extras skipped (Skip all and continue)", async () => { await shot(p, "extras"); await submit(p, "extras-continue"); });
        break;
      }
      case "calendars": await once("calendars (skipped)", async () => { await shot(p, "calendars"); await submit(p, "cal-skip"); }); break;
      case "install-start": await once("install summary and Install", async () => { await shot(p, "install-summary"); await submit(p, "install-start"); }); break;
      default: throw new Stop(`unexpected screen "${sc.h1}" (form: ${sc.action || "none"}): ${sc.err || ""} Screenshot: ${await shot(p, "unexpected")}`);
    }
  }
  throw new Stop("the wizard didn't reach Done after 60 screens");
}

async function emailRecords(p) {
  const recs = await tableRows(p);
  if (!recs.length) { await submit(p, "domain-continue"); return "no email records needed"; }
  await shot(p, "email-records");
  const sendDomain = `mail.${DOMAIN}`;
  const odd = recs.filter((r) => !(r.name === `resend._domainkey.${sendDomain}` || r.name === `send.${sendDomain}` || r.name === `_dmarc.${DOMAIN}` || r.name === `_dmarc.${sendDomain}`));
  if (odd.length) {
    printRecords("THE WIZARD'S RECORD NAMES (NOT SAFE TO ADD)", recs);
    throw new Error(`the wizard built record names that don't match ${sendDomain} (${odd.map((r) => r.name).join(", ")}). Resend gives names relative to the registered root domain and the wizard (providers.ts fqdn) mishandles a zone that is itself a subdomain such as ${DOMAIN}. Don't add these. Use a root domain (TEST_DOMAIN=chloeeai.co) or fix fqdn() first.`);
  }
  printRecords(`ADD THESE ${recs.length} EMAIL RECORDS (they let Resend send as mail.${DOMAIN})`, recs);
  if (DRY) { say("   (dry run: adding them to the fake registrar)"); await registrarAdd(recs); }
  const end = Date.now() + WAIT_MS;
  let verified = false;
  while (Date.now() < end) {
    const all = checkRecords(recs);
    await p.reload({ waitUntil: "load" });
    verified = /Resend verified/.test(await text(p, ".notice.ok"));
    const err = await text(p, ".notice.err");
    if (err) throw new Error(err);
    say(`   email records in DNS: ${all ? "all" : "not yet"}; Resend verified: ${verified ? "yes" : "not yet"}`);
    if (verified) break;
    await sleep(POLL_MS);
  }
  if (!verified) throw new Error(`Resend hadn't verified mail.${DOMAIN} after ${WAIT_MS / 60000} minutes. Add the records above, then rerun this script (it resumes).`);
  await shot(p, "email-verified");
  await submit(p, "domain-continue");
  return "records resolve and Resend verified the domain";
}

async function installStage(p, first) {
  // Runs until Done, a failure, or the time limit. Called with the first install screen already read.
  let printed = "", appRecs = null, lastDig = 0, retried = false, sawProgress = false, finishPressed = false, recsAdded = false;
  const end = Date.now() + WAIT_MS;
  await step("install: monitor until the agency is live", async () => {
    let sc = first;
    while (Date.now() < end) {
      // keep the log printing
      const log = await p.$eval("#log", (e) => e.textContent).catch(() => "");
      if (log !== printed) {
        let add = log;
        if (printed && log.startsWith(printed)) add = log.slice(printed.length);
        else if (printed) { const tail = printed.slice(-200); const i = log.indexOf(tail); add = i >= 0 ? log.slice(i + tail.length) : log; }
        for (const l of add.split("\n").map((x) => x.trimEnd()).filter(Boolean)) console.log(`${stamp()}   | ${l}`);
        printed = log;
      }
      if (sc.h1 === "Your agency is live") { await shot(p, "done"); return "Your agency is live"; }
      if (/^The install stopped|^We couldn't set up/.test(sc.h1)) {
        const why = sc.err || (await text(p, ".notice.err"));
        const f = await shot(p, "install-failed");
        if (!retried && !sawProgress) { retried = true; say(`   the wizard shows a failed install from an earlier run ("${why.slice(0, 160)}"); pressing Try again once`); await submit(p, (await p.$("form[action$='/a/install-retry']")) ? "install-retry" : "install-start").catch(() => {}); sc = await screen(p); continue; }
        throw new Error(`the install failed: ${why}. Screenshot ${f}. The redacted log is above and in /admin. Fix it, then rerun (it will press Try again).`);
      }
      sawProgress = true;
      const recs = await tableRows(p, ".recbox table.records tbody tr").catch(() => []);
      if (recs.length && !appRecs) {
        appRecs = recs;
        await shot(p, "app-records");
        printRecords(`ADD THESE ${recs.length} RECORDS FOR YOUR DASHBOARD (app.${DOMAIN})`, recs);
        if (DRY) { say("   (dry run: adding them to the fake registrar)"); await registrarAdd(recs); recsAdded = true; }
      }
      if (appRecs && Date.now() - lastDig >= POLL_MS) { lastDig = Date.now(); const ok = checkRecords(appRecs); say(`   dashboard records in DNS: ${ok ? "all" : "not yet"}`); }
      if (sc.h1.endsWith("is running") && flag("--finish-now") && !finishPressed && appRecs) {
        // only when asked: skip waiting for the certificate
        finishPressed = true; say("   --finish-now: pressing Finish now"); await submit(p, "install-finish"); sc = await screen(p); continue;
      }
      await sleep(Math.min(POLL_MS, 10_000));
      await p.reload({ waitUntil: "load" }).catch(() => {});
      sc = await screen(p);
    }
    throw new Error(`the install hadn't finished after ${WAIT_MS / 60000} minutes (screen: "${sc.h1}"). Check the records above are in DNS and rerun to keep waiting.`);
  });
}

async function appChecks(page0, ctx, link) {
  const p = page0;
  await p.goto(link, { waitUntil: "load" });
  const urls = await p.$$eval(".live a", (as) => as.map((a) => a.href.replace(/\/$/, "")));
  const finalHost = WITH_DOMAIN ? `https://app.${DOMAIN}` : "";
  const temp = urls.find((u) => !finalHost || !u.startsWith(finalHost)) || urls[0];
  if (!WITH_DOMAIN && !/^https?:\/\/[^/]+\.up\.railway\.app$|^http:\/\/localhost:\d+$/.test(temp || "")) throw new Stop(`the Done page's address isn't Railway's own (${temp})`);
  if (!temp) throw new Stop("no dashboard address on the Done page");
  await shot(p, "done-page");
  const state = loadState();
  let pw = state.ownerPassword;
  if (!pw) { pw = `Rr-${randomBytes(9).toString("base64url")}-9`; saveState({ ownerPassword: pw }); }
  const app = await ctx.newPage();
  await app.setViewport(VIEW);
  app.on("pageerror", (e) => say("   APP PAGE ERROR", e.message));
  let dash = temp;
  await step("dashboard: answers /api/health", async () => {
    let health = "";
    for (let i = 0; i < 20; i++) { health = await fetch(`${temp}/api/health`).then((r) => r.text()).catch((e) => String(e)); if (/"ok":\s*true/.test(health)) break; await sleep(5000); }
    if (!/"ok":\s*true/.test(health)) throw new Error(`${temp}/api/health said: ${health.slice(0, 200)}`);
    return temp;
  });
  await step("dashboard: opens with the brand name", async () => {
    await app.goto(temp, { waitUntil: "networkidle2", timeout: 90000 });
    await shot(app, "dashboard-first-open");
    const title = await app.title();
    if (!title.includes(BRAND)) throw new Error(`the page title is "${title}", not ${BRAND}`);
    return `title "${title}" at ${new URL(app.url()).pathname}`;
  });
  await step("dashboard: owner sign-up or sign-in works", async () => {
    const fillIn = async (sel, v) => { await app.focus(sel); await app.$eval(sel, (e) => e.select()); await app.keyboard.press("Backspace"); await app.type(sel, v); };
    const path = new URL(app.url()).pathname;
    if (/\/signup/.test(path) || (await app.$("#agency"))) {
      const agency = await app.$eval("#agency", (e) => e.value).catch(() => "");
      if (agency !== BRAND) throw new Error(`the first sign-up page has agency name "${agency}", not ${BRAND}`);
      await shot(app, "owner-signup");
      await fillIn("#name", "Test Owner"); await fillIn("#email", OWNER_EMAIL); await fillIn("#password", pw);
      await Promise.all([app.waitForFunction(() => !/\/signup/.test(location.pathname), { timeout: 45000 }), app.click("form button[type=submit]")]).catch(async () => {
        throw new Error(`sign-up didn't leave the page: ${(await app.evaluate(() => document.body.innerText)).slice(0, 200)}`);
      });
      await app.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 }).catch(() => {});
      if (!/\/admin/.test(new URL(app.url()).pathname)) throw new Error(`after sign-up landed on ${app.url()}`);
      return "owner account created and signed in";
    }
    await app.goto(`${temp}/login`, { waitUntil: "networkidle2" });
    await app.waitForSelector("#email", { timeout: 20000 });
    await fillIn("#email", OWNER_EMAIL); await fillIn("#password", pw);
    await Promise.all([app.waitForFunction(() => !/\/login/.test(location.pathname), { timeout: 45000 }), app.click("form button[type=submit]")]).catch(async () => {
      throw new Error(`sign-in failed (an owner account may exist with another password, saved one is in ${STATE_FILE}): ${(await app.evaluate(() => document.body.innerText)).slice(0, 200)}`);
    });
    await app.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 }).catch(() => {});
    return "owner signed in with the saved password";
  });
  await step("dashboard: brand name, logo and colour show", async () => {
    await app.goto(`${temp}/admin`, { waitUntil: "networkidle2", timeout: 60000 });
    const b = await app.evaluate(() => fetch("/api/org/brand", { credentials: "same-origin" }).then((r) => r.json()));
    const logoRes = await app.evaluate((u) => fetch(u).then(async (r) => ({ type: r.headers.get("content-type"), n: (await r.arrayBuffer()).byteLength })), b.logo || "/none");
    if (!(/^\/brand\//.test(b.logo || "") && logoRes.type === "image/png" && logoRes.n > 100)) throw new Error(`logo not installed: ${JSON.stringify({ logo: b.logo, logoRes })}`);
    if (String(b.primaryColor).toLowerCase() !== COLOUR) throw new Error(`colour is ${b.primaryColor}, not ${COLOUR}`);
    const shown = await app.evaluate(() => [...document.images].some((i) => /\/brand\//.test(i.src) && i.naturalWidth > 0));
    const nameShown = await app.evaluate((n) => document.body.innerText.includes(n), BRAND);
    await shot(app, "dashboard-branded");
    if (!shown) throw new Error("the logo image isn't on the dashboard page");
    return `logo ${logoRes.n} bytes, colour ${b.primaryColor}, brand name ${nameShown ? "visible" : "not found in page text (title is right)"}`;
  });
  await step("dashboard: sign out and back in", async () => {
    await app.evaluate(() => fetch("/api/logout", { method: "POST", credentials: "same-origin" }));
    await app.goto(`${temp}/login`, { waitUntil: "networkidle2" });
    await app.waitForSelector("#email", { timeout: 20000 });
    await app.type("#email", OWNER_EMAIL); await app.type("#password", pw);
    await Promise.all([app.waitForFunction(() => !/\/login/.test(location.pathname), { timeout: 45000 }), app.click("form button[type=submit]")]);
    if (!/\/admin/.test(new URL(app.url()).pathname)) throw new Error(`signed in but landed on ${app.url()}`);
    await shot(app, "dashboard-after-login");
    return "ok";
  });
  if (!DRY && WITH_DOMAIN) {
    await step("custom domain: app." + DOMAIN + " (informational)", async () => {
      const r = await fetch(`${finalHost}/api/health`, { signal: AbortSignal.timeout(15000) }).then((x) => x.text()).catch((e) => `unreachable: ${e.cause?.code || e.message}`);
      return /"ok":\s*true/.test(r) ? `${finalHost} answers` : `${finalHost} doesn't answer yet (${r.slice(0, 80)}); fine until the records and certificate are ready`;
    });
  }
  void dash;
}

// ---------------- update your agency (dry run only: needs a second published version) ----------------
async function updateStage(pa, pb, link) {
  const proj = async () => (await fetch(`${MOCK}/_mock/state`).then((r) => r.json())).railway;
  let before;
  await step("update: publish a newer version, see it in admin and on the buyer's Done screen", async () => {
    before = await proj();
    if (before.length !== 1) throw new Error(`expected one Railway project before the update, found ${before.length}`);
    execFileSync("bun", ["admin.ts", "publish", LOCAL_BUNDLE, "1.0.1-realrun", "- A brand new thing\n- Another fix"], { cwd: SITE_DIR, env: LOCAL_ENV });
    await pa.goto(`${SITE}/admin`, { waitUntil: "load" });
    const pill = await pa.$$eval("table.buyers tbody tr", (rows) => rows.map((r) => r.textContent).find((t) => /Test Buyer/.test(t) && /Update available/.test(t)) || "");
    if (!pill) throw new Error("admin's buyer list shows no 'Update available' for the test buyer");
    await pb.bringToFront(); // the dashboard check opened another tab; clicks in a background tab do nothing
    await pb.goto(link, { waitUntil: "load" });
    const t = await text(pb, "main");
    if (!/is on version 1\.0\.0-realrun\. Version 1\.0\.1-realrun is available/.test(t)) throw new Error(`no update banner on the Done screen: ${t.slice(0, 300)}`);
    if (!/A brand new thing/.test(t) || !/Another fix/.test(t)) throw new Error("the release notes aren't shown");
    await shot(pb, "update-banner");
    return "banner and release notes shown; admin shows Update available";
  });
  await step("update: Update now, paste the token again, redeploy to the same project", async () => {
    await submit(pb, "update-open");
    if (!/Update your agency/.test(await text(pb, "h1"))) throw new Error(`expected the update screen, got "${await text(pb, "h1")}"`);
    await shot(pb, "update-token");
    await submit(pb, "update-start", { token: keys.railway });
    const end = Date.now() + WAIT_MS;
    let h1 = "";
    while (Date.now() < end) {
      h1 = await text(pb, "h1");
      if (/^Your agency is live$/.test(h1)) break;
      if (/stopped/.test(h1)) throw new Error(`the update failed: ${await text(pb, ".notice.err")}`);
      await sleep(Math.min(POLL_MS, 5000));
      await pb.reload({ waitUntil: "load" }).catch(() => {});
    }
    if (h1 !== "Your agency is live") throw new Error(`the update hadn't finished after ${WAIT_MS / 60000} minutes (screen "${h1}")`);
    await shot(pb, "update-done");
    const t = await text(pb, "main");
    if (!/now on version 1\.0\.1-realrun|on version 1\.0\.1-realrun, the latest/.test(t)) throw new Error(`Done screen doesn't show the new version: ${t.slice(0, 300)}`);
    const after = await proj();
    const a = after[0], b = before[0];
    if (after.length !== 1 || a.id !== b.id) throw new Error("the update made a new Railway project instead of reusing the old one");
    const svc = (x) => x.services.map((v) => `${v.id}:${v.name}`).sort().join(",");
    if (svc(a) !== svc(b)) throw new Error(`the project's services changed: ${svc(b)} -> ${svc(a)}`);
    const app = a.services.find((v) => v.name === "app"), appB = b.services.find((v) => v.name === "app");
    const lost = appB.variables.filter((k) => !app.variables.includes(k));
    if (lost.length) throw new Error(`the update dropped variables: ${lost.join(", ")}`);
    if (!app.variables.includes("APP_VERSION")) throw new Error("APP_VERSION wasn't added");
    return `same project ${a.id}, same services, ${appB.variables.length} variables kept, version recorded`;
  });
  await step("update: admin shows the new version, token gone", async () => {
    await pa.goto(`${SITE}/admin`, { waitUntil: "load" });
    const row = await pa.$$eval("table.buyers tbody tr", (rows) => rows.map((r) => r.textContent).find((t) => /Test Buyer/.test(t)) || "");
    if (!/1\.0\.1-realrun/.test(row) || /Update available/.test(row)) throw new Error(`admin still shows the old version: ${row.replace(/\s+/g, " ").slice(0, 200)}`);
    return "admin shows 1.0.1-realrun and no pill";
  });
}

// ---------------- main ----------------
let exitCode = 0;
try {
  await step("preflight", async () => {
    if (keys.error) throw new Error(keys.error);
    if (!DRY && !OWNER_EMAIL) throw new Error("set OWNER_EMAIL=the email that will own the test agency (e.g. OWNER_EMAIL=you@example.com)");
    if (!existsSync("/snap/bin/chromium")) throw new Error("/snap/bin/chromium not found");
    if (spawnSync("dig", ["-v"]).error) throw new Error("dig isn't installed (apt install dnsutils)");
    if (DRY) return await startLocal();
    const r = await fetch(`${SITE}/healthz`).catch((e) => ({ ok: false, status: String(e.message) }));
    if (!r.ok) throw new Error(`${SITE}/healthz answered ${r.status}`);
    return `${SITE} is up; keys present (not shown); domain ${DOMAIN}; state file ${STATE_FILE}`;
  });
  browser = await puppeteer.launch({ executablePath: "/snap/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const ctxAdmin = await browser.createBrowserContext();
  const pa = await ctxAdmin.newPage();
  await pa.setViewport(VIEW);
  pa.on("pageerror", (e) => say("   PAGE ERROR", e.message));
  const link = await adminStage(pa);
  const ctxBuyer = await browser.createBrowserContext();
  const pb = await ctxBuyer.newPage();
  await pb.setViewport(VIEW);
  pb.on("pageerror", (e) => say("   PAGE ERROR", e.message));
  pb.on("dialog", (d) => d.accept());
  const logo64 = makePng(256, [11, 143, 106]).toString("base64");
  await wizardStage(pb, link, logo64);
  await appChecks(pb, ctxBuyer, link);
  if (DRY) await updateStage(pa, pb, link);
  summary.ok = true;
  saveSummary();
  console.log("");
  say(`ALL STEPS PASSED (${summary.steps.length}). Summary: ${summaryFile}`);
} catch (e) {
  exitCode = 1;
  if (summary.ok === null) { summary.ok = false; summary.error = String(e.message).slice(0, 600); summary.stoppedAt = summary.stoppedAt || "unknown"; saveSummary(); }
  console.log("");
  say(`STOPPED at "${summary.stoppedAt}": ${summary.error}`);
  say(`Summary: ${summaryFile}   Screenshots: ${SHOTS}`);
  if (!DRY) say(`Nothing is lost: rerun the same command and it resumes this buyer (its link is in ${STATE_FILE}).`);
} finally {
  try { await browser?.close(); } catch {}
  if (DRY && !flag("--keep")) cleanupDry();
  else if (DRY) say(`--keep: local site ${SITE} and the fakes are still running (ports ${PORT_BASE}-${PORT_BASE + 9}); stop them yourself`);
  process.exit(exitCode);
}
