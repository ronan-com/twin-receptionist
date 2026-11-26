// Pure pieces of the three follow-up automations (appointment reminders, missed-call
// follow-up, review requests). No server or browser imports, so the server
// (server/followups.ts) and the automations screen share the same template filling,
// time zone maths and scheduling rules.

export type ReminderHours = 2 | 24 | 48;
export const REMINDER_HOURS: ReminderHours[] = [2, 24, 48];
export type ReviewDelay = "2h" | "next_morning";

export type FollowupSettings = {
  reminders: {
    enabled: boolean;
    sms: boolean;
    email: boolean;
    hoursBefore: ReminderHours;
    smsText: string;
    emailText: string;
  };
  missedFollowup: {
    enabled: boolean;
    /** The caller hung up within a few seconds (before the receptionist finished). */
    shortCall: boolean;
    /** A callback was requested and nobody has called back after `overdueHours`. */
    callbackOverdue: boolean;
    overdueHours: number;
    text: string;
  };
  reviews: {
    enabled: boolean;
    link: string;
    delay: ReviewDelay;
    sms: boolean;
    email: boolean;
    smsText: string;
    emailText: string;
  };
};

export type FollowupKey = keyof FollowupSettings;

/** A call this short counts as missed. */
export const SHORT_CALL_SECONDS = 10;
/** Texts are never sent from 8pm to 8am in the business's time zone. */
export const QUIET_FROM_HOUR = 20;
export const QUIET_UNTIL_HOUR = 8;
/** The morning a "next morning" review request goes out. */
export const MORNING_HOUR = 9;
/** A reminder isn't sent in the last half hour before the appointment. */
export const LATEST_BEFORE_START_MS = 30 * 60_000;
export const REVIEW_REPEAT_DAYS = 90;

export const FOLLOWUP_DEFAULTS: FollowupSettings = {
  reminders: {
    enabled: false,
    sms: true,
    email: false,
    hoursBefore: 24,
    smsText: "Hi {name}, a reminder of your {service} at {business} on {date} at {time}. Call us to change it.",
    emailText:
      "Hi {name},\n\nThis is a reminder of your {service} at {business}.\n\nWhen: {date} at {time}\n\nIf you need to change or cancel it, please give us a call.\n\nSee you then,\n{business}",
  },
  missedFollowup: {
    enabled: false,
    shortCall: true,
    callbackOverdue: true,
    overdueHours: 4,
    text: "Sorry we missed you at {business}. Reply to this text or call us back any time and we'll help you out.",
  },
  reviews: {
    enabled: false,
    link: "",
    delay: "next_morning",
    sms: true,
    email: false,
    smsText: "Hi {name}, thanks for visiting {business}. If you have a minute, we'd love a quick review: {link}",
    emailText:
      "Hi {name},\n\nThanks for visiting {business}. If you have a minute, a quick review helps other people find us:\n\n{link}\n\nThank you,\n{business}",
  },
};

export const TEMPLATE_VARS = ["name", "business", "service", "date", "time", "link"] as const;

export const SAMPLE_VARS: Record<string, string> = {
  name: "Sam",
  business: "Alpha Plumbing",
  service: "check-up",
  date: "Thu 3 Dec",
  time: "9:30am",
  link: "https://g.page/r/your-business/review",
};

/**
 * Fills {name}, {business}, {service}, {date}, {time} and {link}. Anything else in
 * braces is dropped, empty values leave no stray spaces, and new lines are kept
 * (emails). Same idea as `fill` in server/automations.ts.
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "")
    .replace(/[{}]/g, "")
    .split("\n")
    .map((l) => l.replace(/ +([,.!?:])/g, "$1").replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The SMS opt-out line, added once. */
export const withOptOut = (s: string) => (/\bSTOP\b/.test(s) ? s : `${s} Reply STOP to opt out.`);

// ---- Phone numbers ------------------------------------------------------------------

/** "0412 345 678", "+61 412 345 678" -> "+61412345678". Not an Australian mobile (or withheld/invalid): null. */
export function auMobile(input: unknown): string | null {
  const raw = String(input ?? "").replace(/[\s().-]/g, "");
  let n = raw;
  if (/^04\d{8}$/.test(n)) n = `+61${n.slice(1)}`;
  else if (/^614\d{8}$/.test(n)) n = `+${n}`;
  return /^\+614\d{8}$/.test(n) ? n : null;
}

/** Who a customer is, for "once per customer": their mobile, else their email. */
export function customerKey(phone: unknown, email: unknown): string | null {
  const m = auMobile(phone);
  if (m) return m;
  const e = String(email ?? "").trim().toLowerCase();
  return e ? `email:${e}` : null;
}

// ---- Time zones -----------------------------------------------------------------------

type Local = { y: number; m: number; d: number; h: number; min: number };

export function localParts(at: number, tz: string): Local {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute };
}

// Minutes the zone is ahead of UTC at that instant (Brisbane: 600).
function offsetMinutes(at: number, tz: string): number {
  const l = localParts(at, tz);
  return Math.round((Date.UTC(l.y, l.m - 1, l.d, l.h, l.min) - Math.floor(at / 60000) * 60000) / 60000);
}

