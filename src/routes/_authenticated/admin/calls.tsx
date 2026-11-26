import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, PhoneCall, PhoneMissed, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState, Notice } from "@/components/app/primitives";
import { DataTable, TableToolbar, type Column } from "@/components/app/DataTable";
import { CallStatusBadge, OutcomeBadge, StatusBadge } from "@/components/app/StatusBadge";
import { CALL_OUTCOME_LABELS } from "@/lib/app/constants";
import { fmtDuration, fmtNumber, fmtPercent, fmtPhone, fmtSmartDate, truncate } from "@/lib/app/format";
import { computeKpis, isInRange } from "@/lib/app/metrics";
import { rangeKey } from "@/lib/app/queries";
import { downloadCsv } from "@/lib/app/csv";
import { getConsoleCalls, type ConsoleCall } from "@/lib/api/console";
import { BizCell, CallSheet, useConsole } from "./-shared";
import { PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/admin/calls")({
  head: () => ({ meta: [{ title: `Calls — ${PRODUCT} admin` }] }),
  component: AdminCallsPage,
});

function AdminCallsPage() {
  const { ws, platform } = useConsole();
  const range = ws.range;
  const q = useQuery({ queryKey: ["console", "calls", rangeKey(range)], queryFn: () => getConsoleCalls(range), refetchInterval: 30_000 });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [channel, setChannel] = useState("all");
  const [includeDemo, setIncludeDemo] = useState(true);
  const [openCall, setOpenCall] = useState<string | null>(null);

  const inRange = useMemo(() => (q.data ?? []).filter((c) => isInRange(c.started_at, range.from, range.to) && (includeDemo || !c.business?.is_demo)), [q.data, range, includeDemo]);
  const kpis = useMemo(() => computeKpis(inRange, {}), [inRange]);
  const failed = inRange.filter((c) => c.status === "failed");
  const texts = inRange.filter((c) => c.channel && c.channel !== "call").length;

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return inRange.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (outcome !== "all" && c.outcome !== outcome) return false;
      if (channel === "call" && c.channel !== "call") return false;
      if (channel === "text" && c.channel === "call") return false;
      if (!s) return true;
      return [c.business?.name, c.business?.org_name, c.from_number, c.to_number, c.summary].some((v) => v?.toLowerCase().includes(s));
    });
  }, [inRange, search, status, outcome, channel]);

  const columns: Column<ConsoleCall>[] = [
    { key: "client", header: "Client", cell: (c) => <BizCell biz={c.business} showAgency={platform} /> },
    {
      key: "caller",
      header: "Caller",
      cell: (c) => (
        <div className="min-w-0">
          <div className="truncate tabular-nums text-ink">{fmtPhone(c.from_number) || "Unknown"}</div>
          <div className="truncate text-[11.5px] text-ink-muted">{c.channel === "call" ? "Call" : "Text"}</div>
        </div>
      ),
    },
    { key: "status", header: "Status", cell: (c) => <CallStatusBadge status={c.status} /> },
    { key: "outcome", header: "Outcome", hideBelow: "md", cell: (c) => <OutcomeBadge outcome={c.outcome} /> },
    { key: "dur", header: "Length", align: "right", hideBelow: "sm", cell: (c) => <span className="tabular-nums">{fmtDuration(c.duration_seconds)}</span> },
    { key: "summary", header: "Summary", hideBelow: "xl", cell: (c) => <span className="block max-w-[320px] truncate text-ink-muted">{truncate(c.summary, 80) || "—"}</span> },
    { key: "at", header: "When", align: "right", cell: (c) => <span className="whitespace-nowrap text-ink-muted">{fmtSmartDate(c.started_at)}</span> },
  ];

  return (
    <div className="space-y-5" data-page="admin-calls">
      <PageHeader
        eyebrow={platform ? "Platform console" : "Agency console"}
        title="Calls"
        description={`Every call and text ${platform ? "across every agency" : "across your clients"} for ${range.label.toLowerCase()}. Failed calls are highlighted. Refreshes every 30 seconds.`}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[12.5px]"
            onClick={() =>
              downloadCsv(
                `answered-calls-${new Date().toISOString().slice(0, 10)}.csv`,
                rows.map((c) => ({ client: c.business?.name ?? "", agency: c.business?.org_name ?? "", started_at: c.started_at, channel: c.channel, status: c.status, outcome: c.outcome ?? "", duration_seconds: c.duration_seconds, from: c.from_number ?? "", to: c.to_number ?? "" })),
              )
            }
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export
          </Button>
        }
      />

      <MetricGrid cols={5}>
        <MetricCard label="Calls and texts" value={fmtNumber(kpis.total)} icon={PhoneCall} loading={q.isPending} />
        <MetricCard label="Text conversations" value={fmtNumber(texts)} loading={q.isPending} />
        <MetricCard label="Resolved by AI" value={fmtPercent(kpis.aiResolutionRate)} loading={q.isPending} />
        <MetricCard label="Failed" value={fmtNumber(failed.length)} icon={PhoneMissed} loading={q.isPending} />
        <MetricCard label="Avg length" value={fmtDuration(kpis.avgDurationSeconds)} loading={q.isPending} />
      </MetricGrid>

      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}
      {failed.length ? (
        <Notice tone="danger" title={`${failed.length} failed call${failed.length === 1 ? "" : "s"} in this period`} action={<Button size="sm" variant="outline" className="h-7 bg-white text-[12px]" onClick={() => setStatus("failed")}>Show only failed</Button>}>
          {failed.slice(0, 3).map((c) => c.business?.name).filter(Boolean).join(" · ")}
        </Notice>
      ) : null}

      <Panel padded={false}>
        <TableToolbar>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, number, summary" className="h-8 pl-8 text-[12.5px]" aria-label="Search calls" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-[130px] text-[12.5px]" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger className="h-8 w-[150px] text-[12.5px]" aria-label="Outcome"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes</SelectItem>
              {Object.entries(CALL_OUTCOME_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="h-8 w-[120px] text-[12.5px]" aria-label="Channel"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Calls + texts</SelectItem>
              <SelectItem value="call">Calls</SelectItem>
              <SelectItem value="text">Texts</SelectItem>
            </SelectContent>
          </Select>
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-muted">
            <Switch checked={includeDemo} onCheckedChange={setIncludeDemo} aria-label="Include demo workspaces" /> Demo
          </label>
          <span className="text-[12px] tabular-nums text-ink-muted">{rows.length} shown</span>
        </TableToolbar>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          onRowClick={(c) => setOpenCall(c.id)}
          rowClassName={(c) => (c.status === "failed" ? "bg-[#fff7f7] [&>td:first-child]:shadow-[inset_3px_0_0_#e5484d]" : undefined)}
          loading={q.isPending}
          pageSize={30}
          empty={{ title: "No calls match", description: "Try a different range or clear the filters.", icon: PhoneCall }}
        />
      </Panel>
      <p className="text-[11.5px] text-ink-muted">
        <StatusBadge tone="danger">Failed</StatusBadge> rows are calls the phone provider reported as failed. Browser test calls aren't listed.
      </p>

      <CallSheet callId={openCall} onClose={() => setOpenCall(null)} />
    </div>
  );
}
