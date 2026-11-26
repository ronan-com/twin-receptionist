/**
 * Shared business rules for the Answered customer app.
 *
 * Everything in here is deliberately pure and dependency-free so the same
 * logic can be reused by the dashboard, bookings, follow-ups and reports
 * instead of each page re-deriving its own (and disagreeing).
 */
import type { Appointment, Integration, Lead, KnowledgeItem, PhoneNumber, Agent, Business, UnansweredQuestion } from "./types";
import type { CallDetail, CallListRow } from "./types";
import { PRODUCT } from "@/lib/app/product";

/* ------------------------------------------------------------------ */
/* 1. Booking source                                                    */
/* ------------------------------------------------------------------ */

/**
 * Historic and current values written by the receptionist pipeline.
 * `ai_call` came from the original webhook, `ai_receptionist` from the
 * seeded/demo data. Both mean "the AI receptionist booked this".
 */
export const AI_BOOKING_SOURCES = ["ai_call", "ai_receptionist", "ai", "receptionist"] as const;

export function isAiBooking(source: string | null | undefined): boolean {
  if (!source) return false;
  return (AI_BOOKING_SOURCES as readonly string[]).includes(source.trim().toLowerCase());
}

export function bookingSourceLabel(source: string | null | undefined): string {
  if (isAiBooking(source)) return "Booked by receptionist";
  if (!source) return "Unknown source";
  if (source === "manual") return "Added by your team";
  return source.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Bookings the receptionist created, using the shared source rule. */
export function aiBookings<T extends { source: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => isAiBooking(r.source));
}

/* ------------------------------------------------------------------ */
/* 2. Calendar connection vs per-booking sync                           */
/* ------------------------------------------------------------------ */

export const CALENDAR_PROVIDERS = ["google_calendar", "microsoft_calendar", "cliniko"];

export interface CalendarConnection {
  /** A calendar account is connected at the business level. */
  connected: boolean;
  /** A calendar account exists but is currently reporting an error. */
  errored: boolean;
  integrations: Integration[];
  primary: Integration | null;
}

/**
 * Derived from the integrations table only. Never infer a calendar
 * connection from whether individual appointments happen to carry an
 * integration_id.
 */
export function calendarConnection(integrations: Integration[] | undefined | null): CalendarConnection {
  const list = (integrations ?? []).filter((i) => CALENDAR_PROVIDERS.includes(i.provider));
  const connected = list.filter((i) => i.status === "connected");
  const errored = list.filter((i) => i.status === "error");
  return {
    connected: connected.length > 0,
    errored: errored.length > 0,
    integrations: list,
    primary: connected[0] ?? errored[0] ?? list[0] ?? null,
  };
}

export type BookingSyncState = "synced" | "pending" | "failed" | "local_only" | "not_connected" | "diverged";

export interface BookingSync {
  state: BookingSyncState;
  label: string;
  /** Plain-language explanation shown next to the booking. */
  detail: string;
}

/** Written by Answered when a booking is changed locally after it had synced. */
export const LOCAL_CHANGE_SYNC_STATUS = "local_changes_pending";

type BookingSyncInput = Pick<Appointment, "integration_id" | "sync_status" | "external_ref">;

/**
 * Distinguishes "the business has a calendar connected" from "this specific
 * booking reached the calendar". The booking is judged against the integration
 * it was actually sent to, so disconnecting an account later never rewrites
 * the history of a booking that did sync.
 */
