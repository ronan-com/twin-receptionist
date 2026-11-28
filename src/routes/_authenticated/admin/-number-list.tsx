import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquareText, Phone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState, Panel } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { attachOwnedNumber, getAllNumbers, importNumberFor, setTextNumber, type AdminAgentRow } from "@/lib/api/console";
import { fmtPhone } from "@/lib/app/format";
import { US_TEXT_NOTE, type AgencyNumber } from "@/lib/shared";
import { PROVIDER_LABEL } from "./-number-caps";

// Every number the agency has, in one list: who answers its calls and its texts, and an Assign button.

/** Calls can be assigned to a number nobody answers: an unassigned Telnyx one, or a Twilio one (Vapi answers those). */
const canAssignCalls = (n: AgencyNumber) => n.calls && !n.callsBy && !n.pending && (n.provider === "twilio" || Boolean(n.ownedId));
const canAssignTexts = (n: AgencyNumber) => n.sms && !n.textsBy && !n.pending && n.provider !== "vapi";

function Use({ kind, can, by, other }: { kind: "Calls" | "Texts"; can: boolean; by: string; other?: string }) {
  const Icon = kind === "Calls" ? Phone : MessageSquareText;
  return (
    <div className="flex min-w-0 items-center gap-2" data-use={kind.toLowerCase()} data-can={can ? "yes" : "no"}>
      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${can ? "bg-[color-mix(in_srgb,var(--green)_16%,var(--card))] text-[#0b6142] dark:text-[#6fe0b3]" : "bg-canvas-2 text-ink-muted line-through"}`}>
        <Icon className="h-3 w-3" /> {kind}
      </span>
      <span className={`truncate text-[12.5px] ${by ? "text-ink" : "text-ink-muted"}`}>{by || (can ? (other ?? "Free") : "Can't")}</span>
    </div>
  );
}

export function NumberList({ agents, canAssign }: { agents: AdminAgentRow[]; canAssign: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "all-numbers"], queryFn: getAllNumbers });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const s = search.trim().toLowerCase().replace(/\s/g, "");
  const all = q.data?.numbers ?? [];
  const rows = all.filter((n) => !s || [n.number, fmtPhone(n.number), n.callsBy?.name ?? "", n.textsBy?.name ?? "", PROVIDER_LABEL[n.provider]].some((v) => v.toLowerCase().replace(/\s/g, "").includes(s)));
  const picked = all.find((n) => n.number === open) ?? null;
  const changed = async () => {
    await Promise.all(["admin", "own-numbers", "texts", "text-choices", "console"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };

  return (
    <>
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}
      {q.data?.problems.map((p) => <p key={p} role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]">{p}</p>)}
      <Panel padded={false}>
        <div className="border-b border-hairline px-3 py-2">
          <div className="relative sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="h-8 pl-8 text-[12.5px]" aria-label="Search numbers" />
          </div>
        </div>
        {q.isPending ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Phone} title={all.length ? "No match" : "No numbers yet"} />
        ) : (
          <ul className="divide-y divide-hairline" data-list="all-numbers">
            {rows.map((n) => (
              <li key={n.number} className="grid items-center gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:gap-3" data-number-row={n.number} data-provider={n.provider}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="whitespace-nowrap text-[14px] font-medium tabular-nums text-ink">{fmtPhone(n.number)}</span>
                  <StatusBadge tone={n.provider === "twilio" ? "info" : "muted"}>{PROVIDER_LABEL[n.provider]}</StatusBadge>
                  {n.pending ? <StatusBadge tone="warning">Pending</StatusBadge> : null}
                </div>
                <Use kind="Calls" can={n.calls} by={n.callsBy?.name ?? ""} other={n.connectedTo ? `On ${n.connectedTo}` : undefined} />
                <Use kind="Texts" can={n.sms} by={n.textsBy?.name ?? ""} />
                <div className="md:w-[76px] md:text-right">
                  {canAssign && (canAssignCalls(n) || canAssignTexts(n)) ? (
                    <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => setOpen(n.number)} data-action="assign-number">Assign</Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Dialog open={Boolean(picked)} onOpenChange={(v) => !v && setOpen(null)}>
        {picked ? (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Assign {fmtPhone(picked.number)}</DialogTitle>
              <DialogDescription>{PROVIDER_LABEL[picked.provider]} number</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {canAssignTexts(picked) ? <Assign key={`t${picked.number}`} n={picked} kind="texts" agents={agents} onDone={changed} /> : null}
              {canAssignCalls(picked) ? <Assign key={`c${picked.number}`} n={picked} kind="calls" agents={agents} onDone={changed} /> : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function Assign({ n, kind, agents, onDone }: { n: AgencyNumber; kind: "calls" | "texts"; agents: AdminAgentRow[]; onDone: () => Promise<void> }) {
  const [to, setTo] = useState("");
  // Calls follow the voice engine: Twilio numbers ring Vapi receptionists, Telnyx numbers ring Telnyx ones.
  const fit = kind === "texts" ? agents : agents.filter((a) => a.provider === (n.provider === "twilio" ? "vapi" : "telnyx"));
  const moves = kind === "calls" && Boolean(n.connectedTo);
  const assign = useMutation({
    mutationFn: async (): Promise<string> => {
      if (kind === "texts") {
        const s = await setTextNumber(to, n.number);
        return s.status === "on" ? "" : s.detail;
      }
      if (n.provider === "twilio") await importNumberFor(to, { source: "twilio", number: n.number });
      else await attachOwnedNumber(to, n.ownedId, true);
      return "";
    },
    onSuccess: async (problem) => {
      if (problem) toast.warning("Saved, but not working yet", { description: problem });
      else toast.success(kind === "texts" ? "Texts assigned" : "Calls assigned");
      await onDone();
    },
    onError: (e: Error) => toast.error("Couldn't assign it", { description: e.message }),
  });
  const title = kind === "texts" ? "Texts" : "Calls";
  return (
    <div className="space-y-1.5" data-assign={kind}>
      <div className="text-[12.5px] font-medium text-ink">{title}</div>
      {fit.length ? (
        <div className="flex gap-2">
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger className="h-9 min-w-0 flex-1 text-[13px]" aria-label={`${title} receptionist`}><SelectValue placeholder="Which receptionist?" /></SelectTrigger>
            <SelectContent>
              {fit.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.business.name})</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-9 text-[12.5px]" disabled={!to || assign.isPending} onClick={() => assign.mutate()} data-action={`assign-${kind}`}>
            {assign.isPending ? "Saving…" : moves ? "Move" : "Save"}
          </Button>
        </div>
      ) : (
        <p className="text-[12px] text-ink-muted">Needs a receptionist on {n.provider === "twilio" ? "Vapi" : "Telnyx"}.</p>
      )}
      {moves ? <p className="text-[11.5px] text-ink-muted">Moves it off {n.connectedTo}.</p> : null}
      {kind === "texts" && n.number.startsWith("+1") ? <p className="text-[11.5px] text-ink-muted">{US_TEXT_NOTE}</p> : null}
    </div>
  );
}
