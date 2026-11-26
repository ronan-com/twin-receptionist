// The Vapi engine: how Twin's script, tools, transfer and recording become a Vapi assistant,
// how Vapi's call reports are checked and filed, and that the Telnyx tools are unchanged.
// Nothing here calls Vapi or a database: fetch is stubbed.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/voice/
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { blankSettings, type Business } from "../../src/lib/shared";

process.env.VAPI_API_KEY = "vapi-private-key-0000000000000000";
process.env.VAPI_PUBLIC_KEY = "vapi-public-key-00000000000000000";
process.env.VAPI_WEBHOOK_SECRET = "test-webhook-secret-for-vapi-events";

const { BOOKING_TOOL_DEFS, bookingTools } = await import("../booking");
const { defaultAutomations, normaliseAutomations, transferTool } = await import("../automations");
const map = await import("./vapiMap");
const { buildVapi, vapi, vapiProvider, attachNumber, checkVapiKey } = await import("./vapi");
const { vapiEvents, vapiToolHook } = await import("./vapiWebhook");

const BASE = "https://app.example.com";
const now = new Date().toISOString();
const client: Business = {
  id: "11111111-2222-3333-4444-555555555555",
  assistantId: "asst-1",
  settings: { ...blankSettings(), businessName: "Alpha Plumbing", greeting: "Hi, Alpha Plumbing.", timezone: "Australia/Brisbane", voiceId: "azure:en-AU-NatashaNeural" },
  instructions: "base script. It is {{telnyx_current_time_Australia/Brisbane}} local time. Channel \"{{telnyx_conversation_channel}}\", number ({{telnyx_end_user_target}}).",
  booking: { provider: "builtin", token: "tok-booking-123", minutes: 30, enabled: true, createdAt: now },
  voiceProvider: "vapi",
  createdAt: now,
  updatedAt: now,
};

const saved = (over: any) => ({ stored: true, settings: { ...normaliseAutomations(over, defaultAutomations()) } });

describe("Telnyx tools are unchanged", () => {
  test("the three booking tools keep their Telnyx webhook shape", () => {
    const tools = bookingTools(client, BASE);
    expect(tools.map((t: any) => t.webhook.name)).toEqual(["check_availability", "book_appointment", "request_callback"]);
    expect(tools[0]).toEqual({
      type: "webhook",
      timeout_ms: 10000,
      webhook: {
        name: "check_availability",
        description: "Get the free appointment times on one day. Call it before offering any times.",
        url: `${BASE}/hooks/${client.id}/availability`,
        method: "POST",
        headers: [{ name: "X-Twin-Key", value: "tok-booking-123" }],
        body_parameters: {
          type: "object",
          properties: { date: { type: "string", description: "The day to check, as YYYY-MM-DD in the business's time zone." } },
          required: ["date"],
        },
      },
    });
    expect((tools[1] as any).webhook.body_parameters.required).toEqual(["start", "name", "phone", "service", "channel"]);
    expect((tools[2] as any).webhook.url).toBe(`${BASE}/hooks/${client.id}/callback`);
  });

  test("the Telnyx transfer tool is still a transfer with targets and a from number", () => {
    const a = normaliseAutomations({ transfer: { enabled: true, number: "0733334444", name: "Sam" } });
    const withNumber = { ...client, phoneNumbers: ["+61412000999"] };
    expect(transferTool(withNumber, a)).toEqual({
      type: "transfer",
      transfer: {
        description: "Put the caller through to Sam when the caller asks to speak to a person, or it is urgent. Only on a phone call.",
        targets: [{ name: "Sam", to: "+61733334444" }],
        from: "+61412000999",
        voicemail_detection: { detection_mode: "premium", on_voicemail_detected: { action: "stop_transfer" } },
      },
    });
    // No number of its own to transfer from: no tool on Telnyx.
    expect(transferTool(client, a)).toBeNull();
  });
});

