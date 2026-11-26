import { useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, CalendarCheck, Check, CircleAlert, ExternalLink, KeyRound, Loader2, Phone, Plug, RefreshCw, type LucideIcon } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Hue } from "@/components/app/hues";
import { ErrorState, Notice, PageHeader, PageSkeleton, Panel } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { fmtCredit, phoneAccountQuery, phoneApi } from "@/lib/api/phone";
import { fmtDate } from "@/lib/app/format";
import type { PhoneAccount } from "@/lib/shared";
import { EngineChoice, PhoneKeyFields, engineName, keysReady, type PhoneKeyValue } from "@/components/app/PhoneKeyFields";
import { cn } from "@/lib/utils";
import { READ_ONLY_HINT, useConsole } from "./-shared";
import { TwilioCard } from "./-twilio-card";
import { PRODUCT } from "@/lib/app/product";

// Connections: what the agency has plugged in. The phone account is the one that
// matters (nothing answers without it); the rest are counts with a way in.

const TELNYX_PORTAL = "https://portal.telnyx.com/";
const VAPI_DASHBOARD = "https://dashboard.vapi.ai/";

export const Route = createFileRoute("/_authenticated/admin/connections")({
  head: () => ({ meta: [{ title: `Connections — ${PRODUCT} admin` }] }),
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const { platform, readOnly, canManage, role, ws } = useConsole();
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

      <PhoneCard
        account={a}
        platform={platform}
        backup={(openEngine) => (
          <details className="rounded-[12px] border border-dashed border-hairline bg-white" data-section="backup-options">
            <summary className="cursor-pointer select-none px-5 py-3 text-[13px] font-medium text-ink-muted">Other options (backup)</summary>
            <div className="space-y-4 border-t border-hairline p-4">
              {readOnly || !canManage || a.mode !== "own" ? null : (
                <div className="flex flex-col gap-3 rounded-[10px] border border-hairline p-4 sm:flex-row sm:items-center sm:justify-between" data-card="vapi-option">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-ink">{a.provider === "vapi" ? "Vapi (backup option) is your voice engine" : "Use Vapi instead of Telnyx for voice"}</div>
                    <p className="mt-0.5 max-w-[560px] text-[12.5px] text-ink-muted">
                      {a.provider === "vapi" ? "New receptionists run on Vapi. Telnyx is the recommended engine; you can switch back at any time." : "A backup option. New receptionists run on your Vapi account. Receptionists you already have stay on Telnyx."}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="h-8 shrink-0 text-[12.5px]" onClick={() => openEngine(a.provider === "vapi" ? "telnyx" : "vapi")} data-action={a.provider === "vapi" ? "use-telnyx" : "use-vapi"}>
                    {a.provider === "vapi" ? "Switch back to Telnyx" : "Use Vapi"}
                  </Button>
                </div>
              )}
              <TwilioCard engine={a.provider} canManage={canManage} isOwner={role === "owner" || ws.isPlatformAdmin} readOnly={readOnly} />
            </div>
          </details>
        )}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <CountCard icon={Building2} hue="indigo" label="Clients" count={a.counts.clients} hint="Businesses you run receptionists for." to="/admin/clients" cta="Open clients" />
        <CountCard
          icon={Phone}
          hue="cyan"
          label="Phone numbers"
          count={a.counts.numbers}
          hint={a.provider === "vapi" ? "Buy or bring a Twilio number (or bring a Telnyx one) from each client's page." : a.mode === "own" || a.installed ? "Bought on your Telnyx account, from each client's page." : "Each number rings one receptionist."}
          to="/admin/phone-numbers"
          cta="Open numbers"
        />
        <CountCard icon={CalendarCheck} hue="magenta" label="Calendars" count={a.counts.calendars} hint="Google and Outlook calendars are connected per client." to="/admin/clients" cta="Connect from a client" />
      </div>

      <Health account={a} />
    </div>
  );
}

