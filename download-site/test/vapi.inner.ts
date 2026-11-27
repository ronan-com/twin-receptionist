// Telnyx is the main path; Vapi and Twilio are backup options on the last optional screen. Providers are stubbed: no network.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vapi-test-"));
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
for (const k of ["MOCK_FAST", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH"]) delete process.env[k];

const { addBuyer } = await import("../lib");
const { actions, phoneSettings, firstOpen } = await import("../setup");
const { getSetup, getSecret, hasSecret, putSecret, updateSetup } = await import("../store");
const { checkVapi } = await import("../providers");

const realFetch = globalThis.fetch;
let calls: { url: string; auth: string | null }[] = [];
const stub = (status: number, body: unknown = []) => {
  calls = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as any;
};
afterAll(() => { globalThis.fetch = realFetch; });

const run = async (b: any, name: string, f: Record<string, string> = {}) => actions[name](b, f);
async function buyer(n: string) {
  const b = addBuyer(`Buyer ${n}`, `vapi-${n}@example.com`);
  await run(b, "start");
  await run(b, "brand", { productName: "Acme Calls", ownerEmail: "boss@acme.test" });
  // Phones comes after hosting; this puts the buyer where the phones step is allowed.
  putSecret(b.id, "railway_token", "rail-token-0123456789");
  putSecret(b.id, "openrouter_key", "sk-or-test-0123456789"); // AI is required
  updateSetup(b.id, (s) => { s.railway = { confirmed: true }; s.ai = { confirmed: true }; s.step = "phones"; });
  return b;
}

const TKEY = "KEY0123456789ABCDEF0123456789_abcdefghijkl";
const VOK = { vapiKey: "priv-0123456789abcdef", vapiPublic: "pub-0123456789abcdef" };
const telnyxOk = () => stub(200, { data: { available_credit: "12.50", currency: "USD" } });

describe("Telnyx first, Vapi and Twilio as backup options", () => {
  test("the phones step is Telnyx only: a provider field is ignored and Telnyx is checked", async () => {
    const b = await buyer("a");
    telnyxOk();
    expect(await run(b, "phones", { provider: "vapi", key: TKEY, ...VOK })).toBeNull();
    // The balance, the two pretrial probes (a paid account can list both), then the numbers already on the account.
    expect(calls.map((c) => c.url)).toEqual(["https://api.telnyx.com/v2/balance", "https://api.telnyx.com/v2/ai/assistants?page[size]=1", "https://api.telnyx.com/v2/call_control_applications?page[size]=1", "https://api.telnyx.com/v2/phone_numbers?page[size]=100&page[number]=1"]);
    expect(getSetup(b.id).phones).toMatchObject({ provider: "telnyx", confirmed: true });
    expect(getSetup(b.id).vapi).toBeUndefined();
    expect(hasSecret(b.id, "vapi_key")).toBe(false);
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({ TELNYX_API_KEY: TKEY, VOICE_PROVIDER: "telnyx" });
    // No key, no way on.
    const c = await buyer("a2");
    expect((await run(c, "phones", {}))?.kind).toBe("err");
  });

  test("Vapi added next to Telnyx: both keys checked with one cheap GET, Telnyx stays the main engine (VOICE_PROVIDER=telnyx) and Vapi rides along as the backup", async () => {
    const b = await buyer("b");
    telnyxOk();
    await run(b, "phones", { key: TKEY });
    stub(200);
    expect(await run(b, "vapi", VOK)).toBeNull();
    expect(calls).toEqual([{ url: "https://api.vapi.ai/assistant?limit=1", auth: "Bearer priv-0123456789abcdef" }]);
    expect(getSecret(b.id, "vapi_key")).toBe("priv-0123456789abcdef");
    expect(getSecret(b.id, "vapi_public")).toBe("pub-0123456789abcdef");
    const s = getSetup(b.id);
    expect(s.vapi?.confirmed).toBe(true);
    // Telnyx AND Vapi: the app gets both keys and Telnyx is the main engine (a real install once lost the Telnyx key here).
    const both = { TELNYX_API_KEY: TKEY, VOICE_PROVIDER: "telnyx", VAPI_API_KEY: "priv-0123456789abcdef", VAPI_PUBLIC_KEY: "pub-0123456789abcdef" };
    expect(phoneSettings(b.id, s)).toEqual(both);
    telnyxOk();
    await run(b, "phones", { key: TKEY });
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual(both);
  });

  test("skipping or removing Vapi puts Telnyx back as the default", async () => {
    const b = await buyer("c");
    telnyxOk();
    await run(b, "phones", { key: TKEY });
    stub(200);
    await run(b, "vapi", VOK);
    expect(await run(b, "vapi-skip")).toBeNull();
    expect(hasSecret(b.id, "vapi_key")).toBe(false);
    expect(getSetup(b.id).skipped?.vapi).toBe(true);
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({ TELNYX_API_KEY: TKEY, VOICE_PROVIDER: "telnyx" });
  });

  test("no Telnyx account: go on to the backup options; install needs Telnyx or Vapi", async () => {
    const b = await buyer("d");
    // Neither added yet: Install is refused.
    expect((await run(b, "install-start"))?.kind).toBe("err");
    stub(200);
    expect(await run(b, "phones-vapi", VOK)).toBeNull(); // Vapi as the voice provider, on the Voice step
    // Vapi on its own (Telnyx not connected): Vapi is the main engine and there is no Telnyx key.
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({ VOICE_PROVIDER: "vapi", VAPI_API_KEY: "priv-0123456789abcdef", VAPI_PUBLIC_KEY: "pub-0123456789abcdef" });
    expect(firstOpen(b, getSetup(b.id))).toBe("extras"); // Connect more is the next stop; nothing on it is required
  });

  test("a Vapi key Vapi refuses is an error, and nothing is saved", async () => {
    const b = await buyer("e");
    stub(401, { message: "Invalid Key." });
    const r = await run(b, "vapi", { vapiKey: "priv-bad-0123456789ab", vapiPublic: "pub-0123456789abcdef" });
    expect(r?.kind).toBe("err");
    expect(hasSecret(b.id, "vapi_key")).toBe(false);
    expect(getSetup(b.id).vapi).toBeUndefined();
  });

  test("the public key is required, and the two keys must differ; nothing is called", async () => {
    const b = await buyer("f");
    stub(200);
    expect((await run(b, "vapi", { vapiKey: "priv-0123456789abcdef" }))?.kind).toBe("err");
    expect((await checkVapi("same-0123456789", "same-0123456789")).ok).toBe(false);
    expect((await checkVapi("has space 123", "pub-0123456789")).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("the Vapi path never asks for or keeps a Telnyx key", async () => {
    const b = await buyer("g");
    stub(200);
    expect(await run(b, "phones-vapi", { ...VOK, key: TKEY })).toBeNull();
    expect(calls.some((c) => c.url.includes("telnyx"))).toBe(false);
    expect(getSecret(b.id, "telnyx_key")).toBeNull();
    expect("TELNYX_API_KEY" in phoneSettings(b.id, getSetup(b.id))).toBe(false);
    const { wizardPage } = await import("../wizard");
    expect(wizardPage(b, getSetup(b.id), b.code, "sid", "vapi" as any)).not.toMatch(/Telnyx API key|name="key"/);
  });

  test("Twilio is its own backup card: checked with one read, kept, and handed to the install; skip removes it", async () => {
    const SID = "AC" + "a".repeat(32);
    const b = await buyer("h");
    telnyxOk();
    await run(b, "phones", { key: TKEY });
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ status: "active", friendly_name: "Acme" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;
    calls = [];
    expect(await run(b, "twilio", { twilioSid: SID, twilioToken: "t".repeat(32) })).toBeNull();
    expect(calls[0].url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}.json`);
    expect(calls[0].auth).toBe(`Basic ${Buffer.from(`${SID}:${"t".repeat(32)}`).toString("base64")}`);
    expect(getSecret(b.id, "twilio_token")).toBe("t".repeat(32));
    expect(getSetup(b.id).twilio).toMatchObject({ sid: SID, confirmed: true });
    // Telnyx stays the voice engine; the Twilio keys ride along.
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({ TELNYX_API_KEY: TKEY, VOICE_PROVIDER: "telnyx", TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: "t".repeat(32) });
    expect(await run(b, "twilio-skip")).toBeNull();
    expect(hasSecret(b.id, "twilio_token")).toBe(false);
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({ TELNYX_API_KEY: TKEY, VOICE_PROVIDER: "telnyx" });
  });

  test("Twilio credentials Twilio refuses, or that aren't shaped like Twilio's, are an error and nothing is saved", async () => {
    const b = await buyer("i");
    stub(401, { message: "Authenticate" });
    const r = await run(b, "twilio", { twilioSid: "AC" + "b".repeat(32), twilioToken: "t".repeat(32) });
    expect(r?.kind).toBe("err");
    expect(hasSecret(b.id, "twilio_token")).toBe(false);
    expect(getSetup(b.id).twilio).toBeUndefined();
    expect((await run(b, "twilio", { twilioSid: "nope", twilioToken: "x" }))?.kind).toBe("err");
  });

  test("the Voice screen: Telnyx or Vapi (no skip, no sign-in buttons, no Twilio); each provider opens on its own with a link to where its key is made", async () => {
    const { wizardPage } = await import("../wizard");
    const b = await buyer("j");
    const html = (view: string, opt = "") => wizardPage(b, getSetup(b.id), b.code, "sid", view as any, undefined, opt);
    const phones = html("phones");
    expect(phones).toContain("Telnyx");
    expect(phones).toContain("Vapi");
    expect(phones).not.toContain("Skip for now");
    expect(phones).toContain(`href="/setup/${b.code}?step=phones&amp;opt=telnyx"`);
    expect(phones).not.toContain('name="key"'); // nothing to paste until a provider is chosen
    expect(phones).not.toMatch(/Twilio/); // Twilio is not part of Voice any more
    expect(phones).not.toContain("Sign in with"); // sign-ins are parked: paste a key only
    const tel = html("phones", "telnyx");
    expect(tel).toContain("Telnyx API key");
    expect(tel).toContain('href="https://portal.telnyx.com/#/app/api-keys"');
    expect(tel).toContain('target="_blank"');
    expect(tel).not.toContain("Sign in with");
    const vap = html("phones", "vapi");
    expect(vap).toContain("Vapi private key");
    expect(vap).toContain("Vapi public key");
    expect(vap).toContain('href="https://dashboard.vapi.ai/org/api-keys"');
    expect(vap).not.toMatch(/Twilio/);
    updateSetup(b.id, (s) => { s.phones = { confirmed: true, provider: "telnyx", numbers: ["+61 2 5550 0101"] }; });
    putSecret(b.id, "telnyx_key", TKEY);
    const on = html("phones");
    expect(on).toContain("+61 2 5550 0101");
    expect(on).toContain("Telnyx connected");
    expect(on).toContain("Choose a different provider");
    expect(html("vapi")).toContain("Backup voice (Vapi)"); // reached from Connect more once Telnyx is connected
  });

  test("one Vapi guide (sign up, private key, public key) and a Twilio guide", async () => {
    const { howTo } = await import("../content");
    const v = howTo("vapi-account");
    expect(v.placeholder).toBe(false);
    expect(v.html).toContain("https://dashboard.vapi.ai/org/api-keys");
    expect(v.html).toContain("Private API Keys");
    expect(v.html).toContain("Public API Keys");
    expect(v.html).not.toContain("Telnyx");
    const t = howTo("twilio-account");
    expect(t.placeholder).toBe(false);
    expect(t.html).toContain("Account SID");
    expect(t.html).toContain("regulatory-compliance/bundles");
  });
});
