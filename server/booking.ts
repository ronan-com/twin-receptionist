import { createHash, timingSafeEqual } from "node:crypto";
import {
  DAYS,
  sayTime,
  type BookingRequest,
  type BookingSetup,
  type Business,
  type DayKey,
} from "../src/lib/shared";
import { sql } from "./db";
import { CalendarError, busyTimes, createEvent } from "./calendars";
import { confirmToCaller, notifyBusiness } from "./notify";
import { mailerReady } from "./mailer";
import { getSetting, putSetting } from "./store";

// ---- Public address ------------------------------------------------------------
// Telnyx runs the receptionist in its cloud, so its tools need a public address
// for this server. In the cloud that's PUBLIC_URL (e.g. https://app.example.com);
// on a laptop, `bun run tunnel` opens one and reports it here.

const VALID_URL = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i;
const fixedUrl = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
let tunnelUrl = "";

export function publicUrl(): string {
  return VALID_URL.test(fixedUrl) ? fixedUrl : tunnelUrl;
}

export async function loadPublicUrl(): Promise<void> {
  const saved = await getSetting<{ url: string }>("public_url");
  if (saved && VALID_URL.test(saved.url)) tunnelUrl = saved.url;
}

export async function savePublicUrl(url: string): Promise<void> {
  tunnelUrl = url;
  await putSetting("public_url", { url, at: new Date().toISOString() });
}

// Booking is live only when it's switched on and Telnyx can reach this server.
export function bookingLive(client: Business): boolean {
  return Boolean(client.booking?.enabled && publicUrl());
}

// ---- Request log ---------------------------------------------------------------
// Every booking and callback the receptionist takes is kept here as well as being
// sent to the client's calendar or CRM, so nothing is lost if the gateway is down.

async function record(clientId: string, entry: BookingRequest): Promise<void> {
  await sql`insert into booking_requests (client_id, data) values (${clientId}, ${entry as any})`;
}

export async function requestsFor(clientId: string): Promise<BookingRequest[]> {
  const rows = await sql`select data from booking_requests where client_id = ${clientId} order by id desc limit 200`;
  return rows.map((r: any) => r.data);
}

// ---- Time zones ----------------------------------------------------------------

// Minutes the zone is ahead of UTC at that instant (Brisbane: 600).
function offsetMinutes(at: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at) / 60000);
}

// "2026-11-21" + "09:30" in Australia/Sydney -> epoch ms
function localToEpoch(date: string, hhmm: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  let at = guess - offsetMinutes(guess, tz) * 60000;
  // Correct once more in case the guess landed on the other side of a daylight-saving change.
  at = guess - offsetMinutes(at, tz) * 60000;
  return at;
}

// epoch ms -> "2026-11-21T09:30:00+10:00"
function isoLocal(at: number, tz: string): string {
  const off = offsetMinutes(at, tz);
  const local = new Date(at + off * 60000).toISOString().slice(0, 19);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function localDate(at: number, tz: string): string {
  return isoLocal(at, tz).slice(0, 10);
}

function sayDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function dayKey(date: string): DayKey {
  const [y, m, d] = date.split("-").map(Number);
  // getUTCDay: 0 = Sunday. DAYS starts on Monday.
  return DAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7].key;
}

// ---- Availability --------------------------------------------------------------

type Slot = { start: string; time: string };

const MAX_SLOTS = 10;
// Don't offer a time that starts sooner than this.
const LEAD_MINUTES = 30;
const NOTICE_MINUTES: Record<string, number> = { none: 0, "1h": 60, "2h": 120, same_day: 60, "24h": 1440, "48h": 2880 };

// The receptionist profile's booking rules (server/prompt.ts cleans them). All optional.
function rulesOf(client: Business) {
  const p = client.settings.profile;
  return {
    notice: Math.max(LEAD_MINUTES, p?.bookingNotice ? (NOTICE_MINUTES[p.bookingNotice] ?? 0) : 0),
    buffer: p?.bufferMinutes ?? 0,
    windowDays: p?.bookingWindowDays ?? 0,
  };
}

// The last day callers can book, as YYYY-MM-DD, or "" when there is no limit.
function lastBookableDate(client: Business): string {
  const { windowDays } = rulesOf(client);
  return windowDays ? localDate(Date.now() + windowDays * 86400000, client.settings.timezone) : "";
}

