// End-to-end test in mock mode: fake DigitalOcean, a local Ubuntu 24.04
// container as the "droplet", a fake SMTP server. Drives the real page in
// headless Chromium and saves screenshots to installer/test-shots/.
//   cd installer && bun test/e2e.ts
// Talks to the internet once: the Telnyx check with an obviously fake key
// (to see the real rejection message).
import puppeteer, { type Page } from "puppeteer-core";
import { mkdirSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "..");
const SHOTS = join(ROOT, "test-shots");
const STATE = join(process.env.E2E_STATE || join(tmpdir(), "receptionist-installer-e2e"));
const URL = "http://localhost:4400";
const DO_TOKEN = "mock-do-token-for-tests";
const FAKE_TELNYX = "KEY_this-is-a-fake-key-for-testing";
const SMTP_PASS = "test-pass";
const GOOGLE_SECRET = "GOCSPX-test-secret-not-real";
const SECRETS = [DO_TOKEN, SMTP_PASS, GOOGLE_SECRET, "KEY_TEST_MODE_ACCEPT"];

rmSync(STATE, { recursive: true, force: true });
mkdirSync(STATE, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

let serverLog = "";
let proc: ReturnType<typeof Bun.spawn> | null = null;
async function startServer() {
  proc = Bun.spawn(["bun", "src/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_DO: "1", MOCK_OAUTH: "1", MOCK_FAIL_FIRST_INSTALL: "1", STATE_DIR: STATE },
    stdout: "pipe",
    stderr: "pipe",
  });
  const collect = async (s: ReadableStream<Uint8Array>) => {
    const d = new TextDecoder();
    for await (const c of s) serverLog += d.decode(c);
  };
  collect(proc.stdout as any);
  collect(proc.stderr as any);
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(URL + "/api/state")).ok) return;
    } catch {}
    await Bun.sleep(200);
  }
  throw new Error("server didn't start:\n" + serverLog);
}
async function stopServer() {
  proc?.kill();
  await proc?.exited;
  proc = null;
}

const results: string[] = [];
const pass = (m: string) => (results.push("PASS " + m), console.log("PASS " + m));
function expect(cond: any, m: string) {
  if (!cond) throw new Error("FAIL " + m);
  pass(m);
}

