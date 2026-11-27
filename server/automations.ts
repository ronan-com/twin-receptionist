import { timingSafeEqual } from "node:crypto";
import type { Business, Hours, Settings } from "../src/lib/shared";
import { DAYS, withoutRecordingLine } from "../src/lib/shared";
import { publicUrl } from "./booking";
import { sql } from "./db";
import { recordIncident, resolveIncidents } from "./incidents";
import { ValidationError, greetingOf } from "./prompt";
import { isDemo } from "./sandbox";
import { getClient, orgOfClient } from "./store";
import { currentOrg, runAsOrg } from "./telnyx";
import { sendSms } from "./sms";
import { twilioSmsNumber } from "./twilio";
import { providerOfClient } from "./voice/config";
import { voiceFor } from "./voice";
import { UNMAPPED } from "./voice/vapiMap";
import type { FollowupSettings } from "../src/lib/followups";
import { defaultFollowups, followupStatuses, normaliseFollowups } from "./followups";
import { textingState } from "./texting";
import { BLOCKED_GREETING, defaultSpam, normaliseSpam, spamLines, spamStatus, spamUsesHook, spamVariables, type SpamSettings } from "./spam";

// Per-receptionist automations (area T): transfer to a person, text-back after a
// call, call recording with a notice, language, call limits and after-hours mode.
//
// Each one maps onto what the phone provider's AI assistant actually supports
// (checked against the Telnyx OpenAPI spec, Nov 2026):
//  - transfer:   a `transfer` tool (targets + from) on the assistant
//  - recording:  telephony_settings.recording_settings.enabled; the notice is part of the greeting
//  - language:   transcription.language (deepgram/flux: en, or multi for auto-detect)
//  - callLimits: telephony_settings.time_limit_secs and user_idle_timeout_secs
//  - voicemail:  only on transfers (the transfer tool's voicemail_detection); the
//                assistant's own voicemail detection is for outgoing calls only
//  - hoursMode:  Telnyx has no business hours. Open/closed comes from our
//                dynamic-variables webhook at the start of each call ({{twin_open_now}},
//                {{twin_greeting}}), the script says what to do, and the booking hooks
//                refuse bookings while closed.
//  - textBack:   Telnyx has no after-call text. We watch call_log (filled each minute by
//                server/callsync.ts) and text the caller from the receptionist's mobile.

// ---- Settings ------------------------------------------------------------------

export type LanguageCode = "en-AU" | "multi";

export type AutomationSettings = {
  transfer: {
    enabled: boolean;
    number: string;
    name: string;
    when: "hours" | "always";
    onRequest: boolean;
    urgent: boolean;
    cantHelp: boolean;
    /** If the transfer reaches voicemail: carry on (off) or come back and take a message. */
    voicemail: "off" | "take_message";
  };
  textBack: {
    enabled: boolean;
    afterCall: boolean;
    missedCall: boolean;
    bookingText: string;
    afterCallText: string;
    missedCallText: string;
  };
  recording: { enabled: boolean; notice: string };
  language: { code: LanguageCode };
  callLimits: { maxMinutes: number; idleSeconds: number };
  hoursMode: { enabled: boolean; greeting: string; mode: "message_only" | "message_and_booking" };
} & FollowupSettings & SpamSettings; // reminders, missedFollowup, reviews: server/followups.ts; spam: server/spam.ts

export type AutomationKey = keyof AutomationSettings;
const KEYS: AutomationKey[] = ["transfer", "textBack", "recording", "language", "callLimits", "hoursMode", "reminders", "missedFollowup", "reviews", "spam"];

export const LANGUAGES: { code: LanguageCode; label: string; note?: string }[] = [
  { code: "en-AU", label: "English (Australian)" },
  {
    code: "multi",
    label: "English, plus the caller's language",
    note: "Listens for English, Spanish, French, German, Hindi, Russian, Portuguese, Japanese, Italian and Dutch, and replies in the caller's language. The voice stays Australian English, so other languages have an Australian accent.",
  },
];

export const MISSED_CALL_SECONDS = 15;

