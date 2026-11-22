import { useId, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Inbox, type LucideIcon, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPercent } from "@/lib/app/format";
import { Skeleton } from "@/components/ui/skeleton";
import { HUE_HEX, hueFor, hueFromString, type Hue } from "./hues";

/* ---------------- Mini sparkline (plain SVG, no chart library) ---------------- */

export function MiniSpark({ data, color = HUE_HEX.indigo, className }: { data: number[]; color?: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const w = 100;
  const h = 28;
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => [i * step, h - 2 - (v / max) * (h - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-full w-full overflow-visible", className)} aria-hidden>
      <defs>
        <linearGradient id={`ms-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={`url(#ms-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ---------------- Page header ---------------- */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <div className="mb-1.5 flex min-w-0 items-center gap-2">
          <span className="ribbon-gradient h-[3px] w-7 shrink-0 rounded-full" aria-hidden />
          {eyebrow ? <span className="truncate text-[12px] font-semibold text-[var(--primary-ink)]">{eyebrow}</span> : null}
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ---------------- Panels ---------------- */

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  padded = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
}) {
  return (
    <section className={cn("panel flex flex-col", className)}>
      {title || actions ? (
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="text-[14px] font-semibold text-ink">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[12px] text-ink-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("min-w-0 flex-1", padded && "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ---------------- Metrics ---------------- */

export function MetricCard({
  label,
  value,
  delta,
  deltaLabel = "vs previous period",
  hint,
  icon: Icon,
  loading,
  invert,
  className,
  hue,
  spark,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  hint?: ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
  /** When true, a decrease is good (missed calls, failures). */
  invert?: boolean;
  className?: string;
  /** Colour for this metric; by default it follows the label's meaning (see hues.ts). */
  hue?: Hue;
  /** Small trend line beside the value (daily counts for the period). */
  spark?: number[];
}) {
  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;
  const h = hue ?? hueFor(label);
  return (
    <div data-hue={h} className={cn("panel hue-tile px-4 py-3.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-ink-muted">{label}</span>
        {Icon ? (
          <span className="hue-icon -my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]" aria-hidden>
            <Icon className="h-[15px] w-[15px]" strokeWidth={1.9} />
          </span>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <div className="mt-1.5 flex min-w-0 items-end justify-between gap-2">
          <div className="metric-value min-w-0 break-words text-[21px] font-semibold leading-tight tracking-[-0.02em] text-ink tabular-nums sm:text-[24px]">{value}</div>
          {spark && spark.length > 1 && spark.some((v) => v > 0) ? (
            <div className="h-7 w-[72px] shrink-0 sm:w-[88px]" aria-hidden>
              <MiniSpark data={spark} color={HUE_HEX[h]} />
            </div>
          ) : null}
        </div>
      )}
      <div className="mt-2 flex min-h-[18px] items-center gap-1.5 text-[11.5px] text-ink-muted">
        {delta == null || loading ? (
          hint ?? (delta === null && !loading ? <span>No prior data</span> : null)
        ) : (
          <>
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-semibold tabular-nums",
                delta === 0 ? "bg-canvas-2 text-ink-muted" : good ? "bg-[#ddf5ea] text-[#0b6142]" : "bg-[#ffe5e3] text-[#a3231b]",
              )}
            >
              {delta === 0 ? <Minus className="h-3 w-3" /> : delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {fmtPercent(Math.abs(delta), Math.abs(delta) < 0.1 ? 1 : 0)}
            </span>
            <span className="truncate">{deltaLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function MetricGrid({ children, className, cols = 4 }: { children: ReactNode; className?: string; cols?: 3 | 4 | 5 | 6 }) {
  const grid = cols === 6 ? "xl:grid-cols-6" : cols === 5 ? "xl:grid-cols-5" : cols === 3 ? "lg:grid-cols-3" : "xl:grid-cols-4";
  return <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3", grid, className)}>{children}</div>;
}

/* ---------------- Empty / loading / error ---------------- */

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact,
  hue,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
  /** Colour of the icon badge; by default it follows the title's meaning. */
  hue?: Hue;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      <div data-hue={hue ?? hueFor(title)} className="hue-icon relative mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] ring-4 ring-[var(--hue-faint)]">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </div>
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-[12.5px] leading-5 text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="panel border-[#ffd0d0] bg-[#fff7f7] px-4 py-3 text-[13px] text-[#a41d1d]">
      <div className="flex items-center justify-between gap-3">
        <span>{message}</span>
        {onRetry ? (
          <button onClick={onRetry} className="rounded-[4px] border border-[#ffd0d0] bg-white px-2 py-1 text-[12px] font-medium hover:bg-[#ffecec]">
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function PageSkeleton({ metrics = 4, rows = 6 }: { metrics?: number; rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: metrics }).map((_, i) => (
          <Skeleton key={i} className="h-[92px]" />
        ))}
      </div>
      <Skeleton className="h-[280px]" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    </div>
  );
}

/* ---------------- Key / value ---------------- */

export function KeyValue({ items, columns = 2, className }: { items: { label: string; value: ReactNode; mono?: boolean }[]; columns?: 1 | 2 | 3; className?: string }) {
  const grid = columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "";
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", grid, className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[11.5px] font-medium text-ink-muted">{it.label}</dt>
          <dd className={cn("mt-0.5 break-words text-[13px] text-ink", it.mono && "font-mono text-[12px]")}>{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- Section label ---------------- */

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted", className)}>{children}</div>;
}

/* ---------------- Inline notice ---------------- */

export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success" | "neutral";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-[#c5e7fb] bg-[#f2f9ff] text-[#0b5d87]",
    warning: "border-[#ffe1b0] bg-[#fff9ee] text-[#8a4b00]",
    danger: "border-[#ffd0d0] bg-[#fff7f7] text-[#a41d1d]",
    success: "border-[#c8eedf] bg-[#f1fbf7] text-[#0e6245]",
    neutral: "border-hairline bg-canvas-2 text-ink",
  } as const;
  return (
    <div className={cn("flex flex-col gap-2 rounded-[6px] border px-3.5 py-2.5 text-[12.5px] leading-5 sm:flex-row sm:items-center sm:justify-between", tones[tone], className)}>
      <div className="min-w-0">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? <div className={cn(title && "opacity-90")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ---------------- Avatar ---------------- */

/** A coloured initials disc; the same name always gets the same colour. The initials
 *  are drawn by CSS (::before), so they never leak into the row's text. */
export function InitialsAvatar({ name, size = 28, className, hue }: { name: string | null | undefined; size?: number; className?: string; hue?: Hue }) {
  const text = (name ?? "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
  return (
    <span
      data-hue={hue ?? hueFromString(name)}
      data-initials={text}
      className={cn("hue-solid inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-[0.01em] before:content-[attr(data-initials)]", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      aria-hidden
    />
  );
}

/* ---------------- Progress bar ---------------- */

export function UsageBar({ value, max, className, color = "bg-indigo" }: { value: number; max: number; className?: string; color?: string }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-canvas-2", className)}>
      <div className={cn("h-full rounded-full transition-[width]", ratio > 0.9 ? "bg-coral" : color)} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
