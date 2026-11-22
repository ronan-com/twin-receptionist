import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, MessageSquare, PhoneCall, UserRound } from "lucide-react";
import { PageHeader, MetricCard, MetricGrid, Panel, EmptyState, ErrorState } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { api } from "@/lib/api/base";
import { tzDateTime } from "@/lib/app/business-logic";
import { fmtNumber, fmtPhone } from "@/lib/app/format";
import { useWorkspace } from "@/lib/app/workspace";
import type { BookingRequest, CalendarEvent, CallSummary } from "@/lib/shared";

// Foundation version of the dashboard: real numbers from the existing customer
// endpoints (/api/portal/<id>/calls and /bookings), so data visibly flows. The
// workspace area replaces it with Answered's full dashboard.
export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({ meta: [{ title: "Dashboard — Answered" }] }),
  component: Dashboard,
});

function Dashboard() {
  const ws = useWorkspace();
  const id = ws.businessId;
  const tz = ws.business?.timezone;
  const callsQ = useQuery({
    queryKey: ["portal", id, "calls"],
    enabled: !!id,
    queryFn: () => api.get<{ calls: CallSummary[]; receptionist: string }>(`/api/portal/${id}/calls`),
  });
  const bookingsQ = useQuery({
    queryKey: ["portal", id, "bookings"],
    enabled: !!id,
    queryFn: () => api.get<{ upcoming: CalendarEvent[]; requests: BookingRequest[] }>(`/api/portal/${id}/bookings`),
  });
  const calls = callsQ.data?.calls ?? [];
  const requests = bookingsQ.data?.requests ?? [];
  const followUps = requests.filter((r) => r.kind === "callback" && (r.stage ?? "new") === "new");
  const texts = calls.filter((c) => c.channel.startsWith("sms"));
  const receptionist = callsQ.data?.receptionist || ws.business?.receptionist_name || "Your receptionist";

  return (
    <div className="space-y-5" data-page="app-dashboard">
      <PageHeader title={ws.business?.name ?? "Dashboard"} description={`${receptionist} has been answering for ${ws.business?.name ?? "your business"}.`} />
      {callsQ.error ? <ErrorState message={(callsQ.error as Error).message} onRetry={() => void callsQ.refetch()} /> : null}
      <MetricGrid cols={4}>
        <MetricCard label="Calls and texts" value={fmtNumber(calls.length)} icon={PhoneCall} loading={callsQ.isPending} hint="Most recent 100" />
        <MetricCard label="Texts" value={fmtNumber(texts.length)} icon={MessageSquare} loading={callsQ.isPending} />
        <MetricCard label="Upcoming bookings" value={fmtNumber(bookingsQ.data?.upcoming.length ?? 0)} icon={CalendarDays} loading={bookingsQ.isPending} />
        <MetricCard label="New follow-ups" value={fmtNumber(followUps.length)} icon={UserRound} loading={bookingsQ.isPending} />
      </MetricGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Recent calls" padded={false}>
          {calls.length === 0 ? (
            <EmptyState compact title={callsQ.isPending ? "Loading…" : "No calls yet"} description="Calls appear here as soon as your receptionist answers them." />
          ) : (
            <ul className="divide-y divide-hairline" data-list="calls">
              {calls.slice(0, 8).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0 truncate font-medium text-ink">{c.from ? fmtPhone(c.from) : "Unknown caller"}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[12px] text-ink-muted">
                    <StatusBadge tone={c.channel.startsWith("sms") ? "info" : "neutral"}>{c.channel.startsWith("sms") ? "Text" : "Call"}</StatusBadge>
                    {tzDateTime(c.startedAt, tz)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Follow-ups and bookings" padded={false}>
          {requests.length === 0 ? (
            <EmptyState compact title={bookingsQ.isPending ? "Loading…" : "Nothing waiting"} description="Bookings and call-back requests show here." />
          ) : (
            <ul className="divide-y divide-hairline" data-list="requests">
              {requests.slice(0, 8).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{r.name || fmtPhone(r.phone) || "Caller"}</span>
                    <span className="block truncate text-[12px] text-ink-muted">{r.service}</span>
                  </span>
                  <StatusBadge tone={r.kind === "booking" ? "success" : "warning"}>{r.kind === "booking" ? "Booking" : "Call back"}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
