// Area R: the receptionist page's persona, conversation and pause fields reach the script.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/prompt.test.ts
import { describe, expect, test } from "bun:test";
import { alwaysOpen, blankSettings, defaultHours, describeHours, greetingsFor, INDUSTRIES, withoutRecordingLine } from "../src/lib/shared";
import { openNow } from "./automations";
import { industryKeyOf, industryLabelOf } from "./answered";
import { DEFAULT_PAUSE_MESSAGE, buildInstructions, cleanProfile, greetingOf, normaliseSettings } from "./prompt";

const voices = new Map([["v1", "Grace"]]);
const base = { ...blankSettings(), businessName: "Alpha Plumbing", voiceId: "v1", services: ["Blocked drain"] };

describe("receptionist depth fields", () => {
  test("are kept by normaliseSettings and appear in the instructions", () => {
    const s = normaliseSettings(
      {
        ...base,
        tone: "calm",
        personality: "Patient with older callers.",
        dialect: "en-GB",
        closing: "Cheers for calling Alpha!",
        avoid: ["Quotes over the phone", " "],
        faqStyle: "detailed",
        collect: ["email", "address", "bogus"],
        questions: ["Is it a house or a unit?"],
      },
      voices,
    );
    expect(s.tone).toBe("calm");
    expect(s.collect).toEqual(["email", "address"]);
    expect(s.avoid).toEqual(["Quotes over the phone"]);
    const ins = buildInstructions(s);
    expect(ins).toContain("British English");
    expect(ins).toContain("Calm, patient and reassuring");
    expect(ins).toContain("Personality: Patient with older callers.");
    expect(ins).toContain('"Cheers for calling Alpha!"');
    expect(ins).toContain("Never discuss or give opinions on: Quotes over the phone");
    expect(ins).toContain("give the full answer");
    expect(ins).toContain("their email address");
    expect(ins).toContain("the street address");
    expect(ins).toContain("- Is it a house or a unit?");
  });

  test("defaults leave the script as before (Australian English, short answers)", () => {
    const s = normaliseSettings(base, voices);
    expect(s.dialect).toBeUndefined();
    expect(s.personality).toBeUndefined();
    const ins = buildInstructions(s);
    expect(ins).toContain("- Australian English. Warm, relaxed and friendly");
    expect(ins).toContain("keep it to a sentence or two");
    expect(ins).not.toContain("Never discuss");
  });

  test("fields left out keep their current value; explicit empties clear them", () => {
    const current = normaliseSettings({ ...base, personality: "Chirpy", questions: ["Q1"] }, voices);
    const kept = normaliseSettings({ ...base }, voices, current);
    expect(kept.personality).toBe("Chirpy");
    expect(kept.questions).toEqual(["Q1"]);
    const cleared = normaliseSettings({ ...base, personality: "", questions: [] }, voices, current);
    expect(cleared.personality).toBeUndefined();
    expect(cleared.questions).toBeUndefined();
  });

  test("paused: the greeting is the pause message and the script only takes a message", () => {
    const s = normaliseSettings({ ...base, greeting: "Hi there", paused: { at: "2026-11-23T00:00:00.000Z", message: "" } }, voices);
    expect(s.paused?.message).toBe(DEFAULT_PAUSE_MESSAGE);
    expect(greetingOf(s)).toBe(DEFAULT_PAUSE_MESSAGE);
    const ins = buildInstructions(s, { minutes: 30 });
    expect(ins).toContain("paused its receptionist");
    expect(ins).toContain("Do not book");
    expect(ins).toContain("request_callback");
    expect(ins).not.toContain("check_availability");
    const resumed = normaliseSettings({ ...s, paused: null }, voices, s);
    expect(resumed.paused).toBeUndefined();
    expect(greetingOf(resumed)).toBe("Hi there");
  });
});

