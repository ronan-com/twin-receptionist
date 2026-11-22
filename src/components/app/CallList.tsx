import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  PhoneCall,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPhone } from "@/lib/app/format";
import { tzDateTime } from "@/lib/app/business-logic";
import type { CallListRow } from "@/lib/app/types";
import { CallStatusBadge, OutcomeBadge } from "./StatusBadge";
import { EmptyState } from "./primitives";
import { Skeleton } from "@/components/ui/skeleton";

const columns =
  "md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,.9fr)]";

/** One responsive list, so caller, summary and outcome remain visible on phones. */
export function CallList({
  rows,
  loading,
  onOpen,
  selectedId,
  timezone,
  pageSize = 25,
  resetKey = "",
  empty,
}: {
  rows: CallListRow[];
  loading?: boolean;
  onOpen: (id: string) => void;
  selectedId?: string | null;
  timezone?: string | null;
  pageSize?: number;
  resetKey?: string;
  empty?: { title: string; description: string; action?: ReactNode };
}) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [resetKey]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );

  return (
    <div aria-busy={loading || undefined}>
      <div
        aria-hidden="true"
        className={cn(
          "hidden gap-4 border-b border-hairline bg-canvas-2/50 px-4 py-2.5 text-[11.5px] font-semibold text-ink-muted md:grid",
          columns,
        )}
      >
        <span>Caller</span>
        <span>What happened</span>
        <span>Outcome</span>
        <span>When</span>
      </div>
      {loading ? (
        <div aria-label="Loading calls" className="divide-y divide-hairline">
          {Array.from({ length: Math.min(pageSize, 5) }, (_, i) => (
            <div key={i} className="space-y-2 p-4">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={PhoneCall}
          title={empty?.title ?? "No calls yet"}
          description={
            empty?.description ??
            "Calls your receptionist handles will appear here."
          }
          action={empty?.action}
        />
      ) : (
        <ul aria-label="Calls" className="divide-y divide-hairline">
          {visible.map((call) => (
            <li key={call.id}>
              <button
                type="button"
                onClick={() => onOpen(call.id)}
                aria-haspopup="dialog"
                className={cn(
                  "grid w-full min-w-0 gap-2.5 px-4 py-4 text-left outline-none transition-colors hover:bg-[#f8f7ff] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo motion-reduce:transition-none md:items-center md:gap-4",
                  columns,
                  selectedId === call.id && "bg-[#f4f3ff]",
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      call.direction === "inbound"
                        ? "bg-[#efeeff] text-indigo"
                        : "bg-[#e6f6ff] text-[#0b5d87]",
                    )}
                  >
                    {call.direction === "inbound" ? (
                      <ArrowDownLeft
                        className="h-4 w-4"
                        aria-label="Incoming call"
                      />
                    ) : (
                      <ArrowUpRight
                        className="h-4 w-4"
                        aria-label="Outgoing call"
                      />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words text-[13px] font-semibold text-ink">
                      {call.contact?.full_name || "Unknown caller"}
                    </span>
                    <span className="block break-words text-[12px] text-ink-muted">
                      {fmtPhone(
                        call.direction === "inbound"
                          ? call.from_number
                          : call.to_number,
                      )}
                    </span>
                  </span>
                </span>
                <span className="line-clamp-2 min-w-0 break-words text-[13px] leading-5 text-ink-muted">
                  {call.summary?.trim() ||
                    call.intent?.trim() ||
                    "No summary available. Open this call for details."}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {call.outcome ? (
                    <OutcomeBadge outcome={call.outcome} />
                  ) : (
                    <>
                      <CallStatusBadge status={call.status} />
                      {call.status === "completed" ? (
                        <span className="text-[11px] text-ink-muted">
                          Outcome not recorded
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
                <span className="min-w-0 break-words text-[11.5px] leading-5 text-ink-muted">
                  {tzDateTime(call.started_at, timezone)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && pages > 1 ? (
        <div className="flex items-center justify-between gap-2 border-t border-hairline px-4 py-2 text-[12px] text-ink-muted">
          <span aria-live="polite">
            {currentPage * pageSize + 1}–
            {Math.min(rows.length, (currentPage + 1) * pageSize)} of{" "}
            {rows.length}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
              className="flex h-11 w-11 items-center justify-center rounded-md border border-hairline hover:bg-canvas-2 focus-visible:outline-indigo disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={currentPage === pages - 1}
              onClick={() => setPage(currentPage + 1)}
              className="flex h-11 w-11 items-center justify-center rounded-md border border-hairline hover:bg-canvas-2 focus-visible:outline-indigo disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
