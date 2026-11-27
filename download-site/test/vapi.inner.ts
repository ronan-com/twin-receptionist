// Telnyx is the main path; Vapi and Twilio are backup options on the last optional screen. Providers are stubbed: no network.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vapi-test-"));
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "HOSTING"]) delete process.env[k];

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
  updateSetup(b.id, (s) => { s.railway = { confirmed: true }; s.step = "phones"; });
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
    // The balance, then the two pretrial probes (a paid account can list both).
    expect(calls.map((c) => c.url)).toEqual(["https://api.telnyx.com/v2/balance", "https://api.telnyx.com/v2/ai/assistants?page[size]=1", "https://api.telnyx.com/v2/call_control_applications?page[size]=1"]);
    expect(getSetup(b.id).phones).toMatchObject({ provider: "telnyx", confirmed: true });
    expect(getSetup(b.id).vapi).toBeUndefined();
    expect(hasSecret(b.id, "vapi_key")).toBe(false);
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({ TELNYX_API_KEY: TKEY });
    // No key, no way on.
    const c = await buyer("a2");
    expect((await run(c, "phones", {}))?.kind).toBe("err");
  });

  test("Vapi added from the extras screen: both keys checked with one cheap GET, then the install gets VOICE_PROVIDER=vapi", async () => {
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
    expect(s.step).toBe("extras");
    // The Vapi path hands the app no Telnyx key; re-checking Telnyx afterwards does not undo the Vapi choice.
    expect(phoneSettings(b.id, s)).toEqual({ VOICE_PROVIDER: "vapi", VAPI_API_KEY: "priv-0123456789abcdef", VAPI_PUBLIC_KEY: "pub-0123456789abcdef" });
    telnyxOk();
    await run(b, "phones", { key: TKEY });
    expect(phoneSettings(b.id, getSetup(b.id)).VOICE_PROVIDER).toBe("vapi");
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
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({ TELNYX_API_KEY: TKEY });
  });

  test("no Telnyx account: go on to the backup options; install needs Telnyx or Vapi", async () => {
    const b = await buyer("d");
    expect(await run(b, "phones-backup")).toBeNull();
    expect(getSetup(b.id).step).toBe("extras");
    expect(firstOpen(b, getSetup(b.id))).toBe("extras");
    // Neither added yet: Continue is refused.
    expect((await run(b, "extras-continue"))?.kind).toBe("err");
    stub(200);
    expect(await run(b, "vapi", VOK)).toBeNull();
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({ VOICE_PROVIDER: "vapi", VAPI_API_KEY: "priv-0123456789abcdef", VAPI_PUBLIC_KEY: "pub-0123456789abcdef" });
    expect(await run(b, "extras-continue")).toBeNull();
    expect(getSetup(b.id).step).toBe("install");
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
    expect(await run(b, "phones-backup")).toBeNull();
    expect(await run(b, "vapi", { ...VOK, key: TKEY })).toBeNull();
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
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({ TELNYX_API_KEY: TKEY, TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: "t".repeat(32) });
    expect(await run(b, "twilio-skip")).toBeNull();
    expect(hasSecret(b.id, "twilio_token")).toBe(false);
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({ TELNYX_API_KEY: TKEY });
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

  test("the screens: Phones has Telnyx (recommended) first and Vapi + Twilio under it; the extras screen no longer repeats them", async () => {
    const { wizardPage } = await import("../wizard");
    const b = await buyer("j");
    const html = (view: string) => wizardPage(b, getSetup(b.id), b.code, "sid", view as any);
    const phones = html("phones");
    expect(phones).toContain("Option A: Telnyx <span class=\"tag\">Recommended</span>");
    expect(phones).toContain("Option B: Vapi");
    expect(phones.indexOf("Telnyx API key")).toBeLessThan(phones.indexOf("Option B: Vapi"));
    expect(phones).not.toContain('name="provider"');
    updateSetup(b.id, (s) => { s.phones = { confirmed: true, provider: "telnyx" }; s.step = "extras"; });
    const extras = html("extras");
    expect(extras).not.toContain("Other options (backup)");
    expect(extras).not.toContain("Use Vapi instead of Telnyx for voice");
    expect(extras.match(/Add now/g)!.length).toBe(3);
    expect(html("vapi")).toContain("Vapi for voice");
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
