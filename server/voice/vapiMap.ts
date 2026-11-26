import { createHmac, timingSafeEqual } from "node:crypto";
import { BOOKING_TOOL_DEFS, type BookingToolDef } from "../booking";
import type { Voice } from "../../src/lib/shared";

// Pure mapping from what Twin knows (script, greeting, voice, tools, transfer, recording) to
// what Vapi wants (checked against docs.vapi.ai, Nov 2026). No network here, so it is unit tested.
//
//  script       -> model.messages[0] (system); our {{...}} variables become Vapi's
//  greeting     -> firstMessage
//  voice        -> voice { provider, voiceId }, from the "provider:voice" ids of the picker
//  booking      -> function tools whose server.url is /hooks/<clientId>/vapi/<action>, with X-Twin-Key
//  transfer     -> a transferCall tool with the urgent number as its destination
//  hang up      -> an endCall tool
//  recording    -> artifactPlan.recordingEnabled
//  call limits  -> maxDurationSeconds (Vapi has no idle-timeout setting we map: see UNMAPPED)
//  language     -> transcriber.language (en-AU, or multi)
//  call reports -> server { url, headers X-Vapi-Secret } and serverMessages ["end-of-call-report"]

// ---- Voices ----------------------------------------------------------------------

type VoiceEntry = Voice & { provider: "azure" | "vapi" | "11labs"; voice: string };

// Australian Azure voices come first: they are the only Australian accents on offer that
// need no extra account. Vapi's own voices are American, British, Canadian or Indian.
const ENTRIES: VoiceEntry[] = [
  { id: "azure:en-AU-NatashaNeural", provider: "azure", voice: "en-AU-NatashaNeural", name: "Natasha", label: "Australian, warm and clear", gender: "female", recommended: true },
  { id: "azure:en-AU-WilliamNeural", provider: "azure", voice: "en-AU-WilliamNeural", name: "William", label: "Australian, calm and friendly", gender: "male", recommended: true },
  { id: "azure:en-AU-AnnetteNeural", provider: "azure", voice: "en-AU-AnnetteNeural", name: "Annette", label: "Australian, composed", gender: "female", recommended: true },
  { id: "azure:en-AU-CarlyNeural", provider: "azure", voice: "en-AU-CarlyNeural", name: "Carly", label: "Australian, bright", gender: "female", recommended: true },
  { id: "azure:en-AU-DarrenNeural", provider: "azure", voice: "en-AU-DarrenNeural", name: "Darren", label: "Australian, steady", gender: "male", recommended: true },
  { id: "azure:en-AU-FreyaNeural", provider: "azure", voice: "en-AU-FreyaNeural", name: "Freya", label: "Australian, friendly", gender: "female", recommended: true },
  { id: "azure:en-AU-ElsieNeural", provider: "azure", voice: "en-AU-ElsieNeural", name: "Elsie", label: "Australian, gentle", gender: "female", recommended: false },
  { id: "azure:en-AU-JoanneNeural", provider: "azure", voice: "en-AU-JoanneNeural", name: "Joanne", label: "Australian, professional", gender: "female", recommended: false },
  { id: "azure:en-AU-KenNeural", provider: "azure", voice: "en-AU-KenNeural", name: "Ken", label: "Australian, easygoing", gender: "male", recommended: false },
  { id: "azure:en-AU-KimNeural", provider: "azure", voice: "en-AU-KimNeural", name: "Kim", label: "Australian, upbeat", gender: "female", recommended: false },
  { id: "azure:en-AU-NeilNeural", provider: "azure", voice: "en-AU-NeilNeural", name: "Neil", label: "Australian, relaxed", gender: "male", recommended: false },
  { id: "azure:en-AU-TimNeural", provider: "azure", voice: "en-AU-TimNeural", name: "Tim", label: "Australian, personable", gender: "male", recommended: false },
  { id: "azure:en-AU-TinaNeural", provider: "azure", voice: "en-AU-TinaNeural", name: "Tina", label: "Australian, cheerful", gender: "female", recommended: false },
  // Vapi's own voices (docs.vapi.ai/providers/voice/vapi-voices; the older Spencer, Neha, Harry, Cole, Paige, Hana, Lily and Kylie were retired).
  { id: "vapi:Elliot", provider: "vapi", voice: "Elliot", name: "Elliot", label: "Vapi voice, Canadian accent", gender: "male", recommended: false },
  { id: "vapi:Savannah", provider: "vapi", voice: "Savannah", name: "Savannah", label: "Vapi voice, American accent", gender: "female", recommended: false },
  { id: "vapi:Clara", provider: "vapi", voice: "Clara", name: "Clara", label: "Vapi voice, American accent", gender: "female", recommended: false },
  { id: "vapi:Nico", provider: "vapi", voice: "Nico", name: "Nico", label: "Vapi voice, American accent", gender: "male", recommended: false },
];

export const DEFAULT_VAPI_VOICE = ENTRIES[0];

