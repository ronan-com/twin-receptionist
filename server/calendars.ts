import type { BookingProvider, Business, CalendarEvent, CalendarLink } from "../src/lib/shared";
import { iso, sql } from "./db";
import { accessToken, type SignInResult } from "./oauth";
import { ValidationError } from "./prompt";
import { seal, unseal } from "./secrets";

// The calendars a receptionist can book into, all spoken to directly:
//   builtin   - kept in this app's database; nothing to connect
//   google    - Google Calendar API (freeBusy + events.insert) on the primary calendar
//   microsoft - Microsoft Graph (calendarView + events) on the default calendar
// Each answers the same two questions: when is it busy, and book this.

export class CalendarError extends Error {
  // The calendar service's HTTP status, when it answered with one.
  status?: number;
}

export type Busy = { start: number; end: number };
export type NewEvent = { start: number; end: number; title: string; description: string };

const TIMEOUT = 8000;

export const providerOf = (client: Business): BookingProvider =>
  (client.booking?.provider as string) === "demo" ? "builtin" : (client.booking?.provider ?? "builtin");

// ---- Connected Google / Microsoft calendars ----

type LinkRow = { provider: "google" | "microsoft"; account: string; secret: string; calendar_id: string; last_error: string; connected_at: Date };

async function linkFor(clientId: string): Promise<LinkRow | null> {
  const [r] = await sql`select * from calendar_links where client_id = ${clientId}`;
  return (r as LinkRow) ?? null;
}

export async function calendarLink(clientId: string): Promise<CalendarLink | null> {
  const r = await linkFor(clientId);
  return r ? { provider: r.provider, account: r.account, lastError: r.last_error, connectedAt: iso(r.connected_at) } : null;
}

export async function disconnectCalendar(clientId: string): Promise<void> {
  await sql`delete from calendar_links where client_id = ${clientId}`;
}

async function noteError(clientId: string, message: string): Promise<void> {
  await sql`update calendar_links set last_error = ${message.slice(0, 300)} where client_id = ${clientId}`;
}

async function tokenFor(clientId: string, link: LinkRow): Promise<string> {
  try {
    return await accessToken(link.provider, "calendar", unseal(link.secret), (next) => {
      // Keep the new one on the row in hand too: while connecting, it isn't saved yet.
      link.secret = seal(next);
      sql`update calendar_links set secret = ${link.secret} where client_id = ${clientId}`.catch(() => {});
    });
  } catch (err) {
    const message = (err as Error).message;
    await noteError(clientId, message);
    throw new CalendarError(message);
  }
}

