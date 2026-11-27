// Helper's browser pieces: remembered state, what is read aloud, the confirm card.
//   bun test src/components/helper/helper.test.tsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmCard } from "./ConfirmCard";
import { loadPrefs, savePrefs } from "./prefs";
import { speakable } from "./voice";

const card = { type: "confirm" as const, id: "c1", title: 'Create receptionist "Bondi Physio"?', lines: ["Business: Bondi Physio (as a new client)", "Hours: Mon 09:00-17:00"] };

describe("remembered state", () => {
  const fake = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  test("is per person, and everything starts off", () => {
    const store = fake();
    expect(loadPrefs("u1", store)).toEqual({ open: false, mini: false, speak: false });
    savePrefs("u1", { open: true, mini: false, speak: true }, store);
    expect(loadPrefs("u1", store)).toEqual({ open: true, mini: false, speak: true });
    expect(loadPrefs("u2", store).speak).toBe(false);
  });
  test("blocked or broken storage never throws", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadPrefs("u1", broken).open).toBe(false);
    expect(() => savePrefs("u1", { open: true, mini: true, speak: true }, broken)).not.toThrow();
    expect(loadPrefs("u1", { getItem: () => "{not json" }).speak).toBe(false);
  });
});

describe("what is read aloud", () => {
  test("no links, symbols or list marks", () => {
    expect(speakable("Open **Clients** then [Calls](/admin/calls).\n\n1. Press `New`\n- Done")).toBe("Open Clients then Calls. Press New Done");
  });
  test("long answers stop at a sentence", () => {
    const long = "This is a sentence. ".repeat(60);
    const out = speakable(long, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".")).toBe(true);
  });
});

describe("confirm card", () => {
  test("shows what will happen with Do it and Cancel", () => {
    const html = renderToStaticMarkup(<ConfirmCard card={card} onDo={() => {}} onCancel={() => {}} />);
    expect(html).toContain("Create receptionist &quot;Bondi Physio&quot;?");
    expect(html).toContain("Mon 09:00-17:00");
    expect(html).toContain("data-helper-do");
    expect(html).toContain("data-helper-cancel");
  });
  test("after an answer the buttons are gone", () => {
    for (const s of ["done", "cancelled", "error"] as const) {
      const html = renderToStaticMarkup(<ConfirmCard card={card} state={{ s, text: "Connect your phone account first." }} onDo={() => {}} onCancel={() => {}} />);
      expect(html).not.toContain("data-helper-do");
      expect(html).toContain(`data-helper-card-state="${s}"`);
    }
  });
});
