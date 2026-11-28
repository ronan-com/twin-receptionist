// Picking a text number: a Telnyx receptionist answering texts on a US Twilio number (and the reverse), one
// receptionist per number, release, the public address moving, and the real Calls / Texts capabilities.
// Twilio, Telnyx and the text AI are pretended (fetch is stubbed and keeps their state). Uses the scratch database.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";

const saved = Object.fromEntries(["TELNYX_API_KEY", "VAPI_API_KEY", "SMS_WEBHOOK_SECRET", "OPENROUTER_API_KEY", "MAILBOX_KEY", "PUBLIC_URL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"].map((k) => [k, process.env[k]]));
process.env.TELNYX_API_KEY = "KEY-test";
process.env.VAPI_API_KEY = "vapi-private-key-0000000000000000";
process.env.SMS_WEBHOOK_SECRET = "test-sms-secret";
process.env.OPENROUTER_API_KEY = "test-key";
process.env.MAILBOX_KEY ||= Buffer.alloc(32, 7).toString("base64");

const { migrate, sql } = await import("./db");
const { publicUrl, savePublicUrl } = await import("./booking");
const { getClient, insertClient, listClients, saveClient } = await import("./store");
const { runAsOrg } = await import("./telnyx");
const { saveTwilio, clearTwilio, forgetTwilio } = await import("./twilio");
const { smsHookUrl, twilioSignature } = await import("./smsWebhook");
const control = await import("./textsControl");
const { forgetTextsSummary } = control;
const { agencyNumbers, textChoicesFrom } = await import("./numberList");
const { forgetNumberCaps, textCapability } = await import("./numberCaps");
const { smsNumberOf } = await import("./automations");
const { sendSms } = await import("./sms");
const { liveBotDeps, telnyxTextHook, twilioTextHook } = await import("./smsBot");
const { smsSecret } = await import("./smsWebhook");
const { vapiProvider } = await import("./voice/vapi");
const { availableNumbers } = await import("./numbers");
const { consoleRoutes } = await import("./routes/console");

const SID = "AC" + "d".repeat(32);
const TOKEN = "e".repeat(32);
const US = "+12272204547";
const US2 = "+12025550147";
const AU_TW = "+61480011401";
const AU_LAND_TW = "+61255501401";
const MOBILE = "+61480011402";
const MOBILE2 = "+61480011403";
const SPARE = "+61480011404";
const CUSTOMER = "+61412345678";
const APP = "https://texts.example.com";

const orgId = crypto.randomUUID();
const now = new Date().toISOString();
let ready = true;

// ---- The pretend providers --------------------------------------------------------------

