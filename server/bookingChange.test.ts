// Callers moving or cancelling their own booking by phone. No database or calendar: the module's
// outside calls (server/bookingChange.ts ChangeDeps) are stood in for.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/bookingChange.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { localDate, localToEpoch, isoLocal, BOOKING_TOOL_DEFS, bookingTools } from "./booking";
import { cancel, findBooking, phoneKey, reschedule, type ChangeDeps } from "./bookingChange";
import { toolAllowed } from "./voice/tools";
import { buildInstructions } from "./prompt";

const TZ = "Australia/Sydney";
const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: true, from: "09:00", to: "17:00" }])) as any;
const client = {
  id: "00000000-0000-0000-0000-000000000001",
  settings: { ...blankSettings(), businessName: "Alpha Physio", timezone: TZ, hours },
  booking: { provider: "builtin", token: "t", minutes: 30, enabled: true },
} as unknown as Business;

const day = (n: number) => localDate(Date.now() + n * 86400000, TZ);
const at = (n: number, hhmm: string) => localToEpoch(day(n), hhmm, TZ);

type Row = any;
let rows: Row[];
let busy: { start: number; end: number }[];
let moved: { id: string; start: number; end: number }[];
let removed: string[];
let notified: string[];
let emailed: string[];

const deps = (over: Partial<ChangeDeps> = {}): ChangeDeps => ({
  now: () => Date.now(),
  bookings: async () => rows.map((r) => ({ ...r })),
  patch: async (_c, id, patch) => {
    const r = rows.find((x) => x.id === id);
    Object.assign(r, patch);
  },
  busy: async () => busy,
  eventIdFor: async (_c, b) => b.eventId ?? null,
  move: async (_c, id, start, end) => void moved.push({ id, start, end }),
  remove: async (_c, id) => void removed.push(id),
  notify: async (_c, _r, change) => void notified.push(change.kind),
  confirm: async (_c, _r, change) => void emailed.push(change.kind),
  ...over,
});

const booking = (id: string, over: Row = {}): Row => ({
  id,
  kind: "booking",
  status: "booked",
  name: "Sam Taylor",
  phone: "+61412345678",
  service: "Consult",
  start: isoLocal(at(3, "10:00"), TZ),
  eventId: `ev-${id}`,
  email: "sam@example.com",
  note: "",
  ...over,
});

beforeEach(() => {
  rows = [booking("b1")];
  busy = [{ start: at(3, "10:00"), end: at(3, "10:30") }]; // b1's own event
  moved = [];
  removed = [];
  notified = [];
  emailed = [];
});

const CALLER = "+61 412 345 678";

describe("phoneKey", () => {
  test("matches local and international forms; rejects junk", () => {
    expect(phoneKey("0412 345 678")).toBe(phoneKey("+61412345678"));
    expect(phoneKey("{{telnyx_end_user_target}}")).toBe("");
    expect(phoneKey("")).toBe("");
  });
});

describe("find_booking", () => {
  test("finds the caller's upcoming booking by caller ID", async () => {
    const r: any = await findBooking(client, {}, CALLER, deps());
    expect(r.found).toBe(true);
    expect(r.bookings.map((b: any) => b.booking_id)).toEqual(["b1"]);
  });
  test("nothing under another number, and says nothing about other bookings", async () => {
    const r: any = await findBooking(client, {}, "+61499999999", deps());
    expect(r.found).toBe(false);
    expect(JSON.stringify(r)).not.toContain("Sam");
  });
  test("by name needs name AND day AND time", async () => {
    const other = "+61499999999";
    const d = day(3);
    expect(((await findBooking(client, { name: "Sam Taylor" }, other, deps())) as any).found).toBe(false);
    expect(((await findBooking(client, { name: "Sam Taylor", booked_date: d }, other, deps())) as any).found).toBe(false);
    expect(((await findBooking(client, { name: "Sam Taylor", booked_date: d, booked_time: "11:00" }, other, deps())) as any).found).toBe(false);
    expect(((await findBooking(client, { name: "Someone Else", booked_date: d, booked_time: "10:00" }, other, deps())) as any).found).toBe(false);
    expect(((await findBooking(client, { name: "sam  taylor", booked_date: d, booked_time: "10:00" }, other, deps())) as any).found).toBe(true);
  });
  test("past and cancelled bookings aren't found", async () => {
    rows = [booking("old", { start: isoLocal(Date.now() - 86400000, TZ) }), booking("gone", { apptStatus: "cancelled" })];
    expect(((await findBooking(client, {}, CALLER, deps())) as any).found).toBe(false);
  });
});

