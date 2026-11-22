// Area R: the receptionist page's persona, conversation and pause fields reach the script.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/prompt.test.ts
import { describe, expect, test } from "bun:test";
import { blankSettings } from "../src/lib/shared";
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
