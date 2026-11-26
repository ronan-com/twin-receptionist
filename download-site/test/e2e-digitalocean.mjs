// DigitalOcean variant (HOSTING=digitalocean) of the end-to-end test. Railway is the default
// and is covered by e2e.mjs; this one needs the privileged dind "droplet" image.
// Full local end-to-end test of the hosted setup wizard. No real provider is called:
// MOCK_DO/CF/RESEND/TELNYX/OAUTH point everything at mock/serve.ts, and every "droplet" is a
// privileged wiz-test-droplet-* container where the real deploy/selfhost/install.sh runs.
//   bash download-site/test/run-e2e.sh        (sets up the network and image, runs this, cleans up)
// Scenarios:
//   A  Cloudflare path, desktop + 390px screenshots of every step, provider errors, a failed
//      install then retry on the same server, tab closed + site restarted mid-install, done,
//      secrets gone, app answers inside the droplet with the brand in the title.
//   B  "add the records yourself" path, in parallel with A, to done.
//   C  server create error, then delete the server while it waits for DNS.
//   D  nameservers pending -> active, read-only Cloudflare token, per-buyer check rate limit.
//   E  bad code, old link redirect, CSRF, per-IP rate limit.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(HERE, "..");
const SHOTS = join(SITE_DIR, "test-shots");
const PORT = Number(process.env.E2E_PORT || 4520);
const SITE = `http://localhost:${PORT}`;
const MOCK = `http://127.0.0.1:${PORT + 1}`;
const GATEWAY = process.env.E2E_GATEWAY || "172.31.247.1";
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
  log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  return !!cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- processes ----------------
const env = {
  ...process.env, HOSTING: "digitalocean", MOCK_RAILWAY: "0", DATA_DIR: DATA, SITE_URL: SITE, PORT: String(PORT), HOST: "127.0.0.1",
  EXTRA_LISTEN: `${GATEWAY}:${PORT}`, PROVISION_URL: `http://${GATEWAY}:${PORT}`, SETUP_SECRET_KEY: KEY,
  MOCK_PORT_BASE: String(PORT), DNS_SERVERS: `127.0.0.1:${PORT + 5}`,
  MOCK_DO: "1", MOCK_CF: "1", MOCK_RESEND: "1", MOCK_TELNYX: "1", MOCK_OAUTH: "1",
  CHECKS_PER_10_MIN: "15", LOOKUPS_PER_MINUTE: "20", SUPPORT_EMAIL: "support@example.com", PRODUCT_NAME: "AI Receptionist",
};
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
const sqlite = (sql) => {
  // Read the DB the way an attacker with a copy of it would: plain sqlite3.
  return execFileSync("bun", ["-e", `const {Database}=require("bun:sqlite");const d=new Database(${JSON.stringify(join(DATA, "site.db"))},{readonly:true});console.log(JSON.stringify(d.query(${JSON.stringify(sql)}).all()))`]).toString();
};