let n = 0;
async function shot(page: Page, name: string) {
  n++;
  const base = `${String(n).padStart(2, "0")}-${name}`;
  await page.setViewport({ width: 1280, height: 900 });
  await Bun.sleep(250);
  await page.screenshot({ path: join(SHOTS, `${base}-desktop.png`), fullPage: true });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await Bun.sleep(250);
  await page.screenshot({ path: join(SHOTS, `${base}-phone.png`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) console.log(`WARN horizontal overflow at 390px on ${name}`);
  await page.setViewport({ width: 1280, height: 900 });
}
const msgText = (page: Page, sel = "#m") => page.$eval(sel, (e) => (e as HTMLElement).innerText.trim());
async function waitMsg(page: Page, cls: "ok" | "err" | "warn" | "info", sel = "#m", timeout = 30000) {
  await page.waitForSelector(`${sel}.msg.${cls}`, { timeout });
  return msgText(page, sel);
}
async function type(page: Page, sel: string, v: string) {
  await page.$eval(sel, (e) => ((e as HTMLInputElement).value = ""));
  await page.type(sel, v);
}
const h1 = (page: Page) => page.$eval("h1", (e) => (e as HTMLElement).innerText);
async function waitStep(page: Page, text: string, timeout = 120000) {
  await page.waitForFunction((t) => document.querySelector("h1")?.textContent?.includes(t), { timeout }, text);
}
async function confirmYes(page: Page) {
  await page.waitForSelector("dialog[open] #confirm-yes");
  await page.click("#confirm-yes");
}

const containers = async () => (await new Response(Bun.spawn(["docker", "ps", "-q", "--filter", "label=receptionist-installer-mock=1"], { stdout: "pipe" }).stdout).text()).trim().split("\n").filter(Boolean);
const dexec = async (cmd: string) => {
  const id = (await containers())[0];
  return (await new Response(Bun.spawn(["docker", "exec", id, "bash", "-c", cmd], { stdout: "pipe" }).stdout).text()).trim();
};

const browser = await puppeteer.launch({ executablePath: "/snap/bin/chromium", headless: true, args: ["--no-sandbox"] });
try {
  await startServer();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: "networkidle0" });

  // a. Brand
  await page.waitForSelector("#productName");
  await shot(page, "brand-empty");
  await page.click("#go");
  expect((await waitMsg(page, "err")).includes("name"), "brand: empty name is refused with a plain message");
  await type(page, "#productName", "Bob's Reception");
  await type(page, "#ownerEmail", "owner@example.com");
  await shot(page, "brand-filled");
  await page.click("#go");

  // f (part 1). Domain
  await waitStep(page, "web address");
  await type(page, "#domain", "not a domain");
  await page.click("#go");
  expect((await waitMsg(page, "err")).includes("reception.yourcompany.com"), "domain: bad value gets an example");
  await type(page, "#domain", "https://Reception.Example.com/");
  await page.click("#go");

  // b. DigitalOcean
  await waitStep(page, "DigitalOcean");
  await type(page, "#token", "not-a-real-token");
  await page.click("#check");
  const doErr = await waitMsg(page, "err");
  expect(doErr.includes("didn't accept that token"), "digitalocean: wrong token -> " + doErr);
  await shot(page, "digitalocean-bad-token");
  await type(page, "#token", DO_TOKEN);
  await page.click("#check");
  await waitMsg(page, "ok");
  await page.waitForSelector("input[name=size]");
  const checked = await page.$eval("input[name=size]:checked", (e) => (e as HTMLInputElement).value);
  const region = await page.$eval("#region", (e) => (e as HTMLSelectElement).value);
  expect(checked === "s-2vcpu-4gb" && region === "syd1", `digitalocean: defaults syd1 / s-2vcpu-4gb (${region}/${checked})`);
  expect((await page.$eval("#choose", (e) => (e as HTMLElement).innerText)).includes("US$24/mo"), "digitalocean: monthly price shown from /v2/sizes");
  await shot(page, "digitalocean-ok");
  await page.click("#go");

  // c. Telnyx: real API, obviously fake key
  await waitStep(page, "Telnyx");
  await type(page, "#key", FAKE_TELNYX);
  await page.click("#check");
  const tErr = await waitMsg(page, "err");
  console.log("  Telnyx said: " + tErr);
  expect(/didn't accept that key|couldn't reach Telnyx/.test(tErr), "telnyx: fake key rejected with a readable message");
  await shot(page, "telnyx-fake-key");
  await type(page, "#key", "KEY_TEST_MODE_ACCEPT");
  await page.click("#check");
  expect((await waitMsg(page, "ok")).includes("25.00 USD"), "telnyx: credit shown");
  await page.click("#go");

  // d. Email (local fake SMTP)
  await waitStep(page, "email sender");
  await page.click('[data-preset="other"]');
  await type(page, "#host", "127.0.0.1");
  await type(page, "#port", "4402");
  await type(page, "#user", "test");
  await type(page, "#pass", "wrong-password");
  await type(page, "#from", "Bob's Reception <hello@example.com>");
  await page.click("#check");
  const eErr = await waitMsg(page, "err");
  expect(eErr.includes("rejected the username or password"), "email: wrong password -> " + eErr);
  await shot(page, "email-bad-password");
  await type(page, "#pass", SMTP_PASS);
  await page.click("#check");
  await waitMsg(page, "ok");
  await page.click("#test");
  await page.waitForFunction(() => document.querySelector("#m")?.textContent?.includes("Test email sent"), { timeout: 20000 });
  pass("email: verify + test email to the owner through the fake SMTP server");
  await shot(page, "email-ok");
  await page.click("#go");

  // e. Calendars
  await waitStep(page, "Calendar");
  await page.click("#cal-google summary");
  const redirect = await page.$eval("#cal-google .codebox code", (e) => e.textContent);
  expect(redirect === "https://reception.example.com/api/oauth/google/callback", "calendar: Google redirect URI " + redirect);
  await page.click("#cal-microsoft summary");
  expect((await page.$eval("#cal-microsoft .codebox code", (e) => e.textContent)) === "https://reception.example.com/api/oauth/microsoft/callback", "calendar: Microsoft redirect URI");
  await type(page, "#google-id", "not-a-client-id");
  await type(page, "#google-secret", GOOGLE_SECRET);
  await page.click('[data-check="google"]');
  expect((await waitMsg(page, "err", "#m-google")).includes("apps.googleusercontent.com"), "calendar: malformed Google id refused");
  await type(page, "#google-id", "1234-abc.apps.googleusercontent.com");
  await page.click('[data-check="google"]');
  await waitMsg(page, "ok", "#m-google");
  await type(page, "#microsoft-id", "nope");
  await page.click('[data-check="microsoft"]');
  await waitMsg(page, "err", "#m-microsoft");
  await shot(page, "calendar");
  await page.click("#go");

  // g. Create the server (mock droplet container)
  await waitStep(page, "Create your server");
  await shot(page, "server-ready-to-create");
  await page.click("#create");
  await page.waitForSelector(".plist li.now", { timeout: 10000 });
  await shot(page, "server-creating");
  await waitStep(page, "Point", 180000);
  expect((await containers()).length === 1, "server: mock droplet container is running");
  pass("server: key added, droplet created, active, SSH answered");

  // Restart test: stop the installer mid-flow, start it again, reload.
  await stopServer();
  await startServer();
  await page.reload({ waitUntil: "networkidle0" });
  await waitStep(page, "Point", 10000);
  pass("resume: restarted installer + reloaded tab came back on the DNS step");
  const mode = statSync(join(STATE, "installer-state.json")).mode & 0o777;
  expect(mode === 0o600, "state: installer-state.json is mode 600 (" + mode.toString(8) + ")");
  expect((statSync(join(STATE, "server-ssh-key")).mode & 0o777) === 0o600, "state: private key is mode 600");

  // f (part 2). DNS record + polling
  const rec = await page.$eval(".record tbody", (e) => (e as HTMLElement).innerText);
  expect(rec.includes("reception") && /\d+\.\d+\.\d+\.\d+/.test(rec), "dns: shows A record name + IP");
  await shot(page, "dns-waiting");
  await waitMsg(page, "ok", "#m", 30000);
  await shot(page, "dns-ok");
  await page.click("#go");

  // Install attempt 1 fails (forced in test mode) -> delete the server
  await waitStep(page, "Installing");
  await Bun.sleep(1500);
  await shot(page, "install-running");
  await page.waitForSelector("#retry", { timeout: 120000 });
  expect((await msgText(page)).includes("test failure"), "install: INSTALL FAILED reason shown");
  await shot(page, "install-failed");
  await page.click("#del");
  await confirmYes(page);
  await waitStep(page, "Create your server", 30000);
  await Bun.sleep(500);
  expect((await containers()).length === 0, "delete: droplet deleted (container removed)");

  // Create again, install fails once more (first attempt on the new server), then "Try install again" works
  await page.click("#create");
  await waitStep(page, "Point", 180000);
  await waitMsg(page, "ok", "#m", 30000);
  await page.click("#go");
  await page.waitForSelector("#retry", { timeout: 120000 });
  const dropletBefore = (await containers())[0];
  await page.click("#retry");
  await waitStep(page, "is live", 180000);
  expect((await containers())[0] === dropletBefore, "retry: reused the same droplet");
  pass("install: INSTALL OK detected after retry");

  // Check what landed on the "droplet"
  const envMode = await dexec("stat -c %a /opt/receptionist/.env");
  expect(envMode === "600", ".env on server is mode 600");
  const parsed = await dexec("cd /opt/receptionist && source ./lib.sh && read_env .env && echo \"${CONF[PRODUCT_NAME]}|${CONF[DOMAIN]}|${CONF[FIRST_ADMIN_EMAIL]}|${CONF[OWN_PHONE_ACCOUNT]}|${CONF[GOOGLE_CLIENT_ID]}|${CONF[SMTP_URL]}\"");
  expect(parsed === "Bob's Reception|reception.example.com|owner@example.com||1234-abc.apps.googleusercontent.com|smtp://test:test-pass@127.0.0.1:4402", ".env parses with the bundle's read_env: " + parsed.replace(SMTP_PASS, "***"));
  expect((await dexec("ls /opt/receptionist")).includes("app-src.tgz"), "bundle unpacked into /opt/receptionist");

  // h. Done
  await page.waitForSelector("#tokmsg");
  await page.waitForFunction(() => document.querySelector("#tokmsg")?.textContent?.includes("deleted"), { timeout: 10000 });
  await shot(page, "done");
  const st = JSON.parse(readFileSync(join(STATE, "installer-state.json"), "utf8"));
  expect(!st.digitalocean.token && st.digitalocean.tokenRemoved, "done: DO token removed from saved state");
  const key = await (await fetch(URL + "/api/ssh-key")).text();
  expect(key.includes("OPENSSH PRIVATE KEY"), "done: server key downloads");

  // Secrets never in the installer's own output or the install log
  const installLog = existsSync(join(STATE, "install.log")) ? readFileSync(join(STATE, "install.log"), "utf8") : "";
  // The mock DO prints its own fixed test token when it starts; ignore that line.
  const out = serverLog.split("\n").filter((l) => !l.startsWith("[mock-do] fake DigitalOcean API")).join("\n");
  const realLeak = SECRETS.filter((x) => out.includes(x) || installLog.includes(x));
  expect(realLeak.length === 0, "no secrets in installer output or install log");

  // Erase
  await page.click("#erase");
  await confirmYes(page);
  await waitStep(page, "All erased", 10000);
  expect(!existsSync(join(STATE, "server-ssh-key")) && !existsSync(join(STATE, "installer-state.json")), "erase: state and key removed");
  await shot(page, "erased");
} catch (e) {
  console.log(String(e));
  console.log("--- server output ---\n" + serverLog.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser.close();
  await stopServer();
  const { cleanupMockDroplets } = await import("../src/mock/do-api");
  await cleanupMockDroplets();
  rmSync(STATE, { recursive: true, force: true });
  console.log(`\n${results.length} checks passed${process.exitCode ? ", then a failure (above)" : ""}. Screenshots in ${SHOTS}`);
}
