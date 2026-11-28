import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Apple, Ban, CalendarCheck, CalendarDays, CalendarPlus, CheckCircle2, ChevronRight, Loader2, Mail, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/app/forms";
import { StatusBadge } from "@/components/app/StatusBadge";
import type { Hue } from "@/components/app/hues";
import { LinkBox } from "@/routes/_authenticated/admin/-shared";
import { calendarSignInUrl, changeCalendar, getCalendarFeed, newCalendarFeed, removeCalendar, setUpCalendar, stopCalendarFeed, testCalendar, type CalendarFeed } from "@/lib/api/manage";
import type { Integration } from "@/lib/app/types";
import { SetItUp, useSignIn, type SignInProvider } from "./SignInSetup";

// Bookings on one screen: the built-in calendar (on from the start, nothing to set up), the same bookings
// shown in the business's own calendar app (a private link), and, if they want their own appointments to
// block times, Google Calendar or Outlook. Everything else is under Advanced.

export const CALENDARS = ["builtin_calendar", "google_calendar", "microsoft_calendar"];
const LENGTHS = [15, 20, 30, 45, 60, 90];
const NAMES = { google: "Google Calendar", microsoft: "Outlook" } as const;
const cfg = (i?: Integration | null) => (i?.config && typeof i.config === "object" && !Array.isArray(i.config) ? (i.config as Record<string, unknown>) : {});

function Card({ icon: Icon, hue, title, sub, side, children, ...data }: { icon: LucideIcon; hue: Hue; title: string; sub: ReactNode; side?: ReactNode; children?: ReactNode; "data-card": string; "data-provider"?: string }) {
  return (
    <section className="panel space-y-4 p-4 sm:p-5" {...data}>
      <div className="flex items-start gap-3">
        <span data-hue={hue} className="hue-icon grid h-12 w-12 shrink-0 place-items-center rounded-[12px]" aria-hidden>
          <Icon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-[13px] leading-5 text-ink-muted [overflow-wrap:anywhere]">{sub}</p>
        </div>
        {side}
      </div>
      {children}
    </section>
  );
}

