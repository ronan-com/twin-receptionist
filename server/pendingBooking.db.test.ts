// Bookings that need the business's approval: held as pending, approved into the calendar or declined.
// Needs a scratch Postgres (never production): DATABASE_URL=postgres://.../scratch_db bun test server/pendingBooking.db.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { blankSettings, type BookingRequest, type Business } from "../src/lib/shared";
import { migrate, sql } from "./db";
import { insertClient } from "./store";
import { approveBooking, book, declineBooking, freeSlots, isoLocal, localDate, localToEpoch, type DecisionDeps } from "./booking";

const TZ = "Australia/Sydney";
const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: true, from: "09:00", to: "17:00" }])) as any;
const orgId = crypto.randomUUID();
const now = new Date().toISOString();
const client: Business = {
  id: crypto.randomUUID(),
  assistantId: "demo-assistant",
  settings: { ...blankSettings(), businessName: "Beta Physio", timezone: TZ, hours, services: ["Consult"] },
  instructions: "",
  phoneNumbers: [],
  booking: { provider: "builtin", token: "t", minutes: 30, enabled: true, requireApproval: true, createdAt: now } as Business["booking"],
  createdAt: now,
  updatedAt: now,
};
const day = (n: number) => localDate(Date.now() + n * 86400000, TZ);
const at = (n: number, t: string) => localToEpoch(day(n), t, TZ);

let ready = true;
beforeAll(async () => {
  try {
    await migrate();
    await sql`insert into orgs (id, name) values (${orgId}, 'pending booking test')`;
    await insertClient(orgId, client);
  } catch (err) {
    ready = false;
    console.warn("[pendingBooking.db.test] no database, skipping:", (err as Error).message);
  }
}, 60000);
afterAll(async () => {
  if (!ready) return;
  await sql`delete from calendar_events where client_id = ${client.id}`;
  await sql`delete from booking_requests where client_id = ${client.id}`;
  await sql`delete from clients where id = ${client.id}`;
  await sql`delete from orgs where id = ${orgId}`;
});

const calls: string[] = [];
const deps: DecisionDeps = {
  createEvent: async () => {
    calls.push("event");
    return "evt1";
  },
  confirm: async (_c, r: BookingRequest) => void calls.push(`confirm:${r.email}`),
  decline: async (_c, r: BookingRequest) => void calls.push(`decline:${r.email}`),
  text: async (_c, to) => void calls.push(`text:${to}`),
};

describe("pending bookings", () => {
  test("the AI holds the time, the business approves, the caller is told", async () => {
    if (!ready) return;
    const start = at(3, "10:00");
    const out: any = await book(client, { name: "Sam Taylor", phone: "+61412345678", email: "sam@example.com", service: "Consult", start: new Date(start).toISOString() });
    expect(out.booked).toBe(false);
    expect(out.pending).toBe(true);
    const [row] = await sql`select data from booking_requests where client_id = ${client.id} and data->>'status' = 'pending'`;
    expect(row.data.name).toBe("Sam Taylor");
    // Nothing is in the calendar yet, and the held time is no longer offered.
    expect((await sql`select 1 from calendar_events where client_id = ${client.id}`).length).toBe(0);
    expect((await freeSlots(client, day(3))).starts.includes(start)).toBe(false);

    const ok = await approveBooking(client, row.data.id, deps);
    expect(ok.ok).toBe(true);
    expect(calls).toEqual(["event", "confirm:sam@example.com"]);
    const [after] = await sql`select data from booking_requests where client_id = ${client.id} and data->>'id' = ${row.data.id}`;
    expect(after.data.status).toBe("booked");
    expect(after.data.eventId).toBe("evt1");
    // It can't be approved twice.
    expect((await approveBooking(client, row.data.id, deps)).ok).toBe(false);
  });

  test("declining frees the time and tells the caller", async () => {
    if (!ready) return;
    calls.length = 0;
    const start = at(4, "11:00");
    await book(client, { name: "Alex Lee", phone: "+61400111222", email: "alex@example.com", service: "Consult", start: new Date(start).toISOString() });
    const [row] = await sql`select data from booking_requests where client_id = ${client.id} and data->>'status' = 'pending'`;
    expect((await freeSlots(client, day(4))).starts.includes(start)).toBe(false);
    const out = await declineBooking(client, row.data.id, deps);
    expect(out.ok).toBe(true);
    expect(calls).toEqual(["decline:alex@example.com"]);
    expect((await freeSlots(client, day(4))).starts.includes(start)).toBe(true);
    expect((await declineBooking(client, row.data.id, deps)).ok).toBe(false);
  });

  test("a caller with no email gets a text instead", async () => {
    if (!ready) return;
    calls.length = 0;
    const start = at(5, "14:00");
    await book(client, { name: "Pat", phone: "+61400333444", service: "Consult", start: new Date(start).toISOString() });
    const [row] = await sql`select data from booking_requests where client_id = ${client.id} and data->>'status' = 'pending' and data->>'name' = 'Pat'`;
    await approveBooking(client, row.data.id, deps);
    expect(calls).toEqual(["event", "text:+61400333444"]);
  });
});