export const vapiVoiceList = (): Voice[] => ENTRIES.map(({ provider: _p, voice: _v, ...v }) => v);

/**
 * The Vapi voice for a picker id. "azure:...", "vapi:..." and "11labs:<voice id>" (a voice id
 * typed in by hand) are understood; anything else (an id left over from Telnyx) falls back
 * to the default Australian voice.
 */
export function vapiVoice(id: string): { provider: string; voiceId: string } {
  const known = ENTRIES.find((e) => e.id === id);
  if (known) return { provider: known.provider, voiceId: known.voice };
  const m = /^(azure|vapi|11labs):([\w.-]{2,80})$/.exec(id);
  if (m) return { provider: m[1], voiceId: m[2] };
  return { provider: DEFAULT_VAPI_VOICE.provider, voiceId: DEFAULT_VAPI_VOICE.voice };
}

// ---- Script variables ---------------------------------------------------------------

/**
 * Twin's script uses Telnyx's variables. Vapi has its own: the local time is a Liquid
 * expression, the caller's number is {{customer.number}}, and a Vapi assistant only
 * ever has voice calls. {{twin_open_now}} is filled in here (the server refreshes it
 * when the business opens or closes, see server/voice/vapiHours.ts).
 */
export function toVapiScript(text: string, openNow: boolean): string {
  return text
    .replace(/\{\{telnyx_current_time_([A-Za-z0-9_/+-]+)\}\}/g, (_, tz: string) => `{{"now" | date: "%A, %B %d, %Y, %I:%M %p", "${tz}"}}`)
    .replace(/\{\{telnyx_conversation_channel\}\}/g, "phone_call")
    .replace(/\{\{telnyx_end_user_target\}\}/g, "{{customer.number}}")
    .replace(/\{\{twin_open_now\}\}/g, openNow ? "yes" : "no");
}

// ---- The assistant body --------------------------------------------------------------

export type TransferSpec = { description: string; name: string; to: string; takeMessageOnVoicemail: boolean };

export type VapiBuild = {
  name: string;
  /** The whole script (profile script plus the automations' lines), with variables already converted. */
  script: string;
  greeting: string;
  voiceId: string;
  /** Booking tools this receptionist may use now. */
  tools: BookingToolDef["name"][];
  /** `${publicUrl}/hooks/${clientId}`; null when booking isn't live or there's no public address. */
  hookBase: string | null;
  toolKey: string;
  /** Where end-of-call reports go (and the secret they carry); null with no public address. */
  events: { url: string; secret: string } | null;
  transfer: TransferSpec | null;
  recording: boolean;
  language: "en-AU" | "multi";
  maxMinutes: number;
};

const MODEL = { provider: process.env.VAPI_MODEL_PROVIDER || "openai", model: process.env.VAPI_MODEL || "gpt-4o-mini" };

/** What Vapi has no setting for, said honestly in the Calls and Automations screens. */
export const UNMAPPED = {
  silenceLimit: "Vapi doesn't have a setting for ending a call after silence, so that limit isn't applied.",
  voicemail: "Vapi can't detect voicemail on a transfer, so a transfer that reaches voicemail isn't pulled back.",
  textBack: "Vapi has no texting of its own. Texts go out from a Twilio mobile number that this receptionist answers: connect Twilio under Connections, then add a Twilio mobile number under Call handling.",
};

export function vapiAssistantBody(b: VapiBuild) {
  const functionTool = (d: BookingToolDef) => ({
    type: "function",
    function: { name: d.name, description: d.description, parameters: { type: "object", properties: d.properties, required: d.required } },
    server: { url: `${b.hookBase}/vapi/${d.action}`, timeoutSeconds: 10, headers: { "X-Twin-Key": b.toolKey } },
  });
  const tools: unknown[] = [{ type: "endCall" }];
  if (b.hookBase) for (const d of BOOKING_TOOL_DEFS) if (b.tools.includes(d.name)) tools.push(functionTool(d));
  if (b.transfer) {
    tools.push({
      type: "transferCall",
      destinations: [{ type: "number", number: b.transfer.to, description: b.transfer.description, transferPlan: { mode: "blind-transfer" } }],
    });
  }
  const voice = vapiVoice(b.voiceId);
  return {
    name: b.name.slice(0, 40),
    firstMessage: b.greeting,
    firstMessageMode: "assistant-speaks-first",
    model: { ...MODEL, messages: [{ role: "system", content: b.script }], tools },
    voice: { provider: voice.provider, voiceId: voice.voiceId },
    transcriber: { provider: "deepgram", model: "nova-3", language: b.language },
    maxDurationSeconds: b.maxMinutes * 60,
    artifactPlan: { recordingEnabled: b.recording },
    serverMessages: ["end-of-call-report"],
    ...(b.events ? { server: { url: b.events.url, timeoutSeconds: 20, headers: { "X-Vapi-Secret": b.events.secret } } } : {}),
  };
}

// ---- The call report webhook's secret --------------------------------------------------