export function BookingSetup({
  businessId,
  calendar,
  loading,
  canEdit,
  embedded,
  onChanged,
  advanced,
}: {
  businessId: string;
  calendar: Integration | null;
  loading: boolean;
  canEdit: boolean;
  /** In the agency's receptionist editor: Google/Microsoft send the browser back there. */
  embedded: boolean;
  onChanged: (list?: Integration[]) => void;
  /** More things for the Advanced section. */
  advanced?: ReactNode;
}) {
  const c = cfg(calendar);
  const linked: SignInProvider | null = calendar?.provider === "google_calendar" ? "google" : calendar?.provider === "microsoft_calendar" ? "microsoft" : null;
  const saved = {
    minutes: String(c["default_duration"] ?? 30),
    email: String((linked ? c["notify_email"] : c["account_email"]) ?? ""),
    enabled: c["enabled"] !== false,
  };
  const [minutes, setMinutes] = useState(saved.minutes);
  const [email, setEmail] = useState(saved.email);
  useEffect(() => setMinutes(saved.minutes), [saved.minutes]);
  useEffect(() => setEmail(saved.email), [saved.email]);
  const [testResult, setTestResult] = useState("");
  const signIn = useSignIn(businessId);
  const goSignIn = (p: SignInProvider) => window.location.assign(calendarSignInUrl(businessId, p, embedded ? "editor" : undefined));

  const run = useMutation({
    mutationFn: async (a: { do: "on" } | { do: "save" } | { do: "switch"; enabled: boolean } | { do: "connect"; provider: SignInProvider } | { do: "disconnect" } | { do: "test" }) => {
      if (a.do === "on") return (await setUpCalendar(businessId, { provider: "builtin", minutes: 0 })).integrations;
      if (a.do === "save") return (await changeCalendar(businessId, { minutes: Number(minutes), notifyEmail: email.trim() })).integrations;
      if (a.do === "switch") return (await changeCalendar(businessId, { enabled: a.enabled })).integrations;
      if (a.do === "disconnect") return (await removeCalendar(businessId)).integrations;
      if (a.do === "test") {
        const r = await testCalendar(businessId);
        const slots = Array.isArray(r.result?.slots) ? (r.result.slots as { time?: string }[]) : [];
        setTestResult(r.result?.error ?? (slots.length ? `${r.result.day}: ${slots.slice(0, 4).map((s) => s.time).join(", ")}${slots.length > 4 ? "…" : ""} are free.` : (r.result?.message ?? "No free times.")));
        return undefined;
      }
      // Connect: bookings stay in the built-in calendar until the sign-in has worked.
      if (!calendar) onChanged((await setUpCalendar(businessId, { provider: "builtin", minutes: 0 })).integrations);
      goSignIn(a.provider);
      return undefined;
    },
    onSuccess: (list, a) => {
      if (a.do === "test" || a.do === "connect") return;
      toast.success(a.do === "disconnect" ? "Disconnected. Bookings carry on in the built-in calendar." : a.do === "save" ? "Saved" : a.do === "on" || a.enabled ? "Bookings are on" : "Bookings are off");
      onChanged(list);
    },
    onError: (e: Error) => toast.error("That didn't work", { description: e.message }),
  });
  const busy = run.isPending;
  const dirty = minutes !== saved.minutes || email.trim() !== saved.email;

  return (
    <div className="space-y-4" data-section="booking">
      <Card
        data-card="bookings"
        data-provider="builtin_calendar"
        icon={CalendarCheck}
        hue="green"
        title="Bookings"
        sub={
          loading
            ? "Loading…"
            : !calendar
              ? "Off. Turn them on and callers can book straight away. Nothing to set up."
              : !saved.enabled
                ? "Off. Callers leave a message instead."
                : linked
                  ? calendar.status === "connected"
                    ? `On. Bookings go into ${NAMES[linked]}.`
                    : `Sign in to ${NAMES[linked]} below to finish.`
                  : "On. Built-in calendar: works now, nothing to set up. Open times are your opening hours."
        }
        side={calendar ? <Switch checked={saved.enabled} disabled={!canEdit || busy} onCheckedChange={(v) => run.mutate({ do: "switch", enabled: v })} aria-label="Take bookings" data-action="take-bookings" /> : null}
      >
        {loading ? null : !calendar ? (
          <Button className="h-11 w-full gap-2 sm:w-auto sm:px-8" disabled={!canEdit || busy} onClick={() => run.mutate({ do: "on" })} data-action="turn-on">
            <CalendarCheck className="h-4 w-4" /> Turn on bookings
          </Button>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate({ do: "save" });
            }}
          >
            <Field label="Appointment length" htmlFor="cal-min">
              <Select value={minutes} onValueChange={setMinutes} disabled={!canEdit}>
                <SelectTrigger id="cal-min" className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{LENGTHS.map((m) => <SelectItem key={m} value={String(m)}>{m} minutes</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Email me each booking (optional)" htmlFor="cal-email">
              <Input id="cal-email" type="email" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canEdit} placeholder="reception@yourbusiness.com" />
            </Field>
            <Button type="submit" className="h-10 px-6" disabled={!canEdit || busy || !dirty} data-action="save-booking">Save</Button>
          </form>
        )}
      </Card>

      {calendar && !linked && canEdit ? <FeedCard businessId={businessId} /> : null}

      <Card data-card="calendar-connect" icon={Ban} hue="amber" title="Block your busy times" sub="Connect your calendar so nobody gets booked over your own appointments. Optional.">
        <div className="grid gap-3 lg:grid-cols-2">
          {(["google", "microsoft"] as const).map((p) => {
            const mine = linked === p;
            const available = signIn.data ? signIn.data.calendar[p] : Boolean(signIn.error);
            const other = linked && !mine ? linked : null;
            const status = mine ? calendar!.status : null;
            const button = (label: string) => (
              <Button className="h-11 gap-2 px-6" disabled={!canEdit || busy || signIn.isPending} onClick={() => run.mutate({ do: "connect", provider: p })} data-connect={p}>
                {busy && run.variables?.do === "connect" && run.variables.provider === p ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} {label}
              </Button>
            );
            return (
              <div key={p} className="flex flex-col gap-3 rounded-[10px] border border-hairline p-3.5" data-provider={`${p}_calendar`} data-state={status ?? (available ? "available" : "not-set-up")}>
                <div className="flex items-center gap-2.5">
                  <span data-hue={p === "google" ? "coral" : "sky"} className="hue-icon grid h-10 w-10 shrink-0 place-items-center rounded-[10px]" aria-hidden>
                    <CalendarDays className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-ink">{NAMES[p]}</div>
                    {mine && status === "connected" ? <div className="truncate text-[12px] text-ink-muted">{String(c["account_email"] ?? "")}</div> : null}
                  </div>
                  {status === "connected" ? <StatusBadge tone="success" dot>Connected</StatusBadge> : status === "error" ? <StatusBadge tone="danger" dot>Needs attention</StatusBadge> : null}
                </div>
                {status === "error" && calendar?.last_error ? <p role="alert" className="text-[12.5px] text-[#a41d1d] [overflow-wrap:anywhere]">{calendar.last_error}</p> : null}
                {!canEdit ? null : other ? (
                  <p className="text-[13px] text-ink-muted">Disconnect {NAMES[other]} first.</p>
                ) : mine ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {status === "connected" ? null : available ? button(status === "error" ? "Sign in again" : "Sign in") : <SetItUp provider={p} />}
                    <Button variant="ghost" className="h-11 text-[#a41d1d] hover:bg-[#fff7f7] hover:text-[#a41d1d]" disabled={busy} onClick={() => run.mutate({ do: "disconnect" })} data-action="disconnect">Disconnect</Button>
                  </div>
                ) : available || signIn.isPending ? (
                  <div>{button(`Connect ${NAMES[p]}`)}</div>
                ) : (
                  <SetItUp provider={p} />
                )}
              </div>
            );
          })}
        </div>
        {!canEdit ? <p className="text-[13px] text-ink-muted">Your access is view only.</p> : null}
      </Card>

      <details className="panel group px-4 py-3" data-advanced>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] font-semibold text-ink">
          <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" /> Advanced
        </summary>
        <div className="mt-3 space-y-3">
          {calendar ? (
            <div className="space-y-2">
              <Button size="sm" variant="outline" onClick={() => run.mutate({ do: "test" })} disabled={!canEdit || busy}>Check free times</Button>
              {testResult ? <p className="text-[12px] text-ink-muted" data-testid="calendar-test">{testResult}</p> : null}
            </div>
          ) : null}
          {advanced}
        </div>
      </details>
    </div>
  );
}

