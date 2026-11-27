import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, CalendarCheck, Check, CheckCircle2, Copy, MessageSquare, PhoneIncoming, PhoneMissed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/app/primitives";
import { CallList } from "@/components/app/CallList";
import { CallDetailSheet } from "@/components/app/CallDetailSheet";
import { DashboardJourney } from "@/components/app/DashboardJourney";
import { TestCall } from "@/components/app/TestCall";
import { PauseControl } from "@/components/app/receptionist/PauseControl";
import type { ReceptionistRow } from "@/components/app/receptionist/model";
import "@/components/app/dashboard-overview.css";
import { fmtPhone, fmtRelative } from "@/lib/app/format";
import { resolveRange } from "@/lib/app/date-range";
import { computeKpis, isInRange } from "@/lib/app/metrics";
import { agentsQuery, integrationsQuery, phoneNumbersQuery } from "@/lib/app/queries";
import { useRangeMetrics } from "@/lib/app/use-metrics";
import { isFollowUpDone, tzDateTime } from "@/lib/app/business-logic";
import { updateLead } from "@/lib/api/workspace";
import { getCalendar } from "@/lib/api/clean";
import { useWorkspace } from "@/lib/app/workspace";
import { cn } from "@/lib/utils";
import { OTHER_BRAND, PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({
    meta: [{ title: OTHER_BRAND ? PRODUCT : "Your receptionist" }, { name: "description", content: "Is your receptionist on, what it did today, and what needs you." }],
  }),
  component: HomePage,
});

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

type Tone = "good" | "warn" | "off";
const TONE_STYLE: Record<Tone, { dot: string; ring: string; text: string }> = {
  good: { dot: "bg-[#1a9c5b]", ring: "border-l-[#1a9c5b]", text: "text-[#0b6142]" },
  warn: { dot: "bg-[#f0a800]", ring: "border-l-[#f0a800]", text: "text-[#7f4a00]" },
  off: { dot: "bg-[#8a97a8]", ring: "border-l-[#8a97a8]", text: "text-[#4a5b6e]" },
};

