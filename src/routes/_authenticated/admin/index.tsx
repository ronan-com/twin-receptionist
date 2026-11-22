import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Bot, Briefcase, Building2, CalendarCheck, Hash, PhoneCall, PhoneIncoming, Plus, ServerCrash, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, MetricCard, MetricGrid, Panel, ErrorState, Notice, EmptyState } from "@/components/app/primitives";
import { ChartCard, CallVolumeChart, OutcomeDonut, RankedBars } from "@/components/app/Charts";
import { DataTable, type Column } from "@/components/app/DataTable";
import { AppointmentBadge, CallStatusBadge, LeadStageBadge, OutcomeBadge, StatusBadge } from "@/components/app/StatusBadge";
import { CHART_COLORS } from "@/lib/app/constants";
import { fmtDuration, fmtNumber, fmtPercent, fmtPhone, fmtRelative, fmtSmartDate, humanize } from "@/lib/app/format";
import { buildDailySeries, buildOutcomeBreakdown, compareKpis, computeKpis, isInRange, type BreakdownPoint } from "@/lib/app/metrics";
import { adminOverviewCountsQuery, rangeKey } from "@/lib/app/queries";
import { platformApi, getAdminAppointmentsLeads, getAdminRecentActivity, getConsoleCalls, type AdminRecentActivity, type ConsoleCall } from "@/lib/api/console";
import type { AppointmentStatus, LeadStage } from "@/lib/app/types";
import { BizCell, CallSheet, useConsole } from "./-shared";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Admin overview — Answered" }] }),
  component: AdminOverview,
});

