import type { Business } from "../../src/lib/shared";
import { loadAutomations, openNow } from "../automations";
import { sql } from "../db";
import { runAsOrg } from "../telnyx";
import { vapiProvider } from "./vapi";

// Telnyx asks our server "is the business open?" at the start of every call (a dynamic
// variables webhook). Vapi has no such hook on an assistant that a number answers
// directly, so the answer is written into the assistant instead: the after-hours greeting
// and the "open right now" line of the script. This checks every minute and rewrites the
// assistant only when a receptionist crosses open or closed (and once per start of the
// server, in case it was down across a change).

const last = new Map<string, boolean>();

const usesOpenNow = (a: Awaited<ReturnType<typeof loadAutomations>>["settings"]) => a.hoursMode.enabled || (a.transfer.enabled && a.transfer.when === "hours");

export async function syncVapiHours(): Promise<number> {
  const rows = await sql`
    select c.id, c.org_id, c.data from clients c join orgs o on o.id = c.org_id
    where c.data->>'voiceProvider' = 'vapi' and o.suspended_at is null and coalesce(c.data->>'assistantId', '') not like 'demo-%'`;
  let pushed = 0;
  for (const r of rows as { id: string; org_id: string; data: Business }[]) {
    try {
      const client: Business = { ...r.data, id: r.id };
      if (client.settings.paused) continue;
      const row = await loadAutomations(client.id);
      if (!row.stored || !usesOpenNow(row.settings)) continue;
      const open = openNow(client.settings);
      if (last.get(client.id) === open) continue;
      await runAsOrg(r.org_id, () => vapiProvider.applyAutomations(client));
      last.set(client.id, open);
      pushed++;
    } catch (err) {
      console.error(`[vapi hours ${r.id}]`, (err as Error).message);
    }
  }
  return pushed;
}

let running = false;
export function startVapiHours(): void {
  if (process.env.VAPI_HOURS_SYNC === "off") return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await syncVapiHours();
    } catch (err) {
      console.error("[vapi hours]", (err as Error).message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 10_000);
  setInterval(tick, 60_000);
}
