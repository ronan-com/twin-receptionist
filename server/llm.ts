import { sql } from "./db";
import { seal, unseal } from "./secrets";
import { currentOrg } from "./telnyx";

// The one place the app talks to a text AI. Everything that writes or answers in words
// (website chat, texts, email replies, call summaries, website import, the help assistant)
// goes through here, on OpenRouter, whichever phone provider the agency uses. Voice stays
// with Telnyx / Vapi.
//
// The key: the agency's own (saved in Connections, sealed in orgs.openrouter_key), else the
// server's OPENROUTER_API_KEY. The model: OPENROUTER_MODEL, else DEFAULT_CHAT_MODEL.

// (OPENROUTER_BASE_URL is for tests and scratch servers that talk to a pretend OpenRouter; never set in production.)
const OPENROUTER = (process.env.OPENROUTER_BASE_URL ?? "").trim().replace(/\/+$/, "") || "https://openrouter.ai/api/v1";
export const OPENROUTER_URL = `${OPENROUTER}/chat/completions`;
// OpenRouter's current Sonnet (https://openrouter.ai/api/v1/models).
export const DEFAULT_CHAT_MODEL = "anthropic/claude-sonnet-5.5";

export const llmModel = () => (process.env.OPENROUTER_MODEL ?? "").trim() || DEFAULT_CHAT_MODEL;
const envKey = () => (process.env.OPENROUTER_API_KEY ?? "").trim();

export type LlmReason = "no_key" | "unreachable" | "status" | "empty";

/** The AI couldn't answer. `reason` says why; the message never contains the key, the prompt or the provider's body. */
export class LlmError extends Error {
  constructor(
    public reason: LlmReason,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export const NO_KEY_MESSAGE = "The AI isn't set up yet. Add an OpenRouter key under Connections (or set OPENROUTER_API_KEY on the server).";

// ---- Which key -----------------------------------------------------------------------

const cache = new Map<string, { key: string; at: number }>();
export const forgetLlmKey = (orgId: string) => cache.delete(orgId);

/** The agency's own saved OpenRouter key, or "". */
async function savedKey(orgId: string): Promise<string> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < 30_000) return hit.key;
  let key = "";
  try {
    const [o] = await sql`select openrouter_key from orgs where id = ${orgId}`;
    if (o?.openrouter_key) key = unseal(o.openrouter_key).trim();
  } catch {
    key = ""; // an unreadable key is as good as none: fall back to the server's
  }
  cache.set(orgId, { key, at: Date.now() });
  return key;
}

/** The key for this agency (defaults to the work in hand's org): its own, else the server's. "" when neither. */
export async function llmKey(orgId: string | null = currentOrg()): Promise<string> {
  return (orgId ? await savedKey(orgId) : "") || envKey();
}

export const llmConfigured = async (orgId: string | null = currentOrg()) => (await llmKey(orgId)).length > 0;

export async function saveLlmKey(orgId: string, key: string): Promise<void> {
  await sql`update orgs set openrouter_key = ${seal(key)}, openrouter_key_last4 = ${key.slice(-4)}, openrouter_key_at = now() where id = ${orgId}`;
  forgetLlmKey(orgId);
}

export async function clearLlmKey(orgId: string): Promise<void> {
  await sql`update orgs set openrouter_key = null, openrouter_key_last4 = null, openrouter_key_at = null where id = ${orgId}`;
  forgetLlmKey(orgId);
}

export type LlmKeyState = { configured: boolean; source: "own" | "server" | "none"; last4: string; at: string | null };

/** What Connections shows: whether a key is set and whose (never the key itself). */
export async function llmKeyState(orgId: string): Promise<LlmKeyState> {
  const [o] = await sql`select openrouter_key is not null as own, openrouter_key_last4, openrouter_key_at from orgs where id = ${orgId}`;
  if (o?.own) return { configured: true, source: "own", last4: o.openrouter_key_last4 ?? "", at: o.openrouter_key_at ? new Date(o.openrouter_key_at).toISOString() : null };
  return envKey() ? { configured: true, source: "server", last4: "", at: null } : { configured: false, source: "none", last4: "", at: null };
}

