// Area R: the receptionist page's persona, conversation and pause fields reach the script.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/prompt.test.ts
import { describe, expect, test } from "bun:test";
import { alwaysOpen, blankSettings, defaultHours, describeHours, greetingsFor, INDUSTRIES } from "../src/lib/shared";
import { openNow } from "./automations";
import { industryKeyOf, industryLabelOf } from "./answered";
import { DEFAULT_PAUSE_MESSAGE, buildInstructions, greetingOf, normaliseSettings } from "./prompt";

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

  test("ready-made greetings keep the AI and recording lines; childcare leads with the centre's", () => {
    for (const i of INDUSTRIES) {
      for (const g of greetingsFor(i.key, "Little Gum Trees", "Chloe")) {
        expect(g.text).toContain("AI");
        expect(g.text).toContain("recorded");
      }
    }
    const [first] = greetingsFor("childcare", "Little Gum Trees", "Chloe");
    expect(first.text).toBe(
      "Thanks for calling Little Gum Trees. I'm Chloe, the centre's AI receptionist, and this call is recorded. I can help with enrolments, tours and general questions. If you'd prefer to speak with the team, just let me know.",
    );
    expect(greetingsFor("vet", "Paws", "").some((g) => g.label === "Urgent calls first")).toBe(true);
    expect(greetingsFor("legal", "Smith Law", "").some((g) => g.label === "Urgent calls first")).toBe(false);
  });
});
