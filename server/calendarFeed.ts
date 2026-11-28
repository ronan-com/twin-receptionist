import { createHash, timingSafeEqual } from "node:crypto";
import type { Business } from "../src/lib/shared";
import { newToken } from "./booking";
import { providerOf } from "./calendars";
import { sql } from "./db";
import { seal, unseal } from "./secrets";
import { getClient } from "./store";

// "See bookings in your own calendar": one private address per receptionist that Google Calendar,
// Apple Calendar or Outlook can subscribe to (an iCalendar feed). No keys and nothing to register.
// The address holds a long random token and is the only way in; a new one, or switching it off,
// stops the old one at once. The token is kept sealed (secrets.ts), like other secrets.

const store = (clientId: string, feed: NonNullable<Business["calendarFeed"]>) =>
  sql`update clients set data = data || ${{ calendarFeed: feed } as any}::jsonb where id = ${clientId}`;

const fresh = () => ({ secret: seal(newToken()) });

/** The receptionist's feed path, made the first time it's asked for. "" when it has been switched off. */
export async function feedPath(clientId: string): Promise<string> {
  // Only written if there is none yet, so two people opening the page get the same address.
  await sql`update clients set data = data || ${{ calendarFeed: fresh() } as any}::jsonb where id = ${clientId} and not (data ? 'calendarFeed')`;
  const feed = (await getClient(clientId))?.calendarFeed;
  if (!feed || feed.off) return "";
  return `/api/calendar-feed/${clientId}/${unseal(feed.secret)}.ics`;
}

/** A new address (switching the feed on if it was off). The old one stops working. */
export async function newFeed(clientId: string): Promise<string> {
  await store(clientId, fresh());
  return feedPath(clientId);
}

export async function stopFeed(clientId: string): Promise<void> {
  await store(clientId, { secret: "", off: true });
}

// ---- The file itself (RFC 5545) ----

export type FeedEvent = { id: string; start: number; end: number; title: string; description: string };

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ");
const stamp = (at: number) => new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Lines are at most 75 bytes; the rest carries on, after a space, without splitting a character.
function fold(line: string): string {
  const out: string[] = [];
  let part = "";
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (size + n > 75) {
      out.push(part);
      part = " ";
      size = 1;
    }
    part += ch;
    size += n;
  }
  out.push(part);
  return out.join("\r\n");
}

export function buildIcs(name: string, events: FeedEvent[], now = Date.now()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI Receptionist//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${esc(e.id)}@bookings`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.end)}`,
      `SUMMARY:${esc(e.title)}`,
      ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

type Logged = { id: string; start: string; name?: string; phone?: string; service?: string; status?: string; apptStatus?: string; eventId?: string };
const KEEP_PAST_DAYS = 90;

/** Confirmed bookings from the last three months on: ours, plus (with Google/Outlook connected) those made over there. */
export async function feedEvents(client: Business): Promise<FeedEvent[]> {
  const since = Date.now() - KEEP_PAST_DAYS * 86_400_000;
  const [own, logged] = await Promise.all([
    sql`select id, starts_at, ends_at, title, details from calendar_events where client_id = ${client.id} and ends_at > ${new Date(since)} order by starts_at limit 2000`,
    sql`select data from booking_requests where client_id = ${client.id} and data->>'kind' = 'booking' order by id desc limit 2000`,
  ]);
  const requests = (logged as any[]).map((r) => r.data as Logged);
  const off = (r: Logged) => ["cancelled", "declined"].includes(r.apptStatus ?? "") || ["cancelled", "declined"].includes(r.status ?? "");
  const titleOf = (r: Logged) => `${r.service || "Appointment"} · ${r.name ?? ""}`;
  // Cancelled from the dashboard: the entry may still be in our calendar, so it's left out here.
  const cancelled = new Set(requests.filter(off).map((r) => r.eventId || `${Date.parse(r.start)}|${titleOf(r)}`));
  const events: FeedEvent[] = (own as any[])
    .map((e) => ({ id: String(e.id), start: new Date(e.starts_at).getTime(), end: new Date(e.ends_at).getTime(), title: String(e.title), description: String(e.details ?? "") }))
    .filter((e) => !cancelled.has(e.id) && !cancelled.has(`${e.start}|${e.title}`));
  if (providerOf(client) !== "builtin") {
    const have = new Set((own as any[]).map((e) => String(e.id)));
    const length = (client.booking?.minutes ?? 30) * 60000;
    for (const r of requests) {
      const start = Date.parse(r.start);
      if (r.status !== "booked" || off(r) || !(start > since) || (r.eventId && have.has(r.eventId))) continue;
      events.push({ id: r.id, start, end: start + length, title: titleOf(r), description: r.phone ? `Phone: ${r.phone}` : "" });
    }
  }
  return events.sort((a, b) => a.start - b.start);
}

const digest = (v: string) => createHash("sha256").update(v).digest();
const missing = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

/** GET /api/calendar-feed/<receptionist>/<token>.ics. No sign-in: the token is the key. */
export async function serveFeed(clientId: string, token: string): Promise<Response> {
  const client = await getClient(clientId).catch(() => null);
  const feed = client?.calendarFeed;
  if (!client || !feed || feed.off) return missing();
  let real = "";
  try {
    real = unseal(feed.secret);
  } catch {
    return missing();
  }
  if (!timingSafeEqual(digest(real), digest(token))) return missing();
  return new Response(buildIcs(`${client.settings.businessName} bookings`, await feedEvents(client)), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="bookings.ics"',
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
