// A buyer's own copy (SINGLE_AGENCY=1, with the install's own Telnyx key) lets its agency add, test, replace and
// remove every phone key from Connections after install: the main Telnyx key and the backup (Vapi private and
// public keys, Twilio Account SID and Auth Token). The env keys stay as the fallback. Both engines side by side.
// The real server is started against a fresh database made here (and dropped afterwards), with the local test
// provider (E2E_FAKE_PROVIDER), which accepts pretend keys.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OWNER = "owner@acme.test";
const PASSWORD = "correct-horse-battery-staple";

async function boot(dbUrl: string, port: number, extra: Record<string, string>) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL: dbUrl,
    API_PORT: String(port),
    HOST: "127.0.0.1",
    SINGLE_AGENCY: "1",
    TELNYX_API_KEY: "KEYTEST-install-env-key-0001",
    VAPI_API_KEY: "",
    VAPI_PUBLIC_KEY: "",
    VOICE_PROVIDER: "",
    OWN_PHONE_ACCOUNT: "",
    PUBLIC_URL: "",
    FIRST_ADMIN_EMAIL: OWNER,
    MAILBOX_KEY: Buffer.alloc(32, 9).toString("base64"),
    LEGACY_DATA_DIR: mkdtempSync(join(tmpdir(), "connkeys-legacy-")),
    SUPPORT_SYNC_URL: "",
    OPENROUTER_API_KEY: "",
    E2E_FAKE_PROVIDER: "1",
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
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
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (p.exitCode !== null) break;
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    await Bun.sleep(250);
  }
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, json };
  };
  return { p, base, call, log: () => log, stop: async () => { p.kill(); await p.exited; } };
}


const TEST_KEY = "KEYTEST-LOCAL-DEMO-0001";
const VAPI_PRIVATE = "KEYTEST-vapi-private-0000000001";
const VAPI_PUBLIC = "KEYTEST-vapi-public-00000000002";
const TWILIO = { accountSid: "AC00000000000000000000000000000000", authToken: "00000000000000000000000000000000" };

test("single-agency install: Telnyx, Vapi and Twilio keys can be added, tested, replaced and removed in Connections", async () => {
  const base = process.env.DATABASE_URL ?? "";
  expect(base).not.toBe("");
  const name = `connkeys_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new SQL(base, { max: 1 });
  await admin.unsafe(`create database ${name}`);
  await admin.unsafe(`alter database ${name} set synchronous_commit = off`);
  const u = new URL(base);
  u.pathname = `/${name}`;
  const a = await boot(u.toString(), 19000 + Math.floor(Math.random() * 2000), {});
  try {
    expect((await a.call("POST", "/api/signup", { name: "Boss", email: OWNER, password: PASSWORD })).status).toBe(201);
    const first = (await a.call("GET", "/api/phone-account")).json;
    // Installed: runs on the server's own Telnyx key. No backup yet.
    expect(first).toMatchObject({ mode: "platform", installed: true, provider: "telnyx" });
    expect(first.engines.telnyx.mode).toBe("platform");
    expect(first.engines.vapi.mode).toBe("none");
    expect((await a.call("GET", "/api/twilio-account")).json.connected).toBe(false);

    // Test checks what's already in use (the server's key) with nothing typed in.
    const tested = await a.call("POST", "/api/phone-account/test", { provider: "telnyx" });
    expect(tested.status).toBe(200);
    expect(tested.json).toMatchObject({ ok: true, source: "server" });
    expect((await a.call("POST", "/api/phone-account/test", { provider: "vapi" })).status).toBe(400);

    // The main Telnyx key can be replaced after install (it used to say "change it on the server").
    const replaced = await a.call("PUT", "/api/phone-account", { provider: "telnyx", key: TEST_KEY });
    expect(replaced.status).toBe(200);
    expect(replaced.json.engines.telnyx).toMatchObject({ mode: "own", last4: TEST_KEY.slice(-4) });
    expect((await a.call("POST", "/api/phone-account/test", { provider: "telnyx" })).json.source).toBe("saved");

    // The Vapi backup: saved sealed, without changing the engine new receptionists run on.
    // (Checks are limited to ten a minute, so the typed-key test is the Twilio one below.)
    const vapi = await a.call("PUT", "/api/phone-account", { provider: "vapi", key: VAPI_PRIVATE, publicKey: VAPI_PUBLIC, makeDefault: false });
    expect(vapi.status).toBe(200);
    expect(vapi.json.provider).toBe("telnyx");
    expect(vapi.json.engines.vapi).toMatchObject({ mode: "own", last4: VAPI_PRIVATE.slice(-4), publicKey: VAPI_PUBLIC });
    expect(vapi.json.engines.telnyx.mode).toBe("own");
    expect((await a.call("POST", "/api/phone-account/test", { provider: "vapi" })).json).toMatchObject({ ok: true, source: "saved" });
    // The raw database column is sealed, never the plain key.
    const sql = new SQL(u.toString(), { max: 1 });
    const [row] = await sql`select vapi_key, telnyx_key, twilio_creds from orgs limit 1`;
    expect(String(row.vapi_key)).toMatch(/^v1\./);
    expect(String(row.vapi_key)).not.toContain(VAPI_PRIVATE);
    expect(String(row.telnyx_key)).toMatch(/^v1\./);
    // Both engines are connected side by side (moving a receptionist between them is covered by mixedEngines.test.ts).
    const made = await a.call("POST", "/api/clients", { businessName: "Both Engines", receptionistName: "Sam", industry: "trades", services: ["Drains"], defaultVoice: true });
    expect(made.status).toBe(201);
    expect(made.json.client.voiceProvider ?? "telnyx").toBe("telnyx");

    // Twilio: Account SID + Auth Token, tested, saved sealed, replaced and removed.
    expect((await a.call("POST", "/api/twilio-account/test", TWILIO)).json.source).toBe("typed");
    const tw = await a.call("PUT", "/api/twilio-account", TWILIO);
    expect(tw.status).toBe(200);
    expect(tw.json).toMatchObject({ connected: true, mode: "own", accountSid: TWILIO.accountSid });
    expect((await a.call("POST", "/api/twilio-account/test", {})).json).toMatchObject({ ok: true, source: "saved" });
    const [tr] = await sql`select twilio_creds from orgs limit 1`;
    expect(String(tr.twilio_creds)).toMatch(/^v1\./);
    expect(String(tr.twilio_creds)).not.toContain(TWILIO.authToken);
    expect((await a.call("PUT", "/api/twilio-account", { ...TWILIO, authToken: "1".repeat(32) })).status).toBe(200);
    const gone = await a.call("DELETE", "/api/twilio-account");
    expect(gone.status).toBe(200);
    expect(gone.json.connected).toBe(false);

    // Remove the backup, then the main key: the server's own key (env) is the fallback again.
    const noVapi = await a.call("DELETE", "/api/phone-account?provider=vapi");
    expect(noVapi.status).toBe(200);
    expect(noVapi.json.engines.vapi.mode).toBe("none");
    expect(noVapi.json.engines.telnyx.mode).toBe("own");
    const back = await a.call("DELETE", "/api/phone-account?provider=telnyx");
    expect(back.json).toMatchObject({ mode: "platform", installed: true });
    await sql.close();
  } finally {
    await a.stop();
    await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => {});
    await admin.close();
  }
}, 120_000);
