import type { Business, NumberSource, Voice, VoiceProviderId } from "../../src/lib/shared";
import { ValidationError } from "../prompt";
import { asProvider, providerOfClient } from "./config";

// An agency may have both engines connected (Telnyx, and Vapi with Twilio numbers) and mix
// them per receptionist. Pure rules here (unit tested): which engine a new receptionist goes
// on, which numbers fit which engine, and the closest voice when one moves engine.

export const ENGINE_LABEL: Record<VoiceProviderId, string> = { telnyx: "Telnyx", vapi: "Vapi" };

/**
 * The engine a new receptionist is made on: the one asked for when the agency has it connected,
 * else the agency's default, else whichever it has. Asking for one it hasn't connected is refused.
 */
export function pickEngine(asked: unknown, connected: VoiceProviderId[], orgDefault: VoiceProviderId): VoiceProviderId {
  if (asked === "telnyx" || asked === "vapi") {
    if (!connected.includes(asked)) throw new ValidationError(`${ENGINE_LABEL[asked]} isn't connected for this agency. Connect it under Connections first.`);
    return asked;
  }
  if (connected.length === 0 || connected.includes(orgDefault)) return orgDefault;
  return connected[0];
}

export type { NumberSource };

/** The number sources each engine can answer: Telnyx numbers on Telnyx; Twilio numbers (or a Telnyx/free US number imported) on Vapi. */
export const COMPATIBLE_SOURCES: Record<VoiceProviderId, NumberSource[]> = { telnyx: ["telnyx"], vapi: ["twilio", "vapi", "telnyx"] };

/** A short reason shown in the Add-a-number dialog. */
export const NUMBER_RULE: Record<VoiceProviderId, string> = {
  telnyx: "This receptionist runs on Telnyx, so it answers Telnyx numbers. Twilio numbers need a Vapi receptionist.",
  vapi: "This receptionist runs on Vapi, so it answers Twilio numbers (or a Telnyx or free US number brought into Vapi). Telnyx-bought numbers attach to Telnyx receptionists.",
};

/** The source an attach request names (the Vapi import's input.source), or Telnyx for a Telnyx purchase. */
export function sourceOfAttach(engine: VoiceProviderId, input: unknown): NumberSource {
  if (engine === "telnyx") return "telnyx";
  const s = String((input as { source?: unknown })?.source ?? "");
  if (s.startsWith("twilio")) return "twilio";
  if (s === "vapi") return "vapi";
  return "telnyx";
}

/** Whether a number from `source` can be attached to this receptionist. */
export const numberFits = (client: Pick<Business, "voiceProvider">, source: NumberSource) => COMPATIBLE_SOURCES[providerOfClient(client)].includes(source);

/** The receptionist card's "Number" line: engine plus where its number comes from. */
export function numberSourceLabel(client: Pick<Business, "voiceProvider" | "phoneNumbers" | "numberSources">): string {
  const numbers = client.phoneNumbers ?? [];
  if (!numbers.length) return "No number";
  const engine = providerOfClient(client);
  const sources = new Set(numbers.map((n) => client.numberSources?.[n] ?? (engine === "vapi" ? "twilio" : "telnyx")));
  const name: Record<NumberSource, string> = { telnyx: "Telnyx number", twilio: "Twilio number", vapi: "Vapi number" };
  return [...sources].map((s) => name[s]).join(" + ");
}

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/**
 * The voice on the other engine nearest to the current one: same gender and accent first,
 * then same gender (preferring an Australian accent, as Telnyx's voices all are), then any
 * recommended voice. A voice with the same name wins outright (Natasha on both, say).
 */
export function closestVoice(current: Partial<Voice> & { name?: string }, list: Voice[]): Voice | null {
  if (!list.length) return null;
  const first = (pred: (v: Voice) => boolean) => list.find((v) => pred(v) && v.recommended) ?? list.find(pred);
  const name = norm(current.name).split(" - ")[0];
  const gender = norm(current.gender);
  const accent = norm(current.accent) || "australian";
  return (
    (name ? list.find((v) => norm(v.name).split(" - ")[0] === name) : undefined) ??
    (gender ? first((v) => norm(v.gender) === gender && (norm(v.accent) || "australian") === accent) : undefined) ??
    (gender ? first((v) => norm(v.gender) === gender) : undefined) ??
    list.find((v) => v.recommended) ??
    list[0]
  );
}

export const otherEngine = (e: unknown): VoiceProviderId => (asProvider(e) === "vapi" ? "telnyx" : "vapi");
