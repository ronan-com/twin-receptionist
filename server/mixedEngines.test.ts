// An agency with BOTH Telnyx and Vapi connected mixes them per receptionist. The real server runs
// against a fresh database made here (and dropped afterwards), with the local test provider (no
// Telnyx or Vapi is called): the wizard's engine choice makes one of each, the voice list follows
// the engine, numbers only attach to a compatible receptionist, and "Move to Vapi/Telnyx" keeps
// everything the receptionist had.
//   bun test --env-file=../.env server/mixedEngines.test.ts
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OWNER = "owner@mixed.test";
const PASSWORD = "correct-horse-battery-staple";

async function boot(dbUrl: string, port: number) {
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
    MAILBOX_KEY: Buffer.alloc(32, 7).toString("base64"),
    LEGACY_DATA_DIR: mkdtempSync(join(tmpdir(), "mixed-legacy-")),
    SUPPORT_SYNC_URL: "",
    OPENROUTER_API_KEY: "",
    E2E_FAKE_PROVIDER: "1",
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
  return { p, call, log: () => log, stop: async () => { p.kill(); await p.exited; } };
}

const receptionist = { businessName: "Acme Plumbing", receptionistName: "Sam", industry: "trades", services: ["Blocked drains", "Hot water"], greeting: "Thanks for calling Acme Plumbing, this is Sam.", defaultVoice: true };

test("both engines connected: one receptionist on each, numbers match the engine, moving keeps everything", async () => {
  const base = process.env.DATABASE_URL ?? "";
  expect(base).not.toBe("");
  const name = `mixed_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new SQL(base, { max: 1 });
  await admin.unsafe(`create database ${name}`);
  await admin.unsafe(`alter database ${name} set synchronous_commit = off`);
  const u = new URL(base);
  u.pathname = `/${name}`;
  const s = await boot(u.toString(), 21000 + Math.floor(Math.random() * 2000));
  try {
    expect((await s.call("POST", "/api/signup", { name: "Boss", email: OWNER, password: PASSWORD })).status).toBe(201);
    const testKey = (await s.call("GET", "/api/phone-account")).json.testKey;
    expect((await s.call("PUT", "/api/phone-account", { key: testKey, provider: "telnyx" })).status).toBe(200);
    const vapiKeys = { provider: "vapi", key: `${testKey}-VAPI-PRIVATE`, publicKey: "public-test-key-0000000000000" };
    const vapiOn = await s.call("PUT", "/api/phone-account", vapiKeys);
    expect(vapiOn.json?.error ?? "").toBe("");

    // The wizard offers both, Telnyx recommended and first.
    const engines = (await s.call("GET", "/api/voice-engines")).json;
    expect(engines.default).toBe("telnyx");
    expect(engines.engines.map((e: any) => [e.id, e.connected, e.recommended])).toEqual([["telnyx", true, true], ["vapi", true, false]]);

    // The voice list follows the engine: Vapi's curated list with clips.
    const vapiVoices = (await s.call("GET", "/api/voices?engine=vapi")).json.voices;
    expect(vapiVoices[0]).toMatchObject({ id: "11labs:IKne3meq5aSn9XLyUdCD", maker: "ElevenLabs", previewUrl: "/voice-previews/11labs-IKne3meq5aSn9XLyUdCD.mp3" });
    const telnyxVoices = (await s.call("GET", "/api/voices?engine=telnyx")).json.voices;
    expect(telnyxVoices.some((v: any) => v.id.includes(":"))).toBe(false);

    // One of each.
    const t = await s.call("POST", "/api/clients", { ...receptionist, engine: "telnyx" });
    expect(t.json?.error ?? "").toBe("");
    expect(t.json.client.voiceProvider).toBeUndefined();
    const v = await s.call("POST", "/api/clients", { ...receptionist, businessName: "Beta Electrical", engine: "vapi" });
    expect(v.json?.error ?? "").toBe("");
    expect(v.json.client.voiceProvider).toBe("vapi");
    expect(v.json.client.settings.voiceId).toBe("11labs:IKne3meq5aSn9XLyUdCD");
    const tId = t.json.client.id;
    const vId = v.json.client.id;

    // Numbers: a Twilio number doesn't go on the Telnyx receptionist, and its number dialog says why.
    const twilioOnTelnyx = await s.call("POST", `/api/clients/${tId}/numbers`, { source: "twilio", number: "+61412000111" });
    expect(twilioOnTelnyx.status).toBe(400);
    expect(twilioOnTelnyx.json.error).toMatch(/Twilio numbers work with the Vapi voice engine/);
    const tNumbers = (await s.call("GET", `/api/clients/${tId}/numbers`)).json;
    expect(tNumbers.provider ?? "telnyx").toBe("telnyx");
    const vNumbers = (await s.call("GET", `/api/clients/${vId}/numbers`)).json;
    expect(vNumbers.provider).toBe("vapi");
    expect(vNumbers.support.rule).toMatch(/answers Twilio numbers/);

    // A Telnyx number on the Telnyx receptionist (demo: recorded, nothing bought).
    const bought = await s.call("POST", `/api/clients/${tId}/numbers`, { phoneNumber: "+61412000222", confirm: true });
    expect(bought.status).toBe(201);
    const withNumber = (await s.call("GET", `/api/clients/${tId}`)).json.client;
    expect(withNumber.numberSources).toEqual({ "+61412000222": "telnyx" });

    // Move the Telnyx receptionist to Vapi: everything comes along, the voice is the closest Vapi one,
    // and the number is listed as no longer ringing it.
    const before = withNumber;
    const moved = await s.call("POST", `/api/clients/${tId}/engine`, { to: "vapi" });
    expect(moved.json?.error ?? "").toBe("");
    expect(moved.json.detached).toEqual(["+61412000222"]);
    const after = (await s.call("GET", `/api/clients/${tId}`)).json.client;
    expect(after.voiceProvider).toBe("vapi");
    expect(after.id).toBe(before.id);
    expect(after.phoneNumbers).toEqual([]);
    for (const k of ["businessName", "receptionistName", "industry", "services", "greeting", "hours", "timezone", "tone"]) expect(after.settings[k]).toEqual(before.settings[k]);
    expect(vapiVoices.map((x: any) => x.id)).toContain(after.settings.voiceId);
    expect(after.instructions).toContain("Acme Plumbing");
    // Already there: refused.
    expect((await s.call("POST", `/api/clients/${tId}/engine`, { to: "vapi" })).status).toBe(400);
    // And back to Telnyx, with a Telnyx voice again.
    const back = await s.call("POST", `/api/clients/${tId}/engine`, { to: "telnyx" });
    expect(back.json?.error ?? "").toBe("");
    const again = (await s.call("GET", `/api/clients/${tId}`)).json.client;
    expect(again.voiceProvider).toBeUndefined();
    expect(telnyxVoices.map((x: any) => x.id)).toContain(again.settings.voiceId);
    expect(again.settings.services).toEqual(before.settings.services);

    // "Apply new voice settings" is for Vapi receptionists.
    expect((await s.call("POST", `/api/clients/${vId}/voice-settings`, {})).json).toMatchObject({ ok: true, applied: false });
    expect((await s.call("POST", `/api/clients/${tId}/voice-settings`, {})).status).toBe(400);
    expect((await s.call("POST", "/api/voice-engines/vapi/apply", {})).json).toEqual({ updated: 1, failed: [] });
  } finally {
    await s.stop();
    await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => {});
    await admin.close();
  }
}, 120_000);