// ---------------- browser helpers ----------------
let browser;
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1 };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2 }; // not isMobile: switching that reloads the page
async function newPage(ctx) {
  const p = await ctx.newPage();
  await p.setViewport(DESKTOP);
  p.on("pageerror", (e) => log("PAGE ERROR", e.message));
  return p;
}
let shotN = 0;
async function shot(p, name) {
  const n = String(++shotN).padStart(2, "0");
  const overflow = [];
  for (const [label, vp] of [["desktop", DESKTOP], ["phone", PHONE]]) {
    await p.setViewport(vp);
    await sleep(120);
    if (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) overflow.push(label);
    await p.screenshot({ path: join(SHOTS, `${n}-${name}-${label}.png`), fullPage: true });
  }
  await p.setViewport(DESKTOP);
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

// Walk a buyer through to the Install screen.
async function setupBuyer(p, o, snap = async () => {}) {
  await p.goto(o.link, { waitUntil: "load" });
  await snap("welcome");
  await submit(p, "start");
  await snap("brand");
  await submit(p, "brand", { productName: o.brand, ownerEmail: o.owner });
  await snap("domain");
  if (o.manual) {
    await submit(p, "domain", { domain: o.zone, mode: "manual" });
  } else {
    if (o.errors) {
      await submit(p, "domain", { domain: o.zone, mode: "cloudflare", token: "not-a-real-token" });
      check("A: bad Cloudflare token: one clear sentence", /didn't accept that token/.test(await flash(p)), await flash(p));
      await snap("domain-bad-token");
    }
    await submit(p, "domain", { domain: o.zone, mode: "cloudflare", token: "mock-cf-token-ok" });
  }
  check(`${o.tag}: reached the Server step`, (await h1(p)) === "Your server", await h1(p));
  await snap("server");
  check(`${o.tag}: Sydney and the 2 GB size are preselected`, (await p.$eval("#region", (e) => e.value)) === "syd1" && (await p.$eval("#size", (e) => e.value)) === "s-2vcpu-2gb");
  if (o.errors) {
    await submit(p, "server", { token: "mock-do-token-readonly" });
    check("A: read-only DigitalOcean token refused with the write-scope message", /can only read/.test(await flash(p)), await flash(p));
    await snap("server-readonly-token");
    await submit(p, "server", { token: "mock-do-token-nolimit" });
    check("A: DigitalOcean account without a payment method gets a clear message", /payment method/.test(await flash(p)), await flash(p));
  }
  await submit(p, "server", { token: "mock-do-token-ok", ...(o.sshKey ? { sshPublicKey: o.sshKey } : {}) });
  check(`${o.tag}: reached Phones`, (await h1(p)) === "Connect your Telnyx account", await h1(p));
  await snap("phones");
  check(`${o.tag}: Phones is just the Telnyx key (no "who pays" choice)`, !(await p.$("input[name=pays]")) && /Telnyx account/.test(await text(p, ".lead")), await text(p, ".lead"));
  if (o.errors) {
    await submit(p, "phones", { key: "KEY0123456789ABCDEF0123456789_abcdefghijkl" });
    check("A: an unknown Telnyx key is refused (and never sent anywhere in test mode)", /didn't accept that key/.test(await flash(p)), await flash(p));
    await snap("phones-bad-key");
  }
  await submit(p, "phones", { key: o.telnyx });
  check(`${o.tag}: reached Email`, (await h1(p)) === "Send email from your domain", await h1(p));
  await snap("email");
  if (o.errors) {
    await submit(p, "email", { key: "re_mock_sending_only_key" });
    check("A: a send-only Resend key gets the Full access message", /Full access/.test(await flash(p)), await flash(p));
  }
  await submit(p, "email", { key: "re_mock_full_access_key" });
  if (o.manual) {
    await snap("email-records-to-add");
    const recs = await tableRows(p);
    check(`${o.tag}: email records shown to add by hand (DKIM, MX, SPF, DMARC)`, recs.length === 4 && recs.some((r) => r.type === "MX") && recs.some((r) => /^_dmarc\./.test(r.name)), JSON.stringify(recs.map((r) => `${r.type} ${r.name}`)));
    for (const r of recs.slice(0, 2)) await addRegistrar(r);
    await until(p, "first two records ticked", async () => (await p.$$eval("table.records .st.f", (x) => x.length)) >= 2, 90_000);
    await snap("email-records-partly-found");
    for (const r of recs.slice(2)) await addRegistrar(r);
  } else {
    await snap("email-verifying");
  }
  await until(p, "Resend verified", async () => (await h1(p)) === "Email is ready", 150_000);
  await sleep(2500); await p.reload({ waitUntil: "load" });
  check(`${o.tag}: Resend verified and the test email went out by itself`, /We sent a test email/.test(await text(p, ".notice.ok")), await text(p, ".notice.ok"));
  await snap("email-ready");
  await submit(p, "email-continue");
  await snap("calendars");
  if (o.google) {
    await submit(p, "calendars", { googleId: "1234-abc.apps.googleusercontent.com", googleSecret: "nope" });
    check(`${o.tag}: wrong Google secret refused`, /Google didn't recognise/.test(await flash(p)), await flash(p));
    await submit(p, "calendars", { googleId: "1234-abc.apps.googleusercontent.com", googleSecret: "mock-google-secret-1234" });
  } else {
    await submit(p, "cal-skip");
  }
  check(`${o.tag}: reached Install`, (await h1(p)) === "Ready to install", await h1(p));
  await snap("install-summary");
}

async function appCheck(tag, dropletIp, host, brand) {
  const container = (await mockState()).droplets.find((d) => d.ip === dropletIp)?.container;
  const ca = join(DATA, `${tag}-ca.crt`);
  writeFileSync(ca, execFileSync("docker", ["exec", container, "cat", "/opt/receptionist/run/test-ca.crt"]));
  const curl = (path) => execFileSync("curl", ["-fsS", "--max-time", "15", "--cacert", ca, "--resolve", `${host}:443:${dropletIp}`, `https://${host}${path}`]).toString();
  const health = curl("/api/health");
  check(`${tag}: installed app answers https://${host}/api/health inside the droplet (Caddy internal TLS)`, /"ok":\s*true/.test(health), health.trim());
  const title = (curl("/").match(/<title>([^<]*)<\/title>/) || [])[1];
  check(`${tag}: installed app's page title is the brand`, title === brand, title);
  const env = execFileSync("docker", ["exec", container, "sh", "-c", "stat -c %a /opt/receptionist/.env; ls /opt/receptionist/setup"]).toString();
  check(`${tag}: .env is mode 600 and the setup token/settings files are gone from the server`, env.startsWith("600") && !/token|settings\.env|site\b/.test(env.split("\n").slice(1).join(" ")), env.replace(/\n/g, " "));
  // And in a real browser, with the brand on screen.
  const b2 = await puppeteer.launch({ executablePath: "/snap/bin/chromium", headless: true, args: ["--no-sandbox", `--host-resolver-rules=MAP ${host} ${dropletIp}`, "--ignore-certificate-errors"] });
  const pg = await b2.newPage();
  await pg.setViewport(DESKTOP);
  await pg.goto(`https://${host}/`, { waitUntil: "networkidle2", timeout: 60000 });
  check(`${tag}: installed app opens in a browser with the brand in its title`, (await pg.title()).includes(brand), await pg.title());
  await pg.screenshot({ path: join(SHOTS, `${tag === "A" ? "40" : "41"}-installed-app-${tag}-desktop.png`) });
  await pg.setViewport(PHONE);
  await pg.screenshot({ path: join(SHOTS, `${tag === "A" ? "40" : "41"}-installed-app-${tag}-phone.png`) });
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
  const A = { tag: "A", link: linkOf(admin("add-buyer", "Alice Alpha", "alice@example.com")), brand: "Alpha Answering", owner: "alice@alpha-reception.test", zoneId: "z-alpha", zone: "alpha-reception.test", telnyx: "platform-fake-alice-0001", errors: true, google: true, sshKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBmockmockmockmockmockmockmockmockmockmockmo alice@laptop" };
  const B = { tag: "B", link: linkOf(admin("add-buyer", "Bob Bravo", "bob@example.com")), brand: "Bravo Clinic Desk", owner: "bob@bravo-clinic.test", zone: "bravo-clinic.test", manual: true, telnyx: "platform-fake-bob-0002" };
  const C = { tag: "C", link: linkOf(admin("add-buyer", "Cara Charlie", "cara@example.com")), brand: "Charlie Calls", owner: "cara@charlie-desk.test", zone: "charlie-desk.test", manual: true, telnyx: "platform-fake-cara-0003" };
  const D = { tag: "D", link: linkOf(admin("add-buyer", "Dan Delta", "dan@example.com")) };
  await startSite();
  check("admin add-buyer prints a /setup/<code> link", /\/setup\/[A-Za-z0-9_-]{22}$/.test(A.link), A.link);
  {
    // PREVIEW_JUMP must never work on a real site: without a MOCK_* switch the site won't start.
    const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !/^MOCK_|^EXTRA_LISTEN$/.test(k)));
    const r = spawnSync("bun", ["server.ts"], { cwd: SITE_DIR, env: { ...clean, PREVIEW_JUMP: "1", PORT: String(PORT + 9), DATA_DIR: join(DATA, "guard") }, timeout: 20000 });
    check("guard: PREVIEW_JUMP=1 without any MOCK_* switch refuses to start", r.status === 1 && /PREVIEW_JUMP=1 is for test sites only/.test(String(r.stderr)), `exit ${r.status} ${String(r.stderr).trim().slice(0, 120)}`);
    // A production-looking start with a bad SITE_URL prints a clear warning (then we stop it).
    const w = spawn("bun", ["server.ts"], { cwd: SITE_DIR, env: { ...clean, SITE_URL: "http://setup.example.test/setup", PORT: String(PORT + 9), DATA_DIR: join(DATA, "guard") }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    w.stdout.on("data", (d) => (out += d)); w.stderr.on("data", (d) => (out += d));
    for (let i = 0; i < 40 && !/Setup site for/.test(out); i++) await sleep(250);
    w.kill("SIGTERM");
    check("guard: a SITE_URL that isn't https or has a path gets a startup warning", /WARNING: SITE_URL http:\/\/setup\.example\.test\/setup is not https/.test(out) && /no path/.test(out), out.split("\n").filter((l) => /WARNING/.test(l)).join(" | ").slice(0, 300));
  }
  browser = await puppeteer.launch({ executablePath: "/snap/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-gpu"] });

  // ---------- E: links, CSRF, rate limits ----------
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
    const evil = await fetch(`${A.link}/a/start`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example", Cookie: `ws=${cookie.value}` }, body: `t=${tok}` });
    check("E: POST from another origin is refused even with a valid token (403)", evil.status === 403);
    const good = await fetch(`${A.link}/a/start`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: SITE, Cookie: `ws=${cookie.value}` }, body: `t=${tok}&v=welcome` });
    check("E: same POST from our origin with the token works (303)", good.status === 303);
    check("E: session cookie is HttpOnly and SameSite=Lax", cookie.httpOnly && cookie.sameSite === "Lax");
    // Behind a tunnel or proxy whose public address isn't SITE_URL (what Ronan hit): the
    // browser's Origin matches X-Forwarded-Host + X-Forwarded-Proto, so it's accepted.
    const post = (origin, extra = {}) => fetch(`${A.link}/a/start`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, Cookie: `ws=${cookie.value}`, ...extra }, body: `t=${tok}&v=welcome` });
    const tun = await post("https://wiz-tunnel.example.test", { "X-Forwarded-Host": "wiz-tunnel.example.test", "X-Forwarded-Proto": "https" });
    check("E: POST through a tunnel (Origin = X-Forwarded-Host + Proto, not SITE_URL) is accepted (303)", tun.status === 303, String(tun.status));
    const tunEvil = await post("https://evil.example", { "X-Forwarded-Host": "wiz-tunnel.example.test", "X-Forwarded-Proto": "https" });
    check("E: behind that tunnel, another origin is still refused (403)", tunEvil.status === 403, String(tunEvil.status));
    const tunNoTok = await fetch(`${A.link}/a/start`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://wiz-tunnel.example.test", "X-Forwarded-Host": "wiz-tunnel.example.test", "X-Forwarded-Proto": "https", Cookie: `ws=${cookie.value}` }, body: "t=wrong" });
    check("E: behind that tunnel, a POST without the CSRF token is still refused (403)", tunNoTok.status === 403, String(tunNoTok.status));
    // A real browser on an address other than SITE_URL (127.0.0.1 instead of localhost).
    const alt = A.link.replace("//localhost:", "//127.0.0.1:");
    const pg2 = await newPage(await browser.createBrowserContext());
    await pg2.goto(alt, { waitUntil: "load" });
    await submit(pg2, "start");
    check("E: the wizard works in a browser opened on a different address than SITE_URL (no 403)", (await h1(pg2)) === "Name your brand", await h1(pg2));
    check("E: no 'Skip (preview)' links without PREVIEW_JUMP", !(await pg2.$$eval("a", (as) => as.some((a) => /Skip \(preview\)/.test(a.textContent)))));
    await pg2.close();
    await sleep(300);
    check("E: the site logs a clear warning when a form arrives from an address other than SITE_URL", /WARNING: a form was posted from http:\/\/127\.0\.0\.1:\d+, but SITE_URL is/.test(readFileSync(procLog, "utf8")));
    await pg.close();
    admin("reset", A.link); // back to the start for the real walk-through
    let limited = 0;
    for (let i = 0; i < 25; i++) { const r = await fetch(`${SITE}/setup/B${String(i).padStart(21, "x")}`); if (r.status === 429) limited++; }
    check("E: guessing codes is rate limited per IP (429 after 20 bad lookups a minute)", limited >= 4, `${limited} of 25 got 429`);
  }

  // ---------- A and B in parallel ----------
  await fetch(`${MOCK}/_mock/do/no-docker-next`, { method: "POST" }); // A's droplet boots without Docker, so its first install fails
  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  let pA = await newPage(ctxA);
  const pB = await newPage(ctxB);
  await setupBuyer(pA, A, (n) => shot(pA, `A-${n}`));
  await submit(pA, "install-start");
  await shot(pA, "A-install-creating");
  // B starts while A's server is being made.
  const runB = (async () => {
    await setupBuyer(pB, B);
    await submit(pB, "install-start");
    await until(pB, "B's DNS record screen", async () => !!(await pB.$(".inline-rec table.records")), 180_000);
    const rec = await pB.$$eval(".inline-rec table.records td code", (c) => c.map((x) => x.textContent));
    check("B: shows the exact A record to add (app.<domain> -> server IP)", rec[0] === "app.bravo-clinic.test" && /^172\.31\.247\.\d+$/.test(rec[1]), rec.join(" "));
    await shot(pB, "B-install-add-a-record");
    // A typo first: the page says what it finds instead.
    await fetch(`${MOCK}/_mock/registrar`, { method: "POST", body: JSON.stringify({ type: "A", name: rec[0], content: "203.0.113.77" }) });
    await until(pB, "B sees the wrong record", async () => /Found 203\.0\.113\.77 instead/.test(await text(pB, ".inline-rec")), 60_000);
    check("B: a wrong A record shows what DNS answers instead, still Waiting", /Waiting/.test(await text(pB, ".inline-rec")), await text(pB, ".inline-rec"));
    await shot(pB, "B-install-wrong-a-record");
    await fetch(`${MOCK}/_mock/registrar`, { method: "POST", body: JSON.stringify({ type: "A", name: rec[0], content: rec[1] }) });
    await until(pB, "B past DNS", async () => !(await pB.$(".inline-rec")), 180_000);
    await until(pB, "B done", async () => (await h1(pB)) === "Your agency is live", 30 * 60_000);
    check("B: install finished on the add-records-yourself path", true);
  })().catch((e) => check("B: flow", false, e.message));

  await until(pA, "A install to start", async () => /Step \d+ of 10|stopped/.test((await text(pA, ".status")) + (await h1(pA))), 240_000);
  await shot(pA, "A-install-running");
  await until(pA, "A's first install to fail", async () => /stopped/.test(await h1(pA)), 10 * 60_000);
  check("A: failed install shows install.sh's reason in one line, with Try again", /Docker daemon is not running/.test(await text(pA, ".notice.err")) && !!(await pA.$("form[action$='/a/install-retry']")), await text(pA, ".notice.err"));
  await shot(pA, "A-install-failed");
  const stA = await mockState();
  const dropA = stA.droplets.find((d) => d.name.startsWith("alpha-answering"));
  check("A: droplet made with user_data, tag receptionist, Ubuntu 24.04, the buyer's SSH key and no key of ours", dropA && dropA.has_user_data && dropA.tags.includes("receptionist") && dropA.image === "ubuntu-24-04-x64" && dropA.ssh_keys.length === 1 && stA.keys.length === 1 && /alice@laptop/.test(stA.keys[0].public_key));
  const ud = await (await fetch(`${MOCK}/_mock/droplet-user-data?id=${dropA.id}`)).text();
  check("A: user_data is under 64 KiB and carries the settings only base64-encoded (no plaintext key)", ud.length < 65536 && !ud.includes("platform-fake-alice") && !ud.includes("re_mock_full_access_key"), `${ud.length} bytes`);
  execFileSync("docker", ["exec", "-d", dropA.container, "sh", "-c", "dockerd > /var/log/dockerd.log 2>&1"]); // the buyer "fixes" the problem
  await sleep(4000);
  await submit(pA, "install-retry");
  check("A: retry goes back to the same server", /same server/.test(await flash(pA)), await flash(pA));
  await until(pA, "A retry building", async () => /Step [6-9] of 10/.test(await text(pA, ".status")), 10 * 60_000);
  check("A: retry is attempt 2 on the same droplet", /attempt 2/.test(await text(pA, ".status")) && (await mockState()).droplets.filter((d) => d.name.startsWith("alpha")).length === 1);
  await shot(pA, "A-install-retry-running");
  // Close the tab and restart our site mid-install: nothing should be lost.
  const urlA = pA.url();
  await pA.close();
  await stopSite();
  log("site stopped mid-install; restarting in 5s");
  await sleep(5000);
  await startSite();
  pA = await newPage(ctxA);
  await pA.goto(urlA.split("?")[0], { waitUntil: "load" });
  check("A: reopening the link after closing the tab (and a site restart) shows the install still running", /Setting up/.test(await h1(pA)), await h1(pA));
  await until(pA, "A done", async () => (await h1(pA)) === "Your agency is live", 30 * 60_000);
  await shot(pA, "A-done");
  const logText = await pA.$eval("#log", (e) => e.textContent);
  check("A: install log kept, ends with INSTALL OK", /INSTALL OK https:\/\/app\.alpha-reception\.test/.test(logText));

  // ---------- secrets gone ----------
  const idA = JSON.parse(sqlite("select id from buyers where email='alice@example.com'"))[0].id;
  const left = JSON.parse(sqlite(`select name from secrets where buyer_id=${idA}`));
  check("A: no secrets left in SQLite after success", left.length === 0, JSON.stringify(left));
  const setupRow = JSON.parse(sqlite(`select data, droplet_token_hash, attempt_token_hash from setups where buyer_id=${idA}`))[0];
  const kept = JSON.parse(setupRow.data);
  check("A: kept only domain, droplet id/IP, timestamps, install log (+ brand/owner for the Done page)", kept.domain.host === "app.alpha-reception.test" && kept.dropletId && kept.ip && kept.installedAt && kept.purgedAt && !kept.server.regions && !kept.email.resend.records && setupRow.droplet_token_hash === null && setupRow.attempt_token_hash === null);
  await runB;
  const files = readdirSync(DATA).filter((f) => f.startsWith("site.db")).map((f) => readFileSync(join(DATA, f)));
  const plain = ["mock-do-token-ok", "mock-cf-token-ok", "re_mock_full_access_key", "platform-fake-alice-0001", "mock-google-secret-1234", "platform-fake-bob-0002"];
  const found = plain.filter((s) => files.some((b) => b.includes(Buffer.from(s))));
  check("A+B: no secret appears in plaintext anywhere in site.db / WAL", found.length === 0, found.join(","));
  const allSecrets = JSON.parse(sqlite("select buyer_id, name from secrets"));
  check("A+B: secrets table holds nothing for either finished buyer", !allSecrets.some((r) => r.buyer_id === idA || r.buyer_id === idA + 1), JSON.stringify(allSecrets));
  const dtokA = ud.match(/printf '%s' '(d_[A-Za-z0-9_-]{32})'/)[1];
  check("A: the server's setup token stops working after success", (await (await fetch(`${SITE}/p/${dtokA}/next`)).text()).trim() === "stop");
  check("A: install log on our side has no secrets", !plain.some((s) => logText.includes(s)));

  // ---------- the installed apps ----------
  await appCheck("A", kept.ip, "app.alpha-reception.test", A.brand);
  const keptB = JSON.parse(JSON.parse(sqlite("select data from setups where buyer_id=(select id from buyers where email='bob@example.com')"))[0].data);
  if (keptB.phase === "done") await appCheck("B", keptB.ip, "app.bravo-clinic.test", B.brand);
  const pBdone = await newPage(ctxB);
  await pBdone.goto(B.link);
  await shot(pBdone, "B-done");

  // ---------- C: create error, then delete the server ----------
  {
    const p = await newPage(await browser.createBrowserContext());
    await setupBuyer(p, C);
    await fetch(`${MOCK}/_mock/do/fail-next-create`, { method: "POST", body: "Region is not available" });
    await submit(p, "install-start");
    await until(p, "C create error", async () => /couldn't make your server/.test(await h1(p)), 60_000);
    check("C: a DigitalOcean error while creating shows its message", /Region is not available/.test(await text(p, ".notice.err")), await text(p, ".notice.err"));
    await shot(p, "C-create-failed");
    await submit(p, "install-start");
    await until(p, "C waiting for DNS", async () => !!(await p.$(".inline-rec")), 120_000);
    const before = (await mockState()).droplets.filter((d) => d.name.startsWith("charlie")).map((d) => d.container);
    p.on("dialog", (d) => d.accept());
    await submit(p, "server-delete");
    const after = (await mockState()).droplets.filter((d) => d.name.startsWith("charlie"));
    const exists = before.length ? execFileSync("docker", ["ps", "-a", "--filter", `name=^${before[0]}$`, "--format", "{{.Names}}"]).toString().trim() : "x";
    check("C: Delete the server removes the droplet (container gone) and returns to the Install summary", before.length === 1 && after.length === 0 && exists === "" && /deleted/.test(await flash(p)) && (await h1(p)) === "Ready to install", `${await flash(p)}`);
    await shot(p, "C-server-deleted");
  }

  // ---------- D: nameservers pending, read-only token, per-buyer rate limit ----------
  {
    const p = await newPage(await browser.createBrowserContext());
    await p.goto(D.link);
    await submit(p, "start");
    await submit(p, "brand", { productName: "Delta Desk", ownerEmail: "dan@delta.test" });
    await submit(p, "domain", { domain: "delta-reception.test", mode: "cloudflare", token: "mock-cf-token-readonly" });
    check("D: a token without DNS: Edit is caught before anything is built", /can't change its DNS records/.test(await flash(p)), await flash(p));
    await shot(p, "D-domain-token-cant-edit");
    await submit(p, "domain", { domain: "delta-reception.test", mode: "cloudflare", token: "mock-cf-token-ok" });
    check("D: an existing record at app.<domain> asks before replacing it", /already points somewhere/.test(await text(p, ".notice.warn")) && !!(await p.$("input[name=replace]")), await text(p, ".notice.warn"));
    await shot(p, "D-domain-replace-existing");
    await submit(p, "domain", { domain: "gamma-reception.test", mode: "cloudflare" });
    check("D: a domain still waiting for its nameserver change shows the two nameservers", (await h1(p)) === "Switch your nameservers" && /ns\.cloudflare\.com/.test(await text(p, ".ns")));
    await shot(p, "D-domain-waiting-for-nameservers");
    await until(p, "gamma active", async () => /gone through/.test(await flash(p)), 120_000, false);
    check("D: the page notices when the nameserver change goes through", true);
    await shot(p, "D-domain-nameservers-active");
    await submit(p, "domain", { domain: "gamma-reception.test", mode: "cloudflare" });
    check("D: continues to Server once Cloudflare is active", (await h1(p)) === "Your server", await h1(p));
    // Hammer the provider checks: the per-buyer limit (15 per 10 minutes in this test) kicks in.
    const msg = await p.evaluate(async () => {
      const t = document.querySelector("input[name=t]").value;
      for (let i = 0; i < 16; i++) {
        const r = await fetch(location.pathname.replace(/\/$/, "") + "/a/server", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, v: "server", token: "mock-do-token-readonly" }) });
        const html = await r.text();
        const m = html.match(/<div class="notice flash err">.*?<div>(.*?)<\/div>/s);
        if (m && /tried that a lot/.test(m[1])) return m[1];
      }
      return "never limited";
    });
    check("D: provider checks are rate limited per buyer", /tried that a lot/.test(msg), msg);
    await p.reload();
    await shot(p, "D-rate-limited");
  }

  // ---------- guide + home ----------
  {
    const p = await newPage(browser);
    await p.goto(`${SITE}/guide`);
    check("guide: has every how-to anchor the wizard links to", await p.evaluate(() => ["cloudflare-domain", "registrar-nameservers", "cloudflare-token", "registrar-dns-records", "digitalocean-token", "telnyx-account", "telnyx-api-key", "resend", "google-oauth", "microsoft-oauth"].every((id) => document.getElementById(id))));
    check("guide: describes the hosted setup (no download, no Docker Desktop)", !/Docker Desktop|start\.command|localhost:4400/.test(await p.content()));
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
