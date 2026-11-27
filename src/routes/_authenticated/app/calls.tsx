import { useEffect, useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/app/primitives";
import { CallList } from "@/components/app/CallList";
import { CallDetailSheet } from "@/components/app/CallDetailSheet";
import { resolveRange } from "@/lib/app/date-range";
import { useRangeMetrics } from "@/lib/app/use-metrics";
import { useWorkspace } from "@/lib/app/workspace";
import type { CallListRow } from "@/lib/app/types";
import { cn } from "@/lib/utils";
import { OTHER_BRAND, PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/app/calls")({
  validateSearch: (search: Record<string, unknown>): { call?: string } => ({
    call: typeof search["call"] === "string" && search["call"] ? String(search["call"]) : undefined,
  }),
  // Calls are part of the Inbox now; old links land there.
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/app/inbox", search: { call: (search as { call?: string }).call }, replace: true });
  },
  head: () => ({
    meta: [{ title: OTHER_BRAND ? `Calls | ${PRODUCT}` : "Calls" }, { name: "description", content: "Every call your receptionist answered, with a summary and transcript." }],
  }),
  component: CallsPage,
});

type Filter = "all" | "bookings" | "messages" | "missed";
const FILTERS: { id: Filter; label: string; test: (c: CallListRow) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "bookings", label: "Bookings", test: (c) => c.outcome === "booked" },
  { id: "messages", label: "Messages", test: (c) => c.outcome === "lead_captured" || c.outcome === "callback_requested" || c.outcome === "voicemail" },
  { id: "missed", label: "Missed", test: (c) => c.status === "missed" || c.status === "failed" || c.outcome === "no_answer" },
];

function CallsPage() {
  const ws = useWorkspace();
  // Everything from the last 90 days: no date picker to puzzle over.
  const range = useMemo(() => resolveRange("90d", ws.business?.timezone ?? null), [ws.business?.timezone]);
  const m = useRangeMetrics(ws.businessId, range);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const initialCall = Route.useSearch().call ?? null;
  const [openCall, setOpenCall] = useState<string | null>(initialCall);
  useEffect(() => setOpenCall(initialCall), [initialCall]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const test = FILTERS.find((f) => f.id === filter)!.test;
    return m.current.filter((c) => {
      if (!test(c)) return false;
      if (!q) return true;
      return [c.contact?.full_name, c.from_number, c.to_number, c.intent, c.summary].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [m.current, search, filter]);
  const filtered = filter !== "all" || search.trim().length > 0;

  return (
    <div className="space-y-4">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">Calls</h1>

      {m.error ? <ErrorState message={m.error} onRetry={m.refetch} /> : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, number or what they wanted" className="h-12 bg-white pl-10 text-[15px]" aria-label="Search calls" />
      </div>

      <div role="radiogroup" aria-label="Show" className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={filter === f.id}
            data-filter={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "min-h-11 shrink-0 rounded-full border px-4 text-[14px] font-medium",
              filter === f.id ? "border-indigo bg-indigo text-white" : "border-hairline bg-white text-ink-muted hover:text-ink",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <section className="panel overflow-hidden">
        <CallList
          rows={rows}
          loading={m.loading}
          onOpen={setOpenCall}
          selectedId={openCall}
          timezone={ws.business?.timezone}
          resetKey={`${search}|${filter}`}
          pageSize={25}
          empty={{
            title: filtered ? "No calls match" : "No calls yet",
            description: filtered ? "Try another filter or clear the search." : "Calls your receptionist answers will show up here.",
          }}
        />
      </section>

      <CallDetailSheet callId={openCall} onOpenChange={(o) => !o && setOpenCall(null)} />
    </div>
  );
}
