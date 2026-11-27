import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "@/components/app/primitives";
import { Field } from "@/components/app/forms";
import { fmtPhone } from "@/lib/app/format";

// Deleting for good: the dialog every delete in the console uses. The person types the name back before the
// red button works (the server checks it again), and what is about to go is spelled out above it.

export function DeleteDialog({
  open,
  onOpenChange,
  title,
  name,
  nameLabel = "name",
  confirmLabel,
  pending,
  onConfirm,
  extraFields,
  extraReady = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** What has to be typed to confirm: the business, agency or email. */
  name: string;
  nameLabel?: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: (typed: string) => void;
  /** Anything else the delete needs (e.g. your password). */
  extraFields?: ReactNode;
  extraReady?: boolean;
  children: ReactNode;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);
  const ready = typed.trim() === name.trim() && extraReady;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !pending) onConfirm(typed.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-[13px] leading-5 text-ink-muted">{children}</div>
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid gap-3">
            <Field label={`Type the ${nameLabel} to confirm`} htmlFor="delete-confirm" hint={<span className="font-mono text-ink">{name}</span>}>
              <Input id="delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus data-delete-confirm />
            </Field>
            {extraFields}
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!ready || pending} data-action="confirm-delete">
              {pending ? "Deleting…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type DeletedReport = {
  name: string;
  numbers: string[];
  warnings: { receptionist: string; assistantId: string; provider: string; error: string }[];
};

/** What happened after a delete: the numbers that stay on the carrier account, and any assistants to remove by hand. */
export function DeletedDialog({ report, onClose }: { report: DeletedReport | null; onClose: () => void }) {
  return (
    <Dialog open={!!report} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deleted {report?.name}</DialogTitle>
          <DialogDescription>Its receptionists, calls, bookings and the rest are gone.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-[13px]" data-deleted-report>
          {report?.numbers.length ? (
            <Notice tone="info" title="These phone numbers were not deleted">
              They are still on your phone account (Telnyx or Vapi) and still cost what they cost. Release them there if you don't want them: {report.numbers.map((n) => fmtPhone(n)).join(", ")}.
            </Notice>
          ) : null}
          {report?.warnings.length ? (
            <Notice tone="warning" title="Remove these assistants by hand">
              <p>The phone provider wouldn't delete {report.warnings.length === 1 ? "this assistant" : "these assistants"} just now. Everything else is gone. We logged it under System, Incidents.</p>
              <ul className="mt-1.5 list-disc pl-4">
                {report.warnings.map((w) => (
                  <li key={w.assistantId} className="break-all">
                    <span className="font-mono">{w.assistantId}</span> ({w.provider === "vapi" ? "Vapi" : "Telnyx"}, {w.receptionist}): {w.error}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
