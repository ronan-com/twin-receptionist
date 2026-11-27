// Unit tests for the assistant payloads the automations generate. No database and no
// phone provider: only the pure builders are called.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/automations.test.ts
import { describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import {
  auNumber,
  automationInstructions,
  chooseText,
  defaultAutomations,
  fill,
  normaliseAutomations,
  openNow,
  overlayPayload,
  statusFor,
  telephonyPayload,
  transferTool,
  type AutomationSettings,
} from "./automations";

const hours = {
  mon: { open: true, from: "08:00", to: "17:00" },
  tue: { open: true, from: "08:00", to: "17:00" },
  wed: { open: true, from: "08:00", to: "17:00" },
  thu: { open: true, from: "08:00", to: "17:00" },
  fri: { open: true, from: "08:00", to: "17:00" },
  sat: { open: false, from: "09:00", to: "12:00" },
  sun: { open: false, from: "09:00", to: "12:00" },
};

function client(phoneNumbers: string[] = ["+61412000999"]): Business {
  const now = new Date().toISOString();
  return {
    id: "11111111-2222-3333-4444-555555555555",
    assistantId: "assistant-123",
    settings: { ...blankSettings(), businessName: "Alpha Plumbing", timezone: "Australia/Brisbane", hours, greeting: "Hi, Alpha Plumbing, Mia speaking." },
    instructions: "base",
    phoneNumbers,
    createdAt: now,
    updatedAt: now,
  };
}

const withSection = <K extends keyof AutomationSettings>(k: K, v: Partial<AutomationSettings[K]>): AutomationSettings =>
  normaliseAutomations({ [k]: v });

const opts = { publicUrl: "https://answered.example", token: "tok_abcdefghijklmnop" };

describe("settings", () => {
  test("defaults are all off, English (AU), 30 minutes", () => {
    const d = defaultAutomations();
    expect([d.transfer.enabled, d.textBack.enabled, d.recording.enabled, d.hoursMode.enabled]).toEqual([false, false, false, false]);
    expect(d.language.code).toBe("en-AU");
    expect(d.callLimits).toEqual({ maxMinutes: 30, idleSeconds: 60 });
  });

  test("Australian numbers are normalised to E.164", () => {
    expect(auNumber("0412 345 678")).toBe("+61412345678");
    expect(auNumber("(07) 3123 4567")).toBe("+61731234567");
    expect(auNumber("+61 2 9876 5432")).toBe("+61298765432");
    expect(auNumber("")).toBe("");
    expect(() => auNumber("+1 415 555 0100")).toThrow();
    expect(() => auNumber("1900 123 456")).toThrow();
  });

  test("a partial update merges onto the current settings and is checked", () => {
    const cur = withSection("transfer", { enabled: true, number: "0412345678" });
    const next = normaliseAutomations({ recording: { enabled: true } }, cur);
    expect(next.transfer.number).toBe("+61412345678");
    expect(next.recording.enabled).toBe(true);
    expect(() => normaliseAutomations({ transfer: { enabled: true, number: "" } })).toThrow("Add the number");
    expect(() => normaliseAutomations({ transfer: { enabled: true, number: "0412345678", onRequest: false, urgent: false, cantHelp: false } })).toThrow();
    expect(() => normaliseAutomations({ callLimits: { maxMinutes: 500 } })).toThrow();
    expect(normaliseAutomations({ language: { code: "klingon" } }).language.code).toBe("en-AU");
  });

  test("template braces from people are stripped", () => {
    const a = normaliseAutomations({ textBack: { afterCallText: "Thanks {{telnyx_secret}} from {business}" } });
    expect(a.textBack.afterCallText).toBe("Thanks telnyx_secret from {business}");
    expect(fill("Hi {name}, {business}{unknown}.", { name: "Sam", business: "Alpha" })).toBe("Hi Sam, Alpha.");
  });
});

describe("1. transfer", () => {
  test("adds a transfer tool with the target and the receptionist's number as from", () => {
    const a = withSection("transfer", { enabled: true, number: "0733334444", name: "Sam" });
    expect(transferTool(client(), a)).toEqual({
      type: "transfer",
      transfer: {
        description: "Put the caller through to Sam when the caller asks to speak to a person, or it is urgent. Only on a phone call.",
        targets: [{ name: "Sam", to: "+61733334444" }],
        from: "+61412000999",
        voicemail_detection: { detection_mode: "premium", on_voicemail_detected: { action: "stop_transfer" } },
      },
    });
  });

  test("no tool when off, without a from number, or when it would call itself", () => {
    expect(transferTool(client(), defaultAutomations())).toBeNull();
    expect(transferTool(client([]), withSection("transfer", { enabled: true, number: "0733334444" }))).toBeNull();
    expect(transferTool(client(), withSection("transfer", { enabled: true, number: "0412000999" }))).toBeNull();
  });

  test("voicemail detection can be left off", () => {
    const t = transferTool(client(), withSection("transfer", { enabled: true, number: "0733334444", voicemail: "off" }))!;
    expect("voicemail_detection" in t.transfer).toBe(false);
  });

  test("the overlay appends the tool and the hours rule to the script", () => {
    const a = withSection("transfer", { enabled: true, number: "0733334444", when: "hours" });
    const hangup = { type: "hangup", hangup: { description: "bye" } };
    const out = overlayPayload(client(), a, { instructions: "BASE", tools: [hangup] }, opts);
    expect(out.tools as unknown[]).toEqual([hangup, transferTool(client(), a)]);
    expect(out.instructions).toStartWith("BASE\n\nAutomations");
    expect(out.instructions).toContain("{{twin_open_now}}");
    expect(out.instructions).toContain("Only transfer while the business is open");
    const always = overlayPayload(client(), withSection("transfer", { enabled: true, number: "0733334444", when: "always" }), { instructions: "B" }, opts);
    expect(always.instructions).not.toContain("Only transfer while");
  });
});

describe("2. text-back", () => {
  const a = withSection("textBack", { enabled: true });
  test("a booking gets a confirmation with the time in the business's zone", () => {
    const r = chooseText(client(), a, { durationSeconds: 140, from: "+61412000111" }, { name: "Sam Lee", service: "Blocked drain", start: "2026-12-01T14:15:00+10:00" });
    expect(r).toEqual({
      kind: "booking",
      text: "Hi Sam, thanks for calling Alpha Plumbing. You're booked in for Blocked drain on Tue 1 Dec, 2:15pm. Reply here if you need to change it. Reply STOP to opt out.",
    });
  });
  test("a short call is a missed call; a normal one gets the thank-you", () => {
    expect(chooseText(client(), a, { durationSeconds: 5, from: "+61412000111" }, null)).toMatchObject({ kind: "missed_call" });
    expect(chooseText(client(), a, { durationSeconds: 90, from: "+61412000111" }, null)).toMatchObject({ kind: "after_call" });
  });
  test("landlines, unknown numbers and switched-off kinds are skipped", () => {
    expect(chooseText(client(), a, { durationSeconds: 90, from: "+61733334444" }, null)).toEqual({ skip: "Not an Australian mobile" });
    expect(chooseText(client(), a, { durationSeconds: 90, from: null }, null)).toHaveProperty("skip");
    const noMissed = withSection("textBack", { enabled: true, missedCall: false });
    expect(chooseText(client(), noMissed, { durationSeconds: 3, from: "+61412000111" }, null)).toEqual({ skip: "Missed-call texts are off" });
  });
  test("status says when a mobile number is needed", () => {
    const s = statusFor(client(), a, { demo: false, smsNumber: null, publicUrl: "", applied: true });
    expect(s.textBack).toMatchObject({ state: "needs_setup", label: "Needs a mobile number" });
    const ok = statusFor(client(), a, { demo: false, smsNumber: "+61412000999", publicUrl: "", applied: true });
    expect(ok.textBack).toMatchObject({ state: "on", label: "On · from 0412000999" });
  });
});

describe("3. recording", () => {
  test("on: recording_settings.enabled true and the notice follows the greeting", () => {
    const a = withSection("recording", { enabled: true, notice: "This call is recorded." });
    expect(telephonyPayload(a).telephony_settings.recording_settings).toEqual({ enabled: true, channels: "dual", format: "mp3" });
    const out = overlayPayload(client(), a, { greeting: "Hi, Alpha Plumbing." }, opts);
    expect(out.greeting).toBe("Hi, Alpha Plumbing. This call is recorded.");
  });
  test("old greetings that say 'this call is recorded' follow the setting", () => {
    const old = "Hi, you've reached Alpha Plumbing. I'm Chloe, the AI assistant here, and this call is recorded. How can I help?";
    const off = overlayPayload(client(), defaultAutomations(), { greeting: old }, opts).greeting;
    expect(off).toBe("Hi, you've reached Alpha Plumbing. I'm Chloe, the AI assistant here. How can I help?");
    expect(off).not.toContain("recorded");
    const a = withSection("recording", { enabled: true, notice: "This call is recorded." });
    const on = overlayPayload(client(), a, { greeting: old }, opts).greeting;
    expect(on).toBe("Hi, you've reached Alpha Plumbing. I'm Chloe, the AI assistant here. How can I help? This call is recorded.");
    expect(on?.match(/recorded/g)?.length).toBe(1);
  });
  test("off: recording is switched off explicitly (Telnyx records by default)", () => {
    expect(telephonyPayload(defaultAutomations()).telephony_settings.recording_settings.enabled).toBe(false);
    expect(overlayPayload(client(), defaultAutomations(), { greeting: "Hi." }, opts).greeting).toBe("Hi.");
  });
  test("status before anything was applied says what the provider does by default", () => {
    expect(statusFor(client(), defaultAutomations(), { demo: false, smsNumber: null, publicUrl: "", applied: false }).recording.state).toBe("needs_setup");
  });
});

describe("4. language", () => {
  test("English (AU) listens in English; multi auto-detects and the script says to reply in kind", () => {
    expect(telephonyPayload(defaultAutomations()).transcription).toEqual({ model: "deepgram/flux", language: "en" });
    const multi = withSection("language", { code: "multi" });
    expect(telephonyPayload(multi).transcription).toEqual({ model: "deepgram/flux", language: "multi" });
    expect(automationInstructions(client(), multi)).toContain("reply in that language");
  });
});

describe("5. call limits", () => {
  test("time limit and silence timeout, keeping the assistant's other telephony settings", () => {
    const a = withSection("callLimits", { maxMinutes: 12, idleSeconds: 25 });
    const current = { default_texml_app_id: "texml-1", supports_unauthenticated_web_calls: true, noise_suppression: "krisp" };
    expect(telephonyPayload(a, current).telephony_settings as Record<string, unknown>).toEqual({
      default_texml_app_id: "texml-1",
      supports_unauthenticated_web_calls: true,
      noise_suppression: "krisp",
      time_limit_secs: 720,
      user_idle_timeout_secs: 25,
      recording_settings: { enabled: false, channels: "dual", format: "mp3" },
    });
  });
});

describe("6. after-hours mode", () => {
  const a = withSection("hoursMode", { enabled: true });
  test("greeting comes from the dynamic-variables webhook, with the normal one as the default", () => {
    const out = overlayPayload(client(), a, { greeting: "Hi, Alpha Plumbing." }, opts);
    expect(out.greeting).toBe("{{twin_greeting}}");
    expect(out.dynamic_variables).toEqual({ twin_greeting: "Hi, Alpha Plumbing.", twin_open_now: "unknown" });
    expect(out.dynamic_variables_webhook_url).toBe(`https://answered.example/hooks/automations/${client().id}/tok_abcdefghijklmnop`);
    expect(out.instructions).toBeUndefined();
  });
  test("without a public address no webhook is set", () => {
    const out = overlayPayload(client(), a, { greeting: "Hi." }, { publicUrl: "", token: "t" });
    expect("dynamic_variables_webhook_url" in out).toBe(false);
  });
  test("the script says messages only, no bookings while closed", () => {
    const text = automationInstructions(client(), a);
    expect(text).toContain("When the business is closed: take a message");
    expect(text).toContain("Don't check availability");
    expect(automationInstructions(client(), withSection("hoursMode", { enabled: true, mode: "message_and_booking" }))).toContain("still offer bookings");
  });
  test("open/closed in the business's time zone", () => {
    const tz = { hours, timezone: "Australia/Brisbane" };
    expect(openNow(tz, new Date("2026-11-24T00:30:00Z"))).toBe(true); // Tue 10:30am Brisbane
    expect(openNow(tz, new Date("2026-11-24T08:00:00Z"))).toBe(false); // Tue 6pm
    expect(openNow(tz, new Date("2026-11-28T00:30:00Z"))).toBe(false); // Sat
  });
  test("nothing stored or nothing on: the payload goes through as it is", () => {
    const base = { instructions: "B", tools: [], greeting: "G" };
    const out = overlayPayload(client(), defaultAutomations(), base, opts);
    expect(out.instructions).toBe("B");
    expect(out.tools).toEqual([]);
    expect(out.greeting).toBe("G");
  });
});

describe("returning-caller memory in the payload", () => {
  const o = { publicUrl: "https://app.example.com", token: "tok_0123456789abcdef", callerMemory: true };
  test("adds the script line, an empty default variable and the webhook, even with every automation off", () => {
    const out = overlayPayload(client(), defaultAutomations(), { instructions: "BASE", greeting: "Hi." }, o) as any;
    expect(out.instructions).toContain("{{twin_caller_context}}");
    expect(out.dynamic_variables.twin_caller_context).toBe("");
    expect(out.dynamic_variables_webhook_url).toContain("/hooks/automations/");
  });
  test("is not offered without a public address or key (the line would show raw braces)", () => {
    expect((overlayPayload(client(), defaultAutomations(), { instructions: "BASE" }, { ...o, publicUrl: "" }) as any).instructions).toBe("BASE");
    expect((overlayPayload(client(), defaultAutomations(), { instructions: "BASE" }, { ...o, token: "" }) as any).instructions).toBe("BASE");
  });
  test("off unless asked for, and never on Vapi", () => {
    expect((overlayPayload(client(), defaultAutomations(), { instructions: "BASE" }, { publicUrl: o.publicUrl, token: o.token }) as any).instructions).toBe("BASE");
    expect(automationInstructions(client(), defaultAutomations(), "vapi", true)).not.toContain("twin_caller_context");
  });
  test("the script tells the assistant to check identity first", () => {
    expect(automationInstructions(client(), defaultAutomations(), "telnyx", true)).toContain("same person");
  });
});
