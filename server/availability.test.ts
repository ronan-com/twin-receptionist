// check_availability covers the whole day, not the first few slots; phone numbers are stored as +61.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/availability.test.ts
import { describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { availability, BOOKING_TOOL_DEFS, isoLocal, localDate, localToEpoch, normalizePhone, sayRanges, spread } from "./booking";

const TZ = "Australia/Sydney";
const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: true, from: "08:00", to: "17:00" }])) as any;
const client = {
  id: "00000000-0000-0000-0000-000000000002",
  settings: { ...blankSettings(), businessName: "Beta Clinic", timezone: TZ, hours },
  booking: { provider: "builtin", token: "t", minutes: 30, enabled: true },
} as unknown as Business;

const date = localDate(Date.now() + 3 * 86400000, TZ);
const at = (hhmm: string) => localToEpoch(date, hhmm, TZ);
const lunch = [{ start: at("12:00"), end: at("13:00") }];
const none = async () => [];
const opts = (busy: { start: number; end: number }[] = []) => ({ busy: async () => busy, pending: none });
const run = (input: object, busy = lunch) => availability(client, { date, ...input }, opts(busy)) as Promise<any>;
const times = (r: any) => r.slots.map((s: any) => s.start.slice(11, 16));

describe("check_availability across the day", () => {
  test("afternoon times are offered, not cut off at about 12:30", async () => {
    const r = await run({});
    expect(r.free_ranges).toEqual(["8am to 12pm", "1pm to 5pm"]);
    expect(r.slots.length).toBeLessThanOrEqual(8);
    expect(times(r).some((t: string) => t >= "13:00")).toBe(true);
    expect(times(r)[0]).toBe("08:00");
    expect(times(r).at(-1)).toBe("16:30");
  });
  test("a requested time is checked directly, with nearest times either side", async () => {
    const r = await run({ time: "14:00" });
    expect(r.requested_time_free).toBe(true);
    expect(times(r)).toEqual(["13:00", "13:30", "14:00", "14:30", "15:00"]);
    expect(r.message).toContain("is free");
  });
  test("a taken requested time says so and offers alternatives", async () => {
    const r = await run({ time: "12:00" });
    expect(r.requested_time_free).toBe(false);
    expect(times(r)).toEqual(["11:00", "11:30", "13:00", "13:30"]);
    const busy2 = [...lunch, { start: at("14:00"), end: at("14:30") }];
    const r2 = await run({ time: "14:00" }, busy2);
    expect(r2.requested_time_free).toBe(false);
    expect(times(r2)).toContain("13:30");
    expect(times(r2)).toContain("14:30");
  });
  test("part of day narrows to the afternoon", async () => {
    const r = await run({ part_of_day: "afternoon" });
    expect(r.free_ranges).toEqual(["1pm to 5pm"]);
    expect(times(r).every((t: string) => t >= "13:00")).toBe(true);
  });
  test("a part of day with nothing free still shows the rest of the day", async () => {
    const r = await run({ part_of_day: "evening" });
    expect(r.message).toContain("Nothing is free");
    expect(r.free_ranges.length).toBe(2);
  });
  test("the tool answer stays short on a fully open day", async () => {
    const r = await run({}, []);
    expect(r.free_ranges).toEqual(["8am to 5pm"]);
    expect(JSON.stringify(r).length).toBeLessThan(1500);
  });
  test("the tool takes time and part_of_day", () => {
    const props = BOOKING_TOOL_DEFS.find((d) => d.name === "check_availability")!.properties;
    expect(Object.keys(props)).toEqual(["date", "time", "part_of_day"]);
  });
  test("helpers", () => {
    expect(spread([1, 2, 3], 8)).toEqual([1, 2, 3]);
    const s = spread(Array.from({ length: 18 }, (_, i) => i), 8);
    expect(s.length).toBe(8);
    expect(s[0]).toBe(0);
    expect(s.at(-1)).toBe(17);
    expect(sayRanges([at("09:00"), at("09:30"), at("11:00")], 30 * 60000, TZ)).toEqual(["9am to 10am", "11am to 11:30am"]);
    expect(isoLocal(at("14:00"), TZ).slice(11, 16)).toBe("14:00");
  });
});

describe("normalizePhone", () => {
  test("Australian local formats become +61", () => {
    expect(normalizePhone("0491570006", TZ)).toBe("+61491570006");
    expect(normalizePhone("0491 570 006", TZ)).toBe("+61491570006");
    expect(normalizePhone("(07) 3123 4567", TZ)).toBe("+61731234567");
    expect(normalizePhone("61491570006", TZ)).toBe("+61491570006");
    expect(normalizePhone("+61 491 570 006", TZ)).toBe("+61491570006");
    expect(normalizePhone("491570006", TZ)).toBe("+61491570006");
    expect(normalizePhone("0061491570006", TZ)).toBe("+61491570006");
  });
  test("US numbers and unreadable input", () => {
    expect(normalizePhone("(212) 555-0123", "America/New_York")).toBe("+12125550123");
    expect(normalizePhone("+44 7700 900123", TZ)).toBe("+447700900123");
    expect(normalizePhone("call me", TZ)).toBe("call me");
    expect(normalizePhone("", TZ)).toBe("");
  });
});