function PhoneCard({ account: a, platform, backup }: { account: PhoneAccount; platform: boolean; backup?: (openEngine: (id: PhoneKeyValue["provider"]) => void) => ReactNode }) {
  const { readOnly, canManage, role, ws } = useConsole();
  const qc = useQueryClient();
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [keys, setKeys] = useState<PhoneKeyValue>({ provider: a.provider, key: "", publicKey: "" });
  const name = engineName(a.provider);
  const portal = a.provider === "vapi" ? VAPI_DASHBOARD : TELNYX_PORTAL;

  const done = async (acct: PhoneAccount) => {
    qc.setQueryData(phoneAccountQuery().queryKey, acct);
    await qc.refetchQueries({ queryKey: ["session"] });
  };
  const replace = useMutation({
    mutationFn: () => phoneApi.connect(keys.key.trim(), keys.provider === "vapi" ? { provider: "vapi", publicKey: keys.publicKey.trim() } : { provider: "telnyx" }),
    onSuccess: async (acct) => {
      await done(acct);
      setReplacing(false);
      setKeys({ provider: acct.provider, key: "", publicKey: "" });
      toast.success(keys.provider === acct.provider && keys.provider === a.provider ? "Key replaced" : `Now using ${engineName(acct.provider)}`, { description: `Checked with ${engineName(acct.provider)} and saved.` });
    },
  });
  const disconnect = useMutation({
    mutationFn: phoneApi.disconnect,
    onSuccess: async (acct) => {
      await done(acct);
      setRemoving(false);
      toast.success(`${name} account disconnected`);
    },
    onError: (e: Error) => toast.error("Couldn't disconnect", { description: e.message }),
  });

  const openEngine = (provider: PhoneKeyValue["provider"]) => {
    setKeys({ provider, key: "", publicKey: "" });
    setReplacing(true);
  };
  const healthy = a.mode === "own" && !a.problem;
  const hue: Hue = a.mode === "none" ? "amber" : a.problem ? "coral" : "green";

  return (
    <>
    <section data-hue={hue} data-card="phone-account" data-mode={a.mode} className="overflow-hidden rounded-[12px] border border-[var(--hue-line)] bg-[linear-gradient(135deg,var(--hue-faint),#fff_55%)]">
      <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <span className="hue-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px]" aria-hidden>
            <Plug className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-semibold text-ink">{a.mode === "platform" && !a.installed ? "Phone account" : `${name} account`}</h2>
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
                Your own {name} account · key ending <span className="font-mono text-ink">{a.last4}</span>
                {a.connectedAt ? ` · connected ${fmtDate(a.connectedAt)}` : ""}
              </p>
            ) : a.mode === "platform" ? (
              <p className="mt-1 max-w-[560px] text-[13px] text-ink-muted">
                {a.installed
                  ? `Your ${name} account, set when this server was installed (${a.provider === "vapi" ? "VAPI_API_KEY" : "TELNYX_API_KEY"}). ${a.provider === "vapi" ? "Calls are charged to it." : "Numbers you buy for clients are charged to it."}`
                  : platform ? "The platform's own phone account, set on the server. Agencies that bring their own connect it in Setup." : "Your phone service is set up and run for you. There's nothing to connect here."}
              </p>
            ) : (
              <p className="mt-1 max-w-[560px] text-[13px] text-ink-muted">Nothing can answer calls until you connect your {name} account. Set-up walks you through it.</p>
            )}
          </div>
        </div>

        {a.mode === "own" && a.provider === "vapi" ? (
          <div className="shrink-0 text-[12.5px] text-ink-muted" data-card="credit">
            Credit and usage are in your Vapi dashboard.
          </div>
        ) : a.mode === "own" ? (
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
            <Notice tone="danger" title={`${name} isn't accepting your key`}>
              {a.problem} Until it's fixed, changes to your receptionists won't save.
            </Notice>
          ) : a.lowCredit ? (
            <Notice tone="warning" title="Credit is low">
              Top up in Telnyx and switch on Auto Recharge. If credit runs out, your receptionists stop answering.
            </Notice>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline" className="h-8 text-[12.5px]">
              <a href={portal} target="_blank" rel="noreferrer noopener">
                Open {name} <ExternalLink />
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
            setKeys({ provider: a.provider, key: "", publicKey: "" });
            replace.reset();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace your API key</DialogTitle>
            <DialogDescription>
              Use a key from the same {name} account. Your receptionists live in that account, so a key from another one won't reach them. To use {a.provider === "vapi" ? "Telnyx (recommended)" : "Vapi (a backup option)"} for new receptionists instead, choose it below: receptionists you already have stay on {name}.
            </DialogDescription>
          </DialogHeader>
          <form
            id="replace-key"
            onSubmit={(e) => {
              e.preventDefault();
              if (keysReady(keys)) replace.mutate();
            }}
            className="space-y-3"
          >
            <EngineChoice value={keys.provider} onChange={(provider) => setKeys({ provider, key: "", publicKey: "" })} />
            <PhoneKeyFields value={keys} onChange={setKeys} idPrefix="replace" />
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
            <Button type="submit" form="replace-key" disabled={!keysReady(keys) || replace.isPending}>
              {replace.isPending ? "Checking…" : "Check and save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect your {name} account?</AlertDialogTitle>
            <AlertDialogDescription>
              This dashboard will stop managing your receptionists: you won't be able to change them, add clients or see new calls until you connect a key again. Nothing is deleted in {name}.
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
    {backup?.(openEngine)}
    </>
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
    { ok: connected, label: `${engineName(a.provider)} account connected`, detail: connected ? `${engineName(a.provider)} accepts your key.` : a.problem || `Connect your ${engineName(a.provider)} key in Setup.` },
    a.provider === "vapi"
      ? { ok: connected, label: "Credit for calls", detail: "Check your balance in the Vapi dashboard. If it runs out, receptionists stop answering." }
      : {
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
