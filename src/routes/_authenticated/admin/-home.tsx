import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, Building2, CalendarCheck, CheckCircle2, ChevronRight, Mail, MessageSquareText, PhoneCall, Plus, ServerCrash, Mic } from "lucide-react";
import { NeedsPhone } from "@/components/app/PhoneGate";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, InitialsAvatar, MetricCard, MetricGrid, Panel } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { GetStartedChecklist } from "@/components/onboarding/Checklist";
import { adminAgentsQuery, adminOverviewCountsQuery, rangeKey } from "@/lib/app/queries";
import { companyApi, getAdminRecentActivity, getAdminAppointmentsLeads, getConsoleCalls } from "@/lib/api/console";
import { resolveRange } from "@/lib/app/date-range";
import { isInRange } from "@/lib/app/metrics";
import { fmtNumber, fmtRelative } from "@/lib/app/format";
import { nicheIcon } from "@/lib/app/niche-icons";
import { useProviderWarnings, warningInfo } from "@/components/app/ProviderWarnings";
import { useConsole } from "./-shared";

// Home: a quick look at everything. Today's numbers, what needs a look, receptionists, clients and what just happened.

const hello = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export function Home() {
  const { ws, platform, readOnly, orgName } = useConsole();
  // Today's numbers are always today, whatever date range is picked at the top.
  const range = useMemo(() => resolveRange("today", ws.range.timezone), [ws.range.timezone]);
  const callsQ = useQuery({ queryKey: ["console", "calls", rangeKey(range)], queryFn: () => getConsoleCalls(range), refetchInterval: 30_000 });
  const alQ = useQuery({ queryKey: ["console", "bookings-leads", rangeKey(range)], queryFn: () => getAdminAppointmentsLeads(range) });
  const countsQ = useQuery(adminOverviewCountsQuery());
  const agentsQ = useQuery(adminAgentsQuery());
  const clientsQ = useQuery({ queryKey: ["console", "companies"], queryFn: companyApi.list });
  const activityQ = useQuery({ queryKey: ["console", "activity"], queryFn: getAdminRecentActivity });
  const warnings = useProviderWarnings(!readOnly);

  const agents = (agentsQ.data ?? []).filter((a) => !a.business?.is_demo);
  const inboxes = countsQ.data?.inboxes ?? 0;

  const calls = callsQ.data ?? [];
  const today = calls.filter((c) => isInRange(c.started_at, range.from, range.to));
  const bad = (q: { isError: boolean }) => q.isError;
  const voice = today.filter((c) => c.channel === "call" || c.channel === "web");
  const msgs = today.filter((c) => c.channel && c.channel !== "call" && c.channel !== "web");
  const bookings = (alQ.data?.appointments ?? []).filter((a) => isInRange(a.created_at, range.from, range.to) && a.status !== "cancelled").length;
  const failed = today.filter((c) => c.status === "failed").length;
  const c = countsQ.data;
  const noNumber = agents.filter((a) => a.routing_status !== "routed");

  const attention = useMemo(() => {
    const out: { icon: typeof AlertTriangle; text: string; to: string; tone: "danger" | "warning" }[] = [];
    for (const w of warnings) out.push({ icon: AlertTriangle, text: warningInfo(w).title, to: "/admin/connections", tone: "warning" });
    if (c?.openIncidents) out.push({ icon: ServerCrash, text: `${c.openIncidents} problem${c.openIncidents === 1 ? "" : "s"} to look at`, to: "/admin/system", tone: "danger" });
    if (failed) out.push({ icon: ServerCrash, text: `${failed} failed call${failed === 1 ? "" : "s"} today`, to: "/admin/calls", tone: "danger" });
    if (noNumber.length) out.push({ icon: PhoneCall, text: `${noNumber.length} receptionist${noNumber.length === 1 ? " has" : "s have"} no number`, to: "/admin/phone-numbers", tone: "warning" });
    if (c?.pendingNumberRequests && !ws.session?.singleAgency) out.push({ icon: PhoneCall, text: `${c.pendingNumberRequests} number request${c.pendingNumberRequests === 1 ? "" : "s"} waiting`, to: "/admin/number-requests", tone: "warning" });
    return out;
  }, [warnings, c, failed, noNumber.length, ws.session?.singleAgency]);

  const first = (ws.profile?.full_name ?? "").split(" ")[0];
  const act = activityQ.data;
  const recent = useMemo(() => {
    const items: { key: string; at: string; text: string; who: string; icon: typeof CalendarCheck }[] = [];
    for (const a of act?.appointments ?? []) items.push({ key: `a${a.id}`, at: a.created_at, text: `${a.customer_name ?? "Someone"} booked`, who: a.business?.name ?? "", icon: CalendarCheck });
    for (const l of act?.leads ?? []) items.push({ key: `l${l.id}`, at: l.created_at, text: `${l.name ?? "A caller"} left a message`, who: l.business?.name ?? "", icon: MessageSquareText });
    return items.sort((x, y) => +new Date(y.at) - +new Date(x.at)).slice(0, 6);
  }, [act]);
  const clients = (clientsQ.data ?? []).filter((x) => !x.is_demo).slice(0, 6);

  return (
    <div className="space-y-5" data-page="admin-home" data-console-variant={platform ? "platform" : "agency"}>
      <div className="hero-card px-5 py-6 sm:px-7 sm:py-7">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-white sm:text-[30px]">{hello()}{first ? `, ${first}` : ""}</h1>
            <p className="mt-1 text-[14px] text-white/85">{platform ? "Everything on the platform" : orgName || "Your agency"}, today.</p>
          </div>
          {!readOnly ? (
            <div className="flex flex-wrap gap-2">
              <NeedsPhone className="h-10 bg-white text-[13.5px] text-[var(--indigo-deep)] hover:bg-white/90" label={<><Bot className="mr-1.5 h-4 w-4" /> New receptionist</>}>
                <Button asChild className="h-10 bg-white text-[13.5px] font-semibold text-[var(--indigo-deep)] hover:bg-white/90"><Link to="/admin/receptionists/new" data-cta="new-receptionist"><Plus className="mr-1.5 h-4 w-4" /> New receptionist</Link></Button>
              </NeedsPhone>
              <Button asChild variant="outline" className="h-10 border-white/40 bg-white/10 text-[13.5px] text-white hover:bg-white/20 hover:text-white"><Link to="/admin/clients" search={{ add: "1" } as never}><Building2 className="mr-1.5 h-4 w-4" /> Add client</Link></Button>
            </div>
          ) : null}
        </div>
      </div>

      {!platform && !readOnly ? <GetStartedChecklist /> : null}

      <MetricGrid cols={4}>
        <MetricCard label="Calls today" value={bad(callsQ) ? "–" : fmtNumber(voice.length)} icon={PhoneCall} hue="indigo" loading={callsQ.isPending} hint={bad(callsQ) ? "Couldn't load" : "Voice agent"} />
        <MetricCard label="Messages today" value={bad(callsQ) ? "–" : fmtNumber(msgs.length)} icon={MessageSquareText} hue="cyan" loading={callsQ.isPending} hint={bad(callsQ) ? "Couldn't load" : "Message agent"} />
        <MetricCard label="Inboxes on" value={bad(countsQ) ? "–" : fmtNumber(inboxes)} icon={Mail} hue="magenta" loading={countsQ.isPending} hint={bad(countsQ) ? "Couldn't load" : "Email agent"} />
        <MetricCard label="Bookings today" value={bad(alQ) ? "–" : fmtNumber(bookings)} icon={CalendarCheck} hue="green" loading={alQ.isPending} hint={bad(alQ) ? "Couldn't load" : undefined} />
      </MetricGrid>

      <Panel title="Needs a look">
        {countsQ.isError || callsQ.isError ? <div className="mb-3"><ErrorState message="Some of this couldn't load." onRetry={() => { void countsQ.refetch(); void callsQ.refetch(); }} /></div> : null}
        {attention.length === 0 && !countsQ.isError && !callsQ.isError ? (
          <div className="flex items-center gap-2.5 text-[13.5px] text-ink"><span data-hue="green" className="hue-icon flex h-8 w-8 items-center justify-center rounded-full"><CheckCircle2 className="h-4 w-4" /></span> All good.</div>
        ) : (
          <ul className="space-y-1.5">
            {attention.map((a, i) => (
              <li key={i}>
                <Link to={a.to as "/admin/system"} className="row-hover flex items-center gap-3 rounded-[10px] px-2 py-1.5 text-[13.5px] text-ink">
                  <span data-hue={a.tone === "danger" ? "coral" : "amber"} className="hue-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-full"><a.icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1 truncate">{a.text}</span>
                  <ChevronRight className="h-4 w-4 text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Receptionists" padded={false} actions={<Button asChild variant="ghost" size="sm" className="h-7 text-[12px]"><Link to="/admin/receptionists">All</Link></Button>}>
          {agentsQ.isPending ? <div className="p-4 text-[13px] text-ink-muted">…</div> : agentsQ.isError ? <div className="p-3"><ErrorState message="Couldn't load receptionists." onRetry={() => void agentsQ.refetch()} /></div> : agents.length === 0 ? (
            <EmptyState compact icon={Bot} title="No receptionists yet" action={<Button asChild size="sm"><Link to="/admin/receptionists/new">New receptionist</Link></Button>} />
          ) : (
            <ul className="divide-y divide-hairline" data-list="home-receptionists">
              {agents.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <Link to="/admin/receptionists/$receptionistId" params={{ receptionistId: a.id }} search={{ tab: "voice" }} className="row-hover flex items-center gap-3 px-4 py-2.5">
                    <InitialsAvatar name={a.name} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{a.name}</span>
                      <span className="block truncate text-[11.5px] text-ink-muted">{a.business.name}</span>
                    </span>
                    <span className="flex items-center gap-1" aria-label="Voice, messages, email">
                      <Mic className={a.routing_status === "routed" ? "h-3.5 w-3.5 text-[var(--green)]" : "h-3.5 w-3.5 text-ink-muted/50"} />
                      <MessageSquareText className="h-3.5 w-3.5 text-ink-muted" />
                      <Mail className="h-3.5 w-3.5 text-ink-muted" />
                    </span>
                    <StatusBadge tone={a.status === "active" ? "success" : "muted"} dot>{a.status === "active" ? "On" : "Paused"}</StatusBadge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Clients" padded={false} actions={<Button asChild variant="ghost" size="sm" className="h-7 text-[12px]"><Link to="/admin/clients">All</Link></Button>}>
          {clientsQ.isPending ? <div className="p-4 text-[13px] text-ink-muted">…</div> : clientsQ.isError ? <div className="p-3"><ErrorState message="Couldn't load clients." onRetry={() => void clientsQ.refetch()} /></div> : clients.length === 0 ? (
            <EmptyState compact icon={Building2} title="No clients yet" action={<Button asChild size="sm"><Link to="/admin/clients" search={{ add: "1" } as never}>Add a client</Link></Button>} />
          ) : (
            <ul className="divide-y divide-hairline" data-list="home-clients">
              {clients.map((b) => {
                const N = nicheIcon(b.industry);
                return (
                  <li key={b.id}>
                    <Link to="/admin/clients/$businessId" params={{ businessId: b.id }} className="row-hover flex items-center gap-3 px-4 py-2.5">
                      <span data-hue={N.hue} className="hue-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"><N.icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{b.name}</span>
                      <span className="text-[12px] text-ink-muted">{b.receptionists.length} receptionist{b.receptionists.length === 1 ? "" : "s"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Just happened" padded={false} actions={<Button asChild variant="ghost" size="sm" className="h-7 text-[12px]"><Link to="/admin/calls">Calls</Link></Button>}>
        {callsQ.isError && activityQ.isError ? (
          <div className="p-3"><ErrorState message="Couldn't load recent activity." onRetry={() => { void callsQ.refetch(); void activityQ.refetch(); }} /></div>
        ) : recent.length === 0 && today.length === 0 ? (
          <EmptyState compact icon={PhoneCall} title="Nothing yet" />
        ) : (
          <ul className="divide-y divide-hairline">
            {today.slice(0, 4).map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span data-hue={x.channel === "call" || x.channel === "web" ? "indigo" : "cyan"} className="hue-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-full">{x.channel === "call" || x.channel === "web" ? <PhoneCall className="h-3.5 w-3.5" /> : <MessageSquareText className="h-3.5 w-3.5" />}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{x.business?.name ?? "Call"}</span>
                <span className="shrink-0 text-[12px] text-ink-muted">{fmtRelative(x.started_at)}</span>
              </li>
            ))}
            {recent.map((x) => (
              <li key={x.key} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span data-hue="green" className="hue-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-full"><x.icon className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1 truncate text-ink">{x.text} <span className="text-ink-muted">· {x.who}</span></span>
                <span className="shrink-0 text-[12px] text-ink-muted">{fmtRelative(x.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
