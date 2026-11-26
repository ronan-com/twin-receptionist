import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Eye, Pause, Pencil, Phone, Play, Plus, Share2, UserMinus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState, KeyValue, Notice, PageSkeleton, EmptyState, InitialsAvatar } from "@/components/app/primitives";
import { DataTable, type Column } from "@/components/app/DataTable";
import { AppointmentBadge, CallStatusBadge, DemoBadge, LeadStageBadge, OutcomeBadge, StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtDate, fmtDuration, fmtNumber, fmtPhone, fmtRelative, fmtSmartDate, humanize } from "@/lib/app/format";
import { brandApi, companyApi, platformApi, requestNumberFor, resolveIncident, setBusinessStatus, type CompanyDetail, type CompanyReceptionist, type ConsoleCall } from "@/lib/api/console";
import { describeHours, INDUSTRIES, industry as industryPreset, type IndustryKey } from "@/lib/shared";
import type { AppointmentStatus, LeadStage } from "@/lib/app/types";
import { AutomationChips, AutomationIcon, CallSheet, LinkBox, READ_ONLY_HINT, useConsole } from "./-shared";
import { BrandEditor } from "./-brand";
import { BuyNumber } from "./-buy-number";
import { ImportNumber } from "./-import-number";
import { AttachedNumbers } from "./-own-numbers";
import { TestCall } from "@/components/app/TestCall";
import { WebsiteChatCard } from "@/components/app/webchat/WebsiteChatCard";
import { PRODUCT } from "@/lib/app/product";

// A client: one company the agency looks after, with everything under it (its
// receptionists and their automations, calls, bookings, customers and branding).
// The path id is the company's (old links with a receptionist's id open its company).
export const Route = createFileRoute("/_authenticated/admin/clients/$businessId")({
  head: () => ({ meta: [{ title: `Client — ${PRODUCT} admin` }] }),
  component: ClientDetailPage,
});

