import { demoExtras, recentConversations } from "./calls";
import { sql } from "./db";
import { recordIncident, resolveIncidents } from "./incidents";
import { isDemo } from "./sandbox";
import { accountMode, asProvider } from "./voice/config";
import { runAsOrg } from "./telnyx";
import { summariseEnded } from "./callSummary";

// Keeps call_log up to date: every minute, for each receptionist, the most recent
// conversations from the phone provider are upserted by provider_call_id. Demo
// receptionists use the sample calls. A failure becomes an incident and never
// stops the loop or the server.

const EVERY_MS = 60_000;
const PER_RECEPTIONIST = 50;

// Demo calls share ids across receptionists, so their provider id carries the receptionist's id.
export const demoProviderId = (callId: string, clientId: string) => `${callId}-${clientId}`;

export async function syncReceptionist(c: { id: string; org_id: string; assistant_id: string; voice_provider?: string | null }): Promise<number> {
  const demo = isDemo(c.assistant_id);
  const convos = await runAsOrg(c.org_id, () => recentConversations({ assistantId: c.assistant_id, voiceProvider: asProvider(c.voice_provider) }, PER_RECEPTIONIST));
  let n = 0;
  for (const v of convos) {
    // The text simulator's practice conversations are not real traffic.
    if (v.simulated || !v.startedAt) continue;
    const extra = demo ? demoExtras(v.id) : { outcome: null, seconds: null, summary: null };
    const ended = v.endedAt ? new Date(v.endedAt) : null;
    const started = new Date(v.startedAt);
    const seconds = demo ? extra.seconds : ended ? Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000)) : null;
    await sql`
      insert into call_log (org_id, client_id, provider_call_id, provider, channel, from_number, to_number, started_at, ended_at,
        duration_seconds, status, outcome, summary)
      values (${c.org_id}, ${c.id}, ${demo ? demoProviderId(v.id, c.id) : v.id}, ${asProvider(c.voice_provider)}, ${v.channel || "call"}, ${v.from || null},
        ${v.to || null}, ${started}, ${ended}, ${seconds}, 'completed', ${extra.outcome}, ${extra.summary})
      on conflict (provider_call_id) do update set
        ended_at = coalesce(excluded.ended_at, call_log.ended_at),
        duration_seconds = coalesce(excluded.duration_seconds, call_log.duration_seconds),
        from_number = coalesce(call_log.from_number, excluded.from_number),
        to_number = coalesce(call_log.to_number, excluded.to_number),
        updated_at = now()`;
    n++;
  }
  return n;
}

export async function syncAllCalls(): Promise<void> {
  const rows = await sql`
    select c.id, c.org_id, c.data->>'assistantId' as assistant_id, c.data->>'voiceProvider' as voice_provider
    from clients c join orgs o on o.id = c.org_id
    where o.suspended_at is null and coalesce(c.data->>'assistantId', '') <> ''`;
  // An agency with no phone account yet (an install whose owner hasn't pasted a key): nothing to
  // fetch, so skip it quietly instead of filing an incident every minute.
  const connected = new Map<string, boolean>();
  for (const c of rows as { id: string; org_id: string; assistant_id: string; voice_provider: string | null }[]) {
    if (!isDemo(c.assistant_id)) {
      const k = `${c.org_id}:${asProvider(c.voice_provider)}`;
      if (!connected.has(k)) connected.set(k, (await accountMode(c.org_id, asProvider(c.voice_provider)).catch(() => "none")) !== "none");
      if (!connected.get(k)) continue;
    }
    try {
      await syncReceptionist(c);
      await resolveIncidents("call_sync", c.id);
    } catch (err) {
      await recordIncident({
        kind: "call_sync",
        orgId: c.org_id,
        clientId: c.id,
        message: `Couldn't fetch recent calls: ${(err as Error).message}`.slice(0, 300),
      });
    }
    // Summaries and outcomes for calls that have ended (server/callSummary.ts). Its own incident
    // kind: a failure here never stops the calls syncing, nor the other receptionists.
    if (!isDemo(c.assistant_id)) {
      try {
        await runAsOrg(c.org_id, () => summariseEnded(c));
        await resolveIncidents("call_summary", c.id);
      } catch (err) {
        await recordIncident({
          kind: "call_summary",
          orgId: c.org_id,
          clientId: c.id,
          message: `Couldn't summarise a call: ${(err as Error).message}`.slice(0, 300),
        });
      }
    }
  }
}

let running = false;
export function startCallSync(): void {
  if (process.env.CALL_SYNC === "off") return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await syncAllCalls();
    } catch (err) {
      console.error("[call sync]", (err as Error).message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, EVERY_MS);
}
