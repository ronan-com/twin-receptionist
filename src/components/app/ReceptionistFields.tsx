import { AudioLines } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DAY_KEYS, DAY_LABELS, type BusinessHours, type Voice } from "@/lib/app/types";
import { cn } from "@/lib/utils";
import { VoicePreviewButton } from "./VoicePreview";

// Receptionist form pieces shared by the receptionist page and the onboarding wizard.

export function VoicePicker({ voices, value, onChange, disabled, loading }: { voices: Voice[]; value: string | null; onChange: (id: string | null) => void; disabled?: boolean; loading?: boolean }) {
  if (loading) return <div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[76px] animate-pulse rounded-[6px] bg-canvas-2" />)}</div>;
  if (voices.length === 0) return <p className="text-[12.5px] text-ink-muted">Voices couldn't be loaded from the phone provider just now. Your current voice stays as it is.</p>;

  return (
    <div role="radiogroup" aria-label="Voice" className="grid gap-2 sm:grid-cols-2">
      {voices.map((v) => {
        const selected = v.id === value;
        return (
          <div
            key={v.id}
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : 0}
            onClick={() => !disabled && onChange(v.id)}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChange(v.id);
              }
            }}
            className={cn(
              "flex items-start gap-3 rounded-[6px] border p-3 text-left outline-none transition-colors",
              selected ? "border-indigo bg-[#f7f6ff] ring-1 ring-indigo" : "border-hairline bg-white hover:border-[#c7c4ff]",
              disabled ? "cursor-default opacity-70" : "cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo",
            )}
          >
            <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", selected ? "bg-indigo text-white" : "bg-canvas-2 text-ink-muted")}>
              <AudioLines className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[13px] font-semibold text-ink">{v.display_name}</span>
                {v.gender ? <span className="text-[11px] capitalize text-ink-muted">{v.gender}</span> : null}
              </span>
              <span className="mt-0.5 block text-[12px] text-ink-muted">{[v.accent, v.style].filter(Boolean).join(" · ")}</span>
            </span>
            <VoicePreviewButton id={v.id} url={v.preview_url} name={v.display_name.split(" - ")[0]} className="self-center" />
          </div>
        );
      })}
    </div>
  );
}

export function HoursEditor({ value, onChange, disabled }: { value: BusinessHours; onChange: (h: BusinessHours) => void; disabled?: boolean }) {
  return (
    <div>
      <ul className="divide-y divide-hairline">
        {DAY_KEYS.map((d) => {
          const day = value[d];
          return (
            <li key={d} className="grid grid-cols-[1fr_auto] items-center gap-3 py-2.5 sm:grid-cols-[120px_auto_1fr]">
              <span className="text-[13px] font-medium text-ink">{DAY_LABELS[d]}</span>
              <div className="flex items-center gap-2 sm:order-3 sm:justify-self-end">
                <span className="text-[12px] text-ink-muted">{day.closed ? "Closed" : "Open"}</span>
                <Switch checked={!day.closed} onCheckedChange={(v) => onChange({ ...value, [d]: { ...day, closed: !v } })} disabled={disabled} aria-label={`${DAY_LABELS[d]} open`} />
              </div>
              <div className="col-span-2 flex items-center gap-2 sm:order-2 sm:col-span-1">
                <Input type="time" value={day.open} onChange={(e) => onChange({ ...value, [d]: { ...day, open: e.target.value } })} disabled={disabled || day.closed} className="h-8 w-[112px] text-[12.5px]" aria-label={`${DAY_LABELS[d]} opens`} />
                <span className="text-[12px] text-ink-muted">to</span>
                <Input type="time" value={day.close} onChange={(e) => onChange({ ...value, [d]: { ...day, close: e.target.value } })} disabled={disabled || day.closed} className="h-8 w-[112px] text-[12.5px]" aria-label={`${DAY_LABELS[d]} closes`} />
              </div>
            </li>
          );
        })}
      </ul>
      {!disabled ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 h-7 text-[12px]"
          onClick={() => {
            const next = { ...value };
            for (const d of ["tue", "wed", "thu", "fri"] as const) next[d] = { ...value.mon };
            onChange(next);
          }}
        >
          Copy Monday to weekdays
        </Button>
      ) : null}
    </div>
  );
}