function ClientDetailPage() {
  const { businessId } = Route.useParams();
  const { ws, platform, readOnly, canManage } = useConsole();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = ["console", "company", businessId];
  const q = useQuery({ queryKey: key, queryFn: () => companyApi.get(businessId) });
  const agencyBrand = useQuery({ queryKey: ["console", "brand"], queryFn: brandApi.get, enabled: !platform });
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [confirmPause, setConfirmPause] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editIndustry, setEditIndustry] = useState<IndustryKey>("other");
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"manager" | "viewer">("manager");
  const [shareLink, setShareLink] = useState<{ email: string; url: string; emailed: boolean } | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [onboardEmail, setOnboardEmail] = useState("");
  const [onboardLink, setOnboardLink] = useState<{ url: string; emailed: boolean; added: boolean } | null>(null);
  const flash = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["console"] });
    await qc.invalidateQueries({ queryKey: ["admin"] });
  };
  const set = (d: CompanyDetail) => qc.setQueryData(key, d);

  const pause = useMutation({
    mutationFn: (status: "active" | "paused") => companyApi.setStatus(businessId, status),
    onSuccess: async (d, status) => {
      set(d);
      toast.success(status === "paused" ? "Client paused" : "Client resumed");
      setConfirmPause(false);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rename = useMutation({
    mutationFn: () => companyApi.update(businessId, { name: editName.trim(), industry: editIndustry }),
    onSuccess: async (d) => {
      set(d);
      setEditing(false);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const share = useMutation({
    mutationFn: () => companyApi.share(businessId, shareEmail.trim(), shareRole),
    onSuccess: async (r) => {
      if (r.added) toast.success(`${shareEmail.trim()} can now see this client`);
      else setShareLink({ email: shareEmail.trim(), url: r.url, emailed: r.emailed });
      setShareEmail("");
      await refresh();
    },
    onError: (e: Error) => toast.error("Couldn't invite", { description: e.message }),
  });
  const unshare = useMutation({
    mutationFn: (userId: string) => companyApi.unshare(businessId, userId),
    onSuccess: async () => {
      toast.success("Access removed");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revoke = useMutation({ mutationFn: (id: string) => companyApi.revokeInvite(businessId, id), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });
  const onboard = useMutation({
    mutationFn: () => companyApi.sendOnboarding({ id: businessId, email: onboardEmail.trim() }),
    onSuccess: async (r) => {
      setOnboardLink(r);
      await refresh();
    },
    onError: (e: Error) => toast.error("Couldn't send the onboarding link", { description: e.message }),
  });
  const resolve = useMutation({ mutationFn: resolveIncident, onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });
  const viewAs = useMutation({
    mutationFn: async (r: CompanyReceptionist) => {
      await platformApi.viewAs(q.data!.company.org_id, r.id);
      await qc.invalidateQueries();
      await ws.refresh();
      ws.setBusinessId(r.id);
    },
    onSuccess: () => void navigate({ to: "/app" }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isPending) return <PageSkeleton metrics={4} rows={6} />;
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const co = d.company;
  const paused = co.status === "paused";
  const ownOrg = ws.org?.id === co.org_id;
  const nameOf = (id: string) => d.receptionists.find((r) => r.id === id)?.name ?? "";

  const callColumns: Column<ConsoleCall>[] = [
    { key: "when", header: "When", cell: (c) => <span className="whitespace-nowrap text-ink-muted">{fmtSmartDate(c.started_at)}</span> },
    { key: "from", header: "Caller", cell: (c) => <span className="tabular-nums">{fmtPhone(c.from_number) || "Unknown"}</span> },
    ...(d.receptionists.length > 1 ? [{ key: "rec", header: "Receptionist", hideBelow: "lg" as const, cell: (c: ConsoleCall) => <span className="truncate">{c.agent?.name ?? "—"}</span> }] : []),
    { key: "status", header: "Status", cell: (c) => <CallStatusBadge status={c.status} /> },
    { key: "outcome", header: "Outcome", hideBelow: "md", cell: (c) => <OutcomeBadge outcome={c.outcome} /> },
    { key: "dur", header: "Length", align: "right", hideBelow: "sm", cell: (c) => <span className="tabular-nums">{fmtDuration(c.duration_seconds)}</span> },
  ];

  return (
    <div className="space-y-5" data-page="admin-client" data-company={co.id}>
      <Link to="/admin/clients" className="inline-flex items-center gap-1 text-[12.5px] text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> All clients
      </Link>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <span>{platform ? co.org_name : "Client"}</span>
            {co.is_demo ? <DemoBadge /> : null}
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            <InitialsAvatar name={co.name} size={32} className="mr-0.5" />
            <span className="min-w-0 break-words" data-company-name>{co.name}</span>
            {d.receptionists.length ? (
              <StatusBadge tone={paused ? "muted" : "success"} dot>
                {paused ? (co.agency_paused ? "Agency paused" : "Paused") : "Active"}
              </StatusBadge>
            ) : (
              <StatusBadge tone="muted">Setting up</StatusBadge>
            )}
          </span>
        }
        description={[co.industry ? industryPreset(co.industry as IndustryKey).label : "", `${d.receptionists.length} receptionist${d.receptionists.length === 1 ? "" : "s"}`, `since ${fmtDate(co.created_at)}`].filter(Boolean).join(" · ")}
        actions={
          !readOnly ? (
            <>
              <Button asChild size="sm" className="h-8 text-[12.5px]">
                <Link to="/admin/clients/new" search={{ company: co.id }} data-action="add-receptionist">
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add receptionist
                </Link>
              </Button>
              {canManage ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-[12.5px]"
                  onClick={() => {
                    setOnboardLink(null);
                    setOnboardEmail(d.members.find((m) => m.access_role === "manager")?.profile.email ?? "");
                    setOnboarding(true);
                  }}
                  data-action="send-onboarding"
                >
                  <Share2 className="mr-1.5 h-3.5 w-3.5" /> Send onboarding link
                </Button>
              ) : null}
              {canManage ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-[12.5px]"
                  onClick={() => {
                    setEditName(co.name);
                    setEditIndustry((co.industry as IndustryKey) || "other");
                    setEditing(true);
                  }}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                </Button>
              ) : null}
              {canManage && d.receptionists.length && !co.agency_paused ? (
                paused ? (
                  <Button variant="outline" size="sm" className="h-8 text-[12.5px]" onClick={() => pause.mutate("active")} disabled={pause.isPending} data-action="resume">
                    <Play className="mr-1.5 h-3.5 w-3.5" /> Resume
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="h-8 text-[12.5px]" onClick={() => setConfirmPause(true)} data-action="pause">
                    <Pause className="mr-1.5 h-3.5 w-3.5" /> Pause
                  </Button>
                )
              ) : null}
            </>
          ) : null
        }
      />

      {readOnly ? <Notice tone="info">{READ_ONLY_HINT}</Notice> : null}
      {flash?.get("error") ? <Notice tone="danger" title="Calendar sign-in didn't finish">{flash.get("error")}</Notice> : null}
      {flash?.get("calendar") ? <Notice tone="success">Calendar connected.</Notice> : null}
      {co.onboarding_pending ? (
        <Notice tone="info" title="Waiting for client to finish setup">
          <span data-onboarding="pending">The client's manager has an onboarding link. Their receptionist runs on sensible defaults until they finish.</span>
        </Notice>
      ) : null}
      {paused ? (
        <Notice tone="warning" title={co.agency_paused ? "The agency is paused" : "This client is paused"}>
          Its receptionists won't book appointments or take callbacks through their tools, and the business can't change its settings.
        </Notice>
      ) : null}

      <MetricGrid cols={5}>
        <MetricCard label="Receptionists" value={fmtNumber(d.receptionists.length)} loading={false} />
        <MetricCard label="Calls" value={fmtNumber(d.counts.calls)} hint="All time" loading={false} />
        <MetricCard label="Bookings" value={fmtNumber(d.counts.appointments)} loading={false} />
        <MetricCard label="Follow-ups" value={fmtNumber(d.counts.leads)} loading={false} />
        <MetricCard label="Customers with access" value={fmtNumber(d.members.length)} hint={d.invitations.length ? `${d.invitations.length} invited` : undefined} loading={false} />
      </MetricGrid>

      <section className="space-y-3" data-section="receptionists">
        <h2 className="text-[14px] font-semibold text-ink">Receptionists and automations</h2>
        {d.receptionists.length === 0 ? (
          <Panel>
            <EmptyState
              compact
              title="No receptionist yet"
              description="Add one: it answers calls, replies to texts and emails, and books appointments for this client."
              action={
                !readOnly ? (
                  <Button asChild size="sm">
                    <Link to="/admin/clients/new" search={{ company: co.id }}>Add receptionist</Link>
                  </Button>
                ) : undefined
              }
            />
          </Panel>
        ) : (
          d.receptionists.map((r) => (
            <ReceptionistCard
              key={r.id}
              r={r}
              companyName={co.name}
              ownOrg={ownOrg}
              platform={platform}
              readOnly={readOnly}
              canManage={canManage}
              onOpen={() => {
                ws.setBusinessId(r.id);
                void navigate({ to: "/app/receptionist" });
              }}
              onViewAs={() => viewAs.mutate(r)}
              viewing={viewAs.isPending}
              onChanged={refresh}
            />
          ))
        )}
      </section>

      <Panel title="Customers with access" description="The company's own people. Managers can change its receptionists; viewers only look. Access covers every receptionist of this client." padded={false}>
        <ul className="divide-y divide-hairline" data-list="customers">
          {d.members.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 px-4 py-2.5 text-[13px] sm:flex-row sm:items-center sm:justify-between" data-customer={m.profile.email}>
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{m.profile.full_name || m.profile.email}</div>
                <div className="truncate text-[12px] text-ink-muted">
                  {m.profile.email} · since {fmtDate(m.created_at)}
                  {d.receptionists.length > 1 ? ` · ${m.receptionists.map(nameOf).filter(Boolean).join(", ")}` : ""}
                </div>
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
                <StatusBadge tone="warning">{i.access_role === "manager" ? "Manager" : "Viewer"} · pending</StatusBadge>
                {canManage ? (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-ink-muted" onClick={() => revoke.mutate(i.id)} disabled={revoke.isPending}>
                    <X className="mr-1 h-3.5 w-3.5" /> Revoke
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
          {d.members.length === 0 && d.invitations.length === 0 ? <li className="px-4 py-5 text-center text-[12.5px] text-ink-muted">Not shared with anyone at the company yet.</li> : null}
        </ul>
        {canManage && d.receptionists.length ? (
          <form
            className="flex flex-col gap-3 border-t border-hairline p-4 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (shareEmail.trim()) share.mutate();
            }}
            data-form="share"
          >
            <Field label="Invite customer (email)" htmlFor="share-email" className="min-w-0 flex-1">
              <Input id="share-email" type="email" value={shareEmail} onChange={(e) => setShareEmail(e.target.value)} placeholder="owner@business.com.au" className="h-9" required />
            </Field>
            <Field label="Access" htmlFor="share-role" className="sm:w-40">
              <Select value={shareRole} onValueChange={(v) => setShareRole(v as "manager" | "viewer")}>
                <SelectTrigger id="share-role" className="h-9" data-select="access-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" size="sm" className="h-9" disabled={share.isPending || !shareEmail.trim()} data-action="share">
              <Share2 className="mr-1.5 h-3.5 w-3.5" /> {share.isPending ? "Inviting…" : "Invite customer"}
            </Button>
          </form>
        ) : !readOnly && !canManage ? (
          <p className="border-t border-hairline px-4 py-3 text-[12px] text-ink-muted">Only agency owners and admins can invite customers.</p>
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

      <Panel title="Branding" description={`${co.name}'s logo, background and colours on its customer workspace. Blank fields use the agency's branding.`}>
        <BrandEditor
          brand={d.brand}
          fallback={agencyBrand.data}
          canManage={canManage}
          previewName={co.name}
          upload={(kind, file) => companyApi.upload(co.id, kind, file)}
          save={(change) => companyApi.setBrand(co.id, change)}
          onSaved={async (b) => {
            qc.setQueryData(key, { ...d, brand: b });
            await qc.invalidateQueries({ queryKey: ["console", "companies"] });
          }}
        />
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
          <ul className="divide-y divide-hairline" data-list="bookings">
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
            <AlertDialogTitle>Pause {co.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All its receptionists stop booking and taking callbacks through their tools, and the business can't change its settings until you resume it. Nothing is deleted.
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

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editName.trim()) rename.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit client</DialogTitle>
              <DialogDescription>The company's name and industry in your console.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid gap-3">
              <Field label="Company name" htmlFor="edit-name" required>
                <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={120} required />
              </Field>
              <Field label="Industry" htmlFor="edit-industry">
                <Select value={editIndustry} onValueChange={(v) => setEditIndustry(v as IndustryKey)}>
                  <SelectTrigger id="edit-industry"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map((i) => (
                      <SelectItem key={i.key} value={i.key}>{i.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button type="submit" disabled={rename.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={onboarding} onOpenChange={setOnboarding}>
        <DialogContent>
          {onboardLink ? (
            <div data-onboarding-sent>
              <DialogHeader>
                <DialogTitle>Onboarding link ready</DialogTitle>
                <DialogDescription>
                  {onboardLink.added ? "They already have a login and are now a manager of this client." : onboardLink.emailed ? "Emailed. You can also send them this link:" : "Send them this link (invite emails aren't set up on this server yet):"}
                </DialogDescription>
              </DialogHeader>
              {onboardLink.url ? (
                <div className="mt-4">
                  <LinkBox url={onboardLink.url} label="Onboarding link" />
                </div>
              ) : null}
              <DialogFooter className="mt-4">
                <Button onClick={() => setOnboarding(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (onboardEmail.trim()) onboard.mutate();
              }}
            >
              <DialogHeader>
                <DialogTitle>Send {co.name} an onboarding link</DialogTitle>
                <DialogDescription>Invites the client's person as a manager, to finish setting up in their own workspace. An earlier link to the same email stops working.</DialogDescription>
              </DialogHeader>
              <Field label="Client's email" htmlFor="onboard-email" className="mt-4" required>
                <Input id="onboard-email" type="email" value={onboardEmail} onChange={(e) => setOnboardEmail(e.target.value)} required />
              </Field>
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setOnboarding(false)}>Cancel</Button>
                <Button type="submit" disabled={onboard.isPending || !onboardEmail.trim()} data-action="confirm-onboarding">
                  {onboard.isPending ? "Sending…" : "Get link"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <CallSheet callId={openCall} onClose={() => setOpenCall(null)} />
    </div>
  );
}

function ReceptionistCard({
  r,
  companyName,
  ownOrg,
  platform,
  readOnly,
  canManage,
  onOpen,
  onViewAs,
  viewing,
  onChanged,
}: {
  r: CompanyReceptionist;
  companyName: string;
  ownOrg: boolean;
  platform: boolean;
  readOnly: boolean;
  canManage: boolean;
  onOpen: () => void;
  onViewAs: () => void;
  viewing: boolean;
  onChanged: () => Promise<void>;
}) {
  const [numType, setNumType] = useState<"local" | "mobile">("mobile");
  const [numNote, setNumNote] = useState("");
  // An agency on its own phone account buys numbers itself; on the platform's it asks for one.
  // With SINGLE_AGENCY the server's key is the agency's own, so it buys them too.
  const { ws: consoleWs, single } = useConsole();
  const ownPhone = (consoleWs.session?.telnyx === "own" || single) && !platform;
  const s = r.settings;
  const paused = r.status === "paused";
  const pause = useMutation({
    mutationFn: (status: "active" | "paused") => setBusinessStatus(r.id, status),
    onSuccess: async (_d, status) => {
      toast.success(status === "paused" ? `${r.name} paused` : `${r.name} resumed`);
      await onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const request = useMutation({
    mutationFn: () => requestNumberFor(r.id, numType, numNote.trim()),
    onSuccess: async () => {
      toast.success("Number requested", { description: "The platform team will buy and connect it." });
      setNumNote("");
      await onChanged();
    },
    onError: (e: Error) => toast.error("Couldn't request a number", { description: e.message }),
  });
  const who = r.business_name || companyName;
  // An agency owner or admin on its own phone account sees each number as Telnyx reports it (approval status, disconnect).
  const showOwnNumbers = !readOnly && ownPhone && canManage && r.provider !== "vapi";
  const plainNumbers = r.numbers.length ? (
    <ul className="space-y-1.5" data-list="numbers">
      {r.numbers.map((n) => (
        <li key={n.id} className="flex items-center justify-between gap-2 text-[13px]">
          <span className="flex items-center gap-1.5 tabular-nums">
            <Phone className="h-3.5 w-3.5 text-ink-muted" /> {n.friendly_name}
          </span>
          <StatusBadge tone="success">{n.capabilities.sms ? "Calls + texts" : "Calls"}</StatusBadge>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-[12.5px] text-ink-muted">No number yet. You can test it from the browser meanwhile.</p>
  );

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>{r.name}</span>
          <StatusBadge tone={paused ? "muted" : "success"} dot>{paused ? "Paused" : "Active"}</StatusBadge>
          {r.onboarding_pending ? <StatusBadge tone="warning">Waiting for client</StatusBadge> : null}
          {r.demo_assistant ? <DemoBadge /> : null}
        </span>
      }
      description={`Answers for ${who}${s.voice ? ` · ${s.voice.split(" - ")[0]} voice` : ""}`}
      actions={
        <div className="flex flex-wrap gap-1.5">
          {ownOrg ? (
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={onOpen} data-action="open-workspace">
              <Pencil className="mr-1 h-3.5 w-3.5" /> {readOnly ? "Open" : "Open and edit"}
            </Button>
          ) : null}
          {!readOnly && (platform || canManage) ? (
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={onViewAs} disabled={viewing} data-action="view-as-customer">
              <Eye className="mr-1 h-3.5 w-3.5" /> See what {who} sees
            </Button>
          ) : null}
          {canManage ? (
            paused ? (
              <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => pause.mutate("active")} disabled={pause.isPending} data-action="resume-receptionist">
                <Play className="mr-1 h-3.5 w-3.5" /> Resume
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => pause.mutate("paused")} disabled={pause.isPending} data-action="pause-receptionist">
                <Pause className="mr-1 h-3.5 w-3.5" /> Pause
              </Button>
            )
          ) : null}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]" data-receptionist={r.id}>
        <div className="min-w-0 space-y-3">
          <ul className="divide-y divide-hairline rounded-[6px] border border-hairline" data-list="automations">
            {r.automations.map((a) => (
              <li key={a.key} className="row-hover flex flex-col gap-1 px-3 py-2 text-[12.5px] sm:flex-row sm:items-center sm:justify-between" data-automation-row={a.key}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <AutomationIcon automation={a.key} />
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{a.label}</div>
                    <div className="break-words text-[11.5px] text-ink-muted">{a.detail}</div>
                  </div>
                </div>
                <AutomationChips items={[{ ...a, label: a.status === "live" ? "On" : a.status === "attention" ? "Needs attention" : a.status === "paused" ? "Paused" : "Off" }]} />
              </li>
            ))}
          </ul>
          <KeyValue
            items={[
              { label: "Industry", value: industryPreset((s.industry as IndustryKey) ?? "other").label },
              { label: "Suburb", value: s.suburb || "—" },
              { label: "Hours", value: s.hours ? describeHours(s.hours).join("; ") : "—" },
              { label: "Callers can ask for", value: s.services.join(", ") || "—" },
            ]}
          />
          {s.greeting ? <p className="rounded-[6px] bg-canvas-2 px-3 py-2 text-[12.5px] text-ink">“{s.greeting}”</p> : null}
        </div>
        <div className="min-w-0">
          {!readOnly && !paused && !r.demo_assistant ? <TestCall assistantId={r.provider_agent_id} provider={r.provider} clientId={r.business_id} /> : null}
          <div className="mb-1.5 text-[12.5px] font-medium text-ink">Phone number</div>
          {showOwnNumbers ? <AttachedNumbers clientId={r.id} fallback={plainNumbers} onChanged={onChanged} /> : plainNumbers}
          {r.number_requests.length ? (
            <ul className="mt-3 space-y-1 border-t border-hairline pt-3 text-[12px]" data-list="number-requests">
              {r.number_requests.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-ink-muted">
                    {n.type === "mobile" ? "Mobile" : "Local"} · {fmtDate(n.created_at)}
                    {n.status === "declined" && n.reason ? ` · ${n.reason}` : ""}
                    {n.status === "done" && n.phone_number ? ` · ${fmtPhone(n.phone_number)}` : ""}
                  </span>
                  <StatusBadge tone={n.status === "pending" ? "warning" : n.status === "done" ? "success" : "muted"}>{humanize(n.status)}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : null}
          {!readOnly && ownPhone ? (
            canManage ? (
              r.provider === "vapi" ? <ImportNumber clientId={r.id} timezone={s.timezone} onDone={onChanged} /> : <BuyNumber clientId={r.id} timezone={s.timezone} onBought={onChanged} />
            ) : (
              <p className="mt-3 border-t border-hairline pt-3 text-[12px] text-ink-muted">Ask an owner or admin of your agency to buy a number.</p>
            )
          ) : !readOnly ? (
            <>
            {r.provider === "vapi" && canManage && !platform ? <ImportNumber clientId={r.id} timezone={s.timezone} twilioOnly onDone={onChanged} /> : null}
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
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-4" data-website-chat={r.id}>
        <WebsiteChatCard clientId={r.id} businessName={who} />
      </div>
    </Panel>
  );
}
