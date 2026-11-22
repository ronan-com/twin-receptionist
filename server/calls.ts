import type { Business, CallMessage, CallSummary } from "../src/lib/shared";
import { callSummary } from "./numbers";
import { ValidationError } from "./prompt";
import { demoCallDetail, demoCalls, isDemo } from "./sandbox";
import { telnyx } from "./telnyx";

// A receptionist's recent calls and texts, from the phone provider's conversations
// (or the sample data for demo receptionists). Used by the dashboard's call list and
// by the call_log sync (server/callsync.ts). Call inside the receptionist's org scope.

export type Conversation = CallSummary & {
  to: string;
  endedAt: string;
};

export async function recentConversations(assistantId: string, limit = 20): Promise<Conversation[]> {
  if (isDemo(assistantId)) return demoCalls().slice(0, limit).map((c) => ({ ...c, to: "", endedAt: "" }));
  const query = `metadata-%3Eassistant_id=eq.${encodeURIComponent(assistantId)}&order=created_at.desc&limit=${limit}`;
  const res = await telnyx<{ data?: any[] }>("GET", `/ai/conversations?${query}`);
  return (res.data ?? []).map((c) => {
    const meta = c.metadata ?? {};
    // Browser test calls arrive as phone calls from a throwaway SIP login, so
    // tell them apart by the "anonymous@" target and hide the SIP address.
    const web = String(meta.telnyx_agent_target ?? "").startsWith("anonymous@");
    return {
      id: c.id,
      startedAt: c.created_at ?? "",
      endedAt: c.last_message_at ?? c.updated_at ?? "",
      channel: web ? "web" : (meta.telnyx_conversation_channel ?? "call"),
      from: web ? "" : (meta.telnyx_end_user_target ?? ""),
      to: web ? "" : (meta.telnyx_agent_target ?? ""),
      simulated: meta.twin_simulator === "true",
    };
  });
}

export async function listCalls(assistantId: string, limit = 20): Promise<CallSummary[]> {
  return (await recentConversations(assistantId, limit)).map(({ id, startedAt, channel, from, simulated }) => ({ id, startedAt, channel, from, simulated }));
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
  const convo = await telnyx<{ data?: any }>("GET", `/ai/conversations/${conversationId}`);
  if ((convo.data?.metadata ?? {}).assistant_id !== business.assistantId) throw new ValidationError("Unknown call.");

  const [res, summary] = await Promise.all([
    telnyx<{ data?: any[] }>("GET", `/ai/conversations/${conversationId}/messages`),
    // The summary is a nice-to-have; never let it block the transcript.
    callSummary(conversationId).catch(() => ""),
  ]);
  const messages = (res.data ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && (m.text || m.content))
    .map((m) => ({ role: m.role, text: String(m.text ?? m.content), at: m.sent_at ?? m.created_at ?? "" }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return { summary, messages };
}