type Tw = { sid: string; phone_number: string; capabilities: { sms: boolean; voice: boolean }; sms_url: string; voice_url: string; sms_application_sid?: string };
let twilioNumbers: Tw[] = [];
let profiles: Map<string, { enabled: boolean; numbers: Set<string> }>;
let calls: { method: string; url: string; form?: Record<string, string>; json?: any }[] = [];
let sendError = "";
// Telnyx numbers still pointed somewhere by an earlier install.
let leftOver: Record<string, string>[] = [];
const tw = (sid: string, phone_number: string, sms = true): Tw => ({ sid, phone_number, capabilities: { sms, voice: true }, sms_url: "", voice_url: "https://voice.example.com/keep" });
const find = (n: string) => twilioNumbers.find((x) => x.phone_number === n)!;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const fake = (async (input: any, init: any = {}) => {
  const url = decodeURIComponent(String(input));
  const method = String(init.method ?? "GET");
  const raw = init.body === undefined ? undefined : String(init.body);
  const isForm = init.headers?.["Content-Type"] === "application/x-www-form-urlencoded";
  const form = raw && isForm ? Object.fromEntries(new URLSearchParams(raw)) : undefined;
  const json = raw && !isForm ? JSON.parse(raw) : undefined;
  calls.push({ method, url, form, json });
  if (url.includes("openrouter")) return reply({ choices: [{ message: { role: "assistant", content: "We open at 8." } }] });
  if (url.includes("api.twilio.com")) {
    if (url.includes("/Messages.json")) return sendError ? reply({ message: sendError, code: 21408 }, 400) : reply({ sid: "SM1" }, 201);
    const one = url.match(/IncomingPhoneNumbers\/(\w+)\.json/);
    if (one && method === "POST") {
      const n = twilioNumbers.find((x) => x.sid === one[1])!;
      if (form && "SmsUrl" in form) n.sms_url = form.SmsUrl;
      return reply(n);
    }
    return reply({ incoming_phone_numbers: twilioNumbers });
  }
  if (url.includes("api.vapi.ai")) return reply(method === "GET" ? [] : {});
  const path = url.replace("https://api.telnyx.com/v2", "");
  if (path === "/messaging_profiles" && method === "POST") {
    const id = `prof-${profiles.size + 1}`;
    profiles.set(id, { enabled: true, numbers: new Set() });
    return reply({ data: { id } });
  }
  const list = path.match(/^\/messaging_profiles\/([^/]+)\/phone_numbers/);
  if (list) return reply({ data: [...(profiles.get(list[1])?.numbers ?? [])].map((phone_number) => ({ phone_number })) });
  const profile = path.match(/^\/messaging_profiles\/([^/?]+)$/);
  if (profile) {
    const p = profiles.get(profile[1]);
    if (method === "PATCH" && p) p.enabled = json.enabled;
    if (method === "DELETE") profiles.delete(profile[1]);
    return reply({ data: { id: profile[1], webhook_url: p ? `${APP}/hooks/sms/telnyx/${vapiOne.id}/x` : "" } });
  }
  const onProfile = path.match(/^\/messaging_phone_numbers\/(.+)$/);
  if (onProfile) {
    for (const p of profiles.values()) p.numbers.delete(onProfile[1]);
    if (json.messaging_profile_id) profiles.get(json.messaging_profile_id)!.numbers.add(onProfile[1]);
    return reply({ data: {} });
  }
  if (path.startsWith("/ai/assistants/assistant-gone")) return reply({ errors: [{ detail: "Assistant with id assistant-gone not found" }] }, 404);
  if (path.startsWith("/ai/assistants/")) return reply({ data: { enabled_features: ["telephony"], telephony_settings: { default_texml_app_id: "app-x" } } });
  if (path.startsWith("/phone_numbers")) return reply({ data: [{ id: "1001", phone_number: SPARE, phone_number_type: "mobile", status: "active", connection_id: "", connection_name: "" }, ...leftOver] });
  if (path.startsWith("/available_phone_numbers")) return reply({ data: [{ phone_number: path.includes("=US") ? "+12125550101" : "+61480011499", features: [{ name: "sms" }, { name: "voice" }] }] });
  return reply({ data: {} });
}) as unknown as typeof fetch;

const mk = (name: string, over: Partial<Business> = {}): Business => ({
  id: crypto.randomUUID(),
  assistantId: "assistant-" + crypto.randomUUID().slice(0, 8),
  settings: { ...blankSettings(), businessName: `${name} Co`, receptionistName: name },
  instructions: "",
  createdAt: now,
  updatedAt: now,
  ...over,
});
let telnyxOne: Business;
let telnyxTwo: Business;
let vapiOne: Business;
const realFetch = globalThis.fetch;
const fresh = async (c: Business) => (await getClient(c.id))!;
const inOrg = <T>(fn: () => Promise<T>) => runAsOrg(orgId, fn);
const live = (c: Business) => ({ active: c.phoneNumbers ?? [], pending: [] as string[] });
const access = { twilio: true, telnyx: true };
const choicesFor = async (c: Business) => textChoicesFrom(c, (await agencyNumbers(orgId, await listClients(orgId), access)).numbers);
const choose = (c: Business, number: string) => inOrg(async () => control.chooseTextNumber(await fresh(c), { number }, await choicesFor(c), live(c)));
const status = (c: Business) => inOrg(async () => control.textsStatus(await fresh(c), live(c)));
const onOff = (c: Business, on: boolean) => inOrg(async () => control.setTexts(await fresh(c), on, live(c)));
const posts = () => calls.filter((c) => c.method !== "GET");
const hook = (c: Business) => smsHookUrl("twilio", c.id);

