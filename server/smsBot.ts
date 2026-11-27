import { randomUUID } from "node:crypto";
import type { Business } from "../src/lib/shared";
import { sql } from "./db";
import { LlmError, llmConfigured } from "./llm";
import type { KnowledgeEntry } from "./prompt";
import { contactKey, isOptedOut, sendSms, setOptOut } from "./sms";
import { smsSecretOk, smsHookUrl, twilioSignatureOk } from "./smsWebhook";
import { getClient, orgOfClient } from "./store";
import { enterOrg } from "./telnyx";
import { twilioCredsFor } from "./twilio";
import { BUSY_REPLY, CHAT_LIMITS, bookingToolFor, chatGreeting, chatInstructions, cleanVisitorText, createLimiter, dbStore, liveDeps, runTurn, type ChatStore } from "./webchat";

// The text chatbot. A customer texts a receptionist's number; the provider (Telnyx or Twilio)
// posts the text to our server (server/smsWebhook.ts addresses); the same brain as the website
// chat answers it (server/webchat.ts runTurn: same script, knowledge, booking tools, OpenRouter via
// server/llm.ts); the reply goes out through server/sms.ts. Conversations are kept with the website
// chats (origin "sms"), so the dashboard shows them together.

export const SMS_LIMITS = {
  threadHours: 24, // after a day of quiet, the next text starts a new conversation
  contactPerHour: 20, // texts answered per customer number
  businessPerHour: 300,
  replyChars: 320,
  textChars: 600, // one incoming text, kept
} as const;

// The words every phone carrier treats as "stop texting me" / "start again" (CTIA). Matched on
// the whole text, any case, ignoring punctuation.
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]);
const START_WORDS = new Set(["START", "UNSTOP", "SUBSCRIBE"]);
const word = (t: string) => t.trim().replace(/[^\p{L}\p{N}]+/gu, "").toUpperCase();
export const isStop = (t: string) => STOP_WORDS.has(word(t));
export const isStart = (t: string) => START_WORDS.has(word(t));

export type InboundText = { via: "telnyx" | "twilio"; id: string; from: string; to: string; text: string };
export type Outcome = "replied" | "stopped" | "restarted" | "duplicate" | "ignored" | "handoff";

export type BotDeps = {
  find(clientId: string): Promise<{ client: Business; orgId: string } | null>;
  halted(clientId: string, orgId: string): Promise<boolean>;
  knowledge(clientId: string): Promise<KnowledgeEntry[]>;
  store: ChatStore;
  send(client: Business, o: { from: string; to: string; text: string }): Promise<void>;
  fetch?: typeof fetch;
  limits: { contact: ReturnType<typeof createLimiter>; business: ReturnType<typeof createLimiter> };
  /** Run the answer before returning (tests) rather than after the provider has its 200. */
  wait?: boolean;
};

export const liveBotDeps: BotDeps = {
  find: async (clientId) => {
    const client = await getClient(clientId);
    const orgId = client ? await orgOfClient(clientId) : null;
    return client && orgId ? { client, orgId } : null;
  },
  halted: liveDeps.halted,
  knowledge: liveDeps.knowledge,
  store: dbStore,
  send: (client, o) => sendSms(client, o),
  limits: { contact: createLimiter(SMS_LIMITS.contactPerHour, 60 * 60_000), business: createLimiter(SMS_LIMITS.businessPerHour, 60 * 60_000) },
};

/** The conversation this customer's text belongs to: the open one, or a new one after a quiet day. */
async function threadFor(clientId: string, contact: string, store: ChatStore): Promise<string> {
  const key = contactKey(contact);
  const [t] = await sql`select conversation_id, last_at from sms_threads where client_id = ${clientId} and contact = ${key}`;
  if (t && Date.now() - new Date(t.last_at).getTime() < SMS_LIMITS.threadHours * 3_600_000) return t.conversation_id;
  const id = randomUUID();
  await store.open(clientId, id, "sms");
  await sql`
    insert into sms_threads (client_id, contact, conversation_id, last_at) values (${clientId}, ${key}, ${id}, now())
    on conflict (client_id, contact) do update set conversation_id = excluded.conversation_id, last_at = now()`;
  return id;
}

/** True the first time this provider message id is seen (providers retry a webhook until they get a 2xx). */
async function firstSight(via: string, id: string): Promise<boolean> {
  if (!id) return true;
  const r = await sql`insert into sms_seen (message_id) values (${`${via}:${id}`}) on conflict do nothing returning message_id`;
  if (Math.random() < 0.02) await sql`delete from sms_seen where at < now() - interval '3 days'`.catch(() => {});
  return r.length > 0;
}

