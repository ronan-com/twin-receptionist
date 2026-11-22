import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Eye, Pause, Pencil, Phone, Play, Share2, UserMinus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState, KeyValue, Notice, PageSkeleton, EmptyState } from "@/components/app/primitives";
import { DataTable, type Column } from "@/components/app/DataTable";
import { AppointmentBadge, CallStatusBadge, DemoBadge, LeadStageBadge, OutcomeBadge, StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtDate, fmtDuration, fmtNumber, fmtPhone, fmtRelative, fmtSmartDate, humanize } from "@/lib/app/format";
import { adminBusinessDetailQuery } from "@/lib/app/queries";
import { platformApi, requestNumberFor, resolveIncident, revokeBusinessInvite, setBusinessStatus, shareBusiness, unshareBusiness, type ConsoleCall } from "@/lib/api/console";
import { describeHours, industry as industryPreset, type IndustryKey } from "@/lib/shared";
import type { AppointmentStatus, LeadStage } from "@/lib/app/types";
import { CallSheet, LinkBox, READ_ONLY_HINT, useConsole } from "./-shared";

export const Route = createFileRoute("/_authenticated/admin/clients/$businessId")({
  head: () => ({ meta: [{ title: "Client — Answered admin" }] }),
  component: ClientDetailPage,
});

