import type { Business } from "../src/lib/shared";
import { FOLLOWUP_DEFAULTS, REMINDER_HOURS, fillTemplate, withOptOut, type FollowupSettings, type ReminderHours } from "../src/lib/followups";
import type { AutomationStatus } from "./automations";
import { ValidationError } from "./prompt";

// The three follow-up automations: appointment reminders, missed-call follow-up and
// review requests. This file is the pure part (settings, validation, status text, and
// the send-once bookkeeping); server/followupsRun.ts finds what is due each minute
// and sends it. The shared rules (scheduling windows, quiet hours, templates) are in
// src/lib/followups.ts.
//
// Inbound texts: replies go to the receptionist's AI assistant on the phone provider
// (the messaging profile is linked to it); this server has no inbound SMS webhook. So
// reminders can't take "C to confirm / X to cancel", and the default text says to call
// to change a booking.

// Text people type goes into texts and emails: strip template braces other than our own
// {placeholders}, control characters (new lines are kept for emails) and runs of spaces.
function clean(value: unknown, max: number, multiline = false): string {
  return String(value ?? "")
    .replace(/\{\{|\}\}/g, "")
    .replace(multiline ? /[\u0000-\u0009\u000b-\u001f]/g : /[\u0000-\u001f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim()
    .slice(0, max);
}

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** A review link: https, a real host, no spaces or sign-in details. "" stays "". */
export function checkReviewLink(value: unknown): string {
  const url = String(value ?? "").trim();
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError("The review link isn't a valid web address. Paste the full link, starting with https://");
  }
  if (parsed.protocol !== "https:") throw new ValidationError("The review link must start with https://");
  if (url.length > 300) throw new ValidationError("The review link is too long.");
  if (parsed.username || parsed.password || /\s/.test(url) || !parsed.hostname.includes(".")) {
    throw new ValidationError("The review link isn't a valid web address. Paste the full link, starting with https://");
  }
  return parsed.toString();
}

export const defaultFollowups = (): FollowupSettings => structuredClone(FOLLOWUP_DEFAULTS);

/** Merges a partial update onto the current settings and checks every field. */
export function normaliseFollowups(input: unknown, current: Partial<FollowupSettings> = defaultFollowups()): FollowupSettings {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const d = defaultFollowups();
  const sec = <K extends keyof FollowupSettings>(k: K): Record<string, any> => ({
    ...d[k],
    ...(current[k] ?? {}),
    ...(src[k] && typeof src[k] === "object" ? src[k] : {}),
  });

  const r = sec("reminders");
  const hours = Number(r.hoursBefore);
  if (r.hoursBefore !== undefined && !REMINDER_HOURS.includes(hours as ReminderHours)) {
    throw new ValidationError("Choose 2, 24 or 48 hours before.");
  }
  const reminders: FollowupSettings["reminders"] = {
    enabled: bool(r.enabled, false),
    sms: bool(r.sms, true),
    email: bool(r.email, false),
    hoursBefore: (REMINDER_HOURS.includes(hours as ReminderHours) ? hours : d.reminders.hoursBefore) as ReminderHours,
    smsText: clean(r.smsText, 300) || d.reminders.smsText,
    emailText: clean(r.emailText, 1500, true) || d.reminders.emailText,
  };

  const m = sec("missedFollowup");
  const overdue = m.overdueHours === undefined || m.overdueHours === "" ? d.missedFollowup.overdueHours : Number(m.overdueHours);
  if (!Number.isInteger(overdue) || overdue < 1 || overdue > 72) throw new ValidationError("Hours before following up must be a whole number from 1 to 72.");
  const missedFollowup: FollowupSettings["missedFollowup"] = {
    enabled: bool(m.enabled, false),
    shortCall: bool(m.shortCall, true),
    callbackOverdue: bool(m.callbackOverdue, true),
    overdueHours: overdue,
    text: clean(m.text, 300) || d.missedFollowup.text,
  };

  const v = sec("reviews");
  const reviews: FollowupSettings["reviews"] = {
    enabled: bool(v.enabled, false),
    link: checkReviewLink(v.link),
    delay: v.delay === "2h" ? "2h" : "next_morning",
    sms: bool(v.sms, true),
    email: bool(v.email, false),
    smsText: clean(v.smsText, 300) || d.reviews.smsText,
    emailText: clean(v.emailText, 1500, true) || d.reviews.emailText,
  };

  return { reminders, missedFollowup, reviews };
}

// ---- The message ----------------------------------------------------------------------------

export type FollowupKind = "reminder" | "missed" | "review";

/** The text or email for one follow-up, from the template and the filled-in details. */
export function renderMessage(
  kind: FollowupKind,
  channel: "sms" | "email",
  f: FollowupSettings,
  vars: Record<string, string>,
): { subject: string; text: string } {
  const template =
    kind === "reminder" ? (channel === "sms" ? f.reminders.smsText : f.reminders.emailText)
    : kind === "review" ? (channel === "sms" ? f.reviews.smsText : f.reviews.emailText)
    : f.missedFollowup.text;
  const filled = fillTemplate(template, vars);
  const subject =
    kind === "reminder" ? fillTemplate("Reminder: your {service} at {business}, {date} at {time}", vars)
    : kind === "review" ? fillTemplate("How was your visit to {business}?", vars)
    : fillTemplate("Sorry we missed you at {business}", vars);
  return { subject, text: channel === "sms" ? withOptOut(filled) : filled };
}

// ---- Status -----------------------------------------------------------------------------

export type FollowupStatusInputs = {
  demo: boolean;
  /** The receptionist's number that sends texts, or null (undefined: couldn't check). */
  smsNumber: string | null | undefined;
  /** Whether this server can send email. */
  emailReady: boolean;
  /** The voice engine (default telnyx): Vapi receptionists text from a Twilio number. */
  engine?: "telnyx" | "vapi";
};

const SMS_NEEDED = { label: "Needs a phone number that can send texts", detail: "Texts are sent from the receptionist's own mobile number. Request a mobile number under Call handling." };
const SMS_NEEDED_VAPI = { label: "Needs a Twilio number that can send texts", detail: "Texts are sent from a Twilio mobile number this receptionist answers. Connect Twilio under Connections, then add a Twilio mobile number under Call handling." };
const EMAIL_NEEDED = { label: "Needs email set up", detail: "This server has no email service yet. The platform admin sets it up under Settings, Email and calendars." };
const QUIET = "Texts never go out between 8pm and 8am; they wait until morning.";

/** Whether the chosen ways of sending can work right now: a status to show if not, else null. */
function channelStatus(i: FollowupStatusInputs, sms: boolean, email: boolean): { status: AutomationStatus | null; note: string } {
  if (!sms && !email) return { status: { state: "needs_setup", label: "Choose how to send", detail: "Turn on texts, email, or both." }, note: "" };
  if (i.demo) return { status: { state: "on", label: "On (demo)", detail: "Demo receptionists never send anything." }, note: "" };
  if (sms && i.smsNumber === undefined) {
    return { status: { state: "error", label: "Couldn't check", detail: "The phone service didn't answer. Messages will go out once it does." }, note: "" };
  }
  const problems = [sms && !i.smsNumber ? (i.engine === "vapi" ? SMS_NEEDED_VAPI : SMS_NEEDED) : null, email && !i.emailReady ? EMAIL_NEEDED : null].filter(Boolean) as { label: string; detail: string }[];
  const wanted = Number(sms) + Number(email);
  if (problems.length === wanted) {
    return { status: { state: "needs_setup", label: problems[0].label, detail: problems.map((p) => p.detail).join(" ") }, note: "" };
  }
  return { status: null, note: problems.length ? ` ${problems[0].detail} Until then only the other way sends.` : "" };
}

export function followupStatuses(client: Business, f: FollowupSettings, i: FollowupStatusInputs): Record<keyof FollowupSettings, AutomationStatus> {
  const off: AutomationStatus = { state: "off", label: "Off" };

  const reminders: AutomationStatus = (() => {
    const a = f.reminders;
    if (!a.enabled) return off;
    const ch = channelStatus(i, a.sms, a.email);
    if (ch.status) return ch.status;
    if (!i.demo && !client.booking?.enabled) {
      return { state: "needs_setup", label: "Needs bookings turned on", detail: "Reminders go out for appointments the receptionist books. Set up booking first." };
    }
    const via = [a.sms && "text", a.email && "email"].filter(Boolean).join(" and ");
    return { state: "on", label: `On · ${a.hoursBefore} hours before`, detail: `A ${via} reminder goes to each booked customer. Texts say to call to change the booking. ${QUIET}${ch.note}` };
  })();

  const missedFollowup: AutomationStatus = (() => {
    const a = f.missedFollowup;
    if (!a.enabled) return off;
    if (!a.shortCall && !a.callbackOverdue) return { state: "needs_setup", label: "Choose when to text", detail: "Turn on texts after short calls, after unreturned callbacks, or both." };
    const ch = channelStatus(i, true, false);
    if (ch.status) return ch.status;
    const when = [a.shortCall && "a call ends within 10 seconds", a.callbackOverdue && `nobody has called back within ${a.overdueHours} hour${a.overdueHours === 1 ? "" : "s"}`].filter(Boolean).join(", or ");
    return { state: "on", label: "On", detail: `Texts the caller when ${when}. Never to withheld numbers, and at most one text per caller per day. ${QUIET}` };
  })();

  const reviews: AutomationStatus = (() => {
    const a = f.reviews;
    if (!a.enabled) return off;
    if (!a.link) return { state: "needs_setup", label: "Needs your review link", detail: "Paste the link people use to leave you a Google review." };
    const ch = channelStatus(i, a.sms, a.email);
    if (ch.status) return ch.status;
    const when = a.delay === "2h" ? "2 hours after" : "the next morning after";
    const via = [a.sms && "text", a.email && "email"].filter(Boolean).join(" and ");
    return { state: "on", label: a.delay === "2h" ? "On · 2 hours after" : "On · next morning", detail: `Sends a ${via} ${when} each completed appointment, once per customer every 90 days. Cancelled bookings are skipped. ${QUIET}${ch.note}` };
  })();

  return { reminders, missedFollowup, reviews };
}

// ---- Sending once ---------------------------------------------------------------------------

export type DeliverDeps = {
  /** Records the attempt before sending; null when this message was already claimed (so a restart or a second server never repeats it). */
  claim: () => Promise<string | null>;
  finish: (id: string, status: "sent" | "skipped" | "failed", detail: string) => Promise<void>;
  /** A reason not to send after all (demo, recently texted, no number...), or null. */
  veto: () => Promise<string | null>;
  send: () => Promise<void>;
};

export async function deliver(deps: DeliverDeps): Promise<"sent" | "skipped" | "failed" | "duplicate"> {
  const id = await deps.claim();
  if (!id) return "duplicate";
  const veto = await deps.veto().catch((err) => `Couldn't check: ${(err as Error).message}`);
  if (veto) {
    await deps.finish(id, "skipped", veto);
    return "skipped";
  }
  try {
    await deps.send();
    await deps.finish(id, "sent", "");
    return "sent";
  } catch (err) {
    await deps.finish(id, "failed", (err as Error).message);
    return "failed";
  }
}