export function bookingSync(appointment: BookingSyncInput, calendar: CalendarConnection): BookingSync {
  const status = (appointment.sync_status ?? "").toLowerCase();

  if (!appointment.integration_id) {
    if (!calendar.connected && !calendar.errored) {
      return { state: "not_connected", label: "Local record only", detail: `No calendar is connected, so this booking lives in ${PRODUCT} only.` };
    }
    return { state: "local_only", label: "Local record only", detail: "This booking was not sent to your connected calendar." };
  }

  // Match the booking to the integration it was actually sent to.
  const target = calendar.integrations.find((i) => i.id === appointment.integration_id) ?? null;
  const targetName = target?.display_name ?? (target ? humanProvider(target.provider) : "the calendar it was sent to");

  if (status === LOCAL_CHANGE_SYNC_STATUS || status === "local_changes_pending") {
    return {
      state: "diverged",
      label: "Local change not sent",
      detail: `You changed this booking in ${PRODUCT}. ${targetName} still has the previous details, so check it before relying on it.`,
    };
  }
  if (status === "synced" || status === "success") {
    const base = appointment.external_ref ? `Calendar reference ${appointment.external_ref}.` : `Confirmed against ${targetName}.`;
    const suffix = target && target.status === "error" ? ` ${targetName} needs reconnecting, so newer changes may not reach it.` : "";
    return { state: "synced", label: "In your calendar", detail: `${base}${suffix}` };
  }
  if (status === "failed" || status === "error") {
    return {
      state: "failed",
      label: "Calendar confirmation failed",
      detail: `${PRODUCT} could not confirm this booking with ${targetName}. Check your calendar before relying on it.`,
    };
  }
  return { state: "pending", label: "Waiting on calendar", detail: `${PRODUCT} has the booking. ${targetName} has not confirmed it yet.` };
}

function humanProvider(provider: string) {
  return provider.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}


/* ------------------------------------------------------------------ */
/* 3. Timezone-aware formatting (DST correct via Intl)                  */
/* ------------------------------------------------------------------ */

export const FALLBACK_TZ = "Australia/Sydney";

function safeTz(tz: string | null | undefined) {
  if (!tz) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return FALLBACK_TZ;
  }
}

function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function tzFormat(value: string | Date | null | undefined, tz: string | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  const d = asDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-AU", { timeZone: safeTz(tz), ...opts }).format(d);
}

export const tzDateTime = (v: string | Date | null | undefined, tz?: string | null) =>
  tzFormat(v, tz, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
export const tzDate = (v: string | Date | null | undefined, tz?: string | null) =>
  tzFormat(v, tz, { day: "numeric", month: "short", year: "numeric" });
export const tzTime = (v: string | Date | null | undefined, tz?: string | null) =>
  tzFormat(v, tz, { hour: "numeric", minute: "2-digit" });
export const tzWeekday = (v: string | Date | null | undefined, tz?: string | null) =>
  tzFormat(v, tz, { weekday: "long", day: "numeric", month: "short" });

/** Short timezone name, e.g. AEDT / AEST, resolved for that instant (DST aware). */
export function tzAbbrev(value: string | Date | null | undefined, tz?: string | null): string {
  const d = asDate(value) ?? new Date();
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: safeTz(tz), timeZoneName: "short" }).formatToParts(d);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** Stable YYYY-MM-DD key in the business timezone, for grouping and chart buckets. */
export function tzDayKey(value: string | Date | null | undefined, tz?: string | null): string {
  const d = asDate(value);
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safeTz(tz), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Hour 0-23 in the business timezone. */
export function tzHour(value: string | Date | null | undefined, tz?: string | null): number {
  const d = asDate(value);
  if (!d) return 0;
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: safeTz(tz), hour: "2-digit", hour12: false }).format(d);
  return Number(h) % 24;
}

/** Monday-start ISO week key in the business timezone. */
export function tzWeekKey(value: string | Date | null | undefined, tz?: string | null): string {
  const key = tzDayKey(value, tz);
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const dow = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - dow);
  return utc.toISOString().slice(0, 10);
}

export type LocalInputKind = "ok" | "gap" | "fold" | "invalid";

export interface LocalInputResolution {
  /** ISO instant, or null when the wall-clock time does not exist. */
  iso: string | null;
  kind: LocalInputKind;
  /** User-facing explanation for gap and fold cases. Empty when ordinary. */
  note: string;
}

/**
 * Converts a `datetime-local` form value (which has no zone) into a real
 * instant, interpreting the wall-clock time in the business timezone.
 *
 * Clock changes are handled explicitly:
 * - a time that never happens (clocks jumped forward) is rejected
 * - a time that happens twice (clocks went back) resolves to the first,
 *   earlier occurrence and says so
 */