function AdminOverview() {
  const { ws, platform, readOnly, orgName } = useConsole();
  const range = ws.range;
  const callsQ = useQuery({ queryKey: ["console", "calls", rangeKey(range)], queryFn: () => getConsoleCalls(range) });
  const countsQ = useQuery(adminOverviewCountsQuery());
  const alQ = useQuery({ queryKey: ["console", "bookings-leads", rangeKey(range)], queryFn: () => getAdminAppointmentsLeads(range) });
  const activityQ = useQuery({ queryKey: ["console", "activity"], queryFn: getAdminRecentActivity });
  const [openCall, setOpenCall] = useState<string | null>(null);

  const all = callsQ.data ?? [];
  const current = useMemo(() => all.filter((c) => isInRange(c.started_at, range.from, range.to)), [all, range]);
  const previous = useMemo(() => all.filter((c) => isInRange(c.started_at, range.prevFrom, range.prevTo)), [all, range]);
  const apptCur = (alQ.data?.appointments ?? []).filter((a) => isInRange(a.created_at, range.from, range.to) && a.status !== "cancelled").length;
  const apptPrev = (alQ.data?.appointments ?? []).filter((a) => isInRange(a.created_at, range.prevFrom, range.prevTo) && a.status !== "cancelled").length;
  const leadCur = (alQ.data?.leads ?? []).filter((l) => isInRange(l.created_at, range.from, range.to)).length;
  const leadPrev = (alQ.data?.leads ?? []).filter((l) => isInRange(l.created_at, range.prevFrom, range.prevTo)).length;
  const k = useMemo(() => computeKpis(current, { appointments: apptCur, leads: leadCur }), [current, apptCur, leadCur]);
  const kPrev = useMemo(() => computeKpis(previous, { appointments: apptPrev, leads: leadPrev }), [previous, apptPrev, leadPrev]);
  const d = useMemo(() => compareKpis(k, kPrev), [k, kPrev]);
  const tz = range.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const daily = useMemo(() => buildDailySeries(current, range.from, range.to, tz), [current, range, tz]);
  const outcomes = useMemo(() => buildOutcomeBreakdown(current), [current]);
  const failed = current.filter((c) => c.status === "failed");

  const byBusiness = useMemo<BreakdownPoint[]>(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const c of current) {
      const e = map.get(c.business_id) ?? { label: c.business?.name ?? "Unknown", count: 0 };
      e.count++;
      map.set(c.business_id, e);
    }
    return [...map.entries()].map(([key, v]) => ({ key, name: v.label, value: v.count, color: CHART_COLORS.indigo })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [current]);

  const byAgency = useMemo<BreakdownPoint[]>(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const c of current) {
      const id = c.business?.org_id ?? "?";
      const e = map.get(id) ?? { label: c.business?.org_name ?? "Unknown", count: 0 };
      e.count++;
      map.set(id, e);
    }
    return [...map.entries()].map(([key, v]) => ({ key, name: v.label, value: v.count, color: CHART_COLORS.cyan })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [current]);

  const c = countsQ.data;
  const columns: Column<ConsoleCall>[] = [
    { key: "biz", header: "Client", cell: (r) => <BizCell biz={r.business} showAgency={platform} sub={fmtPhone(r.from_number) || undefined} /> },
    { key: "when", header: "When", hideBelow: "sm", cell: (r) => <span className="whitespace-nowrap text-ink-muted">{fmtSmartDate(r.started_at)}</span> },
    { key: "status", header: "Status", cell: (r) => <CallStatusBadge status={r.status} /> },
    { key: "outcome", header: "Outcome", hideBelow: "lg", cell: (r) => <OutcomeBadge outcome={r.outcome} /> },
    { key: "dur", header: "Length", align: "right", hideBelow: "sm", cell: (r) => <span className="tabular-nums">{fmtDuration(r.duration_seconds)}</span> },
  ];

  const noBusinesses = c && c.businesses === 0;

  return (
    <div className="space-y-5" data-page="admin-overview" data-console-variant={platform ? "platform" : "agency"}>
      <PageHeader
        eyebrow={platform ? "Platform console" : "Agency console"}
        title={platform ? "Platform overview" : `${orgName || "Agency"} overview`}
        description={`${platform ? "Every agency, business and call on the platform" : "Your clients' receptionists and calls"} · ${range.label}`}
        actions={
          <>
            <Button asChild size="sm" variant="outline" className="h-8 text-[12.5px]">
              <Link to="/admin/clients">Manage clients</Link>
            </Button>
            {!readOnly ? (
              <Button asChild size="sm" className="h-8 text-[12.5px]">
                <Link to="/admin/clients/new" data-cta="new-receptionist">
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> New receptionist
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {callsQ.error ? <ErrorState message={(callsQ.error as Error).message} onRetry={() => void callsQ.refetch()} /> : null}
      {countsQ.error ? <ErrorState message={(countsQ.error as Error).message} onRetry={() => void countsQ.refetch()} /> : null}

      {c?.openIncidents ? (
        <Notice
          tone="danger"
          title={`${c.openIncidents} open incident${c.openIncidents === 1 ? "" : "s"}`}
          action={
            <Button asChild size="sm" variant="outline" className="h-7 bg-white text-[12px]">
              <Link to="/admin/system">Open System / QA</Link>
            </Button>
          }
        >
          Something failed in the background (a calendar, a call sync or a tool call).
        </Notice>
      ) : null}

      {noBusinesses && !platform ? (
        <Panel>
          <EmptyState
            icon={Sparkles}
            title="Create your first receptionist"
            description="Add a business you look after and we'll set up its AI receptionist. You can share it with the business owner afterwards."
            action={
              !readOnly ? (
                <Button asChild data-cta="first-receptionist">
                  <Link to="/admin/clients/new">
                    <Plus className="mr-1.5 h-4 w-4" /> Create your first receptionist
                  </Link>
                </Button>
              ) : null
            }
          />
        </Panel>
      ) : null}

      <MetricGrid cols={platform ? 6 : 5}>
        {platform ? <MetricCard label="Agencies" value={fmtNumber(c?.agencies ?? 0)} icon={Briefcase} loading={countsQ.isPending} /> : null}
        <MetricCard label="Clients" value={fmtNumber(c?.businesses ?? 0)} hint={`${fmtNumber(c?.activeBusinesses ?? 0)} active`} icon={Building2} loading={countsQ.isPending} />
        <MetricCard label="Receptionists" value={fmtNumber(c?.agents ?? 0)} hint={`${fmtNumber(c?.numbers ?? 0)} numbers attached`} icon={Bot} loading={countsQ.isPending} />
        <MetricCard label="Calls" value={fmtNumber(k.total)} delta={d.total} icon={PhoneCall} loading={callsQ.isPending} />
        <MetricCard label="AI resolution" value={fmtPercent(k.aiResolutionRate)} delta={d.aiResolutionRate} icon={Sparkles} loading={callsQ.isPending} />
        <MetricCard label="Failed calls" value={fmtNumber(failed.length)} icon={ServerCrash} loading={callsQ.isPending} />
      </MetricGrid>

      {platform ? <AgenciesGlance /> : null}

      <Panel title="Needs attention">
        <ul className="space-y-2 text-[13px]">
          <AttentionRow icon={AlertTriangle} label="Open incidents" value={c?.openIncidents ?? 0} to="/admin/system" tone={c?.openIncidents ? "danger" : "muted"} />
          <AttentionRow icon={ServerCrash} label="Failed calls in this period" value={failed.length} to="/admin/calls" tone={failed.length ? "danger" : "muted"} />
          <AttentionRow icon={PhoneIncoming} label="Number requests waiting" value={c?.pendingNumberRequests ?? 0} to="/admin/number-requests" tone={c?.pendingNumberRequests ? "warning" : "muted"} />
          {platform ? <AttentionRow icon={Hash} label="Agencies with no phone account" value={c?.providerErrors ?? 0} to="/admin/system" tone={c?.providerErrors ? "warning" : "muted"} /> : null}
        </ul>
      </Panel>

      <MetricGrid cols={4}>
        <MetricCard label="Bookings" value={fmtNumber(k.bookings)} delta={d.bookings} icon={CalendarCheck} loading={alQ.isPending} />
        <MetricCard label="Follow-ups" value={fmtNumber(k.leads)} delta={d.leads} icon={UserRound} loading={alQ.isPending} />
        <MetricCard label="Avg length" value={fmtDuration(k.avgDurationSeconds)} icon={Activity} loading={callsQ.isPending} />
        <MetricCard label="Calls, last 30 days" value={fmtNumber(c?.calls30d ?? 0)} icon={PhoneCall} loading={countsQ.isPending} />
      </MetricGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Call volume" description={`By day in ${tz}`} className="xl:col-span-2" empty={!callsQ.isPending && current.length === 0} legend={[{ label: "Answered", color: CHART_COLORS.indigo }, { label: "Missed", color: CHART_COLORS.coral }]}>
          <CallVolumeChart data={daily} />
        </ChartCard>
        <ChartCard title="Outcomes" description="What each call ended in" empty={!callsQ.isPending && outcomes.length === 0}>
          <OutcomeDonut data={outcomes} />
        </ChartCard>
      </div>

      <div className={platform ? "grid gap-4 xl:grid-cols-2" : "grid gap-4"}>
        <Panel title="Busiest clients" description="Calls in period">
          {byBusiness.length ? <RankedBars data={byBusiness} /> : <p className="text-[12.5px] text-ink-muted">No calls in this period.</p>}
        </Panel>
        {platform ? (
          <Panel title="Busiest agencies" description="Calls in period">
            {byAgency.length ? <RankedBars data={byAgency} /> : <p className="text-[12.5px] text-ink-muted">No calls in this period.</p>}
          </Panel>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="Latest calls"
          description={platform ? "Most recent across every agency" : "Most recent across your clients"}
          className="xl:col-span-2"
          padded={false}
          actions={
            <Button asChild variant="ghost" size="sm" className="h-7 text-[12px]">
              <Link to="/admin/calls">All calls</Link>
            </Button>
          }
        >
          <DataTable
            columns={columns}
            rows={current.slice(0, 10)}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpenCall(r.id)}
            rowClassName={(r) => (r.status === "failed" ? "bg-[#fff7f7]" : undefined)}
            loading={callsQ.isPending}
            pageSize={10}
            dense
            empty={{ title: "No calls in this period", description: "Change the date range, or make a test call." }}
          />
        </Panel>
        <Panel title="Recent activity" description="Bookings, follow-ups, changes and incidents" padded={false}>
          <ul className="divide-y divide-hairline" data-list="activity">
            {activityQ.isPending ? <li className="p-4 text-[13px] text-ink-muted">Loading…</li> : null}
            {mergeActivity(activityQ.data).map((a) => (
              <li key={a.key} className="flex items-start gap-2.5 px-4 py-2.5 text-[12.5px]">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-canvas-2">
                  <a.icon className="h-3 w-3 text-ink-muted" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ink">{a.text}</div>
                  <div className="truncate text-[11.5px] text-ink-muted">
                    {a.business} · {fmtRelative(a.at)}
                  </div>
                </div>
                {a.badge}
              </li>
            ))}
            {!activityQ.isPending && mergeActivity(activityQ.data).length === 0 ? <li className="p-6 text-center text-[13px] text-ink-muted">Nothing yet.</li> : null}
          </ul>
        </Panel>
      </div>

      <CallSheet callId={openCall} onClose={() => setOpenCall(null)} />
    </div>
  );
}

function AttentionRow({ icon: Icon, label, value, to, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; to: "/admin/system" | "/admin/calls" | "/admin/number-requests"; tone: "warning" | "danger" | "info" | "muted" }) {
  return (
    <li>
      <Link to={to} className="flex items-center justify-between gap-2 rounded-[5px] px-2 py-1.5 hover:bg-canvas-2">
        <span className="flex min-w-0 items-center gap-2 text-ink">
          <Icon className="h-3.5 w-3.5 shrink-0 text-ink-muted" /> <span className="truncate">{label}</span>
        </span>
        <StatusBadge tone={tone}>{fmtNumber(value)}</StatusBadge>
      </Link>
    </li>
  );
}

function mergeActivity(data: AdminRecentActivity | undefined) {
  if (!data) return [];
  const items: { key: string; at: string; text: string; business: string; icon: React.ComponentType<{ className?: string }>; badge?: React.ReactNode }[] = [];
  for (const a of data.appointments) {
    items.push({ key: `a-${a.id}`, at: a.created_at, text: `${a.customer_name ?? "Someone"} booked ${a.service ?? "an appointment"}`, business: a.business?.name ?? "—", icon: CalendarCheck, badge: <AppointmentBadge status={a.status as AppointmentStatus} /> });
  }
  for (const l of data.leads) {
    items.push({ key: `l-${l.id}`, at: l.created_at, text: `${l.name ?? "A caller"} · ${humanize(l.intent) || "callback"}`, business: l.business?.name ?? "—", icon: UserRound, badge: <LeadStageBadge stage={l.stage as LeadStage} /> });
  }
  for (const au of data.audit) {
    items.push({ key: `au-${au.id}`, at: au.created_at, text: au.summary ?? humanize(au.action), business: au.business?.name ?? au.org_name ?? "Platform", icon: Activity });
  }
  for (const i of data.incidents ?? []) {
    items.push({ key: `i-${i.id}`, at: i.started_at, text: i.title, business: i.business?.name ?? "Platform", icon: AlertTriangle, badge: <StatusBadge tone={i.status === "open" ? "danger" : "success"}>{humanize(i.status)}</StatusBadge> });
  }
  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 14);
}

/** Platform overview: the agencies at a glance (the full list is on Agencies). */
function AgenciesGlance() {
  const q = useQuery({ queryKey: ["console", "agencies"], queryFn: platformApi.agencies });
  const rows = (q.data ?? []).filter((a) => !a.sandbox).slice(0, 8);
  return (
    <Panel
      title="Agencies"
      actions={
        <Button asChild size="sm" variant="ghost" className="h-7 text-[12px]">
          <Link to="/admin/agencies">All agencies</Link>
        </Button>
      }
      padded={false}
    >
      <ul className="divide-y divide-hairline" data-list="agencies">
        {rows.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
            <span className="min-w-0 truncate font-medium text-ink">{a.name}</span>
            <span className="shrink-0 text-[12px] text-ink-muted">
              {a.clients} receptionist{a.clients === 1 ? "" : "s"}
              {a.suspended ? " · paused" : ""}
            </span>
          </li>
        ))}
        {!q.isPending && rows.length === 0 ? <li className="px-4 py-4 text-center text-[12.5px] text-ink-muted">No agencies yet.</li> : null}
      </ul>
    </Panel>
  );
}