async function freeSlots(client: Business, date: string): Promise<{ open: boolean; slots: Slot[]; starts: number[] }> {
  const s = client.settings;
  const setup = client.booking!;
  const hours = s.hours[dayKey(date)];
  if (!hours.open) return { open: false, slots: [], starts: [] };

  const opens = localToEpoch(date, hours.from, s.timezone);
  const closes = localToEpoch(date, hours.to, s.timezone);
  const length = setup.minutes * 60000;
  const rules = rulesOf(client);
  const last = lastBookableDate(client);
  if (last && date > last) return { open: true, slots: [], starts: [] };
  const gap = rules.buffer * 60000;

  const taken = (await busyTimes(client, opens - gap, closes + gap)).map((b) => [b.start, b.end] as const);

  const earliest = Date.now() + rules.notice * 60000;
  const starts: number[] = [];
  for (let t = opens; t + length <= closes; t += length) {
    if (t < earliest) continue;
    if (taken.some(([a, b]) => t < b + gap && t + length + gap > a)) continue;
    starts.push(t);
  }
  return {
    open: true,
    starts,
    slots: starts.slice(0, MAX_SLOTS).map((t) => ({
      start: isoLocal(t, s.timezone),
      time: sayTime(isoLocal(t, s.timezone).slice(11, 16)),
    })),
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function availability(client: Business, input: any): Promise<unknown> {
  const date = String(input?.date ?? "").trim();
  if (!DATE.test(date) || Number.isNaN(Date.parse(date))) {
    return { error: "Send the date as YYYY-MM-DD." };
  }
  const today = localDate(Date.now(), client.settings.timezone);
  if (date < today) return { date, day: sayDay(date), open: false, message: "That date has passed. Ask for another day." };

  const last = lastBookableDate(client);
  if (last && date > last) return { date, day: sayDay(date), open: true, slots: [], message: `That is further ahead than bookings go (up to ${rulesOf(client).windowDays} days). Offer an earlier day, or take a message.` };

  const { open, slots } = await freeSlots(client, date);
  if (!open) return { date, day: sayDay(date), open: false, message: `The business is closed on ${sayDay(date)}. Offer another day.` };
  if (slots.length === 0) return { date, day: sayDay(date), open: true, slots: [], message: "No free times left that day. Offer another day." };
  return {
    date,
    day: sayDay(date),
    open: true,
    appointment_minutes: client.booking!.minutes,
    slots,
    message: "Offer two or three of these times. Pass the chosen slot's start value, unchanged, to book_appointment.",
  };
}

const clip = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

// Bookings for one client run one at a time, so two people can't both be given
// the same slot between the "is it free" check and the write.
const bookingLocks = new Map<string, Promise<unknown>>();

export function book(client: Business, input: any): Promise<unknown> {
  const previous = bookingLocks.get(client.id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => bookNow(client, input));
  bookingLocks.set(client.id, next);
  next.finally(() => bookingLocks.get(client.id) === next && bookingLocks.delete(client.id)).catch(() => {});
  return next;
}

async function bookNow(client: Business, input: any): Promise<unknown> {
  const s = client.settings;
  const name = clip(input?.name, 80);
  const phone = clip(input?.phone, 30);
  const service = clip(input?.service, 80);
  const notes = clip(input?.notes, 500);
  const channel = clip(input?.channel, 20) || "call";
  // Optional. An address that doesn't look like one is dropped rather than failing the booking.
  const given = clip(input?.email, 254).toLowerCase();
  const email = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(given) ? given : "";
  const start = Date.parse(String(input?.start ?? ""));
  if (!name || !phone) return { booked: false, reason: "Ask for their name and mobile number first." };
  if (!Number.isFinite(start)) return { booked: false, reason: "Use a start value from check_availability." };

  const entry: BookingRequest = {
    id: crypto.randomUUID(),
    kind: "booking",
    at: new Date().toISOString(),
    channel,
    name,
    phone,
    service,
    start: isoLocal(start, s.timezone),
    status: "failed",
    note: notes,
    ...(email ? { email } : {}),
  };

  try {
    // Check again: someone else may have taken it since the times were offered.
    const date = localDate(start, s.timezone);
    const { starts } = await freeSlots(client, date);
    if (!starts.includes(start)) {
      await record(client.id, { ...entry, note: "That time was no longer free." });
      return { booked: false, reason: "That time is no longer free. Check availability again and offer other times." };
    }
    const end = start + client.booking!.minutes * 60000;
    await createEvent(client, {
      start,
      end,
      title: `${service || "Appointment"} · ${name}`,
      description: `Name: ${name}\nPhone: ${phone}\n${email ? `Email: ${email}\n` : ""}Service: ${service || "not given"}\n${notes ? `Notes: ${notes}\n` : ""}Booked by the AI receptionist by ${channel === "sms" ? "text" : "phone"}.`,
    });
    const when = `${sayDay(date)} at ${sayTime(isoLocal(start, s.timezone).slice(11, 16))}`;
    const booked: BookingRequest = { ...entry, status: "booked", note: notes };
    await record(client.id, booked).catch((err) => console.error(`[booking ${client.id}] couldn't log`, err.message));
    // Email the business and send it to their CRM. Never let that undo a booking that worked.
    notifyBusiness(client, booked).catch(() => {});
    // The caller's own confirmation, when they gave an email and this server can send mail.
    const emailing = Boolean(email) && mailerReady();
    // (With no mail server, as on a laptop, the email is printed in the server log.)
    if (email) confirmToCaller(client, booked).catch((err) => console.error(`[booking ${client.id}] confirmation email`, err.message));
    return { booked: true, when, message: `Booked. Tell them it's confirmed for ${when}${emailing ? " and that a confirmation email is on its way" : ""}.` };
  } catch (err) {
    const reason = err instanceof CalendarError ? err.message : "Unexpected error.";
    if (!(err instanceof CalendarError)) console.error(`[booking ${client.id}]`, err);
    await record(client.id, { ...entry, note: reason });
    return {
      booked: false,
      reason: "The calendar couldn't be reached. Use request_callback so the team can confirm the time with them.",
    };
  }
}

export async function callback(client: Business, input: any): Promise<unknown> {
  const entry: BookingRequest = {
    id: crypto.randomUUID(),
    kind: "callback",
    at: new Date().toISOString(),
    channel: clip(input?.channel, 20) || "call",
    name: clip(input?.name, 80),
    phone: clip(input?.phone, 30),
    service: clip(input?.reason, 200),
    start: clip(input?.preferred_time, 80),
    status: "saved",
    note: clip(input?.message, 500),
  };
  if (!entry.phone) return { saved: false, reason: "Ask for a number the team can call back on." };
  await record(client.id, entry);
  notifyBusiness(client, entry).catch(() => {});
  return { saved: true, message: "Saved. Tell them the team will call them back." };
}

// ---- Tool endpoint authentication ------------------------------------------------

export function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
}

const sha = (v: string) => createHash("sha256").update(v).digest();

export function tokenMatches(setup: BookingSetup | undefined, given: string | null): boolean {
  if (!setup?.token || !given) return false;
  return timingSafeEqual(sha(setup.token), sha(given));
}

// ---- Telnyx tool definitions ------------------------------------------------------

export function bookingTools(client: Business, base: string) {
  const headers = [{ name: "X-Twin-Key", value: client.booking!.token }];
  const url = (action: string) => `${base}/hooks/${client.id}/${action}`;
  const channel = {
    type: "string",
    description: 'How they are talking to you: "call" for a phone call, "sms" for text messages.',
  };
  const tool = (name: string, description: string, action: string, properties: Record<string, unknown>, required: string[]) => ({
    type: "webhook",
    timeout_ms: 10000,
    webhook: {
      name,
      description,
      url: url(action),
      method: "POST",
      headers,
      body_parameters: { type: "object", properties, required },
    },
  });
  return [
    tool(
      "check_availability",
      "Get the free appointment times on one day. Call it before offering any times.",
      "availability",
      { date: { type: "string", description: "The day to check, as YYYY-MM-DD in the business's time zone." } },
      ["date"],
    ),
    tool(
      "book_appointment",
      "Book a time from check_availability, once you have their name and mobile number and they have agreed to the time.",
      "book",
      {
        start: { type: "string", description: "The start value of the chosen slot, exactly as check_availability returned it." },
        name: { type: "string", description: "Their full name." },
        phone: { type: "string", description: "Their mobile number." },
        service: { type: "string", description: "What the appointment is for, from the list of services." },
        email: { type: "string", description: "Their email address, if they gave one, for their confirmation. Optional." },
        notes: { type: "string", description: "Anything else the team should know. Optional." },
        channel,
      },
      ["start", "name", "phone", "service", "channel"],
    ),
    tool(
      "request_callback",
      "Ask the team to call someone back: when they want a person, have a question you can't answer, or a booking couldn't be made.",
      "callback",
      {
        name: { type: "string", description: "Their name." },
        phone: { type: "string", description: "The number to call back." },
        reason: { type: "string", description: "What it's about, in a few words." },
        preferred_time: { type: "string", description: "When suits them for the call back, if they said. Optional." },
        message: { type: "string", description: "Their message for the team. Optional." },
        channel,
      },
      ["name", "phone", "reason", "channel"],
    ),
  ];
}

// Free times over the next few open days, as plain lines for an email reply.
// Empty when booking isn't set up or the calendar can't be reached: the reply
// then falls back to "the team will confirm".
export async function upcomingFreeTimes(client: Business, wantDays = 3, perDay = 4): Promise<string> {
  if (!client.booking?.enabled) return "";
  const lines: string[] = [];
  try {
    for (let i = 0; i < 10 && lines.length < wantDays; i++) {
      const date = localDate(Date.now() + i * 86400000, client.settings.timezone);
      const { open, starts } = await freeSlots(client, date);
      if (!open || starts.length === 0) continue;
      // Spread the offers across the day rather than the first few in a row.
      const step = Math.max(1, Math.floor(starts.length / perDay));
      const picks = starts.filter((_, idx) => idx % step === 0).slice(0, perDay);
      const tz = client.settings.timezone;
      lines.push(`${sayDay(date)}: ${picks.map((t) => sayTime(isoLocal(t, tz).slice(11, 16))).join(", ")}`);
    }
  } catch {
    return "";
  }
  return lines.join("\n");
}
