import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, KeyValue } from "@/components/app/primitives";
import { CallStatusBadge, DemoBadge, OutcomeBadge, StatusBadge } from "@/components/app/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { getConsoleCallDetail, type BizRef } from "@/lib/api/console";
import { fmtDateTime, fmtDuration, fmtPhone } from "@/lib/app/format";
import { useWorkspace } from "@/lib/app/workspace";

// Shared bits of the console pages (not a route: the "-" prefix keeps the router out).

/** Who is looking at the console, and what they may do. */
export function useConsole() {
  const ws = useWorkspace();
  const viewingAgency = Boolean(ws.viewing && !ws.viewing.client);
  const platform = ws.isPlatformAdmin && !viewingAgency;
  const role = ws.session?.role ?? null;
  const readOnly = Boolean(ws.viewing);
  // Pausing, sharing, branding, team: agency owners/admins and the platform admin.
  const canManage = !readOnly && (ws.isPlatformAdmin || role === "owner" || role === "admin");
  return { ws, platform, readOnly, canManage, role, orgName: ws.org?.name ?? "" };
}

export const READ_ONLY_HINT = "You're viewing as someone else, so this is read only.";

/** The business name plus (for the platform) its agency. */
export function BizCell({ biz, showAgency, sub }: { biz: Pick<BizRef, "name" | "is_demo" | "org_name"> | null | undefined; showAgency?: boolean; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium text-ink">{biz?.name || "—"}</span>
        {biz?.is_demo ? <DemoBadge /> : null}
      </div>
      {showAgency || sub ? (
        <div className="truncate text-[11.5px] text-ink-muted">
          {[showAgency ? biz?.org_name : null, sub].filter(Boolean).map((x, i) => (
            <span key={i}>
              {i > 0 ? " · " : ""}
              {x}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A link to hand over (invite links): selectable, with a copy button. */
export function LinkBox({ url, label = "Invite link" }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input readOnly value={url} aria-label={label} onFocus={(e) => e.target.select()} className="h-8 min-w-0 flex-1 font-mono text-[12px]" data-invite-link />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 shrink-0"
        onClick={() =>
          void navigator.clipboard
            .writeText(url)
            .then(() => setCopied(true))
            .catch(() => setCopied(false))
        }
      >
        {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** A call's details and transcript, read through the console (scoped on the server). */
export function CallSheet({ callId, onClose }: { callId: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["console", "call", callId], enabled: !!callId, queryFn: () => getConsoleCallDetail(callId!) });
  const c = q.data;
  return (
    <Sheet open={!!callId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{c?.business?.name ?? "Call"}</SheetTitle>
          <SheetDescription>{c ? `${fmtPhone(c.from_number) || "Unknown caller"} · ${fmtDateTime(c.started_at)}` : "Loading…"}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 text-[13px]" data-call-detail>
          {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}
          {q.isPending && callId ? <Skeleton className="h-40" /> : null}
          {c ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <CallStatusBadge status={c.status} />
                <OutcomeBadge outcome={c.outcome} />
                {c.channel && c.channel !== "call" ? <StatusBadge tone="info">Text</StatusBadge> : null}
              </div>
              {c.status === "failed" ? (
                <div className="rounded-[6px] border border-[#ffd0d0] bg-[#ffecec] px-3 py-2 text-[12.5px] text-[#a41d1d]">{c.error_message ?? "The call failed."}</div>
              ) : null}
              <KeyValue
                items={[
                  { label: "Agency", value: c.business?.org_name ?? "—" },
                  { label: "Receptionist", value: c.agent?.name ?? "—" },
                  { label: "From", value: fmtPhone(c.from_number) || "—" },
                  { label: "To", value: fmtPhone(c.to_number) || "—" },
                  { label: "Length", value: fmtDuration(c.duration_seconds) },
                  { label: "Provider call id", value: c.provider_call_id ?? "—", mono: true },
                ]}
              />
              <div>
                <div className="mb-1 text-[12px] font-medium text-ink-muted">Summary</div>
                <p className="text-ink">{c.summary || "No summary for this call."}</p>
              </div>
              <div>
                <div className="mb-1 text-[12px] font-medium text-ink-muted">Transcript</div>
                {c.transcript_error ? <p className="text-[12.5px] text-[#a41d1d]">{c.transcript_error}</p> : null}
                {c.transcript_segments.length === 0 ? (
                  <p className="text-ink-muted">No transcript. Audio isn't stored for calls.</p>
                ) : (
                  <ol className="space-y-2">
                    {c.transcript_segments.map((s) => (
                      <li key={s.id} className={s.speaker === "agent" ? "rounded-[6px] bg-[#efeeff] px-3 py-2" : "rounded-[6px] bg-canvas-2 px-3 py-2"}>
                        <div className="text-[11px] font-medium text-ink-muted">{s.speaker === "agent" ? c.agent?.name ?? "Receptionist" : "Caller"}</div>
                        <div className="text-ink">{s.text}</div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Copy for the honest stubs. */
export const NOT_BILLED = "Usage is counted from the calls we log. Billing isn't connected yet, so nothing here is charged.";

const AUTOMATION_TONE = { live: "success", attention: "danger", paused: "warning", off: "muted" } as const;
const AUTOMATION_SHORT: Record<string, string> = { voice: "Voice", sms: "SMS", email: "Email", booking: "Bookings", crm: "CRM" };

/** A company's automations as small status chips (live / needs attention / paused / off). */
export function AutomationChips({ items, compact }: { items: { key: string; label: string; status: "live" | "off" | "paused" | "attention" }[]; compact?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1" data-automations>
      {items.map((a) => (
        <StatusBadge key={a.key} tone={AUTOMATION_TONE[a.status]} dot={a.status !== "off"}>
          <span title={`${a.label}: ${a.status === "live" ? "on" : a.status === "attention" ? "needs attention" : a.status}`} data-automation={a.key} data-status={a.status}>
            {compact ? AUTOMATION_SHORT[a.key] ?? a.label : a.label}
          </span>
        </StatusBadge>
      ))}
    </div>
  );
}