describe("script and voice", () => {
  test("Telnyx variables become Vapi's", () => {
    const out = map.toVapiScript(client.instructions + " Open: {{twin_open_now}}", true);
    expect(out).toContain('{{"now" | date: "%A, %B %d, %Y, %I:%M %p", "Australia/Brisbane"}}');
    expect(out).toContain('"phone_call"');
    expect(out).toContain("({{customer.number}})");
    expect(out).toContain("Open: yes");
    expect(out).not.toContain("telnyx_");
    expect(map.toVapiScript("{{twin_open_now}}", false)).toBe("no");
  });

  test("the voice picker ids map to Vapi voices, and a Telnyx leftover falls back to an Australian one", () => {
    expect(map.vapiVoice("azure:en-AU-WilliamNeural")).toEqual({ provider: "azure", voiceId: "en-AU-WilliamNeural" });
    expect(map.vapiVoice("vapi:Elliot")).toEqual({ provider: "vapi", voiceId: "Elliot" });
    expect(map.vapiVoice("11labs:21m00Tcm4TlvDq8ikWAM")).toEqual({ provider: "11labs", voiceId: "21m00Tcm4TlvDq8ikWAM" });
    expect(map.vapiVoice("some-telnyx-uuid")).toEqual({ provider: "azure", voiceId: "en-AU-NatashaNeural" });
    const list = map.vapiVoiceList();
    expect(list[0].recommended).toBe(true);
    expect(new Set(list.map((v) => v.id)).size).toBe(list.length);
  });
});

