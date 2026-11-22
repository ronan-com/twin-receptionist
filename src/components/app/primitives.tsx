import { type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Inbox, type LucideIcon, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPercent } from "@/lib/app/format";
import { Skeleton } from "@/components/ui/skeleton";

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
        {eyebrow ? <div className="mb-1 text-[12px] font-medium text-ink-muted">{eyebrow}</div> : null}
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
}) {
  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <div className={cn("panel px-4 py-3.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-ink-muted">{label}</span>
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-ink-muted/70" strokeWidth={1.75} /> : null}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <div className="mt-1.5 break-words text-[21px] font-semibold leading-tight tracking-[-0.02em] text-ink tabular-nums sm:text-[24px]">{value}</div>
      )}
      <div className="mt-2 flex min-h-[16px] items-center gap-1.5 text-[11.5px] text-ink-muted">
        {delta == null || loading ? (
          hint ?? (delta === null && !loading ? <span>No prior data</span> : null)
        ) : (
          <>
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-[3px] px-1 py-px font-medium tabular-nums",
                delta === 0 ? "bg-canvas-2 text-ink-muted" : good ? "bg-[#e6f8f1] text-[#0e6245]" : "bg-[#ffecec] text-[#a41d1d]",
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
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-[6px] border border-hairline bg-canvas-2">
        <Icon className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
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

export function InitialsAvatar({ name, size = 28, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const text = (name ?? "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-slate-deep font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      aria-hidden
    >
      {text}
    </span>
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
