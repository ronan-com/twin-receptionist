import type { Business } from "../src/lib/shared";
import { numbersBecameLive, splitNumbers, textsWhenLive } from "./textsControl";
import { saveClient, getClient } from "./store";
import { sql } from "./db";

// Keeps what we know about a receptionist's numbers up to date, and notices when a number that was waiting for
// approval has gone live (then texting switches on if the switch is on, textsWhenLive). Two callers:
//  - a page that looks at the numbers (server/index.ts numberState), and
//  - a background timer (startNumberSync), so a number approved while nobody has the page open still goes live.

type EngineNumbers = { numbers: { phoneNumber: string; status: string }[]; pending: { phoneNumbers: string[] }[] };

/** Saves the numbers the engine reports (and which are still pending) and starts texts on those that just went live. */
export async function recordNumbers(client: Business, state: EngineNumbers): Promise<void> {
  const current = state.numbers.map((n) => n.phoneNumber);
  const split = splitNumbers(state);
  const becameLive = numbersBecameLive(client, split);
  if (JSON.stringify(current) === JSON.stringify(client.phoneNumbers ?? []) && JSON.stringify(split.pending) === JSON.stringify(client.pendingNumbers ?? [])) return;
  const saved = { ...client, phoneNumbers: current, pendingNumbers: split.pending };
  await saveClient(saved);
  await textsWhenLive(saved, becameLive).catch((err) => console.error(`[texting ${client.id}]`, err.message));
}

export type SyncDeps = {
  /** Receptionists with numbers still waiting for approval, with their org. */
  pendingClients: () => Promise<{ client: Business; orgId: string }[]>;
  /** Asks the voice engine for this receptionist's numbers (inside the org's scope). */
  readNumbers: (client: Business, orgId: string) => Promise<EngineNumbers>;
};

/** One pass: every receptionist with pending numbers is looked at again. One failing never stops the rest. */
export async function syncPendingNumbers(deps: SyncDeps): Promise<{ checked: number; failed: number }> {
  let checked = 0;
  let failed = 0;
  for (const { client, orgId } of await deps.pendingClients()) {
    try {
      const fresh = (await getClient(client.id)) ?? client;
      await recordNumbers(fresh, await deps.readNumbers(fresh, orgId));
      checked++;
    } catch (err) {
      failed++;
      console.error(`[number sync ${client.id}]`, (err as Error).message);
    }
  }
  return { checked, failed };
}

export async function pendingClientsFromDb(): Promise<{ client: Business; orgId: string }[]> {
  const rows = await sql`
    select c.id, c.org_id, c.data from clients c join orgs o on o.id = c.org_id
    where jsonb_typeof(c.data->'pendingNumbers') = 'array' and jsonb_array_length(c.data->'pendingNumbers') > 0
      and o.suspended_at is null and c.data->>'assistantId' not like 'demo-%'`;
  return rows.map((r: any) => ({ client: { ...r.data, id: r.id } as Business, orgId: r.org_id }));
}

export const NUMBER_SYNC_MS = 10 * 60_000;

/** The background timer. Never throws: a failed pass is logged and tried again at the next one. */
export function startNumberSync(readNumbers: SyncDeps["readNumbers"], every = NUMBER_SYNC_MS): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await syncPendingNumbers({ pendingClients: pendingClientsFromDb, readNumbers });
    } catch (err) {
      console.error("[number sync]", (err as Error).message);
    } finally {
      running = false;
    }
  }, every);
  return () => clearInterval(timer);
}
