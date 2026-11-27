// First run without the create-owner form. The real server runs against a fresh database made here (and dropped
// afterwards) with the local test provider: the install's variables make the owner on first start, the one-time
// link signs them in once, and the old sign-up still works when the installer didn't configure anything.
//   DATABASE_URL=postgres://... bun test server/firstrun.test.ts
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OWNER = "jane.smith@acme.test";
const TOKEN = "T".repeat(10) + "abcdefghijklmnopqrstuvwxyz0123456789_-";

async function withServer(extra: Record<string, string>, fn: (s: { call: (m: string, p: string, b?: unknown, cookie?: string, headers?: Record<string, string>) => Promise<{ status: number; json: any; cookie: string }>; sql: SQL }) => Promise<void>) {
  const base = process.env.DATABASE_URL ?? "";
  expect(base).not.toBe("");
  const name = `firstrun_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new SQL(base, { max: 1 });
  await admin.unsafe(`create database ${name}`);
  const u = new URL(base);
  u.pathname = `/${name}`;
  const port = 23000 + Math.floor(Math.random() * 2000);
  const env: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL: u.toString(),
    API_PORT: String(port),
    HOST: "127.0.0.1",
    SINGLE_AGENCY: "1",
    TELNYX_API_KEY: "",
    VAPI_API_KEY: "",
    VAPI_PUBLIC_KEY: "",
    VOICE_PROVIDER: "",
    OWN_PHONE_ACCOUNT: "",
    PUBLIC_URL: "",
    FIRST_ADMIN_EMAIL: OWNER,
    OWNER_NAME: "",
    AGENCY_NAME: "",
    FIRST_LOGIN_TOKEN: "",
    BRAND_COLOURS: "",
    BRAND_COLOUR: "",
    BRAND_LOGO_PNG: "",
    THEME: "",
    MAILBOX_KEY: Buffer.alloc(32, 7).toString("base64"),
    LEGACY_DATA_DIR: mkdtempSync(join(tmpdir(), "firstrun-legacy-")),
    SUPPORT_SYNC_URL: "",
    OPENROUTER_API_KEY: "",
    E2E_FAKE_PROVIDER: "1",
    ...extra,
  };
  const p = Bun.spawn(["bun", "server/index.ts"], { cwd: join(import.meta.dir, ".."), env, stdout: "pipe", stderr: "pipe" });
  let log = "";
  const pump = async (s: ReadableStream<Uint8Array>) => {
    const r = s.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      log += dec.decode(value);
    }
  };
  void pump(p.stdout);
  void pump(p.stderr);
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (p.exitCode !== null) break;
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) break;
    } catch {}
    await Bun.sleep(250);
  }
  const call = async (method: string, path: string, body?: unknown, cookie = "", extra: Record<string, string> = {}) => {
    const r = await fetch(baseUrl + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, json, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
  };
  const db = new SQL(u.toString(), { max: 1 });
  try {
    await fn({ call, sql: db });
  } catch (err) {
    console.log(log);
    throw err;
  } finally {
    p.kill();
    await p.exited;
    await db.close();
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.close();
  }
}

const installed = { OWNER_NAME: "Jane Smith", AGENCY_NAME: "Acme Calls", FIRST_LOGIN_TOKEN: TOKEN, BRAND_COLOURS: "#AA2244,#112233, 00ff88, #ffffff", THEME: "dark" };

test("a configured install makes the owner on first start; the one-time link signs them in once", async () => {
  await withServer(installed, async ({ call, sql }) => {
    // No create-account form: the server already has its owner, and says what look the install chose.
    const out = (await call("GET", "/api/session")).json;
    expect(out).toMatchObject({ signedIn: false, firstRun: false, singleAgency: true });
    expect(out.look).toEqual({ colours: ["#aa2244", "#112233", "#00ff88"], theme: "dark" });
    // The old sign-up is closed.
    expect((await call("POST", "/api/signup", { name: "X", email: OWNER, password: "correct-horse-battery" })).status).toBe(403);

    // Only the token's hash is stored.
    const rows = await sql`select token_hash, expires_at from first_logins`;
    expect(rows.length).toBe(1);
    expect(rows[0].token_hash).not.toContain(TOKEN);
    const hours = (new Date(rows[0].expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThanOrEqual(24);

    // Wrong, short and empty tokens do nothing.
    for (const t of ["", "short", TOKEN.slice(0, -1) + "x"]) expect((await call("POST", "/api/welcome", { token: t })).status).toBe(401);
    expect((await call("GET", "/api/session")).json.signedIn).toBe(false);

    // The right token signs in.
    const ok = await call("POST", "/api/welcome", { token: TOKEN });
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/^twin_sid=/);
    const me = (await call("GET", "/api/session", undefined, ok.cookie)).json;
    expect(me).toMatchObject({ signedIn: true, home: "/admin", needsPassword: true, singleAgency: true });
    expect(me.user).toMatchObject({ email: OWNER, name: "Jane Smith" });
    expect(me.org.name).toBe("Acme Calls");
    expect(me.role).toBe("owner");
    expect(me.brand).toMatchObject({ colours: ["#aa2244", "#112233", "#00ff88"], theme: "dark", primaryColor: "#aa2244", accentColor: "#112233" });

    // Burned: the same link never works again.
    expect((await call("POST", "/api/welcome", { token: TOKEN })).status).toBe(401);
    expect((await sql`select 1 from first_logins`).length).toBe(0);

    // Nobody can sign in with a guessed password, but the owner can choose one in Settings without a "current" one.
    expect((await call("POST", "/api/login", { email: OWNER, password: "" })).status).toBe(401);
    const set = await call("PUT", "/api/account", { newPassword: "a-fresh-password-1" }, ok.cookie);
    expect(set.status).toBe(200);
    expect((await call("GET", "/api/session", undefined, ok.cookie)).json.needsPassword).toBeUndefined();
    expect((await call("POST", "/api/login", { email: OWNER, password: "a-fresh-password-1" })).status).toBe(200);
    // From now on a current password is asked for, as before.
    const again = await call("PUT", "/api/account", { newPassword: "another-password-22" }, ok.cookie);
    expect(again.status).toBe(400);
  });
}, 120_000);

test("the owner can change the look later; it replaces the install's default", async () => {
  await withServer(installed, async ({ call }) => {
    const { cookie } = await call("POST", "/api/welcome", { token: TOKEN });
    const put = await call("PUT", "/api/org/brand", { colours: ["#010203"], theme: "light" }, cookie);
    expect(put.status).toBe(200);
    expect((await call("GET", "/api/session", undefined, cookie)).json.brand).toMatchObject({ colours: ["#010203"], theme: "light" });
    expect((await call("PUT", "/api/org/brand", { theme: "purple" }, cookie)).status).toBe(400);
    expect((await call("PUT", "/api/org/brand", { colours: ["#zzz"] }, cookie)).status).toBe(400);
  });
}, 120_000);

test("an expired link is refused; the older BRAND_COLOUR still works", async () => {
  await withServer({ ...installed, BRAND_COLOURS: "", BRAND_COLOUR: "#334455", THEME: "" }, async ({ call, sql }) => {
    expect((await call("GET", "/api/session")).json.look).toEqual({ colours: ["#334455"], theme: "" });
    await sql`update first_logins set expires_at = now() - interval '1 minute'`;
    const late = await call("POST", "/api/welcome", { token: TOKEN });
    expect(late.status).toBe(401);
    expect(late.json.error).toMatch(/already been used or has expired/);
  });
}, 120_000);

test("an install the wizard didn't configure, and an existing install, keep the old sign-up and sign-in exactly", async () => {
  // Nothing but FIRST_ADMIN_EMAIL (an older wizard): the "set up your agency" sign-up is still there, locked to that email.
  await withServer({}, async ({ call }) => {
    expect((await call("GET", "/api/session")).json).toMatchObject({ signedIn: false, firstRun: true, signupOpen: true });
    expect((await call("POST", "/api/welcome", { token: TOKEN })).status).toBe(401);
    expect((await call("POST", "/api/signup", { name: "Eve", email: "eve@x.test", password: "correct-horse-battery" })).status).toBe(403);
    const up = await call("POST", "/api/signup", { name: "Jane", email: OWNER, password: "correct-horse-battery" });
    expect(up.status).toBe(201);
    const me = (await call("GET", "/api/session", undefined, up.cookie)).json;
    expect(me.needsPassword).toBeUndefined();
    // A password sign-in works, and changing it asks for the current one.
    expect((await call("POST", "/api/login", { email: OWNER, password: "correct-horse-battery" })).status).toBe(200);
    expect((await call("PUT", "/api/account", { newPassword: "something-else-123" }, up.cookie)).status).toBe(400);
  });
}, 120_000);

test("a voice sample needs a sign-in, and a bad voice is a plain error the page can show (not a silent failure)", async () => {
  await withServer(installed, async ({ call }) => {
    expect((await call("GET", "/api/voices/preview?voice=Telnyx.Ultra.abc")).status).toBe(401);
    const { cookie } = await call("POST", "/api/welcome", { token: TOKEN });
    const bad = await call("GET", "/api/voices/preview?voice=nope", undefined, cookie);
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("Unknown voice.");
  });
}, 120_000);

test("connecting Twilio lists the account's numbers whichever voice engine is the default (no Vapi needed)", async () => {
  await withServer(installed, async ({ call }) => {
    const { cookie } = await call("POST", "/api/welcome", { token: TOKEN });
    const acct = (await call("GET", "/api/twilio-account", undefined, cookie)).json;
    expect(acct.connected).toBe(false);
    const saved = await call("PUT", "/api/twilio-account", { accountSid: acct.testSid, authToken: acct.testToken }, cookie);
    expect(saved.status).toBe(200);
    expect(saved.json.connected).toBe(true);
    const numbers = await call("GET", "/api/numbers/twilio", undefined, cookie);
    expect(numbers.status).toBe(200);
    expect(numbers.json.numbers.length).toBeGreaterThan(0);
    expect(numbers.json.numbers[0]).toMatchObject({ phoneNumber: expect.stringMatching(/^\+/), assignedTo: "" });
  });
}, 120_000);

test("the first password needs no current one only in the first-login session, and only for 24 hours; anyone else must use the email reset", async () => {
  await withServer(installed, async ({ call, sql }) => {
    const { cookie } = await call("POST", "/api/welcome", { token: TOKEN });
    expect((await sql`select first_login from sessions`)[0].first_login).toBe(true);
    // The same session, but not the one the link opened (a stolen cookie, an older session): refused.
    await sql`update sessions set first_login = false`;
    const stolen = await call("PUT", "/api/account", { newPassword: "a-fresh-password-1" }, cookie);
    expect(stolen.status).toBe(400);
    expect(stolen.json.error).toMatch(/Forgot password/);
    // The link's own session, but a day later: refused too.
    await sql`update sessions set first_login = true, created_at = now() - interval '25 hours'`;
    expect((await call("PUT", "/api/account", { newPassword: "a-fresh-password-1" }, cookie)).status).toBe(400);
    expect((await sql`select password_unset from users`)[0].password_unset).toBe(true);
    // Within the day, in the link's session: allowed.
    await sql`update sessions set created_at = now()`;
    expect((await call("PUT", "/api/account", { newPassword: "a-fresh-password-1" }, cookie)).status).toBe(200);
    expect((await call("POST", "/api/login", { email: OWNER, password: "a-fresh-password-1" })).status).toBe(200);
    // A normal sign-in session is never first_login.
    expect((await sql`select count(*)::int as n from sessions where first_login`)[0].n).toBe(1);
  });
}, 120_000);

test("a wrong sign-in link from one address doesn't lock out the owner coming from another; malformed tokens don't count", async () => {
  await withServer(installed, async ({ call }) => {
    const bad = TOKEN.slice(0, -1) + "x";
    const attacker = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 12; i++) await call("POST", "/api/welcome", { token: i % 2 ? bad : "short" }, "", attacker);
    // Short ones never counted; only the 6 well-formed wrong ones did: not locked yet.
    expect((await call("POST", "/api/welcome", { token: bad }, "", attacker)).status).toBe(401);
    for (let i = 0; i < 6; i++) await call("POST", "/api/welcome", { token: bad }, "", attacker);
    expect((await call("POST", "/api/welcome", { token: bad }, "", attacker)).status).toBe(429);
    // The owner, from their own address, is unaffected.
    const ok = await call("POST", "/api/welcome", { token: TOKEN }, "", { "x-forwarded-for": "198.51.100.7" });
    expect(ok.status).toBe(200);
  });
}, 120_000);

test("the owner of a single-agency copy can use Helper (the install marks them platform admin too)", async () => {
  await withServer(installed, async ({ call, sql }) => {
    const { cookie } = await call("POST", "/api/welcome", { token: TOKEN });
    expect((await sql`select platform_admin from users`)[0].platform_admin).toBe(true);
    const r = await call("POST", "/api/helper/chat", { messages: [{ role: "user", content: "hi" }], route: "/admin" }, cookie);
    expect(r.status).toBe(200); // no AI key here, so Helper says where to add one; the point is it is not a 403
    expect(r.json.needsKey).toBe(true);
  });
}, 120_000);

test("voice samples are rate limited per person, with a plain message", async () => {
  await withServer(installed, async ({ call }) => {
    const { cookie } = await call("POST", "/api/welcome", { token: TOKEN });
    // The owner is signed in; a sample is rate limited per person, with a plain message.
    let last = 200;
    for (let i = 0; i < 45; i++) last = (await call("GET", "/api/voices/preview?voice=nope", undefined, cookie)).status;
    expect(last).toBe(429);
  });
}, 120_000);
