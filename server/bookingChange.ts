import { sayTime, type BookingRequest, type Business } from "../src/lib/shared";
import { sql } from "./db";
import { CalendarError, busyTimes, findBuiltinEvent, moveEvent, providerOf, removeEvent } from "./calendars";
import { clip, freeSlots, isoLocal, localDate, sayDay, withBookingLock } from "./booking";
import { confirmToCaller, notifyBusiness, type BookingChange } from "./notify";

// Callers changing a booking they already have, by phone: find_booking, reschedule_appointment and
// cancel_appointment. The rule that matters most: a caller only ever touches their own booking.
//   1. A booking is theirs if it was made with the number they are calling from. That number is the
//      line's caller ID, passed by the phone service (the X-Twin-Caller header), never by the model.
//   2. Otherwise it is theirs only if they give the full name it's under AND the exact day and time
//      it's booked for. Those details never come back in an answer unless they already matched.
// Only upcoming bookings can be changed. Bookings are kept in the booking_requests log; the
// calendar event each one made (built-in, Google or Outlook) is moved or removed with it.

type Stored = BookingRequest & { apptStatus?: string };

// Everything this touches outside the module, so tests can stand in for the database and calendars.
export type ChangeDeps = {
  now: () => number;
  bookings: (clientId: string) => Promise<Stored[]>;
  patch: (clientId: string, id: string, patch: Record<string, unknown>) => Promise<void>;
  busy: typeof busyTimes;
  eventIdFor: (client: Business, b: Stored) => Promise<string | null>;
  move: (client: Business, eventId: string, start: number, end: number) => Promise<void>;
  remove: (client: Business, eventId: string) => Promise<void>;
  notify: (client: Business, r: BookingRequest, change: BookingChange) => Promise<unknown>;
  confirm: (client: Business, r: BookingRequest, change: BookingChange) => Promise<unknown>;
};

export const realDeps: ChangeDeps = {
  now: () => Date.now(),
  bookings: async (clientId) => {
    const rows = await sql`select data from booking_requests where client_id = ${clientId} and data->>'kind' = 'booking' and data->>'status' = 'booked' order by id desc limit 500`;
    return rows.map((r: any) => r.data);
  },
  patch: async (clientId, id, patch) => {
    await sql`update booking_requests set data = data || ${patch as any}::jsonb where client_id = ${clientId} and data->>'id' = ${id}`;
  },
  busy: busyTimes,
  eventIdFor: async (client, b) => {
    if (b.eventId) return b.eventId;
    // Booked before bookings kept their event id: only the built-in calendar can be searched.
    if (providerOf(client) !== "builtin") return null;
    return findBuiltinEvent(client.id, Date.parse(b.start), `${b.service || "Appointment"} · ${b.name}`);
  },
  move: moveEvent,
  remove: removeEvent,
  notify: (client, r, change) => notifyBusiness(client, r, change),
  confirm: (client, r, change) => confirmToCaller(client, r, change),
};

// ---- Who is asking ---------------------------------------------------------------

/** The last nine digits of a phone number ("+61 412 345 678" and "0412 345 678" match), or "" if it isn't a usable number. */
export function phoneKey(v: unknown): string {
  const text = String(v ?? "");
  if (!/^\+?[\d\s()-]+$/.test(text.trim())) return "";
  const digits = text.replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-9) : "";
}

const norm = (v: unknown) => clip(v, 80).toLowerCase().replace(/\s+/g, " ");

function hhmm(v: unknown): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clip(v, 8));
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

