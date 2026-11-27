// Spam and robocall filtering: block list, no-caller-ID option, script lines and webhook answers.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/spam.test.ts
import { describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { automationInstructions, defaultAutomations, normaliseAutomations, overlayPayload, statusFor } from "./automations";
import { callerOf } from "./routes/automations";
import { BLOCK_LIST_MAX, canonNumber, defaultSpam, isAnonymousCaller, normaliseBlockList, normaliseSpam, spamVariables, spamStatus } from "./spam";

function client(): Business {
  const now = new Date().toISOString();
  return {
    id: "11111111-2222-3333-4444-555555555555",
    assistantId: "assistant-123",
    settings: { ...blankSettings(), businessName: "Alpha Plumbing", timezone: "Australia/Brisbane", greeting: "Hi, Alpha Plumbing." },
    instructions: "base",
    phoneNumbers: ["+61412000999"],
    createdAt: now,
    updatedAt: now,
  } as Business;
}
const opts = { publicUrl: "https://answered.example", token: "tok_abcdefghijklmnop" };
const withSpam = (spam: Partial<ReturnType<typeof defaultSpam>["spam"]>) => normaliseAutomations({ spam }, defaultAutomations());

describe("block list", () => {
  test("numbers are normalised, de-duplicated and checked", () => {
    expect(normaliseBlockList(["0412 345 678", "+61412345678", "(07) 3123 4567", "+1 415 555 0123"])).toEqual(["+61412345678", "+61731234567", "+14155550123"]);
    expect(normaliseBlockList("0412345678\n0400111222, 0400111222")).toEqual(["+61412345678", "+61400111222"]);
    expect(normaliseBlockList(["", null])).toEqual([]);
  });
  test("rejects things that aren't numbers, and a list that is too long", () => {
    expect(() => normaliseBlockList(["hello"])).toThrow(/isn't a phone number/);
    expect(() => normaliseBlockList(["12"])).toThrow();
    const many = Array.from({ length: BLOCK_LIST_MAX + 1 }, (_, i) => `+6140000${String(i).padStart(4, "0")}`);
    expect(() => normaliseBlockList(many)).toThrow(/up to/);
  });
  test("is kept by normaliseAutomations and a partial update keeps it", () => {
    const a = withSpam({ blockList: ["0412 345 678"] });
    expect(a.spam.blockList).toEqual(["+61412345678"]);
    const b = normaliseAutomations({ spam: { endRobocalls: true } }, a);
    expect(b.spam.blockList).toEqual(["+61412345678"]);
    expect(b.spam.endRobocalls).toBe(true);
    expect(normaliseAutomations({}, defaultAutomations()).spam).toEqual(defaultSpam().spam);
  });
  test("a blocked caller is flagged whatever format the provider sends", () => {
    const s = withSpam({ blockList: ["0412345678"] });
    for (const caller of ["+61412345678", "0412 345 678", "61412345678"]) {
      const v = spamVariables(s, caller, "phone_call");
      expect(v.twin_blocked).toBe("yes");
      expect(v.reject).toBe(true);
    }
    expect(spamVariables(s, "+61400000000", "phone_call")).toMatchObject({ twin_blocked: "no", reject: false });
    expect(spamVariables(s, undefined, undefined)).toMatchObject({ twin_blocked: "no", reject: false });
  });
});

describe("no caller ID", () => {
  test("is recognised", () => {
    for (const c of ["", undefined, "anonymous", "Restricted", "+266696687", "unknown"]) expect(isAnonymousCaller(c)).toBe(true);
    expect(isAnonymousCaller("+61412345678")).toBe(false);
    expect(canonNumber("anonymous")).toBe("");
  });
  test("allow, reject and take-a-message", () => {
    const call = (a: string, caller: unknown, channel: unknown = "phone_call") => spamVariables(withSpam({ anonymous: a as any }), caller, channel);
    expect(call("allow", "anonymous")).toMatchObject({ twin_anonymous: "no", reject: false });
    expect(call("reject", "anonymous")).toMatchObject({ twin_anonymous: "yes", reject: true });
    expect(call("message", "")).toMatchObject({ twin_anonymous: "yes", reject: false });
    expect(call("reject", "+61412345678")).toMatchObject({ twin_anonymous: "no", reject: false });
  });
  test("browser test calls and unreadable webhooks are never treated as anonymous", () => {
    const s = withSpam({ anonymous: "reject" });
    expect(spamVariables(s, "", "web_call").reject).toBe(false);
    expect(spamVariables(s, undefined, undefined).reject).toBe(false);
  });
  test("an unknown option falls back to allow", () => {
    expect(normaliseSpam({ spam: { anonymous: "explode" } }).spam.anonymous).toBe("allow");
  });
});

describe("what reaches the assistant", () => {
  test("nothing changes while it's all off", () => {
    expect(automationInstructions(client(), defaultAutomations())).toBe("");
    const out = overlayPayload(client(), defaultAutomations(), { greeting: "Hi." }, opts);
    expect(out.greeting).toBe("Hi.");
    expect("dynamic_variables_webhook_url" in out).toBe(false);
  });
  test("Telnyx: variables, greeting and webhook are set, and the script says to hang up", () => {
    const a = withSpam({ blockList: ["0412345678"], anonymous: "reject", endRobocalls: true });
    const text = automationInstructions(client(), a);
    expect(text).toContain('"{{twin_blocked}}" is "yes"');
    expect(text).toContain('"{{twin_anonymous}}" is "yes"');
    expect(text).toContain("hangup tool");
    expect(text).toContain("telemarketer");
    const out = overlayPayload(client(), a, { greeting: "Hi." }, opts);
    expect(out.greeting).toBe("{{twin_greeting}}");
    expect(out.dynamic_variables).toMatchObject({ twin_greeting: "Hi.", twin_blocked: "no", twin_anonymous: "no" });
    expect(out.dynamic_variables_webhook_url).toContain("/hooks/automations/");
  });
  test("robocall instruction alone needs no webhook", () => {
    const a = withSpam({ endRobocalls: true });
    expect(automationInstructions(client(), a)).toContain("Robocalls and sales calls");
    const out = overlayPayload(client(), a, { greeting: "Hi." }, opts);
    expect(out.greeting).toBe("Hi.");
    expect("dynamic_variables_webhook_url" in out).toBe(false);
  });
  test("take a message option says so", () => {
    expect(automationInstructions(client(), withSpam({ anonymous: "message" }))).toContain("only take a message");
  });
  test("Vapi: the list is in the script next to the caller's number", () => {
    const a = withSpam({ blockList: ["0412345678"], anonymous: "reject" });
    const text = automationInstructions(client(), a, "vapi");
    expect(text).toContain("+61412345678");
    expect(text).toContain("{{customer.number}}");
    expect(text).toContain("end call tool");
    expect(text).not.toContain("twin_blocked");
  });
  test("status is honest", () => {
    expect(spamStatus(defaultSpam(), { publicUrl: "x" }).state).toBe("off");
    const a = withSpam({ blockList: ["0412345678"] });
    expect(spamStatus(a, { publicUrl: "https://x" })).toMatchObject({ state: "on" });
    expect(spamStatus(a, { publicUrl: "" }).state).toBe("needs_setup");
    expect(spamStatus(a, { publicUrl: "", engine: "vapi" }).state).toBe("on");
    expect(statusFor(client(), a, { demo: false, smsNumber: null, publicUrl: "https://x", applied: true }).spam.detail).toContain("still answers");
  });
});

describe("the webhook body", () => {
  const post = (body: unknown) => new Request("https://x/hooks", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  test("reads the caller from Telnyx's event, wherever it sits", async () => {
    expect(await callerOf(post({ data: { payload: { telnyx_end_user_target: "+61412345678", telnyx_conversation_channel: "phone_call" } } }))).toEqual({ caller: "+61412345678", channel: "phone_call" });
    expect(await callerOf(post({ telnyx_end_user_target: "+1415" }))).toMatchObject({ caller: "+1415" });
  });
  test("garbage or a GET gives no caller", async () => {
    expect(await callerOf(post("not json"))).toEqual({});
    expect(await callerOf(new Request("https://x/hooks"))).toEqual({});
    expect(await callerOf(post("null"))).toMatchObject({ caller: "" });
  });
});