describe("assistant body", () => {
  const build = (over: Partial<ReturnType<typeof buildVapi>> = {}, row: any = null) => ({ ...buildVapi(client, client.settings, client.instructions, row, BASE, new Date("2026-11-27T02:00:00Z")), ...over });

  test("script, greeting, voice, hang-up and call report address", () => {
    const body: any = map.vapiAssistantBody(build());
    expect(body.name).toBe(`Alpha Plumbing · ${(body.name as string).split(" · ")[1]}`);
    expect(body.firstMessage).toBe("Hi, Alpha Plumbing.");
    expect(body.model.messages).toHaveLength(1);
    expect(body.model.messages[0].role).toBe("system");
    expect(body.model.messages[0].content).toContain("base script.");
    expect(body.voice).toEqual({ provider: "azure", voiceId: "en-AU-NatashaNeural" });
    expect(body.model.tools[0]).toEqual({ type: "endCall" });
    expect(body.transcriber).toEqual({ provider: "deepgram", model: "nova-3", language: "en-AU" });
    expect(body.serverMessages).toEqual(["end-of-call-report"]);
    expect(body.server.url).toBe(`${BASE}/hooks/vapi/${client.id}`);
    expect(body.server.headers["X-Vapi-Secret"]).toBe(map.eventsSecret(client.id));
    // Recording is off until the agency turns it on.
    expect(body.artifactPlan).toEqual({ recordingEnabled: false });
    expect(body.maxDurationSeconds).toBe(1800);
  });

  test("names stay within Vapi's 40 characters", () => {
    const body: any = map.vapiAssistantBody(build({ name: "A very long business name that goes on and on · Product" }));
    expect(body.name.length).toBeLessThanOrEqual(40);
  });

  test("booking tools are function tools on our hook addresses with the booking key", () => {
    const body: any = map.vapiAssistantBody(build());
    const fns = body.model.tools.filter((t: any) => t.type === "function");
    expect(fns.map((t: any) => t.function.name)).toEqual(BOOKING_TOOL_DEFS.map((d) => d.name));
    const book = fns.find((t: any) => t.function.name === "book_appointment");
    expect(book.server).toEqual({ url: `${BASE}/hooks/${client.id}/vapi/book`, timeoutSeconds: 10, headers: { "X-Twin-Key": "tok-booking-123" } });
    expect(book.function.parameters.required).toEqual(["start", "name", "phone", "service", "channel"]);
  });

  test("paused and booking modes narrow the tools; no booking means no tools", () => {
    const paused = buildVapi(client, { ...client.settings, paused: { message: "Back soon.", since: now } as any }, "x", null, BASE);
    expect(paused.tools).toEqual(["request_callback"]);
    const request = buildVapi(client, { ...client.settings, profile: { bookingMode: "request" } as any }, "x", null, BASE);
    expect(request.tools).toEqual(["check_availability", "request_callback"]);
    const none: any = map.vapiAssistantBody(buildVapi({ ...client, booking: undefined }, client.settings, "x", null, BASE));
    expect(none.model.tools).toEqual([{ type: "endCall" }]);
  });

  test("transfer becomes a transferCall tool to the urgent number; voicemail pull-back is not mapped", () => {
    const row = saved({ transfer: { enabled: true, number: "0733334444", name: "Sam", urgent: true } });
    const b = buildVapi(client, client.settings, client.instructions, row, BASE);
    const body: any = map.vapiAssistantBody(b);
    const t = body.model.tools.find((x: any) => x.type === "transferCall");
    expect(t.destinations).toEqual([
      { type: "number", number: "+61733334444", description: expect.stringContaining("Put the caller through to Sam"), transferPlan: { mode: "blind-transfer" } },
    ]);
    // The script tells the model about it, with no "from" number needed (Telnyx needs one).
    expect(body.model.messages[0].content).toContain("Putting a caller through");
  });

  test("recording and language and limits follow the automations", () => {
    const row = saved({ recording: { enabled: true, notice: "This call is recorded." }, language: { code: "multi" }, callLimits: { maxMinutes: 10, idleSeconds: 20 } });
    const b = buildVapi(client, client.settings, client.instructions, row, BASE);
    const body: any = map.vapiAssistantBody(b);
    expect(body.artifactPlan.recordingEnabled).toBe(true);
    expect(body.firstMessage).toBe("Hi, Alpha Plumbing. This call is recorded.");
    expect(body.transcriber.language).toBe("multi");
    expect(body.maxDurationSeconds).toBe(600);
  });

  test("after hours: the closed greeting and a closed open-now line, refreshed as the business opens and closes", () => {
    const row = saved({ hoursMode: { enabled: true, greeting: "We're closed. Leave a message at {business}." }, transfer: { enabled: true, number: "0733334444", when: "hours" } });
    const closedAt = new Date("2026-11-27T14:00:00Z"); // midnight, start of Saturday, Brisbane
    const settings = { ...client.settings, hours: { ...client.settings.hours, sat: { open: false, from: "09:00", to: "17:00" } } };
    const closed = buildVapi(client, settings, client.instructions + " Open: {{twin_open_now}}", row, BASE, closedAt);
    expect(closed.greeting).toBe("We're closed. Leave a message at Alpha Plumbing.");
    expect(closed.script).toContain('Open right now: "no"');
    const hoursOpen = { ...settings, hours: { ...settings.hours, sat: { open: true, from: "00:00", to: "23:59" } } };
    const open = buildVapi(client, hoursOpen, client.instructions, row, BASE, closedAt);
    expect(open.greeting).toBe("Hi, Alpha Plumbing.");
    expect(open.script).toContain('Open right now: "yes"');
  });

  test("with no public address there is no report address and no tools", () => {
    const b = buildVapi(client, client.settings, "x", null, "");
    const body: any = map.vapiAssistantBody(b);
    expect(body.server).toBeUndefined();
    expect(body.model.tools).toEqual([{ type: "endCall" }]);
  });
});

