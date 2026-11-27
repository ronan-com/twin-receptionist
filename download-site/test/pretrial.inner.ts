// The checks for pretrial.test.ts: a Telnyx key on a pretrial account (it can't make AI assistants or buy numbers).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "pretrial-test-"));
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "HOSTING"]) delete process.env[k];

const { addBuyer, CONFIG } = await import("../lib");
const { actions } = await import("../setup");
const { getSetup, getSecret, putSecret, updateSetup } = await import("../store");
const { checkTelnyx, telnyxSaysPretrial, TELNYX_PRETRIAL_MSG } = await import("../providers");

const KEY = "KEY0123456789ABCDEF0123456789_abcdefghijkl";
const realFetch = globalThis.fetch;
let calls: string[] = [];
/** Telnyx, pretend: the balance always answers; the two lists a pretrial account can't use answer `gated`. */
function telnyx(gated: { status: number; body: unknown }) {
  calls = [];
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    const r = u.includes("/v2/balance") ? { status: 200, body: { data: { available_credit: "3.50", currency: "USD" } } } : u.includes("/v2/ai/assistants") || u.includes("/v2/call_control_applications") ? gated : { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as any;
}
afterAll(() => { globalThis.fetch = realFetch; });
const PRETRIAL = { status: 403, body: { errors: [{ code: "10015", title: "Forbidden", detail: "AI Assistant creation and Inference require a Trial account or higher." }] } };
const PAID = { status: 200, body: { data: [] } };

async function buyer(n: string) {
  const b = addBuyer(`Buyer ${n}`, `pt-${n}@example.com`);
  await actions.start(b, {});
  await actions.brand(b, { productName: "Acme Calls", ownerEmail: "boss@acme.test" });
  putSecret(b.id, "railway_token", "rail-token-0123456789");
  updateSetup(b.id, (s) => { s.railway = { confirmed: true }; s.step = "phones"; });
  return b;
}

describe("Telnyx pretrial", () => {
  test("the signal: a refusal on the gated lists, or an answer about pretrial / account level", () => {
    expect(telnyxSaysPretrial(403, {})).toBe(true);
    expect(telnyxSaysPretrial(422, { errors: [{ detail: "Your account is in Pretrial. Upgrade your account level." }] })).toBe(true);
    expect(telnyxSaysPretrial(200, { data: [] })).toBe(false);
    expect(telnyxSaysPretrial(404, { errors: [{ detail: "pretrial" }] })).toBe(false);
    expect(telnyxSaysPretrial(500, {})).toBe(false);
    expect(telnyxSaysPretrial(422, { errors: [{ detail: "page size too large" }] })).toBe(false);
  });

  test("checkTelnyx: pretrial gets the upgrade message; paid passes; Telnyx trouble never blocks", async () => {
    telnyx(PRETRIAL);
    const p = await checkTelnyx(KEY);
    expect(p).toMatchObject({ ok: false, pretrial: true, message: TELNYX_PRETRIAL_MSG });
    expect(calls.some((c) => c.includes("/v2/ai/assistants"))).toBe(true);
    telnyx(PAID);
    expect(await checkTelnyx(KEY)).toMatchObject({ ok: true, balance: "3.50 USD" });
    telnyx({ status: 503, body: {} });
    expect((await checkTelnyx(KEY)).ok).toBe(true);
  });

  test("the Phones step: pretrial keeps the key, isn't done, shows the message; after upgrading, Check again passes", async () => {
    const b = await buyer("a");
    telnyx(PRETRIAL);
    const r = await actions.phones(b, { key: KEY });
    expect(r).toMatchObject({ kind: "err", text: TELNYX_PRETRIAL_MSG });
    expect(r!.form).toBeUndefined(); // the key is never echoed back into the form
    expect(getSecret(b.id, "telnyx_key")).toBe(KEY);
    expect(getSetup(b.id).phones?.confirmed).toBeFalsy();
    expect(getSetup(b.id).step).toBe("phones");
    telnyx(PAID);
    expect(await actions.phones(b, {})).toBeNull(); // Check again, with the saved key
    expect(getSetup(b.id).phones?.confirmed).toBe(true);
  });

  test("test mode: platform-fake-pretrial-... is a pretend pretrial key", async () => {
    CONFIG.mockTelnyx = true;
    try {
      expect(await checkTelnyx("platform-fake-pretrial-0001")).toMatchObject({ ok: false, pretrial: true });
      expect((await checkTelnyx("platform-fake-0001")).ok).toBe(true);
    } finally { CONFIG.mockTelnyx = false; }
  });
});