describe("reschedule_appointment", () => {
  test("moves to a free slot and updates calendar, log and notifications", async () => {
    const next = at(4, "14:00");
    const r: any = await reschedule(client, { booking_id: "b1", new_start: isoLocal(next, TZ) }, CALLER, deps());
    expect(r.rescheduled).toBe(true);
    expect(moved).toEqual([{ id: "ev-b1", start: next, end: next + 30 * 60000 }]);
    expect(rows[0].start).toBe(isoLocal(next, TZ));
    expect(rows[0].rescheduledFrom).toBeTruthy();
    await Promise.resolve();
    expect(notified).toEqual(["rescheduled"]);
    expect(emailed).toEqual(["rescheduled"]);
  });
  test("can move within its own time block (own event doesn't block)", async () => {
    const next = at(3, "10:30");
    expect(((await reschedule(client, { booking_id: "b1", new_start: isoLocal(next, TZ) }, CALLER, deps())) as any).rescheduled).toBe(true);
  });
  test("refuses a taken slot", async () => {
    busy.push({ start: at(4, "14:00"), end: at(4, "14:30") });
    const r: any = await reschedule(client, { booking_id: "b1", new_start: isoLocal(at(4, "14:00"), TZ) }, CALLER, deps());
    expect(r.rescheduled).toBe(false);
    expect(moved).toEqual([]);
    expect(rows[0].start).toBe(booking("b1").start);
  });
  test("refuses outside opening hours and in the past", async () => {
    expect(((await reschedule(client, { booking_id: "b1", new_start: isoLocal(at(4, "20:00"), TZ) }, CALLER, deps())) as any).rescheduled).toBe(false);
    expect(((await reschedule(client, { booking_id: "b1", new_start: isoLocal(Date.now() - 3600000, TZ) }, CALLER, deps())) as any).rescheduled).toBe(false);
    expect(moved).toEqual([]);
  });
  test("a different caller can't move it", async () => {
    const r: any = await reschedule(client, { booking_id: "b1", new_start: isoLocal(at(4, "14:00"), TZ) }, "+61499999999", deps());
    expect(r.rescheduled).toBe(false);
    expect(moved).toEqual([]);
  });
  test("a past booking can't be moved", async () => {
    rows = [booking("old", { start: isoLocal(Date.now() - 86400000, TZ) })];
    const r: any = await reschedule(client, { booking_id: "old", new_start: isoLocal(at(4, "14:00"), TZ) }, CALLER, deps());
    expect(r.rescheduled).toBe(false);
    expect(moved).toEqual([]);
  });
  test("a calendar failure leaves the log alone", async () => {
    const d = deps({ move: async () => { throw new Error("boom"); } });
    const r: any = await reschedule(client, { booking_id: "b1", new_start: isoLocal(at(4, "14:00"), TZ) }, CALLER, d);
    expect(r.rescheduled).toBe(false);
    expect(rows[0].start).toBe(booking("b1").start);
  });
});

describe("cancel_appointment", () => {
  test("cancels after confirmation: removes the event, marks it cancelled, notifies", async () => {
    const r: any = await cancel(client, { booking_id: "b1", confirmed: "yes" }, CALLER, deps());
    expect(r.cancelled).toBe(true);
    expect(removed).toEqual(["ev-b1"]);
    expect(rows[0].apptStatus).toBe("cancelled");
    await Promise.resolve();
    expect(notified).toEqual(["cancelled"]);
    expect(emailed).toEqual(["cancelled"]);
    // and it can't be found or cancelled again
    expect(((await findBooking(client, {}, CALLER, deps())) as any).found).toBe(false);
  });
  test("nothing is cancelled without a clear yes", async () => {
    for (const confirmed of [undefined, "", "no", "maybe"]) {
      expect(((await cancel(client, { booking_id: "b1", confirmed }, CALLER, deps())) as any).cancelled).toBe(false);
    }
    expect(removed).toEqual([]);
  });
  test("wrong caller is blocked", async () => {
    const r: any = await cancel(client, { booking_id: "b1", confirmed: "yes" }, "+61499999999", deps());
    expect(r.cancelled).toBe(false);
    expect(removed).toEqual([]);
    expect(rows[0].apptStatus).toBeUndefined();
  });
  test("a wrong name with a guessed day and time is blocked; the right trio works", async () => {
    const guess = { booking_id: "b1", confirmed: "yes", name: "Not Sam", booked_date: day(3), booked_time: "10:00" };
    expect(((await cancel(client, guess, "", deps())) as any).cancelled).toBe(false);
    expect(((await cancel(client, { ...guess, name: "Sam Taylor" }, "", deps())) as any).cancelled).toBe(true);
  });
  test("a past booking can't be cancelled", async () => {
    rows = [booking("old", { start: isoLocal(Date.now() - 86400000, TZ) })];
    expect(((await cancel(client, { booking_id: "old", confirmed: "yes" }, CALLER, deps())) as any).cancelled).toBe(false);
    expect(removed).toEqual([]);
  });
});

describe("wiring", () => {
  test("tools exist, the change tools carry the line's caller ID, and settings gate them", () => {
    const names = BOOKING_TOOL_DEFS.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(["find_booking", "reschedule_appointment", "cancel_appointment"]));
    const tools: any[] = bookingTools(client, "https://x.test");
    const hdr = (n: string) => tools.find((t) => t.webhook.name === n).webhook.headers.map((h: any) => h.name);
    expect(hdr("cancel_appointment")).toContain("X-Twin-Caller");
    expect(hdr("book_appointment")).not.toContain("X-Twin-Caller");
    const s = blankSettings();
    expect(toolAllowed(s, "cancel_appointment")).toBe(true);
    expect(toolAllowed({ ...s, paused: { at: "2026-01-01T00:00:00Z", message: "" } }, "cancel_appointment")).toBe(false);
    expect(toolAllowed({ ...s, paused: { at: "2026-01-01T00:00:00Z", message: "" } }, "request_callback")).toBe(true);
    expect(toolAllowed({ ...s, profile: { bookingMode: "request" } as any }, "reschedule_appointment")).toBe(false);
    expect(toolAllowed({ ...s, profile: { bookingMode: "request" } as any }, "check_availability")).toBe(true);
  });
  test("instructions explain when to use them and to confirm before cancelling", () => {
    const ins = buildInstructions({ ...blankSettings(), businessName: "Alpha", services: ["Consult"] }, { minutes: 30 });
    expect(ins).toContain("find_booking");
    expect(ins).toContain("Only after a clear yes, call cancel_appointment");
    expect(buildInstructions({ ...blankSettings(), businessName: "Alpha", services: ["Consult"] }, null)).not.toContain("cancel_appointment");
  });
});