/** A text arriving at /hooks/sms/twilio, signed as Twilio signs it, answered by the real bot. */
async function textIn(c: Business, to: string) {
  const url = hook(c);
  const fields = { MessageSid: crypto.randomUUID(), AccountSid: SID, From: CUSTOMER, To: to, Body: "What time do you open?" };
  const req = new Request(url, { method: "POST", body: new URLSearchParams(fields).toString(), headers: { "x-twilio-signature": twilioSignature(TOKEN, url, fields) } });
  return inOrg(() => twilioTextHook(req, c.id, smsSecret(c.id), { ...liveBotDeps, fetch: fake, wait: true }));
}
const replies = () => calls.filter((c) => c.url.includes("/Messages.json")).map((c) => c.form!);

beforeAll(async () => {
  try {
    await migrate();
    if (!publicUrl()) await savePublicUrl(APP);
    await sql`insert into orgs (id, name, platform_telnyx) values (${orgId}, 'text numbers test', true)`;
    await saveTwilio(orgId, { accountSid: SID, user: SID, secret: TOKEN, kind: "token" }, "test");
  } catch (err) {
    ready = false;
    console.warn("[textNumbers.test] no database, skipping:", (err as Error).message);
  }
}, 60000);

// Another test file's stand-in for server/telnyx.ts (bun's mocks are process-wide) can leave no "current org";
// the install's own Twilio keys are then the ones used, so they're the same pretend account here.
const installTwilio = (on: boolean) => {
  if (on) Object.assign(process.env, { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN });
  else {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
  }
};

beforeEach(async () => {
  installTwilio(true);
  globalThis.fetch = fake;
  calls = [];
  sendError = "";
  leftOver = [];
  twilioNumbers = [tw("PN1", US), tw("PN2", US2), tw("PN3", AU_TW), tw("PN4", AU_LAND_TW, false)];
  profiles = new Map([["prof-one", { enabled: true, numbers: new Set([MOBILE]) }]]);
  telnyxOne = mk("Mia", { phoneNumbers: [MOBILE], textingProfileId: "prof-one" });
  telnyxTwo = mk("Noah", { phoneNumbers: [MOBILE2] });
  vapiOne = mk("Ava", { voiceProvider: "vapi", phoneNumbers: [AU_TW] });
  forgetNumberCaps();
  forgetTextsSummary();
  if (!ready) return;
  forgetTwilio(orgId);
  await sql`delete from clients where org_id = ${orgId}`;
  await sql`delete from companies where org_id = ${orgId}`;
  for (const c of [telnyxOne, telnyxTwo, vapiOne]) await insertClient(orgId, c);
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (publicUrl().endsWith(".example.com")) await savePublicUrl("");
  if (ready) {
    await sql`delete from clients where org_id = ${orgId}`;
    await sql`delete from companies where org_id = ${orgId}`;
    await clearTwilio(orgId);
    await sql`delete from orgs where id = ${orgId}`;
  }
  for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
});

