import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CardState, HelperAction } from "./helperApi";

// "Create receptionist 'X' with ...? [Do it] [Cancel]": every change Helper proposes waits here
// for the person. Pressing Do it sends only the card's id; the server runs what it stored.

type Confirm = Extract<HelperAction, { type: "confirm" }>;

export function ConfirmCard({ card, state, onDo, onCancel }: { card: Confirm; state?: CardState; onDo: () => void; onCancel: () => void }) {
  const waiting = !state;
  return (
    <div data-helper-card className="mt-2 overflow-hidden rounded-xl border border-hairline bg-white shadow-sm" role="group" aria-label={card.title}>
      <div className="border-b border-hairline bg-[color-mix(in_srgb,var(--indigo)_6%,#fff)] px-3 py-2 text-[13px] font-semibold text-ink">{card.title}</div>
      <ul className="space-y-1 px-3 py-2.5 text-[12.5px] leading-snug text-ink-muted">
        {card.lines.map((l, i) => (
          <li key={i} className="break-words">
            {l}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-hairline px-3 py-2">
        {waiting || state?.s === "working" ? (
          <>
            <button type="button" onClick={onDo} disabled={!waiting} data-helper-do className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo px-3 text-[12.5px] font-semibold text-white hover:bg-indigo-deep disabled:opacity-60">
              {state?.s === "working" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} Do it
            </button>
            <button type="button" onClick={onCancel} disabled={!waiting} data-helper-cancel className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-3 text-[12.5px] font-medium text-ink hover:bg-canvas-2 disabled:opacity-60">
              <X className="h-3.5 w-3.5" aria-hidden /> Cancel
            </button>
          </>
        ) : (
          <p data-helper-card-state={state?.s} role={state?.s === "error" ? "alert" : "status"} className={cn("text-[12.5px] font-medium", state?.s === "done" ? "text-[#0e9f6e]" : state?.s === "error" ? "text-[#a3231b]" : "text-ink-muted")}>
            {state?.s === "done" ? "Done" : state?.s === "cancelled" ? "Cancelled" : state?.text || "That didn't work."}
          </p>
        )}
      </div>
    </div>
  );
}
