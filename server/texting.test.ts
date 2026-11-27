// Telnyx texting without the Telnyx AI assistant: our own messaging profile whose webhook is our text
// chatbot, texts sent through POST /messages, and receptionists made before this moved over.
// Telnyx is pretended (fetch is stubbed). Uses the scratch database:  DATABASE_URL=... bun test server/texting.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";

process.env.TELNYX_API_KEY = "KEY-test";
process.env.SMS_WEBHOOK_SECRET = "test-sms-secret";
const { migrate, sql } = await import("./db");
const { smsHookUrl } = await import("./smsWebhook");
const { publicUrl, savePublicUrl } = await import("./booking");
const { getClient, insertClient } = await import("./store");
const { enableTexting, migrateTexting, removeTextingProfile, sendTelnyxText, textingState } = await import("./texting");
const { sendSms } = await import("./sms");

const orgId = crypto.randomUUID();
const now = new Date().toISOString();
const APP = "https://app.example.com";
const base = (over: Partial<Business> = {}): Business => ({
  id: crypto.randomUUID(),
  assistantId: "assistant-" + crypto.randomUUID().slice(0, 8),
  settings: { ...blankSettings(), businessName: "Alpha Plumbing" },
  instructions: "",
  phoneNumbers: ["+61480011301"],
  createdAt: now,
  updatedAt: now,
  ...over,
});
const realFetch = globalThis.fetch;
let ready = true;
let calls: { method: string; path: string; body: any }[] = [];
let answers: { match: RegExp; body: unknown; status?: number }[] = [];
beforeAll(async () => {
  try {
    await migrate();
    // This server's public address (as `bun run tunnel` would report it), so profiles can carry our webhook.
    if (!publicUrl()) await savePublicUrl(APP);
    await sql`insert into orgs (id, name, platform_telnyx) values (${orgId}, 'texting test', true)`;
  } catch (err) {
    ready = false;
    console.warn("[texting.test] no database, skipping:", (err as Error).message);
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
const answer = (match: RegExp, body: unknown, status = 200) => answers.push({ match, body, status });

describe("our own messaging profile", () => {
  test("sendTelnyxText posts one SMS to /messages", async () => {
    await sendTelnyxText({ from: "+61480011301", to: "+61412345678", text: "hi" });
    expect(calls).toEqual([{ method: "POST", path: "/messages", body: { from: "+61480011301", to: "+61412345678", text: "hi", type: "SMS" } }]);
  });

  test("enabling makes a profile (no AI assistant) whose webhook is our text address, keeps its id, and is safe to repeat", async () => {
    if (!ready) return;
    const c = base();
    await insertClient(orgId, c);
    const url = smsHookUrl("telnyx", c.id, publicUrl());
    answer(/^\/messaging_profiles$/, { data: { id: "prof-1" } });
    expect(await enableTexting(c)).toBe("prof-1");
    const make = calls.find((x) => x.method === "POST" && x.path === "/messaging_profiles")!;
    expect(make.body.webhook_url).toBe(url);
    expect(make.body.webhook_api_version).toBe("2");
    expect(make.body.ai_assistant_id).toBeUndefined();
    expect(make.body.whitelisted_destinations).toEqual(["AU"]);
    expect(make.body.daily_spend_limit_enabled).toBe(true);
    expect((await getClient(c.id))!.textingProfileId).toBe("prof-1");
    calls.length = 0;
    expect(await enableTexting((await getClient(c.id))!)).toBe("prof-1");
    expect(calls.map((x) => `${x.method} ${x.path}`)).toEqual(["PATCH /messaging_profiles/prof-1"]);
  });

  test("with no public address texting can't be set up, and says why", async () => {
    const { smsHookUrl: hook } = await import("./smsWebhook");
    expect(hook("telnyx", "x", "")).toBe("");
  });

  test("the texts card lists the numbers on our profile; a receptionist with none shows off", async () => {
    const off = base({ phoneNumbers: ["+61480011301"] });
    expect(await textingState({ ...off, assistantId: "demo-x" })).toEqual({ enabled: false, numbers: [], waiting: ["+61480011301"] });
    answer(/messaging_profiles\/prof-9\/phone_numbers/, { data: [{ phone_number: "+61480011301" }] });
    const on = base({ textingProfileId: "prof-9", phoneNumbers: ["+61480011301", "+61255501301"] });
    expect(await textingState(on)).toEqual({ enabled: true, numbers: ["+61480011301"], waiting: ["+61255501301"] });
  });

  test("a profile is only removed when it is ours or was linked to this receptionist's assistant", async () => {
    const c = base();
    answer(/messaging_profiles\/other$/, { data: { id: "other", ai_assistant_id: "someone-else", webhook_url: "https://x/hooks" } });
    await removeTextingProfile("other", c);
    expect(calls.some((x) => x.method === "DELETE")).toBe(false);
    answer(/messaging_profiles\/legacy$/, { data: { id: "legacy", ai_assistant_id: c.assistantId } });
    await removeTextingProfile("legacy", c);
    expect(calls.some((x) => x.method === "DELETE" && x.path === "/messaging_profiles/legacy")).toBe(true);
    answer(/messaging_profiles\/ours$/, { data: { id: "ours", webhook_url: `https://app/hooks/sms/telnyx/${c.id}/secret` } });
    await removeTextingProfile("ours", c);
    expect(calls.some((x) => x.method === "DELETE" && x.path === "/messaging_profiles/ours")).toBe(true);
  });
});

describe("a receptionist from before our own texting", () => {
  test("its numbers move off the assistant-linked profile onto ours, and the old profile is removed", async () => {
    if (!ready) return;
    const c = base();
    await insertClient(orgId, c);
    answer(new RegExp(`^/ai/assistants/${c.assistantId}$`), { data: { enabled_features: ["telephony", "messaging"], messaging_settings: { default_messaging_profile_id: "old-prof" } } });
    answer(/^\/messaging_profiles\/old-prof\/phone_numbers/, { data: [{ phone_number: "+61480011301" }] });
    answer(/^\/messaging_profiles\/old-prof$/, { data: { id: "old-prof", ai_assistant_id: c.assistantId } });
    answer(/^\/messaging_profiles$/, { data: { id: "new-prof" } });
    await migrateTexting(c);
    const moved = calls.find((x) => x.method === "PATCH" && x.path.startsWith("/messaging_phone_numbers/"))!;
    expect(decodeURIComponent(moved.path)).toBe("/messaging_phone_numbers/+61480011301");
    expect(moved.body).toEqual({ messaging_profile_id: "new-prof" });
    expect(calls.some((x) => x.method === "DELETE" && x.path === "/messaging_profiles/old-prof")).toBe(true);
    expect((await getClient(c.id))!.textingProfileId).toBe("new-prof");
    // Already moved: nothing more happens.
    calls.length = 0;
    await migrateTexting((await getClient(c.id))!);
    expect(calls.length).toBe(0);
  });
});

describe("sending", () => {
  test("a Telnyx receptionist's follow-ups go through Telnyx's messages API, not the assistant", async () => {
    if (!ready) return;
    const c = base();
    await insertClient(orgId, c);
    await sendSms(c, { from: "+61480011301", to: "+61412345678", text: "Reminder", meta: { twin_followup: "reminder" } });
    expect(calls.map((x) => `${x.method} ${x.path}`)).toEqual(["POST /messages"]);
    expect(calls[0].body).toMatchObject({ from: "+61480011301", to: "+61412345678", text: "Reminder" });
  });
});
