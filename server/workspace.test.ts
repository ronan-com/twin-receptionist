// A refused booking (the slot was already taken) is kept, but never listed as an appointment.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/workspace.test.ts
import { describe, expect, test } from "bun:test";
import { isRefusedBooking } from "./routes/workspace";

describe("refused bookings", () => {
  test("a failed booking request is not an appointment", () => {
    expect(isRefusedBooking({ kind: "booking", status: "failed" })).toBe(true);
    expect(isRefusedBooking({ kind: "booking", status: "booked" })).toBe(false);
    expect(isRefusedBooking({ kind: "booking", status: "pending" })).toBe(false);
    expect(isRefusedBooking({ kind: "callback", status: "failed" })).toBe(false);
  });
});
