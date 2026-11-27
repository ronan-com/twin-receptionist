// Mixing engines per receptionist: which engine a new one goes on, which numbers fit which
// engine, and the closest voice when one moves. Pure: no database, no network.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/voice/engines.test.ts
import { describe, expect, test } from "bun:test";
import type { Voice } from "../../src/lib/shared";
import { COMPATIBLE_SOURCES, closestVoice, numberFits, numberSourceLabel, pickEngine, sourceOfAttach } from "./engines";
import { vapiVoiceList } from "./vapiMap";

describe("which engine a new receptionist goes on", () => {
  test("the one asked for, when connected; refused when not", () => {
    expect(pickEngine("vapi", ["telnyx", "vapi"], "telnyx")).toBe("vapi");
    expect(pickEngine("telnyx", ["telnyx", "vapi"], "vapi")).toBe("telnyx");
    expect(() => pickEngine("vapi", ["telnyx"], "telnyx")).toThrow(/Vapi isn't connected/);
  });
  test("nothing asked: the agency's default, or the one it has", () => {
    expect(pickEngine(undefined, ["telnyx", "vapi"], "vapi")).toBe("vapi");
    expect(pickEngine(null, ["vapi"], "telnyx")).toBe("vapi");
    expect(pickEngine("nonsense", [], "telnyx")).toBe("telnyx");
  });
});

describe("number compatibility", () => {
  test("Telnyx receptionists take Telnyx numbers; Vapi receptionists take Twilio (or imported) numbers", () => {
    expect(COMPATIBLE_SOURCES.telnyx).toEqual(["telnyx"]);
    expect(numberFits({}, "telnyx")).toBe(true);
    expect(numberFits({}, "twilio")).toBe(false);
    expect(numberFits({ voiceProvider: "vapi" }, "twilio")).toBe(true);
    expect(numberFits({ voiceProvider: "vapi" }, "vapi")).toBe(true);
  });
  test("where an attached number came from", () => {
    expect(sourceOfAttach("telnyx", { phoneNumber: "+61412000000" })).toBe("telnyx");
    expect(sourceOfAttach("vapi", { source: "twilio_buy" })).toBe("twilio");
    expect(sourceOfAttach("vapi", { source: "twilio" })).toBe("twilio");
    expect(sourceOfAttach("vapi", { source: "telnyx" })).toBe("telnyx");
    expect(sourceOfAttach("vapi", { source: "vapi" })).toBe("vapi");
  });
  test("the card's number line", () => {
    expect(numberSourceLabel({})).toBe("No number");
    expect(numberSourceLabel({ phoneNumbers: ["+61412000000"] })).toBe("Telnyx number");
    expect(numberSourceLabel({ voiceProvider: "vapi", phoneNumbers: ["+61412000000"] })).toBe("Twilio number");
    expect(numberSourceLabel({ voiceProvider: "vapi", phoneNumbers: ["+1555"], numberSources: { "+1555": "vapi" } })).toBe("Vapi number");
  });
});

describe("closest voice on the other engine", () => {
  const telnyx: Voice[] = [
    { id: "Telnyx.Ultra.a", name: "Amelia - Instructor", label: "", gender: "Female", recommended: false },
    { id: "Telnyx.Ultra.b", name: "Grace - Helpful Hand", label: "", gender: "Female", recommended: true },
    { id: "Telnyx.Ultra.c", name: "Jack - Mate", label: "", gender: "Male", recommended: true },
  ];
  test("Telnyx to Vapi: same gender, Australian first", () => {
    expect(closestVoice({ name: "Grace - Helpful Hand", gender: "Female" }, vapiVoiceList())?.id).toBe("azure:en-AU-NatashaNeural");
    expect(closestVoice({ name: "Jack - Mate", gender: "Male" }, vapiVoiceList())?.id).toBe("11labs:IKne3meq5aSn9XLyUdCD");
  });
  test("Vapi to Telnyx: same gender, recommended first; a matching name wins", () => {
    expect(closestVoice({ name: "Alice", gender: "female", accent: "British" }, telnyx)?.id).toBe("Telnyx.Ultra.b");
    expect(closestVoice({ name: "Charlie", gender: "male", accent: "Australian" }, telnyx)?.id).toBe("Telnyx.Ultra.c");
    expect(closestVoice({ name: "Amelia" }, telnyx)?.id).toBe("Telnyx.Ultra.a");
  });
  test("nothing known: a recommended voice; an empty list: none", () => {
    expect(closestVoice({}, telnyx)?.id).toBe("Telnyx.Ultra.b");
    expect(closestVoice({ gender: "female" }, [])).toBeNull();
  });
});