export function resolveLocalInput(input: string, tz: string | null | undefined): LocalInputResolution {
  if (!input) return { iso: null, kind: "invalid", note: "" };
  const zone = safeTz(tz);
  const naive = Date.parse(`${input}:00Z`);
  if (Number.isNaN(naive)) return { iso: null, kind: "invalid", note: "" };

  const offBefore = zoneOffsetMs(new Date(naive - 86_400_000), zone);
  const offAfter = zoneOffsetMs(new Date(naive + 86_400_000), zone);
  const candidates = Array.from(new Set([naive - offBefore, naive - offAfter])).sort((a, b) => a - b);
  const valid = candidates.filter((c) => zoneOffsetMs(new Date(c), zone) === naive - c);

  if (valid.length === 0) {
    return {
      iso: null,
      kind: "gap",
      note: "That time does not exist on this date because the clocks move forward. Pick a time before or after the change.",
    };
  }
  if (valid.length > 1) {
    return {
      iso: new Date(valid[0]!).toISOString(),
      kind: "fold",
      note: `The clocks go back on this date, so this time happens twice. ${PRODUCT} has used the first, earlier one.`,
    };
  }
  return { iso: new Date(valid[0]!).toISOString(), kind: "ok", note: "" };
}

/** Convenience wrapper. Returns null when the local time does not exist. */
export function localInputToInstant(input: string, tz: string | null | undefined): string | null {
  return resolveLocalInput(input, tz).iso;
}

/** Start of the given day (YYYY-MM-DD) in the business timezone. */
export function tzStartOfDay(dayKey: string, tz: string | null | undefined): Date {
  const r = resolveLocalInput(`${dayKey}T00:00`, tz);
  if (r.iso) return new Date(r.iso);
  // Clocks jumped over midnight: fall back to the first existing minute.
  for (const t of ["T01:00", "T02:00", "T03:00"]) {
    const alt = resolveLocalInput(`${dayKey}${t}`, tz);
    if (alt.iso) return new Date(alt.iso);
  }
  return new Date(`${dayKey}T00:00:00Z`);
}

/** Adds whole days to a YYYY-MM-DD key. */
export function addDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** End of the given day in the business timezone (last millisecond). */
export function tzEndOfDay(dayKey: string, tz: string | null | undefined): Date {
  return new Date(tzStartOfDay(addDayKey(dayKey, 1), tz).getTime() - 1);
}


/** Inverse: renders an instant as a `datetime-local` value in the business timezone. */
export function instantToLocalInput(value: string | Date | null | undefined, tz: string | null | undefined): string {
  const d = asDate(value);
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTz(tz),
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

function zoneOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - date.getTime();
}

/* ------------------------------------------------------------------ */
/* 4. Needs attention inbox                                             */
/* ------------------------------------------------------------------ */

/** Follow-up statuses that mean nobody needs to chase it any more. */
export const DONE_FOLLOW_UP_STATUSES = ["done", "resolved", "completed", "closed"];

export function isFollowUpDone(status: string | null | undefined): boolean {
  return DONE_FOLLOW_UP_STATUSES.includes((status ?? "").trim().toLowerCase());
}

export type AttentionKind = "call" | "followup" | "knowledge" | "sync" | "number";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  when: string | null;
  severity: "warning" | "danger";
  /** Where the customer should go to act on it. */
  href: string;
  /** Optional search params for the destination route. */
  search?: Record<string, string>;
  actionLabel: string;
}

export interface AttentionInput {
  calls: CallListRow[];
  appointments: Appointment[];
  leads: Lead[];
  unanswered: UnansweredQuestion[];
  integrations: Integration[];
  numbers: PhoneNumber[];
  timezone?: string | null;
  now?: Date;
}

