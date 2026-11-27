// Website chat: the public endpoint (CORS, limits, off switches), the tool-call loop with a
// pretend OpenRouter, and storage (against the dev database, cleaning up after itself).
//   bun test --env-file=../.env server/webchat.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { migrate, sql } from "./db";
import { insertClient } from "./store";
import {
  CHAT_LIMITS,
  BUSY_REPLY,
  chatGreeting,
  chatInstructions,
  chatToolNames,
  chatTools,
  chatTranscript,
  cleanVisitorText,
  createLimiter,
  dbStore,
  ensureWebchat,
  findByPublicId,
  historyForModel,
  listChats,
  liveLimits,
  newPublicId,
  normaliseDomains,
  originAllowed,
  runBookingTool,
  runTurn,
  saveWebchat,
  webchatPublic,
  type ChatStore,
  type StoredMessage,
  type WebchatDeps,
  type WebchatSettings,
} from "./webchat";

const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: true, from: "08:00", to: "17:00" }])) as any;

function business(over: Partial<Business> = {}, settings: Partial<Business["settings"]> = {}): Business {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    assistantId: "demo-assistant",
    settings: { ...blankSettings(), businessName: "Alpha Plumbing", receptionistName: "Mia", timezone: "Australia/Brisbane", hours, services: ["Blocked drain"], greeting: "Thanks for calling Alpha Plumbing.", ...settings },
    instructions: "",
    phoneNumbers: [],
    booking: { provider: "builtin", token: "t", minutes: 30, enabled: true, createdAt: now } as Business["booking"],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

const ID = "11111111-2222-4333-8444-555555555555";

// A pretend OpenRouter: answers with each scripted message in turn and records the requests.
function pretendModel(script: any[]) {
  const calls: any[] = [];
  const fn = (async (_url: any, init: any) => {
    calls.push(JSON.parse(init.body));
    const message = script.shift();
    if (message === "fail") return new Response("nope", { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const say = (content: string) => ({ role: "assistant", content });
const callTool = (id: string, name: string, args: unknown) => ({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

function memoryStore(): ChatStore & { rows: Map<string, StoredMessage[]>; owner: Map<string, string>; notes: any[] } {
  const rows = new Map<string, StoredMessage[]>();
  const owner = new Map<string, string>();
  const notes: any[] = [];
  return {
    rows,
    owner,
    notes,
    async open(clientId, id) {
      if (!owner.has(id)) owner.set(id, clientId);
      return owner.get(id) === clientId ? "mine" : "other";
    },
    async history(id) {
      const r = rows.get(id) ?? [];
      return { rows: r, userMessages: r.filter((m) => m.role === "user").length };
    },
    async saveTurn(id, add, note) {
      rows.set(id, [...(rows.get(id) ?? []), ...add]);
      notes.push(note);
    },
  };
}

function deps(over: Partial<WebchatDeps> & { settings?: Partial<WebchatSettings>; client?: Business } = {}): WebchatDeps & { store: ReturnType<typeof memoryStore> } {
  const client = over.client ?? business();
  const settings: WebchatSettings = { clientId: client.id, publicId: "pub_0123456789abcdef", enabled: true, domains: [], greeting: "", ...over.settings };
  const store = memoryStore();
  return {
    find: async (id: string) => (id === settings.publicId ? { settings, client, orgId: "org-1" } : null),
    store,
    knowledge: async () => [],
    halted: async () => false,
    brand: async () => ({ logo: "/brand/abc", primaryColor: "#ff0000", accentColor: "" }),
    limits: liveLimits(),
    tools: async () => ({}),
    ...over,
  } as any;
}

const post = (body: unknown, headers: Record<string, string> = {}, id = "pub_0123456789abcdef") =>
  new Request(`https://app.example.com/api/webchat/${id}/message`, { method: "POST", headers: { "Content-Type": "application/json", host: "app.example.com", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const PATH = "/api/webchat/pub_0123456789abcdef/message";

const savedKey = process.env.OPENROUTER_API_KEY;
beforeAll(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
});
afterAll(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
});

describe("small helpers", () => {
  test("visitor text loses HTML and control characters, and is capped", () => {
    expect(cleanVisitorText("hi <script>alert(1)</script> there<b>!</b>")).toBe("hi alert(1) there !");
    expect(cleanVisitorText("a\u0000b\u0007c  d")).toBe("a b c d");
    expect(cleanVisitorText("I <3 pizza")).toBe("I <3 pizza");
    expect(cleanVisitorText("x".repeat(5000)).length).toBe(CHAT_LIMITS.messageChars);
    expect(cleanVisitorText(undefined)).toBe("");
  });

  test("website lists are cleaned to bare hosts", () => {
    expect(normaliseDomains("https://www.Example.com/contact?x=1\nshop.example.net:8080, example.com")).toEqual(["example.com", "shop.example.net"]);
    expect(normaliseDomains([])).toEqual([]);
    expect(() => normaliseDomains("not a site!!")).toThrow();
    expect(() => normaliseDomains(Array.from({ length: 21 }, (_, i) => `a${i}.com`))).toThrow();
  });

  test("origins: any when none are listed, else the listed sites and their subdomains", () => {
    expect(originAllowed("https://anything.com", [])).toBe(true);
    expect(originAllowed(null, [])).toBe(true);
    const d = ["example.com"];
    expect(originAllowed("https://example.com", d)).toBe(true);
    expect(originAllowed("https://www.example.com", d)).toBe(true);
    expect(originAllowed("https://shop.example.com", d)).toBe(true);
    expect(originAllowed("https://evil-example.com", d)).toBe(false);
    expect(originAllowed("https://example.com.evil.io", d)).toBe(false);
    expect(originAllowed(null, d)).toBe(false);
    expect(originAllowed("null", d)).toBe(false);
    // The dashboard's own address always works, for the live preview.
    expect(originAllowed("https://app.example.org", d, "app.example.org")).toBe(true);
  });

  test("public ids are long and unguessable", () => {
    const a = newPublicId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newPublicId()).not.toBe(a);
  });

  test("the limiter counts a sliding window", () => {
    let t = 0;
    const l = createLimiter(2, 1000, () => t);
    expect(l.take("a").ok).toBe(true);
    expect(l.take("a").ok).toBe(true);
    expect(l.take("a").ok).toBe(false);
    expect(l.take("b").ok).toBe(true);
    t = 1500;
    expect(l.take("a").ok).toBe(true);
  });
});

describe("the script the chat runs on", () => {
  test("it is the phone script with the chat's own channel, time and rules", () => {
    const c = business();
    const text = chatInstructions(c, [], "Hi!", { text: "Friday 27 November 2026, 3:15pm", date: "2026-11-27" });
    expect(text).toContain("Alpha Plumbing");
    expect(text).toContain("Friday 27 November 2026, 3:15pm local time");
    expect(text).toContain("2026-11-27");
    expect(text).toContain("web_chat");
    expect(text).not.toContain("{{");
    expect(text).toContain("website");
  });

  test("a greeting is built from the receptionist's name unless the business wrote one", () => {
    const s = business().settings;
    expect(chatGreeting(s)).toContain("Mia");
    expect(chatGreeting(s, "G'day!")).toBe("G'day!");
    expect(chatGreeting({ ...s, paused: { at: "x", message: "We're away." } })).toBe("We're away.");
  });

  test("tools follow the same rules as the phone's", () => {
    expect(chatToolNames(business())).toEqual(["check_availability", "book_appointment", "request_callback"]);
    expect(chatToolNames(business({ booking: undefined }))).toEqual(["request_callback"]);
    expect(chatToolNames(business({}, { profile: { bookingMode: "request" } as any }))).toEqual(["check_availability", "request_callback"]);
    expect(chatToolNames(business({}, { profile: { bookingMode: "message_only" } as any }))).toEqual(["request_callback"]);
    expect(chatToolNames(business({}, { paused: { at: "x", message: "m" } }))).toEqual(["request_callback"]);
    const defs: any[] = chatTools(business());
    expect(defs.map((d) => d.function.name)).toEqual(["check_availability", "book_appointment", "request_callback"]);
    // The phone-only "channel" field isn't offered to the model.
    expect(JSON.stringify(defs)).not.toContain('"channel"');
  });

  test("a tool the receptionist isn't allowed is refused without touching the calendar", async () => {
    const out: any = await runBookingTool(business({}, { profile: { bookingMode: "message_only" } as any }), "book_appointment", { start: "x" });
    expect(out.error).toContain("request_callback");
  });

  test("history for the model never starts on an orphaned tool answer", () => {
    const rows: StoredMessage[] = [
      { role: "tool", content: "{}", tool_call_id: "1", tool_name: "x" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "", tool_calls: [{ id: "2" }] },
      { role: "tool", content: "{}", tool_call_id: "2", tool_name: "x" },
    ];
    const out = historyForModel(rows);
    expect(out[0]).toEqual({ role: "user", content: "hi" });
    expect(out[1]).toMatchObject({ role: "assistant", content: null, tool_calls: [{ id: "2" }] });
    expect(out[2]).toMatchObject({ role: "tool", tool_call_id: "2" });
  });
});

describe("the tool-call loop (pretend OpenRouter)", () => {
  test("a plain answer needs no tools", async () => {
    const m = pretendModel([say("We're open 8 to 5.")]);
    const r = await runTurn({ client: business(), system: "SYS", history: [], text: "when are you open?", fetch: m.fn });
    expect(r.reply).toBe("We're open 8 to 5.");
    expect(r.rows.map((x) => x.role)).toEqual(["user", "assistant"]);
    expect(m.calls[0].model).toBeTruthy();
    expect(m.calls[0].tools.length).toBe(3);
    expect(m.calls[0].messages.at(-1)).toEqual({ role: "user", content: "when are you open?" });
  });

  test("it checks times, books, and the booking is the outcome", async () => {
    const seen: any[] = [];
    const m = pretendModel([
      callTool("c1", "check_availability", { date: "2026-12-01" }),
      callTool("c2", "book_appointment", { start: "2026-12-01T09:00:00+10:00", name: "Sam Lee", phone: "0412345678", service: "Blocked drain" }),
      say("You're booked for Tuesday at 9am."),
    ]);
    const r = await runTurn({
      client: business(),
      system: "SYS",
      history: [],
      text: "book me in",
      fetch: m.fn,
      tools: async (_c, name, args) => {
        seen.push([name, args]);
        return name === "check_availability" ? { slots: [{ start: "2026-12-01T09:00:00+10:00", time: "9am" }] } : { booked: true, when: "Tuesday at 9am" };
      },
    });
    expect(seen.map((s) => s[0])).toEqual(["check_availability", "book_appointment"]);
    expect(r.outcome).toBe("booked");
    expect(r.name).toBe("Sam Lee");
    expect(r.rows.map((x) => x.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);
    // The model saw its own tool results on the next round.
    const last = m.calls[2].messages;
    expect(last.filter((x: any) => x.role === "tool").length).toBe(2);
    expect(last.find((x: any) => x.role === "tool" && x.tool_call_id === "c1").content).toContain("9am");
    expect(r.reply).toBe("You're booked for Tuesday at 9am.");
  });

  test("taking a message is the 'callback' outcome, and a booking outranks it", async () => {
    const m = pretendModel([callTool("c1", "request_callback", { name: "Jo", phone: "0400", reason: "quote" }), say("Done.")]);
    const r = await runTurn({ client: business(), system: "S", history: [], text: "call me", fetch: m.fn, tools: async () => ({ saved: true }) });
    expect(r.outcome).toBe("callback");
  });

  test("bad tool arguments reach the tool as an empty object, which asks for what's missing", async () => {
    const m = pretendModel([{ role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "book_appointment", arguments: "{oops" } }] }, say("What's your name?")]);
    let got: any;
    await runTurn({ client: business(), system: "S", history: [], text: "book", fetch: m.fn, tools: async (_c, _n, a) => ((got = a), { booked: false, reason: "Ask for their name" }) });
    expect(got).toEqual({});
  });

  test("a model that never stops calling tools is cut off", async () => {
    const script = Array.from({ length: 10 }, (_, i) => callTool(`c${i}`, "check_availability", { date: "2026-12-01" }));
    const m = pretendModel(script);
    const r = await runTurn({ client: business(), system: "S", history: [], text: "x", fetch: m.fn, tools: async () => ({ slots: [] }) });
    expect(m.calls.length).toBe(CHAT_LIMITS.modelCalls);
    expect(r.reply).toBe(BUSY_REPLY);
  });

  test("if the model fails after a booking was made, the turn is still kept", async () => {
    const m = pretendModel([callTool("c1", "book_appointment", { name: "A" }), "fail"]);
    const r = await runTurn({ client: business(), system: "S", history: [], text: "x", fetch: m.fn, tools: async () => ({ booked: true, when: "soon" }) });
    expect(r.outcome).toBe("booked");
    expect(r.reply).toBe(BUSY_REPLY);
    expect(r.rows.map((x) => x.role)).toEqual(["user", "assistant", "tool", "assistant"]);
  });

  test("if the model fails before anything happened, nothing is kept", async () => {
    const m = pretendModel(["fail"]);
    await expect(runTurn({ client: business(), system: "S", history: [], text: "x", fetch: m.fn })).rejects.toThrow();
  });

  test("earlier turns, tool results included, go back to the model", async () => {
    const history: StoredMessage[] = [
      { role: "user", content: "times tomorrow?" },
      { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "check_availability", arguments: "{}" } }] },
      { role: "tool", content: '{"slots":[{"start":"2026-12-01T09:00:00+10:00"}]}', tool_call_id: "c1", tool_name: "check_availability" },
      { role: "assistant", content: "9am is free." },
    ];
    const m = pretendModel([say("ok")]);
    await runTurn({ client: business(), system: "S", history, text: "9am please", fetch: m.fn });
    const sent = m.calls[0].messages;
    expect(sent.map((x: any) => x.role)).toEqual(["system", "user", "assistant", "tool", "assistant", "user"]);
    expect(sent[3].content).toContain("2026-12-01T09:00:00+10:00");
  });
});

describe("the public endpoint", () => {
  test("another path is not ours", async () => {
    expect(await webchatPublic(post({}), "/api/other", deps())).toBeNull();
  });

  test("an unknown public id is a plain 404 with no CORS headers", async () => {
    const res = await webchatPublic(post({}, { origin: "https://x.com" }, "nope_nope_nope_nope_nope"), "/api/webchat/nope_nope_nope_nope_nope/message", deps());
    expect(res!.status).toBe(404);
    expect(res!.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("CORS: any website when none are listed", async () => {
    const m = pretendModel([say("Hello!")]);
    const res = await webchatPublic(post({ conversationId: ID, message: "hi" }, { origin: "https://random.com" }), PATH, deps({ fetch: m.fn }));
    expect(res!.status).toBe(200);
    expect(res!.headers.get("access-control-allow-origin")).toBe("https://random.com");
    expect((await res!.json()).reply).toBe("Hello!");
  });

  test("CORS: only the listed websites, and preflight answers the same way", async () => {
    const d = deps({ settings: { domains: ["example.com"] } });
    const ok = await webchatPublic(new Request("https://app.example.com" + PATH, { method: "OPTIONS", headers: { origin: "https://www.example.com" } }), PATH, d);
    expect(ok!.status).toBe(204);
    expect(ok!.headers.get("access-control-allow-origin")).toBe("https://www.example.com");
    expect(ok!.headers.get("access-control-allow-methods")).toContain("POST");

    const no = await webchatPublic(new Request("https://app.example.com" + PATH, { method: "OPTIONS", headers: { origin: "https://evil.io" } }), PATH, d);
    expect(no!.status).toBe(403);
    expect(no!.headers.get("access-control-allow-origin")).toBeNull();

    const m = pretendModel([say("x")]);
    const blocked = await webchatPublic(post({ conversationId: ID, message: "hi" }, { origin: "https://evil.io" }), PATH, deps({ settings: { domains: ["example.com"] }, fetch: m.fn }));
    expect(blocked!.status).toBe(403);
    expect(m.calls.length).toBe(0);

    // The dashboard's own origin (the live preview) always works.
    const own = await webchatPublic(post({ conversationId: ID, message: "hi" }, { origin: "https://app.example.com" }), PATH, deps({ settings: { domains: ["example.com"] }, fetch: pretendModel([say("y")]).fn }));
    expect(own!.status).toBe(200);
  });

  test("off, or no OpenRouter key: nothing is answered", async () => {
    const m = pretendModel([say("x")]);
    const off = await webchatPublic(post({ conversationId: ID, message: "hi" }), PATH, deps({ settings: { enabled: false }, fetch: m.fn }));
    expect(off!.status).toBe(404);
    expect((await off!.json()).reason).toBe("off");

    delete process.env.OPENROUTER_API_KEY;
    try {
      const none = await webchatPublic(post({ conversationId: ID, message: "hi" }), PATH, deps({ fetch: m.fn }));
      expect(none!.status).toBe(503);
      expect((await none!.json()).reason).toBe("no_key");
      const cfg = await webchatPublic(new Request("https://app.example.com/api/webchat/pub_0123456789abcdef/config"), "/api/webchat/pub_0123456789abcdef/config", deps());
      expect(cfg!.status).toBe(503);
    } finally {
      process.env.OPENROUTER_API_KEY = "test-key";
    }
    expect(m.calls.length).toBe(0);
  });

  test("a suspended agency or paused business is unavailable", async () => {
    const res = await webchatPublic(post({ conversationId: ID, message: "hi" }), PATH, deps({ halted: async () => true }));
    expect(res!.status).toBe(404);
  });

  test("config gives the widget its name, greeting and brand", async () => {
    const res = await webchatPublic(new Request("https://app.example.com/api/webchat/pub_0123456789abcdef/config", { headers: { origin: "https://x.com" } }), "/api/webchat/pub_0123456789abcdef/config", deps());
    const body = await res!.json();
    expect(body).toMatchObject({ name: "Mia", businessName: "Alpha Plumbing", color: "#ff0000", logo: "/brand/abc" });
    expect(body.greeting).toContain("Mia");
  });

  test("bad requests: not JSON, bad conversation id, empty or over-long message", async () => {
    const d = () => deps({ fetch: pretendModel([say("x")]).fn });
    expect((await webchatPublic(post("{nope"), PATH, d()))!.status).toBe(400);
    expect((await webchatPublic(post({ conversationId: "abc", message: "hi" }), PATH, d()))!.status).toBe(400);
    expect((await webchatPublic(post({ conversationId: ID, message: "   " }), PATH, d()))!.status).toBe(400);
    expect((await webchatPublic(post({ conversationId: ID, message: "<b></b>" }), PATH, d()))!.status).toBe(400);
    expect((await webchatPublic(post({ conversationId: ID, message: "x".repeat(CHAT_LIMITS.messageChars + 1) }), PATH, d()))!.status).toBe(413);
    expect((await webchatPublic(post({ conversationId: ID, message: "x".repeat(CHAT_LIMITS.bodyBytes + 1) }), PATH, d()))!.status).toBe(413);
  });

  test("HTML is stripped before the model or the transcript sees it", async () => {
    const m = pretendModel([say("ok")]);
    const d = deps({ fetch: m.fn });
    await webchatPublic(post({ conversationId: ID, message: "hello <img src=x onerror=alert(1)> there" }), PATH, d);
    expect(m.calls[0].messages.at(-1).content).toBe("hello there");
    expect(d.store.rows.get(ID)![0].content).toBe("hello there");
  });

  test("rate limit per IP", async () => {
    const d = deps({ fetch: (async () => new Response(JSON.stringify({ choices: [{ message: say("ok") }] }))) as any });
    d.limits.ip = createLimiter(3, 60_000);
    const send = (n: number) => webchatPublic(post({ conversationId: crypto.randomUUID(), message: `m${n}` }, { "x-forwarded-for": "9.9.9.9" }), PATH, d);
    for (let i = 0; i < 3; i++) expect((await send(i))!.status).toBe(200);
    const limited = await send(4);
    expect(limited!.status).toBe(429);
    expect(Number(limited!.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another visitor is unaffected.
    const other = await webchatPublic(post({ conversationId: crypto.randomUUID(), message: "hi" }, { "x-forwarded-for": "8.8.8.8" }), PATH, d);
    expect(other!.status).toBe(200);
  });

  test("rate limit per conversation", async () => {
    const d = deps({ fetch: (async () => new Response(JSON.stringify({ choices: [{ message: say("ok") }] }))) as any });
    d.limits.conversation = createLimiter(2, 60_000);
    const send = (ip: string) => webchatPublic(post({ conversationId: ID, message: "hi" }, { "x-forwarded-for": ip }), PATH, d);
    expect((await send("1.1.1.1"))!.status).toBe(200);
    expect((await send("2.2.2.2"))!.status).toBe(200);
    expect((await send("3.3.3.3"))!.status).toBe(429);
  });

  test("a long chat is stopped", async () => {
    const d = deps({ fetch: pretendModel([say("x")]).fn });
    d.store.rows.set(ID, Array.from({ length: CHAT_LIMITS.userMessages }, () => ({ role: "user", content: "hi" }) as StoredMessage));
    const res = await webchatPublic(post({ conversationId: ID, message: "more" }), PATH, d);
    expect(res!.status).toBe(429);
    expect((await res!.json()).reason).toBe("long");
  });

  test("another business's conversation id is refused", async () => {
    const d = deps({ fetch: pretendModel([say("x")]).fn });
    d.store.owner.set(ID, "some-other-client");
    expect((await webchatPublic(post({ conversationId: ID, message: "hi" }), PATH, d))!.status).toBe(400);
  });

  test("a model failure is a 502 with a friendly message, and nothing is stored", async () => {
    const d = deps({ fetch: pretendModel(["fail"]).fn });
    const res = await webchatPublic(post({ conversationId: ID, message: "hi" }), PATH, d);
    expect(res!.status).toBe(502);
    expect((await res!.json()).error).toBe(BUSY_REPLY);
    expect(d.store.rows.get(ID)).toBeUndefined();
  });

  test("a conversation continues across messages, and the outcome is saved", async () => {
    const m = pretendModel([say("What's your name?"), callTool("c1", "request_callback", { name: "Jo", phone: "0400" }), say("Passed on.")]);
    const d = deps({ fetch: m.fn, tools: async () => ({ saved: true }) });
    await webchatPublic(post({ conversationId: ID, message: "hi" }), PATH, d);
    const res = await webchatPublic(post({ conversationId: ID, message: "Jo, 0400, please call me" }), PATH, d);
    expect((await res!.json()).reply).toBe("Passed on.");
    expect(m.calls[1].messages.filter((x: any) => x.role === "user").length).toBe(2);
    expect(d.store.notes.at(-1)).toMatchObject({ outcome: "callback", name: "Jo" });
  });
});

describe("storage", () => {
  const orgId = crypto.randomUUID();
  const a = business();
  const b = business();
  let ready = true;

  beforeAll(async () => {
    try {
      // The server's own runner (what it does on start): a fresh dev database has no clients table
      // yet, and on one that's up to date this applies nothing.
      await migrate();
      await sql`insert into orgs (id, name) values (${orgId}, 'webchat test')`;
      await insertClient(orgId, a);
      await insertClient(orgId, b);
    } catch (err) {
      ready = false;
      console.error("storage tests need the dev database:", (err as Error).message);
    }
    // bun's default hook timeout is 5s. migrate() takes a database-wide advisory lock that other test runs, the dev
    // server and other agents also take, so under load it can wait longer than that; a timed-out hook skips every
    // test in this block (the "345 tests, 1 fail" release failure), so give it room.
  }, 120_000);
  afterAll(async () => {
    await sql`delete from clients where org_id = ${orgId}`.catch(() => {});
    await sql`delete from orgs where id = ${orgId}`.catch(() => {});
  }, 30_000);

  test("settings are made once per receptionist, off, with an unguessable id", async () => {
    expect(ready).toBe(true);
    const s = await ensureWebchat(a.id);
    expect(s.enabled).toBe(false);
    expect(s.publicId).not.toContain(a.id);
    expect((await ensureWebchat(a.id)).publicId).toBe(s.publicId);
    expect((await ensureWebchat(b.id)).publicId).not.toBe(s.publicId);
  });

  test("saving switches it on and cleans the website list", async () => {
    const saved = await saveWebchat(a.id, { enabled: true, domains: "https://www.alpha.com.au/x\nalpha.com.au, shop.alpha.com.au", greeting: "G'day from <b>Alpha</b>" });
    expect(saved.domains).toEqual(["alpha.com.au", "shop.alpha.com.au"]);
    const found = await findByPublicId(saved.publicId);
    expect(found!.settings).toMatchObject({ enabled: true, domains: ["alpha.com.au", "shop.alpha.com.au"], greeting: "G'day from Alpha" });
    expect(found!.client.id).toBe(a.id);
    expect(found!.client.settings.businessName).toBe("Alpha Plumbing");
    expect(found!.orgId).toBe(orgId);
    // A partial save leaves the rest alone.
    await saveWebchat(a.id, { enabled: false });
    expect((await findByPublicId(saved.publicId))!.settings.domains).toEqual(["alpha.com.au", "shop.alpha.com.au"]);
    expect(await findByPublicId("not-a-real-id-not-a-real-id")).toBeNull();
    expect(await findByPublicId("../../etc")).toBeNull();
  });

  test("conversations and messages are kept, listed and shown as a transcript", async () => {
    const conv = crypto.randomUUID();
    expect(await dbStore.open(a.id, conv, "alpha.com.au")).toBe("mine");
    expect(await dbStore.open(a.id, conv, "alpha.com.au")).toBe("mine");
    // Someone else's id can't be used from another business.
    expect(await dbStore.open(b.id, conv, "other.com")).toBe("other");

    await dbStore.saveTurn(conv, [{ role: "user", content: "Can I book Tuesday?" }, { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "check_availability", arguments: "{}" } }] }, { role: "tool", content: '{"slots":[]}', tool_call_id: "c1", tool_name: "check_availability" }, { role: "assistant", content: "Tuesday 9am is free." }], {});
    await dbStore.saveTurn(conv, [{ role: "user", content: "Book it" }, { role: "tool", content: '{"booked":true,"when":"Tuesday at 9am"}', tool_call_id: "c2", tool_name: "book_appointment" }, { role: "assistant", content: "Done!" }], { outcome: "booked", name: "Sam Lee" });
    // A later message-only turn can't downgrade a booking.
    await dbStore.saveTurn(conv, [{ role: "user", content: "thanks" }, { role: "assistant", content: "Welcome" }], { outcome: "callback" });

    const h = await dbStore.history(conv);
    expect(h.userMessages).toBe(3);
    expect(h.rows.map((r) => r.role)).toEqual(["user", "assistant", "tool", "assistant", "user", "tool", "assistant", "user", "assistant"]);
    expect(h.rows[1].tool_calls).toEqual([{ id: "c1", type: "function", function: { name: "check_availability", arguments: "{}" } }]);
    expect(h.rows[2].tool_call_id).toBe("c1");

    const list = await listChats(a.id);
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ id: conv, outcome: "booked", visitorName: "Sam Lee", origin: "alpha.com.au", messageCount: 6, preview: "Can I book Tuesday?" });
    expect(await listChats(b.id)).toEqual([]);

    const t = await chatTranscript(a.id, conv);
    expect(t!.lines.map((l) => l.role)).toEqual(["user", "event", "assistant", "user", "event", "assistant", "user", "assistant"]);
    expect(t!.lines[4].text).toBe("Booked: Tuesday at 9am");
    // Another business can't read it.
    expect(await chatTranscript(b.id, conv)).toBeNull();
    expect(await chatTranscript(a.id, "not-a-uuid")).toBeNull();
  });

  test("an empty conversation isn't listed, and deleting the receptionist removes its chats", async () => {
    const conv = crypto.randomUUID();
    await dbStore.open(b.id, conv, "x.com");
    expect(await listChats(b.id)).toEqual([]);
    await dbStore.saveTurn(conv, [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }], {});
    expect((await listChats(b.id)).length).toBe(1);
    await sql`delete from clients where id = ${b.id}`;
    const [left] = await sql`select count(*)::int as n from webchat_conversations where client_id = ${b.id}`;
    expect(left.n).toBe(0);
    const [msgs] = await sql`select count(*)::int as n from webchat_messages where conversation_id = ${conv}`;
    expect(msgs.n).toBe(0);
  });
});
