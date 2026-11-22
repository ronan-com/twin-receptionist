import { parseISO } from "date-fns";
import { addDayKey, tzDayKey, tzFormat, tzHour } from "./business-logic";
import type { Appointment, Call, CallOutcome, Lead } from "./types";
import { CALL_OUTCOME_LABELS, OUTCOME_COLORS } from "./constants";
import { deltaPct, pct } from "./format";

export type CallLite = Pick<
  Call,
  | "id"
  | "direction"
  | "status"
  | "outcome"
  | "started_at"
  | "duration_seconds"
  | "talk_time_seconds"
  | "ai_handled"
  | "transferred"
  | "after_hours"
  | "intent"
  | "sentiment"
  | "error_code"
  | "provider"
  | "business_id"
  | "confidence"
>;

export const ANSWERED_STATUSES = new Set(["completed", "voicemail", "in_progress"]);
export const MISSED_STATUSES = new Set(["missed", "cancelled"]);
export const AI_RESOLVED_OUTCOMES = new Set<CallOutcome>(["resolved", "booked", "lead_captured", "callback_requested"]);

export interface Kpis {
  total: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  failed: number;
  live: number;
  aiResolved: number;
  aiResolutionRate: number;
  transfers: number;
  transferRate: number;
  avgDurationSeconds: number;
  totalTalkSeconds: number;
  afterHoursHandled: number;
  bookings: number;
  leads: number;
  bookingConversion: number;
  leadConversion: number;
  failureRate: number;
  smsSent: number;
  estimatedReceptionHours: number;
  avgHandleSeconds: number;
}

export function computeKpis(
  calls: CallLite[],
  extras: { appointments?: number; leads?: number; smsSent?: number } = {},
): Kpis {
  let inbound = 0,
    outbound = 0,
    answered = 0,
    missed = 0,
    failed = 0,
    live = 0,
    aiResolved = 0,
    transfers = 0,
    afterHoursHandled = 0,
    durationSum = 0,
    durationCount = 0,
    talk = 0;

  for (const c of calls) {
    if (c.direction === "inbound") inbound++;
    else outbound++;
    if (ANSWERED_STATUSES.has(c.status)) answered++;
    if (MISSED_STATUSES.has(c.status)) missed++;
    if (c.status === "failed") failed++;
    if (c.status === "in_progress" || c.status === "ringing" || c.status === "queued") live++;
    if (c.transferred) transfers++;
    if (c.status === "completed" && !c.transferred && c.outcome && AI_RESOLVED_OUTCOMES.has(c.outcome)) aiResolved++;
    if (c.after_hours && ANSWERED_STATUSES.has(c.status)) afterHoursHandled++;
    if (c.status === "completed" && c.duration_seconds) {
      durationSum += c.duration_seconds;
      durationCount++;
    }
    talk += c.talk_time_seconds ?? 0;
  }

  const total = calls.length;
  const completed = calls.filter((c) => c.status === "completed").length;
  const bookings = extras.appointments ?? 0;
  const leads = extras.leads ?? 0;
  // Reception hours handled: talk time plus ~45s of wrap-up a human receptionist would spend per answered call.
  const estimatedReceptionHours = (talk + answered * 45) / 3600;

  return {
    total,
    inbound,
    outbound,
    answered,
    missed,
    failed,
    live,
    aiResolved,
    aiResolutionRate: pct(aiResolved, completed),
    transfers,
    transferRate: pct(transfers, answered),
    avgDurationSeconds: durationCount ? durationSum / durationCount : 0,
    totalTalkSeconds: talk,
    afterHoursHandled,
    bookings,
    leads,
    bookingConversion: pct(bookings, answered),
    leadConversion: pct(leads, answered),
    failureRate: pct(failed, total),
    smsSent: extras.smsSent ?? 0,
    estimatedReceptionHours,
    avgHandleSeconds: durationCount ? (durationSum + durationCount * 45) / durationCount : 0,
  };
}

export type KpiDeltas = Partial<Record<keyof Kpis, number | null>>;

export function compareKpis(current: Kpis, previous: Kpis): KpiDeltas {
  const keys = Object.keys(current) as (keyof Kpis)[];
  const out: KpiDeltas = {};
  for (const k of keys) out[k] = deltaPct(current[k], previous[k]);
  return out;
}

/* ------------------------------------------------------------------ */
/* Series                                                              */
/* ------------------------------------------------------------------ */

export interface DailyPoint {
  date: string;
  label: string;
  total: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  failed: number;
  afterHours: number;
}

/** Inclusive list of YYYY-MM-DD keys between two instants, in the business timezone. */
function dayKeys(from: Date, to: Date, tz?: string | null): string[] {
  const last = tzDayKey(to, tz);
  const out: string[] = [];
  let key = tzDayKey(from, tz);
  for (let i = 0; i < 400 && key <= last; i += 1) {
    out.push(key);
    key = addDayKey(key, 1);
  }
  return out;
}