export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const now = input.now ?? new Date();
  const out: AttentionItem[] = [];

  for (const c of input.calls) {
    if (c.status === "missed" || c.status === "failed") {
      out.push({
        id: `call:${c.id}`,
        kind: "call",
        title: c.status === "missed" ? "Missed call" : "Call failed",
        detail: `${c.contact?.full_name ?? c.from_number ?? "Unknown caller"}: ${c.error_message ?? "No one picked up and nothing was captured."}`,
        when: c.started_at,
        severity: c.status === "failed" ? "danger" : "warning",
        href: "/app/calls",
        search: { call: c.id },
        actionLabel: "Open call",
      });
    }
  }

  for (const l of input.leads) {
    if (!l.follow_up_at) continue;
    if (l.stage === "won" || l.stage === "lost") continue;
    if (isFollowUpDone(l.follow_up_status)) continue;
    if (new Date(l.follow_up_at).getTime() >= now.getTime()) continue;
    out.push({
      id: `lead:${l.id}`,
      kind: "followup",
      title: "Follow-up overdue",
      detail: `${l.name ?? "Unnamed enquiry"}: ${l.enquiry ?? l.intent ?? "No details captured."}`,
      when: l.follow_up_at,
      severity: "warning",
      href: "/app/leads",
      search: { lead: l.id },
      actionLabel: "Open follow-up",
    });
  }

  for (const u of input.unanswered) {
    if (u.status !== "open") continue;
    out.push({
      id: `question:${u.id}`,
      kind: "knowledge",
      title: "Question your receptionist could not answer",
      detail: `"${u.question}" asked ${u.occurrences} time${u.occurrences === 1 ? "" : "s"}.`,
      when: u.updated_at,
      severity: "warning",
      href: "/app/knowledge",
      search: { question: u.id },
      actionLabel: "Add an answer",
    });
  }

  for (const i of input.integrations) {
    if (i.status !== "error") continue;
    out.push({
      id: `integration:${i.id}`,
      kind: "sync",
      title: `${i.display_name ?? i.provider} is not syncing`,
      detail: i.last_error ?? "The connection stopped working, so new bookings are not reaching it.",
      when: i.updated_at,
      severity: "danger",
      href: "/app/integrations",
      actionLabel: "Review connection",
    });
  }

  const cal = calendarConnection(input.integrations);
  for (const a of input.appointments) {
    const sync = bookingSync(a, cal);
    if (sync.state !== "failed") continue;
    out.push({
      id: `appointment:${a.id}`,
      kind: "sync",
      title: "Booking did not reach your calendar",
      detail: `${a.customer_name ?? "Customer"}: ${a.service ?? "Appointment"} on ${tzDateTime(a.starts_at, input.timezone)}.`,
      when: a.starts_at,
      severity: "danger",
      href: "/app/bookings",
      search: { booking: a.id },
      actionLabel: "Open booking",
    });
  }

  for (const n of input.numbers) {
    if (!n.health || n.health === "healthy") continue;
    out.push({
      id: `number:${n.id}`,
      kind: "number",
      title: `${n.friendly_name ?? n.e164} is ${n.health}`,
      detail: "Calls to this number may not connect to your receptionist.",
      when: n.last_health_check_at,
      severity: "danger",
      href: "/app/phone-numbers",
      actionLabel: "Check call handling",
    });
  }

  return out.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "danger" ? -1 : 1;
    return (b.when ?? "").localeCompare(a.when ?? "");
  });
}

/* ------------------------------------------------------------------ */
/* 5. Setup checklist based on real prerequisites                       */
/* ------------------------------------------------------------------ */

export interface ChecklistStep {
  id: string;
  title: string;
  description: string;
  done: boolean;
  /** True when Answered staff must complete it, not the customer. */
  staffOwned: boolean;
  href: string;
  actionLabel: string;
}

export interface ChecklistInput {
  business: Business | null;
  agent: (Agent & Record<string, unknown>) | null;
  numbers: PhoneNumber[];
  knowledge: KnowledgeItem[];
  integrations: Integration[];
}

export function buildSetupChecklist(input: ChecklistInput): { steps: ChecklistStep[]; complete: number; total: number; readyForCalls: boolean } {
  const { business, agent, numbers, knowledge, integrations } = input;
  const publishedKnowledge = knowledge.filter((k) => k.status === "published");
  const liveNumber = numbers.find((n) => n.status === "active" && (n.routing_mode === "ai_receptionist" || n.routing_mode === "ai_after_hours"));
  const cal = calendarConnection(integrations);

  const steps: ChecklistStep[] = [
    {
      id: "business",
      title: "Confirm your business details",
      description: "Name, timezone, opening hours and the number we transfer to.",
      done: !!business?.name && !!business?.timezone && !!business?.business_hours,
      staffOwned: false,
      href: "/app/settings",
      actionLabel: "Open settings",
    },
    {
      id: "receptionist",
      title: "Write your greeting and personality",
      description: "How your receptionist answers and what it should say.",
      done: !!agent?.greeting && !!agent?.business_context,
      staffOwned: false,
      href: "/app/receptionist",
      actionLabel: "Edit receptionist",
    },
    {
      id: "knowledge",
      title: "Add your business knowledge",
      description: "Services, pricing and the questions callers ask most.",
      done: publishedKnowledge.length >= 3,
      staffOwned: false,
      href: "/app/knowledge",
      actionLabel: "Add knowledge",
    },
    {
      id: "telephony",
      title: "Connect your phone number",
      description: `${PRODUCT} staff provision the number and point it at your receptionist.`,
      done: !!liveNumber,
      staffOwned: true,
      href: "/app/phone-numbers",
      actionLabel: "View call handling",
    },
    {
      id: "activation",
      title: "Take your receptionist live",
      description: "Activation happens once the number and provider routing are verified.",
      done: receptionistReadiness(agent ?? null, numbers).liveOnCalls,
      staffOwned: true,
      href: "/app/receptionist",
      actionLabel: "See status",
    },
    {
      id: "calendar",
      title: "Connect your calendar (optional)",
      description: `Bookings land straight in your calendar instead of ${PRODUCT} only.`,
      done: cal.connected,
      staffOwned: false,
      href: "/app/integrations",
      actionLabel: "Connect",
    },
  ];

  const required = steps.filter((s) => s.id !== "calendar");
  return {
    steps,
    complete: steps.filter((s) => s.done).length,
    total: steps.length,
    readyForCalls: required.every((s) => s.done),
  };
}

