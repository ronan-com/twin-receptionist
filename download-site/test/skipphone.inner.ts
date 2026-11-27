// Voice (Telnyx or Vapi) and AI (OpenRouter) are REQUIRED: there is no Skip, a buyer who had skipped Voice before is sent back to it,
// and Install is refused until both are connected with a key that passed its check.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "skipphone-test-"));
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "HOSTING"]) delete process.env[k];

const { addBuyer } = await import("../lib");
const { actions, phoneSettings, railwayVars, firstOpen } = await import("../setup");
const { getSetup, hasSecret, putSecret, updateSetup, deleteSecret } = await import("../store");
const { wizardPage } = await import("../wizard");
const { installBlockers, detailOf, fillStep, stepRows } = await import("../assist");
const { getSecret } = await import("../store");

const realFetch = globalThis.fetch;
let calls: string[] = [];
const stub = (status: number, body: unknown) => {
  calls = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as any;
};
afterAll(() => { globalThis.fetch = realFetch; });

const run = async (b: any, name: string, f: Record<string, string> = {}) => actions[name](b, f);
async function buyer(n: string) {
  const b = addBuyer(`Buyer ${n}`, `skip-${n}@example.com`);
  await run(b, "start");
  await run(b, "brand", { productName: "Acme Calls", ownerEmail: "boss@acme.test" });
  putSecret(b.id, "railway_token", "rail-token-0123456789");
  putSecret(b.id, "openrouter_key", "sk-or-test-0123456789"); // AI is required and already done in most of these tests
  updateSetup(b.id, (s) => { s.railway = { confirmed: true }; s.ai = { confirmed: true }; s.extrasDone = true; s.step = "phones"; });
  return b;
}
const html = (b: any, view: string) => wizardPage(b, getSetup(b.id), b.code, "sid", view as any);
const TKEY = "KEY0123456789ABCDEF0123456789_abcdefghijkl";

