import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Calendar, Cable, CheckCircle2, ExternalLink, Loader2, Mail, Plug, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Panel, ErrorState, Notice, KeyValue } from "@/components/app/primitives";
import { IntegrationBadge, StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtDateTime, fmtRelative, humanize } from "@/lib/app/format";
import { integrationEventsQuery, integrationsQuery } from "@/lib/app/queries";
import {
  calendarSignInUrl,
  changeCalendar,
  checkEmail,
  connectEmail,
  disconnectEmail,
  setEmailMode,
  removeCalendar,
  setUpCalendar,
  testCalendar,
} from "@/lib/api/manage";
import type { Integration } from "@/lib/app/types";
import { useWorkspace } from "@/lib/app/workspace";
import { cn } from "@/lib/utils";
import type { Hue } from "@/components/app/hues";
import { PRODUCT } from "@/lib/app/product";
import { ConnectApps } from "@/components/app/client/ConnectApps";

export const Route = createFileRoute("/_authenticated/app/integrations")({
  head: () => ({ meta: [{ title: `Integrations — ${PRODUCT}` }] }),
  validateSearch: (search: Record<string, unknown>): { error?: string; calendar?: string } => ({
    error: typeof search["error"] === "string" && search["error"] ? String(search["error"]).slice(0, 300) : undefined,
    calendar: search["calendar"] !== undefined ? String(search["calendar"]) : undefined,
  }),
  component: IntegrationsPage,
});

type Category = "Calendar" | "Email" | "CRM" | "Field service" | "Accounting" | "Automation";
interface Def {
  provider: string;
  name: string;
  category: Category;
  description: string;
  availability: "available";
}

const CATALOG: Def[] = [
  { provider: "builtin_calendar", name: `${PRODUCT} calendar`, category: "Calendar", description: "A simple calendar we keep for you. Nothing to connect; bookings show in Bookings.", availability: "available" },
  { provider: "google_calendar", name: "Google Calendar", category: "Calendar", description: "Your receptionist checks free times and books straight into Google Calendar.", availability: "available" },
  { provider: "microsoft_calendar", name: "Microsoft Outlook Calendar", category: "Calendar", description: "Book straight into Outlook and Microsoft 365 calendars.", availability: "available" },
  { provider: "email_mailbox", name: "Email inbox", category: "Email", description: "Your receptionist reads new enquiries in your inbox and drafts (or sends) replies.", availability: "available" },
  { provider: "webhook", name: "Webhook / custom CRM", category: "Automation", description: "Each booking and callback is sent as JSON to any HTTPS address, for your CRM or Zapier.", availability: "available" },
];

const CATEGORY_ICON: Record<Category, typeof Calendar> = {
  Calendar: Calendar,
  Email: Mail,
  CRM: Cable,
  "Field service": Plug,
  Accounting: Plug,
  Automation: Webhook,
};
const CATEGORY_HUE: Record<Category, Hue> = {
  Calendar: "cyan",
  Email: "magenta",
  CRM: "violet",
  "Field service": "amber",
  Accounting: "green",
  Automation: "coral",
};
const CALENDARS = ["builtin_calendar", "google_calendar", "microsoft_calendar"];
const CAL_PROVIDER: Record<string, "builtin" | "google" | "microsoft"> = { builtin_calendar: "builtin", google_calendar: "google", microsoft_calendar: "microsoft" };
const LENGTHS = [15, 20, 30, 45, 60, 90];

const cfg = (i?: Integration) => (i?.config && typeof i.config === "object" && !Array.isArray(i.config) ? (i.config as Record<string, unknown>) : {});