/* ------------------------------------------------------------------ */
/* 6. Receptionist readiness (configured vs actually taking calls)      */
/* ------------------------------------------------------------------ */

export type ReadinessLevel = "not_configured" | "configured" | "provisioning" | "live" | "paused";

export interface Readiness {
  level: ReadinessLevel;
  label: string;
  /** Plain-language explanation that never contradicts the agent status. */
  detail: string;
  tone: "muted" | "warning" | "success" | "info";
  /** True only when routing evidence shows a live provider connection. */
  liveOnCalls: boolean;
}

/**
 * `routing_status` is free text in the database. Only these values are written
 * by existing provisioning code, and only "live"/"routed" count as evidence
 * that the provider is actually carrying calls. "not_connected" is never live.
 */
const ROUTING_LIVE = new Set(["live", "routed"]);
const ROUTING_IN_PROGRESS = new Set(["connected", "pending", "provisioning"]);

export function receptionistReadiness(
  agent: (Agent & { routing_status?: string | null }) | null,
  numbers: PhoneNumber[],
  opts?: { isDemo?: boolean },
): Readiness {
  const sample = opts?.isDemo ? " Sample workspace, nothing here is a real phone line." : "";
  if (!agent) {
    return { level: "not_configured", label: "Not set up", detail: `Your receptionist has not been created yet.${sample}`, tone: "muted", liveOnCalls: false };
  }
  const configured = !!agent.greeting && !!agent.business_context;
  // The number must belong to this exact agent, be active, and routed to the
  // AI. Anything else is not evidence that calls reach the receptionist.
  const routedNumber = numbers.find(
    (n) =>
      n.agent_id === agent.id &&
      n.status === "active" &&
      (n.routing_mode === "ai_receptionist" || n.routing_mode === "ai_after_hours"),
  );
  // A live claim additionally needs a positively healthy number and the
  // provider identifiers that provisioning writes. Null, unknown or degraded
  // health is never treated as healthy.
  const providerNumberId = (routedNumber as { provider_number_id?: string | null } | undefined)?.provider_number_id;
  const providerAgentId = (agent as { provider_agent_id?: string | null }).provider_agent_id;
  const liveEvidence = !!routedNumber && routedNumber.health === "healthy" && !!providerNumberId && !!providerAgentId;
  const routing = (agent.routing_status ?? "not_connected").toLowerCase();

  if (agent.status === "paused" || agent.status === "disabled") {
    return {
      level: "paused",
      label: agent.status === "paused" ? "Paused" : "Disabled",
      detail: `Your settings are saved, but the receptionist is not answering calls while it is ${agent.status}.${sample}`,
      tone: "warning",
      liveOnCalls: false,
    };
  }
  if (agent.status === "active" && liveEvidence && ROUTING_LIVE.has(routing)) {
    return {
      level: "live",
      label: "Answering calls",
      detail: `${routedNumber!.friendly_name ?? routedNumber!.e164} is routed to this receptionist and the provider reports it as ${routing}.${sample}`,
      tone: "success",
      liveOnCalls: true,
    };
  }
  if (routedNumber || ROUTING_IN_PROGRESS.has(routing)) {

    return {
      level: "provisioning",
      label: "Being connected",
      detail: `Your settings are saved. The phone connection is not confirmed live yet, so calls are not reaching it.${sample}`,
      tone: "info",
      liveOnCalls: false,
    };
  }
  if (configured) {
    return {
      level: "configured",
      label: "Configured, not live",
      detail: `Your settings are saved. No number is routed to this receptionist yet, so it is not taking calls.${sample}`,
      tone: "warning",
      liveOnCalls: false,
    };
  }
  return { level: "not_configured", label: "Needs setup", detail: `Add a greeting and your business details to finish setup.${sample}`, tone: "muted", liveOnCalls: false };
}