describe("a Telnyx receptionist texting from a US Twilio number", () => {
  test("the list has every number, and the choices are the ones that can text", async () => {
    if (!ready) return;
    const { numbers, problems } = await inOrg(async () => agencyNumbers(orgId, await listClients(orgId), access));
    expect(problems).toEqual([]);
    expect(numbers.map((n) => n.number).sort()).toEqual([US, US2, AU_TW, AU_LAND_TW, MOBILE, MOBILE2, SPARE].sort());
    expect(numbers.find((n) => n.number === US)).toMatchObject({ provider: "twilio", calls: true, sms: true, callsBy: null, textsBy: null });
    expect(numbers.find((n) => n.number === MOBILE)).toMatchObject({ provider: "telnyx", callsBy: { name: "Mia" }, textsBy: { name: "Mia" } });
    expect(numbers.find((n) => n.number === SPARE)).toMatchObject({ provider: "telnyx", sms: true, ownedId: "1001", callsBy: null });
    expect(numbers.find((n) => n.number === AU_LAND_TW)).toMatchObject({ sms: false });
    const choices = await inOrg(() => choicesFor(telnyxOne));
    expect(choices.map((c) => c.number)).not.toContain(AU_LAND_TW);
    expect(choices).toContainEqual({ number: US, via: "twilio", usedBy: "" });
    expect(choices).toContainEqual({ number: SPARE, via: "telnyx", usedBy: "" });
    expect(choices.find((c) => c.number === MOBILE2)).toMatchObject({ usedBy: "Noah" });
  });

  test("a number left on a deleted assistant shows as free, even if an old receptionist still lists it", async () => {
    if (!ready) return;
    const STALE = "+61420170563";
    await insertClient(orgId, mk("Old", { assistantId: "assistant-gone", phoneNumbers: [STALE] }));
    leftOver = [{ id: "1002", phone_number: STALE, phone_number_type: "mobile", status: "active", connection_id: "app-gone", connection_name: "ai-assistant-gone" }];
    const { numbers, problems } = await inOrg(async () => agencyNumbers(orgId, await listClients(orgId), access));
    expect(problems).toEqual([]);
    expect(numbers.find((n) => n.number === STALE)).toMatchObject({ callsBy: null, textsBy: null, connectedTo: "", ownedId: "1002", sms: true });
    await choose(telnyxOne, STALE);
    expect(await status(telnyxOne)).toMatchObject({ status: "on", current: { number: STALE, via: "telnyx" } });
  });

  test("picking it sets only that number's text webhook; voice is untouched and the old Telnyx texting stops", async () => {
    if (!ready) return;
    await choose(telnyxOne, US);
    expect((await fresh(telnyxOne)).textNumber).toEqual({ number: US, via: "twilio" });
    expect(find(US).sms_url).toBe(hook(telnyxOne));
    expect(find(US).voice_url).toBe("https://voice.example.com/keep");
    expect(profiles.get("prof-one")!.enabled).toBe(false);
    const writes = posts();
    expect(writes.filter((c) => c.url.includes("api.twilio.com")).map((c) => c.form)).toEqual([{ SmsUrl: hook(telnyxOne), SmsMethod: "POST" }]);
    // Nothing goes to Vapi, and no call routing changes on Telnyx.
    expect(calls.some((c) => c.url.includes("api.vapi.ai"))).toBe(false);
    expect(writes.some((c) => /\/phone_numbers\/|\/ai\/assistants/.test(c.url) && !c.url.includes("messaging"))).toBe(false);
    expect(await status(telnyxOne)).toMatchObject({ status: "on", on: true, current: { number: US, via: "twilio" }, numbers: [US] });
    expect(await inOrg(async () => smsNumberOf(await fresh(telnyxOne)))).toBe(US);
  });

  test("an incoming text reaches that receptionist and the reply goes out from the US number; follow-ups too", async () => {
    if (!ready) return;
    await choose(telnyxOne, US);
    calls = [];
    expect((await textIn(telnyxOne, US)).status).toBe(200);
    expect(replies()).toHaveLength(1);
    expect(replies()[0]).toMatchObject({ From: US, To: CUSTOMER });
    expect(replies()[0].Body).toContain("We open at 8.");
    // Texts to its calls number no longer get answered.
    calls = [];
    const telnyx = JSON.stringify({ data: { event_type: "message.received", id: "e", payload: { id: crypto.randomUUID(), direction: "inbound", from: { phone_number: CUSTOMER }, to: [{ phone_number: MOBILE }], text: "hi" } } });
    await inOrg(() => telnyxTextHook(new Request("https://x/y", { method: "POST", body: telnyx }), telnyxOne.id, smsSecret(telnyxOne.id), { ...liveBotDeps, fetch: fake, wait: true }));
    expect(calls.some((c) => /\/messages$|Messages\.json/.test(c.url))).toBe(false);
    // Text-back and reminders use sendSms with the number smsNumberOf gave.
    calls = [];
    await inOrg(async () => sendSms(await fresh(telnyxOne), { from: US, to: CUSTOMER, text: "Reminder" }));
    expect(replies()).toEqual([{ From: US, To: CUSTOMER, Body: "Reminder" }]);
  });

  test("a text Twilio won't send shows in the status, until one goes through", async () => {
    if (!ready) return;
    await choose(telnyxOne, US);
    sendError = "Permission to send an SMS has not been enabled for the region";
    await expect(inOrg(async () => sendSms(await fresh(telnyxOne), { from: US, to: CUSTOMER, text: "x" }))).rejects.toThrow("region");
    expect((await status(telnyxOne)).warning).toContain("not been enabled for the region");
    sendError = "";
    await inOrg(async () => sendSms(await fresh(telnyxOne), { from: US, to: CUSTOMER, text: "x" }));
    expect((await status(telnyxOne)).warning).toBeUndefined();
  });

  test("off releases the number and stops answering; on points it back; changing releases the old one", async () => {
    if (!ready) return;
    await choose(telnyxOne, US);
    await onOff(telnyxOne, false);
    expect(find(US).sms_url).toBe("");
    expect(await status(telnyxOne)).toMatchObject({ status: "off", on: false, current: { number: US } });
    expect(await inOrg(async () => smsNumberOf(await fresh(telnyxOne)))).toBeNull();
    calls = [];
    await textIn(telnyxOne, US);
    expect(replies()).toEqual([]);
    await onOff(telnyxOne, true);
    expect(find(US).sms_url).toBe(hook(telnyxOne));
    await choose(telnyxOne, US2);
    expect(find(US).sms_url).toBe("");
    expect(find(US2).sms_url).toBe(hook(telnyxOne));
    // And back to a Telnyx mobile: the Twilio number is let go and the profile carries only the pick.
    await choose(telnyxOne, SPARE);
    expect(find(US2).sms_url).toBe("");
    expect(profiles.get("prof-one")).toMatchObject({ enabled: true });
    expect([...profiles.get("prof-one")!.numbers]).toEqual([SPARE]);
    expect(await status(telnyxOne)).toMatchObject({ status: "on", current: { number: SPARE, via: "telnyx" } });
    expect(find(US2).voice_url).toBe("https://voice.example.com/keep");
  });

  test("a number answers texts for one receptionist only; once that one is off, another may take it", async () => {
    if (!ready) return;
    await choose(telnyxOne, US);
    await expect(choose(telnyxTwo, US)).rejects.toThrow("already answers texts for Mia");
    await expect(choose(telnyxTwo, AU_TW)).rejects.toThrow("already answers texts for Ava");
    await expect(choose(telnyxTwo, "+19995550100")).rejects.toThrow("Choose one of your numbers");
    await onOff(telnyxOne, false);
    await choose(telnyxTwo, US);
    expect(find(US).sms_url).toBe(hook(telnyxTwo));
    await expect(onOff(telnyxOne, true)).rejects.toThrow("now answers texts for Noah");
    // Releasing never wipes another receptionist's address.
    await onOff(telnyxOne, false);
    expect(find(US).sms_url).toBe(hook(telnyxTwo));
  });

  test("a number picked from a Vapi receptionist's calls number stays picked when Vapi's settings are re-applied or its calls move", async () => {
    if (!ready) return;
    await onOff(vapiOne, false);
    await choose(telnyxOne, AU_TW);
    await onOff(vapiOne, true);
    await inOrg(async () => vapiProvider.applyAutomations(await fresh(vapiOne)));
    expect(find(AU_TW).sms_url).toBe(hook(telnyxOne));
    expect((await status(vapiOne)).detail).toContain("answers texts for Mia");
    expect(await inOrg(async () => smsNumberOf(await fresh(vapiOne)))).toBeNull();
  });

  test("buying an Australian mobile doesn't replace the picked number; deleting the receptionist releases it", async () => {
    if (!ready) return;
    await choose(telnyxOne, US);
    calls = [];
    await inOrg(async () => control.textsAfterBuy(await fresh(telnyxOne), { status: "success", phoneNumbers: [SPARE] }));
    await inOrg(async () => control.textsWhenLive(await fresh(telnyxOne), [SPARE]));
    expect(posts()).toEqual([]);
    await inOrg(async () => control.releaseTextNumber(await fresh(telnyxOne)));
    expect(find(US).sms_url).toBe("");
  });

  test("the status says plainly what's wrong", async () => {
    if (!ready) return;
    await choose(telnyxOne, US);
    find(US).sms_url = "https://someone.else/sms";
    expect(await status(telnyxOne)).toMatchObject({ status: "failed", detail: expect.stringContaining("isn't sending this number's texts here") });
    find(US).sms_url = hook(telnyxOne);
    find(US).sms_application_sid = "AP1";
    expect((await status(telnyxOne)).detail).toContain("TwiML app");
    twilioNumbers = twilioNumbers.filter((n) => n.phone_number !== US);
    expect(await status(telnyxOne)).toMatchObject({ status: "cant", detail: expect.stringContaining("isn't on your Twilio account") });
    await clearTwilio(orgId);
    installTwilio(false);
    expect((await status(telnyxOne)).detail).toContain("Twilio isn't connected");
    await saveTwilio(orgId, { accountSid: SID, user: SID, secret: TOKEN, kind: "token" }, "test");
  });
});

