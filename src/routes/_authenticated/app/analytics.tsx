import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, Clock, Download, Moon, PhoneForwarded, Sparkles, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, ErrorState, MetricCard, MetricGrid, Notice, KeyValue } from "@/components/app/primitives";
import { CallVolumeChart, ChartCard, DirectionChart, OutcomeDonut, PeakHoursChart, RankedBars, SimpleBarChart, STATE_COLORS, StackedStatusChart, TrendChart } from "@/components/app/Charts";
import { HUE_HEX } from "@/components/app/hues";
import { StatusBadge } from "@/components/app/StatusBadge";
import { CHART_COLORS } from "@/lib/app/constants";
import { fmtDuration, fmtHours, fmtNumber, fmtPercent } from "@/lib/app/format";
import {
  buildDailySeries,
  buildIntentBreakdown,
  buildOutcomeBreakdown,
  buildPeakHours,
  buildTrendSeries,
  busiestDay,
  busiestHour,
  isInRange,
  weekdayBreakdown,
} from "@/lib/app/metrics";
import { DateRangeSelect } from "@/components/app/DateRangeSelect";
import { useRangeMetrics } from "@/lib/app/use-metrics";
import { useWorkspace } from "@/lib/app/workspace";
import { PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/app/analytics")({
  head: () => ({
    meta: [
      { title: `Reports — ${PRODUCT}` },
      { name: "description", content: "Call volume, busiest times, outcomes and booking trends for your AI receptionist." },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const ws = useWorkspace();
  const m = useRangeMetrics(ws.businessId, ws.range);
  const { range } = ws;

  const tz = ws.business?.timezone ?? null;
  const daily = useMemo(() => buildDailySeries(m.current, range.from, range.to, tz), [m.current, range, tz]);
  const hours = useMemo(() => buildPeakHours(m.current, tz), [m.current, tz]);
  const outcomes = useMemo(() => buildOutcomeBreakdown(m.current), [m.current]);
  const intents = useMemo(() => buildIntentBreakdown(m.current, 8), [m.current]);
  const weekdays = useMemo(() => weekdayBreakdown(m.current, tz), [m.current, tz]);
  const trend = useMemo(
    () =>
      buildTrendSeries(
        m.appointments.filter((a) => isInRange(a.created_at, range.from, range.to)),
        m.leads.filter((l) => isInRange(l.created_at, range.from, range.to)),
        range.from,
        range.to,
        tz,
      ),
    [m.appointments, m.leads, range, tz],
  );
  const topDay = busiestDay(daily);
  const topHour = busiestHour(hours);

  const sentiment = useMemo(() => {
    const counts = { positive: 0, neutral: 0, negative: 0 };
    for (const c of m.current) if (c.sentiment) counts[c.sentiment]++;
    const total = counts.positive + counts.neutral + counts.negative;
    return [
      { key: "positive", name: "Positive", value: counts.positive, color: "#1a9c5b", pct: total ? counts.positive / total : 0 },
      { key: "neutral", name: "Neutral", value: counts.neutral, color: "#8898aa", pct: total ? counts.neutral / total : 0 },
      { key: "negative", name: "Negative", value: counts.negative, color: CHART_COLORS.coral, pct: total ? counts.negative / total : 0 },
    ];
  }, [m.current]);

  const agentBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const c of m.current) {
      const key = c.agent?.id ?? "none";
      const name = c.agent?.name ?? "No receptionist";
      map.set(key, { name, count: (map.get(key)?.count ?? 0) + 1 });
    }
    return [...map.entries()].map(([key, v]) => ({ key, name: v.name, value: v.count, color: CHART_COLORS.indigo }));
  }, [m.current]);

  const exportCsv = () => {
    const head = ["Date", "Total", "Inbound", "Outbound", "Answered", "Missed", "Failed", "After hours"];
    const lines = daily.map((d) => [d.date, d.total, d.inbound, d.outbound, d.answered, d.missed, d.failed, d.afterHours].join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `answered-analytics-${range.preset}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Daily summary exported");
  };

  const k = m.kpis;
  const empty = !m.loading && m.current.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={ws.business?.name}
        title="Reports"
        description={`How your receptionist performed over the ${range.label.toLowerCase()}, compared with the period before.`}
        actions={
          <>
            <DateRangeSelect value={ws.rangePreset} onChange={ws.setRangePreset} />
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={daily.length === 0}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
          </>
        }
      />

      {m.error ? <ErrorState message={m.error} onRetry={m.refetch} /> : null}
      {empty ? <Notice tone="neutral">No calls in this period yet. Charts fill in as soon as your receptionist takes its first call.</Notice> : null}

      <MetricGrid cols={4}>
        <MetricCard label="Resolved by AI" value={fmtPercent(k.aiResolutionRate)} delta={m.deltas.aiResolutionRate} icon={Sparkles} loading={m.loading} hint={`${fmtNumber(k.aiResolved)} of ${fmtNumber(k.answered)} answered calls`} />
        <MetricCard label="Transfer rate" value={fmtPercent(k.transferRate)} delta={m.deltas.transferRate} icon={PhoneForwarded} hue="coral" loading={m.loading} invert hint={`${fmtNumber(k.transfers)} handed to your team`} />
        <MetricCard label="Avg. handle time" value={fmtDuration(k.avgHandleSeconds)} delta={m.deltas.avgHandleSeconds} icon={Timer} loading={m.loading} invert hint={`${fmtHours(k.totalTalkSeconds)} total talk time`} />
        <MetricCard label="After-hours handled" value={fmtNumber(k.afterHoursHandled)} delta={m.deltas.afterHoursHandled} icon={Moon} hue="violet" spark={daily.map((d) => d.afterHours)} loading={m.loading} hint={`${fmtPercent(k.total ? k.afterHoursHandled / k.total : 0)} of all calls`} />
      </MetricGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Call volume" description="Calls per day, answered vs missed" className="lg:col-span-2" empty={empty} legend={[{ label: "Answered", color: STATE_COLORS.answered }, { label: "Missed", color: STATE_COLORS.missed }, { label: "Failed", color: STATE_COLORS.failed }]}>
          <StackedStatusChart data={daily} />
        </ChartCard>
        <ChartCard title="Outcomes" description="What happened on each call" empty={empty}>
          <OutcomeDonut data={outcomes} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Bookings & leads" description="Created per day" empty={empty} legend={[{ label: "Bookings", color: HUE_HEX.cyan }, { label: "Leads", color: CHART_COLORS.magenta }]}>
          <TrendChart data={trend} />
        </ChartCard>
        <ChartCard title="Busiest hours" description="When your phone rings most" empty={empty} legend={[{ label: "Busiest", color: STATE_COLORS.peak }, { label: "After hours", color: STATE_COLORS.afterHours }]}>
          <PeakHoursChart data={hours} />
        </ChartCard>
        <ChartCard title="By weekday" description="Total calls per day of week" empty={empty}>
          <SimpleBarChart data={weekdays} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Top call reasons" description="What callers wanted, ranked">
          <RankedBars data={intents} />
        </Panel>
        <Panel title="Caller sentiment" description="Detected tone across answered calls">
          <div className="space-y-3">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-canvas-2">
              {sentiment.map((s) => (
                <div key={s.key} style={{ width: `${s.pct * 100}%`, background: s.color }} className="h-full transition-all" />
              ))}
            </div>
            <ul className="space-y-2">
              {sentiment.map((s) => (
                <li key={s.key} className="flex items-center justify-between text-[12.5px]">
                  <span className="inline-flex items-center gap-2 text-ink">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} /> {s.name}
                  </span>
                  <span className="tabular-nums text-ink-muted">
                    {fmtNumber(s.value)} · {fmtPercent(s.pct)}
                  </span>
                </li>
              ))}
            </ul>
            {sentiment.every((s) => s.value === 0) ? (
              <p className="text-[11.5px] text-ink-muted">Caller sentiment isn't measured for your calls yet.</p>
            ) : null}
            <KeyValue
              columns={2}
              items={[
                { label: "Busiest day", value: topDay ? `${topDay.label} (${topDay.total})` : "—" },
                { label: "Busiest hour", value: topHour ? `${topHour.label} (${topHour.count})` : "—" },
              ]}
            />
          </div>
        </Panel>
        <Panel title="Efficiency" description="What the receptionist saved you">
          <div className="space-y-3">
            <div data-hue="green" className="rounded-[8px] border border-[var(--hue-line)] bg-[linear-gradient(150deg,var(--hue-soft),#fff_75%)] p-3">
              <div className="flex items-center gap-2 text-[12px] text-ink-muted">
                <span className="hue-icon flex h-6 w-6 items-center justify-center rounded-[6px]" aria-hidden>
                  <Clock className="h-3.5 w-3.5" />
                </span>
                Reception hours saved
              </div>
              <div className="mt-1 text-[24px] font-semibold tracking-tight text-ink">{fmtNumber(k.estimatedReceptionHours, { maximumFractionDigits: 1 })}h</div>
              <div className="text-[11.5px] text-ink-muted">Talk time plus after-call wrap-up a human would have spent</div>
            </div>
            <KeyValue
              columns={2}
              items={[
                { label: "Calls handled", value: fmtNumber(k.total) },
                { label: "Booking conversion", value: fmtPercent(k.bookingConversion) },
                { label: "Lead conversion", value: fmtPercent(k.leadConversion) },
                { label: "Text conversations", value: fmtNumber(k.smsSent) },
                { label: "Failure rate", value: fmtPercent(k.failureRate, 1) },
                { label: "Live now", value: <StatusBadge tone={k.live > 0 ? "live" : "muted"}>{k.live > 0 ? `${k.live} live` : "None"}</StatusBadge> },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Inbound vs outbound" description="Direction of calls per day" empty={empty} legend={[{ label: "Inbound", color: CHART_COLORS.indigo }, { label: "Outbound", color: STATE_COLORS.outbound }]}>
          <DirectionChart data={daily} />
        </ChartCard>
        <Panel title="By receptionist" description="Calls handled per receptionist in this period" actions={<BarChart3 className="h-4 w-4 text-ink-muted" />}>
          <RankedBars data={agentBreakdown} />
          {agentBreakdown.length > 0 ? (
            <div className="mt-4 h-[140px]">
              <CallVolumeChart data={daily} />
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