/* ------------------------------------------------------------------ */
/* 6b. Canonical transfer number                                        */
/* ------------------------------------------------------------------ */

export interface ResolvedTransfer {
  number: string | null;
  source: "receptionist" | "business" | "none";
  label: string;
}

/**
 * The business fallback is canonical. A receptionist may carry an explicit
 * override, which is preserved and clearly attributed rather than discarded.
 */
export function resolveTransferNumber(businessNumber: string | null | undefined, agentNumber: string | null | undefined): ResolvedTransfer {
  const agentVal = (agentNumber ?? "").trim();
  const bizVal = (businessNumber ?? "").trim();
  if (agentVal) return { number: agentVal, source: "receptionist", label: "Override set on this receptionist" };
  if (bizVal) return { number: bizVal, source: "business", label: "Business fallback from Settings" };
  return { number: null, source: "none", label: "No transfer number set" };
}

/* ------------------------------------------------------------------ */
/* 7. Usage and spend alerts                                            */
/* ------------------------------------------------------------------ */

export interface UsageThresholds {
  /** Percent of included minutes at which to warn, 1-100. */
  minutesWarnPct: number;
  /** Estimated monthly spend, in cents, at which to warn. Null disables. */
  spendWarnCents: number | null;
}

export const DEFAULT_USAGE_THRESHOLDS: UsageThresholds = { minutesWarnPct: 80, spendWarnCents: null };

export function readUsageThresholds(business: Business | null): UsageThresholds {
  const prefs = (business?.notification_prefs ?? {}) as Record<string, unknown>;
  const raw = (prefs["usage_alerts"] ?? {}) as Record<string, unknown>;
  const pct = Number(raw["minutes_warn_pct"]);
  const spend = raw["spend_warn_cents"];
  return {
    minutesWarnPct: Number.isFinite(pct) && pct > 0 && pct <= 100 ? Math.round(pct) : DEFAULT_USAGE_THRESHOLDS.minutesWarnPct,
    spendWarnCents: typeof spend === "number" && Number.isFinite(spend) && spend > 0 ? Math.round(spend) : null,
  };
}

/**
 * Returns the full preferences object with usage alerts replaced and every
 * other stored preference preserved, including keys this app does not know.
 */
export function writeUsageThresholds(business: Business | null, next: UsageThresholds): Record<string, unknown> {
  const prefs = { ...((business?.notification_prefs ?? {}) as Record<string, unknown>) };
  const existing = (prefs["usage_alerts"] ?? {}) as Record<string, unknown>;
  prefs["usage_alerts"] = { ...existing, minutes_warn_pct: next.minutesWarnPct, spend_warn_cents: next.spendWarnCents };
  return prefs;
}

/** Merge known preference toggles into stored prefs without dropping unknown keys. */
export function mergeNotificationPrefs(business: Business | null, known: Record<string, boolean>): Record<string, unknown> {
  return { ...((business?.notification_prefs ?? {}) as Record<string, unknown>), ...known };
}

/* --- Billing period usage ------------------------------------------- */

export interface UsageRowLike {
  kind: string;
  quantity: number | string;
  period_start: string;
  period_end: string;
}

export interface BillingPeriodUsage {
  from: Date;
  to: Date;
  /** False when the subscription has no stated period and a 30 day window is used. */
  fromSubscription: boolean;
  minutes: number;
  sms: number;
  numbers: number;
  transferMinutes: number;
  /** True when a counted usage row straddles the period boundary, so totals are approximate. */
  partialBoundary: boolean;
}

/**
 * Usage measured against the subscription billing period, never the dashboard
 * date filter. Rows are counted when they overlap the period. Usage rows have
 * no daily detail, so a row that straddles a boundary is counted in full and
 * flagged, rather than silently presented as an exact period total.
 */
