import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, ChevronRight, Loader2, Phone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EmptyState, ErrorState, KeyValue } from "@/components/app/primitives";
import { AppointmentBadge } from "@/components/app/StatusBadge";
import { CallDetailSheet } from "@/components/app/CallDetailSheet";
import { Field } from "@/components/app/forms";
import { fmtPhone } from "@/lib/app/format";
import { appointmentsQuery } from "@/lib/app/queries";
import { updateAppointment } from "@/lib/api/workspace";
import { addDayKey, bookingSourceLabel, tzDayKey, tzTime, tzWeekday } from "@/lib/app/business-logic";
import type { AppointmentRow } from "@/lib/app/types";
import { useWorkspace } from "@/lib/app/workspace";
import { cn } from "@/lib/utils";
import { OTHER_BRAND, PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/app/bookings")({
  validateSearch: (search: Record<string, unknown>): { booking?: string } => ({
    booking: typeof search["booking"] === "string" && search["booking"] ? String(search["booking"]) : undefined,
  }),
  head: () => ({
    meta: [{ title: OTHER_BRAND ? `Bookings | ${PRODUCT}` : "Bookings" }, { name: "description", content: "The appointments your receptionist has booked, day by day." }],
  }),
  component: BookingsPage,
});

type Appt = AppointmentRow;

function BookingsPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const q = useQuery(appointmentsQuery(ws.businessId));
  const canEdit = ws.access.canEdit;
  const tz = ws.business?.timezone ?? null;

  const [when, setWhen] = useState<"upcoming" | "past">("upcoming");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Appt | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [confirmCancel, setConfirmCancel] = useState<Appt | null>(null);

  const all = (q.data ?? []) as Appt[];

  // Deep link from Home or a call: open that exact booking once.
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
      const isUpcoming = t >= now - 60 * 60 * 1000 && a.status !== "cancelled";
      if (when === "upcoming" ? !isUpcoming : isUpcoming) return false;
      if (!s) return true;
      return [a.customer_name, a.customer_phone, a.customer_email, a.service, a.staff_name, a.reason].filter(Boolean).join(" ").toLowerCase().includes(s);
    });
    const dir = when === "upcoming" ? 1 : -1;
    return list.sort((a, b) => dir * (new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()));
  }, [all, search, when, now]);

  // Grouped by the business's own day.
  const days = useMemo(() => {
    const out: { key: string; label: string; items: Appt[] }[] = [];
    const today = tzDayKey(new Date(), tz);
    const tomorrow = addDayKey(today, 1);
    for (const a of rows) {
      const key = tzDayKey(a.starts_at, tz);
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: key === today ? "Today" : key === tomorrow ? "Tomorrow" : tzWeekday(a.starts_at, tz), items: [] };
        out.push(g);
      }
      g.items.push(a);
    }
    return out;
  }, [rows, tz]);

  const update = useMutation({
    // Saved on our record only: the time lives in the calendar, which we don't change.
    mutationFn: (input: { id: string; status?: "cancelled"; notes?: string }) => updateAppointment(ws.businessId!, input.id, { status: input.status, notes: input.notes }),
    onSuccess: (saved, input) => {
      toast.success(input.status ? "Booking cancelled" : "Notes saved", {
        description: input.status ? "If it's in your calendar, remove it there too. The customer hasn't been messaged." : undefined,
      });
      void qc.invalidateQueries({ queryKey: ["appointments", ws.businessId] });
      if (selected && selected.id === saved.id) setSelected(input.status ? null : saved);
      setConfirmCancel(null);
    },
    onError: (e) => toast.error("Couldn't update the booking", { description: e.message }),
  });

  const open = (a: Appt) => {
    setSelected(a);
    setNotes(a.notes ?? "");
  };
  const fromCalendar = (a: Appt) => a.id.startsWith("cal-");
  const canCancel = (a: Appt) => canEdit && !fromCalendar(a) && a.status !== "cancelled" && a.status !== "completed" && new Date(a.starts_at).getTime() >= now - 60 * 60 * 1000;

  return (
    <div className="space-y-4">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">Bookings</h1>

      {q.error ? <ErrorState message={q.error.message} onRetry={() => void q.refetch()} /> : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone or service" className="h-12 bg-white pl-10 text-[15px]" aria-label="Search bookings" />
      </div>

      <div role="radiogroup" aria-label="Show" className="flex gap-2">
        {(["upcoming", "past"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={when === v}
            data-when={v}
            onClick={() => setWhen(v)}
            className={cn("min-h-11 rounded-full border px-4 text-[14px] font-medium capitalize", when === v ? "border-indigo bg-indigo text-white" : "border-hairline bg-white text-ink-muted hover:text-ink")}
          >
            {v}
          </button>
        ))}
      </div>

      {q.isPending ? (
        <div className="panel h-40 animate-pulse" aria-busy />
      ) : days.length === 0 ? (
        <div className="panel">
          <EmptyState
            compact
            icon={CalendarDays}
            title={search.trim() ? "Nothing matches" : when === "upcoming" ? "No upcoming bookings" : "No past bookings"}
            description={search.trim() ? "Try a different name or service." : "Appointments your receptionist books will show up here."}
          />
        </div>
      ) : (
        <div className="space-y-4" data-bookings-list>
          {days.map((d) => (
            <section key={d.key} aria-label={d.label}>
              <h2 className="mb-1.5 px-1 text-[14px] font-semibold text-ink-muted" data-day>
                {d.label}
              </h2>
              <ul className="panel divide-y divide-hairline overflow-hidden">
                {d.items.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => open(a)} className="row-hover flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo">
                      <span className="w-[68px] shrink-0 text-[16px] font-semibold tabular-nums text-[var(--primary-ink)]">{tzTime(a.starts_at, tz)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-ink">{a.customer_name ?? "Unknown caller"}</span>
                        <span className="block truncate text-[13.5px] text-ink-muted">{[a.service, a.staff_name].filter(Boolean).join(" · ") || "Appointment"}</span>
                      </span>
                      {a.status !== "confirmed" ? <AppointmentBadge status={a.status} /> : null}
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {selected ? (
            <div className="space-y-5">
              <SheetHeader className="p-0 text-left">
                <div className="flex items-center gap-2">
                  <AppointmentBadge status={selected.status} />
                </div>
                <SheetTitle className="text-[20px]">{selected.service ?? "Appointment"}</SheetTitle>
                <SheetDescription className="text-[14px]">
                  {tzWeekday(selected.starts_at, tz)} at {tzTime(selected.starts_at, tz)}
                  {selected.ends_at ? ` to ${tzTime(selected.ends_at, tz)}` : ""}
                </SheetDescription>
              </SheetHeader>

              {selected.customer_phone ? (
                <Button asChild className="h-12 w-full text-[15px]">
                  <a href={`tel:${selected.customer_phone}`}>
                    <Phone className="mr-2 h-4 w-4" /> Call {selected.customer_name?.split(" ")[0] || "customer"}
                  </a>
                </Button>
              ) : null}

              <KeyValue
                columns={1}
                items={[
                  { label: "Customer", value: selected.customer_name ?? "Unknown" },
                  { label: "Phone", value: fmtPhone(selected.customer_phone) || "Not available", mono: true },
                  { label: "Email", value: selected.customer_email ?? "Not available" },
                  ...(selected.staff_name ? [{ label: "With", value: selected.staff_name }] : []),
                  ...(selected.reason ? [{ label: "Reason", value: selected.reason }] : []),
                  { label: "Booked by", value: bookingSourceLabel(selected.source) },
                ]}
              />

              {selected.call_id ? (
                <Button variant="outline" className="h-11 w-full" onClick={() => setCallId(selected.call_id)}>
                  Open the call that booked this
                </Button>
              ) : null}

              <Field label="Notes" htmlFor="appt-notes">
                <Textarea id="appt-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit || fromCalendar(selected)} placeholder="Anything the team should know before this appointment." />
                {canEdit && !fromCalendar(selected) && notes !== (selected.notes ?? "") ? (
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => update.mutate({ id: selected.id, notes })} disabled={update.isPending}>
                      {update.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Save notes
                    </Button>
                  </div>
                ) : null}
              </Field>

              {canCancel(selected) ? (
                <div className="space-y-2 border-t border-hairline pt-4" data-testid="booking-status-actions">
                  <p className="text-[13px] text-ink-muted">Need a different time? Call them to rearrange, then cancel this one and change your calendar.</p>
                  <Button variant="outline" className="h-11 w-full border-[#ffcfcb] text-[#a3231b] hover:bg-[#ffeceb]" onClick={() => setConfirmCancel(selected)} data-action="cancel-booking">
                    Cancel this booking
                  </Button>
                </div>
              ) : fromCalendar(selected) ? (
                <p className="text-[13px] text-ink-muted">This one was added straight to your calendar, so change it there.</p>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirmCancel} onOpenChange={(o) => !o && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCancel?.customer_name ?? "This booking"} on {confirmCancel ? `${tzWeekday(confirmCancel.starts_at, tz)} at ${tzTime(confirmCancel.starts_at, tz)}` : ""} will be marked cancelled here. We don't message the customer or change your calendar, so let them know and remove it from your calendar yourself.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmCancel && update.mutate({ id: confirmCancel.id, status: "cancelled" })} data-action="confirm-cancel-booking">
              Cancel booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CallDetailSheet callId={callId} onOpenChange={(o) => !o && setCallId(null)} linkPrefix="/app" />
    </div>
  );
}
