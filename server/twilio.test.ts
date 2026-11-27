// Twilio as a phone-number source: connecting and checking an account, listing / searching / buying
// numbers, importing one into Vapi for a receptionist, and sending a receptionist's texts through
// Twilio. Nothing here calls Twilio, Vapi or a database: fetch is stubbed, and the credentials come
// from the install's own TWILIO_* settings (the path with no org to look up).
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/twilio.test.ts
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";

const SID = "AC" + "a".repeat(32);
const TOKEN = "b".repeat(32);
process.env.TWILIO_ACCOUNT_SID = SID;
process.env.TWILIO_AUTH_TOKEN = TOKEN;
process.env.VAPI_API_KEY = "vapi-private-key-0000000000000000";
process.env.VAPI_PUBLIC_KEY = "vapi-public-key-00000000000000000";
process.env.MAILBOX_KEY = Buffer.alloc(32, 7).toString("base64");

const tw = await import("./twilio");
const { attachNumber } = await import("./voice/vapi");
const { sendSms } = await import("./sms");
const { smsNumberOf, statusFor, defaultAutomations } = await import("./automations");
const { twilioAllowed } = await import("./phoneAccount");

const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

type Sent = { method: string; url: string; auth: string; form?: Record<string, string>; json?: any };
let sent: Sent[] = [];
// url fragment -> reply; first match wins
let replies: { match: RegExp; status?: number; body: unknown }[] = [];

function fake() {
  sent = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    const raw = init.body === undefined ? undefined : String(init.body);
    const isForm = init.headers?.["Content-Type"] === "application/x-www-form-urlencoded";
    sent.push({
      method: String(init.method ?? "GET"),
      url,
      auth: String(init.headers?.Authorization ?? ""),
      form: raw && isForm ? Object.fromEntries(new URLSearchParams(raw)) : undefined,
      json: raw && !isForm ? JSON.parse(raw) : undefined,
    });
    const r = replies.find((x) => x.match.test(url));
    return new Response(JSON.stringify(r?.body ?? {}), { status: r?.status ?? 200 });
  }) as typeof fetch;
}
const reply = (match: RegExp, body: unknown, status = 200) => replies.push({ match, body, status });
beforeEach(() => {
  replies = [];
  fake();
});

const now = new Date().toISOString();
const vapiClient: Business = {
  id: "11111111-2222-3333-4444-555555555555",
  assistantId: "asst-1",
  settings: { ...blankSettings(), businessName: "Alpha Plumbing" },
  instructions: "x",
  voiceProvider: "vapi",
  phoneNumbers: ["+61480011301"],
  createdAt: now,
  updatedAt: now,
};
const telnyxClient: Business = { ...vapiClient, voiceProvider: undefined, assistantId: "asst-t" };
const creds = (kind: "token" | "key" = "token") => ({ accountSid: SID, user: kind === "token" ? SID : "SK" + "c".repeat(32), secret: kind === "token" ? TOKEN : "s".repeat(32), kind, own: true });
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;