function dayLabel(key: string, many: boolean, tz?: string | null) {
  const [y, m, d] = key.split("-").map(Number);
  const noon = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12));
  return many
    ? tzFormat(noon, "UTC", { day: "numeric", month: "short" })
    : tzFormat(noon, "UTC", { weekday: "short", day: "numeric" });
}

export function buildDailySeries(calls: CallLite[], from: Date, to: Date, tz?: string | null): DailyPoint[] {
  const days = dayKeys(from, to, tz);
  const map = new Map<string, DailyPoint>();
  const many = days.length > 31;
  for (const key of days) {
    map.set(key, {
      date: key,
      label: dayLabel(key, many, tz),
      total: 0,
      inbound: 0,
      outbound: 0,
      answered: 0,
      missed: 0,
      failed: 0,
      afterHours: 0,
    });
  }
  for (const c of calls) {
    const p = map.get(tzDayKey(c.started_at, tz));
    if (!p) continue;
    p.total++;
    if (c.direction === "inbound") p.inbound++;
    else p.outbound++;
    if (ANSWERED_STATUSES.has(c.status)) p.answered++;
    if (MISSED_STATUSES.has(c.status)) p.missed++;
    if (c.status === "failed") p.failed++;
    if (c.after_hours) p.afterHours++;
  }
  return [...map.values()];
}

export interface HourlyPoint {
  hour: number;
  label: string;
  count: number;
  afterHours: number;
}

export function buildPeakHours(calls: CallLite[], tz?: string | null): HourlyPoint[] {
  const out: HourlyPoint[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`,
    count: 0,
    afterHours: 0,
  }));
  for (const c of calls) {
    const h = tzHour(c.started_at, tz);
    out[h].count++;
    if (c.after_hours) out[h].afterHours++;
  }
  return out;
}

export interface BreakdownPoint {
  key: string;
  name: string;
  value: number;
  color: string;
}

export function buildOutcomeBreakdown(calls: CallLite[]): BreakdownPoint[] {
  const counts = new Map<CallOutcome, number>();
  for (const c of calls) {
    if (!c.outcome) continue;
    counts.set(c.outcome, (counts.get(c.outcome) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, name: CALL_OUTCOME_LABELS[key], value, color: OUTCOME_COLORS[key] }))
    .sort((a, b) => b.value - a.value);
}

const INTENT_PALETTE = ["#635bff", "#00d4ff", "#ff5caa", "#ff7a59", "#8b9bff", "#425466", "#a5f3fc", "#c7c4ff", "#94a3b8"];

export function buildIntentBreakdown(calls: CallLite[], limit = 8): BreakdownPoint[] {
  const counts = new Map<string, number>();
  for (const c of calls) {
    const k = c.intent?.trim() || "Unclassified";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value], i) => ({ key, name: key, value, color: INTENT_PALETTE[i % INTENT_PALETTE.length] }));
}

export interface TrendPoint {
  date: string;
  label: string;
  bookings: number;
  leads: number;
}

export function buildTrendSeries(
  appointments: Pick<Appointment, "created_at">[],
  leads: Pick<Lead, "created_at">[],
  from: Date,
  to: Date,
  tz?: string | null,
): TrendPoint[] {
  const days = dayKeys(from, to, tz);
  const many = days.length > 31;
  const map = new Map<string, TrendPoint>();
  for (const key of days) map.set(key, { date: key, label: dayLabel(key, many, tz), bookings: 0, leads: 0 });
  for (const a of appointments) {
    const p = map.get(tzDayKey(a.created_at, tz));
    if (p) p.bookings++;
  }
  for (const l of leads) {
    const p = map.get(tzDayKey(l.created_at, tz));
    if (p) p.leads++;
  }
  return [...map.values()];
}

export function busiestDay(series: DailyPoint[]): DailyPoint | null {
  return series.reduce<DailyPoint | null>((best, p) => (p.total > (best?.total ?? -1) ? p : best), null);
}

export function busiestHour(hours: HourlyPoint[]): HourlyPoint | null {
  return hours.reduce<HourlyPoint | null>((best, p) => (p.count > (best?.count ?? -1) ? p : best), null);
}

export function weekdayBreakdown(calls: CallLite[], tz?: string | null) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const out = names.map((label, i) => ({ day: i, label, count: 0 }));
  for (const c of calls) {
    const key = tzDayKey(c.started_at, tz);
    if (!key) continue;
    const [y, m, d] = key.split("-").map(Number);
    out[new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay()]!.count++;
  }
  // Monday-first ordering
  return [...out.slice(1), out[0]];
}

export function callsToday(calls: CallLite[], now = new Date(), tz?: string | null) {
  const today = tzDayKey(now, tz);
  return calls.filter((c) => tzDayKey(c.started_at, tz) === today).length;
}

export function isInRange(iso: string, from: Date, to: Date) {
  const t = parseISO(iso).getTime();
  return t >= from.getTime() && t <= to.getTime();
}
