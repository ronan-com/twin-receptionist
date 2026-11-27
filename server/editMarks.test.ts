// A starter template marks the facts only the business knows with "[edit]". That mark must never reach a caller:
// not in the instructions (either engine), the knowledge answers, or the greeting.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/editMarks.test.ts
import { describe, expect, test } from "bun:test";
import { blankSettings, stripEditMarks } from "../src/lib/shared";
import { TEMPLATES } from "../src/lib/templates";
import { buildInstructions, greetingOf, normaliseSettings } from "./prompt";
import { greetingFor } from "./automations";

const voices = new Map([["v1", "Grace"]]);

describe("stripEditMarks", () => {
  test("drops the mark and tidies spaces and the dangling 'of [edit]'", () => {
    expect(stripEditMarks("Check with the team [edit]")).toBe("Check with the team");
    expect(stripEditMarks("[edit] We offer courtesy cars.")).toBe("We offer courtesy cars.");
    expect(stripEditMarks("Fee applies. [edit] A call-out fee may apply.")).toBe("Fee applies. A call-out fee may apply.");
    expect(stripEditMarks("Within 30 km of [edit]")).toBe("Within 30 km of the business");
    expect(stripEditMarks("Local moves within 50 km of [edit]; interstate by quote")).toBe("Local moves within 50 km of the business; interstate by quote");
    expect(stripEditMarks("Nothing to strip.")).toBe("Nothing to strip.");
  });
});

describe("templates never put [edit] in front of a caller", () => {
  test("no template has the mark mid-sentence (it would leave a hole)", () => {
    const text = JSON.stringify(TEMPLATES);
    expect(text.match(/\[edit\] [a-z0-9]/g)).toBeNull();
    // "of [edit]" is handled by stripEditMarks; any other word before a trailing mark is fine only after a full stop.
    expect((text.match(/[A-Za-z,] \[edit\][;,.]/g) ?? []).filter((m) => !/^f \[edit\]/.test(m))).toEqual([]);
  });

  test("every template: the instructions, knowledge and greeting are clean", () => {
    expect(TEMPLATES.length).toBeGreaterThan(40);
    for (const t of TEMPLATES) {
      const s = normaliseSettings({ ...blankSettings(), businessName: "Alpha Co", voiceId: "v1", industry: t.industry, about: t.about, services: t.services, greeting: `Hi [edit] this is Alpha`, profile: { ...t.profile, template: t.id } }, voices);
      const knowledge = (t.profile.faqs ?? []).map((f) => ({ kind: "faq", question: f.q, answer: f.a }));
      const prompt = buildInstructions(s, null, knowledge);
      expect(prompt, t.id).not.toContain("[edit]");
      expect(prompt, t.id).not.toMatch(/  +\./);
      expect(greetingOf(s), t.id).not.toContain("[edit]");
    }
  });

  test("the greeting sent to the phone provider and the call's first line are clean", () => {
    const s = normaliseSettings({ ...blankSettings(), businessName: "Alpha Co", voiceId: "v1", services: ["x"], greeting: "Hello [edit] from Alpha" }, voices);
    expect(greetingOf(s)).toBe("Hello from Alpha");
    expect(greetingFor("Hello [edit] from Alpha", { recording: { enabled: false, notice: "" } } as any)).toBe("Hello from Alpha");
  });
});
