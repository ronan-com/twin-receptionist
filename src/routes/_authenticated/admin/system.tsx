import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Plug, PhoneMissed, Plus, ServerCrash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState, Notice } from "@/components/app/primitives";
import { DataTable, type Column } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtNumber, fmtRelative, fmtSmartDate, humanize, truncate } from "@/lib/app/format";
import { adminBusinessesQuery, adminSystemQuery } from "@/lib/app/queries";
import { logIncident, resolveIncident, type AdminSystem, type ConsoleCall, type ConsoleIncident } from "@/lib/api/console";
import { BizCell, CallSheet, useConsole } from "./-shared";

export const Route = createFileRoute("/_authenticated/admin/system")({
  head: () => ({ meta: [{ title: "System / QA — Answered admin" }] }),
  component: AdminSystemPage,
});

function AdminSystemPage() {
  const { platform, readOnly } = useConsole();
  const qc = useQueryClient();
  const q = useQuery({ ...adminSystemQuery(), refetchInterval: 60_000 });
  const bizQ = useQuery(adminBusinessesQuery());
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [logging, setLogging] = useState(false);
  const [draft, setDraft] = useState({ title: "", details: "", severity: "error", client_id: "none" });
  const d = q.data as AdminSystem | undefined;

  const after = async (data: AdminSystem) => {
    qc.setQueryData(adminSystemQuery().queryKey, data);
    await qc.invalidateQueries({ queryKey: ["admin", "overview-counts"] });
    await qc.invalidateQueries({ queryKey: ["console"] });
  };
  const resolve = useMutation({
    mutationFn: resolveIncident,
    onSuccess: async (data) => {
      toast.success("Incident resolved");
      await after(data);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const create = useMutation({
    mutationFn: () => logIncident({ title: draft.title.trim(), details: draft.details.trim(), severity: draft.severity, client_id: draft.client_id === "none" ? undefined : draft.client_id }),
    onSuccess: async (data) => {
      toast.success("Incident logged");
      setLogging(false);
      setDraft({ title: "", details: "", severity: "error", client_id: "none" });
      await after(data);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const open = useMemo(() => (d?.incidents ?? []).filter((i) => i.status === "open"), [d]);
  const shown = showResolved ? (d?.incidents ?? []) : open;

  const failedColumns: Column<ConsoleCall>[] = [
    { key: "client", header: "Client", cell: (c) => <BizCell biz={c.business} showAgency={platform} /> },
    { key: "error", header: "Error", cell: (c) => <span className="truncate text-[#a41d1d]">{truncate(c.error_message, 70) || "Unknown"}</span> },
    { key: "at", header: "When", align: "right", hideBelow: "sm", cell: (c) => <span className="whitespace-nowrap text-ink-muted">{fmtSmartDate(c.started_at)}</span> },
  ];
  type IntErr = AdminSystem["integrationErrors"][number];
  const intColumns: Column<IntErr>[] = [
    { key: "client", header: "Client", cell: (e) => <BizCell biz={e.business} showAgency={platform} /> },
    { key: "what", header: "Integration", hideBelow: "sm", cell: (e) => <span className="text-ink-muted">{e.integration?.display_name ?? humanize(e.type.replace("integration.", ""))}</span> },
    { key: "msg", header: "Problem", cell: (e) => <span className="truncate text-ink">{truncate(e.message, 80)}</span> },
    { key: "at", header: "Since", align: "right", hideBelow: "md", cell: (e) => <span className="whitespace-nowrap text-ink-muted">{fmtRelative(e.occurred_at)}</span> },
  ];
  type Prov = AdminSystem["providers"][number];
  const provColumns: Column<Prov>[] = [
    { key: "name", header: "Phone account", cell: (p) => <span className="font-medium text-ink">{p.name}</span> },
    { key: "mode", header: "Uses", cell: (p) => <span className="text-ink-muted">{p.mode === "own" ? "Agency's own key" : p.mode === "platform" ? "Platform account" : "Nothing yet"}</span> },
    { key: "status", header: "Status", cell: (p) => <StatusBadge tone={p.credentials_set ? "success" : "warning"} dot>{p.credentials_set ? "Ready" : "Not set up"}</StatusBadge> },
  ];

  return (
    <div className="space-y-5" data-page="admin-system">
      <PageHeader
        eyebrow={platform ? "Platform console" : "Agency console"}
        title="System / QA"
        description="Background problems (calendar sign-ins, call syncs, tool calls), failed calls and integration errors. Last 30 days."
        actions={
          !readOnly ? (
            <Button size="sm" variant="outline" className="h-8 text-[12.5px]" onClick={() => setLogging(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Log an incident
            </Button>
          ) : null
        }
      />

      <MetricGrid cols={4}>
        <MetricCard label="Open incidents" value={fmtNumber(open.length)} icon={AlertTriangle} loading={q.isPending} />
        <MetricCard label="Failed calls" value={fmtNumber(d?.failedCalls.length ?? 0)} icon={PhoneMissed} loading={q.isPending} />
        <MetricCard label="Integration errors" value={fmtNumber(d?.integrationErrors.length ?? 0)} icon={Plug} loading={q.isPending} />
        <MetricCard label={platform ? "Phone accounts not set up" : "Resolved incidents"} value={fmtNumber(platform ? (d?.providers ?? []).filter((p) => !p.credentials_set).length : (d?.incidents ?? []).length - open.length)} icon={ServerCrash} loading={q.isPending} />
      </MetricGrid>

      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}

      <Panel
        title="Incidents"
        description={showResolved ? "All, newest first" : "Open, newest first"}
        padded={false}
        actions={
          <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? "Open only" : "Show resolved"}
          </Button>
        }
      >
        <ul className="divide-y divide-hairline" data-list="incidents">
          {shown.map((i) => (
            <IncidentRow key={i.id} i={i} platform={platform} canResolve={!readOnly} onResolve={() => resolve.mutate(i.id)} busy={resolve.isPending} />
          ))}
          {!q.isPending && shown.length === 0 ? <li className="p-6 text-center text-[13px] text-ink-muted">{showResolved ? "No incidents recorded." : "No open incidents. Everything is healthy."}</li> : null}
        </ul>
      </Panel>

      <Tabs defaultValue="failed">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="failed">Failed calls</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          {platform ? <TabsTrigger value="providers">Phone accounts</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="failed" className="mt-4">
          <Panel padded={false}>
            <DataTable columns={failedColumns} rows={d?.failedCalls ?? []} rowKey={(c) => c.id} onRowClick={(c) => setOpenCall(c.id)} rowClassName={() => "bg-[#fff7f7]"} loading={q.isPending} empty={{ title: "No failed calls", icon: PhoneMissed }} />
          </Panel>
        </TabsContent>
        <TabsContent value="integrations" className="mt-4">
          <Panel padded={false}>
            <DataTable columns={intColumns} rows={d?.integrationErrors ?? []} rowKey={(e) => e.id} loading={q.isPending} empty={{ title: "No integration errors", icon: Plug }} />
          </Panel>
        </TabsContent>
        {platform ? (
          <TabsContent value="providers" className="mt-4">
            <Panel padded={false}>
              <DataTable columns={provColumns} rows={d?.providers ?? []} rowKey={(p) => p.id} loading={q.isPending} empty={{ title: "No agencies yet" }} />
            </Panel>
          </TabsContent>
        ) : null}
      </Tabs>
      <Notice tone="neutral">The QA review queue and unanswered-question detection aren't available yet.</Notice>

      <Dialog open={logging} onOpenChange={setLogging}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.title.trim()) create.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Log an incident</DialogTitle>
              <DialogDescription>For something you noticed yourself, so the team can track it until it's resolved.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid gap-3">
              <Field label="What happened" htmlFor="inc-title" required>
                <Input id="inc-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={300} required />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Client" htmlFor="inc-client">
                  <Select value={draft.client_id} onValueChange={(v) => setDraft({ ...draft, client_id: v })}>
                    <SelectTrigger id="inc-client"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{platform ? "Platform-wide" : "Not one client"}</SelectItem>
                      {(bizQ.data ?? []).map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Severity" htmlFor="inc-sev">
                  <Select value={draft.severity} onValueChange={(v) => setDraft({ ...draft, severity: v })}>
                    <SelectTrigger id="inc-sev"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="warning">Warning</SelectItem>
                      <SelectItem value="error">Error</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Details" htmlFor="inc-details">
                <Textarea id="inc-details" rows={3} value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} maxLength={2000} />
              </Field>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setLogging(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending || !draft.title.trim()}>{create.isPending ? "Logging…" : "Log incident"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CallSheet callId={openCall} onClose={() => setOpenCall(null)} />
    </div>
  );
}

function IncidentRow({ i, platform, canResolve, onResolve, busy }: { i: ConsoleIncident; platform: boolean; canResolve: boolean; onResolve: () => void; busy: boolean }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-2.5 text-[12.5px] sm:flex-row sm:items-start sm:justify-between" data-incident={i.id}>
      <div className="min-w-0">
        <div className="break-words text-ink">{i.title}</div>
        <div className="truncate text-[11.5px] text-ink-muted">
          {i.business?.name ?? (platform ? i.org_name ?? "Platform" : "Agency")} · {humanize(i.source)} · {fmtRelative(i.started_at)}
          {i.details ? ` · ${truncate(i.details, 80)}` : ""}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge tone={i.severity === "critical" || i.severity === "error" ? "danger" : i.severity === "warning" ? "warning" : "muted"}>{humanize(i.severity)}</StatusBadge>
        <StatusBadge tone={i.status === "open" ? "danger" : "success"} dot>{humanize(i.status)}</StatusBadge>
        {i.status === "open" && canResolve ? (
          <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={onResolve} disabled={busy} data-action="resolve">
            Resolve
          </Button>
        ) : null}
      </div>
    </li>
  );
}
