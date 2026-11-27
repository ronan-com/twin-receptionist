// The Telegram channel: connect (getMe, setWebhook), the secret header, an inbound message answered by the
// same brain, /start, non-text, groups, disconnect, and how the chats show in the Inbox and Contacts.
// Telegram and OpenRouter are pretended (no network). Uses the scratch database:  DATABASE_URL=... bun test server/telegram.test.ts
process.env.MAILBOX_KEY ||= Buffer.alloc(32, 5).toString("base64");
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { migrate, sql } from "./db";
import { workspaceMoreRoutes } from "./routes/workspaceMore";
import { insertClient } from "./store";
import { TG_LIMITS, connectBot, disconnectBot, handleUpdate, stateFor, telegramCall, telegramHook, type TelegramDeps } from "./telegram";
import { createLimiter, dbStore } from "./webchat";

const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: true, from: "08:00", to: "17:00" }])) as any;
const orgId = crypto.randomUUID();
const now = new Date().toISOString();
const TOKEN = "123456789:AAEhBP0av28QPxlwkrCyvg-0123456789abc";
const BOT = { id: 123456789, is_bot: true, first_name: "Alpha Plumbing Bot", username: "alpha_plumbing_bot" };
const mkClient = (over: Partial<Business["settings"]> = {}): Business => ({
  id: crypto.randomUUID(),
  assistantId: "demo-assistant",
  settings: { ...blankSettings(), businessName: "Alpha Plumbing", receptionistName: "Mia", timezone: "Australia/Brisbane", hours, services: ["Blocked drain"], ...over },
  instructions: "",
  phoneNumbers: [],
  booking: { provider: "builtin", token: "t", minutes: 30, enabled: true, createdAt: now } as Business["booking"],
  createdAt: now,
  updatedAt: now,
});
const client = mkClient();
const env = ["OPENROUTER_API_KEY"] as const;
const savedEnv = Object.fromEntries(env.map((k) => [k, process.env[k]]));
let ready = true;
beforeAll(async () => {
  try {
    await migrate();
    await sql`insert into orgs (id, name) values (${orgId}, 'telegram test')`;
    await insertClient(orgId, client);
  } catch (err) {
    ready = false;
    console.warn("[telegram.test] no database, skipping:", (err as Error).message);
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
  if (ready) {
    await sql`delete from telegram_bots where client_id = ${client.id}`;
    await sql`delete from telegram_threads where client_id = ${client.id}`;
    await sql`delete from sms_seen`;
    await sql`delete from contact_notes where client_id = ${client.id}`;
    await sql`delete from webchat_conversations where client_id = ${client.id}`;
  }
});

type Sent = { method: string; token: string; body: any };
/** A pretend api.telegram.org. */
function pretendTelegram(over: Record<string, (body: any) => { status?: number; body: unknown }> = {}) {
  const sent: Sent[] = [];
  const fn = (async (url: string, init: any) => {
    const m = String(url).match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/);
    if (!m) throw new Error(`unexpected address ${url}`);
    const body = JSON.parse(init.body);
    sent.push({ method: m[2], token: m[1], body });
    const custom = over[m[2]]?.(body);
    if (custom) return new Response(JSON.stringify(custom.body), { status: custom.status ?? 200 });
    if (m[2] === "getMe") return new Response(JSON.stringify({ ok: true, result: BOT }));
    return new Response(JSON.stringify({ ok: true, result: true }));
  }) as unknown as typeof fetch;
  return { fn, sent, of: (method: string) => sent.filter((s) => s.method === method) };
}

