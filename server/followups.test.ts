// Unit tests for the follow-up automations: scheduling windows, quiet hours, send-once
// bookkeeping, once-per-period rules, template filling and status messages. No database
// and no phone provider.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/followups.test.ts
import { describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import {
  auMobile,
  customerKey,
  fillTemplate,
  followupPlan,
  isQuietHour,
  nextMorning,
  nextTextTime,
  reminderPlan,
  reviewAllowed,
  reviewPlan,
  sentRecently,
  whenVars,
} from "../src/lib/followups";
import { defaultAutomations, normaliseAutomations, statusFor } from "./automations";
import { checkReviewLink, defaultFollowups, deliver, followupStatuses, normaliseFollowups, renderMessage } from "./followups";

const BNE = "Australia/Brisbane"; // UTC+10, no daylight saving
const SYD = "Australia/Sydney"; // UTC+11 in summer
const at = (iso: string) => Date.parse(iso);
const H = 3_600_000;

function client(booking = true): Business {
  const now = new Date().toISOString();
  return {
    id: "11111111-2222-3333-4444-555555555555",
    assistantId: "assistant-123",
    settings: { ...blankSettings(), businessName: "Alpha Plumbing", timezone: BNE },
    instructions: "base",
    phoneNumbers: ["+61412000999"],
    ...(booking ? { booking: { provider: "builtin" as const, token: "t", minutes: 30, enabled: true, createdAt: now } } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

describe("quiet hours", () => {
  test("8pm to 8am local is quiet, the rest isn't", () => {
    expect(isQuietHour(at("2026-12-03T19:59:00+10:00"), BNE)).toBe(false);
    expect(isQuietHour(at("2026-12-03T20:00:00+10:00"), BNE)).toBe(true);
    expect(isQuietHour(at("2026-12-04T07:59:00+10:00"), BNE)).toBe(true);
    expect(isQuietHour(at("2026-12-04T08:00:00+10:00"), BNE)).toBe(false);
  });
  test("a text due in quiet hours waits until 8am local", () => {
    expect(nextTextTime(at("2026-12-03T21:30:00+10:00"), BNE)).toBe(at("2026-12-04T08:00:00+10:00"));
    expect(nextTextTime(at("2026-12-04T03:00:00+10:00"), BNE)).toBe(at("2026-12-04T08:00:00+10:00"));
    expect(nextTextTime(at("2026-12-03T12:00:00+10:00"), BNE)).toBe(at("2026-12-03T12:00:00+10:00"));
  });
  test("uses the business's zone, daylight saving included", () => {
    // 9pm Sydney in December is 10:00 UTC.
    expect(isQuietHour(at("2026-12-03T10:00:00Z"), SYD)).toBe(true);
    expect(nextTextTime(at("2026-12-03T10:00:00Z"), SYD)).toBe(at("2026-12-04T08:00:00+11:00"));
    // The same instant is 8pm in Brisbane: also quiet. A minute earlier is not.
    expect(isQuietHour(at("2026-12-03T10:00:00Z"), BNE)).toBe(true);
    expect(isQuietHour(at("2026-12-03T09:59:00Z"), BNE)).toBe(false);
    // Sydney is an hour ahead, so 09:59Z is already 8:59pm there.
    expect(isQuietHour(at("2026-12-03T09:59:00Z"), SYD)).toBe(true);
  });
  test("next morning is 9am local the day after (same day if it ends before 9am)", () => {
    expect(nextMorning(at("2026-12-03T16:30:00+10:00"), BNE)).toBe(at("2026-12-04T09:00:00+10:00"));
    expect(nextMorning(at("2026-12-03T06:00:00+10:00"), BNE)).toBe(at("2026-12-03T09:00:00+10:00"));
  });
});

describe("reminder scheduling", () => {
  const start = at("2026-12-03T14:00:00+10:00");
  const base = { start, bookedAt: at("2026-11-20T10:00:00+10:00"), hoursBefore: 24, tz: BNE, channel: "sms" as const, since: null };

  test("waits, then sends at the chosen time before", () => {
    expect(reminderPlan({ ...base, now: at("2026-12-02T13:00:00+10:00") })).toEqual({ action: "wait", until: at("2026-12-02T14:00:00+10:00") });
    expect(reminderPlan({ ...base, now: at("2026-12-02T14:00:00+10:00") })).toEqual({ action: "send" });
    expect(reminderPlan({ ...base, now: at("2026-12-02T18:00:00+10:00") })).toEqual({ action: "send" });
  });
  test("2h, 24h and 48h", () => {
    for (const [h, sendAt] of [[2, "2026-12-03T12:00:00+10:00"], [24, "2026-12-02T14:00:00+10:00"], [48, "2026-12-01T14:00:00+10:00"]] as const) {
      const plan = reminderPlan({ ...base, hoursBefore: h, now: at(sendAt) - 60_000 });
      expect(plan).toEqual({ action: "wait", until: at(sendAt) });
    }
  });
  test("a text that would land in quiet hours is queued until 8am, an email is not", () => {
    const early = at("2026-12-03T09:00:00+10:00"); // 24h before = 9am the day before: fine. 48h before = 9am two days before: fine.
    expect(reminderPlan({ ...base, start: early, hoursBefore: 24, now: at("2026-12-01T00:00:00+10:00") })).toEqual({ action: "wait", until: at("2026-12-02T09:00:00+10:00") });
    const lateEvening = at("2026-12-03T10:00:00+10:00");
    // 2 hours before 10am is 8am: allowed. 2 hours before 9:00 is 7am: pushed to 8am.
    expect(reminderPlan({ ...base, start: lateEvening, hoursBefore: 2, now: at("2026-12-03T05:00:00+10:00") })).toEqual({ action: "wait", until: at("2026-12-03T08:00:00+10:00") });
    const nine = at("2026-12-03T09:00:00+10:00");
    expect(reminderPlan({ ...base, start: nine, hoursBefore: 2, now: at("2026-12-03T06:00:00+10:00") })).toEqual({ action: "wait", until: at("2026-12-03T08:00:00+10:00") });
    expect(reminderPlan({ ...base, start: nine, hoursBefore: 2, now: at("2026-12-03T06:00:00+10:00"), channel: "email" })).toEqual({ action: "wait", until: at("2026-12-03T07:00:00+10:00") });
  });
  test("a due text during quiet hours (server was down) waits for morning", () => {
    const evening = at("2026-12-04T09:00:00+10:00");
    const plan = reminderPlan({ ...base, start: evening, now: at("2026-12-03T21:00:00+10:00") });
    expect(plan).toEqual({ action: "wait", until: at("2026-12-04T08:00:00+10:00") });
  });
  test("skipped when booked too close, too late, before switching on, or too near the start once texts are allowed", () => {
    expect(reminderPlan({ ...base, bookedAt: at("2026-12-03T10:00:00+10:00"), now: at("2026-12-03T10:05:00+10:00") })).toEqual({ action: "skip", reason: "Booked too close to the appointment" });
    expect(reminderPlan({ ...base, hoursBefore: 2, now: at("2026-12-03T13:45:00+10:00") })).toEqual({ action: "skip", reason: "Too late to remind" });
    expect(reminderPlan({ ...base, since: at("2026-12-02T20:00:00+10:00"), now: at("2026-12-02T21:00:00+10:00") })).toMatchObject({ action: "skip" });
    // 8:10am appointment, 2 hours before is 6:10am: texts go at 8am, only 10 minutes before.
    expect(reminderPlan({ ...base, start: at("2026-12-03T08:10:00+10:00"), hoursBefore: 2, now: at("2026-12-03T06:30:00+10:00") })).toMatchObject({ action: "skip" });
  });
});

describe("missed-call follow-up scheduling", () => {
  const o = { tz: BNE, since: null, maxAgeMs: 24 * H };
  test("sends once the time comes", () => {
    const dueAt = at("2026-12-03T11:05:00+10:00");
    expect(followupPlan({ ...o, dueAt, now: dueAt - 1000 })).toEqual({ action: "wait", until: dueAt });
    expect(followupPlan({ ...o, dueAt, now: dueAt + 1000 })).toEqual({ action: "send" });
  });
  test("an evening call is queued until 8am", () => {
    const dueAt = at("2026-12-03T21:05:00+10:00");
    expect(followupPlan({ ...o, dueAt, now: dueAt + 60_000 })).toEqual({ action: "wait", until: at("2026-12-04T08:00:00+10:00") });
    expect(followupPlan({ ...o, dueAt, now: at("2026-12-04T08:01:00+10:00") })).toEqual({ action: "send" });
  });
  test("skips old calls and calls from before it was switched on", () => {
    const dueAt = at("2026-12-01T11:05:00+10:00");
    expect(followupPlan({ ...o, dueAt, now: at("2026-12-03T11:05:00+10:00") })).toMatchObject({ action: "skip" });
    expect(followupPlan({ ...o, since: dueAt + H, dueAt, now: dueAt + 2 * H })).toMatchObject({ action: "skip" });
  });
});

describe("review scheduling", () => {
  const start = at("2026-12-03T14:00:00+10:00");
  const o = { start, minutes: 30, tz: BNE, channel: "sms" as const, since: null };
  test("2 hours after the appointment ends", () => {
    expect(reviewPlan({ ...o, delay: "2h", now: at("2026-12-03T16:29:00+10:00") })).toEqual({ action: "wait", until: at("2026-12-03T16:30:00+10:00") });
    expect(reviewPlan({ ...o, delay: "2h", now: at("2026-12-03T16:30:00+10:00") })).toEqual({ action: "send" });
  });
  test("the next morning at 9am", () => {
    expect(reviewPlan({ ...o, delay: "next_morning", now: at("2026-12-03T20:00:00+10:00") })).toEqual({ action: "wait", until: at("2026-12-04T09:00:00+10:00") });
    expect(reviewPlan({ ...o, delay: "next_morning", now: at("2026-12-04T09:00:00+10:00") })).toEqual({ action: "send" });
  });
  test("a late appointment's 2-hour text waits out quiet hours; email doesn't", () => {
    const late = { ...o, start: at("2026-12-03T18:30:00+10:00"), delay: "2h" as const };
    expect(reviewPlan({ ...late, now: at("2026-12-03T21:00:00+10:00") })).toEqual({ action: "wait", until: at("2026-12-04T08:00:00+10:00") });
    expect(reviewPlan({ ...late, channel: "email", now: at("2026-12-03T21:00:00+10:00") })).toEqual({ action: "send" });
  });
  test("skips appointments from before switching on, or long ago", () => {
    expect(reviewPlan({ ...o, delay: "2h", since: at("2026-12-03T20:00:00+10:00"), now: at("2026-12-03T21:00:00+10:00") })).toMatchObject({ action: "skip" });
    expect(reviewPlan({ ...o, delay: "2h", now: at("2026-12-10T10:00:00+10:00") })).toMatchObject({ action: "skip" });
  });
});

describe("once-per-period rules", () => {
  const now = at("2026-12-03T12:00:00+10:00");
  test("one text per caller per day", () => {
    expect(sentRecently(null, now, 24)).toBe(false);
    expect(sentRecently(now - 23 * H, now, 24)).toBe(true);
    expect(sentRecently(now - 25 * H, now, 24)).toBe(false);
  });
  test("one review request per customer per 90 days", () => {
    expect(reviewAllowed(null, now)).toBe(true);
    expect(reviewAllowed(now - 89 * 24 * H, now)).toBe(false);
    expect(reviewAllowed(now - 91 * 24 * H, now)).toBe(true);
  });
  test("customers are told apart by mobile, else email", () => {
    expect(customerKey("0412 345 678", "a@b.co")).toBe("+61412345678");
    expect(customerKey("+61 412 345 678", "")).toBe("+61412345678");
    expect(customerKey("", "Sam@Example.com")).toBe("email:sam@example.com");
    expect(customerKey("", "")).toBeNull();
  });
});

describe("phone numbers", () => {
  test("only Australian mobiles get texts; withheld and invalid numbers don't", () => {
    expect(auMobile("0412 345 678")).toBe("+61412345678");
    expect(auMobile("61412345678")).toBe("+61412345678");
    expect(auMobile("+61412345678")).toBe("+61412345678");
    expect(auMobile("07 3123 4567")).toBeNull();
    expect(auMobile("anonymous")).toBeNull();
    expect(auMobile("")).toBeNull();
    expect(auMobile(null)).toBeNull();
    expect(auMobile("+14155550100")).toBeNull();
  });
});

describe("sending once (idempotency)", () => {
  // An in-memory stand-in for the unique (client, dedupe_key, channel) row.
  function store() {
    const rows = new Map<string, { status: string; detail: string }>();
    const sent: string[] = [];
    const deps = (key: string, o: { veto?: string | null; fail?: boolean } = {}) => ({
      claim: async () => (rows.has(key) ? null : (rows.set(key, { status: "sending", detail: "" }), key)),
      finish: async (id: string, status: "sent" | "skipped" | "failed", detail: string) => void rows.set(id, { status, detail }),
      veto: async () => o.veto ?? null,
      send: async () => {
        if (o.fail) throw new Error("boom");
        sent.push(key);
      },
    });
    return { rows, sent, deps };
  }

  test("the same message is never sent twice, even if the job runs again", async () => {
    const s = store();
    expect(await deliver(s.deps("reminder:b1"))).toBe("sent");
    expect(await deliver(s.deps("reminder:b1"))).toBe("duplicate");
    expect(await deliver(s.deps("reminder:b1"))).toBe("duplicate");
    expect(s.sent).toEqual(["reminder:b1"]);
    expect(await deliver(s.deps("reminder:b2"))).toBe("sent");
    expect(s.sent).toEqual(["reminder:b1", "reminder:b2"]);
  });
  test("a vetoed message is recorded as skipped and not retried", async () => {
    const s = store();
    expect(await deliver(s.deps("missed:c1", { veto: "Texted this caller in the last day" }))).toBe("skipped");
    expect(s.rows.get("missed:c1")).toEqual({ status: "skipped", detail: "Texted this caller in the last day" });
    expect(await deliver(s.deps("missed:c1"))).toBe("duplicate");
    expect(s.sent).toEqual([]);
  });
  test("a failed send is recorded and not retried (so it can't double-send later)", async () => {
    const s = store();
    expect(await deliver(s.deps("review:b1", { fail: true }))).toBe("failed");
    expect(s.rows.get("review:b1")).toEqual({ status: "failed", detail: "boom" });
    expect(await deliver(s.deps("review:b1"))).toBe("duplicate");
  });
  test("two runs at once: only one gets to send", async () => {
    const s = store();
    const results = await Promise.all([deliver(s.deps("reminder:b9")), deliver(s.deps("reminder:b9"))]);
    expect(results.sort()).toEqual(["duplicate", "sent"]);
    expect(s.sent).toEqual(["reminder:b9"]);
  });
});

describe("templates", () => {
  const vars = { name: "Sam", business: "Alpha Plumbing", service: "check-up", date: "Thu 3 Dec", time: "9:30am", link: "https://g.page/r/abc/review" };
  test("fills the variables and drops unknown ones", () => {
    expect(fillTemplate("Hi {name}, {business} on {date} at {time} for {service}. {nope}", vars)).toBe("Hi Sam, Alpha Plumbing on Thu 3 Dec at 9:30am for check-up.");
  });
  test("empty values leave no stray spaces; new lines are kept", () => {
    expect(fillTemplate("Hi {name} , see {link} .", { name: "Sam" })).toBe("Hi Sam, see.");
    expect(fillTemplate("Hi {name},\n\n\n\nBye {business}", vars)).toBe("Hi Sam,\n\nBye Alpha Plumbing");
  });
  test("when a booking is, said the Australian way", () => {
    expect(whenVars("2026-12-03T09:30:00+10:00", BNE)).toEqual({ date: "Thu 3 Dec", time: "9:30am" });
    expect(whenVars("2026-12-03T14:00:00+10:00", BNE)).toEqual({ date: "Thu 3 Dec", time: "2pm" });
    expect(whenVars("nonsense", BNE)).toEqual({ date: "", time: "" });
  });
  test("texts get one opt-out line and the default reminder says to call, not to reply C or X", () => {
    const f = defaultFollowups();
    const sms = renderMessage("reminder", "sms", f, vars);
    expect(sms.text).toBe("Hi Sam, a reminder of your check-up at Alpha Plumbing on Thu 3 Dec at 9:30am. Call us to change it. Reply STOP to opt out.");
    expect(sms.text).not.toMatch(/reply c\b|reply x\b/i);
    expect(sms.text.match(/STOP/g)?.length).toBe(1);
    const email = renderMessage("reminder", "email", f, vars);
    expect(email.text).not.toContain("STOP");
    expect(email.subject).toBe("Reminder: your check-up at Alpha Plumbing, Thu 3 Dec at 9:30am");
  });
  test("missed-call and review messages", () => {
    const f = defaultFollowups();
    expect(renderMessage("missed", "sms", f, vars).text).toContain("Sorry we missed you at Alpha Plumbing.");
    const review = renderMessage("review", "sms", f, vars);
    expect(review.text).toContain("https://g.page/r/abc/review");
    expect(review.text).toContain("Alpha Plumbing");
  });
});

describe("settings", () => {
  test("all three are off by default, with templates", () => {
    const d = defaultAutomations();
    expect(d.reminders.enabled).toBe(false);
    expect(d.missedFollowup.enabled).toBe(false);
    expect(d.reviews.enabled).toBe(false);
    expect(d.reminders.smsText).toContain("{time}");
    expect(d.reviews.smsText).toContain("{link}");
  });
  test("a partial update merges onto what is there, old stored rows get the defaults", () => {
    const a = normaliseAutomations({ reminders: { enabled: true, hoursBefore: 48 } });
    expect(a.reminders).toMatchObject({ enabled: true, hoursBefore: 48, sms: true, email: false });
    const b = normaliseAutomations({ reviews: { link: "https://g.page/r/abc/review" } }, a);
    expect(b.reminders.hoursBefore).toBe(48);
    expect(b.reviews.link).toBe("https://g.page/r/abc/review");
    const old = normaliseAutomations({ transfer: { enabled: false } }, { ...defaultAutomations(), reminders: undefined } as any);
    expect(old.reminders.smsText).toBe(defaultFollowups().reminders.smsText);
  });
  test("checks the reminder time, the wait and the review link", () => {
    expect(() => normaliseFollowups({ reminders: { hoursBefore: 5 } })).toThrow(/2, 24 or 48/);
    expect(() => normaliseFollowups({ missedFollowup: { overdueHours: 0 } })).toThrow();
    expect(() => normaliseFollowups({ missedFollowup: { overdueHours: 73 } })).toThrow();
    expect(() => normaliseFollowups({ missedFollowup: { overdueHours: 2.5 } })).toThrow();
    expect(normaliseFollowups({ missedFollowup: { overdueHours: "6" } }).missedFollowup.overdueHours).toBe(6);
    expect(() => normaliseFollowups({ reviews: { link: "not a url" } })).toThrow(/valid web address/);
    expect(() => normaliseFollowups({ reviews: { link: "http://g.page/r/abc" } })).toThrow(/https/);
    expect(() => normaliseFollowups({ reviews: { link: "https://user:pw@g.page/r/abc" } })).toThrow();
    expect(() => normaliseFollowups({ reviews: { link: "https://localhost/x" } })).toThrow();
    expect(checkReviewLink("  https://search.google.com/local/writereview?placeid=ChIJ123 ")).toBe("https://search.google.com/local/writereview?placeid=ChIJ123");
    expect(checkReviewLink("")).toBe("");
  });
  test("template text is cleaned: no double braces, empty falls back to the default", () => {
    const f = normaliseFollowups({ missedFollowup: { text: "Hi {{name}} {business}" }, reminders: { smsText: "   " } });
    expect(f.missedFollowup.text).toBe("Hi name {business}");
    expect(f.reminders.smsText).toBe(defaultFollowups().reminders.smsText);
  });
});

describe("status messages", () => {
  const i = (o: Partial<Parameters<typeof followupStatuses>[2]> = {}) => ({ demo: false, smsNumber: "+61412000999" as string | null | undefined, emailReady: true, ...o });
  const on = (k: "reminders" | "missedFollowup" | "reviews", v: object = {}) => normaliseFollowups({ [k]: { enabled: true, ...v } });

  test("off", () => {
    const s = followupStatuses(client(), defaultFollowups(), i());
    expect(s.reminders.state).toBe("off");
    expect(s.missedFollowup.state).toBe("off");
    expect(s.reviews.state).toBe("off");
  });
  test("needs a phone number that can send texts", () => {
    expect(followupStatuses(client(), on("reminders"), i({ smsNumber: null })).reminders).toMatchObject({ state: "needs_setup", label: "Needs a phone number that can send texts" });
    expect(followupStatuses(client(), on("missedFollowup"), i({ smsNumber: null })).missedFollowup.label).toBe("Needs a phone number that can send texts");
    expect(followupStatuses(client(), on("reviews", { link: "https://g.page/r/a/review" }), i({ smsNumber: null })).reviews.label).toBe("Needs a phone number that can send texts");
  });
  test("needs email set up", () => {
    const f = on("reminders", { sms: false, email: true });
    expect(followupStatuses(client(), f, i({ emailReady: false })).reminders).toMatchObject({ state: "needs_setup", label: "Needs email set up" });
    expect(followupStatuses(client(), f, i({ emailReady: true })).reminders.state).toBe("on");
  });
  test("one way working is enough, and the other is explained", () => {
    const f = on("reminders", { sms: true, email: true });
    const s = followupStatuses(client(), f, i({ emailReady: false })).reminders;
    expect(s.state).toBe("on");
    expect(s.detail).toContain("email service");
  });
  test("choose a way to send; couldn't check; demo", () => {
    expect(followupStatuses(client(), on("reminders", { sms: false, email: false }), i()).reminders.label).toBe("Choose how to send");
    expect(followupStatuses(client(), on("reminders"), i({ smsNumber: undefined })).reminders.state).toBe("error");
    expect(followupStatuses(client(false), on("reminders"), i({ demo: true, smsNumber: null })).reminders.label).toBe("On (demo)");
  });
  test("reminders need booking, reviews need the link, missed-call needs a trigger", () => {
    expect(followupStatuses(client(false), on("reminders"), i()).reminders.label).toBe("Needs bookings turned on");
    expect(followupStatuses(client(), on("reviews"), i()).reviews.label).toBe("Needs your review link");
    expect(followupStatuses(client(), on("missedFollowup", { shortCall: false, callbackOverdue: false }), i()).missedFollowup.label).toBe("Choose when to text");
  });
  test("on, with the details people need", () => {
    const s = followupStatuses(client(), on("reminders", { hoursBefore: 2 }), i());
    expect(s.reminders).toMatchObject({ state: "on", label: "On · 2 hours before" });
    expect(s.reminders.detail).toContain("8pm and 8am");
    const m = followupStatuses(client(), on("missedFollowup", { overdueHours: 1 }), i()).missedFollowup;
    expect(m.state).toBe("on");
    expect(m.detail).toContain("10 seconds");
    expect(m.detail).toContain("within 1 hour.");
    const r = followupStatuses(client(), on("reviews", { link: "https://g.page/r/a/review", delay: "2h" }), i()).reviews;
    expect(r).toMatchObject({ state: "on", label: "On · 2 hours after" });
    expect(r.detail).toContain("90 days");
  });
  test("statusFor includes them alongside the others", () => {
    const a = normaliseAutomations({ reminders: { enabled: true } });
    const s = statusFor(client(), a, { demo: false, smsNumber: "+61412000999", publicUrl: "https://x.example", applied: true, emailReady: true });
    expect(s.reminders.state).toBe("on");
    expect(s.missedFollowup.state).toBe("off");
    expect(s.reviews.state).toBe("off");
    expect(s.transfer.state).toBe("off");
  });
});
