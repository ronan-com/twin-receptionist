import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { attachOwnedNumber, detachOwnedNumber, getNumberState, getOwnedNumbers } from "@/lib/api/console";
import { fmtPhone } from "@/lib/app/format";
import { PENDING_NOTE, TELNYX_ORDERS_URL, numberFailed, numberIsLive, numberWaiting, type OwnedNumber } from "@/lib/ownNumbers";
import { typeOfNumber, type ConnectedNumber } from "@/lib/shared";
import { NumberCaps, telnyxCanText } from "./-number-caps";

// An agency on its own Telnyx account can answer calls on numbers it already owns there,
// and sees which numbers Telnyx is still approving. These sit beside the "buy a number" dialog.

const typeLabel = (t: string) => t.replace(/_/g, " ");

/** "Waiting for Telnyx approval" with what it means and where to look. */
export function PendingNote({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-[11.5px] text-ink-muted"} data-note="number-pending">
      {PENDING_NOTE}{" "}
      <a href={TELNYX_ORDERS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo hover:underline">
        See the order in Telnyx <ExternalLink className="h-3 w-3" />
      </a>
    </p>
  );
}

export function NumberBadge({ status }: { status: string }) {
  if (numberIsLive(status)) return <StatusBadge tone="success">Connected</StatusBadge>;
  if (numberWaiting(status)) return <StatusBadge tone="warning">Waiting for Telnyx approval</StatusBadge>;
  if (numberFailed(status)) return <StatusBadge tone="danger">Telnyx couldn't finish it</StatusBadge>;
  return <StatusBadge tone="muted">{typeLabel(status)}</StatusBadge>;
}

/**
 * The receptionist's numbers as Telnyx reports them: each with its status, a detach
 * button, and a notice when none of them is live yet.
 */
export function AttachedNumbers({ clientId, fallback, onChanged }: { clientId: string; fallback: ReactNode; onChanged: () => Promise<void> }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["own-numbers", "state", clientId], queryFn: () => getNumberState(clientId), staleTime: 15_000 });
  const [confirming, setConfirming] = useState<string | null>(null);
  const detach = useMutation({
    mutationFn: (n: ConnectedNumber) => detachOwnedNumber(clientId, n.id),
    onSuccess: async (_d, n) => {
      toast.success("Number disconnected", { description: `${fmtPhone(n.phoneNumber)} no longer rings this receptionist. It's still on your Telnyx account.` });
      setConfirming(null);
      await qc.invalidateQueries({ queryKey: ["own-numbers"] });
      await onChanged();
    },
    onError: (e: Error) => toast.error("Couldn't disconnect that number", { description: e.message }),
  });

  if (q.isPending) return <p className="text-[12.5px] text-ink-muted">Checking with Telnyx…</p>;
  if (q.error || !q.data) return <>{fallback}</>;

  const { numbers, pending } = q.data;
  const listed = new Set(numbers.map((n) => n.phoneNumber));
  // Orders Telnyx hasn't finished yet, for numbers its number list doesn't show.
  const ordered = pending.flatMap((o) => o.phoneNumbers).filter((p) => !listed.has(p));
  const rows: { key: string; n: ConnectedNumber }[] = [
    ...numbers.map((n) => ({ key: n.id, n })),
    ...ordered.map((p) => ({ key: `order-${p}`, n: { id: "", phoneNumber: p, status: "purchase-pending", type: typeOfNumber(p) } })),
  ];
  if (rows.length === 0) return <>{fallback}</>;
  const live = rows.filter((r) => numberIsLive(r.n.status));
  const waiting = rows.filter((r) => numberWaiting(r.n.status));

  return (
    <div className="space-y-2">
      {live.length === 0 && waiting.length > 0 ? (
        <div data-notice="only-number-pending">
          <Notice tone="warning" title="This receptionist can't take calls yet">
            Its only number is waiting for approval. <PendingNote className="mt-1 text-[12px]" />
          </Notice>
        </div>
      ) : null}
      <ul className="space-y-1.5" data-list="numbers">
        {rows.map(({ key, n }) => (
          <li key={key} className="space-y-1 text-[13px]" data-number-row={n.phoneNumber} data-status={n.status}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 tabular-nums">
                <Phone className="h-3.5 w-3.5 text-ink-muted" /> {fmtPhone(n.phoneNumber)}
              </span>
              <NumberBadge status={n.status} />
            </div>
            {n.id && confirming === n.id ? (
              <div className="flex flex-wrap items-center gap-1.5 rounded-[6px] bg-canvas-2 px-2 py-1.5 text-[12px] text-ink" data-confirm="detach">
                <span>It will stop ringing this receptionist but stays on your Telnyx account.</span>
                <Button size="sm" variant="outline" className="h-6 text-[11.5px]" onClick={() => detach.mutate(n)} disabled={detach.isPending} data-action="confirm-detach-number">
                  {detach.isPending ? "Disconnecting…" : "Disconnect"}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[11.5px]" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </div>
            ) : n.id ? (
              <button type="button" className="text-[11.5px] text-ink-muted hover:text-ink hover:underline" onClick={() => setConfirming(n.id)} data-action="detach-number">
                Disconnect
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {waiting.length > 0 && live.length > 0 ? <PendingNote /> : null}
    </div>
  );
}

/**
 * Numbers on the agency's Telnyx account that no receptionist answers. With a clientId the
 * button connects to that receptionist; without, the agency picks one of `receptionists`.
 */
export function OwnedNumbers({ clientId, receptionists, onChanged, empty }: { clientId?: string; receptionists?: { id: string; name: string }[]; onChanged: () => Promise<void>; empty?: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["own-numbers", "owned"], queryFn: getOwnedNumbers, staleTime: 30_000 });
  const [target, setTarget] = useState<string>("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const to = clientId ?? target;

  const attach = useMutation({
    mutationFn: (n: OwnedNumber) => attachOwnedNumber(to, n.id, true),
    onSuccess: async (res, n) => {
      toast.success("Number connected", { description: `${fmtPhone(n.phoneNumber)} now rings this receptionist.${res.movedFrom ? ` It's off ${res.movedFrom}.` : ""}` });
      if (res.automationsError) toast.warning("The receptionist's script didn't refresh", { description: res.automationsError });
      setConfirming(null);
      await qc.invalidateQueries({ queryKey: ["own-numbers"] });
      await onChanged();
    },
    onError: (e: Error) => toast.error("Couldn't connect that number", { description: e.message }),
  });

  if (q.isPending) {
    return (
      <div className="flex items-center gap-2 py-6 text-[13px] text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Looking at your Telnyx account…
      </div>
    );
  }
  if (q.error) {
    return (
      <div role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]">
        {(q.error as Error).message}
      </div>
    );
  }
  const numbers = q.data;
  if (numbers.length === 0) {
    return (
      <p className="py-4 text-[13px] text-ink-muted" data-note="no-owned-numbers">
        {empty ?? "No other numbers on your Telnyx account. Every number you own already answers for a receptionist."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!clientId ? (
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="h-9 text-[13px]" aria-label="Receptionist" data-field="owned-number-receptionist">
            <SelectValue placeholder="Connect to which receptionist?" />
          </SelectTrigger>
          <SelectContent>
            {(receptionists ?? []).map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <ul className="max-h-[300px] space-y-1.5 overflow-y-auto" data-list="owned-numbers">
        {numbers.map((n) => (
          <li key={n.id} className="rounded-[8px] border border-hairline px-3 py-2 text-[13px]" data-owned-number={n.phoneNumber}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium tabular-nums text-ink">{fmtPhone(n.phoneNumber)}</span>
                  <NumberCaps sms={telnyxCanText(n.phoneNumber)} />
                  <NumberBadge status={n.status} />
                </div>
                <div className="mt-0.5 text-[12px] text-ink-muted">
                  {n.connectionName ? `Connected to ${n.connectionName}` : n.connectionId ? "Connected to another service" : "Not connected to anything"}
                </div>
              </div>
              {confirming !== n.id ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-[12px]"
                  disabled={!to || attach.isPending}
                  onClick={() => (n.connectionId ? setConfirming(n.id) : attach.mutate(n))}
                  data-action="attach-number"
                >
                  Connect
                </Button>
              ) : null}
            </div>
            {confirming === n.id ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-[6px] bg-canvas-2 px-2 py-1.5 text-[12px] text-ink" data-confirm="move-number">
                <span>This moves it off {n.connectionName || "its current connection"}. Calls to it stop going there.</span>
                <Button size="sm" className="h-6 text-[11.5px]" onClick={() => attach.mutate(n)} disabled={attach.isPending} data-action="confirm-attach-number">
                  {attach.isPending ? "Moving…" : "Move it"}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[11.5px]" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {numbers.some((n) => numberWaiting(n.status)) ? <PendingNote /> : null}
    </div>
  );
}