function pretendModel(...replies: string[]) {
  const calls: any[] = [];
  const fn = (async (_u: any, init: any) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: replies.shift() ?? "ok" } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function deps(tg: ReturnType<typeof pretendTelegram>, over: Partial<TelegramDeps> = {}, c: Business = client): TelegramDeps {
  return {
    call: telegramCall(tg.fn),
    find: async (id) => (id === c.id ? { client: c, orgId } : null),
    halted: async () => false,
    knowledge: async () => [],
    greeting: async () => "Hi! I'm Mia, the virtual receptionist for Alpha Plumbing. How can I help today?",
    store: dbStore,
    limits: { chat: createLimiter(TG_LIMITS.chatPerHour, 3_600_000), business: createLimiter(TG_LIMITS.businessPerHour, 3_600_000) },
    publicUrl: () => "https://app.example.com",
    wait: true,
    ...over,
  };
}

let updateId = 1000;
const privateMsg = (text: string | undefined, from: any = { id: 777001, is_bot: false, first_name: "Sam", last_name: "Lee", username: "samlee" }, extra: any = {}) => ({
  update_id: ++updateId,
  message: { message_id: updateId, from, chat: { id: from.id, type: "private" }, ...(text === undefined ? {} : { text }), ...extra },
});
const groupMsg = (text: string, entities: any[] = [], extra: any = {}) => ({
  update_id: ++updateId,
  message: { message_id: updateId, from: { id: 777002, is_bot: false, first_name: "Pat" }, chat: { id: -100123456, type: "supergroup", title: "Street group" }, text, entities, ...extra },
});

describe("connecting", () => {
  test("checks the token with getMe, sets the webhook with a secret, keeps the token sealed, shows the bot", async () => {
    if (!ready) return;
    const tg = pretendTelegram();
    const bot = await connectBot(client.id, `  ${TOKEN} `, deps(tg));
    expect(bot.username).toBe("alpha_plumbing_bot");
    expect(tg.sent.map((s) => s.method)).toEqual(["getMe", "setWebhook"]);
    const hook = tg.of("setWebhook")[0];
    expect(hook.token).toBe(TOKEN);
    expect(hook.body.url).toBe(`https://app.example.com/hooks/telegram/${client.id}`);
    expect(hook.body.secret_token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(hook.body.allowed_updates).toEqual(["message"]);
    const [row] = await sql`select * from telegram_bots where client_id = ${client.id}`;
    expect(row.token_sealed.startsWith("v1.")).toBe(true);
    expect(row.token_sealed).not.toContain(TOKEN);
    expect(JSON.stringify(row)).not.toContain(hook.body.secret_token);
    const state = await stateFor(client.id, true, deps(tg));
    expect(state).toMatchObject({ connected: true, username: "alpha_plumbing_bot", link: "https://t.me/alpha_plumbing_bot", reachable: true });
  });

  test("refuses a token that isn't one, one Telegram rejects, and an address Telegram can't use", async () => {
    if (!ready) return;
    const tg = pretendTelegram();
    await expect(connectBot(client.id, "hello", deps(tg))).rejects.toThrow(/bot token/);
    await expect(connectBot(client.id, TOKEN, deps(tg, { publicUrl: () => "http://localhost:3000" }))).rejects.toThrow(/https/);
    const bad = pretendTelegram({ getMe: () => ({ status: 401, body: { ok: false, error_code: 401, description: "Unauthorized" } }) });
    await expect(connectBot(client.id, TOKEN, deps(bad))).rejects.toThrow(/doesn't accept that token/);
    const noHook = pretendTelegram({ setWebhook: () => ({ status: 400, body: { ok: false, description: "Bad Request: bad webhook" } }) });
    await expect(connectBot(client.id, TOKEN, deps(noHook))).rejects.toThrow(/wouldn't set the webhook/);
    expect(await sql`select 1 from telegram_bots where client_id = ${client.id}`).toHaveLength(0);
  });

  test("a bot belongs to one business", async () => {
    if (!ready) return;
    const other = mkClient();
    await insertClient(orgId, other);
    await connectBot(other.id, TOKEN, deps(pretendTelegram(), {}, other));
    await expect(connectBot(client.id, TOKEN, deps(pretendTelegram()))).rejects.toThrow(/already connected/);
    await sql`delete from clients where id = ${other.id}`;
  });

  test("disconnecting deletes the webhook and the token", async () => {
    if (!ready) return;
    const tg = pretendTelegram();
    await connectBot(client.id, TOKEN, deps(tg));
    await disconnectBot(client.id, deps(tg));
    expect(tg.of("deleteWebhook")).toHaveLength(1);
    expect(tg.of("deleteWebhook")[0].token).toBe(TOKEN);
    expect(await sql`select 1 from telegram_bots where client_id = ${client.id}`).toHaveLength(0);
    expect((await stateFor(client.id, true, deps(tg))).connected).toBe(false);
  });
});

describe("the webhook", () => {
  const post = (secret: string | null, update: unknown) =>
    new Request(`https://app.example.com/hooks/telegram/${client.id}`, { method: "POST", headers: { "content-type": "application/json", ...(secret === null ? {} : { "x-telegram-bot-api-secret-token": secret }) }, body: JSON.stringify(update) });

  test("every update must carry the secret we gave Telegram", async () => {
    if (!ready) return;
    const tg = pretendTelegram();
    const m = pretendModel("We open at 8.");
    const d = deps(tg, { fetch: m.fn });
    await connectBot(client.id, TOKEN, d);
    const secret = tg.of("setWebhook")[0].body.secret_token as string;
    const update = privateMsg("What time do you open?");
    expect((await telegramHook(post(null, update), client.id, d)).status).toBe(403);
    expect((await telegramHook(post("wrong", update), client.id, d)).status).toBe(403);
    expect((await telegramHook(post(secret.slice(0, -1), update), client.id, d)).status).toBe(403);
    expect(tg.of("sendMessage")).toHaveLength(0);
    expect((await telegramHook(post(secret, update), client.id, d)).status).toBe(200);
    expect(tg.of("sendMessage")).toHaveLength(1);
    // a business with no bot looks like any other missing page
    expect((await telegramHook(post(secret, update), crypto.randomUUID(), d)).status).toBe(404);
    // after disconnecting, the old secret opens nothing
    await disconnectBot(client.id, d);
    expect((await telegramHook(post(secret, privateMsg("hi")), client.id, d)).status).toBe(404);
  });
});

describe("answering", () => {
  async function connected() {
    const tg = pretendTelegram();
    const d = deps(tg);
    await connectBot(client.id, TOKEN, d);
    tg.sent.length = 0;
    return { tg, d };
  }

  test("a message goes to the same brain and the reply goes back with sendMessage; kept as a Telegram chat with the sender's name", async () => {
    if (!ready) return;
    const { tg, d } = await connected();
    const m = pretendModel("We open at 8am.", "Yes, Saturdays too.");
    expect(await handleUpdate(client.id, privateMsg("What time do you open?"), { ...d, fetch: m.fn })).toBe("replied");
    expect(tg.of("sendMessage")[0]).toMatchObject({ token: TOKEN, body: { chat_id: 777001, text: "We open at 8am." } });
    const system = JSON.stringify(m.calls[0].messages[0]);
    expect(system).toContain("Telegram");
    expect(system).toContain("Sam Lee");
    expect(m.calls[0].messages.at(-1)).toEqual({ role: "user", content: "What time do you open?" });
    expect(m.calls[0].tools.map((t: any) => t.function.name)).toContain("request_callback");
    // the next message continues the same conversation
    await handleUpdate(client.id, privateMsg("and Saturday?"), { ...d, fetch: m.fn });
    expect(m.calls[1].messages.length).toBeGreaterThan(m.calls[0].messages.length);
    const convs = await sql`select * from webchat_conversations where client_id = ${client.id}`;
    expect(convs).toHaveLength(1);
    expect(convs[0]).toMatchObject({ origin: "telegram", visitor_name: "Sam Lee", contact_key: "t:777001", message_count: 4 });
  });

  test("/start sends the chatbot greeting and the model isn't called", async () => {
    if (!ready) return;
    const { tg, d } = await connected();
    const m = pretendModel();
    expect(await handleUpdate(client.id, privateMsg("/start"), { ...d, fetch: m.fn })).toBe("greeted");
    expect(tg.of("sendMessage")[0].body.text).toBe("Hi! I'm Mia, the virtual receptionist for Alpha Plumbing. How can I help today?");
    expect(await handleUpdate(client.id, privateMsg("/start@alpha_plumbing_bot hello"), { ...d, fetch: m.fn })).toBe("greeted");
    expect(m.calls).toHaveLength(0);
  });

  test("a paused receptionist greets with its pause message", async () => {
    if (!ready) return;
    const paused = mkClient({ paused: { at: now, message: "We're away until Monday." } });
    const { chatGreeting } = await import("./webchat");
    expect(chatGreeting(paused.settings)).toBe("We're away until Monday.");
    const { tg, d } = await connected();
    await handleUpdate(client.id, privateMsg("/start"), { ...d, greeting: async () => chatGreeting(paused.settings) });
    expect(tg.of("sendMessage")[0].body.text).toBe("We're away until Monday.");
  });

  test("a halted business (agency suspended or paused from the console) isn't answered", async () => {
    if (!ready) return;
    const { tg, d } = await connected();
    expect(await handleUpdate(client.id, privateMsg("hello"), { ...d, halted: async () => true })).toBe("ignored");
    expect(tg.of("sendMessage")).toHaveLength(0);
  });

  test("anything that isn't text gets a polite note", async () => {
    if (!ready) return;
    const { tg, d } = await connected();
    expect(await handleUpdate(client.id, privateMsg(undefined, undefined, { photo: [{ file_id: "x" }] }), d)).toBe("non_text");
    expect(tg.of("sendMessage")[0].body.text).toBe("I can only read text for now. Please type your message.");
    // no update at all (an edited message, a join) is ignored
    expect(await handleUpdate(client.id, { update_id: 1, edited_message: {} }, d)).toBe("ignored");
  });

  test("groups: ignored unless the bot is mentioned (or replied to); the mention is taken out", async () => {
    if (!ready) return;
    const { tg, d } = await connected();
    const m = pretendModel("We open at 8.");
    expect(await handleUpdate(client.id, groupMsg("anyone know a plumber?"), { ...d, fetch: m.fn })).toBe("ignored");
    expect(await handleUpdate(client.id, groupMsg("@someone_else hi", [{ type: "mention", offset: 0, length: 13 }]), { ...d, fetch: m.fn })).toBe("ignored");
    expect(await handleUpdate(client.id, groupMsg("photo", [], { photo: [{}] }), { ...d, fetch: m.fn })).toBe("ignored");
    expect(tg.of("sendMessage")).toHaveLength(0);
    const text = "@Alpha_Plumbing_Bot when do you open?";
    expect(await handleUpdate(client.id, groupMsg(text, [{ type: "mention", offset: 0, length: 19 }]), { ...d, fetch: m.fn })).toBe("replied");
    expect(tg.of("sendMessage")[0].body).toMatchObject({ chat_id: -100123456, text: "We open at 8.", reply_parameters: { message_id: expect.any(Number) } });
    expect(m.calls[0].messages.at(-1).content).toBe("Pat: when do you open?");
    expect(await handleUpdate(client.id, groupMsg("and Sunday?", [], { reply_to_message: { from: { id: BOT.id } } }), { ...d, fetch: m.fn })).toBe("replied");
  });

  test("a message from another bot, a repeat of the same update, and a flood are not answered", async () => {
    if (!ready) return;
    const { tg, d } = await connected();
    const m = pretendModel("a", "b", "c", "d");
    expect(await handleUpdate(client.id, privateMsg("hi", { id: 5, is_bot: true, first_name: "Bot" }), { ...d, fetch: m.fn })).toBe("ignored");
    const u = privateMsg("hello");
    expect(await handleUpdate(client.id, u, { ...d, fetch: m.fn })).toBe("replied");
    expect(await handleUpdate(client.id, u, { ...d, fetch: m.fn })).toBe("duplicate");
    const tight = { ...d, fetch: m.fn, limits: { chat: createLimiter(2, 3_600_000), business: createLimiter(100, 3_600_000) } };
    tg.sent.length = 0;
    const outcomes = [];
    for (let i = 0; i < 4; i++) outcomes.push(await handleUpdate(client.id, privateMsg(`msg ${i}`), tight));
    expect(outcomes).toEqual(["replied", "replied", "ignored", "ignored"]);
    expect(tg.of("sendMessage")).toHaveLength(2);
  });

  test("when the model fails the customer still gets an apology", async () => {
    if (!ready) return;
    const { tg, d } = await connected();
    const broken = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await handleUpdate(client.id, privateMsg("hello"), { ...d, fetch: broken });
    expect(tg.of("sendMessage")[0].body.text).toMatch(/trouble right now/);
  });
});

describe("Inbox and Contacts", () => {
  const route = async (rest: string) => {
    const args: any = { req: new Request("https://x/"), url: new URL("https://x/api/workspace/x/inbox"), path: "", method: "GET", ctx: {}, orgId, appUrl: "", client, clientOrgId: orgId, access: "staff", rest };
    return (await (await workspaceMoreRoutes(args))!.json()) as any;
  };

  test("Telegram chats show in the Inbox as Telegram with the sender's name, and one Telegram user is one contact", async () => {
    if (!ready) return;
    const tg = pretendTelegram();
    const d = deps(tg);
    await connectBot(client.id, TOKEN, d);
    const m = pretendModel("a", "b", "c");
    await handleUpdate(client.id, privateMsg("hello there"), { ...d, fetch: m.fn });
    // a quiet day later the same person starts a new conversation: still the same contact
    await sql`update telegram_threads set last_at = now() - interval '2 days' where client_id = ${client.id}`;
    await handleUpdate(client.id, privateMsg("me again"), { ...d, fetch: m.fn });
    await handleUpdate(client.id, privateMsg("hi", { id: 888002, is_bot: false, first_name: "Kim" }), { ...d, fetch: m.fn });

    const inbox = await route("/inbox");
    const items = inbox.items.filter((i: any) => i.kind === "telegram");
    expect(items).toHaveLength(3);
    expect(items.map((i: any) => i.who).sort()).toEqual(["Kim", "Sam Lee", "Sam Lee"]);

    const { contacts } = await route("/contacts");
    const sam = contacts.find((c: any) => c.id === "t:777001");
    expect(sam).toMatchObject({ name: "Sam Lee", counts: { chats: 2 } });
    expect(contacts.filter((c: any) => c.name === "Sam Lee")).toHaveLength(1);
    expect(contacts.find((c: any) => c.id === "t:888002").name).toBe("Kim");
    const one = await route("/contacts/t%3A777001");
    expect(one.timeline.map((t: any) => t.kind)).toEqual(["telegram", "telegram"]);
  });
});
