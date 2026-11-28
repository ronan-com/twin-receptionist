import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Mail, Plug, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Panel, ErrorState, Notice, KeyValue } from "@/components/app/primitives";
import { IntegrationBadge, StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtDateTime, fmtRelative, humanize } from "@/lib/app/format";
import { integrationEventsQuery, integrationsQuery } from "@/lib/app/queries";
import { changeCalendar } from "@/lib/api/manage";
import type { Integration } from "@/lib/app/types";
import { useWorkspace } from "@/lib/app/workspace";
import { cn } from "@/lib/utils";
import type { Hue } from "@/components/app/hues";
import { PRODUCT } from "@/lib/app/product";
import { ConnectApps } from "@/components/app/client/ConnectApps";
import { BookingSetup, CALENDARS } from "./BookingSetup";
import { InboxSetup } from "./InboxSetup";
import { useSignInOutcome } from "./SignInSetup";

type Category = "Email" | "Automation";
interface Def {
  provider: "email_mailbox" | "webhook";
  name: string;
  category: Category;
  description: string;
}

// Calendars are on their own screen (BookingSetup); these are the other connections.
const CATALOG: Def[] = [
  { provider: "email_mailbox", name: "Email inbox", category: "Email", description: "Your receptionist reads new enquiries in your inbox and drafts (or sends) replies." },
  { provider: "webhook", name: "Webhook / custom CRM", category: "Automation", description: "Each booking and callback is sent as JSON to any HTTPS address, for your CRM or Zapier." },
];

const CATEGORY_ICON: Record<Category, typeof Mail> = { Email: Mail, Automation: Webhook };
const CATEGORY_HUE: Record<Category, Hue> = { Email: "magenta", Automation: "coral" };

const cfg = (i?: Integration) => (i?.config && typeof i.config === "object" && !Array.isArray(i.config) ? (i.config as Record<string, unknown>) : {});