describe("setup wizard fields", () => {
  test("24/7 hours survive cleaning, read as 24/7 and count as open at midnight", () => {
    const s = normaliseSettings({ ...base, hours: alwaysOpen() }, voices);
    expect(Object.values(s.hours).every((h) => h.open && h.from === "00:00" && h.to === "23:59")).toBe(true);
    expect(describeHours(s.hours)).toEqual(["Open 24 hours, 7 days (24/7)"]);
    expect(buildInstructions(s)).toContain("- Open 24 hours, 7 days (24/7)");
    expect(openNow({ hours: s.hours, timezone: "Australia/Brisbane" }, new Date("2026-11-27T13:59:30Z"))).toBe(true); // 23:59 in Brisbane
    const oneDay = { ...defaultHours("dental"), sun: { open: true, from: "00:00", to: "23:59" } };
    expect(describeHours(oneDay)).toContain("Sunday: open 24 hours");
  });

  test("a custom business type is the business noun, and is dropped for a preset type", () => {
    const s = normaliseSettings({ ...base, industry: "other", industryLabel: "Florist." }, voices);
    expect(s.industryLabel).toBe("Florist");
    expect(buildInstructions(s)).toContain("Alpha Plumbing, a florist in Australia");
    const events = normaliseSettings({ ...base, industry: "other", industryLabel: "events company" }, voices);
    expect(buildInstructions(events)).toContain("an events company");
    const kept = normaliseSettings({ ...base, industry: "other" }, voices, s);
    expect(kept.industryLabel).toBe("Florist");
    const vet = normaliseSettings({ ...base, industry: "vet", industryLabel: "Florist" }, voices, s);
    expect(vet.industryLabel).toBeUndefined();
    expect(buildInstructions(vet)).toContain("a vet clinic");
  });

  test("closures, what the business does and how to say its name reach the instructions", () => {
    const s = normaliseSettings(
      { ...base, closures: "Closed national public holidays\n\nClosed 24 Dec to 6 Jan ", about: "Family-run plumbers since 1990.", sayName: "AL-fa" },
      voices,
    );
    expect(s.closures).toBe("Closed national public holidays; Closed 24 Dec to 6 Jan");
    const ins = buildInstructions(s);
    expect(ins).toContain("- Closures and public holidays: Closed national public holidays; Closed 24 Dec to 6 Jan.");
    expect(ins).toContain("What the business does: Family-run plumbers since 1990.");
    expect(ins).toContain('Say the business name like this: "AL-fa"');
    const paused = buildInstructions({ ...s, paused: { at: "2026-11-23T00:00:00.000Z", message: "Back soon" } });
    expect(paused).toContain("Closures and public holidays");
    expect(normaliseSettings({ ...base, closures: "" }, voices, s).closures).toBeUndefined();
  });

  test("every business type has valid default hours and a workspace label", () => {
    for (const i of INDUSTRIES) {
      const s = normaliseSettings({ ...base, industry: i.key, hours: defaultHours(i.key), services: i.services }, voices);
      expect(Object.values(s.hours).some((h) => h.open)).toBe(true);
      expect(s.hours).toEqual(defaultHours(i.key));
      expect(industryLabelOf(i.key)).not.toBe(undefined);
    }
    expect(industryKeyOf("Legal")).toBe("legal");
    expect(industryKeyOf("vet")).toBe("vet");
  });

  test("ready-made greetings say it's an AI but never that the call is recorded; childcare leads with the centre's", () => {
    for (const i of INDUSTRIES) {
      for (const g of greetingsFor(i.key, "Little Gum Trees", "Chloe")) {
        expect(g.text).toContain("AI");
        expect(g.text).not.toContain("recorded");
      }
    }
    const [first] = greetingsFor("childcare", "Little Gum Trees", "Chloe");
    expect(first.text).toBe(
      "Thanks for calling Little Gum Trees. I'm Chloe, the centre's AI receptionist. I can help with enrolments, tours and general questions. If you'd prefer to speak with the team, just let me know.",
    );
    expect(withoutRecordingLine("Hi, you've reached Paws. I'm Chloe, the AI assistant here, and this call is recorded. How can I help?")).toBe(
      "Hi, you've reached Paws. I'm Chloe, the AI assistant here. How can I help?",
    );
    expect(withoutRecordingLine("Hi, Paws. This call is recorded. I'm an AI assistant. How can I help?")).toBe("Hi, Paws. I'm an AI assistant. How can I help?");
    expect(withoutRecordingLine("Hi, Paws. I'm the AI assistant. How can I help?")).toBe("Hi, Paws. I'm the AI assistant. How can I help?");
    expect(greetingsFor("vet", "Paws", "").some((g) => g.label === "Urgent calls first")).toBe(true);
    expect(greetingsFor("legal", "Smith Law", "").some((g) => g.label === "Urgent calls first")).toBe(false);
  });
});

