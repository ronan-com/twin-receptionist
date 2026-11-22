import { addDayKey, tzDayKey, tzEndOfDay, tzStartOfDay } from "./business-logic";

export type RangePreset = "today" | "7d" | "30d" | "90d";

export const RANGE_PRESETS: { value: RangePreset; label: string; short: string }[] = [
  { value: "today", label: "Today", short: "Today" },
  { value: "7d", label: "Last 7 days", short: "7d" },
  { value: "30d", label: "Last 30 days", short: "30d" },
  { value: "90d", label: "Last 90 days", short: "90d" },
];

export interface ResolvedRange {
  preset: RangePreset;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  days: number;
  label: string;
  /** Timezone the boundaries were resolved in. */
  timezone: string;
}

/**
 * Day boundaries are resolved in the business timezone, not the browser's, so
 * "Today" means the business day wherever the person happens to be sitting.
 */
export function resolveRange(preset: RangePreset, timezone?: string | null, now = new Date()): ResolvedRange {
  const days = preset === "today" ? 1 : preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const todayKey = tzDayKey(now, timezone);
  const fromKey = addDayKey(todayKey, -(days - 1));
  const prevToKey = addDayKey(fromKey, -1);
  const prevFromKey = addDayKey(prevToKey, -(days - 1));
  const label = RANGE_PRESETS.find((p) => p.value === preset)?.label ?? preset;
  return {
    preset,
    from: tzStartOfDay(fromKey, timezone),
    to: tzEndOfDay(todayKey, timezone),
    prevFrom: tzStartOfDay(prevFromKey, timezone),
    prevTo: tzEndOfDay(prevToKey, timezone),
    days,
    label,
    timezone: timezone || "",
  };
}

export function isRangePreset(value: unknown): value is RangePreset {
  return value === "today" || value === "7d" || value === "30d" || value === "90d";
}