describe("the public address moving", () => {
  test("our text address moves to the new one; other addresses and voice are left alone", async () => {
    if (!ready) return;
    const before = publicUrl();
    await savePublicUrl(APP);
    // With PUBLIC_URL fixed for the whole test run there is no moving it from here.
    if (publicUrl() !== APP) return;
    await choose(telnyxOne, US);
    // The Vapi receptionist's own number was pointed at us when it was attached.
    find(AU_TW).sms_url = hook(vapiOne);
    find(US2).sms_url = "https://someone.else/sms";
    await saveClient({ ...(await fresh(telnyxTwo)), textNumber: { number: US2, via: "twilio" } });
    await savePublicUrl("https://moved.example.com");
    try {
      calls = [];
      await control.repointTwilioTexts();
      expect(find(US).sms_url).toStartWith(`https://moved.example.com/hooks/sms/twilio/${telnyxOne.id}/`);
      expect(find(AU_TW).sms_url).toStartWith(`https://moved.example.com/hooks/sms/twilio/${vapiOne.id}/`);
      expect(find(US2).sms_url).toBe("https://someone.else/sms");
      expect(posts().every((c) => Object.keys(c.form ?? {}).join() === "SmsUrl,SmsMethod")).toBe(true);
      calls = [];
      await control.repointTwilioTexts();
      expect(posts()).toEqual([]);
    } finally {
      await savePublicUrl(before);
    }
  });
});