export function IntegrationsPage({ show = "all" }: { /** In the receptionist editor: Booking (calendars, webhook) or Apps (connected tools). */ show?: "all" | "booking" | "apps" } = {}) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const intQ = useQuery(integrationsQuery(ws.businessId));
  const evQ = useQuery(integrationEventsQuery(ws.businessId));
  const canEdit = ws.access.canEdit;

  const [dialog, setDialog] = useState<Def | null>(null);
  const integrations = intQ.data ?? [];
  const byProvider = useMemo(() => new Map<string, Integration>(integrations.map((i) => [i.provider, i])), [integrations]);
  const calendar = integrations.find((i) => CALENDARS.includes(i.provider)) ?? null;
  const connected = integrations.filter((i) => i.status === "connected");
  const errored = integrations.filter((i) => i.status === "error");

  // Back from Google/Microsoft sign-in.
  useSignInOutcome();

  const refresh = (list?: Integration[]) => {
    if (list) qc.setQueryData(["integrations", ws.businessId], list);
    void qc.invalidateQueries({ queryKey: ["integrations", ws.businessId] });
    void qc.invalidateQueries({ queryKey: ["integration-events", ws.businessId] });
    void qc.invalidateQueries({ queryKey: ["agents", ws.businessId] });
  };
  const embedded = show !== "all";

  const card = (def: Def) => {
    const existing = byProvider.get(def.provider);
    const Icon = CATEGORY_ICON[def.category];
    const status = existing?.status ?? "available";
    return (
      <div key={def.provider} data-provider={def.provider} className={cn("card-surface flex flex-col gap-3 p-4 transition-shadow hover:shadow-[0_8px_22px_-16px_rgba(6,27,49,0.45)]", existing?.status === "connected" && "border-[#c3ecd9] shadow-[inset_0_2px_0_#1ea672]", existing?.status === "error" && "border-[#f2c9c9]")}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span data-hue={CATEGORY_HUE[def.category]} className="hue-icon grid h-9 w-9 shrink-0 place-items-center rounded-[8px]" aria-hidden>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold text-ink">{def.name}</div>
              <div className="text-[11.5px] text-ink-muted">{def.category}</div>
            </div>
          </div>
          {intQ.isPending ? <span className="h-5 w-16 animate-pulse rounded bg-canvas-2" /> : <IntegrationBadge status={status} />}
        </div>
        <p className="text-[12.5px] leading-5 text-ink-muted">{def.description}</p>
        {existing ? (
          <div className="min-w-0 truncate text-[11.5px] text-ink-muted">
            {existing.status === "connected" ? (
              <>
                Connected {existing.connected_at ? fmtRelative(existing.connected_at) : ""}
                {cfg(existing)["account_email"] ? ` · ${String(cfg(existing)["account_email"])}` : ""}
                {cfg(existing)["endpoint_url"] ? ` · ${String(cfg(existing)["endpoint_url"])}` : ""}
              </>
            ) : existing.status === "error" ? (
              <span className="inline-flex items-center gap-1 text-[#a41d1d]">
                <AlertTriangle className="h-3 w-3" /> {existing.last_error ?? "Sync failed"}
              </span>
            ) : (
              <>Switched off</>
            )}
          </div>
        ) : null}
        <div className="mt-auto flex items-center gap-2 pt-1">
          {existing ? (
            <Button size="sm" variant="outline" className="h-8" onClick={() => setDialog(def)}>
              {canEdit ? "Manage" : "View"}
            </Button>
          ) : (
            <Button size="sm" className="h-8" onClick={() => setDialog(def)} disabled={!canEdit}>
              Connect
            </Button>
          )}
        </div>
      </div>
    );
  };

  const activity = (
    <Panel title="Recent activity" description="Problems and activity across your connected tools." padded={false}>
      {evQ.isPending ? (
        <div className="p-4 text-[13px] text-ink-muted">Loading…</div>
      ) : (evQ.data ?? []).length === 0 ? (
        <div className="px-6 py-10 text-center text-[13px] text-ink-muted">No activity yet.</div>
      ) : (
        <ul className="divide-y divide-hairline">
          {(evQ.data ?? []).slice(0, 30).map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-4 py-2.5 text-[12.5px]">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", e.severity === "error" ? "bg-[#d64545]" : e.severity === "warning" ? "bg-[#f0a800]" : "bg-[#1a9c5b]")} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium text-ink">{e.integration?.display_name ?? humanize(e.integration?.provider)}</span>
                  <StatusBadge tone="muted">{humanize(e.type)}</StatusBadge>
                </div>
                {e.message ? <div className="[overflow-wrap:anywhere] text-ink-muted">{e.message}</div> : null}
              </div>
              <span className="shrink-0 whitespace-nowrap text-ink-muted">{fmtRelative(e.occurred_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );

  const booking = ws.businessId ? (
    <BookingSetup
      key={ws.businessId}
      businessId={ws.businessId}
      calendar={calendar}
      loading={intQ.isPending}
      canEdit={canEdit}
      embedded={embedded}
      onChanged={refresh}
      advanced={
        show === "booking" ? (
          <>
            {CATALOG.filter((d) => d.category === "Automation").map(card)}
            {activity}
          </>
        ) : null
      }
    />
  ) : null;

  return (
    <div className="space-y-5">
      {embedded ? null : <PageHeader title="Apps" description="Connect the tools you already use." />}

      {intQ.error ? <ErrorState message={intQ.error.message} onRetry={() => void intQ.refetch()} /> : null}
      {!canEdit ? <Notice tone="neutral">{ws.access.readOnlyReason ?? "Your access to this business is view only."}</Notice> : null}
      {errored.length > 0 && !embedded ? (
        <Notice tone="warning" title={`${errored.length} integration${errored.length === 1 ? " needs" : "s need"} attention`}>
          {errored.map((i) => `${i.display_name ?? humanize(i.provider)}: ${i.last_error ?? "sync failed"}`).join(" · ")}
        </Notice>
      ) : null}

      {embedded ? null : (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
          <span className="inline-flex items-center gap-1.5 rounded-[4px] bg-canvas-2 px-2 py-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#1a9c5b]" /> {connected.length} connected
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-[4px] bg-canvas-2 px-2 py-1">
            <Plug className="h-3.5 w-3.5" /> {CATALOG.length + CALENDARS.length} available
          </span>
        </div>
      )}

      {show === "booking" ? null : <ConnectApps />}

      {show === "apps" ? null : booking}

      {embedded
        ? null
        : CATALOG.map((def) => (
            <section key={def.category} className="space-y-2">
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{def.category}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{card(def)}</div>
            </section>
          ))}

      {embedded ? null : activity}

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          {dialog ? (
            <IntegrationDialog def={dialog} existing={byProvider.get(dialog.provider)} hasBooking={!!calendar} canEdit={canEdit} onDone={refresh} onClose={() => setDialog(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IntegrationDialog({
  def,
  existing,
  hasBooking,
  canEdit,
  onDone,
  onClose,
}: {
  def: Def;
  existing?: Integration;
  hasBooking: boolean;
  canEdit: boolean;
  onDone: (list?: Integration[]) => void;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const businessId = ws.businessId!;
  const c = cfg(existing);
  const [endpoint, setEndpoint] = useState(String(c["endpoint_url"] ?? ""));
  const mail = def.provider === "email_mailbox";

  const run = useMutation({
    mutationFn: async (action: "hook" | "unhook") => {
      if (action === "hook" && !/^https:\/\/.+/i.test(endpoint.trim())) throw new Error("Enter an address that starts with https://");
      return { action, list: (await changeCalendar(businessId, { leadWebhook: action === "hook" ? endpoint.trim() : "" })).integrations };
    },
    onSuccess: (res) => {
      toast.success(res.action === "hook" ? "Webhook saved" : "Webhook removed");
      onDone(res.list);
      onClose();
    },
    onError: (e) => toast.error("Couldn't save", { description: e.message }),
  });
  const busy = run.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{existing ? `${canEdit ? "Manage" : ""} ${def.name}`.trim() : `Connect ${def.name}`}</DialogTitle>
        <DialogDescription>{def.description}</DialogDescription>
      </DialogHeader>

      {existing && !mail ? (
        <KeyValue
          columns={2}
          items={[
            { label: "Status", value: <IntegrationBadge status={existing.status} /> },
            { label: "Connected", value: existing.connected_at ? fmtDateTime(existing.connected_at) : "—" },
            ...(existing.last_error ? [{ label: "Last error", value: existing.last_error }] : []),
          ]}
        />
      ) : null}

      {mail ? (
        <InboxSetup businessId={businessId} canEdit={canEdit} onChanged={() => onDone()} />
      ) : (
        <div className="grid gap-4">
          {!hasBooking ? <Notice tone="warning">Turn on bookings first: the webhook sends each booking and callback your receptionist takes.</Notice> : null}
          <Field label="Endpoint URL" htmlFor="wh-url" hint="We POST JSON to this HTTPS address after every booking and callback.">
            <Input id="wh-url" type="url" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} disabled={!canEdit || !hasBooking} placeholder="https://hooks.yourcrm.com/answered" />
          </Field>
          {c["signing_secret"] ? (
            <Field label="Signing secret" hint="Check the X-Twin-Signature header with this to know the request came from us.">
              <Input readOnly value={String(c["signing_secret"])} className="font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
            </Field>
          ) : null}
          <div className="rounded-[6px] bg-canvas-2 p-3 text-[12px] text-ink-muted">
            <div className="mb-1 font-semibold text-ink">Payload preview</div>
            <pre className="overflow-x-auto font-mono text-[11px] leading-4 text-ink">{`{
  "kind": "booking",
  "business": "${(ws.business?.name ?? "").replace(/"/g, "")}",
  "name": "…", "phone": "…",
  "service": "…", "start": "…"
}`}</pre>
          </div>
        </div>
      )}

      <DialogFooter className="mt-2 flex-row flex-wrap items-center justify-between gap-2 sm:justify-between">
        {existing && canEdit && !mail ? (
          <Button variant="ghost" size="sm" className="text-[#a41d1d] hover:bg-[#fff7f7] hover:text-[#a41d1d]" onClick={() => run.mutate("unhook")} disabled={busy}>
            Disconnect
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {canEdit && !mail ? "Cancel" : "Close"}
          </Button>
          {canEdit && !mail ? (
            <Button size="sm" disabled={busy || !hasBooking} onClick={() => run.mutate("hook")}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {existing ? "Save changes" : "Connect"}
            </Button>
          ) : null}
        </div>
      </DialogFooter>
    </>
  );
}
