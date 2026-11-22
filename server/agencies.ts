import type { Agency, TelnyxSettings } from "../src/lib/shared";
import { AuthError, createInvite, emailOf, requireRole, textOf, type Ctx } from "./accounts";
import { iso, sql } from "./db";
import { ValidationError } from "./prompt";
import { forgetKey, telnyx } from "./telnyx";

// Agencies are orgs the platform team sets up. An agency brings its own Telnyx
// account (its API key, kept sealed), its own clients and its own people.

// ---- The agency's own Telnyx account (Settings) ----

export async function telnyxSettings(ctx: Ctx): Promise<TelnyxSettings> {
  const [o] = await sql`select telnyx_key is not null as own, telnyx_key_last4, platform_telnyx from orgs where id = ${ctx.org!.id}`;
  const mode = o?.own ? "own" : o?.platform_telnyx ? "platform" : "none";
  let balance: TelnyxSettings["balance"] = null;
  // Their own money is theirs to see; the platform's balance is only for the platform team.
  if (mode === "own" || (mode === "platform" && ctx.user.platformAdmin)) {
    const res = await telnyx<{ data?: any }>("GET", "/balance").catch(() => null);
    if (res) balance = { amount: Number(res.data?.available_credit ?? res.data?.balance ?? 0), currency: res.data?.currency ?? "USD" };
  }
  return { mode, last4: o?.telnyx_key_last4 ?? "", balance };
}

export async function isSuspended(orgId: string): Promise<boolean> {
  const [o] = await sql`select suspended_at from orgs where id = ${orgId}`;
  return Boolean(o?.suspended_at);
}

// ---- The platform team's view of every agency ----

function onlyPlatform(ctx: Ctx): void {
  if (!ctx.user.platformAdmin) throw new AuthError("Only the platform team can do that.", 403);
}

export async function listAgencies(ctx: Ctx): Promise<Agency[]> {
  onlyPlatform(ctx);
  const orgs = await sql`
    select o.id, o.name, o.created_at, o.platform_telnyx, o.suspended_at, o.telnyx_key is not null as own,
      (select count(*)::int from memberships m where m.org_id = o.id) as members,
      (select count(*)::int from clients c where c.org_id = o.id) as clients,
      coalesce((select array_agg(u.email order by u.email) from memberships m join users u on u.id = m.user_id
                where m.org_id = o.id and m.role = 'owner'), '{}') as owners,
      coalesce((select array_agg(i.email order by i.email) from invites i
                where i.org_id = o.id and i.expires_at > now()), '{}') as pending
    from orgs o order by o.created_at desc`;
  return orgs.map((o: any) => ({
    id: o.id,
    name: o.name,
    createdAt: iso(o.created_at),
    members: o.members,
    clients: o.clients,
    owners: o.owners,
    pendingInvites: o.pending,
    telnyx: o.own ? "own" : o.platform_telnyx ? "platform" : "none",
    platformTelnyx: o.platform_telnyx,
    suspended: Boolean(o.suspended_at),
  }));
}

// A new agency, and an invite for its first owner.
export async function createAgency(ctx: Ctx, input: any, base: string): Promise<{ url: string; emailed: boolean }> {
  onlyPlatform(ctx);
  const name = textOf(input?.name, 80);
  if (!name) throw new ValidationError("Give the agency a name.");
  const email = emailOf(input?.ownerEmail);
  const id = crypto.randomUUID();
  await sql`insert into orgs (id, name, platform_telnyx, created_by) values (${id}, ${name}, true, ${ctx.user.id})`;
  return createInvite(id, name, email, "owner", ctx.user, base);
}

// Sends another invite for an agency's owner (a lost or expired link).
export async function inviteAgencyOwner(ctx: Ctx, id: string, input: any, base: string): Promise<{ url: string; emailed: boolean }> {
  onlyPlatform(ctx);
  const [o] = await sql`select name from orgs where id = ${id}`;
  if (!o) throw new ValidationError("Unknown agency.");
  return createInvite(id, o.name, emailOf(input?.email), "owner", ctx.user, base);
}

export async function updateAgency(ctx: Ctx, id: string, input: any): Promise<void> {
  onlyPlatform(ctx);
  const [o] = await sql`select 1 from orgs where id = ${id}`;
  if (!o) throw new ValidationError("Unknown agency.");
  if (input?.name !== undefined) {
    const name = textOf(input.name, 80);
    if (!name) throw new ValidationError("Give the agency a name.");
    await sql`update orgs set name = ${name} where id = ${id}`;
  }
  if (input?.platformTelnyx !== undefined) {
    await sql`update orgs set platform_telnyx = ${input.platformTelnyx === true} where id = ${id}`;
    forgetKey(id);
  }
  if (input?.suspended !== undefined) {
    // A suspended agency can't sign in to its dashboard and its receptionists stop using tools and mail.
    if (input.suspended === true && ctx.org?.id === id) throw new ValidationError("You can't suspend the team you're working in.");
    await sql`update orgs set suspended_at = ${input.suspended === true ? new Date() : null} where id = ${id}`;
    if (input.suspended === true) await sql`delete from sessions where org_id = ${id} and user_id not in (select id from users where platform_admin)`;
  }
}