function HomePage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const tz = ws.business?.timezone ?? null;
  const range = useMemo(() => resolveRange("30d", tz), [tz]);
  const m = useRangeMetrics(ws.businessId, range);
  const agentsQ = useQuery(agentsQuery(ws.businessId));
  const numbersQ = useQuery(phoneNumbersQuery(ws.businessId));
  const integrationsQ = useQuery(integrationsQuery(ws.businessId));
  const approvals = useQuery({
    queryKey: ["calendar-pending", ws.businessId],
    enabled: !!ws.businessId,
    queryFn: async () => (await getCalendar(ws.businessId!, new Date(Date.now() - 86_400_000), new Date(Date.now() + 120 * 86_400_000))).filter((e) => e.status === "pending"),
  });
  const [period, setPeriod] = useState<"today" | "week">("today");
  const [openCall, setOpenCall] = useState<string | null>(null);
  const canEdit = ws.access.canEdit;

  const agent = (agentsQ.data?.[0] as ReceptionistRow | undefined) ?? null;
  const numbers = useMemo(() => (numbersQ.data ?? []).filter((n) => n.status === "active" && n.e164), [numbersQ.data]);
  const pending = (numbersQ.data ?? []).some((n) => n.status === "pending");
  const unhealthy = (numbersQ.data ?? []).some((n) => n.health && n.health !== "healthy");
  const integrationBroken = (integrationsQ.data ?? []).some((i) => i.status === "error");
  const isDemo = Boolean(ws.business?.is_demo);

  // The one sentence that matters.
  const status = useMemo((): { tone: Tone; title: string; detail: string } => {
    if (agentsQ.isPending || numbersQ.isPending) return { tone: "off", title: "Checking your receptionist…", detail: "" };
    if (!agent) return { tone: "warn", title: "Your receptionist needs attention", detail: "It isn't set up yet. Ask your agency to finish setting it up." };
    if (agent.paused_by === "agency") return { tone: "warn", title: "Your receptionist is paused", detail: "Your agency paused it. Get in touch with them to switch it back on." };
    if (agent.paused_by === "business") return { tone: "off", title: "Your receptionist is paused", detail: "Callers hear your pause message and it takes their details. Nothing is booked until you resume." };
    if (unhealthy) return { tone: "warn", title: "Your receptionist needs attention", detail: "Your phone number isn't connecting properly. Ask your agency to take a look." };
    if (agent.demo || isDemo) return { tone: "good", title: "Your receptionist is on", detail: "This is a test receptionist with sample calls. Nothing here reaches a real phone." };
    if (numbers.length > 0) return { tone: "good", title: "Your receptionist is on", detail: "Answering every call to the number below." };
    if (pending) return { tone: "warn", title: "Nearly there", detail: "Your phone number is being connected. It will start answering as soon as it's ready." };
    return { tone: "warn", title: "Your receptionist needs attention", detail: "It has no phone number yet. Ask your agency to connect one." };
  }, [agentsQ.isPending, numbersQ.isPending, agent, unhealthy, isDemo, numbers.length, pending]);
  const style = TONE_STYLE[status.tone];

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => toast.success("Number copied"),
      () => toast.error("Couldn't copy. Select the number and copy it by hand."),
    );
  };

  // Today / this week, from the same 30 days of data.
  const counts = useMemo(() => {
    const r = resolveRange(period === "today" ? "today" : "7d", tz);
    const calls = m.current.filter((c) => isInRange(c.started_at, r.from, r.to));
    const bookings = m.appointments.filter((a) => a.status !== "cancelled" && isInRange(a.created_at, r.from, r.to)).length;
    const messages = m.leads.filter((l) => isInRange(l.created_at, r.from, r.to)).length;
    return { answered: computeKpis(calls).answered, bookings, messages };
  }, [m.current, m.appointments, m.leads, period, tz]);

  // The to-do list: people to ring back, missed calls, and bookings just made.
  const todo = useMemo(() => {
    const now = Date.now();
    const DAY = 86_400_000;
    const messages = m.leads
      .filter((l) => l.stage !== "won" && l.stage !== "lost" && !isFollowUpDone(l.follow_up_status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const missed = m.current.filter((c) => (c.status === "missed" || c.status === "failed") && c.direction === "inbound" && now - Date.parse(c.started_at) < 3 * DAY);
    const bookings = m.appointments
      .filter((a) => (a.status === "confirmed" || a.status === "pending") && Date.parse(a.starts_at) >= now && now - Date.parse(a.created_at) < 3 * DAY)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return { messages, missed, bookings };
  }, [m.leads, m.current, m.appointments]);
  const todoCount = todo.messages.length + todo.missed.length + todo.bookings.length;

  const done = useMutation({
    mutationFn: (id: string) => updateLead(ws.businessId!, id, { follow_up_status: "done" }),
    onSuccess: () => {
      toast.success("Marked as done");
      void qc.invalidateQueries({ queryKey: ["leads", ws.businessId] });
    },
    onError: (e: Error) => toast.error("Couldn't update that", { description: e.message }),
  });

  const firstName = (ws.profile?.full_name ?? ws.user?.email ?? "").split(/[\s@]/)[0];
  const canTest = canEdit && !!agent && !agent.demo && !isDemo && !agent.paused_by && !!agent.provider_agent_id;
  const loading = m.loading;

  return (
    <div className="client-overview space-y-5">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">
        {greeting()}
        {firstName ? `, ${firstName}` : ""}
      </h1>

      {m.error ? <ErrorState message={m.error} onRetry={m.refetch} /> : null}
      {ws.isGuestDemo && isDemo ? <DashboardJourney /> : null}

      {/* 1. Is it on? */}
      <section data-home-status className={cn("panel overflow-hidden border-l-4 p-4 sm:p-5", style.ring)}>
        <div className="flex items-center gap-3">
          <span className={cn("h-3.5 w-3.5 shrink-0 rounded-full", style.dot)} aria-hidden />
          <h2 data-status-title className={cn("text-[20px] font-semibold leading-tight tracking-[-0.02em] sm:text-[24px]", style.text)}>
            {status.title}
          </h2>
        </div>
        {status.detail ? <p className="mt-1.5 text-[14px] leading-5 text-ink-muted">{status.detail}</p> : null}

        {numbers.length > 0 ? (
          <div className="mt-4">
            <div className="text-[12px] font-medium text-ink-muted">Your receptionist's number</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {numbers.slice(0, 3).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => copy(n.e164)}
                  data-copy-number
                  aria-label={`Copy ${fmtPhone(n.e164)}`}
                  className="inline-flex min-h-12 items-center gap-2.5 rounded-[10px] border border-hairline bg-canvas-2 px-4 text-[20px] font-semibold tabular-nums tracking-tight text-ink hover:bg-white focus-visible:outline-indigo"
                >
                  {fmtPhone(n.e164)}
                  <Copy className="h-4 w-4 text-ink-muted" />
                </button>
              ))}
              {numbers.length > 3 ? <span className="self-center text-[13px] text-ink-muted">+{numbers.length - 3} more</span> : null}
            </div>
            <p className="mt-1.5 text-[12.5px] text-ink-muted">Tap to copy. Share it, or forward your calls to it.</p>
          </div>
        ) : null}

        {agent?.paused_by === "business" && canEdit ? (
          <div className="mt-4">
            <PauseControl businessId={ws.businessId!} agent={agent} blockedReason={null} onDone={() => qc.invalidateQueries({ queryKey: ["agents", ws.businessId] })} />
          </div>
        ) : null}
        {canTest && agent?.provider_agent_id ? (
          <div className="mt-4">
            <TestCall assistantId={agent.provider_agent_id} provider={agent.provider ?? undefined} clientId={ws.businessId!} big />
          </div>
        ) : null}
      </section>

      {/* 2. Three numbers */}
      <section aria-label="How it's going">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-ink">What your AI did {period === "today" ? "today" : "this week"}</h2>
          <div role="radiogroup" aria-label="Period" className="inline-flex rounded-full border border-hairline bg-white p-0.5">
            {([["today", "Today"], ["week", "This week"]] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={period === v}
                onClick={() => setPeriod(v)}
                className={cn("min-h-9 rounded-full px-3.5 text-[13px] font-medium", period === v ? "bg-indigo text-white" : "text-ink-muted hover:text-ink")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2.5 sm:gap-3" data-home-numbers>
          {(
            [
              { label: "Calls answered", value: counts.answered, icon: PhoneIncoming, to: "/app/inbox" },
              { label: "Bookings made", value: counts.bookings, icon: CalendarCheck, to: "/app/calendar" },
              { label: "Messages for you", value: counts.messages, icon: MessageSquare, to: "/app/contacts" },
            ] as const
          ).map((t) => (
            <Link key={t.label} to={t.to} className="panel flex flex-col items-start gap-1 p-3 outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-indigo sm:p-4">
              <t.icon className="h-[18px] w-[18px] text-[var(--primary-ink)]" strokeWidth={1.9} />
              <span className="text-[34px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-ink sm:text-[40px]">{loading ? "–" : t.value}</span>
              <span className="text-[12.5px] font-medium leading-4 text-ink-muted sm:text-[13.5px]">{t.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {(approvals.data ?? []).length > 0 ? (
        <Link to="/app/calendar" data-home-approvals className="flex items-center justify-between gap-3 rounded-xl border border-indigo/30 bg-indigo/5 px-4 py-3.5 outline-none hover:bg-indigo/10">
          <span className="text-[15px] font-semibold text-ink">
            {approvals.data!.length} booking{approvals.data!.length === 1 ? "" : "s"} waiting for your approval
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" />
        </Link>
      ) : null}

      {/* 3. The to-do list */}
      <section data-home-attention aria-label="Needs your attention" className="panel overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3.5">
          <h2 className="text-[16px] font-semibold text-ink">Needs your attention</h2>
          {todoCount > 0 ? <span className="rounded-full bg-[#fff3dc] px-2.5 py-0.5 text-[12.5px] font-semibold tabular-nums text-[#7f4a00]">{todoCount}</span> : null}
        </header>
        {loading ? (
          <p className="p-4 text-[14px] text-ink-muted">Loading…</p>
        ) : todoCount === 0 && !integrationBroken ? (
          <div className="flex items-center gap-3 p-4 sm:p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e3f7ee] text-[#0b6142]">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[15px] font-semibold text-ink">You're all caught up</p>
              <p className="text-[13.5px] text-ink-muted">Messages to return and new bookings will show up here.</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {todo.messages.slice(0, 5).map((l) => (
              <li key={l.id} data-todo="message" className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <Link to="/app/leads" search={{ lead: l.id }} className="min-w-0 outline-none">
                  <span className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                    <MessageSquare className="h-4 w-4 shrink-0 text-magenta" /> {l.name ?? "Someone"} left a message
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[13.5px] leading-5 text-ink-muted">{l.enquiry ?? l.intent ?? l.summary ?? "No details captured."}</span>
                  <span className="mt-0.5 block text-[12px] text-ink-muted">{fmtRelative(l.created_at)}</span>
                </Link>
                <div className="flex shrink-0 gap-2">
                  {l.phone ? (
                    <Button asChild className="h-11 flex-1 sm:flex-none">
                      <a href={`tel:${l.phone}`}>Call back</a>
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <Button variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => done.mutate(l.id)} disabled={done.isPending && done.variables === l.id}>
                      <Check className="mr-1.5 h-4 w-4" /> Done
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
            {todo.missed.slice(0, 3).map((c) => (
              <li key={c.id} data-todo="missed" className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={() => setOpenCall(c.id)} className="min-w-0 text-left outline-none">
                  <span className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                    <PhoneMissed className="h-4 w-4 shrink-0 text-coral" /> Missed call from {c.contact?.full_name || fmtPhone(c.from_number) || "an unknown number"}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-ink-muted">{fmtRelative(c.started_at)}</span>
                </button>
                {c.from_number ? (
                  <Button asChild className="h-11 shrink-0">
                    <a href={`tel:${c.from_number}`}>Call back</a>
                  </Button>
                ) : null}
              </li>
            ))}
            {todo.bookings.slice(0, 3).map((a) => (
              <li key={a.id} data-todo="booking">
                <Link to="/app/bookings" search={{ booking: a.id }} className="row-hover flex items-center justify-between gap-3 px-4 py-3.5 outline-none">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                      <CalendarCheck className="h-4 w-4 shrink-0 text-cyan" /> New booking: {a.customer_name || "Customer"}
                    </span>
                    <span className="mt-0.5 block text-[13.5px] text-ink-muted">
                      {a.service || "Appointment"} · {tzDateTime(a.starts_at, tz)}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" />
                </Link>
              </li>
            ))}
            {integrationBroken ? (
              <li data-todo="sync" className="px-4 py-3.5">
                <p className="text-[15px] font-semibold text-ink">A connected app isn't syncing</p>
                <p className="text-[13.5px] text-ink-muted">New bookings may not be reaching your calendar. Ask your agency to take a look.</p>
              </li>
            ) : null}
          </ul>
        )}
        {todo.messages.length > 5 ? (
          <Link to="/app/leads" className="flex min-h-12 items-center justify-center gap-1.5 border-t border-hairline text-[14px] font-semibold text-[var(--primary-ink)] hover:bg-canvas-2">
            See all {todo.messages.length} messages <ArrowRight className="h-4 w-4" />
          </Link>
        ) : null}
      </section>

      {/* 4. Recent calls */}
      <section className="panel overview-calls overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3.5">
          <h2 className="text-[16px] font-semibold text-ink">Recent calls</h2>
          <Link to="/app/inbox" className="inline-flex min-h-10 items-center gap-1 text-[14px] font-semibold text-[var(--primary-ink)]">
            See all <ArrowRight className="h-4 w-4" />
          </Link>
        </header>
        <CallList rows={m.current.slice(0, 5)} loading={m.loading} onOpen={setOpenCall} selectedId={openCall} timezone={tz} pageSize={5} />
      </section>

      <CallDetailSheet callId={openCall} onOpenChange={(o) => !o && setOpenCall(null)} />
    </div>
  );
}
