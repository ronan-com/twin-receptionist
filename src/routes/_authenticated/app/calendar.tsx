import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/app/primitives";
import { decideBooking, getCalendar, type CalEvent } from "@/lib/api/clean";
import { fmtPhone } from "@/lib/app/format";
import { addDayKey, tzDayKey, tzEndOfDay, tzFormat, tzStartOfDay, tzTime, tzWeekKey } from "@/lib/app/business-logic";
import { useWorkspace } from "@/lib/app/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/calendar")({
  validateSearch: (s: Record<string, unknown>): { booking?: string } => ({ booking: typeof s["booking"] === "string" ? String(s["booking"]) : undefined }),
  head: () => ({ meta: [{ title: "Calendar" }] }),
  component: CalendarPage,
});

const SOURCE: Record<CalEvent["source"], string> = { booking: "AI", builtin: "AI", google: "Google", microsoft: "Outlook" };

function CalendarPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const tz = ws.business?.timezone ?? null;
  const today = tzDayKey(new Date(), tz);
  const [view, setView] = useState<"week" | "day">("week");
  const [day, setDay] = useState(today);
  const start = view === "week" ? tzWeekKey(tzStartOfDay(day, tz), tz) : day;
  const days = useMemo(() => Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => addDayKey(start, i)), [start, view]);
  const from = tzStartOfDay(days[0]!, tz);
  const to = tzEndOfDay(days[days.length - 1]!, tz);

  const q = useQuery({ queryKey: ["calendar", ws.businessId, days[0], days.length], enabled: !!ws.businessId, queryFn: () => getCalendar(ws.businessId!, from, to) });
  // Waiting for a decision: always shown, whichever week is open.
  const waiting = useQuery({
    queryKey: ["calendar-pending", ws.businessId],
    enabled: !!ws.businessId,
    queryFn: async () => (await getCalendar(ws.businessId!, new Date(Date.now() - 86_400_000), new Date(Date.now() + 120 * 86_400_000))).filter((e) => e.status === "pending"),
  });
  const decide = useMutation({
    mutationFn: (v: { e: CalEvent; status: "confirmed" | "declined" }) => decideBooking(ws.businessId!, v.e.requestId!, v.status),
    onSuccess: (_r, v) => {
      toast.success(v.status === "confirmed" ? "Approved. They've been told." : "Declined. They've been told.");
      void qc.invalidateQueries({ queryKey: ["calendar", ws.businessId] });
      void qc.invalidateQueries({ queryKey: ["calendar-pending", ws.businessId] });
    },
    onError: (e: Error) => toast.error("Couldn't do that", { description: e.message }),
  });

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of q.data ?? []) {
      if (e.status === "declined" || e.status === "cancelled") continue;
      const k = tzDayKey(e.starts_at, tz);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [q.data, tz]);

  const step = view === "week" ? 7 : 1;
  const title = view === "week" ? `${tzFormat(from, tz, { day: "numeric", month: "short" })} to ${tzFormat(to, tz, { day: "numeric", month: "short" })}` : tzFormat(from, tz, { weekday: "long", day: "numeric", month: "long" });
  const canEdit = ws.access.canEdit;

  return (
    <div className="space-y-5" data-page="calendar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">Calendar</h1>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="View" className="flex rounded-full border border-hairline p-0.5">
            {(["week", "day"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)} className={cn("h-8 rounded-full px-3.5 text-[13px] font-medium capitalize", view === v ? "bg-indigo text-white" : "text-ink-muted hover:text-ink")}>
                {v}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Back" onClick={() => setDay(addDayKey(start, -step))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-9" onClick={() => setDay(today)}>
            Today
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Next" onClick={() => setDay(addDayKey(start, step))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {(waiting.data ?? []).length > 0 ? (
        <section aria-label="Needs your approval" className="space-y-2 rounded-xl border border-indigo/30 bg-indigo/5 p-4" data-pending-approvals>
          <h2 className="text-[14px] font-semibold text-ink">Needs your approval</h2>
          <ul className="divide-y divide-hairline/70">
            {waiting.data!.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">
                    {e.customer_name || "Someone"} · {e.title}
                  </span>
                  <span className="block text-[12.5px] text-ink-muted">
                    {tzFormat(e.starts_at, tz, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    {e.phone ? ` · ${fmtPhone(e.phone)}` : ""}
                  </span>
                </span>
                {canEdit ? (
                  <span className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ e, status: "declined" })} data-action="decline">
                      <X className="mr-1 h-4 w-4" /> Decline
                    </Button>
                    <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ e, status: "confirmed" })} data-action="approve">
                      {decide.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />} Approve
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex items-center justify-between"><p className="text-[14px] font-medium text-ink">{title}</p><Link to="/app/bookings" className="text-[13px] text-ink-muted underline-offset-2 hover:underline">All bookings</Link></div>
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}

      <div className={cn("grid gap-3", view === "week" ? "sm:grid-cols-7" : "grid-cols-1")}>
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const isToday = d === today;
          return (
            <section key={d} aria-label={d} className={cn("min-h-[120px] rounded-xl border bg-white p-2.5", isToday ? "border-indigo/50" : "border-hairline")}>
              <h3 className={cn("mb-2 px-1 text-[12.5px] font-semibold", isToday ? "text-indigo" : "text-ink-muted")}>{tzFormat(tzStartOfDay(d, tz), tz, { weekday: "short", day: "numeric" })}</h3>
              <ul className="space-y-1.5">
                {list.map((e) => (
                  <li key={e.id} className={cn("rounded-lg px-2.5 py-2 text-[12.5px] leading-snug", e.status === "pending" ? "border border-dashed border-indigo/60 bg-indigo/5" : e.source === "booking" || e.source === "builtin" ? "bg-indigo/10" : "bg-canvas-2")}>
                    <span className="block font-medium text-ink">{tzTime(e.starts_at, tz)}</span>
                    <span className="block truncate text-ink">{e.customer_name ? `${e.customer_name} · ` : ""}{e.title}</span>
                    <span className="block text-[11.5px] text-ink-muted">{e.status === "pending" ? "Waiting for you" : SOURCE[e.source]}</span>
                  </li>
                ))}
                {list.length === 0 && view === "day" ? <li className="px-1 text-[13px] text-ink-muted">Nothing booked.</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
