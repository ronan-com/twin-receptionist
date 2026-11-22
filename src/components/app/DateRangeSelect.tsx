import { RANGE_PRESETS, type RangePreset } from "@/lib/app/date-range";
import { cn } from "@/lib/utils";

export function DateRangeSelect({ value, onChange, className }: { value: RangePreset; onChange: (v: RangePreset) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Date range" className={cn("inline-flex h-8 items-center rounded-[5px] border border-hairline bg-white p-0.5", className)}>
      {RANGE_PRESETS.map((p) => {
        const active = p.value === value;
        return (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(p.value)}
            className={cn(
              "h-full rounded-[4px] px-2.5 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo",
              active ? "bg-slate-deep text-white" : "text-ink-muted hover:text-ink",
            )}
          >
            <span className="sm:hidden">{p.short}</span>
            <span className="hidden sm:inline">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}
