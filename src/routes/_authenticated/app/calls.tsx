import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, MoonStar, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader, Panel, ErrorState } from "@/components/app/primitives";
import { TableToolbar } from "@/components/app/DataTable";
import { CallList } from "@/components/app/CallList";
import { CallDetailSheet } from "@/components/app/CallDetailSheet";
import { CALL_OUTCOME_LABELS, CALL_STATUS_LABELS } from "@/lib/app/constants";
import { fmtNumber } from "@/lib/app/format";
import { useRangeMetrics } from "@/lib/app/use-metrics";
import { useWorkspace } from "@/lib/app/workspace";
import type { CallListRow, CallOutcome, CallStatus } from "@/lib/app/types";

export const Route = createFileRoute("/_authenticated/app/calls")({
  validateSearch: (search: Record<string, unknown>): { call?: string } => ({
    call:
      typeof search["call"] === "string" && search["call"]
        ? String(search["call"])
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Calls — Answered" },
      {
        name: "description",
        content:
          "Search every call your AI receptionist handled, with transcripts, outcomes and next steps.",
      },
    ],
  }),
  component: CallsPage,
});

function toCsv(rows: CallListRow[]) {
  const head = [
    "Started",
    "Direction",
    "Caller",
    "Number",
    "Status",
    "Outcome",
    "Intent",
    "Duration (s)",
    "AI handled",
    "Transferred",
    "After hours",
    "Sentiment",
    "Summary",
  ];
  // Quoted, and text a spreadsheet would run as a formula (=, @, +/- before a non-digit) is defused.
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    const safe = /^[=@\t\r]|^[+-](?![\d\s(])/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((c) =>
    [
      c.started_at,
      c.direction,
      c.contact?.full_name ?? "",
      c.direction === "inbound" ? c.from_number : c.to_number,
      c.status,
      c.outcome ?? "",
      c.intent ?? "",
      c.duration_seconds ?? 0,
      c.ai_handled ? "yes" : "no",
      c.transferred ? "yes" : "no",
      c.after_hours ? "yes" : "no",
      c.sentiment ?? "",
      c.summary ?? "",
    ]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

function CallsPage() {
  const ws = useWorkspace();
  const m = useRangeMetrics(ws.businessId, ws.range);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CallStatus | "all">("all");
  const [outcome, setOutcome] = useState<CallOutcome | "all">("all");
  const [direction, setDirection] = useState<"all" | "inbound" | "outbound">(
    "all",
  );
  const [afterHours, setAfterHours] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const initialCall = Route.useSearch().call ?? null;
  const [openCall, setOpenCall] = useState<string | null>(initialCall);
  useEffect(() => setOpenCall(initialCall), [initialCall]);
  const activeFilters =
    Number(status !== "all") +
    Number(outcome !== "all") +
    Number(direction !== "all") +
    Number(afterHours);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return m.current.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (outcome !== "all" && c.outcome !== outcome) return false;
      if (direction !== "all" && c.direction !== direction) return false;
      if (afterHours && !c.after_hours) return false;
      if (q) {
        const hay = [
          c.contact?.full_name,
          c.from_number,
          c.to_number,
          c.intent,
          c.summary,
          c.agent?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [m, search, status, outcome, direction, afterHours]);

  const filtered =
    status !== "all" ||
    outcome !== "all" ||
    direction !== "all" ||
    afterHours ||
    search.trim().length > 0;
  const reset = () => {
    setSearch("");
    setStatus("all");
    setOutcome("all");
    setDirection("all");
    setAfterHours(false);
  };

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `answered-calls-${ws.range.preset}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={ws.business?.name}
        title="Calls"
        description={`${fmtNumber(m.kpis.total)} calls in the ${ws.range.label.toLowerCase()} · ${fmtNumber(m.kpis.answered)} answered · ${fmtNumber(m.kpis.missed + m.kpis.failed)} missed or failed`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={rows.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
          </Button>
        }
      />

      {m.error ? <ErrorState message={m.error} onRetry={m.refetch} /> : null}

      <Panel padded={false}>
        <TableToolbar className="gap-2 py-3">
          <div className="relative min-w-0 basis-full sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search calls…"
              className="h-11 pl-9 text-[14px]"
              aria-label="Search calls"
            />
          </div>
          <Button
            variant={showFilters || activeFilters ? "secondary" : "outline"}
            className="h-11"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            aria-controls="call-filters"
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" /> Filters
            {activeFilters ? ` (${activeFilters})` : ""}
          </Button>
          {filtered ? (
            <Button variant="ghost" className="h-11" onClick={reset}>
              <X className="mr-1 h-4 w-4" /> Clear
            </Button>
          ) : null}
          <span
            aria-live="polite"
            className="ml-auto text-[12px] tabular-nums text-ink-muted"
          >
            {fmtNumber(rows.length)} calls
          </span>
        </TableToolbar>
        {showFilters ? (
          <div
            id="call-filters"
            className="grid gap-2 border-b border-hairline bg-canvas-2/40 p-3 sm:flex sm:flex-wrap"
          >
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as CallStatus | "all")}
            >
              <SelectTrigger
                className="h-11 w-full sm:w-[150px] text-[12.5px]"
                aria-label="Status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(Object.keys(CALL_STATUS_LABELS) as CallStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {CALL_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={outcome}
              onValueChange={(v) => setOutcome(v as CallOutcome | "all")}
            >
              <SelectTrigger
                className="h-11 w-full sm:w-[150px] text-[12.5px]"
                aria-label="Outcome"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                {(Object.keys(CALL_OUTCOME_LABELS) as CallOutcome[]).map(
                  (o) => (
                    <SelectItem key={o} value={o}>
                      {CALL_OUTCOME_LABELS[o]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Select
              value={direction}
              onValueChange={(v) => setDirection(v as typeof direction)}
            >
              <SelectTrigger
                className="h-11 w-full sm:w-[140px] text-[12.5px]"
                aria-label="Direction"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">In & out</SelectItem>
                <SelectItem value="inbound">Inbound</SelectItem>
                <SelectItem value="outbound">Outbound</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={afterHours ? "default" : "outline"}
              size="sm"
              className="h-11"
              onClick={() => setAfterHours((v) => !v)}
              aria-pressed={afterHours}
            >
              <MoonStar className="mr-1.5 h-3.5 w-3.5" /> After hours
            </Button>
          </div>
        ) : null}
        <CallList
          rows={rows}
          loading={m.loading}
          onOpen={setOpenCall}
          selectedId={openCall}
          timezone={ws.business?.timezone}
          resetKey={[
            search,
            status,
            outcome,
            direction,
            afterHours,
            ws.range.from,
            ws.range.to,
          ].join("|")}
          pageSize={25}
          empty={{
            title: filtered
              ? "No calls match these filters"
              : "No calls in this period",
            description: filtered
              ? "Try widening the date range or clearing a filter."
              : "Calls handled by your receptionist will appear here.",
            action: filtered ? (
              <Button size="sm" variant="outline" onClick={reset}>
                Clear filters
              </Button>
            ) : undefined,
          }}
        />
      </Panel>

      <CallDetailSheet
        callId={openCall}
        onOpenChange={(o) => !o && setOpenCall(null)}
      />
    </div>
  );
}