/** One incoming text to receptionist `clientId`: honour STOP/START, else answer it. */
export async function handleText(clientId: string, msg: InboundText, deps: BotDeps = liveBotDeps): Promise<Outcome> {
  const found = await deps.find(clientId);
  if (!found) return "ignored";
  const { client, orgId } = found;
  // Only texts to this receptionist's own numbers.
  const mine = (client.phoneNumbers ?? []).some((n) => contactKey(n) === contactKey(msg.to));
  if (!mine || contactKey(msg.from).length < 6) return "ignored";
  if (!(await firstSight(msg.via, msg.id))) return "duplicate";

  // STOP and START are the carrier's rules. The provider sends its own confirmation, so we don't.
  if (isStop(msg.text)) {
    await setOptOut(client.id, msg.from, true);
    return "stopped";
  }
  if (isStart(msg.text)) {
    await setOptOut(client.id, msg.from, false);
    return "restarted";
  }
  if (await isOptedOut(client.id, msg.from)) return "ignored";

  const text = cleanVisitorText(msg.text, 100_000).slice(0, SMS_LIMITS.textChars);
  if (!text) return "ignored";
  if (await deps.halted(client.id, orgId)) return "ignored";
  if (!(await llmConfigured(orgId))) {
    console.error(`[sms ${client.id}] a text came in but no OpenRouter key is set`);
    return "ignored";
  }
  if (!deps.limits.contact.take(`${client.id}:${contactKey(msg.from)}`).ok || !deps.limits.business.take(client.id).ok) return "ignored";

  enterOrg(orgId);
  const send = (reply: string) => deps.send(client, { from: msg.to, to: msg.from, text: reply });
  const conversationId = await threadFor(client.id, msg.from, deps.store);
  const past = await deps.store.history(conversationId);
  if (past.userMessages >= CHAT_LIMITS.userMessages) {
    await send("Thanks for your messages. The team will follow up with you. If it's urgent, please call us.");
    return "handoff";
  }

  let reply: string;
  let note: { outcome?: "booked" | "callback"; name?: string } = {};
  let rows = [] as Awaited<ReturnType<typeof runTurn>>["rows"];
  try {
    const turn = await runTurn({
      client,
      system: chatInstructions(client, await deps.knowledge(client.id), chatGreeting(client.settings), undefined, { kind: "sms", contact: msg.from }),
      history: past.rows,
      text,
      fetch: deps.fetch,
      tools: bookingToolFor("sms", msg.from),
      orgId,
      title: "Text messages",
      replyChars: SMS_LIMITS.replyChars,
    });
    reply = turn.reply;
    rows = turn.rows;
    note = { outcome: turn.outcome, name: turn.name };
  } catch (err) {
    if (!(err instanceof LlmError)) console.error(`[sms ${client.id}]`, err);
    reply = BUSY_REPLY;
  }
  // The first answer of a conversation carries the opt-out line (carriers expect it).
  const out = past.userMessages === 0 && !/\bSTOP\b/.test(reply) ? `${reply} Reply STOP to opt out.` : reply;
  if (rows.length) {
    await deps.store.saveTurn(conversationId, rows, note);
    await sql`update sms_threads set last_at = now() where client_id = ${client.id} and contact = ${contactKey(msg.from)}`;
  }
  await send(out);
  return "replied";
}

// ---- The webhooks -------------------------------------------------------------------------

const ok = (body = "", type = "text/plain") => new Response(body, { status: 200, headers: { "Content-Type": type } });
const notFound = () => new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Answers after the provider has its 2xx: a model call takes longer than a webhook is given. */
function answer(clientId: string, msg: InboundText, deps: BotDeps): Promise<unknown> | undefined {
  const job = handleText(clientId, msg, deps).catch((err) => console.error(`[sms ${clientId}]`, (err as Error).message));
  return deps.wait ? job : undefined;
}

/** POST /hooks/sms/telnyx/<clientId>/<secret>: a Telnyx v2 messaging webhook. */
export async function telnyxTextHook(req: Request, clientId: string, secret: string, deps: BotDeps = liveBotDeps): Promise<Response> {
  if (!smsSecretOk(clientId, secret)) return notFound();
  const raw = await req.text();
  if (raw.length > 200_000) return new Response("Too large", { status: 413 });
  let data: any;
  try {
    data = JSON.parse(raw)?.data;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const p = data?.payload;
  // Delivery receipts and our own sent texts come here too; only a text from a customer is answered.
  if (data?.event_type !== "message.received" || p?.direction !== "inbound") return ok();
  const msg: InboundText = {
    via: "telnyx",
    id: String(p?.id ?? data?.id ?? ""),
    from: String(p?.from?.phone_number ?? ""),
    to: String(p?.to?.[0]?.phone_number ?? ""),
    text: String(p?.text ?? ""),
  };
  await answer(clientId, msg, deps);
  return ok();
}

/** The addresses Twilio may have signed: the one we set, and the one this request came to. */
function signedUrls(req: Request, clientId: string): string[] {
  const set = smsHookUrl("twilio", clientId);
  const u = new URL(req.url);
  const proto = (req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "")).split(",")[0].trim();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host).split(",")[0].trim();
  return [...new Set([set, `${proto}://${host}${u.pathname}${u.search}`].filter(Boolean))];
}

/**
 * POST /hooks/sms/twilio/<clientId>/<secret>: Twilio's incoming-message webhook (a form). The address
 * secret is always checked; Twilio's own signature too, whenever the agency connected an Auth Token
 * (an API Key can't check it: it isn't the key Twilio signs with, so the address secret alone guards that case).
 */
export async function twilioTextHook(req: Request, clientId: string, secret: string, deps: BotDeps = liveBotDeps): Promise<Response> {
  if (!smsSecretOk(clientId, secret)) return notFound();
  const raw = await req.text();
  if (raw.length > 100_000) return new Response("Too large", { status: 413 });
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  const orgId = await orgOfClient(clientId);
  if (!orgId) return notFound();
  const creds = await twilioCredsFor(orgId);
  if (!creds) return notFound();
  if (creds.kind === "token") {
    const given = req.headers.get("x-twilio-signature");
    if (!signedUrls(req, clientId).some((u) => twilioSignatureOk(creds.secret, u, params, given))) return new Response("Bad signature", { status: 403 });
  }
  if (params.AccountSid && params.AccountSid !== creds.accountSid) return notFound();
  const msg: InboundText = { via: "twilio", id: params.MessageSid ?? params.SmsSid ?? "", from: params.From ?? "", to: params.To ?? "", text: params.Body ?? "" };
  await answer(clientId, msg, deps);
  return ok(EMPTY_TWIML, "text/xml");
}
