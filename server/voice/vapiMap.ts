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

type VoiceProviderKey = "11labs" | "vapi" | "azure";
type VoiceEntry = Required<Pick<Voice, "accent" | "maker" | "previewUrl">> & Voice & { provider: VoiceProviderKey; voice: string };

const MAKER: Record<VoiceProviderKey, string> = { "11labs": "ElevenLabs", vapi: "Vapi", azure: "Azure" };

/**
 * The clip for a voice: public/voice-previews/<provider>-<voice>.mp3, static files made once:
 * ElevenLabs' public preview_url clips, the samples on Vapi's voice docs (first 11 s), and the
 * Azure ones synthesised with "Hi, thanks for calling. You've reached the front desk. How can I
 * help you today?". All re-encoded to 64 kbps mono mp3. A voice added here needs its clip too
 * (a test checks every listed voice has one).
 */
export const previewPath = (provider: string, voice: string) => `/voice-previews/${provider}-${voice}.mp3`;

const entry = (provider: VoiceProviderKey, voice: string, name: string, gender: "female" | "male", accent: string, label: string, recommended = false): VoiceEntry => ({
  id: `${provider}:${voice}`,
  provider,
  voice,
  name,
  label,
  gender,
  accent,
  maker: MAKER[provider],
  previewUrl: previewPath(provider, voice),
  recommended,
});

// A short, curated list (Nov 2026). ElevenLabs first: the most natural voices Vapi offers,
// with no ElevenLabs account needed (Vapi bills them). The ids are ElevenLabs' stable premade
// voices (api.elevenlabs.io/v1/voices), whose public preview clips are in public/voice-previews.
// ElevenLabs' only Australian premade voice is Charlie, so the Australian women are Azure's
// neural voices (clips made once with the same sentence). Vapi's own voices are the
// lowest-latency option (docs.vapi.ai/providers/voice/vapi-voices; clips from those docs).
// Cartesia isn't listed: its voices need a Cartesia key to preview, and ElevenLabs covers it.
const ENTRIES: VoiceEntry[] = [
  entry("11labs", "IKne3meq5aSn9XLyUdCD", "Charlie", "male", "Australian", "Natural, confident and upbeat", true),
  entry("11labs", "Xb7hH8MSUJpSbSDYk0k2", "Alice", "female", "British", "Clear, warm and professional", true),
  entry("11labs", "EXAVITQu4vr4xnSDxMaL", "Sarah", "female", "American", "Reassuring and confident", true),
  entry("11labs", "JBFqnCBsd6RMkjVDRZzb", "George", "male", "British", "Warm and composed", true),
  entry("11labs", "pFZP5JQG7iQjIQuC4Bku", "Lily", "female", "British", "Smooth and polished"),
  entry("11labs", "onwK4e9ZLuTAKqWW03F9", "Daniel", "male", "British", "Steady and formal"),
  entry("11labs", "cgSgspJ2msm6clMCkdW9", "Jessica", "female", "American", "Bright, warm and friendly", true),
  entry("11labs", "XrExE9yKIg1WjnnlVkGX", "Matilda", "female", "American", "Knowledgeable and upbeat"),
  entry("11labs", "cjVigY5qzO86Huf0OWal", "Eric", "male", "American", "Smooth and trustworthy"),
  entry("11labs", "iP95p4xoKVk53GoZ742B", "Chris", "male", "American", "Down-to-earth and casual"),
  entry("azure", "en-AU-NatashaNeural", "Natasha", "female", "Australian", "Warm and clear (Azure neural)", true),
  entry("azure", "en-AU-FreyaNeural", "Freya", "female", "Australian", "Friendly (Azure neural)"),
  entry("azure", "en-AU-WilliamNeural", "William", "male", "Australian", "Calm and friendly (Azure neural)"),
  entry("vapi", "Clara", "Clara", "female", "American", "Natural and professional, fastest to respond"),
  entry("vapi", "Savannah", "Savannah", "female", "American", "Natural and friendly, fastest to respond"),
  entry("vapi", "Elliot", "Elliot", "male", "Canadian", "Natural and calm, fastest to respond"),
  entry("vapi", "Godfrey", "Godfrey", "male", "American", "Natural and professional, fastest to respond"),
];

/** New Vapi receptionists: Charlie, ElevenLabs' natural Australian voice. */
export const DEFAULT_VAPI_VOICE = ENTRIES[0];

