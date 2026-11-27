// The Texts switch: status, on/off, retry, and switching on by itself when a pending number goes live.
// Telnyx is pretended (fetch is stubbed); Twilio is a stand-in. Uses the scratch database.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";

process.env.TELNYX_API_KEY = "KEY-test";
process.env.SMS_WEBHOOK_SECRET = "test-sms-secret";
const { migrate, sql } = await import("./db");
const { publicUrl, savePublicUrl } = await import("./booking");
const { getClient, insertClient } = await import("./store");
const { setTexts, splitNumbers, textsAfterBuy, textsStatus, textsWhenLive } = await import("./textsControl");
const { smsNumberOf } = await import("./automations");

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

const live = { active: [MOBILE], pending: [] as string[] };
const twilioStub = (canText: string[]) => {
  const log: string[] = [];
  return { log, tw: { canText: async (n: string[]) => n.filter((x) => canText.includes(x)), point: async (_c: string, n: string) => (log.push(`point ${n}`), true), release: async (_c: string, n: string) => void log.push(`release ${n}`) } };
};

describe("sorting the engine's numbers", () => {
  test("live ones answer; ones still being approved, and numbers in open orders, are pending", () => {
    expect(splitNumbers({ numbers: [{ phoneNumber: "+61255501301", status: "active" }, { phoneNumber: MOBILE, status: "purchase-pending" }], pending: [{ phoneNumbers: ["+61480011302", MOBILE] }] })).toEqual({
      active: ["+61255501301"],
      pending: [MOBILE, "+61480011302"],
    });
  });
});