export function billingPeriodUsage(
  rows: UsageRowLike[],
  subscription: { current_period_start?: string | null; current_period_end?: string | null } | null,
): BillingPeriodUsage {
  const now = Date.now();
  const startRaw = subscription?.current_period_start ? new Date(subscription.current_period_start) : null;
  const endRaw = subscription?.current_period_end ? new Date(subscription.current_period_end) : null;
  const fromSubscription = !!startRaw && !Number.isNaN(startRaw.getTime());
  const from = fromSubscription ? (startRaw as Date) : new Date(now - 30 * 86_400_000);
  const to = endRaw && !Number.isNaN(endRaw.getTime()) ? endRaw : new Date(now);

  let partialBoundary = false;
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const counted = rows.filter((r) => {
    const s = new Date(r.period_start).getTime();
    const e = new Date(r.period_end).getTime();
    const rs = Number.isNaN(s) ? e : s;
    const re = Number.isNaN(e) ? rs : e;
    // Half open interval: the start of the period is included, the end is not.
    // A period that ends exactly at this period's start belongs to the previous
    // period, and one starting exactly at the end belongs to the next.
    const overlaps = rs === re ? rs >= fromMs && rs < toMs : re > fromMs && rs < toMs;
    if (overlaps && (rs < fromMs || re > toMs)) partialBoundary = true;
    return overlaps;
  });

  const sum = (kind: string) => counted.filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.quantity), 0);
  return {
    from,
    to,
    fromSubscription,
    minutes: sum("call_minutes"),
    sms: sum("sms"),
    numbers: sum("phone_number"),
    transferMinutes: sum("transfer_minutes"),
    partialBoundary,
  };
}

export interface UsageSummary {
  includedMinutes: number | null;
  usedMinutes: number;
  usedPct: number | null;
  overageMinutes: number;
  /** Estimated, not billed. Null when the overage rate is unknown. */
  estimatedOverageCents: number | null;
  /** False when the plan does not state an overage rate at all. */
  overageRateKnown: boolean;
  planCents: number | null;
  currency: string;
  overMinutes: boolean;
  overSpend: boolean;
  /** True when the figures come from metered usage rows rather than a real invoice. */
  estimateOnly: boolean;
}

export function summariseUsage(
  plan: { included_minutes: number; overage_minute_cents: number | null; price_cents: number; currency: string } | null,
  usedMinutes: number,
  thresholds: UsageThresholds,
): UsageSummary {
  const included = plan?.included_minutes ?? null;
  const usedPct = included && included > 0 ? usedMinutes / included : null;
  const overageMinutes = included ? Math.max(0, usedMinutes - included) : 0;
  const rate = plan?.overage_minute_cents;
  // A missing rate is unknown; a rate of zero means included at no extra cost.
  const overageRateKnown = typeof rate === "number" && Number.isFinite(rate);
  const estimatedOverageCents = overageRateKnown ? Math.round(overageMinutes * (rate as number)) : null;
  const estimatedTotal = estimatedOverageCents == null ? null : (plan?.price_cents ?? 0) + estimatedOverageCents;
  return {
    includedMinutes: included,
    usedMinutes,
    usedPct,
    overageMinutes,
    estimatedOverageCents,
    overageRateKnown,
    planCents: plan?.price_cents ?? null,
    currency: plan?.currency ?? "AUD",
    overMinutes: usedPct != null && usedPct * 100 >= thresholds.minutesWarnPct,
    // A spend alert can only fire on a known amount.
    overSpend: thresholds.spendWarnCents != null && estimatedTotal != null && estimatedTotal >= thresholds.spendWarnCents,
    estimateOnly: true,
  };
}



/* ------------------------------------------------------------------ */
/* 8. Demo workspace presentation                                       */
/* ------------------------------------------------------------------ */

/**
 * Demo data was seeded call-first and booking-first separately, so a demo
 * call could describe a different service, person or time than the booking
 * it is linked to. This aligns what is shown, for demo workspaces only.
 * Nothing is written back: real customer records are never rewritten, and a
 * non-demo call is returned untouched.
 */
interface DemoApptLike {
  starts_at?: string | null;
  service?: string | null;
  staff_name?: string | null;
  customer_name?: string | null;
}

