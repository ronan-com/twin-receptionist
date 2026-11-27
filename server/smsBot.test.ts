// The text chatbot: STOP/START, one conversation per customer, the same brain as the website chat (a
// pretend OpenRouter), and both providers' webhooks (Twilio's signature, Telnyx's address secret).
// Uses the scratch database:  DATABASE_URL=... bun test server/smsBot.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { migrate, sql } from "./db";
import { SMS_LIMITS, handleText, isStart, isStop, telnyxTextHook, twilioTextHook, type BotDeps, type InboundText } from "./smsBot";
import { SmsOptedOut, contactKey, sendSms, setOptOut } from "./sms";
import { generateKeyPairSync, sign } from "node:crypto";
import { smsSecret, telnyxSignatureOk, twilioSignature } from "./smsWebhook";
import { insertClient } from "./store";
import { createLimiter, dbStore } from "./webchat";

const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: true, from: "08:00", to: "17:00" }])) as any;
const orgId = crypto.randomUUID();
const now = new Date().toISOString();
const OURS = "+61480011301";
const CUSTOMER = "+61412345678";
const client: Business = {
  id: crypto.randomUUID(),
  assistantId: "demo-assistant",
  settings: { ...blankSettings(), businessName: "Alpha Plumbing", receptionistName: "Mia", timezone: "Australia/Brisbane", hours, services: ["Blocked drain"] },
  instructions: "",
  phoneNumbers: [OURS],
  booking: { provider: "builtin", token: "t", minutes: 30, enabled: true, createdAt: now } as Business["booking"],
  createdAt: now,
  updatedAt: now,
};
const env = ["OPENROUTER_API_KEY", "MAILBOX_KEY", "SINGLE_AGENCY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "PUBLIC_URL", "SMS_WEBHOOK_SECRET"] as const;
const savedEnv = Object.fromEntries(env.map((k) => [k, process.env[k]]));
let ready = true;
beforeAll(async () => {
  process.env.SMS_WEBHOOK_SECRET = "test-sms-secret";
  try {
    await migrate();
    await sql`insert into orgs (id, name) values (${orgId}, 'sms bot test')`;
    await insertClient(orgId, client);
  } catch (err) {
    ready = false;
    console.warn("[smsBot.test] no database, skipping:", (err as Error).message);
  }
}, 60000);
afterAll(async () => {
  if (ready) {
    await sql`delete from clients where org_id = ${orgId}`;
    await sql`delete from orgs where id = ${orgId}`;
  }
  for (const k of env) savedEnv[k] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[k]);
});
beforeEach(async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.SMS_WEBHOOK_SECRET = "test-sms-secret";
  if (ready) {
    await sql`delete from sms_optouts where client_id = ${client.id}`;
    await sql`delete from sms_threads where client_id = ${client.id}`;
    await sql`delete from sms_seen`;
    await sql`delete from webchat_conversations where client_id = ${client.id}`;
  }
});

