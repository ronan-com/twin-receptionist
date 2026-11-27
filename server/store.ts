import type { Business } from "../src/lib/shared";
import { sql } from "./db";

// Receptionists ("clients"). Each belongs to one organisation; the dashboard only
// ever reads them through the org-scoped functions. The unscoped ones are for
// server work that arrives without a user: Telnyx tool calls, the mail checker,
// and connect links.

const row = (r: any): Business => ({ ...r.data, id: r.id });

export async function listClients(orgId: string): Promise<Business[]> {
  const rows = await sql`select id, data from clients where org_id = ${orgId} order by created_at desc`;
  return rows.map(row);
}

export async function getOrgClient(orgId: string, id: string): Promise<Business | null> {
  const [r] = await sql`select id, data from clients where id = ${id} and org_id = ${orgId}`;
  return r ? row(r) : null;
}

export async function getClient(id: string): Promise<Business | null> {
  const [r] = await sql`select id, data from clients where id = ${id}`;
  return r ? row(r) : null;
}

export async function orgOfClient(id: string): Promise<string | null> {
  const [r] = await sql`select org_id from clients where id = ${id}`;
  return r?.org_id ?? null;
}

export async function clientsWithBooking(): Promise<Business[]> {
  const rows = await sql`select id, data from clients where data ? 'booking'`;
  return rows.map(row);
}

export async function clientByConnectHash(hash: string): Promise<Business | null> {
  const [r] = await sql`select id, data from clients where connect_token_hash = ${hash}`;
  return r ? row(r) : null;
}

export async function insertClient(orgId: string, client: Business): Promise<void> {
  await sql`
    insert into clients (id, org_id, data, connect_token_hash, created_at, updated_at)
    values (${client.id}, ${orgId}, ${client}, ${client.connect?.tokenHash ?? null}, ${client.createdAt}, ${client.updatedAt})`;
}

// Updates an existing receptionist. Does nothing if it was deleted meanwhile.
export async function saveClient(client: Business): Promise<void> {
  await sql`
    update clients set data = ${client}, connect_token_hash = ${client.connect?.tokenHash ?? null},
      updated_at = ${client.updatedAt}
    where id = ${client.id}`;
}

export async function removeClient(id: string): Promise<void> {
  await sql`delete from app_settings where key = ${`apps:${id}`}`.catch(() => {});
  await sql`delete from clients where id = ${id}`;
}

// ---- Small shared settings (e.g. the tunnel's public address) ----

export async function getSetting<T>(key: string): Promise<T | null> {
  const [r] = await sql`select value from app_settings where key = ${key}`;
  return (r?.value as T) ?? null;
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  await sql`
    insert into app_settings (key, value) values (${key}, ${value as any})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}