describe("Voice and AI are required", () => {
  test("the Voice and Vapi steps have no Skip, and the skip action is gone", async () => {
    const b = await buyer("a");
    for (const v of ["phones", "vapi"]) {
      expect(html(b, v)).not.toContain("Skip for now");
      expect(html(b, v)).not.toContain("phones-skip");
      expect(html(b, v)).not.toContain("data-skip-phones");
    }
    expect(html(b, "phones")).toContain("Stuck on Telnyx");
    expect((actions as any)["phones-skip"]).toBeUndefined();
  });

  test("no voice key: Install is refused and the wizard stays on Voice (also with the backup-options shortcut)", async () => {
    const b = await buyer("b");
    expect(firstOpen(b, getSetup(b.id))).toBe("phones");
    expect((await run(b, "install-start"))?.kind).toBe("err");
    await run(b, "phones-backup"); // the DigitalOcean-era "no Telnyx yet" shortcut must not count on Railway
    expect(firstOpen(b, getSetup(b.id))).toBe("phones");
    expect((await run(b, "install-start"))?.text).toMatch(/earlier steps|voice|Telnyx/i);
    expect(await run(b, "phones-continue")).toBeNull();
    expect(getSetup(b.id).step).not.toBe("install");
  });

  test("a buyer who skipped Voice before it became required is sent back to Voice", async () => {
    const b = await buyer("old");
    updateSetup(b.id, (s) => { s.phones = { deferred: true, provider: "telnyx" }; s.skipped = { phones: true, vapi: true }; s.step = "install"; });
    expect(firstOpen(b, getSetup(b.id))).toBe("phones");
    expect((await run(b, "install-start"))?.kind).toBe("err");
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({}); // nothing is sent to an app without a key
  });

  test("no OpenRouter key: Continue does not move on and Install is refused; a validated key (stored) opens the way", async () => {
    const b = await buyer("ai");
    stub(200, { data: { available_credit: "12.50", currency: "USD" } });
    expect(await run(b, "phones", { key: TKEY })).toBeNull();
    await run(b, "phones-continue");
    deleteSecret(b.id, "openrouter_key");
    updateSetup(b.id, (s) => { s.ai = undefined; s.step = "ai"; });
    expect(firstOpen(b, getSetup(b.id))).toBe("ai");
    await run(b, "ai-continue");
    expect(getSetup(b.id).step).toBe("ai");
    expect((await run(b, "install-start"))?.kind).toBe("err");
    // "confirmed" without a stored key does not count either
    updateSetup(b.id, (s) => { s.ai = { confirmed: true, via: "paste" }; });
    expect(firstOpen(b, getSetup(b.id))).toBe("ai");
    putSecret(b.id, "openrouter_key", "sk-or-test-0123456789");
    expect(firstOpen(b, getSetup(b.id))).toBe("install");
  });

  test("Telnyx path: one key on the Phones step, done, the app gets TELNYX_API_KEY", async () => {
    const b = await buyer("t");
    stub(200, { data: { available_credit: "12.50", currency: "USD" } });
    expect(await run(b, "phones", { key: TKEY })).toBeNull();
    expect(calls).toEqual(["https://api.telnyx.com/v2/balance", "https://api.telnyx.com/v2/ai/assistants?page[size]=1", "https://api.telnyx.com/v2/call_control_applications?page[size]=1", "https://api.telnyx.com/v2/phone_numbers?page[size]=100&page[number]=1"]); // the balance, the pretrial probes, then the numbers already on the account
    // It stays on Voice so the buyer sees what Telnyx found; Continue moves on.
    expect(getSetup(b.id).step).toBe("phones");
    expect(await run(b, "phones-continue")).toBeNull();
    expect(firstOpen(b, getSetup(b.id))).toBe("install");
    const vars = await railwayVars(b.id, getSetup(b.id), "rail-token-0123456789");
    expect(vars.TELNYX_API_KEY).toBe(TKEY);
    expect(vars.VOICE_PROVIDER).toBe("telnyx");
  });

  test("Vapi + Twilio path: both checked on the Phones step itself, the step is done, the app gets Vapi and Twilio", async () => {
    const SID = "AC" + "c".repeat(32);
    const b = await buyer("v");
    // Missing fields are refused before anything is called.
    stub(200, {});
    // Half of the Twilio details is refused (Twilio itself is optional: both empty is fine, see the Vapi-only test).
    expect((await run(b, "phones-vapi", { vapiKey: "priv-0123456789abcdef", vapiPublic: "pub-0123456789abcdef", twilioSid: SID }))?.text).toMatch(/Twilio Auth Token/);
    expect(calls).toHaveLength(0);
    // Twilio refusing is an error, and nothing is kept.
    globalThis.fetch = (async (url: any) => new Response(JSON.stringify(String(url).includes("twilio") ? { message: "Authenticate" } : []), { status: String(url).includes("twilio") ? 401 : 200, headers: { "Content-Type": "application/json" } })) as any;
    expect((await run(b, "phones-vapi", { vapiKey: "priv-0123456789abcdef", vapiPublic: "pub-0123456789abcdef", twilioSid: SID, twilioToken: "t".repeat(32) }))?.kind).toBe("err");
    expect(hasSecret(b.id, "vapi_key")).toBe(false);
    expect(getSetup(b.id).vapi).toBeUndefined();
    // Both accepted.
    calls = [];
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url));
      return new Response(JSON.stringify(String(url).includes("twilio") ? { status: "active", friendly_name: "Acme" } : []), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;
    expect(await run(b, "phones-vapi", { vapiKey: "priv-0123456789abcdef", vapiPublic: "pub-0123456789abcdef", twilioSid: SID, twilioToken: "t".repeat(32) })).toBeNull();
    expect(calls).toEqual(["https://api.vapi.ai/assistant?limit=1", `https://api.twilio.com/2010-04-01/Accounts/${SID}.json`]);
    const s = getSetup(b.id);
    expect(s.vapi?.confirmed).toBe(true);
    expect(s.twilio).toMatchObject({ sid: SID, confirmed: true });
    expect(s.step).toBe("install");
    expect(stepRows(b, s).find((r) => r.id === "phones")?.done).toBe(true);
    expect(phoneSettings(b.id, s)).toEqual({ VOICE_PROVIDER: "vapi", VAPI_API_KEY: "priv-0123456789abcdef", VAPI_PUBLIC_KEY: "pub-0123456789abcdef", TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: "t".repeat(32) });
    expect(firstOpen(b, getSetup(b.id))).toBe("install");
    expect(html(b, "phones")).toContain("Vapi connected");
    expect(html(b, "install")).toContain("Vapi");
    // "Use Telnyx instead" forgets both and goes back to Phones.
    expect(await run(b, "phones-vapi-remove")).toBeNull();
    expect(getSecret(b.id, "vapi_key")).toBeNull();
    expect(getSetup(b.id).step).toBe("phones");
  });

  test("our admin's Set up for them offers Telnyx or Vapi + Twilio (no skip)", async () => {
    const b = await buyer("adm");
    const SID = "AC" + "d".repeat(32);
    globalThis.fetch = (async (url: any) => new Response(JSON.stringify(String(url).includes("twilio") ? { status: "active", friendly_name: "Acme" } : []), { status: 200, headers: { "Content-Type": "application/json" } })) as any;
    const out = await fillStep(b, "admin@us.test", "phones", { vapiKey: "priv-0123456789abcdef", vapiPublic: "pub-0123456789abcdef", twilioSid: SID, twilioToken: "t".repeat(32) }, "phones-vapi");
    expect(out.ok).toBe(true);
    const s = getSetup(b.id);
    expect(s.skipped?.phones).toBeUndefined();
    expect(s.assist?.steps?.phones?.by).toBe("admin@us.test");
    expect(detailOf(b, s, "phones")).toContain("Twilio " + SID);
  });
});
