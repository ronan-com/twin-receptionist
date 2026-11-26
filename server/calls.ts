import type { Business, CallMessage, CallSummary } from "../src/lib/shared";
import { ValidationError } from "./prompt";
import { demoCallDetail, demoCalls, isDemo } from "./sandbox";
import { voiceFor } from "./voice";
import type { Conversation } from "./voice/provider";

// A receptionist's recent calls and texts, from the phone provider's conversations
// (or the sample data for demo receptionists). Used by the dashboard's call list and
// by the call_log sync (server/callsync.ts). Call inside the receptionist's org scope.

export type { Conversation } from "./voice/provider";

/** What a receptionist's engine is told apart by (Business, or a row with its assistant id). */
type Who = Pick<Business, "assistantId" | "voiceProvider">;

export async function recentConversations(who: Who, limit = 20): Promise<Conversation[]> {
  if (isDemo(who.assistantId)) return demoCalls().slice(0, limit).map((c) => ({ ...c, to: "", endedAt: "" }));
  return voiceFor(who).recentConversations(who.assistantId, limit);
}

export async function listCalls(who: Who, limit = 20): Promise<CallSummary[]> {
  return (await recentConversations(who, limit)).map(({ id, startedAt, channel, from, simulated }) => ({ id, startedAt, channel, from, simulated }));
}

// Sample outcome and summary for the demo receptionist's calls, so dashboards have something to show.
const DEMO_OUTCOMES: Record<string, { outcome: string; seconds: number }> = {
  "demo-call-1": { outcome: "callback_requested", seconds: 142 },
  "demo-call-2": { outcome: "booked", seconds: 0 },
  "demo-call-3": { outcome: "resolved", seconds: 95 },
  "demo-call-4": { outcome: "booked", seconds: 210 },
  "demo-call-5": { outcome: "lead_captured", seconds: 173 },
};

export function demoExtras(id: string): { outcome: string | null; seconds: number | null; summary: string } {
  const d = DEMO_OUTCOMES[id];
  return { outcome: d?.outcome ?? null, seconds: d ? d.seconds : null, summary: demoCallDetail(id).summary };
}

// One conversation's transcript and summary. Only for calls that belong to this
// receptionist (the provider's assistant id must match). Call inside the org scope.
export async function callDetail(
  business: Business,
  conversationId: string,
): Promise<{ summary: string; messages: CallMessage[] }> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(conversationId)) throw new ValidationError("Unknown call.");
  if (isDemo(business.assistantId)) return demoCallDetail(conversationId);
  return voiceFor(business).callDetail(business, conversationId);
}