/** The one sentence summary a demo call and its booking must agree on. */
export function demoCallSummary(appt: DemoApptLike, tz: string | null | undefined, fallbackName?: string | null): string {
  const name = appt.customer_name || fallbackName || "the caller";
  const service = appt.service || "an appointment";
  const when = appt.starts_at ? `${tzWeekday(appt.starts_at, tz)} at ${tzTime(appt.starts_at, tz)}` : "a time that suits them";
  const withStaff = appt.staff_name ? ` with ${appt.staff_name}` : "";
  return `${name} called to book ${service}${withStaff}. The receptionist confirmed ${when} and captured their contact details.`;
}

export const DEMO_PRESENTATION_NOTE =
  "Sample workspace: this summary and transcript are generated sample content that matches the sample booking, not a captured recording of a real call.";

export function normaliseDemoCallDetail(call: CallDetail): CallDetail {
  if (!call.business?.is_demo) return call;
  const appt = call.appointments?.[0];
  if (!appt) return call;

  const tz = call.business.timezone;
  const name = appt.customer_name || call.contact?.full_name || "the caller";
  const service = appt.service || "an appointment";
  const when = appt.starts_at ? `${tzWeekday(appt.starts_at, tz)} at ${tzTime(appt.starts_at, tz)}` : "a time that suits them";
  const withStaff = appt.staff_name ? ` with ${appt.staff_name}` : "";
  const summary = demoCallSummary(appt, tz, call.contact?.full_name);

  // The seeded transcript can describe a different person, service or time
  // than the booking it is linked to, so it is always replaced here for demo
  // workspaces. The stored rows are never changed.
  const segments = [
    { speaker: "caller", text: `Hi, I'd like to book ${service} please.` },
    { speaker: "agent", text: `Of course. Can I take your name?` },
    { speaker: "caller", text: `It's ${name}.` },
    { speaker: "agent", text: `Thanks ${name}. What is the best contact number for you?` },
    { speaker: "caller", text: "It's 0400 000 000." },
    { speaker: "agent", text: `Thank you. I have ${when}${withStaff} available. Does that suit?` },
    { speaker: "caller", text: "That works, thank you." },
    { speaker: "agent", text: `Lovely, you're booked in for ${service} on ${when}${withStaff}. See you then.` },
  ].map((seg, i) => ({
    id: `${call.id}-sample-${i}`,
    call_id: call.id,
    business_id: call.business_id,
    seq: i,
    speaker: seg.speaker,
    text: seg.text,
    started_ms: i * 6000,
    ended_ms: i * 6000 + 5000,
    confidence: null,
    created_at: call.started_at,
  }));

  const generated = true;


  return {
    ...call,
    summary,
    intent: call.intent ?? "Booking",
    transcript_segments: segments,
    demo_presentation: { generated, note: DEMO_PRESENTATION_NOTE },
  };
}

/**
 * List rows show the same aligned summary as the detail view, so a demo call
 * and its booking never disagree. Real calls are returned untouched.
 */
export function normaliseDemoCallListRow<
  T extends {
    summary?: string | null;
    business?: { is_demo?: boolean | null; timezone?: string | null } | null;
    contact?: { full_name?: string | null } | null;
    appointments?: DemoApptLike[] | null;
  },
>(row: T): T {
  if (!row.business?.is_demo) return row;
  const appt = row.appointments?.[0];
  if (!appt) return row;
  return { ...row, summary: demoCallSummary(appt, row.business.timezone, row.contact?.full_name) };
}


/* ------------------------------------------------------------------ */
/* 9. Form drafts across background refreshes                           */
/* ------------------------------------------------------------------ */

/**
 * A background refetch of the workspace must not throw away what someone is
 * typing. Each top level field is refreshed only when it is untouched, that is
 * when the draft still equals the last known saved value.
 */
export function mergeFormOnRefresh<T extends Record<string, unknown>>(prev: T, baseline: T, next: T): T {
  const out: Record<string, unknown> = { ...prev };
  for (const key of Object.keys(next)) {
    if (JSON.stringify(prev[key]) === JSON.stringify(baseline[key])) out[key] = next[key];
  }
  return out as T;
}

/** Refresh a single text input only when it has not been edited. */
export function mergeFieldOnRefresh(current: string, baseline: string, next: string): string {
  return current === baseline ? next : current;
}