describe("the report webhook", () => {
  const sec = () => map.eventsSecret(client.id);
  const report = (over: any = {}) => ({
    message: {
      type: "end-of-call-report",
      endedReason: "customer-ended-call",
      startedAt: "2026-11-27T01:00:00.000Z",
      endedAt: "2026-11-27T01:02:30.000Z",
      cost: 0.1234,
      analysis: { summary: "Caller booked a blocked drain visit." },
      artifact: {
        recordingUrl: "https://storage.vapi.ai/rec.wav",
        messages: [
          { role: "system", message: "prompt" },
          { role: "bot", message: "Hi, Alpha Plumbing.", secondsFromStart: 0 },
          { role: "user", message: "I have a blocked drain.", secondsFromStart: 4 },
          { role: "tool_calls", toolCalls: [{ function: { name: "book_appointment" } }] },
        ],
      },
      call: { id: "call-1", type: "inboundPhoneCall", assistantId: "asst-1", customer: { number: "+61412345678" } },
      phoneNumber: { number: "+61733334444" },
      ...over,
    },
  });
  const stored: any[] = [];
  const deps = {
    getClient: async (id: string) => (id === client.id ? client : null),
    orgOfClient: async () => "org-1",
    storeCall: async (...a: any[]) => void stored.push(a),
  } as any;
  const post = (body: unknown, headers: Record<string, string>) => new Request("https://x/hooks/vapi/" + client.id, { method: "POST", headers, body: JSON.stringify(body) });

  test("the secret is per receptionist and accepted as X-Vapi-Secret or a Bearer token", () => {
    expect(map.secretMatches(new Headers({ "x-vapi-secret": sec() }), client.id)).toBe(true);
    expect(map.secretMatches(new Headers({ authorization: `Bearer ${sec()}` }), client.id)).toBe(true);
    expect(map.secretMatches(new Headers({ "x-vapi-secret": "nope" }), client.id)).toBe(false);
    expect(map.secretMatches(new Headers(), client.id)).toBe(false);
    expect(map.secretMatches(new Headers({ "x-vapi-secret": sec() }), "99999999-2222-3333-4444-555555555555")).toBe(false);
  });

  test("a wrong or missing secret is refused as if nothing is there", async () => {
    stored.length = 0;
    expect((await vapiEvents(post(report(), {}), client.id, deps)).status).toBe(404);
    expect((await vapiEvents(post(report(), { "x-vapi-secret": "wrong" }), client.id, deps)).status).toBe(404);
    expect(stored).toHaveLength(0);
  });

  test("an end-of-call report is filed with transcript, outcome, duration, cost and recording", async () => {
    stored.length = 0;
    const res = await vapiEvents(post(report(), { "x-vapi-secret": sec() }), client.id, deps);
    expect(res.status).toBe(200);
    expect(stored).toHaveLength(1);
    const [orgId, clientId, rec] = stored[0];
    expect(orgId).toBe("org-1");
    expect(clientId).toBe(client.id);
    expect(rec).toMatchObject({
      id: "call-1",
      channel: "call",
      from: "+61412345678",
      to: "+61733334444",
      seconds: 150,
      status: "completed",
      outcome: "booked",
      summary: "Caller booked a blocked drain visit.",
      recordingUrl: "https://storage.vapi.ai/rec.wav",
      costUsd: 0.1234,
      endedReason: "customer-ended-call",
    });
    expect(rec.transcript.map((m: any) => [m.role, m.text])).toEqual([
      ["assistant", "Hi, Alpha Plumbing."],
      ["user", "I have a blocked drain."],
    ]);
    expect(rec.transcript[1].at).toBe("2026-11-27T01:00:04.000Z");
  });

  test("other message types are accepted and ignored; another receptionist's call is not filed", async () => {
    stored.length = 0;
    expect((await vapiEvents(post({ message: { type: "status-update" } }, { "x-vapi-secret": sec() }), client.id, deps)).status).toBe(200);
    const other = report();
    other.message.call.assistantId = "someone-else";
    expect((await vapiEvents(post(other, { "x-vapi-secret": sec() }), client.id, deps)).status).toBe(422);
    expect(stored).toHaveLength(0);
  });

  test("web calls and failed calls are told apart", () => {
    const web = map.callRecord(report({ call: { id: "c2", type: "webCall", assistantId: "asst-1" }, phoneNumber: undefined }).message);
    expect(web.channel).toBe("web");
    const failed = map.callRecord(report({ endedReason: "pipeline-error-openai-llm-failed", analysis: {} }).message);
    expect(failed.status).toBe("failed");
    expect(failed.summary).toBe("pipeline-error-openai-llm-failed");
  });
});