/** The instant when the clock in `tz` reads y-m-d h:min (day overflow is fine: d = 32 is next month). */
export function zonedEpoch(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let at = guess - offsetMinutes(guess, tz) * 60000;
  at = guess - offsetMinutes(at, tz) * 60000;
  return at;
}

export function isQuietHour(at: number, tz: string): boolean {
  const { h } = localParts(at, tz);
  return h >= QUIET_FROM_HOUR || h < QUIET_UNTIL_HOUR;
}

/** When a text wanted at `at` can actually go: `at` itself, or 8am local if it falls in quiet hours. */
export function nextTextTime(at: number, tz: string): number {
  if (!isQuietHour(at, tz)) return at;
  const l = localParts(at, tz);
  return zonedEpoch(l.y, l.m, l.h >= QUIET_FROM_HOUR ? l.d + 1 : l.d, QUIET_UNTIL_HOUR, 0, tz);
}

/** 9am local on the first morning after `at` (an end at 6am goes out the same day at 9am). */
export function nextMorning(at: number, tz: string): number {
  const l = localParts(at, tz);
  return zonedEpoch(l.y, l.m, l.h < MORNING_HOUR ? l.d : l.d + 1, MORNING_HOUR, 0, tz);
}

/** {date} and {time} the way a text says them: "Thu 3 Dec", "9:30am". */
export function whenVars(start: string | number | Date, tz: string): { date: string; time: string } {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const date = new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d).replace(",", "");
  const time = new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(/\s/g, "").replace(":00", "").toLowerCase();
  return { date, time };
}

// ---- Scheduling rules ---------------------------------------------------------------------

export type Plan = { action: "send" } | { action: "wait"; until: number } | { action: "skip"; reason: string };

// Send once it's time; a text that is due but would go out in quiet hours (the server was
// down, say) waits for the morning instead.
const decide = (now: number, sendAt: number, tz: string, sms: boolean): Plan => {
  if (now < sendAt) return { action: "wait", until: sendAt };
  if (sms && isQuietHour(now, tz)) return { action: "wait", until: nextTextTime(now, tz) };
  return { action: "send" };
};

/**
 * When an appointment reminder goes out. Sent `hoursBefore` hours before the start; a
 * text that would land in quiet hours waits until 8am. Never for a booking made after
 * that moment (it was just confirmed), nor one whose time came before the reminders
 * were switched on, nor in the last half hour before the appointment.
 */
export function reminderPlan(o: {
  start: number;
  bookedAt: number;
  hoursBefore: number;
  now: number;
  tz: string;
  channel: "sms" | "email";
  since: number | null;
}): Plan {
  const ideal = o.start - o.hoursBefore * 3_600_000;
  if (o.now >= o.start - LATEST_BEFORE_START_MS) return { action: "skip", reason: "Too late to remind" };
  if (o.bookedAt > ideal) return { action: "skip", reason: "Booked too close to the appointment" };
  if (o.since !== null && ideal < o.since) return { action: "skip", reason: "Reminder time was before reminders were switched on" };
  const sendAt = o.channel === "sms" ? nextTextTime(ideal, o.tz) : ideal;
  if (sendAt > o.start - LATEST_BEFORE_START_MS) return { action: "skip", reason: "Too close to the appointment once quiet hours end" };
  return decide(o.now, sendAt, o.tz, o.channel === "sms");
}

/** Missed-call text: a few minutes after the call (or callback request) is overdue, never in quiet hours. */
export function followupPlan(o: { dueAt: number; now: number; tz: string; since: number | null; maxAgeMs: number }): Plan {
  if (o.since !== null && o.dueAt < o.since) return { action: "skip", reason: "Before this was switched on" };
  const sendAt = nextTextTime(o.dueAt, o.tz);
  if (o.now - sendAt > o.maxAgeMs) return { action: "skip", reason: "Too long ago to follow up" };
  return decide(o.now, sendAt, o.tz, true);
}

/** A review request: appointment end + 2 hours, or 9am the next morning. Texts wait out quiet hours. */
export function reviewPlan(o: {
  start: number;
  minutes: number;
  delay: ReviewDelay;
  now: number;
  tz: string;
  channel: "sms" | "email";
  since: number | null;
}): Plan {
  const end = o.start + o.minutes * 60_000;
  const due = o.delay === "2h" ? end + 2 * 3_600_000 : nextMorning(end, o.tz);
  if (o.since !== null && due < o.since) return { action: "skip", reason: "Appointment was before reviews were switched on" };
  const sendAt = o.channel === "sms" ? nextTextTime(due, o.tz) : due;
  if (o.now - sendAt > 36 * 3_600_000) return { action: "skip", reason: "Too long ago to ask" };
  return decide(o.now, sendAt, o.tz, o.channel === "sms");
}

/** At most one text per caller in `hours`. */
export function sentRecently(lastSentAt: number | null, now: number, hours: number): boolean {
  return lastSentAt !== null && now - lastSentAt < hours * 3_600_000;
}

/** One review request per customer every 90 days. */
export const reviewAllowed = (lastSentAt: number | null, now: number): boolean => !sentRecently(lastSentAt, now, REVIEW_REPEAT_DAYS * 24);
