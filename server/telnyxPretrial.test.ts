// A Telnyx key on a pretrial account (can't create AI assistants or buy numbers): Connections refuses it with the
// upgrade steps instead of connecting a key that would fail later. Telnyx is mocked (pretrial vs paid).
//   bun test server/telnyxPretrial.test.ts
import { afterAll, expect, test } from "bun:test";
// Nothing here touches the database; the module just wants an address to exist (Bun's SQL connects lazily).
process.env.DATABASE_URL ||= "postgres://unused@127.0.0.1:1/unused";
const { PRETRIAL_MSG, checkNewKey, isPretrial, telnyxSaysPretrial } = await import("./phoneAccount");

const KEY = "KEY0123456789ABCDEF0123456789_abcdefghijkl";
const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });
let calls: string[] = [];
function telnyx(gated: { status: number; body: unknown }) {
  calls = [];
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    const r = u.includes("/balance") ? { status: 200, body: { data: { available_credit: "3.50", currency: "USD" } } } : u.includes("/ai/assistants") || u.includes("/call_control_applications") ? gated : { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as any;
}
const PRETRIAL = { status: 403, body: { errors: [{ title: "Forbidden", detail: "AI Assistant creation and Inference require a Trial account or higher." }] } };

test("the signal: a refusal, or an answer about pretrial / account level; never a 404, 429 or 5xx", () => {
  expect(telnyxSaysPretrial(403, "")).toBe(true);
  expect(telnyxSaysPretrial(422, "The phone service said: your account is in Pretrial")).toBe(true);
  expect(telnyxSaysPretrial(404, "pretrial")).toBe(false);
  expect(telnyxSaysPretrial(429, "pretrial")).toBe(false);
  expect(telnyxSaysPretrial(500, "")).toBe(false);
  expect(telnyxSaysPretrial(422, "bad page size")).toBe(false);
});

test("pretrial: refused with the upgrade steps; paid: connects; Telnyx trouble never blocks", async () => {
  telnyx(PRETRIAL);
  expect(await isPretrial(KEY)).toBe(true);
  await expect(checkNewKey(KEY)).rejects.toThrow(PRETRIAL_MSG);
  expect(calls.some((c) => c.includes("/ai/assistants"))).toBe(true);
  telnyx({ status: 200, body: { data: [] } });
  expect(await checkNewKey(KEY)).toMatchObject({ key: KEY, balance: { amount: 3.5, currency: "USD" } });
  telnyx({ status: 503, body: {} });
  expect(await isPretrial(KEY)).toBe(false);
});
