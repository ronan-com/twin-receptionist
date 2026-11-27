import { sql } from "./db";

// Shared by every delete path (server/deletion.ts, removeMember in server/accounts.ts).

const UUID = /^[a-f0-9-]{36}$/;

/** A Postgres uuid[] literal from ids (anything that isn't a uuid is dropped). */
export const uuidArray = (ids: string[]) => `{${ids.filter((i) => UUID.test(i)).join(",")}}`;

type Db = { (strings: TemplateStringsArray, ...values: any[]): Promise<any[]> };

/**
 * Deletes people who belong to no org any more (their sessions, reset links and business access go with them
 * through foreign keys). Platform admins are never deleted here. Returns the ids that were deleted.
 */
export async function purgeOrphanUsers(userIds: string[], db: Db = sql as unknown as Db): Promise<string[]> {
  const ids = [...new Set(userIds)].filter((i) => UUID.test(i));
  if (!ids.length) return [];
  const gone = await db`
    delete from users u
    where u.id = any(${uuidArray(ids)}::uuid[]) and not u.platform_admin
      and not exists (select 1 from memberships m where m.user_id = u.id)
    returning u.id`;
  return gone.map((r: any) => r.id as string);
}

/** Orgs where this person is the only owner (deleting them would leave the team ownerless). */
export async function soleOwnerOrgs(userId: string): Promise<{ id: string; name: string }[]> {
  const rows = await sql`
    select o.id, o.name from memberships m join orgs o on o.id = m.org_id
    where m.user_id = ${userId} and m.role = 'owner'
      and not exists (select 1 from memberships x where x.org_id = m.org_id and x.role = 'owner' and x.user_id <> m.user_id)
    order by o.name`;
  return rows.map((r: any) => ({ id: r.id, name: r.name }));
}