export const vapiVoiceList = (): Voice[] => ENTRIES.map(({ provider: _p, voice: _v, ...v }) => v);

/**
 * The Vapi voice for a picker id. "azure:...", "vapi:..." and "11labs:<voice id>" (including
 * voices no longer listed, so older receptionists keep theirs) are understood; anything else
 * (an id left over from Telnyx) falls back to the default voice.
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
  /** The business's own MCP server (Streamable HTTP), given to the assistant as a tool. */
  mcp?: { url: string; headerName?: string; headerValue?: string } | null;
  /** Where end-of-call reports go (and the secret they carry); null with no public address. */
  events: { url: string; secret: string } | null;
  /** The returning-caller lookup tool (server/voice/vapiWebhook.ts vapiCallerHook); null when this receptionist doesn't use it. */
  memory: { url: string; secret: string } | null;
  transfer: TransferSpec | null;
  recording: boolean;
  language: "en-AU" | "multi";
  maxMinutes: number;
};

// ---- Speed ------------------------------------------------------------------------------
// What makes a Vapi receptionist answer quickly (field names and ranges checked against
// api.vapi.ai/api-json, Nov 2026). Every assistant gets these on create and on every save,
// so existing receptionists pick them up from "Apply new voice settings" or their next save.

/**
 * The thinking model. gpt-4.1-mini is OpenAI's quick, reliable tool-caller: a much shorter
 * time-to-first-token than gpt-4o/gpt-5 with the same script-following on a front desk.
 * A low temperature keeps answers short and on-script; maxTokens caps a rambling reply
 * (a receptionist line is one or two sentences). VAPI_MODEL_PROVIDER / VAPI_MODEL override it
 * (e.g. groq + llama-3.3-70b-versatile for even faster, slightly less careful replies).
 */
export const FAST_MODEL = {
  provider: process.env.VAPI_MODEL_PROVIDER || "openai",
  model: process.env.VAPI_MODEL || "gpt-4.1-mini",
  temperature: 0.4,
  maxTokens: 250,
};

/**
 * The transcriber. Deepgram nova-3 is its fastest accurate streaming model (and knows
 * Australian English). `endpointing` is how many ms of silence Deepgram waits before it
 * calls a phrase finished: 150 is quick without chopping people mid-sentence (Vapi's
 * smart endpointing below makes the real "they're done" call).
 */
export const fastTranscriber = (language: string) => ({ provider: "deepgram", model: "nova-3", language, endpointing: 150 });

/**
 * When to start talking once the caller pauses.
 *  - waitSeconds: the floor before the receptionist speaks (Vapi's default is 0.4).
 *  - smartEndpointingPlan livekit: a turn-taking model that answers almost at once after a
 *    finished sentence and waits longer after "um, so I was..." (English only). Its wait is
 *    ms = f(probability the caller is still talking); "200 + 1000 * x" is a brisk curve
 *    (Vapi's default "20 + 500 * sqrt(x) + 2500 * x^3" hangs on to longer pauses).
 *  - Other languages ("multi"): transcription endpointing, which waits a short time after
 *    punctuation, a little longer after a number (phone numbers come in chunks), longer with none.
 */
export const startSpeakingPlan = (language: string) =>
  language.startsWith("en")
    ? { waitSeconds: 0.2, smartEndpointingPlan: { provider: "livekit", waitFunction: "200 + 1000 * x" } }
    : { waitSeconds: 0.2, transcriptionEndpointingPlan: { onPunctuationSeconds: 0.1, onNoPunctuationSeconds: 1.0, onNumberSeconds: 0.5 } };

/**
 * When the caller talks over the receptionist: stop after 0.2 s of their voice (numWords 0
 * means use voiceSeconds), and wait 1 s of quiet before carrying on. Vapi's own defaults,
 * stated so a change on their side can't slow us down.
 */
export const STOP_SPEAKING_PLAN = { numWords: 0, voiceSeconds: 0.2, backoffSeconds: 1 };

/**
 * The voice's speed settings, per provider.
 *  - ElevenLabs: eleven_flash_v2_5 is its lowest-latency model (~75 ms); optimizeStreamingLatency
 *    3 (of 0-4) trades a little prosody for speed (4 also turns off text normalisation, which
 *    reads numbers badly); stability/similarity at ElevenLabs' natural-sounding defaults.
 *  - chunkPlan.minCharacters: how much text Vapi gathers before sending it to the voice. Vapi's
 *    default is 30; 10 starts the first words sooner (sentence boundaries still apply).
 *  - Vapi's own voices are the quickest of all and need nothing extra.
 */
