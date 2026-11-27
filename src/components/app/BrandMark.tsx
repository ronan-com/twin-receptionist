import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { NEUTRAL_DASHBOARD, PRODUCT } from "@/lib/app/product";

const BARS = [3, 6, 10, 14, 10, 6, 3];

export function BrandWave({ className, animate = false }: { className?: string; animate?: boolean }) {
  if (NEUTRAL_DASHBOARD) return null;
  return (
    <span className={cn("inline-flex items-end gap-[2px]", className)} aria-hidden>
      {BARS.map((h, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-indigo"
          style={{
            height: h,
            transformOrigin: "bottom",
            animation: animate ? `wave 1.4s ease-in-out ${i * 0.09}s infinite` : undefined,
          }}
        />
      ))}
    </span>
  );
}

export function BrandMark({
  to = "/app",
  className,
  size = "md",
  suffix,
  name,
}: {
  to?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  suffix?: string;
  name?: string;
}) {
  const text = size === "lg" ? "text-2xl" : size === "sm" ? "text-[15px]" : "text-lg";
  return (
    <Link to={to} className={cn("group inline-flex items-center gap-2.5 outline-none", className)}>
      <BrandWave className="h-[14px]" />
      <span className={cn("whitespace-nowrap font-semibold tracking-[-0.02em] text-ink", text)}>
        {name || PRODUCT}
        {suffix ? <span className="ml-1.5 font-medium text-ink-muted/70">{suffix}</span> : null}
      </span>
    </Link>
  );
}
