import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Business } from "../src/lib/shared";
import type { Ctx } from "./accounts";
import { sql } from "./db";
import { LlmError, llmConfigured } from "./llm";
import { ValidationError, type KnowledgeEntry } from "./prompt";
import { seal, unseal } from "./secrets";
import { getClient, orgOfClient } from "./store";
import { readOnlyView } from "./supportChanges";
import { enterOrg } from "./telnyx";
import type { ClientAccess, RouteArgs } from "./routes/http";
import { BUSY_REPLY, CHAT_LIMITS, bookingToolFor, chatGreeting, chatInstructions, cleanVisitorText, createLimiter, dbStore, ensureWebchat, liveDeps, runTurn, type ChatStore } from "./webchat";

// Telegram: the third channel of the chatbot, next to the website chat and texts. Each business pastes
// the token of its own bot (made with @BotFather); we check it (getMe), keep it sealed, and point the
// bot's webhook at POST /hooks/telegram/<clientId> with a secret that Telegram sends back in the
// X-Telegram-Bot-Api-Secret-Token header on every update. A message goes to the same brain as the
// website chat and texts (server/webchat.ts runTurn), the reply goes back with sendMessage, and the
// conversation is kept with the other chats (origin "telegram"). Works the same on every voice path:
// nothing here touches Telnyx, Vapi or Twilio.
//
// Signed in:  GET /api/telegram/<clientId> | PUT { token } (connect) | DELETE (disconnect)
// Telegram:   POST /hooks/telegram/<clientId>

export const TG_LIMITS = {
  threadHours: 24, // after a day of quiet, the next message starts a new conversation
  chatPerHour: 30, // messages answered per Telegram chat
  businessPerHour: 300,
  textChars: 1_000,
} as const;

const API = "https://api.telegram.org";
const TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,80}$/;
const NON_TEXT_REPLY = "I can only read text for now. Please type your message.";
const GROUP_TYPES = new Set(["group", "supergroup"]);

export class TelegramError extends Error {}

type Call = (token: string, method: string, body?: Record<string, unknown>) => Promise<any>;