// Each receptionist's reports carry their own secret, made from the server's key and the
// receptionist's id, so nothing needs storing and one leaked secret opens one receptionist only.
function secretBase(): string {
  const base = process.env.VAPI_WEBHOOK_SECRET || process.env.MAILBOX_KEY || "";
  if (!base) throw new Error("Set VAPI_WEBHOOK_SECRET (or MAILBOX_KEY) so Vapi's call reports can be checked.");
  return base;
}

export const eventsSecret = (clientId: string): string => createHmac("sha256", secretBase()).update(`vapi-events:${clientId}`).digest("base64url");

/** Whether a request from Vapi carries this receptionist's secret (X-Vapi-Secret, or Authorization: Bearer). */
export function secretMatches(headers: Pick<Headers, "get">, clientId: string): boolean {
  let want: string;
  try {
    want = eventsSecret(clientId);
  } catch {
    return false;
  }
  const given = headers.get("x-vapi-secret") ?? (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- Vapi's messages ------------------------------------------------------------------

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

/** The tool calls in a Vapi "tool-calls" message (arguments may arrive as a JSON string). */
export function toolCallsOf(message: any): ToolCall[] {
  const list: any[] = message?.toolCallList ?? message?.toolWithToolCallList?.map((t: any) => t.toolCall) ?? [];
  return list
    .map((t) => {
      let args = t?.function?.arguments ?? {};
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      return { id: String(t?.id ?? ""), name: String(t?.function?.name ?? t?.name ?? ""), args: args as Record<string, unknown> };
    })
    .filter((t) => t.id && t.name);
}

export type CallRecord = {
  id: string;
  assistantId: string;
  channel: "call" | "web";
  from: string | null;
  to: string | null;
  startedAt: string | null;
  endedAt: string | null;
  seconds: number | null;
  status: "completed" | "failed";
  outcome: string | null;
  summary: string | null;
  transcript: { role: "user" | "assistant"; text: string; at: string }[];
  recordingUrl: string | null;
  costUsd: number | null;
  endedReason: string | null;
};

const isoOf = (v: unknown): string | null => {
  const t = typeof v === "number" ? v : Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** The call a Vapi call object or end-of-call-report describes, in the shape of our call_log. */
export function callRecord(message: any, call: any = message?.call ?? {}): CallRecord {
  const artifact = message?.artifact ?? call?.artifact ?? {};
  const startedAt = isoOf(message?.startedAt ?? call?.startedAt ?? call?.createdAt);
  const endedAt = isoOf(message?.endedAt ?? call?.endedAt);
  const reason = String(message?.endedReason ?? call?.endedReason ?? "");
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  const seconds = startedAt && endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - startMs) / 1000)) : Number.isFinite(Number(message?.durationSeconds)) ? Math.round(Number(message.durationSeconds)) : null;

  const raw: any[] = Array.isArray(artifact.messages) ? artifact.messages : [];
  const transcript = raw
    .filter((m) => (m?.role === "user" || m?.role === "bot" || m?.role === "assistant") && String(m?.message ?? m?.content ?? "").trim())
    .map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      text: String(m.message ?? m.content).trim(),
      at: isoOf(m.time) ?? (Number.isFinite(startMs) && Number.isFinite(Number(m.secondsFromStart)) ? new Date(startMs + Number(m.secondsFromStart) * 1000).toISOString() : (startedAt ?? "")),
    }));

  const used = new Set<string>();
  for (const m of raw) for (const t of m?.toolCalls ?? []) if (t?.function?.name) used.add(String(t.function.name));
  const outcome = used.has("book_appointment") ? "booked" : used.has("request_callback") ? "callback_requested" : null;

  const failed = /^(pipeline-error|call\.start\.error|assistant-not-found|assistant-request-failed|twilio-failed|vonage-failed|unknown-error)/.test(reason);
  const recording = artifact.recordingUrl ?? artifact.recording?.mono?.combinedUrl ?? (typeof artifact.recording === "string" ? artifact.recording : null);
  const cost = Number(message?.cost ?? call?.cost);

  return {
    id: String(call?.id ?? message?.call?.id ?? ""),
    assistantId: String(call?.assistantId ?? message?.assistant?.id ?? message?.call?.assistantId ?? ""),
    channel: call?.type === "webCall" ? "web" : "call",
    from: call?.customer?.number ?? message?.customer?.number ?? null,
    to: message?.phoneNumber?.number ?? call?.phoneNumber?.number ?? null,
    startedAt,
    endedAt,
    seconds,
    status: failed ? "failed" : "completed",
    outcome,
    summary: (typeof (message?.analysis?.summary ?? call?.analysis?.summary) === "string" ? String(message?.analysis?.summary ?? call?.analysis?.summary).trim().slice(0, 2000) : "") || (failed ? reason : null),
    transcript,
    recordingUrl: typeof recording === "string" && recording ? recording : null,
    costUsd: Number.isFinite(cost) ? cost : null,
    endedReason: reason || null,
  };
}
