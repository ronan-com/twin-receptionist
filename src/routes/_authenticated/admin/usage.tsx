import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, Download, MessageSquare, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState, Notice } from "@/components/app/primitives";
import { ChartCard, SimpleBarChart } from "@/components/app/Charts";
import { DataTable, type Column } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { fmtNumber, fmtShortDate } from "@/lib/app/format";
import { rangeKey } from "@/lib/app/queries";
import { downloadCsv } from "@/lib/app/csv";
import { getConsoleUsage, type ConsoleUsage } from "@/lib/api/console";
import { BizCell, NOT_BILLED, useConsole } from "./-shared";
import { PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/admin/usage")({
  head: () => ({ meta: [{ title: `Usage — ${PRODUCT} admin` }] }),
  component: UsagePage,
});

type BizUsage = ConsoleUsage["businesses"][number];
type AgencyUsage = ConsoleUsage["agencies"][number];

function UsagePage() {
  const { ws, platform } = useConsole();
  const range = ws.range;
  const q = useQuery({ queryKey: ["console", "usage", rangeKey(range)], queryFn: () => getConsoleUsage(range) });
  const d = q.data;
  const totals = useMemo(() => {
    const b = d?.businesses ?? [];
    return { calls: b.reduce((n, x) => n + x.calls, 0), texts: b.reduce((n, x) => n + x.texts, 0), minutes: b.reduce((n, x) => n + x.minutes, 0), failed: b.reduce((n, x) => n + x.failed, 0) };
  }, [d]);
  const chart = (d?.daily ?? []).map((x) => ({ label: fmtShortDate(x.day), count: x.minutes }));

  const bizCols: Column<BizUsage>[] = [
    { key: "biz", header: "Client", cell: (b) => <BizCell biz={b} showAgency={platform} /> },
    { key: "status", header: "Status", hideBelow: "sm", cell: (b) => <StatusBadge tone={b.status === "active" ? "success" : "muted"}>{b.status === "active" ? "Active" : "Paused"}</StatusBadge> },
    { key: "calls", header: "Calls", align: "right", cell: (b) => <span className="tabular-nums">{fmtNumber(b.calls)}</span> },
    { key: "minutes", header: "Minutes", align: "right", cell: (b) => <span className="tabular-nums">{fmtNumber(b.minutes)}</span> },
    { key: "texts", header: "Texts", align: "right", hideBelow: "md", cell: (b) => <span className="tabular-nums">{fmtNumber(b.texts)}</span> },
    { key: "failed", header: "Failed", align: "right", hideBelow: "md", cell: (b) => <span className={b.failed ? "tabular-nums text-[#a41d1d]" : "tabular-nums"}>{fmtNumber(b.failed)}</span> },
  ];
  const agencyCols: Column<AgencyUsage>[] = [
    { key: "name", header: "Agency", cell: (a) => <span className="font-medium text-ink">{a.org_name}{a.is_demo ? " (test lab)" : ""}</span> },
    { key: "biz", header: "Clients", align: "right", hideBelow: "sm", cell: (a) => <span className="tabular-nums">{fmtNumber(a.businesses)}</span> },
    { key: "calls", header: "Calls", align: "right", cell: (a) => <span className="tabular-nums">{fmtNumber(a.calls)}</span> },
    { key: "minutes", header: "Minutes", align: "right", cell: (a) => <span className="tabular-nums">{fmtNumber(a.minutes)}</span> },
    { key: "texts", header: "Texts", align: "right", hideBelow: "md", cell: (a) => <span className="tabular-nums">{fmtNumber(a.texts)}</span> },
  ];

  return (
    <div className="space-y-5" data-page="admin-usage">
      <PageHeader
        eyebrow={platform ? "Platform console" : "Agency console"}
        title="Usage"
        description={`Calls, minutes and text conversations ${platform ? "per agency and client" : "per client"} · ${range.label}`}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[12.5px]"
            onClick={() => downloadCsv(`answered-usage-${new Date().toISOString().slice(0, 10)}.csv`, (d?.businesses ?? []).map((b) => ({ client: b.name, agency: b.org_name, calls: b.calls, minutes: b.minutes, texts: b.texts, failed: b.failed })))}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export
          </Button>
        }
      />
      <Notice tone="neutral">{NOT_BILLED}</Notice>
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}

      <MetricGrid cols={4}>
        <MetricCard label="Calls" value={fmtNumber(totals.calls)} icon={PhoneCall} loading={q.isPending} />
        <MetricCard label="Call minutes" value={fmtNumber(totals.minutes)} icon={Clock} loading={q.isPending} />
        <MetricCard label="Text conversations" value={fmtNumber(totals.texts)} icon={MessageSquare} loading={q.isPending} />
        <MetricCard label="Failed calls" value={fmtNumber(totals.failed)} loading={q.isPending} />
      </MetricGrid>

      <ChartCard title="Call minutes by day" height={220} empty={!q.isPending && chart.length === 0}>
        <SimpleBarChart data={chart} name="Minutes" />
      </ChartCard>

      {platform ? (
        <Panel title="By agency" padded={false}>
          <DataTable columns={agencyCols} rows={d?.agencies ?? []} rowKey={(a) => a.org_id} loading={q.isPending} empty={{ title: "No agencies yet" }} />
        </Panel>
      ) : null}
      <Panel title="By client" padded={false}>
        <DataTable columns={bizCols} rows={[...(d?.businesses ?? [])].sort((a, b) => b.minutes - a.minutes || b.calls - a.calls)} rowKey={(b) => b.id} loading={q.isPending} empty={{ title: "No clients yet" }} />
      </Panel>
    </div>
  );
}