function IntegrationsPage() {
  const ws = useWorkspace();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const intQ = useQuery(integrationsQuery(ws.businessId));
  const evQ = useQuery(integrationEventsQuery(ws.businessId));
  const canEdit = ws.access.canEdit;

  const [dialog, setDialog] = useState<Def | null>(null);
  const integrations = intQ.data ?? [];
  const byProvider = useMemo(() => new Map(integrations.map((i) => [i.provider, i])), [integrations]);
  const calendar = integrations.find((i) => CALENDARS.includes(i.provider)) ?? null;
  const connected = integrations.filter((i) => i.status === "connected");
  const errored = integrations.filter((i) => i.status === "error");

  // Back from Google/Microsoft sign-in.
  useEffect(() => {
    if (search.error) toast.error("Calendar sign-in didn't finish", { description: search.error });
    else if (search.calendar) toast.success("Calendar connected", { description: "Your receptionist can now book into it." });
    if (search.error || search.calendar) void navigate({ search: {}, replace: true });
  }, [search.error, search.calendar, navigate]);

  const categories = Array.from(new Set(CATALOG.map((d) => d.category)));

  return (
    <div className="space-y-5">
      <PageHeader title="Apps" description="Connect the tools you already use." />

      {intQ.error ? <ErrorState message={intQ.error.message} onRetry={() => void intQ.refetch()} /> : null}
      {!canEdit ? <Notice tone="neutral">{ws.access.readOnlyReason ?? "Your access to this business is view only."}</Notice> : null}
      {errored.length > 0 ? (
        <Notice tone="warning" title={`${errored.length} integration${errored.length === 1 ? " needs" : "s need"} attention`}>
          {errored.map((i) => `${i.display_name ?? humanize(i.provider)}: ${i.last_error ?? "sync failed"}`).join(" · ")}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5 rounded-[4px] bg-canvas-2 px-2 py-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-[#1a9c5b]" /> {connected.length} connected
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-[4px] bg-canvas-2 px-2 py-1">
          <Plug className="h-3.5 w-3.5" /> {CATALOG.filter((d) => d.availability === "available").length} available
        </span>
      </div>

      <ConnectApps />

      {categories.map((cat) => (
        <section key={cat} className="space-y-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{cat}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {CATALOG.filter((d) => d.category === cat).map((def) => {
              const existing = byProvider.get(def.provider);
              const Icon = CATEGORY_ICON[def.category] ?? Plug;
              const status = existing?.status ?? "available";
              const otherCalendar = CALENDARS.includes(def.provider) && calendar && calendar.provider !== def.provider;
              return (
                <div key={def.provider} data-provider={def.provider} className={cn("card-surface flex flex-col gap-3 p-4 transition-shadow hover:shadow-[0_8px_22px_-16px_rgba(6,27,49,0.45)]", existing?.status === "connected" && "border-[#c3ecd9] shadow-[inset_0_2px_0_#1ea672]", existing?.status === "error" && "border-[#f2c9c9]")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span data-hue={CATEGORY_HUE[def.category] ?? "slate"} className="hue-icon grid h-9 w-9 shrink-0 place-items-center rounded-[8px]" aria-hidden>
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
                      ) : CALENDARS.includes(def.provider) && def.provider !== "builtin_calendar" ? (
                        <>Waiting for you to sign in</>
                      ) : (
                        <>Switched off</>
                      )}
                    </div>
                  ) : otherCalendar ? (
                    <div className="text-[11.5px] text-ink-muted">You're using {calendar!.display_name}. One calendar at a time.</div>
                  ) : null}
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    {existing ? (
                      <Button size="sm" variant="outline" className="h-8" onClick={() => setDialog(def)}>
                        {canEdit ? "Manage" : "View"}
                      </Button>
                    ) : (
                      <Button size="sm" className="h-8" onClick={() => setDialog(def)} disabled={!canEdit || !!otherCalendar}>
                        Connect
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

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

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          {dialog ? (
            <IntegrationDialog
              def={dialog}
              existing={byProvider.get(dialog.provider)}
              calendar={calendar}
              canEdit={canEdit}
              onDone={(list) => {
                if (list) qc.setQueryData(["integrations", ws.businessId], list);
                void qc.invalidateQueries({ queryKey: ["integrations", ws.businessId] });
                void qc.invalidateQueries({ queryKey: ["integration-events", ws.businessId] });
                void qc.invalidateQueries({ queryKey: ["agents", ws.businessId] });
              }}
              onClose={() => setDialog(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IntegrationDialog({
  def,
  existing,
  calendar,
  canEdit,
  onDone,
  onClose,
}: {
  def: Def;
  existing?: Integration;
  calendar: Integration | null;
  canEdit: boolean;
  onDone: (list?: Integration[]) => void;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const businessId = ws.businessId!;
  const c = cfg(existing);
  const isCalendar = CALENDARS.includes(def.provider);
  const provider = CAL_PROVIDER[def.provider];

  const [minutes, setMinutes] = useState(String(c["default_duration"] ?? 30));
  const [notifyEmail, setNotifyEmail] = useState(String(c["notify_email"] ?? (def.provider === "builtin_calendar" ? (c["account_email"] ?? "") : "")));
  const [enabled, setEnabled] = useState(c["enabled"] !== false);
  const [endpoint, setEndpoint] = useState(String(c["endpoint_url"] ?? ""));
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const savedMode: "draft" | "send" = c["mode"] === "send" ? "send" : "draft";
  const [mode, setMode] = useState<"draft" | "send">(savedMode);
  const [testResult, setTestResult] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async (action: "setup" | "save" | "remove" | "test" | "hook" | "unhook" | "mail" | "unmail" | "mode" | "check") => {
      switch (action) {
        case "setup": {
          const res = await setUpCalendar(businessId, { provider, minutes: Number(minutes), notifyEmail: notifyEmail.trim() });
          return { action, list: res.integrations };
        }
        case "save":
          return { action, list: (await changeCalendar(businessId, { minutes: Number(minutes), notifyEmail: notifyEmail.trim(), enabled })).integrations };
        case "remove":
          return { action, list: (await removeCalendar(businessId)).integrations };
        case "test": {
          const r = await testCalendar(businessId);
          const slots = Array.isArray(r.result?.slots) ? (r.result.slots as { time?: string }[]) : [];
          setTestResult(r.result?.error ?? (slots.length ? `${r.result.day}: ${slots.slice(0, 4).map((s) => s.time).join(", ")}${slots.length > 4 ? "…" : ""} are free.` : r.result?.message ?? "No free times."));
          return { action };
        }
        case "hook":
          if (!/^https:\/\/.+/i.test(endpoint.trim())) throw new Error("Enter an address that starts with https://");
          return { action, list: (await changeCalendar(businessId, { leadWebhook: endpoint.trim() })).integrations };
        case "unhook":
          return { action, list: (await changeCalendar(businessId, { leadWebhook: "" })).integrations };
        case "mail":
          await connectEmail(businessId, { address: address.trim(), password, mode });
          return { action };
        case "mode":
          await setEmailMode(businessId, mode);
          return { action };
        case "unmail":
          await disconnectEmail(businessId);
          return { action };
        case "check":
          await checkEmail(businessId);
          return { action };
      }
    },
    onSuccess: (res) => {
      const msg: Record<string, string> = {
        setup: provider === "builtin" ? "Bookings switched on" : "Calendar chosen",
        save: "Booking settings saved",
        remove: "Calendar removed",
        hook: "Webhook saved",
        unhook: "Webhook removed",
        mail: "Email inbox connected",
        unmail: "Email inbox disconnected",
        mode: mode === "send" ? "Replies are sent automatically" : "Replies are saved as drafts",
        check: "Inbox checked",
      };
      if (res.action !== "test") {
        toast.success(msg[res.action]);
        onDone(res.list);
      }
      if (res.action === "setup" && provider !== "builtin") {
        // Sign in with Google/Microsoft; they send the browser back to this page.
        window.location.assign(calendarSignInUrl(businessId, provider));
        return;
      }
      if (res.action !== "test" && res.action !== "check" && res.action !== "mode") onClose();
    },
    onError: (e) => toast.error("Couldn't save", { description: e.message }),
  });
  const busy = run.isPending;
  const otherCalendar = isCalendar && calendar && calendar.provider !== def.provider;
  const hasBooking = !!calendar;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{existing ? `${canEdit ? "Manage" : ""} ${def.name}`.trim() : `Connect ${def.name}`}</DialogTitle>
        <DialogDescription>{def.description}</DialogDescription>
      </DialogHeader>

      {existing ? (
        <KeyValue
          columns={2}
          items={[
            { label: "Status", value: <IntegrationBadge status={existing.status} /> },
            { label: "Connected", value: existing.connected_at ? fmtDateTime(existing.connected_at) : "—" },
            ...(c["account_email"] ? [{ label: "Account", value: <span className="[overflow-wrap:anywhere]">{String(c["account_email"])}</span> }] : []),
            ...(existing.last_sync_at ? [{ label: "Last checked", value: fmtRelative(existing.last_sync_at) }] : []),
            ...(existing.last_error ? [{ label: "Last error", value: existing.last_error }] : []),
          ]}
        />
      ) : null}

      {otherCalendar ? <Notice tone="warning">You're using {calendar!.display_name}. Remove it first to switch calendars.</Notice> : null}

      {isCalendar ? (
        <div className="grid gap-4">
          {!existing && provider !== "builtin" ? (
            <Notice tone="info" title="Secure sign-in">
              Next you'll sign in with {provider === "google" ? "Google" : "Microsoft"} and allow access to your calendar. We only check free times and add bookings.
            </Notice>
          ) : null}
          {existing && provider !== "builtin" && existing.status === "not_connected" && canEdit ? (
            <Button size="sm" variant="outline" className="w-fit" onClick={() => window.location.assign(calendarSignInUrl(businessId, provider))}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Sign in with {provider === "google" ? "Google" : "Microsoft"}
            </Button>
          ) : null}
          {existing ? (
            <div className="flex items-center justify-between gap-3 rounded-[6px] border border-hairline px-3 py-2">
              <span className="text-[12.5px] text-ink">Take bookings on calls</span>
              <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} aria-label="Take bookings on calls" />
            </div>
          ) : null}
          <Field label="Appointment length" htmlFor="cal-min">
            <Select value={minutes} onValueChange={setMinutes} disabled={!canEdit || !!otherCalendar}>
              <SelectTrigger id="cal-min"><SelectValue /></SelectTrigger>
              <SelectContent>{LENGTHS.map((m) => <SelectItem key={m} value={String(m)}>{m} minutes</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Email each booking to" htmlFor="cal-email" hint="Optional. Every booking and message is also in your dashboard.">
            <Input id="cal-email" type="email" value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} disabled={!canEdit || !!otherCalendar} placeholder="reception@yourbusiness.com" />
          </Field>
          {existing ? (
            <div className="space-y-2">
              <Button size="sm" variant="outline" onClick={() => run.mutate("test")} disabled={busy}>
                Check free times
              </Button>
              {testResult ? <p className="text-[12px] text-ink-muted" data-testid="calendar-test">{testResult}</p> : null}
            </div>
          ) : null}
        </div>
      ) : def.provider === "webhook" ? (
        <div className="grid gap-4">
          {!hasBooking ? (
            <Notice tone="warning">Set up a calendar first (the {PRODUCT} calendar is fine): the webhook sends each booking and callback your receptionist takes.</Notice>
          ) : null}
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
      ) : def.provider === "email_mailbox" ? (
        existing ? (
          <div className="grid gap-3">
            <Field label="Replies" htmlFor="em-mode">
              <Select value={mode} onValueChange={(v) => setMode(v as "draft" | "send")} disabled={!canEdit}>
                <SelectTrigger id="em-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft replies</SelectItem>
                  <SelectItem value="send">Send automatically</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => run.mutate("mode")} disabled={busy || mode === savedMode} data-action="save-email-mode">
                  Save changes
                </Button>
                <Button size="sm" variant="outline" onClick={() => run.mutate("check")} disabled={busy}>
                  Check now
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4">
            <Field label="Email address" htmlFor="em-addr">
              <Input id="em-addr" type="email" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canEdit} placeholder="hello@yourbusiness.com" />
            </Field>
            <Field label="App password" htmlFor="em-pass" hint="For Gmail or Outlook, create an app password in your account's security settings. It's stored encrypted.">
              <Input id="em-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Replies" htmlFor="em-mode">
              <Select value={mode} onValueChange={(v) => setMode(v as "draft" | "send")} disabled={!canEdit}>
                <SelectTrigger id="em-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft replies</SelectItem>
                  <SelectItem value="send">Send automatically</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        )
      ) : null}

      <DialogFooter className="mt-2 flex-row flex-wrap items-center justify-between gap-2 sm:justify-between">
        {existing && canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-[#a41d1d] hover:bg-[#fff7f7] hover:text-[#a41d1d]"
            onClick={() => run.mutate(isCalendar ? "remove" : def.provider === "webhook" ? "unhook" : "unmail")}
            disabled={busy}
          >
            Disconnect
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit ? (
            <Button
              size="sm"
              disabled={busy || !!otherCalendar || (def.provider === "webhook" && !hasBooking) || (def.provider === "email_mailbox" && !!existing)}
              onClick={() =>
                run.mutate(isCalendar ? (existing ? "save" : "setup") : def.provider === "webhook" ? "hook" : "mail")
              }
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : !existing && provider && provider !== "builtin" ? <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> : null}
              {existing ? "Save changes" : provider && provider !== "builtin" ? "Continue to sign in" : "Connect"}
            </Button>
          ) : null}
        </div>
      </DialogFooter>
    </>
  );
}