export function defaultAutomations(): AutomationSettings {
  return {
    transfer: { enabled: false, number: "", name: "the team", when: "hours", onRequest: true, urgent: true, cantHelp: false, voicemail: "take_message" },
    textBack: {
      enabled: false,
      afterCall: true,
      missedCall: true,
      bookingText: "Hi {name}, thanks for calling {business}. You're booked in for {service} on {time}. Reply here if you need to change it.",
      afterCallText: "Thanks for calling {business}. We've passed your message on and the team will get back to you soon.",
      missedCallText: "Sorry we missed you at {business}. Reply here, or call back any time, and we'll help you out.",
    },
    recording: { enabled: false, notice: "Just so you know, this call is recorded for quality and training." },
    language: { code: "en-AU" },
    callLimits: { maxMinutes: 30, idleSeconds: 60 },
    hoursMode: {
      enabled: false,
      greeting: "Thanks for calling {business}. We're closed right now, but I can take a message and the team will get back to you.",
      mode: "message_only",
    },
    ...defaultFollowups(),
    ...defaultSpam(),
  };
}

// Text people type goes into the script and texts: strip template braces other
// than our own {placeholders}, control characters and runs of spaces.
function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\{\{|\}\}/g, "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

// "0412 345 678", "(07) 3123 4567", "+61 7 3123 4567" -> "+61731234567". "" stays "".
export function auNumber(input: unknown): string {
  const raw = String(input ?? "").replace(/[\s().-]/g, "");
  if (!raw) return "";
  let n = raw;
  if (/^0[2-478]\d{8}$/.test(n)) n = `+61${n.slice(1)}`;
  else if (/^61[2-478]\d{8}$/.test(n)) n = `+${n}`;
  if (!/^\+61[2-478]\d{8}$/.test(n)) throw new ValidationError("Enter an Australian phone number to transfer to, like 0412 345 678 or 07 3123 4567.");
  return n;
}

const int = (v: unknown, min: number, max: number, label: string, fallback: number): number => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
};

// Merges a partial update onto the current settings and checks every field.
export function normaliseAutomations(input: unknown, current: AutomationSettings = defaultAutomations()): AutomationSettings {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const d = defaultAutomations();
  const sec = <K extends AutomationKey>(k: K): Record<string, any> => ({ ...current[k], ...(src[k] && typeof src[k] === "object" ? src[k] : {}) });

  const t = sec("transfer");
  const transfer: AutomationSettings["transfer"] = {
    enabled: bool(t.enabled, false),
    number: auNumber(t.number),
    name: clean(t.name, 40).replace(/[{}]/g, "") || d.transfer.name,
    when: pick(t.when, ["hours", "always"] as const, "hours"),
    onRequest: bool(t.onRequest, true),
    urgent: bool(t.urgent, true),
    cantHelp: bool(t.cantHelp, false),
    voicemail: pick(t.voicemail, ["off", "take_message"] as const, "take_message"),
  };
  if (transfer.enabled && !transfer.number) throw new ValidationError("Add the number to transfer calls to.");
  if (transfer.enabled && !transfer.onRequest && !transfer.urgent && !transfer.cantHelp) {
    throw new ValidationError("Choose at least one reason to transfer a call.");
  }

  const x = sec("textBack");
  const text = (v: unknown, fallback: string) => clean(v, 300) || fallback;
  const textBack: AutomationSettings["textBack"] = {
    enabled: bool(x.enabled, false),
    afterCall: bool(x.afterCall, true),
    missedCall: bool(x.missedCall, true),
    bookingText: text(x.bookingText, d.textBack.bookingText),
    afterCallText: text(x.afterCallText, d.textBack.afterCallText),
    missedCallText: text(x.missedCallText, d.textBack.missedCallText),
  };

  const r = sec("recording");
  const recording = { enabled: bool(r.enabled, false), notice: clean(r.notice, 200).replace(/[{}]/g, "") || d.recording.notice };

  const l = sec("language");
  const language = { code: pick(l.code, LANGUAGES.map((x) => x.code), "en-AU") };

  const c = sec("callLimits");
  const callLimits = {
    maxMinutes: int(c.maxMinutes, 2, 60, "The longest call", d.callLimits.maxMinutes),
    idleSeconds: int(c.idleSeconds, 10, 120, "The silence limit", d.callLimits.idleSeconds),
  };

  const h = sec("hoursMode");
  const hoursMode = {
    enabled: bool(h.enabled, false),
    greeting: clean(h.greeting, 300) || d.hoursMode.greeting,
    mode: pick(h.mode, ["message_only", "message_and_booking"] as const, "message_only"),
  };

  return { transfer, textBack, recording, language, callLimits, hoursMode, ...normaliseFollowups(src, current), ...normaliseSpam(src, current) };
}

