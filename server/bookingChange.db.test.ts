// The real database half of moving and cancelling bookings: the booking log, the built-in calendar.
// Needs a scratch Postgres (never production): see scripts/e2e/setup.sh.
//   DATABASE_URL=postgres://.../scratch_db bun test server/bookingChange.db.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { migrate, sql } from "./db";
import { insertClient } from "./store";
import { createEvent } from "./calendars";
import { isoLocal, localToEpoch, localDate } from "./booking";
import { cancel, findBooking, realDeps, reschedule } from "./bookingChange";

const TZ = "Australia/Sydney";
const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: true, from: "09:00", to: "17:00" }])) as any;
const orgId = crypto.randomUUID();
const now = new Date().toISOString();
const client: Business = {
  id: crypto.randomUUID(),
  assistantId: "demo-assistant",
  settings: { ...blankSettings(), businessName: "Alpha Physio", timezone: TZ, hours, services: ["Consult"] },
  instructions: "",
  phoneNumbers: [],
  booking: { provider: "builtin", token: "t", minutes: 30, enabled: true, createdAt: now } as Business["booking"],
  createdAt: now,
  updatedAt: now,
};
const day = (n: number) => localDate(Date.now() + n * 86400000, TZ);
const at = (n: number, t: string) => localToEpoch(day(n), t, TZ);
const stored = (id: string, start: number, eventId: string) => ({ id, kind: "booking", status: "booked", name: "Sam Taylor", phone: "+61412345678", service: "Consult", start: isoLocal(start, TZ), eventId, note: "" });

let ready = true;
beforeAll(async () => {
  try {
    await migrate();
    await sql`insert into orgs (id, name) values (${orgId}, 'booking change test')`;
    await insertClient(orgId, client);
  } catch (err) {
    ready = false;
    console.warn("[bookingChange.db.test] no database, skipping:", (err as Error).message);
  }
}, 60000);
afterAll(async () => {
  if (!ready) return;
  await sql`delete from calendar_events where client_id = ${client.id}`;
  await sql`delete from booking_requests where client_id = ${client.id}`;
  await sql`delete from clients where id = ${client.id}`;
  await sql`delete from orgs where id = ${orgId}`;
});

describe("against the database and built-in calendar", () => {
  test("reschedule then cancel keep the log and calendar in step", async () => {
    if (!ready) return;
    const start = at(3, "10:00");
    const eventId = await createEvent(client, { start, end: start + 1800000, title: "Consult · Sam Taylor", description: "" });
    await sql`insert into booking_requests (client_id, data) values (${client.id}, ${stored("bk1", start, eventId) as any})`;

    const found: any = await findBooking(client, {}, "0412 345 678", realDeps);
    expect(found.bookings[0].booking_id).toBe("bk1");

    // Another number can't touch it.
    const next = at(4, "14:00");
    expect(((await reschedule(client, { booking_id: "bk1", new_start: isoLocal(next, TZ) }, "+61400000000", realDeps)) as any).rescheduled).toBe(false);

    const moved: any = await reschedule(client, { booking_id: "bk1", new_start: isoLocal(next, TZ) }, "+61412345678", realDeps);
    expect(moved.rescheduled).toBe(true);
    const [ev] = await sql`select starts_at from calendar_events where id = ${eventId}`;
    expect(new Date(ev.starts_at).getTime()).toBe(next);
    const [row] = await sql`select data from booking_requests where client_id = ${client.id} and data->>'id' = 'bk1'`;
    expect(row.data.start).toBe(isoLocal(next, TZ));

    // A taken slot is refused (a second booking sits there).
    const other = at(5, "11:00");
    await createEvent(client, { start: other, end: other + 1800000, title: "x", description: "" });
    expect(((await reschedule(client, { booking_id: "bk1", new_start: isoLocal(other, TZ) }, "+61412345678", realDeps)) as any).rescheduled).toBe(false);

    const done: any = await cancel(client, { booking_id: "bk1", confirmed: "yes" }, "+61412345678", realDeps);
    expect(done.cancelled).toBe(true);
    expect((await sql`select 1 from calendar_events where id = ${eventId}`).length).toBe(0);
    const [after] = await sql`select data from booking_requests where client_id = ${client.id} and data->>'id' = 'bk1'`;
    expect(after.data.apptStatus).toBe("cancelled");
    expect(((await findBooking(client, {}, "+61412345678", realDeps)) as any).found).toBe(false);
  });
});