// One call to Google or Microsoft, with a short timeout and a plain error.
async function call(clientId: string, link: LinkRow, method: string, url: string, body?: unknown): Promise<any> {
  const token = await tokenFor(clientId, link);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        // Graph: give times back in UTC.
        ...(link.provider === "microsoft" ? { Prefer: 'outlook.timezone="UTC"' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch {
    throw new CalendarError(`${link.provider === "google" ? "Google" : "Outlook"} Calendar didn't answer in time.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message ?? data?.error_description ?? `error ${res.status}`;
    const message = `${link.provider === "google" ? "Google" : "Outlook"} Calendar refused the request (${detail}).`;
    await noteError(clientId, message);
    throw Object.assign(new CalendarError(message), { status: res.status });
  }
  return data;
}

const GOOGLE = "https://www.googleapis.com/calendar/v3";
const GRAPH = "https://graph.microsoft.com/v1.0";
// Graph wants "2026-11-24T09:00:00" with the zone given separately.
const graphTime = (at: number) => ({ dateTime: new Date(at).toISOString().slice(0, 19), timeZone: "UTC" });
const fromGraph = (t: { dateTime?: string }) => Date.parse(`${String(t?.dateTime ?? "").replace(/Z$/, "")}Z`);

async function linkedBusy(clientId: string, link: LinkRow, from: number, to: number): Promise<Busy[]> {
  if (link.provider === "google") {
    const data = await call(clientId, link, "POST", `${GOOGLE}/freeBusy`, {
      timeMin: new Date(from).toISOString(),
      timeMax: new Date(to).toISOString(),
      items: [{ id: link.calendar_id }],
    });
    const cal = data?.calendars?.[link.calendar_id];
    if (cal?.errors?.length) throw new CalendarError(`Google Calendar couldn't share free times (${cal.errors[0].reason}).`);
    return (cal?.busy ?? []).map((b: any) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
  }
  const params = new URLSearchParams({
    startDateTime: new Date(from).toISOString(),
    endDateTime: new Date(to).toISOString(),
    $select: "showAs,start,end,isCancelled",
    $top: "250",
  });
  const data = await call(clientId, link, "GET", `${GRAPH}/me/calendarView?${params}`);
  return (data?.value ?? [])
    .filter((e: any) => !e.isCancelled && e.showAs !== "free" && e.showAs !== "workingElsewhere")
    .map((e: any) => ({ start: fromGraph(e.start), end: fromGraph(e.end) }));
}

async function linkedBook(clientId: string, link: LinkRow, ev: NewEvent): Promise<string> {
  if (link.provider === "google") {
    const data = await call(clientId, link, "POST", `${GOOGLE}/calendars/${encodeURIComponent(link.calendar_id)}/events`, {
      summary: ev.title,
      description: ev.description,
      start: { dateTime: new Date(ev.start).toISOString() },
      end: { dateTime: new Date(ev.end).toISOString() },
    });
    return String(data?.id ?? "");
  }
  const data = await call(clientId, link, "POST", `${GRAPH}/me/events`, {
    subject: ev.title,
    body: { contentType: "text", content: ev.description },
    start: graphTime(ev.start),
    end: graphTime(ev.end),
    showAs: "busy",
  });
  return String(data?.id ?? "");
}

// Saves a calendar sign-in, after checking the calendar really answers.
export async function connectCalendar(clientId: string, result: SignInResult): Promise<void> {
  const row: LinkRow = {
    provider: result.provider,
    account: result.address,
    secret: seal(result.refreshToken),
    calendar_id: "primary",
    last_error: "",
    connected_at: new Date(),
  };
  // Microsoft's default calendar needs no id; "primary" is only used for Google.
  await linkedBusy(clientId, row, Date.now(), Date.now() + 86_400_000).catch((err) => {
    throw new ValidationError(`Signed in as ${result.address}, but the calendar wouldn't open: ${(err as Error).message}`);
  });
  await sql`
    insert into calendar_links (client_id, provider, account, secret, calendar_id)
    values (${clientId}, ${row.provider}, ${row.account}, ${row.secret}, ${row.calendar_id})
    on conflict (client_id) do update set provider = excluded.provider, account = excluded.account,
      secret = excluded.secret, calendar_id = excluded.calendar_id, last_error = '', connected_at = now()`;
}

// ---- What booking asks of any calendar ----

function linkedOrFail(client: Business, link: LinkRow | null): LinkRow {
  const wanted = providerOf(client);
  if (!link || link.provider !== wanted) {
    throw new CalendarError(`The ${wanted === "google" ? "Google" : "Outlook"} calendar isn't connected yet.`);
  }
  return link;
}

async function ownBusy(clientId: string, from: number, to: number): Promise<Busy[]> {
  const rows = await sql`
    select starts_at, ends_at from calendar_events
    where client_id = ${clientId} and starts_at < ${new Date(to)} and ends_at > ${new Date(from)}`;
  return rows.map((r: any) => ({ start: new Date(r.starts_at).getTime(), end: new Date(r.ends_at).getTime() }));
}

// Appointments made before Google/Outlook was connected stay in our own calendar: they still
// block their time, and are moved or removed there.
async function isOwnEvent(clientId: string, eventId: string): Promise<boolean> {
  const [r] = await sql`select 1 from calendar_events where client_id = ${clientId} and id::text = ${eventId}`;
  return Boolean(r);
}

export async function busyTimes(client: Business, from: number, to: number): Promise<Busy[]> {
  if (providerOf(client) === "builtin") return ownBusy(client.id, from, to);
  const busy = await linkedBusy(client.id, linkedOrFail(client, await linkFor(client.id)), from, to);
  await sql`update calendar_links set last_error = '' where client_id = ${client.id} and last_error <> ''`;
  return [...busy.filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end)), ...(await ownBusy(client.id, from, to))];
}

export async function createEvent(client: Business, ev: NewEvent): Promise<string> {
  if (providerOf(client) === "builtin") {
    const id = crypto.randomUUID();
    await sql`
      insert into calendar_events (id, client_id, starts_at, ends_at, title, details)
      values (${id}, ${client.id}, ${new Date(ev.start)}, ${new Date(ev.end)}, ${ev.title}, ${ev.description})`;
    return id;
  }
  return linkedBook(client.id, linkedOrFail(client, await linkFor(client.id)), ev);
}

// The built-in calendar's coming appointments, for the dashboard.
export async function upcomingEvents(clientId: string): Promise<CalendarEvent[]> {
  const rows = await sql`
    select id, starts_at, ends_at, title, details from calendar_events
    where client_id = ${clientId} and ends_at > now() order by starts_at limit 50`;
  return rows.map((r: any) => ({ id: r.id, start: iso(r.starts_at), end: iso(r.ends_at), title: r.title, details: r.details }));
}

export async function cancelEvent(clientId: string, eventId: string): Promise<void> {
  await sql`delete from calendar_events where client_id = ${clientId} and id = ${eventId}`;
}

// ---- Changing and removing an appointment already made ----

// A built-in appointment that was booked before bookings kept their event id: found by start and title.
export async function findBuiltinEvent(clientId: string, start: number, title: string): Promise<string | null> {
  const [r] = await sql`
    select id from calendar_events
    where client_id = ${clientId} and starts_at = ${new Date(start)} and title = ${title} limit 1`;
  return r ? String(r.id) : null;
}

// Moves an appointment to a new time (Google/Outlook: patches the event; built-in: updates the row).
export async function moveEvent(client: Business, eventId: string, start: number, end: number): Promise<void> {
  if (providerOf(client) === "builtin" || (await isOwnEvent(client.id, eventId))) {
    await sql`update calendar_events set starts_at = ${new Date(start)}, ends_at = ${new Date(end)} where client_id = ${client.id} and id = ${eventId}`;
    return;
  }
  const link = linkedOrFail(client, await linkFor(client.id));
  if (link.provider === "google") {
    await call(client.id, link, "PATCH", `${GOOGLE}/calendars/${encodeURIComponent(link.calendar_id)}/events/${encodeURIComponent(eventId)}`, {
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(end).toISOString() },
    });
    return;
  }
  await call(client.id, link, "PATCH", `${GRAPH}/me/events/${encodeURIComponent(eventId)}`, { start: graphTime(start), end: graphTime(end) });
}

// Removes an appointment. One that is already gone from Google/Outlook counts as removed.
export async function removeEvent(client: Business, eventId: string): Promise<void> {
  if (providerOf(client) === "builtin" || (await isOwnEvent(client.id, eventId))) return cancelEvent(client.id, eventId);
  const link = linkedOrFail(client, await linkFor(client.id));
  const url =
    link.provider === "google"
      ? `${GOOGLE}/calendars/${encodeURIComponent(link.calendar_id)}/events/${encodeURIComponent(eventId)}`
      : `${GRAPH}/me/events/${encodeURIComponent(eventId)}`;
  try {
    await call(client.id, link, "DELETE", url);
  } catch (err) {
    if (err instanceof CalendarError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}

// Going back from Google/Outlook to the built-in calendar: upcoming bookings made over there are copied
// into ours, so their times stay taken and callers can still move or cancel them.
export async function keepUpcomingBookings(client: Business): Promise<number> {
  const rows = await sql`
    select data from booking_requests where client_id = ${client.id} and data->>'kind' = 'booking' and data->>'status' = 'booked'
      and coalesce(data->>'apptStatus', '') <> 'cancelled' order by id desc limit 500`;
  let kept = 0;
  for (const r of rows as any[]) {
    const b = r.data as { id: string; start: string; name?: string; phone?: string; service?: string; eventId?: string };
    const start = Date.parse(b.start);
    if (!(start > Date.now()) || (b.eventId && (await isOwnEvent(client.id, b.eventId)))) continue;
    const id = crypto.randomUUID();
    const end = start + (client.booking?.minutes ?? 30) * 60000;
    await sql`
      insert into calendar_events (id, client_id, starts_at, ends_at, title, details)
      values (${id}, ${client.id}, ${new Date(start)}, ${new Date(end)}, ${`${b.service || "Appointment"} · ${b.name ?? ""}`}, ${`Name: ${b.name ?? ""}\nPhone: ${b.phone ?? ""}`})`;
    await sql`update booking_requests set data = data || ${{ eventId: id } as any}::jsonb where client_id = ${client.id} and data->>'id' = ${b.id}`;
    kept++;
  }
  return kept;
}

// ---- Reading the events on a linked calendar (for the dashboard's calendar view) ----

export type LinkedEvent = { id: string; start: number; end: number; title: string; description: string };

// Every event on the connected Google/Outlook calendar between two times. Empty for the
// built-in calendar (those are read from our own tables). Errors are thrown as CalendarError.
export async function linkedEvents(client: Business, from: number, to: number): Promise<LinkedEvent[]> {
  if (providerOf(client) === "builtin") return [];
  const link = linkedOrFail(client, await linkFor(client.id));
  if (link.provider === "google") {
    const params = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    const data = await call(client.id, link, "GET", `${GOOGLE}/calendars/${encodeURIComponent(link.calendar_id)}/events?${params}`);
    return (data?.items ?? [])
      .filter((e: any) => e.status !== "cancelled")
      .map((e: any) => ({
        id: String(e.id ?? ""),
        start: Date.parse(e.start?.dateTime ?? e.start?.date ?? ""),
        end: Date.parse(e.end?.dateTime ?? e.end?.date ?? ""),
        title: String(e.summary ?? "Busy"),
        description: String(e.description ?? ""),
      }))
      .filter((e: LinkedEvent) => Number.isFinite(e.start) && Number.isFinite(e.end));
  }
  const params = new URLSearchParams({ startDateTime: new Date(from).toISOString(), endDateTime: new Date(to).toISOString(), $select: "id,subject,bodyPreview,start,end,isCancelled", $top: "250" });
  const data = await call(client.id, link, "GET", `${GRAPH}/me/calendarView?${params}`);
  return (data?.value ?? [])
    .filter((e: any) => !e.isCancelled)
    .map((e: any) => ({ id: String(e.id ?? ""), start: fromGraph(e.start), end: fromGraph(e.end), title: String(e.subject ?? "Busy"), description: String(e.bodyPreview ?? "") }))
    .filter((e: LinkedEvent) => Number.isFinite(e.start) && Number.isFinite(e.end));
}