describe("tool calls", () => {
  const envelope = (name: string, args: any) => ({ message: { type: "tool-calls", toolCallList: [{ id: "tc-1", type: "function", function: { name, arguments: args } }] } });
  const req = (body: unknown, key = "tok-booking-123") =>
    new Request(`https://x/hooks/${client.id}/vapi/book`, { method: "POST", headers: { "x-twin-key": key }, body: JSON.stringify(body) });

  test("the arguments reach the same hook as Telnyx's tools, and the answer goes back as results", async () => {
    const seen: any[] = [];
    const hook = async (r: Request, id: string, action: string) => {
      seen.push({ id, action, key: r.headers.get("x-twin-key"), body: await r.json() });
      return new Response(JSON.stringify({ booked: true, when: "Friday at 9am" }), { status: 200 });
    };
    const res = await vapiToolHook(req(envelope("book_appointment", { name: "Sam", phone: "0412", start: "x", service: "s", channel: "call" })), client.id, "book", hook);
    expect(res.status).toBe(200);
    expect(seen[0]).toMatchObject({ id: client.id, action: "book", key: "tok-booking-123", body: { name: "Sam", channel: "call" } });
    expect(await res.json()).toEqual({ results: [{ name: "book_appointment", toolCallId: "tc-1", result: '{"booked":true,"when":"Friday at 9am"}' }] });
  });

  test("arguments sent as a JSON string are understood", () => {
    expect(map.toolCallsOf(envelope("check_availability", '{"date":"2026-11-30"}').message)).toEqual([{ id: "tc-1", name: "check_availability", args: { date: "2026-11-30" } }]);
  });

  test("a wrong key is answered 404 and nothing is run", async () => {
    const hook = async () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    const res = await vapiToolHook(req(envelope("book_appointment", {}), "bad"), client.id, "book", hook);
    expect(res.status).toBe(404);
  });

  test("a refusal (closed, paused) is passed to the caller as the result", async () => {
    const hook = async () => new Response(JSON.stringify({ error: "The business is closed." }), { status: 200 });
    const res = await vapiToolHook(req(envelope("check_availability", { date: "2026-11-30" })), client.id, "availability", hook);
    expect(((await res.json()) as any).results[0].result).toContain("closed");
  });
});

