import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  Bot,
  CalendarCheck,
  CheckCircle2,
  CircleDashed,
  Circle,
  PhoneIncoming,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PageHeader,
  MetricCard,
  Panel,
  ErrorState,
  Notice,
  UsageBar,
} from "@/components/app/primitives";
import { CallList } from "@/components/app/CallList";
import { DashboardJourney } from "@/components/app/DashboardJourney";
import "@/components/app/dashboard-overview.css";
import {
  customerAttention,
  splitAttention,
  upcomingAppointments,
} from "@/lib/app/dashboard-presentation";
import { AppointmentBadge, StatusBadge } from "@/components/app/StatusBadge";
import { CallDetailSheet } from "@/components/app/CallDetailSheet";
import { fmtCurrency, fmtNumber, fmtRelative } from "@/lib/app/format";
import { buildDailySeries, isInRange } from "@/lib/app/metrics";
import { dailyCounts } from "@/components/app/hues";
import {
  agentsQuery,
  integrationsQuery,
  knowledgeQuery,
  phoneNumbersQuery,
  subscriptionQuery,
  unansweredQuery,
  usageQuery,
} from "@/lib/app/queries";
import { useRangeMetrics } from "@/lib/app/use-metrics";
import { useWorkspace } from "@/lib/app/workspace";
import {
  aiBookings,
  billingPeriodUsage,
  buildAttentionItems,
  buildSetupChecklist,
  readUsageThresholds,
  receptionistReadiness,
  summariseUsage,
  tzDateTime,
} from "@/lib/app/business-logic";
import { cn } from "@/lib/utils";
import { PRODUCT, named } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({
    meta: [
      { title: named("Dashboard — Answered") },
      {
        name: "description",
        content:
          "See what your AI receptionist answered, booked and captured, and what needs your attention today.",
      },
    ],
  }),
  component: OverviewPage,
});

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function OverviewPage() {
  const ws = useWorkspace();
  const m = useRangeMetrics(ws.businessId, ws.range);
  const agentsQ = useQuery(agentsQuery(ws.businessId));
  const numbersQ = useQuery(phoneNumbersQuery(ws.businessId));
  const integrationsQ = useQuery(integrationsQuery(ws.businessId));
  const unansweredQ = useQuery(unansweredQuery(ws.businessId));
  const knowledgeQ = useQuery(knowledgeQuery(ws.businessId));
  const subscriptionQ = useQuery(subscriptionQuery(ws.businessId));
  const usageQ = useQuery(usageQuery(ws.businessId));
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [attentionGroup, setAttentionGroup] = useState<
    "tasks" | "connections" | null
  >(null);
  const [showAllAttention, setShowAllAttention] = useState(false);

  const tz = ws.business?.timezone ?? null;
  const agent = agentsQ.data?.[0] ?? null;
  const numbers = useMemo(() => numbersQ.data ?? [], [numbersQ.data]);
  const integrations = useMemo(
    () => integrationsQ.data ?? [],
    [integrationsQ.data],
  );

  const attention = useMemo(
    () =>
      buildAttentionItems({
        calls: m.current,
        appointments: m.appointments,
        leads: m.leads,
        unanswered: unansweredQ.data ?? [],
        integrations,
        numbers,
        timezone: tz,
      }),
    [m, unansweredQ.data, integrations, numbers, tz],
  );

  const checklist = useMemo(
    () =>
      buildSetupChecklist({
        business: ws.business,
        agent,
        numbers,
        knowledge: knowledgeQ.data ?? [],
        integrations,
      }),
    [ws.business, agent, numbers, knowledgeQ.data, integrations],
  );

  const readiness = useMemo(
    () =>
      receptionistReadiness(agent, numbers, {
        isDemo: ws.business?.is_demo ?? false,
      }),
    [agent, numbers, ws.business],
  );

  const bookingsInRange = useMemo(
    () =>
      m.appointments.filter(
        (a) =>
          isInRange(a.created_at, ws.range.from, ws.range.to) &&
          a.status !== "cancelled",
      ),
    [m.appointments, ws.range],
  );
  const aiBookingsInRange = useMemo(
    () => aiBookings(bookingsInRange),
    [bookingsInRange],
  );
  const enquiriesInRange = useMemo(
    () =>
      m.leads.filter((l) =>
        isInRange(l.created_at, ws.range.from, ws.range.to),
      ),
    [m.leads, ws.range],
  );

  // Small trend lines in the KPI tiles (data the page already has).
  const sparks = useMemo(
    () => ({
      answered: buildDailySeries(m.current, ws.range.from, ws.range.to, tz).map((p) => p.answered),
      bookings: dailyCounts(bookingsInRange.map((a) => a.created_at), ws.range.from, ws.range.to),
      enquiries: dailyCounts(enquiriesInRange.map((l) => l.created_at), ws.range.from, ws.range.to),
    }),
    [m.current, bookingsInRange, enquiriesInRange, ws.range, tz],
  );

  const thresholds = readUsageThresholds(ws.business);
  // Quota warnings follow the subscription billing period, not the date filter
  // at the top of the dashboard.
  const period = useMemo(
    () => billingPeriodUsage(usageQ.data ?? [], subscriptionQ.data ?? null),
    [usageQ.data, subscriptionQ.data],
  );
  const usage = useMemo(
    () =>
      summariseUsage(
        subscriptionQ.data?.plan ?? null,
        period.minutes,
        thresholds,
      ),
    [subscriptionQ.data, period.minutes, thresholds],
  );

  const recent = m.current.slice(0, 5);
  const upcoming = upcomingAppointments(m.appointments, new Date());
  const groupedAttention = splitAttention(attention);
  const activeGroup =
    attentionGroup ??
    (groupedAttention.tasks.length === 0 ? "connections" : "tasks");
  const activeAttention = groupedAttention[activeGroup];
  const attentionLoading =
    m.loading ||
    integrationsQ.isPending ||
    unansweredQ.isPending ||
    numbersQ.isPending;
  const attentionError = Boolean(
    m.error || integrationsQ.isError || unansweredQ.isError || numbersQ.isError,
  );
  const isDemo = Boolean(ws.business?.is_demo);
  const firstName = (ws.profile?.full_name ?? ws.user?.email ?? "").split(
    /[\s@]/,
  )[0];
  const k = m.kpis;
  const d = m.deltas;
  // Sample workspaces have no meaningful history, so a period-on-period growth
  // badge there would be misleading. Hide it and say so instead.
  const showDeltas = !(ws.business?.is_demo ?? false);
  const attentionPreviewLimit = isDemo ? 2 : 3;

  return (
    <div className="client-overview space-y-5">
      <PageHeader
        eyebrow={ws.business?.name}
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        description={`Your calls, bookings and next steps. Activity for ${ws.range.label.toLowerCase()}.`}
        actions={
          <Button asChild variant="outline" className="h-11">
            <Link to="/app/receptionist">
              <Bot className="mr-2 h-4 w-4" /> Receptionist settings
            </Link>
          </Button>
        }
      />
      {m.error ? <ErrorState message={m.error} onRetry={m.refetch} /> : null}

      <div className="overview-metrics grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="Answered calls"
          value={fmtNumber(k.answered)}
          delta={showDeltas ? d.answered : undefined}
          icon={PhoneIncoming}
          loading={m.loading}
          spark={sparks.answered}
          hint={`${fmtNumber(k.total)} calls in total`}
        />
        <MetricCard
          label="Bookings"
          value={fmtNumber(bookingsInRange.length)}
          delta={showDeltas ? d.bookings : undefined}
          icon={CalendarCheck}
          loading={m.loading}
          spark={sparks.bookings}
          hint={`${fmtNumber(aiBookingsInRange.length)} made by your receptionist`}
        />
        <MetricCard
          label="New enquiries"
          value={fmtNumber(enquiriesInRange.length)}
          delta={showDeltas ? d.leads : undefined}
          icon={UserRound}
          loading={m.loading}
          spark={sparks.enquiries}
          hint="People who left their details"
        />
        <MetricCard
          hue={attention.length ? "amber" : "green"}
          label="Needs attention"
          value={attentionError ? "Unavailable" : fmtNumber(attention.length)}
          icon={AlertTriangle}
          loading={attentionLoading}
          hint={
            attentionError
              ? "Some activity could not load"
              : attention.length
                ? "Review your next steps below"
                : "You're all caught up"
          }
        />
      </div>

      {ws.isGuestDemo && isDemo ? <DashboardJourney /> : null}

      {usage.usedPct != null && (usage.overMinutes || usage.overSpend) ? (
        <Notice
          tone="warning"
          title={
            usage.overageMinutes > 0
              ? "You have gone past your included minutes"
              : "You are close to your included minutes"
          }
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/app/settings">Alert settings</Link>
            </Button>
          }
        >
          {fmtNumber(Math.round(usage.usedMinutes))} of{" "}
          {fmtNumber(usage.includedMinutes ?? 0)} minutes used in this billing
          period.
          {usage.estimatedOverageCents != null &&
          usage.estimatedOverageCents > 0
            ? ` Estimated extra minute charge ${fmtCurrency(usage.estimatedOverageCents, usage.currency)}.`
            : usage.overageRateKnown
              ? ""
              : " Your plan has no overage rate on file, so an extra charge cannot be estimated."}
          {
            named(" This is an estimate from measured call usage shown inside Answered, not an invoice and not a message sent to you.")
          }
          {period.partialBoundary
            ? " Some usage records span the period boundary, so the total is close but not exact."
            : ""}
        </Notice>
      ) : null}

      <div className="overview-support grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel
          title="Your next steps"
          description="Customer follow-ups and connections to review."
          className="order-2 xl:order-1"
          padded={false}
        >
          {attentionLoading ? (
            <p className="p-4 text-[13px] text-ink-muted">
              Loading your next steps…
            </p>
          ) : attentionError ? (
            <div className="p-4">
              <ErrorState
                message="Some attention items could not load. Please retry before assuming everything is up to date."
                onRetry={() => {
                  m.refetch();
                  void integrationsQ.refetch();
                  void unansweredQ.refetch();
                  void numbersQ.refetch();
                }}
              />
            </div>
          ) : attention.length === 0 ? (
            <div className="flex items-start gap-3 p-5">
              <span data-hue="green" className="hue-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]" aria-hidden>
                <CheckCircle2 className="h-[18px] w-[18px]" />
              </span>
              <div>
                <p className="text-[14px] font-semibold">
                  You're all caught up
                </p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  We'll surface callbacks, unanswered questions and connection
                  issues here.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div
                className="flex flex-wrap gap-1 border-b border-hairline px-3 py-2"
                aria-label="Attention categories"
              >
                {(["tasks", "connections"] as const).map((group) => (
                  <button
                    key={group}
                    type="button"
                    aria-pressed={activeGroup === group}
                    onClick={() => {
                      setAttentionGroup(group);
                      setShowAllAttention(false);
                    }}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-md px-3 text-[12.5px] font-medium transition-colors motion-reduce:transition-none",
                      activeGroup === group
                        ? "bg-[#efeeff] text-indigo"
                        : "text-ink-muted hover:bg-canvas-2",
                    )}
                  >
                    {group === "tasks" ? "Customer tasks" : "Connections"}
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] tabular-nums",
                        group === "connections" &&
                          groupedAttention.connections.length
                          ? "bg-[#fff4df] text-[#805000]"
                          : "bg-white/80",
                      )}
                    >
                      {groupedAttention[group].length}
                    </span>
                  </button>
                ))}
              </div>
              <ul
                id="dashboard-attention"
                className={cn(
                  "divide-y divide-hairline",
                  showAllAttention && "max-h-[520px] overflow-y-auto",
                )}
              >
                {(showAllAttention
                  ? activeAttention
                  : activeAttention.slice(0, attentionPreviewLimit)
                ).map((raw) => {
                  const item = customerAttention(raw, m.current);
                  return (
                    <li
                      key={item.id}
                      className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 gap-2.5">
                        <span
                          className={cn(
                            "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                            item.severity === "danger"
                              ? "bg-coral"
                              : "bg-[#f0a800]",
                          )}
                        />
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-ink">
                            {item.title}
                          </div>
                          <div className="mt-0.5 line-clamp-2 break-words text-[12.5px] leading-5 text-ink-muted">
                            {item.detail}
                          </div>
                          {item.when ? (
                            <div className="mt-1 text-[11px] text-ink-muted">
                              {fmtRelative(item.when)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-11 shrink-0 self-start text-[12px] sm:self-auto"
                      >
                        <AttentionLink item={item} />
                      </Button>
                    </li>
                  );
                })}
                {activeAttention.length === 0 ? (
                  <li className="p-4 text-[13px] text-ink-muted">
                    Nothing waiting in this category.
                  </li>
                ) : null}
              </ul>
              {activeAttention.length > attentionPreviewLimit ? (
                <button
                  type="button"
                  onClick={() => setShowAllAttention((v) => !v)}
                  aria-expanded={showAllAttention}
                  aria-controls="dashboard-attention"
                  className="flex min-h-11 w-full items-center justify-center gap-2 border-t border-hairline text-[12.5px] font-semibold text-indigo hover:bg-[#f8f7ff]"
                >
                  {showAllAttention
                    ? "Show fewer"
                    : `View all ${activeAttention.length} ${activeGroup === "tasks" ? "tasks" : "connection issues"}`}
                  <ChevronDown
                    className={cn("h-4 w-4", showAllAttention && "rotate-180")}
                  />
                </button>
              ) : null}
            </>
          )}
        </Panel>

        <Panel
          title="Coming up"
          className="order-1 xl:order-2"
          description={
            tz
              ? `Your next appointments · ${tz.replaceAll("_", " ")}`
              : "Your next appointments"
          }
          padded={false}
          actions={
            <Link
              to="/app/bookings"
              className="inline-flex min-h-11 items-center gap-1 text-[12px] font-semibold text-indigo"
            >
              View all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          {m.loading ? (
            <p className="p-4 text-[13px] text-ink-muted">
              Loading appointments…
            </p>
          ) : m.error ? (
            <p className="p-4 text-[13px] text-ink-muted">
              Appointments could not load. Use Retry above.
            </p>
          ) : upcoming.length === 0 ? (
            <div className="p-5">
              <span data-hue="cyan" className="hue-icon mb-2.5 flex h-9 w-9 items-center justify-center rounded-[9px]" aria-hidden>
                <CalendarCheck className="h-[18px] w-[18px]" />
              </span>
              <p className="text-[13px] font-medium">
                No upcoming appointments
              </p>
              <p className="mt-1 text-[12.5px] text-ink-muted">
                New bookings will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {upcoming.map((a) => (
                <li key={a.id}>
                  <Link
                    to="/app/bookings"
                    search={{ booking: a.id }}
                    className="row-hover flex min-w-0 items-start gap-3 p-4 focus-visible:outline-indigo motion-reduce:transition-none"
                  >
                    <span data-hue="cyan" className="hue-icon mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" aria-hidden>
                      <CalendarCheck className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold text-indigo">
                        {tzDateTime(a.starts_at, tz)}
                      </span>
                      <span className="mt-1 block break-words text-[13px] font-semibold">
                        {a.customer_name || "Customer"} ·{" "}
                        {a.service || "Appointment"}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-2">
                        <AppointmentBadge status={a.status} />
                        {a.staff_name ? (
                          <span className="text-[12px] text-ink-muted">
                            {a.staff_name}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Recent calls"
        className="overview-calls"
        description={`Latest activity · ${ws.range.label.toLowerCase()}`}
        padded={false}
        actions={
          <Link
            to="/app/calls"
            className="inline-flex min-h-11 items-center gap-1 text-[12px] font-semibold text-indigo"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        <CallList
          rows={recent}
          loading={m.loading}
          onOpen={setOpenCall}
          selectedId={openCall}
          timezone={tz}
          pageSize={5}
        />
      </Panel>

      <details className="group panel">
        <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-[13px] [&::-webkit-details-marker]:hidden">
          <Bot className="h-4 w-4 text-indigo" />
          <span className="font-semibold">Receptionist & setup</span>
          <StatusBadge
            tone={
              isDemo
                ? "info"
                : readiness.tone === "success"
                  ? "success"
                  : readiness.tone === "warning"
                    ? "warning"
                    : "muted"
            }
          >
            {isDemo
              ? "Sample mode"
              : agentsQ.isPending || numbersQ.isPending
                ? "Checking status"
                : readiness.label}
          </StatusBadge>
          {!isDemo && !checklist.readyForCalls ? (
            <span className="text-[12px] text-ink-muted">
              {checklist.complete} of {checklist.total} steps complete
            </span>
          ) : null}
          <ChevronDown className="ml-auto h-4 w-4 text-ink-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="space-y-4 border-t border-hairline p-4">
          <p className="text-[13px] text-ink-muted">
            {isDemo
              ? "This workspace shows sample activity, not a live receptionist or phone connection."
              : readiness.detail}
          </p>
          {!isDemo && k.live > 0 ? (
            <p className="text-[12.5px] text-ink-muted">
              {k.live} call{k.live === 1 ? "" : "s"} currently in progress.
            </p>
          ) : null}
          {usage.includedMinutes ? (
            <div className="max-w-sm">
              <div className="flex justify-between gap-3 text-[12px]">
                <span>Minutes this billing period</span>
                <span>
                  {fmtNumber(Math.round(usage.usedMinutes))} /{" "}
                  {fmtNumber(usage.includedMinutes)}
                </span>
              </div>
              <UsageBar
                className="mt-2"
                value={usage.usedMinutes}
                max={usage.includedMinutes}
              />
              <p className="mt-1.5 text-[11.5px] text-ink-muted">
                Estimated from measured usage until your invoice is issued.
              </p>
            </div>
          ) : null}
          {!checklist.readyForCalls ? (
            <div>
              <h3 className="mb-3 text-[13px] font-semibold">
                {isDemo ? "Example setup checklist" : "Finish setting up"}
              </h3>
              <ul className="space-y-2.5">
                {checklist.steps.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col gap-2 rounded-md border border-hairline px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      {s.done ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1a9c5b]" />
                      ) : s.staffOwned ? (
                        <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
                      )}
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium">{s.title}</div>
                        <div className="text-[12.5px] text-ink-muted">
                          {s.description}
                        </div>
                        {s.staffOwned ? (
                          <span className="text-[11.5px] text-ink-muted">
                            Handled by {PRODUCT}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {!s.done ? (
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-11 shrink-0 self-start text-[12px] sm:self-auto"
                      >
                        <Link to={s.href}>{s.actionLabel}</Link>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>

      <CallDetailSheet
        callId={openCall}
        onOpenChange={(o) => !o && setOpenCall(null)}
      />
    </div>
  );
}

/** Deep link to the exact record behind an attention item. Props come from Button asChild. */
function AttentionLink({
  item,
  ...props
}: { item: ReturnType<typeof buildAttentionItems>[number] } & Record<
  string,
  unknown
>) {
  const label = item.actionLabel;
  if (item.href === "/app/calls" && item.search?.["call"]) {
    return (
      <Link {...props} to="/app/calls" search={{ call: item.search["call"] }}>
        {label}
      </Link>
    );
  }
  if (item.href === "/app/leads" && item.search?.["lead"]) {
    return (
      <Link {...props} to="/app/leads" search={{ lead: item.search["lead"] }}>
        {label}
      </Link>
    );
  }
  if (item.href === "/app/bookings" && item.search?.["booking"]) {
    return (
      <Link
        {...props}
        to="/app/bookings"
        search={{ booking: item.search["booking"] }}
      >
        {label}
      </Link>
    );
  }
  return (
    <Link {...props} to={item.href}>
      {label}
    </Link>
  );
}
