import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, CalendarCheck, Check, CircleAlert, ExternalLink, KeyRound, Loader2, Phone, Plug, RefreshCw, type LucideIcon } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Hue } from "@/components/app/hues";
import { ErrorState, Notice, PageHeader, PageSkeleton, Panel } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { fmtCredit, phoneAccountQuery, phoneApi } from "@/lib/api/phone";
import { fmtDate } from "@/lib/app/format";
import type { PhoneAccount } from "@/lib/shared";
import { cn } from "@/lib/utils";
import { READ_ONLY_HINT, useConsole } from "./-shared";
import { named } from "@/lib/app/product";

// Connections: what the agency has plugged in. The phone account is the one that
// matters (nothing answers without it); the rest are counts with a way in.

const TELNYX_PORTAL = "https://portal.telnyx.com/";

export const Route = createFileRoute("/_authenticated/admin/connections")({
  head: () => ({ meta: [{ title: named("Connections — Answered admin") }] }),
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const { platform, readOnly } = useConsole();
  const q = useQuery(phoneAccountQuery());

  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  if (!q.data) return <PageSkeleton metrics={3} rows={3} />;
  const a = q.data;

  return (
    <div className="space-y-5" data-page="admin-connections">
      <PageHeader
        eyebrow={platform ? "Platform console" : "Agency console"}
        title="Connections"
        description="What's plugged in to your agency, and whether it's working."
        actions={
          <Button size="sm" variant="outline" className="h-8 text-[12.5px]" onClick={() => void q.refetch()} disabled={q.isFetching} data-action="check-now">
            {q.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check now
          </Button>
        }
      />
      {readOnly ? <Notice tone="info">{READ_ONLY_HINT}</Notice> : null}

      <PhoneCard account={a} platform={platform} />

      <div className="grid gap-3 md:grid-cols-3">
        <CountCard icon={Building2} hue="indigo" label="Clients" count={a.counts.clients} hint="Businesses you run receptionists for." to="/admin/clients" cta="Open clients" />
        <CountCard
          icon={Phone}
          hue="cyan"
          label="Phone numbers"
          count={a.counts.numbers}
          hint={a.mode === "own" || a.installed ? "Bought on your Telnyx account, from each client's page." : "Each number rings one receptionist."}
          to="/admin/phone-numbers"
          cta="Open numbers"
        />
        <CountCard icon={CalendarCheck} hue="magenta" label="Calendars" count={a.counts.calendars} hint="Google and Outlook calendars are connected per client." to="/admin/clients" cta="Connect from a client" />
      </div>

      <Health account={a} />
    </div>
  );
}

function PhoneCard({ account: a, platform }: { account: PhoneAccount; platform: boolean }) {
  const { readOnly, canManage, role, ws } = useConsole();
  const qc = useQueryClient();
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [key, setKey] = useState("");

  const done = async (acct: PhoneAccount) => {
    qc.setQueryData(phoneAccountQuery().queryKey, acct);
    await qc.refetchQueries({ queryKey: ["session"] });
  };
  const replace = useMutation({
    mutationFn: () => phoneApi.connect(key.trim()),
    onSuccess: async (acct) => {
      await done(acct);
      setReplacing(false);
      setKey("");
      toast.success("Key replaced", { description: "Checked with Telnyx and saved." });
    },
  });
  const disconnect = useMutation({
    mutationFn: phoneApi.disconnect,
    onSuccess: async (acct) => {
      await done(acct);
      setRemoving(false);
      toast.success("Telnyx account disconnected");
    },
    onError: (e: Error) => toast.error("Couldn't disconnect", { description: e.message }),
  });

  const healthy = a.mode === "own" && !a.problem;
  const hue: Hue = a.mode === "none" ? "amber" : a.problem ? "coral" : "green";

  return (
    <section data-hue={hue} data-card="phone-account" data-mode={a.mode} className="overflow-hidden rounded-[12px] border border-[var(--hue-line)] bg-[linear-gradient(135deg,var(--hue-faint),#fff_55%)]">
      <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <span className="hue-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px]" aria-hidden>
            <Plug className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-semibold text-ink">{a.mode === "platform" && !a.installed ? "Phone account" : "Telnyx account"}</h2>
              {a.mode === "own" ? (
                <StatusBadge tone={healthy ? "success" : "danger"} dot>
                  {healthy ? "Connected" : "Needs attention"}
                </StatusBadge>
              ) : a.mode === "platform" ? (
                <StatusBadge tone="info" dot>
                  {a.installed ? "Set at install" : "Managed for you"}
                </StatusBadge>
              ) : (
                <StatusBadge tone="warning" dot>
                  Not connected
                </StatusBadge>
              )}
            </div>
            {a.mode === "own" ? (
              <p className="mt-1 text-[13px] text-ink-muted">
                Your own Telnyx account · key ending <span className="font-mono text-ink">{a.last4}</span>
                {a.connectedAt ? ` · connected ${fmtDate(a.connectedAt)}` : ""}
              </p>
            ) : a.mode === "platform" ? (
              <p className="mt-1 max-w-[560px] text-[13px] text-ink-muted">
                {a.installed
                  ? "Your Telnyx account, set when this server was installed (TELNYX_API_KEY). Numbers you buy for clients are charged to it."
                  : platform ? "The platform's own phone account, set on the server. Agencies that bring their own connect it in Setup." : "Your phone service is set up and run for you. There's nothing to connect here."}
              </p>
            ) : (
              <p className="mt-1 max-w-[560px] text-[13px] text-ink-muted">Nothing can answer calls until you connect your Telnyx account. Set-up walks you through it.</p>
            )}
          </div>
        </div>

        {a.mode === "own" ? (
          <div className="flex shrink-0 items-end gap-6">
            <div data-card="credit">
              <div className="text-[11.5px] text-ink-muted">Credit</div>
              <div className={cn("text-[26px] font-semibold leading-tight tracking-[-0.02em]", a.lowCredit ? "text-[#b45309]" : "text-ink")}>{a.balance ? fmtCredit(a.balance) : "—"}</div>
            </div>
          </div>
        ) : a.mode === "none" && !readOnly ? (
          <Button asChild className="h-10 shrink-0 px-5">
            <Link to="/setup">Finish set-up</Link>
          </Button>
        ) : null}
      </div>

      {a.mode === "own" ? (
        <div className="space-y-3 border-t border-[var(--hue-line)] bg-white/70 px-5 py-3.5">
          {a.problem ? (
            <Notice tone="danger" title="Telnyx isn't accepting your key">
              {a.problem} Until it's fixed, changes to your receptionists won't save.
            </Notice>
          ) : a.lowCredit ? (
            <Notice tone="warning" title="Credit is low">
              Top up in Telnyx and switch on Auto Recharge. If credit runs out, your receptionists stop answering.
            </Notice>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline" className="h-8 text-[12.5px]">
              <a href={TELNYX_PORTAL} target="_blank" rel="noreferrer noopener">
                Open Telnyx <ExternalLink />
              </a>
            </Button>
            <Button asChild size="sm" variant="ghost" className="h-8 text-[12.5px]">
              <Link to="/guide" target="_blank">
                Set-up guide
              </Link>
            </Button>
            {canManage ? (
              <Button size="sm" variant="outline" className="h-8 text-[12.5px]" onClick={() => setReplacing(true)} data-action="replace-key">
                <KeyRound /> Replace key
              </Button>
            ) : null}
            {!readOnly && (role === "owner" || ws.isPlatformAdmin) ? (
              <Button size="sm" variant="ghost" className="h-8 text-[12.5px] text-[#a41d1d] hover:bg-[#fff7f7] hover:text-[#a41d1d]" onClick={() => setRemoving(true)} data-action="disconnect">
                Disconnect
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <Dialog
        open={replacing}
        onOpenChange={(open) => {
          setReplacing(open);
          if (!open) {
            setKey("");
            replace.reset();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace your API key</DialogTitle>
            <DialogDescription>Use a key from the same Telnyx account. Your receptionists live in that account, so a key from another one won't reach them.</DialogDescription>
          </DialogHeader>
          <form
            id="replace-key"
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) replace.mutate();
            }}
            className="space-y-2"
          >
            <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="KEY…" autoComplete="off" spellCheck={false} aria-label="New Telnyx API key" className="font-mono text-[13px]" data-field="api-key" />
            {replace.error ? (
              <div role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]">
                {(replace.error as Error).message}
              </div>
            ) : null}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplacing(false)}>
              Cancel
            </Button>
            <Button type="submit" form="replace-key" disabled={!key.trim() || replace.isPending}>
              {replace.isPending ? "Checking…" : "Check and save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect your Telnyx account?</AlertDialogTitle>
            <AlertDialogDescription>
              This dashboard will stop managing your receptionists: you won't be able to change them, add clients or see new calls until you connect a key again. Nothing is deleted in Telnyx.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it connected</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                disconnect.mutate();
              }}
              disabled={disconnect.isPending}
              data-action="confirm-disconnect"
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function CountCard({ icon: Icon, hue, label, count, hint, to, cta }: { icon: LucideIcon; hue: Hue; label: string; count: number; hint: string; to: string; cta: string }) {
  return (
    <div data-hue={hue} className="panel flex flex-col p-4" data-card={label.toLowerCase().replace(/\s+/g, "-")}>
      <div className="flex items-center justify-between gap-2">
        <span className="hue-icon flex h-8 w-8 items-center justify-center rounded-[8px]" aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{count}</span>
      </div>
      <div className="mt-3 text-[13.5px] font-semibold text-ink">{label}</div>
      <p className="mt-0.5 flex-1 text-[12px] leading-5 text-ink-muted">{hint}</p>
      <Link to={to} className="mt-3 text-[12.5px] font-medium text-indigo hover:underline">
        {cta}
      </Link>
    </div>
  );
}

/** A plain checklist: what's done, what's next. */
function Health({ account: a }: { account: PhoneAccount }) {
  if (a.mode === "platform") return null;
  const connected = a.mode === "own" && !a.problem;
  const rows: { ok: boolean; warn?: boolean; label: string; detail: string }[] = [
    { ok: connected, label: "Telnyx account connected", detail: connected ? "Telnyx accepts your key." : a.problem || "Connect your Telnyx key in Setup." },
    {
      ok: connected && !a.lowCredit,
      warn: connected && a.lowCredit,
      label: "Enough credit for calls",
      detail: !connected ? "Checked once your account is connected." : a.lowCredit ? `Only ${fmtCredit(a.balance)} left. Top up in Telnyx.` : `${fmtCredit(a.balance)} available.`,
    },
    { ok: a.counts.clients > 0, label: "First client added", detail: a.counts.clients > 0 ? `${a.counts.clients} so far.` : "Add a client to make its receptionist." },
    { ok: a.counts.numbers > 0, label: "A phone number connected", detail: a.counts.numbers > 0 ? `${a.counts.numbers} connected.` : "Until then, receptionists can only be tested from the browser." },
  ];
  const doneCount = rows.filter((r) => r.ok).length;
  return (
    <Panel title="Set-up check" description={`${doneCount} of ${rows.length} done`} padded={false}>
      <ul className="divide-y divide-hairline" data-list="health">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-3 px-4 py-3" data-ok={r.ok}>
            <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", r.ok ? "bg-[#0e9f6e] text-white" : r.warn ? "bg-[#fff1d6] text-[#b45309]" : "border border-hairline bg-white text-ink-muted")}>
              {r.ok ? <Check className="h-3 w-3" /> : r.warn ? <CircleAlert className="h-3.5 w-3.5" /> : null}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink">{r.label}</div>
              <div className="text-[12px] text-ink-muted">{r.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
