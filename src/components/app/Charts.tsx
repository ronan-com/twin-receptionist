import { type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
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

const AXIS = { fontSize: 11, fill: CHART_COLORS.slate } as const;
const GRID = { stroke: CHART_COLORS.hairline, strokeDasharray: "0", vertical: false } as const;

type TooltipPayload = { name?: string; value?: number | string; color?: string; dataKey?: string; payload?: Record<string, unknown> }[];

function ChartTip({ active, payload, label, formatter }: { active?: boolean; payload?: TooltipPayload; label?: string; formatter?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[6px] border border-hairline bg-white px-3 py-2 text-[12px] shadow-[0_6px_24px_-8px_rgba(6,27,49,0.25)]">
      {label ? <div className="mb-1 font-semibold text-ink">{label}</div> : null}
      <div className="space-y-0.5">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-ink-muted">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color ?? CHART_COLORS.indigo }} />
              {p.name}
            </span>
            <span className="font-medium tabular-nums text-ink">{formatter ? formatter(Number(p.value)) : fmtNumber(Number(p.value))}</span>
          </div>
        ))}
      </div>
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
      <header className="flex items-start justify-between gap-3 px-4 pb-1 pt-3.5">
        <div>
          <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
          {description ? <p className="mt-0.5 text-[12px] text-ink-muted">{description}</p> : null}
        </div>
        <div className="flex items-center gap-3">
          {legend ? (
            <div className="hidden items-center gap-3 sm:flex">
              {legend.map((l) => (
                <span key={l.label} className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: l.color }} />
                  {l.label}
                </span>
              ))}
            </div>
          ) : null}
          {actions}
        </div>
      </header>
      <div className="px-2 pb-2" style={{ height }}>
        {empty ? <EmptyState compact title="No data for this period" description="Metrics will appear here as calls come in." /> : children}
      </div>
    </section>
  );
}

export function CallVolumeChart({ data }: { data: DailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="volFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.indigo} stopOpacity={0.22} />
            <stop offset="100%" stopColor={CHART_COLORS.indigo} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="ansFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.cyan} stopOpacity={0.18} />
            <stop offset="100%" stopColor={CHART_COLORS.cyan} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTip />} cursor={{ stroke: CHART_COLORS.hairline }} />
        <Area type="monotone" dataKey="total" name="Calls" stroke={CHART_COLORS.indigo} strokeWidth={2} fill="url(#volFill)" />
        <Area type="monotone" dataKey="answered" name="Answered" stroke={CHART_COLORS.cyan} strokeWidth={1.5} fill="url(#ansFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DirectionChart({ data }: { data: DailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(6,27,49,0.04)" }} />
        <Bar dataKey="inbound" name="Inbound" stackId="d" fill={CHART_COLORS.indigo} radius={[0, 0, 0, 0]} />
        <Bar dataKey="outbound" name="Outbound" stackId="d" fill={CHART_COLORS.soft} radius={[3, 3, 0, 0]} />
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
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="92%" paddingAngle={1.5} stroke="none">
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
      <ul className="flex-1 space-y-1.5 text-[12px]">
        {data.slice(0, 6).map((d) => (
          <li key={d.key} className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-muted">
              <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: d.color }} />
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
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTip />} cursor={{ stroke: CHART_COLORS.hairline }} />
        <Line type="monotone" dataKey="bookings" name="Bookings" stroke={CHART_COLORS.cyan} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
        <Line type="monotone" dataKey="leads" name="Leads" stroke={CHART_COLORS.magenta} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PeakHoursChart({ data }: { data: HourlyPoint[] }) {
  const max = Math.max(0, ...data.map((d) => d.count));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={2} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(6,27,49,0.04)" }} />
        <Bar dataKey="count" name="Calls" radius={[3, 3, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.hour} fill={d.count === max && max > 0 ? CHART_COLORS.indigoDeep : d.afterHours > d.count / 2 ? CHART_COLORS.soft : CHART_COLORS.indigo} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SimpleBarChart({ data, color = CHART_COLORS.indigo, name = "Calls" }: { data: { label: string; count: number }[]; color?: string; name?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(6,27,49,0.04)" }} />
        <Bar dataKey="count" name={name} fill={color} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StackedStatusChart({ data }: { data: DailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(6,27,49,0.04)" }} />
        <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, color: CHART_COLORS.slate }} />
        <Bar dataKey="answered" name="Answered" stackId="s" fill={CHART_COLORS.indigo} />
        <Bar dataKey="missed" name="Missed" stackId="s" fill={CHART_COLORS.coral} />
        <Bar dataKey="failed" name="Failed" stackId="s" fill={CHART_COLORS.magenta} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal ranked bars (no recharts) — great for intents and categories. */
export function RankedBars({ data, className, valueLabel = (v) => fmtNumber(v) }: { data: BreakdownPoint[]; className?: string; valueLabel?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <EmptyState compact title="No data yet" />;
  return (
    <ul className={cn("space-y-2.5", className)}>
      {data.map((d) => (
        <li key={d.key}>
          <div className="mb-1 flex items-center justify-between text-[12.5px]">
            <span className="truncate text-ink">{d.name}</span>
            <span className="shrink-0 tabular-nums text-ink-muted">{valueLabel(d.value)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas-2">
            <div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: d.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Sparkline({ data, color = CHART_COLORS.indigo, height = 36 }: { data: number[]; color?: string; height?: number }) {
  const rows = data.map((v, i) => ({ i, v }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#spark-${color.replace("#", "")})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