function ClientDetailPage() {
  const { businessId } = Route.useParams();
  const { ws, platform, readOnly, canManage } = useConsole();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery(adminBusinessDetailQuery(businessId));
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [confirmPause, setConfirmPause] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"manager" | "viewer">("manager");
  const [shareLink, setShareLink] = useState<{ email: string; url: string; emailed: boolean } | null>(null);
  const [numType, setNumType] = useState<"local" | "mobile">("mobile");
  const [numNote, setNumNote] = useState("");

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin"] });
    await qc.invalidateQueries({ queryKey: ["console"] });
  };

  const pause = useMutation({
    mutationFn: (status: "active" | "paused") => setBusinessStatus(businessId, status),
    onSuccess: async (_d, status) => {
      toast.success(status === "paused" ? "Client paused" : "Client resumed");
      setConfirmPause(false);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const share = useMutation({
    mutationFn: () => shareBusiness(businessId, shareEmail.trim(), shareRole),
    onSuccess: async (r) => {
      if (r.added) toast.success(`${shareEmail.trim()} can now see this business`);
      else setShareLink({ email: shareEmail.trim(), url: r.url, emailed: r.emailed });
      setShareEmail("");
      await refresh();
    },
    onError: (e: Error) => toast.error("Couldn't share", { description: e.message }),
  });
  const unshare = useMutation({
    mutationFn: (userId: string) => unshareBusiness(businessId, userId),
    onSuccess: async () => {
      toast.success("Access removed");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => revokeBusinessInvite(businessId, inviteId),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const request = useMutation({
    mutationFn: () => requestNumberFor(businessId, numType, numNote.trim()),
    onSuccess: async () => {
      toast.success("Number requested", { description: "The platform team will buy and connect it." });
      setNumNote("");
      await refresh();
    },
    onError: (e: Error) => toast.error("Couldn't request a number", { description: e.message }),
  });
  const resolve = useMutation({ mutationFn: resolveIncident, onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });
  const viewAs = useMutation({
    mutationFn: async () => {
      await platformApi.viewAs(q.data!.business.org_id, businessId);
      await qc.invalidateQueries();
      await ws.refresh();
    },
    onSuccess: () => void navigate({ to: "/app" }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isPending) return <PageSkeleton metrics={4} rows={6} />;
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const b = d.business;
  const s = d.settings;
  const agent = d.agents[0];
  const ownOrg = ws.org?.id === b.org_id;
  const paused = b.status === "paused";

  const openWorkspace = () => {
    ws.setBusinessId(b.id);
    void navigate({ to: "/app/receptionist" });
  };

  const callColumns: Column<ConsoleCall>[] = [
    { key: "when", header: "When", cell: (c) => <span className="whitespace-nowrap text-ink-muted">{fmtSmartDate(c.started_at)}</span> },
    { key: "from", header: "Caller", cell: (c) => <span className="tabular-nums">{fmtPhone(c.from_number) || "Unknown"}</span> },
    { key: "status", header: "Status", cell: (c) => <CallStatusBadge status={c.status} /> },
    { key: "outcome", header: "Outcome", hideBelow: "md", cell: (c) => <OutcomeBadge outcome={c.outcome} /> },
    { key: "dur", header: "Length", align: "right", hideBelow: "sm", cell: (c) => <span className="tabular-nums">{fmtDuration(c.duration_seconds)}</span> },
  ];

  return (
    <div className="space-y-5" data-page="admin-client" data-business={b.id}>
      <Link to="/admin/clients" className="inline-flex items-center gap-1 text-[12.5px] text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> All clients
      </Link>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <span>{b.org_name}</span>
            {b.is_demo ? <DemoBadge /> : null}
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words">{b.name}</span>
            <StatusBadge tone={paused ? "warning" : "success"} dot>
              {paused ? (b.agency_paused ? "Agency paused" : "Paused") : "Active"}
            </StatusBadge>
          </span>
        }
        description={[b.industry, b.city, `Receptionist: ${b.receptionist_name || "Receptionist"}`].filter(Boolean).join(" · ")}
        actions={
          <>
            {ownOrg ? (
              <Button variant="outline" size="sm" className="h-8 text-[12.5px]" onClick={openWorkspace} data-action="open-workspace">
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> {readOnly ? "Open" : "Open and edit"}
              </Button>
            ) : null}
            {platform ? (
              <Button variant="outline" size="sm" className="h-8 text-[12.5px]" onClick={() => viewAs.mutate()} disabled={viewAs.isPending} data-action="view-as-customer">
                <Eye className="mr-1.5 h-3.5 w-3.5" /> View as customer
              </Button>
            ) : null}
            {canManage && !b.agency_paused ? (
              paused ? (
                <Button size="sm" className="h-8 text-[12.5px]" onClick={() => pause.mutate("active")} disabled={pause.isPending} data-action="resume">
                  <Play className="mr-1.5 h-3.5 w-3.5" /> Resume
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="h-8 text-[12.5px]" onClick={() => setConfirmPause(true)} data-action="pause">
                  <Pause className="mr-1.5 h-3.5 w-3.5" /> Pause
                </Button>
              )
            ) : null}
          </>
        }
      />

      {readOnly ? <Notice tone="info">{READ_ONLY_HINT}</Notice> : null}
      {paused ? (
        <Notice tone="warning" title={b.agency_paused ? "The agency is paused" : "This client is paused"}>
          Its receptionist won't book appointments or take callbacks through its tools, and the business can't change its settings. {b.agency_paused ? "Resume the agency from Agencies." : ""}
        </Notice>
      ) : null}

      <MetricGrid cols={4}>
        <MetricCard label="Calls" value={fmtNumber(d.counts.calls)} hint="All time" loading={false} />
        <MetricCard label="Bookings" value={fmtNumber(d.counts.appointments)} loading={false} />
        <MetricCard label="Follow-ups" value={fmtNumber(d.counts.leads)} loading={false} />
        <MetricCard label="Customers with access" value={fmtNumber(d.members.length)} hint={d.invitations.length ? `${d.invitations.length} invited` : undefined} loading={false} />
      </MetricGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Receptionist settings" description="A summary. Open and edit to change them." className="xl:col-span-2">
          <KeyValue
            items={[
              { label: "Industry", value: industryPreset((s.industry as IndustryKey) ?? "other").label },
              { label: "Suburb", value: s.suburb || "—" },
              { label: "Time zone", value: s.timezone?.replace(/_/g, " ") ?? "—" },
              { label: "Voice", value: s.voice ? `${s.voice.split(" - ")[0]} · ${s.tone === "professional" ? "Professional" : "Friendly"}` : "—" },
              { label: "Hours", value: s.hours ? describeHours(s.hours).join("; ") : "—" },
              { label: "Callers can ask for", value: s.services.join(", ") || "—" },
              { label: "Bookings", value: s.booking ? `${humanize(s.booking.provider)} calendar · ${s.booking.minutes} min${s.booking.enabled ? "" : " · switched off"}` : "Not set up (takes messages)" },
              { label: "Model", value: agent ? `${agent.llm_model}${agent.demo_assistant ? " · demo receptionist" : ""}` : "—", mono: true },
            ]}
          />
          {s.greeting ? <p className="mt-3 rounded-[6px] bg-canvas-2 px-3 py-2 text-[12.5px] text-ink">“{s.greeting}”</p> : null}
        </Panel>

        <Panel title="Phone number" description="Calls to this number go to the receptionist." >
          {d.numbers.length ? (
            <ul className="space-y-1.5" data-list="numbers">
              {d.numbers.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="flex items-center gap-1.5 tabular-nums">
                    <Phone className="h-3.5 w-3.5 text-ink-muted" /> {n.friendly_name}
                  </span>
                  <StatusBadge tone="success">{n.capabilities.sms ? "Calls + texts" : "Calls"}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-muted">No number yet. Callers can test it from the browser meanwhile.</p>
          )}
          {d.number_requests.length ? (
            <ul className="mt-3 space-y-1 border-t border-hairline pt-3 text-[12px]" data-list="number-requests">
              {d.number_requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-ink-muted">
                    {r.type === "mobile" ? "Mobile" : "Local"} · {fmtDate(r.created_at)}
                    {r.status === "declined" && r.reason ? ` · ${r.reason}` : ""}
                    {r.status === "done" && r.phone_number ? ` · ${fmtPhone(r.phone_number)}` : ""}
                  </span>
                  <StatusBadge tone={r.status === "pending" ? "info" : r.status === "done" ? "success" : "muted"}>{humanize(r.status)}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : null}
          {!readOnly ? (
            <form
              className="mt-3 space-y-2 border-t border-hairline pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                request.mutate();
              }}
            >
              <div className="text-[12.5px] font-medium text-ink">Request a number</div>
              <Select value={numType} onValueChange={(v) => setNumType(v as "local" | "mobile")}>
                <SelectTrigger className="h-8 text-[12.5px]" aria-label="Number type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mobile">Mobile (calls and texts)</SelectItem>
                  <SelectItem value="local">Local (calls only)</SelectItem>
                </SelectContent>
              </Select>
              <Input value={numNote} onChange={(e) => setNumNote(e.target.value)} placeholder="Note (optional), e.g. Brisbane area code" className="h-8 text-[12.5px]" maxLength={300} />
              <Button type="submit" size="sm" variant="outline" className="h-8 w-full text-[12.5px]" disabled={request.isPending} data-action="request-number">
                {request.isPending ? "Requesting…" : "Request number"}
              </Button>
              {platform ? (
                <p className="text-[11.5px] text-ink-muted">
                  Then buy it from <Link to="/admin/number-requests" className="text-indigo hover:underline">Number requests</Link>.
                </p>
              ) : null}
            </form>
          ) : null}
        </Panel>
      </div>

      <Panel title="Customers with access" description="The business's own people. Managers can change the receptionist; viewers only look." padded={false}>
        <ul className="divide-y divide-hairline" data-list="customers">
          {d.members.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 px-4 py-2.5 text-[13px] sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{m.profile.full_name || m.profile.email}</div>
                <div className="truncate text-[12px] text-ink-muted">{m.profile.email} · since {fmtDate(m.created_at)}</div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={m.access_role === "manager" ? "indigo" : "muted"}>{m.access_role === "manager" ? "Manager" : "Viewer"}</StatusBadge>
                {canManage ? (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-ink-muted" onClick={() => unshare.mutate(m.user_id)} disabled={unshare.isPending}>
                    <UserMinus className="mr-1 h-3.5 w-3.5" /> Remove
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
          {d.invitations.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 px-4 py-2.5 text-[13px] sm:flex-row sm:items-center sm:justify-between" data-invite={i.email}>
              <div className="min-w-0">
                <div className="truncate text-ink">{i.email}</div>
                <div className="truncate text-[12px] text-ink-muted">Invited · link works until {fmtDate(i.expires_at)}</div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone="info">{i.access_role === "manager" ? "Manager" : "Viewer"} · pending</StatusBadge>
                {canManage ? (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-ink-muted" onClick={() => revoke.mutate(i.id)} disabled={revoke.isPending}>
                    <X className="mr-1 h-3.5 w-3.5" /> Revoke
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
          {d.members.length === 0 && d.invitations.length === 0 ? <li className="px-4 py-5 text-center text-[12.5px] text-ink-muted">Not shared with anyone at the business yet.</li> : null}
        </ul>
        {canManage ? (
          <form
            className="flex flex-col gap-3 border-t border-hairline p-4 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (shareEmail.trim()) share.mutate();
            }}
            data-form="share"
          >
            <Field label="Share with (email)" htmlFor="share-email" className="min-w-0 flex-1">
              <Input id="share-email" type="email" value={shareEmail} onChange={(e) => setShareEmail(e.target.value)} placeholder="owner@business.com.au" className="h-9" required />
            </Field>
            <Field label="Access" htmlFor="share-role" className="sm:w-40">
              <Select value={shareRole} onValueChange={(v) => setShareRole(v as "manager" | "viewer")}>
                <SelectTrigger id="share-role" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" size="sm" className="h-9" disabled={share.isPending || !shareEmail.trim()} data-action="share">
              <Share2 className="mr-1.5 h-3.5 w-3.5" /> {share.isPending ? "Sharing…" : "Share"}
            </Button>
          </form>
        ) : !readOnly ? (
          <p className="border-t border-hairline px-4 py-3 text-[12px] text-ink-muted">Only agency owners and admins can share a client.</p>
        ) : null}
        {shareLink ? (
          <div className="space-y-2 border-t border-hairline p-4" data-share-link>
            <p className="text-[12.5px] text-ink-muted">
              {shareLink.emailed ? `Invite emailed to ${shareLink.email}. You can also send them this link:` : `Send ${shareLink.email} this link (invite emails aren't set up on this server yet):`}
            </p>
            <LinkBox url={shareLink.url} />
          </div>
        ) : null}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Recent calls" className="xl:col-span-2" padded={false}>
          <DataTable
            columns={callColumns}
            rows={d.calls}
            rowKey={(c) => c.id}
            onRowClick={(c) => setOpenCall(c.id)}
            rowClassName={(c) => (c.status === "failed" ? "bg-[#fff7f7]" : undefined)}
            dense
            pageSize={8}
            empty={{ title: "No calls yet", description: "Calls show here within a minute of ending." }}
          />
        </Panel>
        <Panel title="Bookings and follow-ups" padded={false}>
          <ul className="divide-y divide-hairline">
            {d.appointments.map((a) => (
              <li key={`a-${a.id}`} className="flex items-start justify-between gap-2 px-4 py-2.5 text-[12.5px]">
                <div className="min-w-0">
                  <div className="truncate text-ink">{a.customer_name ?? "Someone"} · {a.service ?? "Appointment"}</div>
                  <div className="truncate text-[11.5px] text-ink-muted">{a.starts_at ? fmtSmartDate(a.starts_at) : fmtRelative(a.created_at)}</div>
                </div>
                <AppointmentBadge status={a.status as AppointmentStatus} />
              </li>
            ))}
            {d.leads.map((l) => (
              <li key={`l-${l.id}`} className="flex items-start justify-between gap-2 px-4 py-2.5 text-[12.5px]">
                <div className="min-w-0">
                  <div className="truncate text-ink">{l.name ?? fmtPhone(l.phone) ?? "A caller"} · {l.intent}</div>
                  <div className="truncate text-[11.5px] text-ink-muted">{fmtRelative(l.created_at)}</div>
                </div>
                <LeadStageBadge stage={l.stage as LeadStage} />
              </li>
            ))}
            {d.appointments.length + d.leads.length === 0 ? <li className="p-6 text-center text-[12.5px] text-ink-muted">Nothing yet.</li> : null}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Incidents" description="Problems found in the background for this client" padded={false}>
          {d.incidents.length === 0 ? (
            <EmptyState compact title="No incidents" description="Everything has worked so far." />
          ) : (
            <ul className="divide-y divide-hairline">
              {d.incidents.map((i) => (
                <li key={i.id} className="flex flex-col gap-2 px-4 py-2.5 text-[12.5px] sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="break-words text-ink">{i.title}</div>
                    <div className="truncate text-[11.5px] text-ink-muted">{humanize(i.source)} · {fmtRelative(i.started_at)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge tone={i.status === "open" ? "danger" : "success"} dot>{humanize(i.status)}</StatusBadge>
                    {i.status === "open" && !readOnly ? (
                      <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => resolve.mutate(i.id)} disabled={resolve.isPending}>
                        Resolve
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Changes" description="Audit log for this client" padded={false}>
          {d.audit.length === 0 ? (
            <EmptyState compact title="Nothing logged yet" />
          ) : (
            <ul className="divide-y divide-hairline">
              {d.audit.map((a) => (
                <li key={a.id} className="px-4 py-2.5 text-[12.5px]">
                  <div className="truncate text-ink">{a.summary}</div>
                  <div className="truncate text-[11.5px] text-ink-muted">{a.actor_email ?? "System"} · {fmtRelative(a.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <AlertDialog open={confirmPause} onOpenChange={setConfirmPause}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause {b.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its receptionist stops booking and taking callbacks through its tools, and the business can't change its settings until you resume it. Nothing is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pause.mutate("paused")} data-action="confirm-pause">
              Pause client
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CallSheet callId={openCall} onClose={() => setOpenCall(null)} />
    </div>
  );
}
