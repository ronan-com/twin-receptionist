import { useId, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS } from "@/lib/app/constants";
import type { BreakdownPoint, DailyPoint, HourlyPoint, TrendPoint } from "@/lib/app/metrics";
import { fmtNumber, fmtPercent } from "@/lib/app/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "./primitives";
import { HUE_HEX, SERIES } from "./hues";

const AXIS = { fontSize: 11, fill: CHART_COLORS.slate } as const;
const GRID = { stroke: CHART_COLORS.hairline, strokeDasharray: "3 4", vertical: false } as const;
/** Chart colours for call states (legends must use the same ones). */
export const STATE_COLORS = { answered: CHART_COLORS.indigo, missed: CHART_COLORS.coral, failed: "#e5484d", outbound: HUE_HEX.cyan, afterHours: HUE_HEX.violet, peak: CHART_COLORS.magenta } as const;

type TooltipPayload = { name?: string; value?: number | string; color?: string; dataKey?: string; payload?: Record<string, unknown> }[];

/** A unique, CSS-safe id prefix for this chart's gradients. */
function useGradId() {
  return `g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

/** Soft vertical gradient: the colour at the top fading towards the axis. */
function Fade({ id, color, from = 0.32, to = 0.02 }: { id: string; color: string; from?: number; to?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={from} />
      <stop offset="100%" stopColor={color} stopOpacity={to} />
    </linearGradient>
  );
}

/** Bar gradient: full colour at the top, a lighter tint at the base. */
function BarFade({ id, color }: { id: string; color: string }) {
  return <Fade id={id} color={color} from={1} to={0.55} />;
}

function ChartTip({ active, payload, label, formatter, colors }: { active?: boolean; payload?: TooltipPayload; label?: string; formatter?: (v: number) => string; colors?: Record<string, string> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[8px] border border-hairline bg-[var(--card)] px-3 py-2 text-[12px] shadow-[0_8px_28px_-10px_rgba(6,27,49,0.3)]">
      {label ? <div className="mb-1 font-semibold text-ink">{label}</div> : null}
      <div className="space-y-0.5">
        {payload.map((p, i) => {
          const c = (p.dataKey && colors?.[p.dataKey]) || (p.color && !p.color.startsWith("url(") ? p.color : CHART_COLORS.indigo);
          return (
            <div key={i} className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5 text-ink-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                {p.name}
              </span>
              <span className="font-medium tabular-nums text-ink">{formatter ? formatter(Number(p.value)) : fmtNumber(Number(p.value))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Legend chips: a tinted pill per series, coloured like the series. */
export function LegendChips({ items, className }: { items: { label: string; color: string }[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {items.map((l) => (
        <span
          key={l.label}
          className="inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2 text-[11.5px] font-medium text-ink"
          style={{ background: `color-mix(in srgb, ${l.color} 10%, var(--card))`, borderColor: `color-mix(in srgb, ${l.color} 28%, var(--card))` }}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
          {l.label}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({
  title,
  description,
  children,
  actions,
  className,
  height = 240,
  empty,
  legend,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  height?: number;
  empty?: boolean;
  legend?: { label: string; color: string }[];
}) {
  return (
    <section className={cn("panel flex flex-col", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pb-1 pt-3.5">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
          {description ? <p className="mt-0.5 text-[12px] text-ink-muted">{description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {legend && !empty ? <LegendChips items={legend} /> : null}
          {actions}
        </div>
      </header>
      <div className="px-2 pb-2" style={{ height }}>
        {empty ? <EmptyState compact title="No data for this period" description="Metrics will appear here as calls come in." hue="indigo" /> : children}
      </div>
    </section>
  );
}

export function CallVolumeChart({ data }: { data: DailyPoint[] }) {
  const g = useGradId();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <Fade id={`${g}-vol`} color={CHART_COLORS.indigo} from={0.3} />
          <Fade id={`${g}-ans`} color={HUE_HEX.cyan} from={0.24} />
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTip />} cursor={{ stroke: CHART_COLORS.hairline }} />
        <Area type="monotone" dataKey="total" name="Calls" stroke={CHART_COLORS.indigo} strokeWidth={2.2} fill={`url(#${g}-vol)`} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
        <Area type="monotone" dataKey="answered" name="Answered" stroke={HUE_HEX.cyan} strokeWidth={1.8} fill={`url(#${g}-ans)`} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DirectionChart({ data }: { data: DailyPoint[] }) {
  const g = useGradId();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} barCategoryGap="30%">
        <defs>
          <BarFade id={`${g}-in`} color={CHART_COLORS.indigo} />
          <BarFade id={`${g}-out`} color={STATE_COLORS.outbound} />
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTip colors={{ inbound: CHART_COLORS.indigo, outbound: STATE_COLORS.outbound }} />} cursor={{ fill: "rgba(6,27,49,0.04)" }} />
        <Bar dataKey="inbound" name="Inbound" stackId="d" fill={`url(#${g}-in)`} radius={[0, 0, 0, 0]} />
        <Bar dataKey="outbound" name="Outbound" stackId="d" fill={`url(#${g}-out)`} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OutcomeDonut({ data }: { data: BreakdownPoint[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex h-full items-center gap-4 px-2">
      <div className="relative h-full w-[46%] min-w-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="92%" paddingAngle={2} cornerRadius={3} stroke="none">
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[20px] font-semibold tabular-nums text-ink">{fmtNumber(total)}</span>
          <span className="text-[11px] text-ink-muted">calls</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-[12px]">
        {data.slice(0, 6).map((d) => (
          <li key={d.key} className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-ink">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color, boxShadow: `0 0 0 2px color-mix(in srgb, ${d.color} 22%, var(--card))` }} />
              <span className="truncate">{d.name}</span>
            </span>
            <span className="shrink-0 tabular-nums text-ink">
              {fmtNumber(d.value)} <span className="text-ink-muted">· {fmtPercent(total ? d.value / total : 0)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const g = useGradId();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <Fade id={`${g}-b`} color={HUE_HEX.cyan} from={0.26} />
          <Fade id={`${g}-l`} color={CHART_COLORS.magenta} from={0.22} />
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTip />} cursor={{ stroke: CHART_COLORS.hairline }} />
        <Area type="monotone" dataKey="bookings" name="Bookings" stroke={HUE_HEX.cyan} strokeWidth={2} fill={`url(#${g}-b)`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
        <Area type="monotone" dataKey="leads" name="Leads" stroke={CHART_COLORS.magenta} strokeWidth={2} fill={`url(#${g}-l)`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function PeakHoursChart({ data }: { data: HourlyPoint[] }) {
  const g = useGradId();
  const max = Math.max(0, ...data.map((d) => d.count));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} barCategoryGap="22%">
        <defs>
          <BarFade id={`${g}-n`} color={CHART_COLORS.indigo} />
          <BarFade id={`${g}-p`} color={STATE_COLORS.peak} />
          <BarFade id={`${g}-a`} color={STATE_COLORS.afterHours} />
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={2} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(6,27,49,0.04)" }} />
        <Bar dataKey="count" name="Calls" radius={[3, 3, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.hour} fill={d.count === max && max > 0 ? `url(#${g}-p)` : d.afterHours > d.count / 2 ? `url(#${g}-a)` : `url(#${g}-n)`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SimpleBarChart({ data, color = CHART_COLORS.indigo, name = "Calls" }: { data: { label: string; count: number }[]; color?: string; name?: string }) {
  const g = useGradId();
  const max = Math.max(0, ...data.map((d) => d.count));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} barCategoryGap="30%">
        <defs>
          <BarFade id={`${g}-c`} color={color} />
          <BarFade id={`${g}-m`} color={STATE_COLORS.peak} />
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTip colors={{ count: color }} />} cursor={{ fill: "rgba(6,27,49,0.04)" }} />
        <Bar dataKey="count" name={name} radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={`${d.label}-${i}`} fill={d.count === max && max > 0 ? `url(#${g}-m)` : `url(#${g}-c)`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StackedStatusChart({ data }: { data: DailyPoint[] }) {
  const g = useGradId();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} barCategoryGap="30%">
        <defs>
          <BarFade id={`${g}-a`} color={STATE_COLORS.answered} />
          <BarFade id={`${g}-m`} color={STATE_COLORS.missed} />
          <BarFade id={`${g}-f`} color={STATE_COLORS.failed} />
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTip colors={{ answered: STATE_COLORS.answered, missed: STATE_COLORS.missed, failed: STATE_COLORS.failed }} />} cursor={{ fill: "rgba(6,27,49,0.04)" }} />
        <Bar dataKey="answered" name="Answered" stackId="s" fill={`url(#${g}-a)`} />
        <Bar dataKey="missed" name="Missed" stackId="s" fill={`url(#${g}-m)`} />
        <Bar dataKey="failed" name="Failed" stackId="s" fill={`url(#${g}-f)`} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal ranked bars (no recharts) — great for intents and categories.
 *  Rows that share one colour get the full palette instead, so each reads apart. */
export function RankedBars({ data, className, valueLabel = (v) => fmtNumber(v) }: { data: BreakdownPoint[]; className?: string; valueLabel?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <EmptyState compact title="No data yet" />;
  const oneColour = data.length > 1 && data.every((d) => d.color === data[0].color);
  return (
    <ul className={cn("space-y-2.5", className)}>
      {data.map((d, i) => {
        const color = oneColour ? SERIES[i % SERIES.length] : d.color;
        return (
          <li key={d.key}>
            <div className="mb-1 flex items-center justify-between gap-2 text-[12.5px]">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                <span className="truncate text-ink">{d.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-ink-muted">{valueLabel(d.value)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-canvas-2">
              <div
                className="h-full rounded-full"
                style={{ width: `${(d.value / max) * 100}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 55%, var(--card)), ${color})` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Sparkline({ data, color = CHART_COLORS.indigo, height = 36 }: { data: number[]; color?: string; height?: number }) {
  const g = useGradId();
  const rows = data.map((v, i) => ({ i, v }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <Fade id={`${g}-s`} color={color} from={0.28} to={0} />
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${g}-s)`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