describe("receptionist profile", () => {
  const withProfile = (profile: unknown) => normaliseSettings({ ...base, profile }, voices);
  const script = (profile: unknown, booking: { minutes: number } | null = null) => buildInstructions(withProfile(profile), booking);

  test("the cleaner rejects junk and keeps good values", () => {
    expect(cleanProfile(null)).toEqual({});
    expect(cleanProfile("nope")).toEqual({});
    expect(cleanProfile([1, 2])).toEqual({});
    expect(
      cleanProfile({
        template: "Dental General!!",
        tone: "sarcastic",
        bookingMode: "teleport",
        appointmentMinutes: "abc",
        bufferMinutes: null,
        bookingNotice: "yesterday",
        bookingWindowDays: {},
        priceAnswers: "free",
        newCustomers: "x",
        emergencies: "panic",
        callerFields: ["name", "ssn", "phone", "name"],
        serviceDetails: [{ name: " " }, "junk", { name: "Clean", minutes: "x", price: "  " }],
        faqs: [{ q: "Q", a: "" }, { q: "", a: "A" }],
        paymentMethods: [" ", "Card", "card"],
        alwaysDo: [],
      }),
    ).toEqual({ callerFields: ["name", "phone"], serviceDetails: [{ name: "Clean" }], paymentMethods: ["Card"] });
    const good = cleanProfile({
      template: "dental-general",
      tone: "calm",
      bookingMode: "request",
      appointmentMinutes: 44,
      bufferMinutes: 0,
      bookingNotice: "24h",
      bookingWindowDays: 100,
      serviceDetails: [{ name: "Check-up", minutes: 30.4, price: "$90", notes: "Includes x-rays" }],
      priceAnswers: "from_price",
      newCustomers: "waitlist",
      emergencies: "advise_000",
      faqs: [{ q: "Parking?", a: "Out the back." }],
    });
    expect(good).toMatchObject({ template: "dental-general", tone: "calm", bookingMode: "request", appointmentMinutes: 45, bufferMinutes: 0, bookingNotice: "24h", bookingWindowDays: 90, priceAnswers: "from_price" });
    expect(good.serviceDetails).toEqual([{ name: "Check-up", minutes: 30, price: "$90", notes: "Includes x-rays" }]);
    expect(good.faqs).toEqual([{ q: "Parking?", a: "Out the back." }]);
  });

  test("the cleaner trims, strips template braces and caps lengths and counts", () => {
    const p = cleanProfile({
      cancellationPolicy: `  24 hours {{telnyx}}\n notice ${"x".repeat(900)}`,
      serviceDetails: Array.from({ length: 50 }, (_, i) => ({ name: `S${i}`, minutes: 9999 })),
      alwaysDo: Array.from({ length: 30 }, (_, i) => `Do ${i}`),
    });
    expect(p.cancellationPolicy!.length).toBeLessThanOrEqual(400);
    expect(p.cancellationPolicy).not.toContain("{");
    expect(p.cancellationPolicy).not.toContain("\n");
    expect(p.serviceDetails).toHaveLength(30);
    expect(p.serviceDetails![0].minutes).toBe(480);
    expect(p.alwaysDo).toHaveLength(10);
  });

  test("normaliseSettings stores it, keeps it when left out and clears it when empty", () => {
    const s = withProfile({ tone: "calm", bogus: 1 });
    expect(s.profile).toEqual({ tone: "calm" });
    expect(normaliseSettings({ ...base }, voices, s).profile).toEqual({ tone: "calm" });
    expect(normaliseSettings({ ...base, profile: {} }, voices, s).profile).toBeUndefined();
    expect(normaliseSettings({ ...base, profile: null }, voices, s).profile).toBeUndefined();
    expect(withProfile("junk").profile).toBeUndefined();
  });

  test("an empty profile leaves the script exactly as it was", () => {
    expect(script({})).toBe(buildInstructions(normaliseSettings(base, voices)));
  });

  test("each section appears when set and not when empty", () => {
    const empty = script({ tone: "calm" });
    for (const heading of ["How bookings work", "Services, lengths", "Price questions", "Details to collect", "New customers", "Emergencies", "Policies and practical", "Always\n", "Never\n"]) {
      expect(empty).not.toContain(heading);
    }
    expect(empty).toContain("Tone for this business");
    expect(empty).toContain("Calm, patient and reassuring");

    const full = script(
      {
        bookingMode: "book",
        appointmentMinutes: 45,
        bufferMinutes: 10,
        bookingNotice: "24h",
        bookingWindowDays: 30,
        serviceDetails: [{ name: "Check-up", minutes: 30, price: "$90", notes: "Includes x-rays" }],
        priceAnswers: "quote",
        callerFields: ["name", "phone", "health_fund", "dob"],
        newCustomers: "existing_only",
        emergencies: "advise_000",
        emergencyNote: "Swelling or a knocked-out tooth",
        cancellationPolicy: "24 hours notice",
        paymentMethods: ["Card", "HICAPS"],
        parking: "Free out the back",
        accessibility: "Step-free entry",
        serviceArea: "Within 20km of Manly",
        languages: ["English", "Vietnamese"],
        alwaysDo: ["Confirm the spelling of names"],
        neverDo: ["Give medical advice"],
        faqs: [{ q: "Do you do whitening?", a: "Yes, in clinic." }],
      },
      { minutes: 30 },
    );
    expect(full).toContain("How bookings work");
    expect(full).toContain("Appointments are 30 minutes"); // the real calendar length wins
    expect(full).toContain("leaves 10 minutes between bookings");
    expect(full).toContain("at least 24 hours' notice");
    expect(full).toContain("up to 30 days ahead");
    expect(full).toContain("Check-up (about 30 minutes, $90): Includes x-rays");
    expect(full).toContain("give the exact price");
    expect(full).toContain("ask for: health fund; date of birth");
    expect(full).toContain("Only existing customers can book");
    expect(full).toContain("hang up and call 000");
    expect(full).toContain("What counts as urgent here: Swelling or a knocked-out tooth.");
    expect(full).toContain("Cancellations: 24 hours notice.");
    expect(full).toContain("Payment: Card, HICAPS.");
    expect(full).toContain("Parking: Free out the back.");
    expect(full).toContain("Accessibility: Step-free entry.");
    expect(full).toContain("Service area: Within 20km of Manly.");
    expect(full).toContain("you may continue in that language");
    expect(full).toContain("- Confirm the spelling of names");
    expect(full).toContain("- Give medical advice");
    // FAQs are published as knowledge items, so the profile doesn't repeat them.
    expect(full).not.toContain("Do you do whitening?");
  });

  test("urgent messages are taken when there is no 000 advice", () => {
    expect(script({ emergencies: "take_urgent_message" }, { minutes: 30 })).toContain("request_callback with the reason starting URGENT");
    expect(script({ emergencies: "not_applicable", emergencyNote: "ignored" })).not.toContain("Emergencies");
    expect(script({ emergencies: "advise_000" })).not.toContain("request_callback");
  });

  test("price modes", () => {
    const services = [{ name: "Blocked drain", price: "$180" }];
    expect(script({ serviceDetails: services, priceAnswers: "quote" })).toContain("Blocked drain ($180)");
    expect(script({ serviceDetails: services, priceAnswers: "quote" })).toContain("give the exact price listed");
    expect(script({ serviceDetails: services })).toContain("give the exact price listed");
    expect(script({ serviceDetails: services, priceAnswers: "from_price" })).toContain('say "from"');
    expect(script({ serviceDetails: services, priceAnswers: "range" })).toContain("rough range");
    const none = script({ serviceDetails: services, priceAnswers: "no_quote" }, { minutes: 30 });
    expect(none).not.toContain("$180");
    expect(none).toContain("Never give or guess a price");
    expect(none).toContain("request_callback");
    expect(script({ priceAnswers: "no_quote" })).toContain("offer to pass on a message");
    // Nothing priced, nothing to quote.
    expect(script({ serviceDetails: [{ name: "Blocked drain" }], priceAnswers: "quote" })).not.toContain("Price questions");
  });

  test("booking modes: book uses the calendar, request can't book, message_only offers no times", () => {
    const live = { minutes: 30 };
    const book = script({ bookingMode: "book" }, live);
    expect(book).toContain("check_availability");
    expect(book).toContain("Call book_appointment");

    const request = script({ bookingMode: "request" }, live);
    expect(request).toContain("check_availability");
    expect(request).not.toContain("Call book_appointment");
    expect(request).toContain("Never say a booking is confirmed");
    expect(request).toContain("request_callback");

    const message = script({ bookingMode: "message_only", appointmentMinutes: 60, bufferMinutes: 10, bookingNotice: "24h" }, live);
    expect(message).not.toContain("check_availability");
    expect(message).not.toContain("book_appointment");
    expect(message).toContain("You do not make bookings or offer times");
    expect(message).toContain("request_callback with it");
    expect(message).not.toContain("minutes between bookings");
    expect(message).not.toContain("Appointments are");

    // Without a calendar there is no callback tool, in any mode.
    expect(script({ bookingMode: "message_only" })).not.toContain("request_callback");
    expect(script({ bookingMode: "request" })).not.toContain("check_availability");
  });

  test("a paused receptionist ignores the profile", () => {
    const s = { ...withProfile({ tone: "calm", cancellationPolicy: "24 hours" }), paused: { at: new Date().toISOString(), message: "Back soon." } };
    const ins = buildInstructions(s);
    expect(ins).not.toContain("Cancellations");
    expect(ins).toContain("paused");
  });
});