// Fills {business}, {name}, {time}, {service}; anything else in braces is dropped.
export function fill(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "")
    .replace(/[{}]/g, "")
    .replace(/ +([,.!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

// ---- Opening hours ---------------------------------------------------------------

function localParts(at: Date, tz: string): { day: (typeof DAYS)[number]["key"]; hhmm: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const day = DAYS.find((d) => d.short.toLowerCase() === String(parts.weekday).slice(0, 3).toLowerCase())?.key ?? "mon";
  return { day, hhmm: `${parts.hour}:${parts.minute}` };
}

export function openNow(settings: Pick<Settings, "hours" | "timezone">, at = new Date()): boolean {
  const { day, hhmm } = localParts(at, settings.timezone);
  const h = settings.hours[day];
  // Closing at 23:59 means open to midnight (how "open 24 hours" is stored).
  return Boolean(h?.open && hhmm >= h.from && (hhmm < h.to || h.to === "23:59"));
}

const hasHours = (hours: Hours) => DAYS.some((d) => hours[d.key]?.open);

// ---- What goes to the assistant --------------------------------------------------

const say = (n: string) => n.replace(/^\+61/, "0");

/** Transfers come from the receptionist's own number (Telnyx requires a from number). */
export const transferFrom = (client: Business): string | null => (client.phoneNumbers ?? []).find((n) => /^\+61\d{9}$/.test(n)) ?? null;

/** The transfer in engine-neutral form (what to say, who to ring), or null when it's off. */
export function transferSpec(a: AutomationSettings) {
  if (!a.transfer.enabled || !a.transfer.number) return null;
  const reasons = [
    a.transfer.onRequest && "the caller asks to speak to a person",
    a.transfer.urgent && "it is urgent",
    a.transfer.cantHelp && "you can't help with what they need",
  ].filter(Boolean);
  return {
    description: `Put the caller through to ${a.transfer.name} when ${reasons.join(", or ")}. Only on a phone call.`,
    name: a.transfer.name,
    to: a.transfer.number,
    takeMessageOnVoicemail: a.transfer.voicemail === "take_message",
  };
}

export function transferTool(client: Business, a: AutomationSettings) {
  const from = transferFrom(client);
  const spec = transferSpec(a);
  if (!spec || !from || a.transfer.number === from) return null;
  return {
    type: "transfer",
    transfer: {
      description: spec.description,
      targets: [{ name: spec.name, to: spec.to }],
      from,
      ...(spec.takeMessageOnVoicemail
        ? { voicemail_detection: { detection_mode: "premium", on_voicemail_detected: { action: "stop_transfer" } } }
        : {}),
    },
  };
}

const usesOpenNow = (a: AutomationSettings) => a.hoursMode.enabled || (a.transfer.enabled && a.transfer.when === "hours");

export function automationInstructions(client: Business, a: AutomationSettings, engine: "telnyx" | "vapi" = "telnyx"): string {
  const lines: string[] = [];
  // Telnyx needs the receptionist's own number to transfer from; Vapi doesn't.
  const tool = engine === "vapi" ? transferSpec(a) : transferTool(client, a);
  if (usesOpenNow(a)) {
    lines.push(
      `- Open right now: "{{twin_open_now}}" ("yes" or "no"). If it says "unknown", work it out from the current local time and the opening hours above.`,
    );
  }
  if (tool) {
    const reasons = [
      a.transfer.onRequest && "they ask to speak to a person",
      a.transfer.urgent && "it is urgent or an emergency",
      a.transfer.cantHelp && "you can't help with what they need",
    ].filter(Boolean);
    const hours = a.transfer.when === "hours" ? ` Only transfer while the business is open. When it's closed, say the team isn't available right now and take a message instead.` : "";
    lines.push(
      `- Putting a caller through: on a phone call, when ${reasons.join(", or ")}, tell them you're putting them through to ${a.transfer.name} and use the transfer tool.${hours} This replaces taking a message when they ask for a person. If the transfer doesn't go through, apologise and take their name, number and a short message. By text you can't transfer: take a message.`,
    );
  }
  if (a.hoursMode.enabled) {
    const booking =
      a.hoursMode.mode === "message_only"
        ? " Don't check availability, offer times or book anything while closed; say the team will get back to them when they open."
        : " You can still offer bookings.";
    lines.push(`- When the business is closed: take a message (their name, number and what it's about).${booking}`);
  }
  if (a.recording.enabled) lines.push(`- Calls are recorded. If asked, say so, and that only ${client.settings.businessName} uses the recording.`);
  if (a.language.code === "multi") {
    lines.push(`- If the caller speaks another language, reply in that language for the rest of the conversation. Otherwise use Australian English.`);
  }
  if (a.textBack.enabled) lines.push(`- After a phone call, the caller gets a short text from this number. You can tell them to expect it.`);
  lines.push(...spamLines(a, engine));
  return lines.length ? `\n\nAutomations (these take priority over anything above)\n${lines.join("\n")}` : "";
}

/**
 * The greeting callers hear: the normal one, plus the recording notice only when recording
 * is on. Any "this call is recorded" in the stored greeting is dropped first, so the spoken
 * greeting follows the Call recording setting.
 */
export function greetingFor(base: string, a: AutomationSettings): string {
  const g = withoutRecordingLine(base);
  return a.recording.enabled ? `${g} ${a.recording.notice}`.trim() : g;
}

export function afterHoursGreeting(client: Business, a: AutomationSettings): string {
  const g = fill(a.hoursMode.greeting, { business: client.settings.businessName });
  return a.recording.enabled ? `${g} ${a.recording.notice}` : g;
}

const hookUrl = (base: string, clientId: string, token: string) => `${base}/hooks/automations/${clientId}/${token}`;

/**
 * The fields to add to an instructions/tools/greeting update of the assistant (what
 * server/index.ts sends from syncAssistant and updateClient). Pure, so it's unit tested.
 */
export function overlayPayload<P extends { instructions?: string; tools?: unknown[]; greeting?: string }>(
  client: Business,
  a: AutomationSettings,
  payload: P,
  opts: { publicUrl: string; token: string },
): P & Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  if (typeof payload.instructions === "string") out.instructions = payload.instructions + automationInstructions(client, a);
  if (Array.isArray(payload.tools)) {
    const tool = transferTool(client, a);
    out.tools = tool ? [...payload.tools, tool] : payload.tools;
  }
  if (typeof payload.greeting === "string") {
    const greeting = greetingFor(payload.greeting, a);
    if (a.hoursMode.enabled || spamUsesHook(a)) {
      // The greeting is picked per call by the dynamic-variables webhook; the default
      // (no answer from us in time) is the normal greeting.
      out.greeting = "{{twin_greeting}}";
      out.dynamic_variables = { twin_greeting: greeting, twin_open_now: "unknown", ...(spamUsesHook(a) ? { twin_blocked: "no", twin_anonymous: "no" } : {}) };
    } else {
      out.greeting = greeting;
      out.dynamic_variables = { twin_open_now: "unknown" };
    }
    // Only ever set, never cleared: once set, our webhook keeps answering correctly
    // even when no automation needs it (clearing it isn't documented).
    if ((usesOpenNow(a) || spamUsesHook(a)) && opts.publicUrl && opts.token) out.dynamic_variables_webhook_url = hookUrl(opts.publicUrl, client.id, opts.token);
  }
  return out as P & Record<string, unknown>;
}

/**
 * The settings Telnyx keeps outside the script: recording, language, call limits.
 * `current` is the assistant's telephony_settings as Telnyx has them, so nothing
 * else in there (the voice app id, web calls) is lost.
 */
export function telephonyPayload(a: AutomationSettings, current: Record<string, any> = {}) {
  return {
    telephony_settings: {
      ...current,
      supports_unauthenticated_web_calls: current.supports_unauthenticated_web_calls ?? true,
      time_limit_secs: a.callLimits.maxMinutes * 60,
      user_idle_timeout_secs: a.callLimits.idleSeconds,
      recording_settings: { ...(current.recording_settings ?? {}), enabled: a.recording.enabled, channels: "dual", format: "mp3" },
    },
    transcription: { model: "deepgram/flux", language: a.language.code === "multi" ? "multi" : "en" },
  };
}

// ---- Storage -----------------------------------------------------------------------

type Row = {
  settings: AutomationSettings;
  appliedAt: string | null;
  applyError: string | null;
  textBackSince: string | null;
  updatedAt: string | null;
  token: string;
  stored: boolean;
};

const newToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");
const tokenOf = (settings: any): string => (typeof settings?._token === "string" ? settings._token : "");

export async function loadAutomations(clientId: string): Promise<Row> {
  const [r] = await sql`select settings, applied_at, apply_error, text_back_since, updated_at from client_automations where client_id = ${clientId}`;
  const raw = r?.settings ?? {};
  let settings: AutomationSettings;
  try {
    settings = normaliseAutomations(raw, defaultAutomations());
  } catch {
    settings = defaultAutomations();
  }
  const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
  return {
    settings,
    appliedAt: iso(r?.applied_at),
    applyError: r?.apply_error ?? null,
    textBackSince: iso(r?.text_back_since),
    updatedAt: iso(r?.updated_at),
    token: tokenOf(raw),
    stored: Boolean(r),
  };
}

async function storeAutomations(clientId: string, settings: AutomationSettings, token: string, userId: string | null, textBackOn: boolean) {
  const value = { ...settings, _token: token };
  await sql`
    insert into client_automations (client_id, settings, updated_by, text_back_since, updated_at)
    values (${clientId}, ${value as any}, ${userId}, ${textBackOn ? new Date() : null}, now())
    on conflict (client_id) do update set settings = excluded.settings, updated_by = excluded.updated_by, updated_at = now(),
      text_back_since = case
        when not ${textBackOn} then null
        when client_automations.text_back_since is null then now()
        else client_automations.text_back_since end`;
}

async function markApplied(clientId: string, error: string | null) {
  await sql`
    update client_automations set apply_error = ${error}, applied_at = case when ${error === null} then now() else applied_at end
    where client_id = ${clientId}`;
}

/**
 * The hook server/index.ts runs on every assistant update (syncAssistant and
 * updateClient): adds the automations' script lines, the transfer tool and the
 * greeting. With nothing stored, the payload goes through as it is.
 */
export async function withAutomations<P extends { instructions?: string; tools?: unknown[]; greeting?: string }>(client: Business, payload: P): Promise<P> {
  const row = await loadAutomations(client.id).catch(() => null);
  // Paused by the business (server/prompt.ts): the pause script and greeting go as they are.
  if (!row?.stored || client.settings.paused) return payload;
  return overlayPayload(client, row.settings, payload, { publicUrl: publicUrl(), token: row.token });
}

// ---- Applying a change ----------------------------------------------------------------

export type AutomationDeps = {
  /** server/index.ts syncAssistant: pushes the script and tools (with withAutomations). */
  syncAssistant: (client: Business) => Promise<Business>;
};

export async function applyAutomations(client: Business, deps: AutomationDeps): Promise<string | null> {
  if (isDemo(client.assistantId)) {
    await markApplied(client.id, null);
    return null;
  }
  try {
    const synced = await deps.syncAssistant(client);
    await voiceFor(synced).applyAutomations(synced);
    await markApplied(client.id, null);
    await resolveIncidents("automations_apply", client.id);
    return null;
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    await markApplied(client.id, message);
    await recordIncident({ kind: "automations_apply", clientId: client.id, orgId: await orgOfClient(client.id), message: `Couldn't apply automations: ${message}` });
    return message;
  }
}

export async function saveAutomations(
  client: Business,
  input: unknown,
  userId: string | null,
  deps: AutomationDeps,
): Promise<{ changed: AutomationKey[] }> {
  const row = await loadAutomations(client.id);
  const next = normaliseAutomations(input, row.settings);
  if (next.transfer.enabled && transferFrom(client) === next.transfer.number) {
    throw new ValidationError("That's the receptionist's own number. Transfer to a different number.");
  }
  const changed = KEYS.filter((k) => JSON.stringify(next[k]) !== JSON.stringify(row.settings[k]));
  await storeAutomations(client.id, next, row.token || newToken(), userId, next.textBack.enabled);
  await applyAutomations(client, deps);
  return { changed };
}

// ---- Status ---------------------------------------------------------------------------

export type AutomationStatus = { state: "on" | "off" | "needs_setup" | "unsupported" | "error"; label: string; detail?: string };

export type StatusInputs = {
  demo: boolean;
  /** The receptionist's number that sends texts, or null (undefined: couldn't check). */
  smsNumber: string | null | undefined;
  publicUrl: string;
  /** Whether these settings have ever reached the phone provider. */
  applied: boolean;
  /** The voice engine this receptionist runs on (default telnyx). */
  engine?: "telnyx" | "vapi";
  /** Whether this server can send email (for reminders and review requests). */
  emailReady?: boolean;
};

export function statusFor(client: Business, a: AutomationSettings, i: StatusInputs): Record<AutomationKey, AutomationStatus> {
  const off = (detail?: string): AutomationStatus => ({ state: "off", label: "Off", detail });
  const demoNote = i.demo ? " (demo: nothing reaches a real phone)" : "";

  const transfer: AutomationStatus = (() => {
    if (!a.transfer.enabled) return off();
    if (!a.transfer.number) return { state: "needs_setup", label: "Needs a number", detail: "Add the number to put callers through to." };
    if (!i.demo && i.engine !== "vapi" && !transferFrom(client)) {
      return { state: "needs_setup", label: "Needs a phone number", detail: "Transfers start once this receptionist has a phone number. Connect one under Call handling." };
    }
    const when = a.transfer.when === "hours" ? "during opening hours" : "any time";
    return { state: "on", label: `On · to ${say(a.transfer.number)}`, detail: `Callers are put through ${when}${demoNote}.` };
  })();

  const vapi = i.engine === "vapi";
  const textBack: AutomationStatus = (() => {
    if (!a.textBack.enabled) return off();
    if (!a.textBack.afterCall && !a.textBack.missedCall) return { state: "needs_setup", label: "Choose when to text", detail: "Turn on texts after calls, after missed calls, or both." };
    if (i.demo) return { state: "on", label: "On (demo)", detail: "Demo receptionists never send texts." };
    if (i.smsNumber === undefined) return { state: "error", label: "Couldn't check", detail: "The phone service didn't answer. Texts will go out once it does." };
    if (!i.smsNumber) {
      return vapi
        ? { state: "needs_setup", label: "Needs a Twilio mobile number", detail: UNMAPPED.textBack }
        : { state: "needs_setup", label: "Needs a mobile number", detail: "Texts are sent from the receptionist's own mobile number. Request a mobile number under Call handling." };
    }
    return { state: "on", label: `On · from ${say(i.smsNumber)}`, detail: "Each caller gets at most one text every 12 hours." };
  })();

  const recording: AutomationStatus = (() => {
    if (!i.demo && !i.applied && !vapi) {
      return {
        state: "needs_setup",
        label: "Not set yet",
        detail: "The phone service records calls by default, with no notice. Turn this on to add a notice, or save with it off to stop recording.",
      };
    }
    if (!a.recording.enabled) return off("Calls aren't recorded.");
    return { state: "on", label: "Recording", detail: `Callers hear: "${a.recording.notice}"` };
  })();

  const lang = LANGUAGES.find((l) => l.code === a.language.code) ?? LANGUAGES[0];
  const language: AutomationStatus = { state: "on", label: lang.label, detail: lang.code === "en-AU" ? "Australian English voice and listening." : undefined };

  const callLimits: AutomationStatus = {
    state: "on",
    label: vapi ? `Up to ${a.callLimits.maxMinutes} min` : `Up to ${a.callLimits.maxMinutes} min · ends after ${a.callLimits.idleSeconds}s of silence`,
    detail: vapi
      ? `${UNMAPPED.silenceLimit} ${UNMAPPED.voicemail}`
      : "Voicemail detection on incoming calls isn't available from the phone service (it only works on calls it makes), so it's offered on transfers instead.",
  };

  const hoursMode: AutomationStatus = (() => {
    if (!a.hoursMode.enabled) return off();
    if (!hasHours(client.settings.hours)) return { state: "needs_setup", label: "Set opening hours", detail: "The receptionist has no opening hours, so it would always be closed." };
    const how = i.publicUrl
      ? "Open or closed is checked at the start of each call."
      : "This server has no public address, so the receptionist works out open or closed from the clock.";
    const what = a.hoursMode.mode === "message_only" ? "Messages only when closed." : "Messages and bookings when closed.";
    return { state: "on", label: openNow(client.settings) ? "On · open now" : "On · closed now", detail: `${what} ${how}` };
  })();

  return { transfer, textBack, recording, language, callLimits, hoursMode, ...followupStatuses(client, a, { demo: i.demo, smsNumber: i.smsNumber, emailReady: Boolean(i.emailReady), engine: i.engine }), spam: spamStatus(a, { engine: i.engine, publicUrl: i.publicUrl }) };
}

export async function smsNumberOf(client: Business): Promise<string | null | undefined> {
  if (isDemo(client.assistantId)) return null;
  try {
    // Vapi has no texting of its own: a Twilio number of the agency's that it answers sends them.
    if (providerOfClient(client) === "vapi") return await twilioSmsNumber(currentOrg(), client.phoneNumbers ?? []);
    const t = await textingState(client);
    return t.numbers.find((n) => /^\+614\d{8}$/.test(n)) ?? null;
  } catch {
    return undefined;
  }
}

export async function automationsState(client: Business, canEdit: boolean) {
  const row = await loadAutomations(client.id);
  const demo = isDemo(client.assistantId);
  const smsNumber = row.settings.textBack.enabled || !demo ? await smsNumberOf(client) : null;
  const followups = await (await import("./followupsRun")).followupsState(client);
  const texts = await sql`
    select created_at, to_number, kind, status, detail from automation_texts
    where client_id = ${client.id} order by created_at desc limit 10`;
  return {
    settings: row.settings,
    status: statusFor(client, row.settings, { demo, smsNumber, publicUrl: publicUrl(), applied: Boolean(row.appliedAt), emailReady: followups.emailReady, engine: providerOfClient(client) }),
    canEdit,
    demo,
    appliedAt: row.appliedAt,
    applyError: demo ? null : row.applyError,
    updatedAt: row.updatedAt,
    smsNumber: smsNumber ?? null,
    languages: LANGUAGES,
    followups,
    recentTexts: texts.map((t: any) => ({ at: new Date(t.created_at).toISOString(), to: t.to_number ?? "", kind: t.kind, status: t.status, detail: t.detail })),
  };
}

// ---- The dynamic-variables webhook (public, per call) ----------------------------------
// Telnyx calls it at the start of each conversation. The token in the path is the key;
// the answer only says whether the business is open and which greeting to use.

export async function dynamicVariables(clientId: string, token: string, call: { caller?: unknown; channel?: unknown } = {}): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const client = await getClient(clientId);
  const row = client ? await loadAutomations(clientId) : null;
  if (!client || !row?.token || row.token.length !== token.length || !timingSafeEqual(Buffer.from(row.token), Buffer.from(token))) {
    return json({ error: "Not found" }, 404);
  }
  const a = row.settings;
  const open = openNow(client.settings);
  const normal = client.settings.paused ? greetingOf(client.settings) : greetingFor(client.settings.greeting, a);
  const spam = spamVariables(a, call.caller, call.channel);
  return json({
    dynamic_variables: {
      twin_open_now: open ? "yes" : "no",
      twin_greeting: spam.reject ? BLOCKED_GREETING : a.hoursMode.enabled && !open && !client.settings.paused ? afterHoursGreeting(client, a) : normal,
      ...(spamUsesHook(a) ? { twin_blocked: spam.twin_blocked, twin_anonymous: spam.twin_anonymous } : {}),
    },
  });
}

/**
 * For the booking hooks: a reason to refuse a booking right now (after-hours mode,
 * messages only, while closed), or null.
 */
export async function bookingBlocked(client: Business): Promise<string | null> {
  const row = await loadAutomations(client.id).catch(() => null);
  if (!row?.stored) return null;
  const h = row.settings.hoursMode;
  if (!h.enabled || h.mode !== "message_only" || openNow(client.settings)) return null;
  return "The business is closed, so bookings can't be made now. Take a message with request_callback instead.";
}

// ---- Text-back -------------------------------------------------------------------------

export type CallForText = { durationSeconds: number | null; from: string | null };
export type BookingForText = { name: string; service: string; start: string } | null;

const AU_MOBILE = /^\+614\d{8}$/;

function sayStart(start: string, tz: string): string {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return start;
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    .format(d)
    .replace(/\s/g, "")
    .replace(":00", "")
    .toLowerCase();
  return `${day.replace(",", "")}, ${time}`;
}

/** Which text (if any) a finished call gets. Pure, so it's unit tested. */
export function chooseText(
  client: Business,
  a: AutomationSettings,
  call: CallForText,
  booking: BookingForText,
): { kind: "booking" | "after_call" | "missed_call"; text: string } | { skip: string } {
  if (!call.from || !AU_MOBILE.test(call.from)) return { skip: "Not an Australian mobile" };
  const t = a.textBack;
  const business = client.settings.businessName;
  const optOut = (s: string) => (/\bSTOP\b/.test(s) ? s : `${s} Reply STOP to opt out.`);
  if (booking && t.afterCall) {
    const text = fill(t.bookingText, { business, name: booking.name.split(" ")[0] ?? "", service: booking.service || "your appointment", time: sayStart(booking.start, client.settings.timezone) });
    return { kind: "booking", text: optOut(text) };
  }
  const missed = call.durationSeconds !== null && call.durationSeconds < MISSED_CALL_SECONDS;
  if (missed) return t.missedCall ? { kind: "missed_call", text: optOut(fill(t.missedCallText, { business })) } : { skip: "Missed-call texts are off" };
  return t.afterCall ? { kind: "after_call", text: optOut(fill(t.afterCallText, { business })) } : { skip: "After-call texts are off" };
}

// Phone calls only (not texts or browser test calls) that are over (quiet for 2
// minutes), started after text-back was switched on and within the last 2 hours,
// and not dealt with yet.

export async function runTextBack(): Promise<void> {
  const due = await sql`
    select c.provider_call_id, c.client_id, c.org_id, c.from_number, c.started_at, c.ended_at, c.duration_seconds
    from call_log c
    join client_automations a on a.client_id = c.client_id
    join orgs o on o.id = c.org_id
    where (a.settings->'textBack'->>'enabled')::boolean is true
      and a.text_back_since is not null
      and o.suspended_at is null
      and c.started_at >= a.text_back_since
      and c.started_at > now() - interval '2 hours'
      and coalesce(c.ended_at, c.started_at) < now() - interval '2 minutes'
      and c.channel <> 'web' and c.channel not ilike '%sms%' and c.channel not ilike '%chat%'
      and not exists (select 1 from automation_texts t where t.provider_call_id = c.provider_call_id)
    order by c.started_at
    limit 50`;
  for (const call of due as any[]) {
    await runAsOrg(call.org_id, () => textBackOne(call)).catch((err) => console.error(`[text-back ${call.client_id}]`, (err as Error).message));
  }
}

async function textBackOne(call: any): Promise<void> {
  const client = await getClient(call.client_id);
  if (!client) return;
  const row = await loadAutomations(client.id);
  const started = new Date(call.started_at);
  const ended = new Date(call.ended_at ?? call.started_at);
  const [b] = await sql`
    select data from booking_requests
    where client_id = ${client.id} and data->>'kind' = 'booking' and data->>'status' = 'booked'
      and (data->>'at')::timestamptz between ${new Date(started.getTime() - 60_000)} and ${new Date(ended.getTime() + 120_000)}
    order by id desc limit 1`;
  const booking = b?.data ? { name: String(b.data.name ?? ""), service: String(b.data.service ?? ""), start: String(b.data.start ?? "") } : null;
  const choice = chooseText(client, row.settings, { durationSeconds: call.duration_seconds ?? null, from: call.from_number }, booking);
  const kind = "kind" in choice ? choice.kind : "after_call";

  // Claim the call first so two servers never text it twice.
  const claimed = await sql`
    insert into automation_texts (client_id, provider_call_id, kind, to_number, status, detail)
    values (${client.id}, ${call.provider_call_id}, ${kind}, ${call.from_number}, 'skipped', 'Sending')
    on conflict (provider_call_id) do nothing returning id`;
  if (!claimed.length) return;
  const id = claimed[0].id;
  const finish = (status: "sent" | "skipped" | "failed", detail: string) => sql`update automation_texts set status = ${status}, detail = ${detail.slice(0, 200)} where id = ${id}`;

  if ("skip" in choice) return void (await finish("skipped", choice.skip));
  if (isDemo(client.assistantId)) return void (await finish("skipped", "Demo receptionist: nothing sent"));
  const [recent] = await sql`
    select 1 from automation_texts where client_id = ${client.id} and to_number = ${call.from_number} and status = 'sent'
      and created_at > now() - interval '12 hours' and id <> ${id}`;
  if (recent) return void (await finish("skipped", "Texted in the last 12 hours"));
  const from = await smsNumberOf(client);
  if (!from) return void (await finish("skipped", "No mobile number for texts"));
  try {
    await sendSms(client, { from, to: call.from_number, text: choice.text, meta: { twin_text_back: kind } });
    await finish("sent", "");
  } catch (err) {
    await finish("failed", (err as Error).message);
    await recordIncident({ kind: "text_back", clientId: client.id, orgId: call.org_id, message: `Text-back failed: ${(err as Error).message}`.slice(0, 300) });
  }
}

let running = false;
export function startAutomations(): void {
  if (process.env.TEXT_BACK === "off") return;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runTextBack();
    } catch (err) {
      console.error("[text-back]", (err as Error).message);
    }
    try {
      // Reminders, missed-call follow-ups and review requests (server/followupsRun.ts).
      await (await import("./followupsRun")).runFollowups();
    } catch (err) {
      console.error("[followups]", (err as Error).message);
    } finally {
      running = false;
    }
  }, 60_000);
}