export function voiceBody(provider: string, voiceId: string) {
  const chunkPlan = { enabled: true, minCharacters: 10 };
  if (provider === "11labs") return { provider, voiceId, model: "eleven_flash_v2_5", optimizeStreamingLatency: 3, stability: 0.5, similarityBoost: 0.75, chunkPlan };
  return { provider, voiceId, chunkPlan };
}

/**
 * Said only when a booking tool takes longer than 1.5 s (a slow calendar), so a quick answer
 * has no filler and a slow one has no dead air.
 */
export const CALLER_TOOL = "caller_history";
export const TOOL_DELAY_MESSAGE = { type: "request-response-delayed", timingMilliseconds: 1500, content: "Just a moment, I'm checking that for you." };

/** How long Vapi waits for our booking hooks (/hooks/<id>/vapi/...). They answer in well under a second; 8 s caps a stuck calendar. */
export const TOOL_TIMEOUT_SECONDS = 8;

/** What Vapi has no setting for, said honestly in the Calls and Automations screens. */
export const UNMAPPED = {
  silenceLimit: "Vapi doesn't have a setting for ending a call after silence, so that limit isn't applied.",
  // (Checked Nov 2026: Vapi's voicemailDetection is an assistant-level setting for calls it places; there is no equivalent for a transfer it makes, so none is mapped.)
  voicemail: "Vapi can't detect voicemail on a transfer, so a transfer that reaches voicemail isn't pulled back.",
  textBack: "Vapi has no texting of its own. Texts go out from a Twilio mobile number that this receptionist answers: connect Twilio under Connections, then add a Twilio mobile number under Call handling.",
};

export function vapiAssistantBody(b: VapiBuild) {
  const functionTool = (d: BookingToolDef) => ({
    type: "function",
    function: { name: d.name, description: d.description, parameters: { type: "object", properties: d.properties, required: d.required } },
    messages: [TOOL_DELAY_MESSAGE],
    server: { url: `${b.hookBase}/vapi/${d.action}`, timeoutSeconds: TOOL_TIMEOUT_SECONDS, headers: { "X-Twin-Key": b.toolKey } },
  });
  const tools: unknown[] = [{ type: "endCall" }];
  if (b.hookBase) for (const d of BOOKING_TOOL_DEFS) if (b.tools.includes(d.name)) tools.push(functionTool(d));
  if (b.mcp?.url) {
    tools.push({
      type: "mcp",
      server: { url: b.mcp.url, timeoutSeconds: TOOL_TIMEOUT_SECONDS, ...(b.mcp.headerName && b.mcp.headerValue ? { headers: { [b.mcp.headerName]: b.mcp.headerValue } } : {}) },
      metadata: { protocol: "shttp" },
    });
  }
  if (b.memory) {
    tools.push({
      type: "function",
      function: {
        name: CALLER_TOOL,
        description: "Notes about this caller from the business's own records (earlier calls, bookings, callbacks). Use once at the start of the call.",
        parameters: { type: "object", properties: {} },
      },
      server: { url: b.memory.url, timeoutSeconds: 5, headers: { "X-Vapi-Secret": b.memory.secret } },
    });
  }
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
    // The greeting is fixed text spoken the moment the call connects: no model round trip
    // first. (Its audio is cached by the voice provider after the first call.)
    firstMessageMode: "assistant-speaks-first",
    model: { ...FAST_MODEL, messages: [{ role: "system", content: b.script }], tools },
    voice: voiceBody(voice.provider, voice.voiceId),
    transcriber: fastTranscriber(b.language),
    startSpeakingPlan: startSpeakingPlan(b.language),
    stopSpeakingPlan: STOP_SPEAKING_PLAN,
    // No fake office noise on phone calls (Vapi's phone default): it muddies a clear voice.
    backgroundSound: "off",
    maxDurationSeconds: b.maxMinutes * 60,
    artifactPlan: { recordingEnabled: b.recording },
    // Only the end-of-call report comes to our server, and after the call. The phone numbers
    // point straight at this assistant, so there is no assistant-request round trip (nor any
    // other blocking webhook) when a call starts; silence on the line is ended by Vapi's own
    // timeout (silenceTimeoutSeconds is no longer an assistant field, see UNMAPPED).
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
