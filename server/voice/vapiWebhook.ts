import { sql } from "../db";
import { getClient, orgOfClient } from "../store";
import { callRecord, secretMatches, toolCallsOf, type CallRecord } from "./vapiMap";

// What Vapi sends to this server (the addresses are set on each assistant by server/voice/vapi.ts):
//   POST /hooks/vapi/<clientId>                      end-of-call-report (and other events, ignored)
//   POST /hooks/<clientId>/vapi/<action>             a booking tool call (X-Twin-Key, like Telnyx's tools)
// Reports carry X-Vapi-Secret (per receptionist, see eventsSecret). Tool calls carry the
// receptionist's own X-Twin-Key, checked by the same hook that answers Telnyx.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Keeps one call in call_log (upserted, so a report and the sync job can both write it). */
export async function storeCall(orgId: string, clientId: string, r: CallRecord, fallbackStart = new Date()): Promise<void> {
  const started = r.startedAt ? new Date(r.startedAt) : r.endedAt ? new Date(r.endedAt) : fallbackStart;
  const transcript = r.transcript.length ? (r.transcript as any) : null;
  await sql`
    insert into call_log (org_id, client_id, provider_call_id, provider, channel, from_number, to_number, started_at, ended_at,
      duration_seconds, status, outcome, summary, transcript, recording_url, cost_usd, ended_reason)
    values (${orgId}, ${clientId}, ${r.id}, 'vapi', ${r.channel}, ${r.from}, ${r.to}, ${started}, ${r.endedAt ? new Date(r.endedAt) : null},
      ${r.seconds}, ${r.status}, ${r.outcome}, ${r.summary}, ${transcript}, ${r.recordingUrl}, ${r.costUsd}, ${r.endedReason})
    on conflict (provider_call_id) do update set
      ended_at = coalesce(excluded.ended_at, call_log.ended_at),
      duration_seconds = coalesce(excluded.duration_seconds, call_log.duration_seconds),
      from_number = coalesce(call_log.from_number, excluded.from_number),
      to_number = coalesce(call_log.to_number, excluded.to_number),
      status = case when excluded.status = 'failed' then excluded.status else call_log.status end,
      outcome = coalesce(excluded.outcome, call_log.outcome),
      summary = coalesce(excluded.summary, call_log.summary),
      transcript = coalesce(excluded.transcript, call_log.transcript),
      recording_url = coalesce(excluded.recording_url, call_log.recording_url),
      cost_usd = coalesce(excluded.cost_usd, call_log.cost_usd),
      ended_reason = coalesce(excluded.ended_reason, call_log.ended_reason),
      updated_at = now()`;
}

/** POST /hooks/vapi/<clientId>: Vapi's server messages. Only end-of-call-report is kept. */
export type EventDeps = {
  getClient: typeof getClient;
  orgOfClient: typeof orgOfClient;
  storeCall: typeof storeCall;
};

const realDeps: EventDeps = { getClient, orgOfClient, storeCall };

export async function vapiEvents(req: Request, clientId: string, deps: EventDeps = realDeps): Promise<Response> {
  const client = await deps.getClient(clientId);
  if (!client) return json({ error: "Not found" }, 404);
  if (!secretMatches(req.headers, clientId)) return json({ error: "Not found" }, 404);
  const text = await req.text();
  if (text.length > 4_000_000) return json({ error: "Too large." }, 413);
  let message: any;
  try {
    message = JSON.parse(text)?.message;
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (message?.type !== "end-of-call-report") return json({ ok: true });
  const record = callRecord(message);
  if (!record.id) return json({ error: "No call id." }, 422);
  // A report for another receptionist's assistant is not ours to file here.
  if (record.assistantId && record.assistantId !== client.assistantId) return json({ error: "Not this receptionist's call." }, 422);
  const orgId = await deps.orgOfClient(clientId);
  if (!orgId) return json({ error: "Not found" }, 404);
  await deps.storeCall(orgId, clientId, record);
  return json({ ok: true });
}

const ACTION: Record<string, "availability" | "book" | "callback" | "find" | "reschedule" | "cancel"> = {
  check_availability: "availability",
  book_appointment: "book",
  request_callback: "callback",
  find_booking: "find",
  reschedule_appointment: "reschedule",
  cancel_appointment: "cancel",
};

/**
 * POST /hooks/<clientId>/vapi/<action>: Vapi's "tool-calls" message in, `{results}` out.
 * Each call is run through `hook` (server/index.ts), the same checks and code the Telnyx
 * tools go through, so a refusal ("closed", "paused") reaches the caller the same way.
 * `hook` answers 404 when the key is wrong; that is passed on as it is.
 */
export async function vapiToolHook(req: Request, clientId: string, action: string, hook: (req: Request, clientId: string, action: string) => Promise<Response>): Promise<Response> {
  const text = await req.text();
  if (text.length > 20_000) return json({ error: "Too large." }, 413);
  let message: any;
  try {
    message = JSON.parse(text)?.message;
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const calls = toolCallsOf(message);
  // The caller's number as Vapi saw it on the line (a web call has none).
  const caller = String(message?.call?.customer?.number ?? "");
  const results: { name: string; toolCallId: string; result: string }[] = [];
  for (const call of calls) {
    const inner = new Request(req.url, {
      method: "POST",
      headers: { "x-twin-key": req.headers.get("x-twin-key") ?? "", "x-twin-caller": caller, "content-type": "application/json" },
      body: JSON.stringify(call.args),
    });
    const res = await hook(inner, clientId, ACTION[call.name] ?? action);
    if (res.status === 404) return res;
    const body = await res.text();
    // Vapi wants a string. Single line, as it is read to the model.
    results.push({ name: call.name, toolCallId: call.id, result: body.replace(/\s*\n\s*/g, " ") });
  }
  return json({ results });
}