/** The addresses each calendar app opens to subscribe to a feed. */
export function feedLinks(url: string) {
  const webcal = url.replace(/^https?:/, "webcal:");
  const outlook = `calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=Bookings`;
  return {
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
    apple: webcal,
    outlookWork: `https://outlook.office.com/${outlook}`,
    outlookPersonal: `https://outlook.live.com/${outlook}`,
  };
}

function FeedCard({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const key = ["calendar-feed", businessId];
  const q = useQuery({ queryKey: key, queryFn: () => getCalendarFeed(businessId), staleTime: 60_000, retry: false });
  const change = useMutation({
    mutationFn: (a: "new" | "off") => (a === "new" ? newCalendarFeed(businessId) : stopCalendarFeed(businessId)),
    onSuccess: (d: CalendarFeed, a) => {
      qc.setQueryData(key, d);
      toast.success(a === "new" ? "New link ready. Any old one has stopped working." : "Link switched off");
    },
    onError: (e: Error) => toast.error("That didn't work", { description: e.message }),
  });
  if (q.data && !q.data.allowed) return null;
  const url = q.data?.url ?? "";
  const l = feedLinks(url);
  const big = "h-12 justify-center gap-2 text-[13.5px]";
  return (
    <Card data-card="calendar-feed" icon={CalendarPlus} hue="indigo" title="See bookings in your own calendar" sub="Shows bookings in your calendar app. It doesn't block your busy times (that's the next box).">
      {q.isPending ? (
        <p className="text-[13px] text-ink-muted">Loading…</p>
      ) : q.error ? (
        <p role="alert" className="text-[13px] text-[#a41d1d]">{(q.error as Error).message}</p>
      ) : !url ? (
        <Button className="h-11 px-6" disabled={change.isPending} onClick={() => change.mutate("new")} data-action="feed-on">Turn on the calendar link</Button>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button asChild variant="outline" className={big}>
              <a href={l.google} target="_blank" rel="noreferrer noopener" data-add="google"><CalendarDays className="h-5 w-5" /> Add to Google Calendar</a>
            </Button>
            <Button asChild variant="outline" className={big}>
              <a href={l.apple} data-add="apple"><Apple className="h-5 w-5" /> Add to Apple Calendar</a>
            </Button>
            <Button asChild variant="outline" className={big}>
              <a href={l.outlookWork} target="_blank" rel="noreferrer noopener" data-add="outlook"><Mail className="h-5 w-5" /> Add to Outlook</a>
            </Button>
          </div>
          <LinkBox url={url} label="Private calendar link" />
          <p className="flex items-start gap-1.5 text-[12px] leading-4 text-ink-muted">
            <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>No keys needed. New bookings can take a few hours to appear (Google: up to a day). Anyone with this link can see the bookings.</span>
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            <a href={l.outlookPersonal} target="_blank" rel="noreferrer noopener" className="text-indigo hover:underline" data-add="outlook-personal">Outlook.com or Hotmail? Add it here</a>
            <button type="button" className="text-ink-muted hover:text-ink hover:underline" disabled={change.isPending} onClick={() => window.confirm("Make a new link? Calendars using the old one stop updating.") && change.mutate("new")} data-action="feed-reset">New link</button>
            <button type="button" className="text-ink-muted hover:text-ink hover:underline" disabled={change.isPending} onClick={() => window.confirm("Switch the link off? Calendars using it stop updating.") && change.mutate("off")} data-action="feed-off">Switch off</button>
          </div>
        </>
      )}
    </Card>
  );
}