function pretendModel(...replies: string[]) {
  const calls: any[] = [];
  const fn = (async (_u: any, init: any) => {
    calls.push(JSON.parse(init.body));
    const content = replies.shift() ?? "ok";
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function bot(over: Partial<BotDeps> = {}) {
  const sent: { from: string; to: string; text: string }[] = [];
  const deps: BotDeps = {
    find: async (id) => (id === client.id ? { client, orgId } : null),
    halted: async () => false,
    knowledge: async () => [],
    store: dbStore,
    send: async (_c, o) => void sent.push(o),
    limits: { contact: createLimiter(SMS_LIMITS.contactPerHour, 3_600_000), business: createLimiter(SMS_LIMITS.businessPerHour, 3_600_000) },
    wait: true,
    ...over,
  };
  return { deps, sent };
}
const text = (body: string, id: string = crypto.randomUUID(), over: Partial<InboundText> = {}): InboundText => ({ via: "telnyx", id, from: CUSTOMER, to: OURS, text: body, ...over });

describe("the words", () => {
  test("STOP and START, any case, ignoring punctuation; ordinary texts are neither", () => {
    for (const w of ["STOP", "stop", " Stop. ", "UNSUBSCRIBE", "cancel", "End", "QUIT", "stopall"]) expect(isStop(w)).toBe(true);
    for (const w of ["START", "unstop", "Start!"]) expect(isStart(w)).toBe(true);
    for (const w of ["please stop the leak", "stop by tomorrow?", "starting at 9", "yes"]) {
      expect(isStop(w)).toBe(false);
      expect(isStart(w)).toBe(false);
    }
  });
  test("numbers compare as the same person however they're written", () => {
    expect(contactKey("+61412345678")).toBe(contactKey("0412 345 678"));
  });
});

describe("answering a text", () => {
  test("replies with the same brain as the website chat, from the number it was sent to, with the opt-out line first time", async () => {
    if (!ready) return;
    const { deps, sent } = bot();
    const m = pretendModel("Hi, it's Mia at Alpha Plumbing. We open at 8.");
    expect(await handleText(client.id, text("What time do you open?"), { ...deps, fetch: m.fn })).toBe("replied");
    expect(sent).toEqual([{ from: OURS, to: CUSTOMER, text: "Hi, it's Mia at Alpha Plumbing. We open at 8. Reply STOP to opt out." }]);
    const system = m.calls[0].messages[0];
    expect(JSON.stringify(system)).toContain("by text message (SMS)");
    expect(JSON.stringify(system)).toContain(CUSTOMER);
    expect(m.calls[0].messages.at(-1)).toEqual({ role: "user", content: "What time do you open?" });
    expect(m.calls[0].tools.map((t: any) => t.function.name)).toContain("request_callback");
  });

  test("a second text continues the same conversation (history is sent; no second opt-out line); it shows with the website chats", async () => {
    if (!ready) return;
    const { deps, sent } = bot();
    const m = pretendModel("First answer.", "Second answer.");
    await handleText(client.id, text("hello"), { ...deps, fetch: m.fn });
    await handleText(client.id, text("and Saturday?", undefined, { from: "0412 345 678" }), { ...deps, fetch: m.fn });
    expect(m.calls[1].messages.map((x: any) => x.content).filter((c: any) => typeof c === "string")).toContain("First answer.");
    expect(sent[1].text).toBe("Second answer.");
    const [t] = await sql`select count(*)::int as n from sms_threads where client_id = ${client.id}`;
    expect(t.n).toBe(1);
    const [c] = await sql`select count(*)::int as n, max(message_count)::int as msgs, min(origin) as origin from webchat_conversations where client_id = ${client.id} and origin = 'sms'`;
    expect(c).toMatchObject({ n: 1, msgs: 4, origin: "sms" });
  });

  test("a quiet day later, the next text starts a new conversation", async () => {
    if (!ready) return;
    const { deps } = bot();
    const m = pretendModel("a", "b");
    await handleText(client.id, text("one"), { ...deps, fetch: m.fn });
    await sql`update sms_threads set last_at = now() - interval '25 hours' where client_id = ${client.id}`;
    await handleText(client.id, text("two"), { ...deps, fetch: m.fn });
    expect(m.calls[1].messages.filter((x: any) => x.role === "user").length).toBe(1);
    const [c] = await sql`select count(*)::int as n from webchat_conversations where client_id = ${client.id} and origin = 'sms'`;
    expect(c.n).toBe(2);
  });

  test("the same provider message twice (a retry) is answered once", async () => {
    if (!ready) return;
    const { deps, sent } = bot();
    const m = pretendModel("once");
    const msg = text("hello", "msg-1");
    expect(await handleText(client.id, msg, { ...deps, fetch: m.fn })).toBe("replied");
    expect(await handleText(client.id, msg, { ...deps, fetch: m.fn })).toBe("duplicate");
    expect(sent.length).toBe(1);
  });

  test("ignores texts to a number that isn't this receptionist's, an unknown receptionist, no key, a paused one, and a flood", async () => {
    if (!ready) return;
    const { deps, sent } = bot();
    const m = pretendModel("x", "x", "x");
    expect(await handleText(client.id, text("hi", undefined, { to: "+61480099999" }), { ...deps, fetch: m.fn })).toBe("ignored");
    expect(await handleText(crypto.randomUUID(), text("hi"), { ...deps, fetch: m.fn })).toBe("ignored");
    expect(await handleText(client.id, text("hi"), { ...deps, fetch: m.fn, halted: async () => true })).toBe("ignored");
    delete process.env.OPENROUTER_API_KEY;
    expect(await handleText(client.id, text("hi"), { ...deps, fetch: m.fn })).toBe("ignored");
    process.env.OPENROUTER_API_KEY = "test-key";
    const tight = { contact: createLimiter(1, 3_600_000), business: createLimiter(100, 3_600_000) };
    expect(await handleText(client.id, text("one"), { ...deps, limits: tight, fetch: m.fn })).toBe("replied");
    expect(await handleText(client.id, text("two"), { ...deps, limits: tight, fetch: m.fn })).toBe("ignored");
    expect(sent.length).toBe(1);
  });

  test("when the AI is down the customer gets the apology, and the receptionist keeps working", async () => {
    if (!ready) return;
    const { deps, sent } = bot();
    const down = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await handleText(client.id, text("hello"), { ...deps, fetch: down })).toBe("replied");
    expect(sent[0].text).toContain("having trouble");
  });
});

describe("STOP", () => {
  test("stops texts to that person: no reply to it, later automatic texts are refused, their own texts are ignored until START", async () => {
    if (!ready) return;
    const { deps, sent } = bot();
    const m = pretendModel("answer");
    expect(await handleText(client.id, text("STOP"), { ...deps, fetch: m.fn })).toBe("stopped");
    expect(sent.length).toBe(0);
    expect(m.calls.length).toBe(0);
    // Follow-ups, text-back and reviews all go through sendSms.
    await expect(sendSms(client, { from: OURS, to: "0412 345 678", text: "Reminder" })).rejects.toBeInstanceOf(SmsOptedOut);
    expect(await handleText(client.id, text("are you open?"), { ...deps, fetch: m.fn })).toBe("ignored");
    expect(await handleText(client.id, text("start"), { ...deps, fetch: m.fn })).toBe("restarted");
    expect(sent.length).toBe(0);
    expect(await handleText(client.id, text("are you open?"), { ...deps, fetch: m.fn })).toBe("replied");
  });
  test("only that receptionist's customer is stopped", async () => {
    if (!ready) return;
    await setOptOut(client.id, CUSTOMER, true);
    const [r] = await sql`select count(*)::int as n from sms_optouts where client_id = ${client.id}`;
    expect(r.n).toBe(1);
    await expect(sendSms(client, { from: OURS, to: "+61499999999", text: "x" }).catch((e) => (e instanceof SmsOptedOut ? "stopped" : "other"))).resolves.not.toBe("stopped");
  });
});

describe("the webhooks", () => {
  const secret = () => smsSecret(client.id);
  const telnyxBody = (over: any = {}) => JSON.stringify({ data: { event_type: "message.received", id: "evt", payload: { id: "m-1", direction: "inbound", from: { phone_number: CUSTOMER }, to: [{ phone_number: OURS }], text: "hello", ...over } } });
  const hookReq = (path: string, body: string, headers: Record<string, string> = {}) => new Request(`https://app.example.com${path}`, { method: "POST", headers: { host: "app.example.com", "x-forwarded-proto": "https", ...headers }, body });

  test("Telnyx: a wrong address secret is a 404; a delivery receipt or a text we sent is ignored; a customer's text is answered", async () => {
    if (!ready) return;
    const { deps, sent } = bot();
    const m = pretendModel("hello back");
    const d = { ...deps, fetch: m.fn };
    expect((await telnyxTextHook(hookReq("/x", telnyxBody()), client.id, "wrong-secret-wrong-secret-1", d)).status).toBe(404);
    expect((await telnyxTextHook(hookReq("/x", JSON.stringify({ data: { event_type: "message.finalized", payload: { direction: "outbound" } } })), client.id, secret(), d)).status).toBe(200);
    expect((await telnyxTextHook(hookReq("/x", telnyxBody({ direction: "outbound" })), client.id, secret(), d)).status).toBe(200);
    expect(sent.length).toBe(0);
    expect((await telnyxTextHook(hookReq("/x", "{nope"), client.id, secret(), d)).status).toBe(400);
    expect((await telnyxTextHook(hookReq("/x", telnyxBody()), client.id, secret(), d)).status).toBe(200);
    expect(sent.map((s) => s.to)).toEqual([CUSTOMER]);
  });

  test("Telnyx's ed25519 signature is checked when the server has the account's public key", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pub = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64");
    const body = telnyxBody();
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64");
    expect(telnyxSignatureOk(pub, body, sig, ts)).toBe(true);
    expect(telnyxSignatureOk(pub, body + " ", sig, ts)).toBe(false);
    expect(telnyxSignatureOk(pub, body, sig, String(Number(ts) - 3600))).toBe(false);
    expect(telnyxSignatureOk(pub, body, null, ts)).toBe(false);
    const { deps } = bot();
    const d = { ...deps, fetch: pretendModel("hi").fn };
    process.env.TELNYX_PUBLIC_KEY = pub;
    try {
      const signed = new Request("https://app.example.com/x", { method: "POST", body, headers: { "telnyx-signature-ed25519": sig, "telnyx-timestamp": ts } });
      expect((await telnyxTextHook(signed, client.id, secret(), d)).status).toBe(200);
      expect((await telnyxTextHook(hookReq("/x", body), client.id, secret(), d)).status).toBe(403);
    } finally {
      delete process.env.TELNYX_PUBLIC_KEY;
    }
  });

  describe("Twilio", () => {
    const TOKEN = "0123456789abcdef0123456789abcdef";
    const SID = "AC" + "0".repeat(31) + "1";
    const fields = { MessageSid: "SM1", AccountSid: SID, From: CUSTOMER, To: OURS, Body: "hello" };
    const path = () => `/hooks/sms/twilio/${client.id}/${secret()}`;
    const form = (f: Record<string, string>) => new URLSearchParams(f).toString();
    const signed = (f: Record<string, string>, url = `https://app.example.com${path()}`) => twilioSignature(TOKEN, url, f);
    beforeEach(() => {
      process.env.SINGLE_AGENCY = "1";
      process.env.TWILIO_ACCOUNT_SID = SID;
      process.env.TWILIO_AUTH_TOKEN = TOKEN;
    });

    test("a signed text is answered and gets an empty TwiML reply; the answer goes out by our own send", async () => {
      if (!ready) return;
      const { deps, sent } = bot();
      const res = await twilioTextHook(hookReq(path(), form(fields), { "x-twilio-signature": signed(fields) }), client.id, secret(), { ...deps, fetch: pretendModel("Twilio answer").fn });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("xml");
      expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      expect(sent[0]).toMatchObject({ from: OURS, to: CUSTOMER });
    });
    test("a missing or wrong signature, a wrong secret, or another account's text is refused and nothing is answered", async () => {
      if (!ready) return;
      const { deps, sent } = bot();
      const d = { ...deps, fetch: pretendModel("no").fn };
      expect((await twilioTextHook(hookReq(path(), form(fields)), client.id, secret(), d)).status).toBe(403);
      expect((await twilioTextHook(hookReq(path(), form(fields), { "x-twilio-signature": signed({ ...fields, Body: "different" }) }), client.id, secret(), d)).status).toBe(403);
      expect((await twilioTextHook(hookReq(path(), form(fields), { "x-twilio-signature": signed(fields) }), client.id, "wrong-secret-wrong-secret-1", d)).status).toBe(404);
      const other = { ...fields, AccountSid: "AC" + "f".repeat(32) };
      expect((await twilioTextHook(hookReq(path(), form(other), { "x-twilio-signature": signed(other) }), client.id, secret(), d)).status).toBe(404);
      expect(sent.length).toBe(0);
    });
  });
});
