import { createInvite, emailOf, requireRole, type Ctx } from "./accounts";
import { iso, sql } from "./db";
import { ValidationError } from "./prompt";

// End customers: the business an agency serves. They sign in (read-only) and see
// the calls, bookings and follow-ups of the receptionist(s) shared with them.

export type CustomerAccess = {
  people: { id: string; email: string; name: string; since: string }[];
  invites: { id: string; email: string; expiresAt: string }[];
};

export async function customersFor(clientId: string): Promise<CustomerAccess> {
  const people = await sql`
    select u.id, u.email, u.name, a.created_at from client_access a join users u on u.id = a.user_id
    where a.client_id = ${clientId} order by a.created_at`;
  const invites = await sql`
    select token_hash, email, expires_at from invites
    where client_id = ${clientId} and role = 'customer' and expires_at > now() order by created_at desc`;
  return {
    people: people.map((p: any) => ({ id: p.id, email: p.email, name: p.name, since: iso(p.created_at) })),
    invites: invites.map((i: any) => ({ id: i.token_hash.slice(0, 16), email: i.email, expiresAt: iso(i.expires_at) })),
  };
}

export async function inviteCustomer(
  ctx: Ctx,
  clientId: string,
  businessName: string,
  input: any,
  base: string,
): Promise<{ url: string; emailed: boolean; added: boolean }> {
  requireRole(ctx, "admin");
  const email = emailOf(input?.email);
  const orgId = ctx.org!.id;
  const [existing] = await sql`
    select m.role, u.id from memberships m join users u on u.id = m.user_id where m.org_id = ${orgId} and u.email = ${email}`;
  if (existing) {
    if (existing.role !== "customer") throw new ValidationError(`${email} is on your team already. Customers are separate people.`);
    // Already a customer of another receptionist in this team: just share this one too.
    await sql`insert into client_access (user_id, client_id) values (${existing.id}, ${clientId}) on conflict do nothing`;
    return { url: "", emailed: false, added: true };
  }
  const result = await createInvite(orgId, ctx.org!.name, email, "customer", ctx.user, base, clientId, businessName);
  return { ...result, added: false };
}

export async function revokeCustomerInvite(ctx: Ctx, clientId: string, prefix: string): Promise<void> {
  requireRole(ctx, "admin");
  if (!/^[a-f0-9]{16}$/.test(prefix)) throw new ValidationError("Unknown invite.");
  await sql`delete from invites where client_id = ${clientId} and role = 'customer' and left(token_hash, 16) = ${prefix}`;
}

export async function removeCustomer(ctx: Ctx, clientId: string, userId: string): Promise<void> {
  requireRole(ctx, "admin");
  const orgId = ctx.org!.id;
  await sql.begin(async (tx) => {
    await tx`delete from client_access where client_id = ${clientId} and user_id = ${userId}`;
    // No receptionists left to see: remove the login from this team.
    const [left] = await tx`
      select 1 from client_access a join clients c on c.id = a.client_id where a.user_id = ${userId} and c.org_id = ${orgId} limit 1`;
    if (!left) {
      await tx`delete from memberships where org_id = ${orgId} and user_id = ${userId} and role = 'customer'`;
      await tx`delete from sessions where user_id = ${userId} and org_id = ${orgId}`;
    }
  });
}

// The business moves a follow-up through New, Contacted, Won, Lost.
const STAGES = ["new", "contacted", "won", "lost"];
export async function setFollowUpStage(clientId: string, requestId: string, stage: unknown): Promise<void> {
  if (typeof stage !== "string" || !STAGES.includes(stage)) throw new ValidationError("Choose New, Contacted, Won or Lost.");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(requestId)) throw new ValidationError("Unknown follow-up.");
  const rows = await sql`
    update booking_requests set data = jsonb_set(data, '{stage}', to_jsonb(${stage}::text))
    where client_id = ${clientId} and data->>'id' = ${requestId} and data->>'kind' = 'callback' returning 1`;
  if (rows.length === 0) throw new ValidationError("Unknown follow-up.");
}

// What a signed-in customer may look at.
export async function accessibleClients(ctx: Ctx): Promise<{ id: string; businessName: string; receptionistName: string }[]> {
  const rows = await sql`
    select c.id, c.data->'settings'->>'businessName' as business, c.data->'settings'->>'receptionistName' as name
    from client_access a join clients c on c.id = a.client_id
    where a.user_id = ${ctx.user.id} and c.org_id = ${ctx.org!.id} order by business`;
  return rows.map((r: any) => ({ id: r.id, businessName: r.business ?? "", receptionistName: r.name ?? "" }));
}

// The receptionist a customer asks for, if they were given it.
export async function customerClientId(ctx: Ctx, clientId: string): Promise<string> {
  const [r] = await sql`
    select c.id from client_access a join clients c on c.id = a.client_id
    where a.user_id = ${ctx.user.id} and a.client_id = ${clientId} and c.org_id = ${ctx.org!.id}`;
  if (!r) throw new ValidationError("That receptionist isn't shared with you.");
  return r.id;
}