/** Pulls a key out of what was pasted (spaces, quotes and a "Bearer " are common), or throws a message a person can act on. */
export function parseOpenRouterKey(input: unknown): string {
  const key = String((input as { key?: unknown } | null)?.key ?? "").trim().replace(/^["']|["']$/g, "").trim().replace(/^bearer\s+/i, "").trim();
  if (!/^sk-or-[A-Za-z0-9_-]{16,200}$/.test(key)) throw new LlmError("status", "That doesn't look like an OpenRouter key. It starts with sk-or- and is on openrouter.ai/keys.");
  return key;
}

// ---- The request ---------------------------------------------------------------------

export type LlmMessage = Record<string, any>;

export type LlmOptions = {
  messages: LlmMessage[];
  tools?: unknown[];
  maxTokens?: number;
  temperature?: number;
  /** Shown in OpenRouter's dashboard ("Website chat", "Call summaries"). */
  title?: string;
  /** Overrides the default model. */
  model?: string;
  /** Whose key to use; defaults to the org of the work in hand. */
  orgId?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Anthropic models behind OpenRouter can cache the long fixed script (the first, system, message) between calls. */
export function withCacheControl(model: string, messages: LlmMessage[]): LlmMessage[] {
  if (!model.startsWith("anthropic/")) return messages;
  return messages.map((m, i) =>
    i === 0 && m.role === "system" && typeof m.content === "string"
      ? { role: "system", content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] }
      : m,
  );
}

async function post(o: LlmOptions, stream: boolean): Promise<Response> {
  const key = await llmKey(o.orgId);
  if (!key) throw new LlmError("no_key", NO_KEY_MESSAGE);
  const model = o.model?.trim() || llmModel();
  const tools = o.tools ?? [];
  let res: Response;
  try {
    res = await (o.fetch ?? fetch)(OPENROUTER_URL, {
      method: "POST",
      signal: o.signal ?? AbortSignal.timeout(o.timeoutMs ?? 45_000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.PUBLIC_URL || "https://openrouter.ai",
        "X-Title": o.title || "AI receptionist",
      },
      body: JSON.stringify({
        model,
        ...(stream ? { stream: true } : {}),
        max_tokens: o.maxTokens ?? 700,
        temperature: o.temperature ?? 0.3,
        messages: withCacheControl(model, o.messages),
        ...(tools.length ? { tools, tool_choice: "auto" } : {}),
      }),
    });
  } catch {
    throw new LlmError("unreachable", "The AI service couldn't be reached.");
  }
  if (!res.ok) {
    // The status only: never the body, the words in it or the key.
    console.error(`[llm] provider answered ${res.status}`);
    throw new LlmError("status", `The AI service answered ${res.status}.`, res.status);
  }
  return res;
}

/** One model turn: the assistant message (content and/or tool_calls). Throws LlmError. */
export async function chatCompletion(o: LlmOptions): Promise<LlmMessage> {
  const res = await post(o, false);
  const data: any = await res.json().catch(() => null);
  const message = data?.choices?.[0]?.message;
  if (!message || typeof message !== "object") throw new LlmError("empty", "The AI service gave no answer.");
  return message;
}

/** The same call, streamed: the raw server-sent-events response for the caller to read. */
export async function chatStream(o: LlmOptions): Promise<Response> {
  const res = await post(o, true);
  if (!res.body) throw new LlmError("empty", "The AI service gave no answer.");
  return res;
}

/** Just the words, for the callers that want a string (summaries, email, website import). */
export async function chatText(o: LlmOptions): Promise<string> {
  const msg = await chatCompletion(o);
  const text = typeof msg.content === "string" ? msg.content : "";
  if (!text) throw new LlmError("empty", "The AI service gave no answer.");
  return text;
}

// ---- Checking a key typed into Connections ---------------------------------------------

/** Asks OpenRouter whether a key works (GET /key). Returns what it knows of the key, or throws a message a person can act on. */
export async function checkOpenRouterKey(key: string, f: typeof fetch = fetch): Promise<{ label: string; limitRemaining: number | null }> {
  let res: Response;
  try {
    res = await f(`${OPENROUTER}/key`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new LlmError("unreachable", "Couldn't reach OpenRouter to check the key. Try again in a moment.");
  }
  if (res.status === 401 || res.status === 403) throw new LlmError("status", "OpenRouter didn't accept that key. Copy it again from openrouter.ai/keys.", res.status);
  if (!res.ok) throw new LlmError("status", `OpenRouter answered ${res.status} when checking the key.`, res.status);
  const j: any = await res.json().catch(() => null);
  const d = j?.data ?? {};
  return { label: String(d.label ?? ""), limitRemaining: typeof d.limit_remaining === "number" ? d.limit_remaining : null };
}

/** Whether any key exists on this install: the server's, or one an agency saved. For the install's own health report. */
export async function llmConfiguredAnywhere(): Promise<boolean> {
  if (envKey()) return true;
  try {
    const [r] = await sql`select count(*)::int as n from orgs where openrouter_key is not null`;
    return (r?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