describe("the Texts switch on Telnyx", () => {
  test("status: waiting while the number is approved, can't for a landline or none, on once connected, off when switched off", async () => {
    if (!ready) return;
    const c = base({ textingProfileId: "prof-1" });
    answer(/messaging_profiles\/prof-1\/phone_numbers/, { data: [] });
    expect((await textsStatus(c, { active: [], pending: [MOBILE] })).status).toBe("waiting");
    expect((await textsStatus(c, { active: ["+61255501301"], pending: [] })).status).toBe("cant");
    expect((await textsStatus(c, { active: [], pending: [] })).status).toBe("cant");
    // A live mobile that isn't on the profile: switched on but not connected, so "failed" (try again).
    expect((await textsStatus(c, live)).status).toBe("failed");
    answers = [];
    answer(/messaging_profiles\/prof-1\/phone_numbers/, { data: [{ phone_number: MOBILE }] });
    expect(await textsStatus(c, live)).toMatchObject({ status: "on", on: true, enabled: true, numbers: [MOBILE] });
    expect(await textsStatus({ ...c, textsPref: "off" }, live)).toMatchObject({ status: "off", on: false });
  });

  test("off disables our profile and stops follow-up texts; on enables it and puts the mobile back on it (a retry works the same)", async () => {
    if (!ready) return;
    const c = base({ textingProfileId: "prof-2" });
    await insertClient(orgId, c);
    answer(/messaging_profiles\/prof-2\/phone_numbers/, { data: [{ phone_number: MOBILE }] });
    await setTexts(c, false, live);
    expect(calls.find((x) => x.method === "PATCH" && x.path === "/messaging_profiles/prof-2")!.body).toEqual({ enabled: false });
    expect((await getClient(c.id))!.textsPref).toBe("off");
    expect(await smsNumberOf((await getClient(c.id))!)).toBeNull();
    calls.length = 0;
    await setTexts((await getClient(c.id))!, true, live);
    expect(sent()).toEqual(["PATCH /messaging_profiles/prof-2", `PATCH /messaging_phone_numbers/${MOBILE}`, "GET /messaging_profiles/prof-2/phone_numbers?page[size]=20"]);
    expect(calls[0].body.enabled).toBe(true);
    expect(calls[1].body).toEqual({ messaging_profile_id: "prof-2" });
    expect((await getClient(c.id))!.textsPref).toBe("on");
    expect(await smsNumberOf((await getClient(c.id))!)).toBe(MOBILE);
  });

  test("switching on while the number is pending only remembers it; nothing is sent to Telnyx", async () => {
    if (!ready) return;
    const c = base({ textsPref: "off" });
    await insertClient(orgId, c);
    await setTexts(c, true, { active: [], pending: [MOBILE] });
    expect(calls.length).toBe(0);
    expect((await getClient(c.id))!.textsPref).toBe("on");
  });

  test("a mobile bought live is connected and texts are marked on; a pending one is marked on and waits", async () => {
    if (!ready) return;
    const live1 = base();
    await insertClient(orgId, live1);
    answer(/^\/messaging_profiles$/, { data: { id: "prof-new" } });
    await textsAfterBuy(live1, { status: "success", phoneNumbers: [MOBILE] });
    expect(calls.some((x) => x.method === "PATCH" && x.path === `/messaging_phone_numbers/${encodeURIComponent(MOBILE)}`)).toBe(true);
    expect((await getClient(live1.id))!.textsPref).toBe("on");

    calls.length = 0;
    const waiting = base();
    await insertClient(orgId, waiting);
    await textsAfterBuy(waiting, { status: "pending", phoneNumbers: [MOBILE] });
    expect(calls.length).toBe(0);
    expect((await getClient(waiting.id))!.textsPref).toBe("on");

    // A landline or US number never switches texts on.
    const land = base({ phoneNumbers: ["+61255501301"] });
    await insertClient(orgId, land);
    await textsAfterBuy(land, { status: "success", phoneNumbers: ["+61255501301", "+12125550101"] });
    expect((await getClient(land.id))!.textsPref).toBeUndefined();

    // Turned off by the owner: a new number doesn't turn it back on.
    const off = base({ textsPref: "off" });
    await insertClient(orgId, off);
    calls.length = 0;
    await textsAfterBuy(off, { status: "success", phoneNumbers: [MOBILE] });
    expect(calls.length).toBe(0);
    expect((await getClient(off.id))!.textsPref).toBe("off");
  });

  test("a pending number that goes live starts texting when the switch is on, and not when it's off or never set", async () => {
    if (!ready) return;
    answer(/^\/messaging_profiles$/, { data: { id: "prof-live" } });
    const on = base({ textsPref: "on" });
    await insertClient(orgId, on);
    await textsWhenLive(on, [MOBILE]);
    expect(calls.some((x) => x.method === "PATCH" && x.path === `/messaging_phone_numbers/${encodeURIComponent(MOBILE)}`)).toBe(true);
    calls.length = 0;
    await textsWhenLive(base({ textsPref: "off" }), [MOBILE]);
    await textsWhenLive(base(), [MOBILE]);
    await textsWhenLive({ ...on, textsPref: "on" }, ["+61255501301"]);
    expect(calls.length).toBe(0);
  });
});

describe("the Texts switch on Twilio (Vapi)", () => {
  test("on points each texting number at us, off releases them; no texting number is 'can't'", async () => {
    if (!ready) return;
    const c = base({ voiceProvider: "vapi" });
    await insertClient(orgId, c);
    const t = twilioStub([MOBILE]);
    const nums = { active: [MOBILE, "+61255501301"], pending: [] as string[] };
    expect(await textsStatus(c, nums, t.tw)).toMatchObject({ status: "on", numbers: [MOBILE], waiting: ["+61255501301"] });
    await setTexts(c, true, nums, t.tw);
    expect(t.log).toEqual([`point ${MOBILE}`]);
    t.log.length = 0;
    await setTexts(c, false, nums, t.tw);
    expect(t.log).toEqual([`release ${MOBILE}`, "release +61255501301"]);
    expect(await textsStatus((await getClient(c.id))!, nums, t.tw)).toMatchObject({ status: "off", on: false });
    expect((await textsStatus(c, nums, twilioStub([]).tw)).status).toBe("cant");
    expect(calls.length).toBe(0);
  });
});