/** One call to Telegram's Bot API. Throws TelegramError with Telegram's own description when it says no. */
export function telegramCall(f: typeof fetch = fetch): Call {
  return async (token, method, body = {}) => {
    let res: Response;
    try {
      res = await f(`${API}/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new TelegramError("Couldn't reach Telegram. Try again in a moment.");
    }
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new TelegramError(String(data?.description ?? `Telegram answered ${res.status}`).slice(0, 200));
    return data.result;
  };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();
const secretOk = (given: string | null, hash: string): boolean => {
  const a = sha256(given ?? "");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};

// ---- Storage -------------------------------------------------------------------------------

export type TelegramBot = { clientId: string; token: string; botId: number; username: string; botName: string; secretHash: string };

export async function botOf(clientId: string): Promise<TelegramBot | null> {
  const [r] = await sql`select * from telegram_bots where client_id = ${clientId}`;
  if (!r) return null;
  return { clientId, token: unseal(r.token_sealed), botId: Number(r.bot_id), username: r.username, botName: r.bot_name, secretHash: r.secret_hash };
}

export const webhookUrl = (base: string, clientId: string) => `${base.replace(/\/$/, "")}/hooks/telegram/${clientId}`;

export type TelegramDeps = {
  /** Calls Telegram. */
  call: Call;
  /** The model's fetch (tests). */
  fetch?: typeof fetch;
  find(clientId: string): Promise<{ client: Business; orgId: string } | null>;
  halted(clientId: string, orgId: string): Promise<boolean>;
  knowledge(clientId: string): Promise<KnowledgeEntry[]>;
  greeting(client: Business): Promise<string>;
  store: ChatStore;
  limits: { chat: ReturnType<typeof createLimiter>; business: ReturnType<typeof createLimiter> };
  publicUrl: () => string;
  /** Answer before returning (tests) rather than after Telegram has its 200. */
  wait?: boolean;
};

export const liveTelegramDeps: TelegramDeps = {
  call: (token, method, body) => telegramCall()(token, method, body),
  find: async (clientId) => {
    const client = await getClient(clientId);
    const orgId = client ? await orgOfClient(clientId) : null;
    return client && orgId ? { client, orgId } : null;
  },
  halted: liveDeps.halted,
  knowledge: liveDeps.knowledge,
  greeting: async (client) => chatGreeting(client.settings, (await ensureWebchat(client.id)).greeting),
  store: dbStore,
  limits: { chat: createLimiter(TG_LIMITS.chatPerHour, 60 * 60_000), business: createLimiter(TG_LIMITS.businessPerHour, 60 * 60_000) },
  publicUrl: () => "",
};

// ---- Connect and disconnect ----------------------------------------------------------------------

export type TelegramState = {
  keyConfigured: boolean;
  connected: boolean;
  username: string;
  botName: string;
  link: string;
  /** This server has a public https address Telegram can post to. */
  reachable: boolean;
  canEdit: boolean;
  chats: number;
};

export async function connectBot(clientId: string, rawToken: unknown, deps: TelegramDeps): Promise<TelegramBot> {
  const token = String(rawToken ?? "").trim();
  if (!TOKEN.test(token)) throw new ValidationError("That doesn't look like a bot token. Copy it from @BotFather: it looks like 123456789:ABC-def...");
  const base = deps.publicUrl();
  if (!/^https:\/\//i.test(base)) throw new ValidationError("Telegram only talks to https addresses, and this server doesn't have one yet. Set the server's public address first.");

  let me: any;
  try {
    me = await deps.call(token, "getMe");
  } catch (err) {
    throw new ValidationError(err instanceof TelegramError && /unauthorized|not found/i.test(err.message) ? "Telegram doesn't accept that token. Check you copied all of it from @BotFather." : (err as Error).message);
  }
  if (!me?.is_bot || !me?.id || !me?.username) throw new ValidationError("That token isn't for a bot.");
  const [other] = await sql`select client_id from telegram_bots where bot_id = ${me.id} and client_id <> ${clientId}`;
  if (other) throw new ValidationError("That bot is already connected to another business. Make a new bot with @BotFather for this one.");

  // Seal first, so a missing MAILBOX_KEY fails before Telegram is changed.
  const sealed = seal(token);
  const secret = randomBytes(32).toString("base64url");
  try {
    await deps.call(token, "setWebhook", { url: webhookUrl(base, clientId), secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true });
  } catch (err) {
    throw new ValidationError(`Telegram wouldn't set the webhook: ${(err as Error).message}`);
  }
  // A different bot replaced: stop the old one posting here.
  const old = await botOf(clientId).catch(() => null);
  if (old && old.botId !== Number(me.id)) await deps.call(old.token, "deleteWebhook", { drop_pending_updates: true }).catch(() => {});
  const secretHash = sha256(secret).toString("hex");
  await sql`
    insert into telegram_bots (client_id, token_sealed, bot_id, username, bot_name, secret_hash, connected_at)
    values (${clientId}, ${sealed}, ${me.id}, ${String(me.username)}, ${String(me.first_name ?? "").slice(0, 80)}, ${secretHash}, now())
    on conflict (client_id) do update set token_sealed = excluded.token_sealed, bot_id = excluded.bot_id, username = excluded.username,
      bot_name = excluded.bot_name, secret_hash = excluded.secret_hash, connected_at = now()`;
  return { clientId, token, botId: Number(me.id), username: String(me.username), botName: String(me.first_name ?? ""), secretHash };
}

export async function disconnectBot(clientId: string, deps: TelegramDeps): Promise<void> {
  const bot = await botOf(clientId).catch(() => null);
  if (bot) await deps.call(bot.token, "deleteWebhook", { drop_pending_updates: true }).catch((err) => console.error(`[telegram ${clientId}] deleteWebhook`, (err as Error).message));
  await sql`delete from telegram_threads where client_id = ${clientId}`;
  await sql`delete from telegram_bots where client_id = ${clientId}`;
}

export async function stateFor(clientId: string, canEdit: boolean, deps: TelegramDeps): Promise<TelegramState> {
  const [r] = await sql`select username, bot_name from telegram_bots where client_id = ${clientId}`;
  const [n] = await sql`select count(*)::int as n from webchat_conversations where client_id = ${clientId} and origin = 'telegram' and message_count > 0`;
  return {
    keyConfigured: await llmConfigured(),
    connected: Boolean(r),
    username: r?.username ?? "",
    botName: r?.bot_name ?? "",
    link: r ? `https://t.me/${r.username}` : "",
    reachable: /^https:\/\//i.test(deps.publicUrl()),
    canEdit,
    chats: n?.n ?? 0,
  };
}

// ---- Answering an update -------------------------------------------------------------------------

export type Outcome = "replied" | "greeted" | "ignored" | "duplicate" | "non_text" | "handoff";

const cleanName = (s: string) => cleanVisitorText(s.replace(/[\r\n]+/g, " "), 60);
const nameOf = (u: any): string => cleanName([u?.first_name, u?.last_name].filter(Boolean).join(" ")) || (u?.username ? `@${cleanName(String(u.username))}` : "") || "Telegram user";

/** Is this group message for the bot: it names @bot, replies to the bot, or is a /command addressed to it? */
function addressedToBot(m: any, bot: TelegramBot): boolean {
  const text: string = m.text ?? "";
  const tag = `@${bot.username}`.toLowerCase();
  for (const e of m.entities ?? []) {
    if ((e.type === "mention" || e.type === "bot_command") && text.slice(e.offset, e.offset + e.length).toLowerCase().includes(tag)) return true;
  }
  return m.reply_to_message?.from?.id === bot.botId;
}

/** True the first time this update id is seen (Telegram retries until it gets a 2xx). */
async function firstSight(clientId: string, updateId: unknown): Promise<boolean> {
  if (typeof updateId !== "number") return true;
  const r = await sql`insert into sms_seen (message_id) values (${`tg:${clientId}:${updateId}`}) on conflict do nothing returning message_id`;
  if (Math.random() < 0.02) await sql`delete from sms_seen where at < now() - interval '3 days'`.catch(() => {});
  return r.length > 0;
}

/** The conversation this chat is in: the open one, or a new one after a quiet day. */
async function threadFor(clientId: string, chatId: number, contactKey: string, who: string, store: ChatStore): Promise<string> {
  const [t] = await sql`select conversation_id, last_at from telegram_threads where client_id = ${clientId} and chat_id = ${chatId}`;
  if (t && Date.now() - new Date(t.last_at).getTime() < TG_LIMITS.threadHours * 3_600_000) return t.conversation_id;
  const id = randomUUID();
  await store.open(clientId, id, "telegram");
  await sql`update webchat_conversations set contact_key = ${contactKey}, visitor_name = ${who.slice(0, 80)} where id = ${id}`;
  await sql`
    insert into telegram_threads (client_id, chat_id, conversation_id, last_at) values (${clientId}, ${chatId}, ${id}, now())
    on conflict (client_id, chat_id) do update set conversation_id = excluded.conversation_id, last_at = now()`;
  return id;
}

/** One update Telegram posted for business `clientId`. */
export async function handleUpdate(clientId: string, update: any, deps: TelegramDeps): Promise<Outcome> {
  const m = update?.message;
  if (!m || typeof m !== "object") return "ignored";
  const found = await deps.find(clientId);
  const bot = found ? await botOf(clientId) : null;
  if (!found || !bot) return "ignored";
  const { client, orgId } = found;
  const chatId = Number(m.chat?.id);
  if (!Number.isFinite(chatId) || !m.from || m.from.is_bot) return "ignored";
  const isGroup = GROUP_TYPES.has(m.chat?.type);
  if (m.chat?.type !== "private" && !isGroup) return "ignored";
  if (!(await firstSight(clientId, update.update_id))) return "duplicate";

  const send = (text: string) =>
    deps.call(bot.token, "sendMessage", { chat_id: chatId, text, ...(isGroup && m.message_id ? { reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } } : {}) });
  const quietly = async (text: string) => {
    try {
      await send(text);
    } catch (err) {
      console.error(`[telegram ${clientId}] sendMessage`, (err as Error).message);
    }
  };

  // Groups: only when the bot is mentioned. Private chats: always.
  const typed = typeof m.text === "string" ? m.text : "";
  if (isGroup && (!typed || !addressedToBot(m, bot))) return "ignored";
  if (await deps.halted(clientId, orgId)) return "ignored";
  if (!deps.limits.chat.take(`${clientId}:${chatId}`).ok || !deps.limits.business.take(clientId).ok) return "ignored";

  if (!typed) {
    await quietly(NON_TEXT_REPLY);
    return "non_text";
  }
  // Take the @mention out so the model reads the question, not its own name.
  const mention = new RegExp(`@${bot.username}\\b`, "gi");
  const command = typed.match(/^\/(\w+)(?:@(\w+))?(?:\s|$)/);
  if (command && command[2] && command[2].toLowerCase() !== bot.username.toLowerCase()) return "ignored";
  if (command && (command[1] === "start" || command[1] === "help")) {
    await quietly(await deps.greeting(client));
    return "greeted";
  }
  const sender = nameOf(m.from);
  const clean = cleanVisitorText(typed.replace(mention, " "), 100_000).slice(0, TG_LIMITS.textChars);
  if (!clean) return "ignored";
  if (!(await llmConfigured(orgId))) {
    console.error(`[telegram ${clientId}] a message came in but no OpenRouter key is set`);
    return "ignored";
  }

  enterOrg(orgId);
  const who = isGroup ? cleanName(String(m.chat?.title ?? "")) || "Telegram group" : sender;
  const conversationId = await threadFor(clientId, chatId, `t:${isGroup ? chatId : m.from.id}`, who, deps.store);
  const past = await deps.store.history(conversationId);
  if (past.userMessages >= CHAT_LIMITS.userMessages) {
    await quietly("Thanks for your messages. The team will follow up with you. If it's urgent, please call us.");
    return "handoff";
  }

  let reply: string;
  let rows = [] as Awaited<ReturnType<typeof runTurn>>["rows"];
  let note: { outcome?: "booked" | "callback"; name?: string } = {};
  try {
    const turn = await runTurn({
      client,
      system: chatInstructions(client, await deps.knowledge(clientId), await deps.greeting(client), undefined, { kind: "telegram", name: who }),
      history: past.rows,
      text: isGroup ? `${sender}: ${clean}` : clean,
      fetch: deps.fetch,
      tools: bookingToolFor("telegram"),
      orgId,
      title: "Telegram chat",
    });
    reply = turn.reply;
    rows = turn.rows;
    note = { outcome: turn.outcome, name: turn.name };
  } catch (err) {
    if (!(err instanceof LlmError)) console.error(`[telegram ${clientId}]`, err);
    reply = BUSY_REPLY;
  }
  if (rows.length) {
    await deps.store.saveTurn(conversationId, rows, note);
    await sql`update telegram_threads set last_at = now() where client_id = ${clientId} and chat_id = ${chatId}`;
  }
  await quietly(reply);
  return "replied";
}

// ---- The webhook ---------------------------------------------------------------------------------------

const ok = () => new Response("ok", { status: 200 });
const notFound = () => new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });

/** POST /hooks/telegram/<clientId>: Telegram's update, with our secret in X-Telegram-Bot-Api-Secret-Token. */
export async function telegramHook(req: Request, clientId: string, deps: TelegramDeps = liveTelegramDeps): Promise<Response> {
  const [r] = await sql`select secret_hash from telegram_bots where client_id = ${clientId}`;
  if (!r) return notFound();
  if (!secretOk(req.headers.get("x-telegram-bot-api-secret-token"), r.secret_hash)) return new Response("Bad secret", { status: 403 });
  const raw = await req.text();
  if (raw.length > 200_000) return new Response("Too large", { status: 413 });
  let update: any;
  try {
    update = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  // Answered after Telegram has its 2xx: a model call takes longer than a webhook is given.
  const job = handleUpdate(clientId, update, deps).catch((err) => console.error(`[telegram ${clientId}]`, (err as Error).message));
  if (deps.wait) await job;
  return ok();
}

// ---- The dashboard's routes ----------------------------------------------------------------------------

const jsonBody = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export type TelegramAdminDeps = {
  clientAccessFor: (ctx: Ctx, orgId: string, id: string) => Promise<{ client: Business; orgId: string; access: ClientAccess } | null>;
  telegram: TelegramDeps;
};

/** /api/telegram/<clientId> for signed-in people: GET the state, PUT { token } to connect, DELETE to disconnect. */
export async function telegramAdmin(args: RouteArgs, deps: TelegramAdminDeps): Promise<Response | null> {
  const m = args.path.match(/^\/api\/telegram\/([a-f0-9-]{36})$/);
  if (!m) return null;
  const found = await deps.clientAccessFor(args.ctx, args.orgId, m[1]);
  if (!found) return jsonBody({ error: "That business isn't shared with you." }, 404);
  const { client, orgId, access } = found;
  if (orgId !== args.orgId) enterOrg(orgId);
  const canEdit = access !== "viewer" && !readOnlyView(args.ctx);
  const d = { ...deps.telegram, publicUrl: () => deps.telegram.publicUrl() || args.appUrl };
  if (args.method === "GET") return jsonBody(await stateFor(client.id, canEdit, d));
  if (args.method !== "PUT" && args.method !== "DELETE") return jsonBody({ error: "Not found" }, 404);
  if (!canEdit) return jsonBody({ error: "Your access to this business is view-only. Ask a manager to change it." }, 403);
  if (args.method === "PUT") {
    const input = await args.req.json().catch(() => ({}));
    await connectBot(client.id, input?.token, d);
  } else {
    await disconnectBot(client.id, d);
  }
  return jsonBody(await stateFor(client.id, canEdit, d));
}
