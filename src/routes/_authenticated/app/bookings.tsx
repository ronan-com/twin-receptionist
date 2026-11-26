import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, CalendarCheck, CalendarX, ChevronLeft, ChevronRight, Loader2, Phone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader, Panel, ErrorState, MetricCard, MetricGrid, KeyValue, Notice } from "@/components/app/primitives";
import { DataTable, TableToolbar, type Column } from "@/components/app/DataTable";
import { AppointmentBadge, IntegrationBadge, StatusBadge } from "@/components/app/StatusBadge";
import { CallDetailSheet } from "@/components/app/CallDetailSheet";
import { Field } from "@/components/app/forms";
import { APPOINTMENT_STATUSES, APPOINTMENT_STATUS_LABELS } from "@/lib/app/constants";
import { fmtDate, fmtNumber, fmtPhone, fmtRelative, humanize, initials } from "@/lib/app/format";
import { appointmentsQuery, integrationsQuery } from "@/lib/app/queries";
import { updateAppointment } from "@/lib/api/workspace";
import {
  aiBookings,
  bookingSourceLabel,
  bookingSync,
  calendarConnection,
  isAiBooking,
  tzStartOfDay,
  addDayKey,
  tzAbbrev,
  tzDate,
  tzDateTime,
  tzDayKey,
  tzTime,
} from "@/lib/app/business-logic";
import type { AppointmentRow, AppointmentStatus } from "@/lib/app/types";
import { useWorkspace } from "@/lib/app/workspace";
import { cn } from "@/lib/utils";
import { PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/app/bookings")({
  validateSearch: (search: Record<string, unknown>): { booking?: string } => ({
    booking: typeof search['booking'] === "string" && search['booking'] ? String(search['booking']) : undefined,
  }),
  head: () => ({
    meta: [
      { title: `Bookings | ${PRODUCT}` },
      { name: "description", content: "Every appointment your receptionist booked, with the call behind it and its calendar status." },
    ],
  }),
  component: BookingsPage,
});

type Appt = AppointmentRow;

const DAY = 86_400_000;
/** Monday 00:00 of the business week containing `d`, in the business timezone. */
function startOfBusinessWeek(d: Date, tz: string | null) {
  const key = tzDayKey(d, tz);
  const [y, m, day] = key.split("-").map(Number);
  const dow = (new Date(Date.UTC(y!, (m ?? 1) - 1, day ?? 1)).getUTCDay() + 6) % 7;
  return tzStartOfDay(addDayKey(key, -dow), tz);
}

function BookingsPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const q = useQuery(appointmentsQuery(ws.businessId));
  const integrationsQ = useQuery(integrationsQuery(ws.businessId));
  const canEdit = ws.access.canEdit;
  const tz = ws.business?.timezone ?? null;
  const calendar = useMemo(() => calendarConnection(integrationsQ.data), [integrationsQ.data]);

  const [view, setView] = useState<"list" | "week">("list");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AppointmentStatus | "all">("all");
  const [when, setWhen] = useState<"upcoming" | "past" | "all">("upcoming");
  const [weekStart, setWeekStart] = useState(() => startOfBusinessWeek(new Date(), ws.business?.timezone ?? null));
  const [selected, setSelected] = useState<Appt | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const all = (q.data ?? []) as Appt[];

  // Deep link from the dashboard attention inbox: open that exact booking once.
  const deepLinked = Route.useSearch().booking ?? null;
  const openedDeepLink = useRef(false);
  useEffect(() => {
    if (openedDeepLink.current || !deepLinked) return;
    const match = all.find((a) => a.id === deepLinked);
    if (!match) return;
    openedDeepLink.current = true;
    setSelected(match);
    setNotes(match.notes ?? "");
  }, [deepLinked, all]);

  const now = Date.now();

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = all.filter((a) => {
      const t = new Date(a.starts_at).getTime();
      if (when === "upcoming" && t < now - 60 * 60 * 1000) return false;
      if (when === "past" && t >= now) return false;
      if (status !== "all" && a.status !== status) return false;
      if (s) {
        const hay = [a.customer_name, a.customer_phone, a.customer_email, a.service, a.staff_name, a.reason].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
    return when === "past" ? list : [...list].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [all, search, status, when, now]);

  const stats = useMemo(() => {
    const upcoming = all.filter((a) => new Date(a.starts_at).getTime() >= now && a.status !== "cancelled");
    const thisWeek = all.filter((a) => {
      const t = new Date(a.starts_at).getTime();
      const ws0 = startOfBusinessWeek(new Date(), tz).getTime();
      return t >= ws0 && t < ws0 + 7 * DAY && a.status !== "cancelled";
    });
    const last30 = all.filter((a) => new Date(a.created_at).getTime() >= now - 30 * DAY);
    const byAi = aiBookings(last30).length;
    const noShow = all.filter((a) => a.status === "no_show").length;
    const done = all.filter((a) => a.status === "completed" || a.status === "no_show").length;
    return { upcoming: upcoming.length, thisWeek: thisWeek.length, byAi, last30: last30.length, noShowRate: done ? noShow / done : 0 };
  }, [all, now, tz]);

  const update = useMutation({
    // A status or notes change is saved on our record only (the server marks a synced
    // booking as changed locally). Times can't be moved here: they live in the calendar.
    mutationFn: (input: { id: string; status?: AppointmentStatus; notes?: string }) =>
      updateAppointment(ws.businessId!, input.id, { status: input.status, notes: input.notes }),
    onSuccess: (saved, input) => {
      toast.success(input.status ? `Marked ${APPOINTMENT_STATUS_LABELS[input.status].toLowerCase()}` : "Notes saved", {
        description: `This changes the ${PRODUCT} record only. No calendar invitation or message was sent, so check your calendar if this booking was in it.`,
      });
      void qc.invalidateQueries({ queryKey: ["appointments", ws.businessId] });
      if (selected && selected.id === saved.id) setSelected(saved);
    },
    onError: (e) => toast.error("Couldn't update booking", { description: e.message }),
  });

  const columns: Column<Appt>[] = [
    {
      key: "when",
      header: "When",
      cell: (a) => (
        <div className="whitespace-nowrap">
          <div className="font-medium">{tzDate(a.starts_at, tz)}</div>
          <div className="text-[12px] text-ink-muted">
            {tzTime(a.starts_at, tz)}
            {a.ends_at ? ` – ${tzTime(a.ends_at, tz)}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (a) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-canvas-2 text-[11px] font-semibold text-ink-muted">{initials(a.customer_name)}</span>
          <div className="min-w-0">
            <div className="truncate font-medium">{a.customer_name ?? "Unknown caller"}</div>
            <div className="truncate text-[12px] text-ink-muted">{fmtPhone(a.customer_phone) || a.customer_email || "Not available"}</div>
          </div>
        </div>
      ),
    },
    { key: "service", header: "Service", cell: (a) => <span className="text-ink">{a.service ?? "Not available"}</span>, hideBelow: "md" },
    { key: "staff", header: "With", cell: (a) => <span className="text-ink-muted">{a.staff_name ?? "Any"}</span>, hideBelow: "lg" },
    {
      key: "source",
      header: "Booked by",
      hideBelow: "lg",
      cell: (a) => (
        <StatusBadge tone={isAiBooking(a.source) ? "indigo" : "muted"}>{isAiBooking(a.source) ? "Receptionist" : humanize(a.source)}</StatusBadge>
      ),
    },
    {
      key: "sync",
      header: "Calendar",
      hideBelow: "xl",
      cell: (a) => {
        const sync = bookingSync(a, calendar);
        return (
          <StatusBadge tone={sync.state === "synced" ? "success" : sync.state === "failed" ? "danger" : sync.state === "pending" ? "warning" : "muted"}>{sync.label}</StatusBadge>
        );
      },
    },
    { key: "status", header: "Status", align: "right", cell: (a) => <AppointmentBadge status={a.status} /> },
  ];

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY)), [weekStart]);
  const weekAppts = useMemo(() => {
    const end = weekStart.getTime() + 7 * DAY;
    return all.filter((a) => {
      const t = new Date(a.starts_at).getTime();
      return t >= weekStart.getTime() && t < end;
    });
  }, [all, weekStart]);

  const openDetail = (a: Appt) => {
    setSelected(a);
    setNotes(a.notes ?? "");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={ws.business?.name}
        title="Bookings"
        description="Every appointment your receptionist has booked, synced with your calendar where connected."
        actions={
          <div className="flex items-center rounded-[6px] border border-hairline bg-white p-0.5">
            {(["list", "week"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn("rounded-[4px] px-3 py-1 text-[12.5px] font-medium capitalize transition-colors", view === v ? "bg-canvas-2 text-ink" : "text-ink-muted hover:text-ink")}
              >
                {v}
              </button>
            ))}
          </div>
        }
      />

      {q.error ? <ErrorState message={q.error.message} onRetry={() => void q.refetch()} /> : null}

      <MetricGrid cols={4}>
        <MetricCard label="Upcoming" value={fmtNumber(stats.upcoming)} icon={CalendarDays} loading={q.isPending} hint={`${fmtNumber(stats.thisWeek)} this week`} />
        <MetricCard label="AI bookings" value={fmtNumber(stats.byAi)} icon={CalendarCheck} loading={q.isPending} hint={`Booked by your receptionist, of ${fmtNumber(stats.last30)} in the last 30 days`} />
        <MetricCard label="No-show rate" value={`${Math.round(stats.noShowRate * 100)}%`} icon={CalendarX} loading={q.isPending} hint="Completed vs no-show" invert />
        <MetricCard
          label="Calendar account"
          value={calendar.connected ? "Connected" : calendar.errored ? "Needs attention" : "Not connected"}
          loading={q.isPending || integrationsQ.isPending}
          hint={calendar.primary?.display_name ?? "Connect Google or Outlook in Settings, Integrations"}
        />
      </MetricGrid>

      {view === "list" ? (
        <Panel padded={false}>
          <TableToolbar>
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone or service…" className="h-8 pl-8 text-[13px]" aria-label="Search bookings" />
            </div>
            <Select value={when} onValueChange={(v) => setWhen(v as typeof when)}>
              <SelectTrigger className="h-8 w-[130px] text-[12.5px]" aria-label="Time">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upcoming">Upcoming</SelectItem>
                <SelectItem value="past">Past</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as AppointmentStatus | "all")}>
              <SelectTrigger className="h-8 w-[140px] text-[12.5px]" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {APPOINTMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {APPOINTMENT_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-auto text-[12px] text-ink-muted">{fmtNumber(rows.length)} bookings</span>
          </TableToolbar>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(a) => a.id}
            loading={q.isPending}
            onRowClick={openDetail}
            empty={{
              icon: CalendarDays,
              title: all.length === 0 ? "No bookings yet" : "Nothing matches",
              description:
                all.length === 0
                  ? "Once your receptionist is live and booking is switched on, appointments appear here in real time."
                  : "Try widening the time range or clearing filters.",
            }}
          />
        </Panel>
      ) : (
        <Panel
          padded={false}
          title={`Week of ${fmtDate(weekStart)}`}
          actions={
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY))} aria-label="Previous week">
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setWeekStart(startOfBusinessWeek(new Date(), tz))}>
                Today
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY))} aria-label="Next week">
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          }
        >
          <div className="grid grid-cols-1 divide-y divide-hairline md:grid-cols-7 md:divide-x md:divide-y-0">
            {weekDays.map((d) => {
              const dayAppts = weekAppts
                .filter((a) => tzDayKey(a.starts_at, tz) === tzDayKey(d, tz))
                .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
              const isToday = tzDayKey(new Date(), tz) === tzDayKey(d, tz);
              return (
                <div key={d.toISOString()} className="min-h-[120px] md:min-h-[320px]">
                  <div className={cn("flex items-baseline justify-between border-b border-hairline px-3 py-2 text-[12px]", isToday ? "bg-[#f3f2ff]" : "bg-canvas-2")}>
                    <span className="font-semibold text-ink">{d.toLocaleDateString("en-AU", { weekday: "short" })}</span>
                    <span className={cn("tabular-nums", isToday ? "font-semibold text-indigo" : "text-ink-muted")}>{d.getDate()}</span>
                  </div>
                  <div className="space-y-1.5 p-2">
                    {dayAppts.length === 0 ? (
                      <div className="px-1 py-2 text-[11.5px] text-ink-muted/70">·</div>
                    ) : (
                      dayAppts.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => openDetail(a)}
                          className={cn(
                            "block w-full rounded-[4px] border-l-2 bg-white px-2 py-1.5 text-left text-[12px] shadow-[0_1px_0_rgba(6,27,49,0.04)] ring-1 ring-hairline transition-colors hover:bg-canvas-2",
                            a.status === "cancelled" ? "border-l-hairline opacity-60" : a.status === "confirmed" ? "border-l-indigo" : a.status === "pending" ? "border-l-[#f0a800]" : "border-l-[#1a9c5b]",
                          )}
                        >
                          <div className="font-medium tabular-nums text-ink">{tzTime(a.starts_at, tz)}</div>
                          <div className="truncate text-ink">{a.customer_name ?? "Unknown"}</div>
                          <div className="truncate text-ink-muted">{a.service ?? ""}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {selected ? (
            <div className="space-y-5">
              <SheetHeader className="p-0 text-left">
                <div className="flex items-center gap-2">
                  <AppointmentBadge status={selected.status} />
                  {selected.integration ? <IntegrationBadge status={selected.integration.status} /> : null}
                </div>
                <SheetTitle className="text-[18px]">{selected.service ?? "Appointment"}</SheetTitle>
                <SheetDescription>
                  {tzDateTime(selected.starts_at, tz)}
                  {selected.ends_at ? ` – ${tzTime(selected.ends_at, tz)}` : ""} ({tzAbbrev(selected.starts_at, tz)})
                </SheetDescription>
              </SheetHeader>

              <KeyValue
                columns={1}
                items={[
                  { label: "Customer", value: selected.customer_name ?? "Unknown" },
                  { label: "Phone", value: fmtPhone(selected.customer_phone) || "Not available", mono: true },
                  { label: "Email", value: selected.customer_email ?? "Not available" },
                  { label: "With", value: selected.staff_name ?? "Any available" },
                  { label: "Location", value: selected.location ?? ws.business?.name ?? "Not available" },
                  { label: "Reason", value: selected.reason ?? "Not available" },
                  { label: "Booked by", value: bookingSourceLabel(selected.source) },
                  { label: "Confirmation", value: APPOINTMENT_STATUS_LABELS[selected.status] },
                  { label: "Calendar account", value: calendar.connected ? (calendar.primary?.display_name ?? humanize(calendar.primary?.provider ?? "")) : "None connected" },
                  { label: "This booking", value: bookingSync(selected, calendar).label },
                  { label: "Created", value: fmtRelative(selected.created_at) },
                ]}
              />

              <Notice tone={bookingSync(selected, calendar).state === "failed" ? "danger" : "neutral"} title={bookingSync(selected, calendar).label}>
                {bookingSync(selected, calendar).detail}
                {calendar.primary?.last_error ? ` Last error: ${calendar.primary.last_error}` : ""}
              </Notice>

              {selected.call_id ? (
                <Button variant="outline" size="sm" className="w-full" onClick={() => setCallId(selected.call_id)}>
                  <Phone className="mr-1.5 h-3.5 w-3.5" /> Open the call that booked this
                </Button>
              ) : null}

              <Field label="Notes" htmlFor="appt-notes">
                <Textarea id="appt-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit || selected.id.startsWith("cal-")} placeholder="Anything the team should know before this appointment." />
                {canEdit && !selected.id.startsWith("cal-") && notes !== (selected.notes ?? "") ? (
                  <div className="flex justify-end">
                    <Button size="sm" className="h-7 text-[12px]" onClick={() => update.mutate({ id: selected.id, notes })} disabled={update.isPending}>
                      {update.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Save notes
                    </Button>
                  </div>
                ) : null}
              </Field>

              {canEdit ? (
                <div className="space-y-2">
                  <div className="text-[12.5px] font-medium text-ink">Update status</div>
                  <p className="text-[12px] text-ink-muted">
                    Local record only. {PRODUCT} does not change the appointment in your calendar and does not message the customer. To move the time, change it in your calendar.
                  </p>
                  {selected.id.startsWith("cal-") ? (
                    <p className="text-[12px] text-ink-muted">This appointment was added straight to the calendar, so change it there.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5" data-testid="booking-status-actions">
                      {APPOINTMENT_STATUSES.filter((s) => s !== selected.status).map((s) => (
                        <Button key={s} variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => update.mutate({ id: selected.id, status: s })} disabled={update.isPending}>
                          {APPOINTMENT_STATUS_LABELS[s]}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Notice tone="neutral">{ws.access.readOnlyReason}</Notice>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <CallDetailSheet callId={callId} onOpenChange={(o) => !o && setCallId(null)} linkPrefix="/app" />
    </div>
  );
}