describe("Vapi's API", () => {
  const realFetch = globalThis.fetch;
  const sent: { url: string; method: string; headers: any; body: any }[] = [];
  const reply = (status: number, body: unknown) => {
    globalThis.fetch = mock(async (url: any, init: any) => {
      sent.push({ url: String(url), method: init?.method, headers: init?.headers, body: init?.body ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify(body), { status });
    }) as any;
  };
  afterEach(() => {
    globalThis.fetch = realFetch;
    sent.length = 0;
  });

  test("calls carry the private key", async () => {
    reply(200, []);
    await vapi("GET", "/assistant?limit=1");
    expect(sent[0].url).toBe("https://api.vapi.ai/assistant?limit=1");
    expect(sent[0].headers.Authorization).toBe("Bearer vapi-private-key-0000000000000000");
  });

  test("a key is checked with a cheap GET, and a bad one is an error a person can read", async () => {
    reply(200, []);
    await checkVapiKey("another-key-1234567890123456");
    expect(sent[0]).toMatchObject({ method: "GET", url: "https://api.vapi.ai/assistant?limit=1" });
    expect(sent[0].headers.Authorization).toBe("Bearer another-key-1234567890123456");
    reply(401, { message: "Invalid Key.", statusCode: 401 });
    await expect(checkVapiKey("bad-key-1234567890123456789")).rejects.toMatchObject({ status: 401, message: "The phone service said: Invalid Key." });
  });

  test("validation errors from Vapi (a list) are joined", async () => {
    reply(400, { message: ["voice.voiceId must be a string", "model.model is invalid"], statusCode: 400 });
    await expect(vapi("POST", "/assistant", {})).rejects.toMatchObject({ status: 400, message: expect.stringContaining("voice.voiceId must be a string; model.model is invalid") });
  });

  test("deleting an assistant that's already gone is fine", async () => {
    reply(404, { message: "Not found" });
    await vapiProvider.deleteAssistant(client);
    expect(sent[0]).toMatchObject({ method: "DELETE", url: "https://api.vapi.ai/assistant/asst-1" });
  });

  test("recent calls come from GET /call for the assistant, test calls shown as web", async () => {
    reply(200, [
      { id: "c1", type: "inboundPhoneCall", startedAt: "2026-11-27T01:00:00Z", endedAt: "2026-11-27T01:01:00Z", customer: { number: "+61412345678" }, assistantId: "asst-1" },
      { id: "c2", type: "webCall", createdAt: "2026-11-27T02:00:00Z", assistantId: "asst-1" },
    ]);
    const calls = await vapiProvider.recentConversations("asst-1", 20);
    expect(sent[0].url).toBe("https://api.vapi.ai/call?assistantId=asst-1&limit=20");
    expect(calls).toEqual([
      { id: "c1", startedAt: "2026-11-27T01:00:00.000Z", endedAt: "2026-11-27T01:01:00.000Z", channel: "call", from: "+61412345678", to: "", simulated: false },
      { id: "c2", startedAt: "2026-11-27T02:00:00.000Z", endedAt: "", channel: "web", from: "", to: "", simulated: false },
    ]);
  });

  test("the browser test call gets the public key and assistant id", async () => {
    expect(await vapiProvider.webCall("asst-1")).toEqual({ provider: "vapi", assistantId: "asst-1", publicKey: "vapi-public-key-00000000000000000" });
  });

  test("numbers: the receptionist's numbers are those on its assistant; buying is refused honestly", async () => {
    reply(200, [
      { id: "n1", number: "+61412000111", assistantId: "asst-1", status: "active" },
      { id: "n2", number: "+61412000222", assistantId: "other" },
    ]);
    const state = await vapiProvider.numbers.state({} as any, client);
    expect(state.numbers).toEqual([{ id: "n1", phoneNumber: "+61412000111", status: "active", type: "mobile" }]);
    expect(vapiProvider.numbers.support()).toMatchObject({ provider: "vapi", buy: false, import: true });
    await expect(vapiProvider.numbers.buy(client, {})).rejects.toThrow("doesn't sell Australian numbers");
    expect(await vapiProvider.numbers.search("mobile", "AU")).toEqual([]);
  });

  test("importing a Twilio number points it at the assistant", async () => {
    reply(201, { id: "pn-1", number: "+61412000111" });
    const order = await attachNumber(client, { source: "twilio", number: "+61 412 000 111", accountSid: "AC" + "a".repeat(32), authToken: "tok" });
    expect(sent[0]).toMatchObject({ method: "POST", url: "https://api.vapi.ai/phone-number" });
    expect(sent[0].body).toMatchObject({ provider: "twilio", number: "+61412000111", twilioAccountSid: "AC" + "a".repeat(32), twilioAuthToken: "tok", assistantId: "asst-1" });
    expect(order).toMatchObject({ id: "pn-1", status: "success", phoneNumbers: ["+61412000111"] });
  });

  test("importing a Telnyx number makes a credential first", async () => {
    reply(201, { id: "cred-1", number: "+61412000111" });
    await attachNumber(client, { source: "telnyx", number: "+61412000111", apiKey: "KEY01234567890" });
    expect(sent[0]).toMatchObject({ url: "https://api.vapi.ai/credential" });
    expect(sent[0].body).toMatchObject({ provider: "telnyx", apiKey: "KEY01234567890" });
    expect(sent[1].body).toMatchObject({ provider: "telnyx", number: "+61412000111", credentialId: "cred-1", assistantId: "asst-1" });
  });

  test("a free US number takes an area code; bad input is refused before anything is sent", async () => {
    reply(201, { id: "pn-2", number: "+14155550100" });
    await attachNumber(client, { source: "vapi", areaCode: "415" });
    expect(sent[0].body).toMatchObject({ provider: "vapi", numberDesiredAreaCode: "415", assistantId: "asst-1" });
    sent.length = 0;
    await expect(attachNumber(client, { source: "vapi", areaCode: "41" })).rejects.toThrow("3-digit");
    await expect(attachNumber(client, { source: "twilio", number: "0412", accountSid: "x", authToken: "y" })).rejects.toThrow("country code");
    await expect(attachNumber(client, { source: "twilio", number: "+61412000111", accountSid: "nope", authToken: "y" })).rejects.toThrow("Account SID");
    await expect(attachNumber(client, { source: "other" })).rejects.toThrow("Choose where");
    expect(sent).toHaveLength(0);
  });
});