describe("what a number can really do", () => {
  test("a US Twilio number that Twilio says can text does; a US Telnyx number doesn't", async () => {
    if (!ready) return;
    const usVapi = mk("Zed", { voiceProvider: "vapi", phoneNumbers: [US, AU_LAND_TW] });
    const usTelnyx = mk("Tel", { phoneNumbers: ["+12125550199"] });
    await insertClient(orgId, usVapi);
    await insertClient(orgId, usTelnyx);
    const can = await textCapability([{ orgId, client: usVapi }, { orgId, client: usTelnyx }, { orgId, client: telnyxOne }]);
    expect([can(orgId, US), can(orgId, AU_LAND_TW), can(orgId, "+12125550199"), can(orgId, MOBILE)]).toEqual([true, false, false, true]);
    // The dashboard's number list says the same.
    const ctx = { user: { id: crypto.randomUUID(), platformAdmin: false }, org: { id: orgId }, role: "owner" } as any;
    const url = new URL("https://x/api/console/numbers");
    const res = await consoleRoutes({ req: new Request(url), url, path: url.pathname, method: "GET", ctx, orgId, appUrl: "https://x" }, {} as any);
    const rows = ((await res!.json()) as { numbers: { e164: string; capabilities: { sms: boolean } }[] }).numbers;
    const sms = (n: string) => rows.find((r) => r.e164 === n)?.capabilities.sms;
    expect([sms(US), sms(AU_LAND_TW), sms("+12125550199"), sms(MOBILE)]).toEqual([true, false, false, true]);
  });

  test("the client page's status list says the same as the Messages tab", async () => {
    if (!ready) return;
    // A US Twilio number answering a Vapi receptionist's calls: it texts, nothing about needing a mobile.
    const usVapi = mk("Zed", { voiceProvider: "vapi", phoneNumbers: [US] });
    const bare = mk("Bea", { voiceProvider: "vapi" });
    await insertClient(orgId, usVapi);
    await insertClient(orgId, bare);
    find(US).sms_url = hook(usVapi);
    await choose(telnyxOne, US2);
    forgetTextsSummary();
    const ctx = { user: { id: crypto.randomUUID(), platformAdmin: false }, org: { id: orgId }, role: "owner" } as any;
    const get = async (path: string) => {
      const url = new URL(`https://x${path}`);
      const res = await inOrg(() => consoleRoutes({ req: new Request(url), url, path: url.pathname, method: "GET", ctx, orgId, appUrl: "https://x" }, {} as any));
      return (await res!.json()) as any;
    };
    await get("/api/console/companies");
    const smsRow = async (c: Business) => {
      const [{ company_id }] = await sql`select company_id from clients where id = ${c.id}`;
      const detail = await get(`/api/console/companies/${company_id}`);
      return detail.receptionists.find((r: any) => r.id === c.id).automations.find((a: any) => a.key === "sms");
    };
    expect(await smsRow(usVapi)).toMatchObject({ status: "live", state: "On", detail: "Replies to texts on (227) 220-4547" });
    expect(await smsRow(telnyxOne)).toMatchObject({ status: "live", state: "On", detail: "Replies to texts on (202) 555-0147" });
    expect(await smsRow(bare)).toMatchObject({ status: "off", state: "Not set up", detail: "No text number yet." });
    // Twilio stops sending its texts here: the list says so, as the Messages tab does.
    find(US).sms_url = "";
    forgetTextsSummary();
    expect(await smsRow(usVapi)).toMatchObject({ status: "attention", state: "Needs attention", detail: (await status(usVapi)).detail });
    await onOff(usVapi, false);
    expect(await smsRow(usVapi)).toMatchObject({ status: "off", state: "Off" });
  });

  test("numbers for sale on Telnyx only say Texts when our texting can use them", async () => {
    expect((await availableNumbers("local", "US"))[0].sms).toBe(false);
    expect((await availableNumbers("mobile", "AU"))[0].sms).toBe(true);
  });
});

describe("a Vapi receptionist can use a Telnyx mobile for texts", () => {
  test("the mobile goes on a profile of ours and replies go through Telnyx", async () => {
    if (!ready) return;
    find(AU_TW).sms_url = hook(vapiOne);
    await choose(vapiOne, SPARE);
    expect(find(AU_TW).sms_url).toBe("");
    const c = await fresh(vapiOne);
    expect(profiles.get(c.textingProfileId!)!.numbers.has(SPARE)).toBe(true);
    expect(await status(vapiOne)).toMatchObject({ status: "on", current: { number: SPARE, via: "telnyx" } });
    calls = [];
    await inOrg(async () => sendSms(await fresh(vapiOne), { from: SPARE, to: CUSTOMER, text: "Hi" }));
    expect(calls.map((x) => x.url)).toEqual(["https://api.telnyx.com/v2/messages"]);
  });
});
