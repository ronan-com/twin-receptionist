// A buyer's own copy (SINGLE_AGENCY) installed with NO phone key: the buyer skipped the phone step in
// the setup wizard and connects their own key later in Connections. The real server is started twice
// against a fresh database made here (and dropped afterwards):
//   1. no key at all: it boots, says so, the agency's phone account is "none", making a receptionist
//      is refused with a clear message, and the background loops stay quiet;
//   2. the local test provider (E2E_FAKE_PROVIDER, still no install key): the owner pastes a key in
//      Connections, it's used straight away, and making a receptionist works.
//   bun test --env-file=../.env server/skipPhone.test.ts
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
    TELNYX_API_KEY: "",
    VAPI_API_KEY: "",
    VAPI_PUBLIC_KEY: "",
    VOICE_PROVIDER: "",
    OWN_PHONE_ACCOUNT: "",
    PUBLIC_URL: "",
    FIRST_ADMIN_EMAIL: OWNER,
    MAILBOX_KEY: Buffer.alloc(32, 9).toString("base64"),
    LEGACY_DATA_DIR: mkdtempSync(join(tmpdir(), "skipphone-legacy-")),
    SUPPORT_SYNC_URL: "",
    OPENROUTER_API_KEY: "",
    E2E_FAKE_PROVIDER: "",
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

const receptionist = { businessName: "Acme Plumbing", receptionistName: "Sam", industry: "trades", services: ["Blocked drains"], defaultVoice: true };

test("no install phone key: boots, refuses receptionists until the owner connects a key in Connections, then works", async () => {
  const base = process.env.DATABASE_URL ?? "";
  expect(base).not.toBe("");
  const name = `skipphone_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new SQL(base, { max: 1 });
  await admin.unsafe(`create database ${name}`);
  await admin.unsafe(`alter database ${name} set synchronous_commit = off`);
  const u = new URL(base);
  u.pathname = `/${name}`;
  const port = 19000 + Math.floor(Math.random() * 2000);
  try {
    // ---- 1. no key at all ----
    const a = await boot(u.toString(), port, {});
    try {
      expect(a.p.exitCode).toBeNull();
      expect((await a.call("GET", "/api/health")).json).toEqual({ ok: true });
      expect(a.log()).toContain("no install phone key: the agency connects its own in Connections");
      const signup = await a.call("POST", "/api/signup", { name: "Boss", email: OWNER, password: PASSWORD });
      expect(signup.status).toBe(201);
      const session = (await a.call("GET", "/api/session")).json;
      expect(session.singleAgency).toBe(true);
      expect(session.console).toBe("agency");
      expect(session.telnyx).toBe("none");
      const acct = (await a.call("GET", "/api/phone-account")).json;
      expect(acct.mode).toBe("none");
      // Nothing was set at install, so Connections offers to connect one (not "Set at install").
      expect(acct.installed).toBe(false);
      const refused = await a.call("POST", "/api/clients", receptionist);
      expect(refused.status).toBe(400);
      expect(refused.json.error).toMatch(/Connect your phone provider first: open Connections and paste your Telnyx API key/);
      // Give the call sync and text-back loops their first run (5s), then check they stayed quiet.
      await Bun.sleep(6_500);
      expect(a.p.exitCode).toBeNull();
      expect((await a.call("GET", "/api/health")).status).toBe(200);
      expect(a.log()).not.toMatch(/TELNYX_API_KEY is not set|\[call sync\]|\[text-back\]|Unhandled|uncaught/i);
    } finally {
      await a.stop();
    }

    // ---- 2. the owner connects their own key (local test provider, still no install key) ----
    const b = await boot(u.toString(), port + 1, { E2E_FAKE_PROVIDER: "1" });
    try {
      expect((await b.call("POST", "/api/login", { email: OWNER, password: PASSWORD })).status).toBeLessThan(300);
      const before = await b.call("POST", "/api/clients", receptionist);
      expect(before.status).toBe(400);
      const testKey = (await b.call("GET", "/api/phone-account")).json.testKey;
      expect(testKey).toMatch(/^KEYTEST/);
      const connected = await b.call("PUT", "/api/phone-account", { key: testKey, provider: "telnyx" });
      expect(connected.status).toBe(200);
      expect(connected.json.mode).toBe("own");
      expect(connected.json.last4).toBe(testKey.slice(-4));
      // Used straight away: no restart.
      expect((await b.call("GET", "/api/session")).json.telnyx).toBe("own");
      const made = await b.call("POST", "/api/clients", receptionist);
      expect(made.json?.error ?? "").toBe("");
      expect(made.status).toBe(201);
      expect(made.json.client.settings.businessName).toBe("Acme Plumbing");
    } finally {
      await b.stop();
    }
  } finally {
    await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => {});
    await admin.close();
  }
}, 180_000);
