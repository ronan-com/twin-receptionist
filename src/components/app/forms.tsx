import { type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtRelative } from "@/lib/app/format";
import { cn } from "@/lib/utils";

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
  required,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-ink">
        {label}
        {required ? <span className="ml-0.5 text-coral">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-[12px] leading-4 text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function FormSection({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("panel", className)}>
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[240px_1fr]">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-1 text-[12.5px] leading-5 text-ink-muted">{description}</p> : null}
        </div>
        <div className="grid gap-4">{children}</div>
      </div>
    </section>
  );
}

export function SaveBar({
  dirty,
  saving,
  onSave,
  onReset,
  lastSavedAt,
  disabled,
  disabledReason,
  className,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset?: () => void;
  lastSavedAt?: string | null;
  disabled?: boolean;
  disabledReason?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("sticky bottom-3 z-10 mt-4 flex items-center justify-between gap-3 rounded-[6px] border border-hairline bg-white/95 px-3 py-2 shadow-[0_8px_30px_-12px_rgba(6,27,49,0.25)] backdrop-blur", className)}>
      <div className="min-w-0 text-[12.5px] text-ink-muted">
        {disabled && disabledReason ? (
          <span>{disabledReason}</span>
        ) : dirty ? (
          <span className="text-[#8a4b00]">Unsaved changes</span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-[#1ea672]" />
            {lastSavedAt ? `Saved · last updated ${fmtRelative(lastSavedAt)}` : "All changes saved"}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onReset ? (
          <Button type="button" variant="outline" size="sm" onClick={onReset} disabled={!dirty || saving}>
            Discard
          </Button>
        ) : null}
        <Button type="button" size="sm" onClick={onSave} disabled={disabled || !dirty || saving}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

export function TagInput({ values, onChange, placeholder, disabled }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <li key={`${v}-${i}`} className="inline-flex items-center gap-1 rounded-[4px] border border-hairline bg-canvas-2 px-2 py-0.5 text-[12.5px] text-ink">
            {v}
            {!disabled ? (
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((_, j) => j !== i))} className="ml-0.5 text-ink-muted hover:text-ink">
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!disabled ? (
        <input
          type="text"
          placeholder={placeholder ?? "Type and press Enter"}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = (e.currentTarget.value || "").trim();
              if (v) onChange([...values, v]);
              e.currentTarget.value = "";
            }
          }}
        />
      ) : null}
    </div>
  );
}
