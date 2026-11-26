import { format, formatDistanceToNowStrict, isToday, isYesterday, parseISO } from "date-fns";
import { formatNumber } from "@/lib/shared";

const nf = new Intl.NumberFormat("en-AU");

export function fmtNumber(n: number | null | undefined, opts?: Intl.NumberFormatOptions) {
  if (n == null || Number.isNaN(n)) return "—";
  return opts ? new Intl.NumberFormat("en-AU", opts).format(n) : nf.format(n);
}

export function fmtCompact(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) < 10000) return nf.format(n);
  return new Intl.NumberFormat("en-AU", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function fmtPercent(ratio: number | null | undefined, digits = 0) {
  if (ratio == null || Number.isNaN(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function fmtDuration(seconds: number | null | undefined) {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}

export function fmtHours(seconds: number | null | undefined, digits = 1) {
  if (seconds == null) return "—";
  return `${(seconds / 3600).toFixed(digits)}h`;
}

export function fmtMinutes(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  return `${nf.format(Math.round(seconds / 60))} min`;
}

export function fmtCurrency(cents: number | null | undefined, currency = "AUD") {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: 2 }).format(
    cents / 100,
  );
}

function toDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const date = typeof d === "string" ? parseISO(d) : d;
  return Number.isNaN(date.getTime()) ? null : date;
}

export function fmtDateTime(d: string | Date | null | undefined) {
  const date = toDate(d);
  if (!date) return "—";
  return format(date, "d MMM yyyy, h:mm a");
}

export function fmtDate(d: string | Date | null | undefined) {
  const date = toDate(d);
  if (!date) return "—";
  return format(date, "d MMM yyyy");
}

export function fmtShortDate(d: string | Date | null | undefined) {
  const date = toDate(d);
  if (!date) return "—";
  return format(date, "d MMM");
}

export function fmtTime(d: string | Date | null | undefined) {
  const date = toDate(d);
  if (!date) return "—";
  return format(date, "h:mm a");
}

export function fmtSmartDate(d: string | Date | null | undefined) {
  const date = toDate(d);
  if (!date) return "—";
  if (isToday(date)) return `Today, ${format(date, "h:mm a")}`;
  if (isYesterday(date)) return `Yesterday, ${format(date, "h:mm a")}`;
  return format(date, "d MMM, h:mm a");
}

export function fmtRelative(d: string | Date | null | undefined) {
  const date = toDate(d);
  if (!date) return "—";
  return `${formatDistanceToNowStrict(date)} ago`;
}

export function fmtPhone(value: string | null | undefined) {
  if (!value) return "—";
  // One format per country, the same one the server uses (formatNumber):
  // 0412 345 678, (07) 3123 4567, (212) 555-0123.
  const digits = value.replace(/[^\d+]/g, "");
  const shown = formatNumber(digits);
  return shown === digits ? value : shown;
}

export function titleCase(value: string | null | undefined) {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function humanize(value: string | null | undefined) {
  if (!value) return "—";
  const s = value.replace(/[_.]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function initials(name: string | null | undefined, fallback = "?") {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || fallback;
}

export function truncate(value: string | null | undefined, max = 80) {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function pct(part: number, whole: number) {
  return whole > 0 ? part / whole : 0;
}

export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}