/** The caller's upcoming bookings, soonest first: those made with their number, plus any named exactly with the right day and time. */
export async function yourBookings(client: Business, caller: string, input: any, deps: ChangeDeps): Promise<Stored[]> {
  const tz = client.settings.timezone;
  const now = deps.now();
  const number = phoneKey(caller);
  const name = norm(input?.name);
  const date = clip(input?.booked_date, 10);
  const time = hhmm(input?.booked_time);
  const upcoming = (await deps.bookings(client.id)).filter(
    (r) => r.kind === "booking" && r.status === "booked" && r.apptStatus !== "cancelled" && Date.parse(r.start) > now,
  );
  return upcoming
    .filter((r) => {
      if (number && phoneKey(r.phone) === number) return true;
      if (!name || !date || !time) return false;
      const at = Date.parse(r.start);
      return norm(r.name) === name && localDate(at, tz) === date && isoLocal(at, tz).slice(11, 16) === time;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

const whenOf = (client: Business, start: number) => `${sayDay(localDate(start, client.settings.timezone))} at ${sayTime(isoLocal(start, client.settings.timezone).slice(11, 16))}`;

const NOT_YOURS = "I can't find that booking for this caller. Use find_booking, and if it finds nothing, take a message with request_callback.";
const TEAM = "Use request_callback so the team can sort it out.";

// ---- find_booking ----------------------------------------------------------------

export async function findBooking(client: Business, input: any, caller: string, deps: ChangeDeps = realDeps): Promise<unknown> {
  const mine = await yourBookings(client, caller, input, deps);
  if (mine.length === 0) {
    const gaveDetails = Boolean(clip(input?.name, 80) || clip(input?.booked_date, 10) || clip(input?.booked_time, 8));
    return {
      found: false,
      message: gaveDetails
        ? `No booking matches those details. Don't say anything about other bookings. ${TEAM}`
        : "No booking found under the number they are calling from. Ask for their full name and the day and time of the booking, then call find_booking again with name, booked_date and booked_time. If that finds nothing, take a message with request_callback.",
    };
  }
  return {
    found: true,
    bookings: mine.slice(0, 5).map((b) => ({ booking_id: b.id, when: whenOf(client, Date.parse(b.start)), service: b.service || "appointment", name: b.name })),
    message: "Read the booking back and check it's the one they mean. To move it, call check_availability and then reschedule_appointment. To cancel it, confirm first, then call cancel_appointment.",
  };
}

// ---- reschedule_appointment ---------------------------------------------------------

export function reschedule(client: Business, input: any, caller: string, deps: ChangeDeps = realDeps): Promise<unknown> {
  return withBookingLock(client.id, () => rescheduleNow(client, input, caller, deps));
}

async function rescheduleNow(client: Business, input: any, caller: string, deps: ChangeDeps): Promise<unknown> {
  const tz = client.settings.timezone;
  const id = clip(input?.booking_id, 80);
  const next = Date.parse(String(input?.new_start ?? ""));
  if (!id) return { rescheduled: false, reason: "Use the booking_id from find_booking." };
  if (!Number.isFinite(next)) return { rescheduled: false, reason: "Use a start value from check_availability." };

  const b = (await yourBookings(client, caller, input, deps)).find((r) => r.id === id);
  if (!b) return { rescheduled: false, reason: NOT_YOURS };

  const oldStart = Date.parse(b.start);
  const length = client.booking!.minutes * 60000;
  if (next === oldStart) return { rescheduled: false, reason: "That is the time it's already booked for. Ask which time they want instead." };

  // The same rules as a new booking (hours, notice, buffer, how far ahead), with the booking's own time not counted as taken.
  const { starts } = await freeSlots(client, localDate(next, tz), { ignore: { start: oldStart, end: oldStart + length }, busy: deps.busy });
  if (!starts.includes(next)) return { rescheduled: false, reason: "That time is not free. Check availability again and offer other times." };

  try {
    const eventId = await deps.eventIdFor(client, b);
    if (!eventId) return { rescheduled: false, reason: `That booking can't be moved automatically. ${TEAM}` };
    await deps.move(client, eventId, next, next + length);
    const moved: Stored = { ...b, start: isoLocal(next, tz), rescheduledFrom: b.start, eventId };
    await deps.patch(client.id, b.id, { start: moved.start, rescheduledFrom: b.start, rescheduledAt: new Date(deps.now()).toISOString(), eventId }).catch((err) =>
      console.error(`[booking ${client.id}] moved in the calendar but couldn't update the log`, err.message),
    );
    const change: BookingChange = { kind: "rescheduled", was: b.start };
    Promise.resolve(deps.notify(client, moved, change)).catch(() => {});
    const emailing = Boolean(b.email);
    if (b.email) Promise.resolve(deps.confirm(client, moved, change)).catch((err) => console.error(`[booking ${client.id}] change email`, err.message));
    const when = whenOf(client, next);
    return { rescheduled: true, when, message: `Moved. Tell them it's now ${when}${emailing ? " and that an email with the new time is on its way" : ""}.` };
  } catch (err) {
    if (!(err instanceof CalendarError)) console.error(`[booking ${client.id}]`, err);
    return { rescheduled: false, reason: `The calendar couldn't be reached. ${TEAM}` };
  }
}

// ---- cancel_appointment -------------------------------------------------------------

export function cancel(client: Business, input: any, caller: string, deps: ChangeDeps = realDeps): Promise<unknown> {
  return withBookingLock(client.id, () => cancelNow(client, input, caller, deps));
}

async function cancelNow(client: Business, input: any, caller: string, deps: ChangeDeps): Promise<unknown> {
  const id = clip(input?.booking_id, 80);
  if (!id) return { cancelled: false, reason: "Use the booking_id from find_booking." };
  // The assistant must have read it back and heard a yes: nothing is cancelled on a guess.
  if (norm(input?.confirmed) !== "yes") {
    return { cancelled: false, reason: "Not cancelled yet. Read the booking back, ask if they want it cancelled, and only after a clear yes call cancel_appointment again with confirmed set to yes." };
  }
  const b = (await yourBookings(client, caller, input, deps)).find((r) => r.id === id);
  if (!b) return { cancelled: false, reason: NOT_YOURS };

  try {
    const eventId = await deps.eventIdFor(client, b);
    // A built-in booking with no event left has nothing to remove; a Google/Outlook one we can't find must not be left in the calendar.
    if (!eventId && providerOf(client) !== "builtin") return { cancelled: false, reason: `That booking can't be cancelled automatically. ${TEAM}` };
    if (eventId) await deps.remove(client, eventId);
    // apptStatus is how the dashboard marks a booking cancelled; reminders and review texts skip it.
    await deps.patch(client.id, b.id, { status: "cancelled", apptStatus: "cancelled", cancelledAt: new Date(deps.now()).toISOString() }).catch((err) =>
      console.error(`[booking ${client.id}] cancelled in the calendar but couldn't update the log`, err.message),
    );
    const change: BookingChange = { kind: "cancelled", was: b.start };
    Promise.resolve(deps.notify(client, b, change)).catch(() => {});
    const emailing = Boolean(b.email);
    if (b.email) Promise.resolve(deps.confirm(client, b, change)).catch((err) => console.error(`[booking ${client.id}] change email`, err.message));
    return { cancelled: true, when: whenOf(client, Date.parse(b.start)), message: `Cancelled. Tell them the booking is cancelled${emailing ? " and that an email is on its way" : ""}, and offer to book another time.` };
  } catch (err) {
    if (!(err instanceof CalendarError)) console.error(`[booking ${client.id}]`, err);
    return { cancelled: false, reason: `The calendar couldn't be reached. ${TEAM}` };
  }
}

// ---- cancelling from the dashboard ------------------------------------------------------

/**
 * The owner cancels an appointment from the Calendar page. Same as the phone: the calendar event goes, the
 * booking_requests log says cancelled (so Contacts and Inbox show it, and reminders skip it), and the caller
 * gets the usual change email if there is one. An event with no booking behind it (added by hand) is just removed.
 */
export function cancelFromDashboard(client: Business, eventId: string, deps: ChangeDeps = realDeps): Promise<{ logged: boolean }> {
  return withBookingLock(client.id, () => cancelFromDashboardNow(client, eventId, deps));
}

async function cancelFromDashboardNow(client: Business, eventId: string, deps: ChangeDeps): Promise<{ logged: boolean }> {
  const all = (await deps.bookings(client.id)).filter((r) => r.kind === "booking" && r.status === "booked" && r.apptStatus !== "cancelled");
  let b = all.find((r) => r.eventId === eventId);
  if (!b) {
    // Booked before bookings kept their event id: matched by the event found from its time and title.
    const now = deps.now();
    for (const r of all.filter((x) => !x.eventId && Date.parse(x.start) > now - 86400000)) {
      if ((await deps.eventIdFor(client, r).catch(() => null)) === eventId) {
        b = r;
        break;
      }
    }
  }
  await deps.remove(client, eventId);
  if (!b) return { logged: false };
  await deps.patch(client.id, b.id, { status: "cancelled", apptStatus: "cancelled", cancelledAt: new Date(deps.now()).toISOString() }).catch((err) =>
    console.error(`[booking ${client.id}] cancelled in the calendar but couldn't update the log`, err.message),
  );
  if (b.email) Promise.resolve(deps.confirm(client, b, { kind: "cancelled", was: b.start })).catch((err) => console.error(`[booking ${client.id}] change email`, err.message));
  return { logged: true };
}
