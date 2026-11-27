import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import type { Business, EmailPreview } from "../src/lib/shared";
import { automated, decide } from "./email";
import { ValidationError } from "./prompt";
import { telnyx } from "./telnyx";
import { liveBotDeps, SMS_LIMITS } from "./smsBot";
import { BUSY_REPLY, chatGreeting, chatInstructions, runTurn, type StoredMessage } from "./webchat";
import { LlmError } from "./llm";

// A free place to try a receptionist by text and email. Nothing here sends a real
// text or email: texts go through Telnyx's chat API dressed up as an SMS
// conversation (so the receptionist behaves exactly as it would on a real number),
// and emails run through the same drafting step the mailbox connection uses.

// Shown to the receptionist as the texter's number. 0491 570 006 is in the range
// the Australian regulator reserves for fiction, so it can never be a real person.
const PRETEND_MOBILE = "+61491570006";

export async function startTextSim(client: Business): Promise<{ conversationId: string }> {
  const res = await telnyx<{ data?: { id?: string }; id?: string }>("POST", "/ai/conversations", {
    name: `Simulator · ${client.settings.businessName}`,
    metadata: {
      assistant_id: client.assistantId,
      telnyx_conversation_channel: "sms_chat",
      telnyx_end_user_target: PRETEND_MOBILE,
      telnyx_agent_target: client.phoneNumbers?.[0] ?? "simulator",
      twin_simulator: "true",
    },
  });
  const conversationId = res.data?.id ?? res.id;
  if (!conversationId) throw new ValidationError("The test conversation didn't start. Try again.");
  return { conversationId };
}

export async function sendSimText(client: Business, input: unknown): Promise<{ reply: string }> {
  const src = (input ?? {}) as { conversationId?: unknown; text?: unknown };
  const conversationId = String(src.conversationId ?? "");
  const text = String(src.text ?? "").trim().slice(0, 1000);
  if (!/^[A-Za-z0-9-]{8,80}$/.test(conversationId)) throw new ValidationError("Start a new test conversation.");
  if (!text) throw new ValidationError("Type a message first.");

  // Only talk into simulator conversations that belong to this receptionist.
  const convo = await telnyx<{ data?: any }>("GET", `/ai/conversations/${conversationId}`);
  const meta = convo.data?.metadata ?? {};
  if (meta.assistant_id !== client.assistantId || meta.twin_simulator !== "true") {
    throw new ValidationError("Start a new test conversation.");
  }

  const res = await telnyx<{ content?: string }>("POST", `/ai/assistants/${client.assistantId}/chat`, {
    conversation_id: conversationId,
    content: text,
  });
  return { reply: String(res.content ?? "").trim() };
}

export async function previewEmail(client: Business, input: unknown): Promise<EmailPreview> {
  const src = (input ?? {}) as Record<string, unknown>;
  const fromName = String(src.fromName ?? "").trim().slice(0, 80);
  const fromAddress = String(src.fromAddress ?? "").trim().slice(0, 200) || "customer@example.com";
  const subject = String(src.subject ?? "").trim().slice(0, 200);
  const body = String(src.body ?? "").replace(/\r/g, "").trim().slice(0, 4000);
  if (!body) throw new ValidationError("Write the email you want to test.");
  if (!/^[^\s@]+@[^\s@]+$/.test(fromAddress)) throw new ValidationError("That sender address isn't valid.");

  // Build a real email and parse it back, so the drafting step sees exactly what
  // it would see from a mailbox.
  const raw = await new MailComposer({
    from: fromName ? { name: fromName, address: fromAddress } : fromAddress,
    to: "reception@example.com",
    subject,
    text: body,
    date: new Date(),
  })
    .compile()
    .build();
  const mail = await simpleParser(raw);

  const skip = automated(mail, "reception@example.com");
  if (skip) return { reply: false, reason: skip, body: "" };
  return decide(client, mail);
}

// ---- Texts for Vapi receptionists ----------------------------------------------------------------------
// A Vapi receptionist doesn't use Telnyx's chat: its texts (Twilio) are answered by our own text AI (OpenRouter,
// server/smsBot.ts). The practice chat uses that same brain, with the same script and knowledge, kept in memory
// only. Nothing is texted, saved, or booked.

const OWN_TTL_MS = 60 * 60_000;
const own = new Map<string, { clientId: string; rows: StoredMessage[]; at: number }>();
const prune = () => {
  const cutoff = Date.now() - OWN_TTL_MS;
  for (const [k, v] of own) if (v.at < cutoff) own.delete(k);
  while (own.size > 200) own.delete(own.keys().next().value as string);
};

export async function startOwnTextSim(_client: Business): Promise<{ conversationId: string }> {
  prune();
  const conversationId = `own-${crypto.randomUUID()}`;
  own.set(conversationId, { clientId: _client.id, rows: [], at: Date.now() });
  return { conversationId };
}

export async function sendOwnSimText(client: Business, orgId: string, input: unknown, deps: { fetch?: typeof fetch; knowledge?: typeof liveBotDeps.knowledge } = {}): Promise<{ reply: string }> {
  const src = (input ?? {}) as { conversationId?: unknown; text?: unknown };
  const id = String(src.conversationId ?? "");
  const text = String(src.text ?? "").trim().slice(0, SMS_LIMITS.textChars);
  const convo = own.get(id);
  if (!convo || convo.clientId !== client.id) throw new ValidationError("Start a new test conversation.");
  if (!text) throw new ValidationError("Type a message first.");
  convo.at = Date.now();
  try {
    const turn = await runTurn({
      client,
      system: chatInstructions(client, await (deps.knowledge ?? liveBotDeps.knowledge)(client.id), chatGreeting(client.settings), undefined, { kind: "sms", contact: "+61491570006" }),
      history: convo.rows,
      text,
      // A practice chat never books anything.
      tools: async () => ({ ok: true, note: "This is only a practice chat, so nothing was booked or saved." }),
      orgId,
      fetch: deps.fetch,
      title: "Text practice",
      replyChars: SMS_LIMITS.replyChars,
    });
    convo.rows.push(...turn.rows);
    return { reply: turn.reply };
  } catch (err) {
    if (err instanceof LlmError) return { reply: BUSY_REPLY };
    throw err;
  }
}
