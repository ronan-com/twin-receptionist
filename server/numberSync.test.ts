// The background number check: a receptionist with a number waiting for approval is asked again, the number shows
// as live, and texting switches on by itself when the Texts switch is on. A failure never stops the rest.
// Telnyx is pretended (fetch is stubbed). Uses the scratch database.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";

process.env.TELNYX_API_KEY = "KEY-test";
process.env.SMS_WEBHOOK_SECRET = "test-sms-secret";
const { migrate, sql } = await import("./db");
const { publicUrl, savePublicUrl } = await import("./booking");
const { getClient, insertClient } = await import("./store");
const { syncPendingNumbers, pendingClientsFromDb } = await import("./numberSync");

const orgId = crypto.randomUUID();
const now = new Date().toISOString();
const APP = "https://app.example.com";
const MOBILE = "+61480011301";
const base = (over: Partial<Business> = {}): Business => ({
  id: crypto.randomUUID(),
  assistantId: "assistant-" + crypto.randomUUID().slice(0, 8),
  settings: { ...blankSettings(), businessName: "Alpha Plumbing" },
  instructions: "",
  phoneNumbers: [MOBILE],
  createdAt: now,
  updatedAt: now,
  ...over,
});
const realFetch = globalThis.fetch;
let ready = true;
let calls: { method: string; path: string; body: any }[] = [];
let answers: { match: RegExp; body: unknown; status?: number }[] = [];
const answer = (match: RegExp, body: unknown, status = 200) => answers.push({ match, body, status });
const sent = () => calls.map((x) => `${x.method} ${decodeURIComponent(x.path)}`);

beforeAll(async () => {
  try {
    await migrate();
    if (!publicUrl()) await savePublicUrl(APP);
    await sql`insert into orgs (id, name, platform_telnyx) values (${orgId}, 'texts control test', true)`;
  } catch (err) {
    ready = false;
    console.warn("[textsControl.test] no database, skipping:", (err as Error).message);
  }
}, 60000);
afterAll(async () => {
  globalThis.fetch = realFetch;
  if (publicUrl() === APP) await savePublicUrl("");
  if (ready) {
    await sql`delete from clients where org_id = ${orgId}`;
    await sql`delete from orgs where id = ${orgId}`;
  }
});
beforeEach(() => {
  calls = [];
  answers = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const path = String(input).replace("https://api.telnyx.com/v2", "");
    calls.push({ method: init.method ?? "GET", path, body: init.body ? JSON.parse(init.body) : undefined });
    const a = answers.find((x) => x.match.test(path));
    return new Response(JSON.stringify(a?.body ?? {}), { status: a?.status ?? 200 });
  }) as any;
});

const patched = () => calls.some((x) => x.method === "PATCH" && x.path === `/messaging_phone_numbers/${encodeURIComponent(MOBILE)}`);
const engine = (status: string) => async () => ({ numbers: [{ phoneNumber: MOBILE, status }], pending: [] as { phoneNumbers: string[] }[] });

describe("the background number check", () => {
  test("a pending mobile that goes live is shown live and texting switches on (switch on or never touched), not when off", async () => {
    if (!ready) return;
    answer(/^\/messaging_profiles$/, { data: { id: "prof-bg" } });
    const mk = (over: Partial<Business>) => base({ phoneNumbers: [MOBILE], pendingNumbers: [MOBILE], ...over });
    const untouched = mk({});
    const off = mk({ textsPref: "off" });
    await insertClient(orgId, untouched);
    await insertClient(orgId, off);

    // Only receptionists with pending numbers are picked up.
    const none = base({ phoneNumbers: [MOBILE] });
    await insertClient(orgId, none);
    const ids = (await pendingClientsFromDb()).map((x) => x.client.id);
    expect(ids).toContain(untouched.id);
    expect(ids).not.toContain(none.id);

    // Still pending at the carrier: nothing happens, it stays pending.
    const still = await syncPendingNumbers({ pendingClients: async () => [{ client: untouched, orgId }], readNumbers: engine("port-pending") });
    expect(still).toEqual({ checked: 1, failed: 0 });
    expect(calls.length).toBe(0);
    expect((await getClient(untouched.id))!.pendingNumbers).toEqual([MOBILE]);

    // Approved: the pending list clears and texting connects.
    await syncPendingNumbers({ pendingClients: async () => [{ client: untouched, orgId }], readNumbers: engine("active") });
    expect(patched()).toBe(true);
    expect((await getClient(untouched.id))!.pendingNumbers).toEqual([]);

    // Switch off: the number is live but texting stays off.
    calls.length = 0;
    await syncPendingNumbers({ pendingClients: async () => [{ client: off, orgId }], readNumbers: engine("active") });
    expect(patched()).toBe(false);
    expect((await getClient(off.id))!.pendingNumbers).toEqual([]);
  });

  test("a failing receptionist is logged and the rest still run", async () => {
    if (!ready) return;
    const a = base({ phoneNumbers: [MOBILE], pendingNumbers: [MOBILE] });
    const b = base({ phoneNumbers: [MOBILE], pendingNumbers: [MOBILE] });
    await insertClient(orgId, a);
    await insertClient(orgId, b);
    answer(/^\/messaging_profiles$/, { data: { id: "prof-bg2" } });
    const r = await syncPendingNumbers({
      pendingClients: async () => [{ client: a, orgId }, { client: b, orgId }],
      readNumbers: async (c) => {
        if (c.id === a.id) throw new Error("carrier down");
        return engine("active")(c as any, orgId);
      },
    });
    expect(r).toEqual({ checked: 1, failed: 1 });
    expect((await getClient(b.id))!.pendingNumbers).toEqual([]);
    expect((await getClient(a.id))!.pendingNumbers).toEqual([MOBILE]);
  });
});
