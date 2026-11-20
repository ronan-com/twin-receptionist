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

export class CalendarError extends Error {}

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
    throw new CalendarError(message);
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

export async function busyTimes(client: Business, from: number, to: number): Promise<Busy[]> {
  if (providerOf(client) === "builtin") {
    const rows = await sql`
      select starts_at, ends_at from calendar_events
      where client_id = ${client.id} and starts_at < ${new Date(to)} and ends_at > ${new Date(from)}`;
    return rows.map((r: any) => ({ start: new Date(r.starts_at).getTime(), end: new Date(r.ends_at).getTime() }));
  }
  const busy = await linkedBusy(client.id, linkedOrFail(client, await linkFor(client.id)), from, to);
  await sql`update calendar_links set last_error = '' where client_id = ${client.id} and last_error <> ''`;
  return busy.filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));
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
