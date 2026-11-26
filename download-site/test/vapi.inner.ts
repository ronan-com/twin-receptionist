// The wizard's phones step with Vapi chosen. Providers are stubbed: no network.
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
const { actions, phoneSettings } = await import("../setup");
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

describe("Vapi on the phones step", () => {
  test("both keys are checked with one cheap GET, then saved and Vapi is chosen", async () => {
    const b = await buyer("a");
    stub(200);
    const r = await run(b, "phones", { provider: "vapi", vapiKey: "priv-0123456789abcdef", vapiPublic: "pub-0123456789abcdef" });
    expect(r).toBeNull();
    expect(calls).toEqual([{ url: "https://api.vapi.ai/assistant?limit=1", auth: "Bearer priv-0123456789abcdef" }]);
    expect(getSecret(b.id, "vapi_key")).toBe("priv-0123456789abcdef");
    expect(getSecret(b.id, "vapi_public")).toBe("pub-0123456789abcdef");
    expect(getSetup(b.id).phones).toMatchObject({ provider: "vapi", confirmed: true });
  });

  test("a key Vapi refuses is an error, and nothing is saved", async () => {
    const b = await buyer("b");
    stub(401, { message: "Invalid Key." });
    const r = await run(b, "phones", { provider: "vapi", vapiKey: "priv-bad-0123456789ab", vapiPublic: "pub-0123456789abcdef" });
    expect(r?.kind).toBe("err");
    expect(hasSecret(b.id, "vapi_key")).toBe(false);
    expect(getSetup(b.id).phones?.confirmed).toBeFalsy();
  });

  test("the public key is required, and the two keys must differ; nothing is called", async () => {
    const b = await buyer("c");
    stub(200);
    expect((await run(b, "phones", { provider: "vapi", vapiKey: "priv-0123456789abcdef" }))?.kind).toBe("err");
    expect((await checkVapi("same-0123456789", "same-0123456789")).ok).toBe(false);
    expect((await checkVapi("has space 123", "pub-0123456789")).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("the install gets VOICE_PROVIDER=vapi and both keys; Telnyx stays the default", async () => {
    const b = await buyer("d");
    stub(200);
    await run(b, "phones", { provider: "vapi", vapiKey: "priv-0123456789abcdef", vapiPublic: "pub-0123456789abcdef" });
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({ VOICE_PROVIDER: "vapi", VAPI_API_KEY: "priv-0123456789abcdef", VAPI_PUBLIC_KEY: "pub-0123456789abcdef", TELNYX_API_KEY: "" });

    const t = await buyer("e");
    stub(200, { data: { available_credit: "12.50", currency: "USD" } });
    expect(await run(t, "phones", { key: "KEY0123456789ABCDEF0123456789_abcdefghijkl" })).toBeNull();
    expect(calls[0].url).toBe("https://api.telnyx.com/v2/balance");
    expect(getSetup(t.id).phones).toMatchObject({ provider: "telnyx", confirmed: true });
    expect(phoneSettings(t.id, getSetup(t.id))).toEqual({ TELNYX_API_KEY: "KEY0123456789ABCDEF0123456789_abcdefghijkl" });
  });

  test("with Vapi, a Telnyx key is optional and is kept for email replies", async () => {
    const b = await buyer("f");
    globalThis.fetch = (async (url: any) =>
      new Response(JSON.stringify(String(url).includes("telnyx") ? { data: { available_credit: "5", currency: "USD" } } : []), { status: 200, headers: { "Content-Type": "application/json" } })) as any;
    expect(await run(b, "phones", { provider: "vapi", vapiKey: "priv-0123456789abcdef", vapiPublic: "pub-0123456789abcdef", key: "KEY0123456789ABCDEF0123456789_abcdefghijkl" })).toBeNull();
    expect(getSecret(b.id, "telnyx_key")).toBe("KEY0123456789ABCDEF0123456789_abcdefghijkl");
    expect(phoneSettings(b.id, getSetup(b.id)).VOICE_PROVIDER).toBe("vapi");
    expect(phoneSettings(b.id, getSetup(b.id)).TELNYX_API_KEY).toBe("KEY0123456789ABCDEF0123456789_abcdefghijkl");
  });

  test("the page offers both services and a Vapi Show me how", async () => {
    const { howTo } = await import("../content");
    expect(howTo("vapi-account").html).toContain("US");
    expect(howTo("vapi-api-key").html).toContain("Public Key");
    expect(howTo("vapi-api-key").placeholder).toBe(false);
  });
});