describe("connecting a Twilio account", () => {
  test("an Account SID with an Auth Token, or with an API Key", () => {
    expect(tw.parseTwilioInput({ accountSid: SID, authToken: TOKEN })).toEqual({ accountSid: SID, user: SID, secret: TOKEN, kind: "token" });
    const key = tw.parseTwilioInput({ accountSid: SID, apiKeySid: "SK" + "c".repeat(32), apiKeySecret: "s".repeat(32) });
    expect(key).toMatchObject({ user: "SK" + "c".repeat(32), secret: "s".repeat(32), kind: "key" });
  });

  test("bad input is refused in words a person can act on", () => {
    expect(() => tw.parseTwilioInput({ accountSid: "nope", authToken: TOKEN })).toThrow("Account SID");
    expect(() => tw.parseTwilioInput({ accountSid: SID })).toThrow("Auth Token");
    expect(() => tw.parseTwilioInput({ accountSid: SID, apiKeySid: "AC123", apiKeySecret: "x" })).toThrow("API Key SID");
    expect(() => tw.parseTwilioInput({ accountSid: SID, apiKeySid: "SK" + "c".repeat(32), apiKeySecret: "short" })).toThrow("secret");
  });

  test("the account is checked with Twilio, signed in with the right user", async () => {
    reply(/Accounts\/AC[a]+\.json$/, { friendly_name: "Alpha Agency", status: "active" });
    expect(await tw.checkTwilio(creds())).toEqual({ name: "Alpha Agency" });
    expect(sent[0]).toMatchObject({ method: "GET", url: `https://api.twilio.com/2010-04-01/Accounts/${SID}.json`, auth: basic(SID, TOKEN) });
    await tw.checkTwilio(creds("key"));
    expect(sent[1].auth).toBe(basic("SK" + "c".repeat(32), "s".repeat(32)));
  });

  test("Twilio refusing the credentials, or a suspended account, is explained", async () => {
    reply(/Accounts\//, { code: 20003, message: "Authenticate" }, 401);
    await expect(tw.checkTwilio(creds())).rejects.toThrow("Twilio didn't accept those");
    replies = [];
    reply(/Accounts\//, { code: 20003, message: "Authenticate" }, 401);
    await expect(tw.checkTwilio(creds("key"))).rejects.toThrow("API Key");
    replies = [];
    reply(/Accounts\//, { friendly_name: "x", status: "suspended" });
    await expect(tw.checkTwilio(creds())).rejects.toThrow("suspended");
  });

  test("only who may use it: an owner or admin of an agency with Twilio connected", () => {
    const org = { id: "o" } as any;
    expect(twilioAllowed({ org, role: "owner" }, true)).toBe(true);
    expect(twilioAllowed({ org, role: "admin" }, true)).toBe(true);
    expect(twilioAllowed({ org, role: "member" } as any, true)).toBe(false);
    expect(twilioAllowed({ org, role: "customer" } as any, true)).toBe(false);
    expect(twilioAllowed({ org, role: "owner", viewing: { client: null } as any }, true)).toBe(false);
    expect(twilioAllowed({ org, role: "owner" }, false)).toBe(false);
    expect(twilioAllowed({ org: null, role: "owner" } as any, true)).toBe(false);
  });
});

describe("numbers on the Twilio account", () => {
  test("searching asks Twilio for Australian mobiles with texting and adds the price", async () => {
    reply(/AvailablePhoneNumbers\/AU\/Mobile\.json/, { available_phone_numbers: [{ phone_number: "+61412000001", capabilities: { voice: true, SMS: true }, address_requirements: "any" }] });
    reply(/pricing\.twilio\.com\/v1\/PhoneNumbers\/Countries\/AU/, { price_unit: "USD", phone_number_prices: [{ number_type: "mobile", current_price: "6.50" }] });
    const found = await tw.availableTwilioNumbers(creds(), "mobile", "AU");
    expect(found).toEqual([{ phoneNumber: "+61412000001", country: "AU", type: "mobile", monthly: 6.5, upfront: 0, currency: "USD", sms: true, needsBundle: true }]);
    const search = sent.find((s) => s.url.includes("AvailablePhoneNumbers"))!;
    expect(search.url).toContain(`Accounts/${SID}/AvailablePhoneNumbers/AU/Mobile.json?`);
    expect(search.url).toContain("SmsEnabled=true");
  });

  test("a price Twilio won't give only hides the price", async () => {
    reply(/AvailablePhoneNumbers\/AU\/Local\.json/, { available_phone_numbers: [{ phone_number: "+61255501234", capabilities: { voice: true } }] });
    reply(/pricing\.twilio\.com/, { message: "nope" }, 500);
    const [n] = await tw.availableTwilioNumbers(creds(), "local", "AU");
    expect(n).toMatchObject({ phoneNumber: "+61255501234", monthly: 0, sms: false });
  });

  test("the account's own numbers say which receptionist answers each", async () => {
    reply(/IncomingPhoneNumbers\.json/, {
      incoming_phone_numbers: [
        { sid: "PN1", phone_number: "+61480011301", friendly_name: "x", capabilities: { voice: true, sms: true } },
        { sid: "PN2", phone_number: "+61255501301", friendly_name: "y", capabilities: { voice: true, sms: false } },
      ],
    });
    const list = await tw.twilioNumbersFor(creds(), new Map([["+61480011301", "Sam"]]));
    expect(list).toMatchObject([
      { phoneNumber: "+61255501301", type: "local", sms: false, assignedTo: "" },
      { phoneNumber: "+61480011301", type: "mobile", sms: true, assignedTo: "Sam" },
    ]);
  });

  test("Australian numbers: waiting for approval, missing a bundle, or ready", async () => {
    reply(/RegulatoryCompliance\/Bundles/, { results: [{ sid: "BU1", status: "pending-review", number_type: "mobile" }] });
    expect(await tw.twilioRegulatory(creds())).toMatchObject({ approved: false, inReview: 1 });
    replies = [];
    reply(/RegulatoryCompliance\/Bundles/, { results: [] });
    expect(await tw.twilioRegulatory(creds())).toMatchObject({ approved: false, inReview: 0, consoleUrl: tw.TWILIO_BUNDLES_URL });
    replies = [];
    reply(/RegulatoryCompliance\/Bundles/, { results: [{ sid: "BU2", status: "twilio-approved", number_type: "mobile" }] });
    reply(/Addresses\.json/, { addresses: [{ sid: "AD1" }] });
    expect(await tw.twilioRegulatory(creds())).toMatchObject({ approved: true, addressSid: "AD1", bundles: [{ sid: "BU2", type: "mobile" }] });
    expect((await tw.twilioRegulatory(creds(), "US")).approved).toBe(true);
  });

  test("buying needs the confirmation and, in Australia, an approved bundle", async () => {
    await expect(tw.buyTwilioNumber(creds(), { phoneNumber: "+61412000001" }, "Alpha")).rejects.toThrow("Confirm the purchase");
    await expect(tw.buyTwilioNumber(creds(), { phoneNumber: "+44123", confirm: true }, "Alpha")).rejects.toThrow("Australian or US");
    reply(/RegulatoryCompliance\/Bundles/, { results: [{ sid: "BU1", status: "in-review" }] });
    await expect(tw.buyTwilioNumber(creds(), { phoneNumber: "+61412000001", confirm: true }, "Alpha")).rejects.toThrow("waiting for Twilio's approval");
    replies = [];
    reply(/RegulatoryCompliance\/Bundles/, { results: [] });
    await expect(tw.buyTwilioNumber(creds(), { phoneNumber: "+61412000001", confirm: true }, "Alpha")).rejects.toThrow(tw.TWILIO_BUNDLES_URL);
    expect(sent.some((s) => s.method === "POST")).toBe(false);
  });

  test("buying sends the number with the approved bundle and address", async () => {
    reply(/RegulatoryCompliance\/Bundles/, { results: [{ sid: "BU2", status: "twilio-approved", number_type: "mobile" }] });
    reply(/Addresses\.json/, { addresses: [{ sid: "AD1" }] });
    reply(/IncomingPhoneNumbers\.json/, { sid: "PN9", phone_number: "+61412000001" });
    const bought = await tw.buyTwilioNumber(creds(), { phoneNumber: "+61412000001", confirm: true }, "Alpha Plumbing");
    expect(bought).toEqual({ sid: "PN9", phoneNumber: "+61412000001" });
    const post = sent.find((s) => s.method === "POST")!;
    expect(post.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json`);
    expect(post.form).toEqual({ PhoneNumber: "+61412000001", FriendlyName: "Alpha Plumbing", BundleSid: "BU2", AddressSid: "AD1" });
  });
});

describe("a Twilio number answers a Vapi receptionist", () => {
  const owned = { incoming_phone_numbers: [{ sid: "PN1", phone_number: "+61480011301", capabilities: { voice: true, sms: true } }] };

  test("a number the agency has is imported into Vapi and attached to the assistant", async () => {
    reply(/IncomingPhoneNumbers\.json/, owned);
    reply(/api\.vapi\.ai\/phone-number/, { id: "pn-1", number: "+61480011301" }, 201);
    const order = await attachNumber(vapiClient, { source: "twilio", number: "+61 480 011 301" });
    const call = sent.find((s) => s.url === "https://api.vapi.ai/phone-number")!;
    expect(call.json).toMatchObject({ provider: "twilio", number: "+61480011301", twilioAccountSid: SID, twilioAuthToken: TOKEN, assistantId: "asst-1", smsEnabled: false });
    expect(call.json.twilioApiKey).toBeUndefined();
    expect(order).toMatchObject({ id: "pn-1", status: "success", phoneNumbers: ["+61480011301"] });
  });

  test("a number that isn't on the connected account is refused before Vapi hears of it", async () => {
    reply(/IncomingPhoneNumbers\.json/, owned);
    await expect(attachNumber(vapiClient, { source: "twilio", number: "+61412999999" })).rejects.toThrow("isn't on your connected Twilio account");
    expect(sent.some((s) => s.url.includes("vapi.ai"))).toBe(false);
  });

  test("buying a number then imports it", async () => {
    reply(/RegulatoryCompliance\/Bundles/, { results: [{ sid: "BU2", status: "twilio-approved", number_type: "mobile" }] });
    reply(/Addresses\.json/, { addresses: [{ sid: "AD1" }] });
    reply(/IncomingPhoneNumbers\.json/, { sid: "PN9", phone_number: "+61412000001" });
    reply(/api\.vapi\.ai\/phone-number/, { id: "pn-2", number: "+61412000001" }, 201);
    const order = await attachNumber(vapiClient, { source: "twilio_buy", phoneNumber: "+61412000001", confirm: true });
    const urls = sent.filter((s) => s.method === "POST").map((s) => s.url);
    expect(urls).toEqual([`https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json`, "https://api.vapi.ai/phone-number"]);
    expect(sent.at(-1)!.json).toMatchObject({ provider: "twilio", number: "+61412000001", twilioAccountSid: SID, assistantId: "asst-1" });
    expect(order.phoneNumbers).toEqual(["+61412000001"]);
  });

  test("a purchase Vapi can't connect says the number is safe on Twilio", async () => {
    reply(/RegulatoryCompliance\/Bundles/, { results: [{ sid: "BU2", status: "twilio-approved", number_type: "mobile" }] });
    reply(/Addresses\.json/, { addresses: [{ sid: "AD1" }] });
    reply(/IncomingPhoneNumbers\.json/, { sid: "PN9", phone_number: "+61412000001" });
    reply(/api\.vapi\.ai/, { message: "boom" }, 400);
    await expect(attachNumber(vapiClient, { source: "twilio_buy", phoneNumber: "+61412000001", confirm: true })).rejects.toThrow("was bought on your Twilio account");
  });

  test("credentials typed in for one number can be an API key", async () => {
    reply(/api\.vapi\.ai\/phone-number/, { id: "pn-3", number: "+61480011301" }, 201);
    await attachNumber(vapiClient, { source: "twilio", number: "+61480011301", accountSid: SID, apiKeySid: "SK" + "c".repeat(32), apiKeySecret: "s".repeat(32) });
    expect(sent[0].json).toMatchObject({ twilioAccountSid: SID, twilioApiKey: "SK" + "c".repeat(32), twilioApiSecret: "s".repeat(32) });
    expect(sent[0].json.twilioAuthToken).toBeUndefined();
  });
});

describe("texts through Twilio", () => {
  test("a Vapi receptionist's text goes through Twilio's Messages API from its own number", async () => {
    reply(/Messages\.json/, { sid: "SM1" }, 201);
    await sendSms(vapiClient, { from: "+61480011301", to: "+61412345678", text: "Hi from Alpha", meta: { twin_followup: "reminder" } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: "POST", url: `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, auth: basic(SID, TOKEN) });
    expect(sent[0].form).toEqual({ From: "+61480011301", To: "+61412345678", Body: "Hi from Alpha" });
  });

  test("a Telnyx receptionist's text goes through Telnyx's messages API (our own texting, not its assistant)", async () => {
    process.env.TELNYX_API_KEY = "KEYTEST-sms-0000000000000000";
    reply(/api\.telnyx\.com/, { data: {} });
    await sendSms(telnyxClient, { from: "+61412000999", to: "+61412345678", text: "Hi", meta: { twin_text_back: "after_call" } });
    expect(sent[0].url).toBe("https://api.telnyx.com/v2/messages");
    expect(sent[0].json).toMatchObject({ from: "+61412000999", to: "+61412345678", text: "Hi" });
    expect(sent.some((s) => s.url.includes("twilio.com"))).toBe(false);
  });

  test("a Twilio error on send is raised, not swallowed", async () => {
    reply(/Messages\.json/, { code: 21211, message: "Invalid 'To' number" }, 400);
    await expect(sendSms(vapiClient, { from: "+61480011301", to: "+1", text: "x", meta: {} })).rejects.toThrow("Twilio said: Invalid 'To' number");
  });

  test("the texting number is one of the receptionist's own that Twilio says can text", async () => {
    reply(/IncomingPhoneNumbers\.json/, {
      incoming_phone_numbers: [
        { sid: "PN1", phone_number: "+61480011301", capabilities: { voice: true, sms: true } },
        { sid: "PN2", phone_number: "+61255501301", capabilities: { voice: true, sms: false } },
      ],
    });
    expect(await smsNumberOf(vapiClient)).toBe("+61480011301");
    expect(await smsNumberOf({ ...vapiClient, phoneNumbers: ["+61255501301"] })).toBeNull();
    expect(await smsNumberOf({ ...vapiClient, phoneNumbers: [] })).toBeNull();
  });

  test("Twilio not answering is 'couldn't check', not 'no number'", async () => {
    reply(/IncomingPhoneNumbers\.json/, { message: "down" }, 500);
    expect(await smsNumberOf({ ...vapiClient, phoneNumbers: ["+61480011399"] })).toBeUndefined();
  });

  test("the screens say what a Vapi receptionist still needs to text", () => {
    const on = { ...defaultAutomations(), textBack: { ...defaultAutomations().textBack, enabled: true, afterCall: true } };
    const none = statusFor(vapiClient, on, { demo: false, smsNumber: null, publicUrl: "https://x", applied: true, engine: "vapi" });
    expect(none.textBack).toMatchObject({ state: "needs_setup", label: "Needs a Twilio mobile number" });
    const ok = statusFor(vapiClient, on, { demo: false, smsNumber: "+61480011301", publicUrl: "https://x", applied: true, engine: "vapi" });
    expect(ok.textBack.state).toBe("on");
  });
});
