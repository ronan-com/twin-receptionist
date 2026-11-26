import { countryForTimezone, type AdminNumberRequest, type NumberRequest, type NumberType } from "../src/lib/shared";
import { AuthError, singleAgency, textOf, type Ctx } from "./accounts";
import { iso, sql } from "./db";
import { sendAccountEmail } from "./mailer";
import { ValidationError } from "./prompt";

// Agencies ask for a phone number; the platform team buys and connects it.

const row = (r: any): NumberRequest => ({
  id: r.id,
  type: r.kind,
  note: r.note,
  status: r.status,
  phoneNumber: r.phone_number ?? "",
  reason: r.reason,
  createdAt: iso(r.created_at),
});

export async function requestsForClient(clientId: string): Promise<NumberRequest[]> {
  const rows = await sql`select * from number_requests where client_id = ${clientId} order by created_at desc limit 5`;
  return rows.map(row);
}

export async function createRequest(ctx: Ctx, clientId: string, businessName: string, input: any, base: string): Promise<NumberRequest> {
  const type: NumberType = input?.type === "mobile" ? "mobile" : "local";
  const note = textOf(input?.note, 300);
  const [{ n }] = await sql`select count(*)::int as n from number_requests where client_id = ${clientId} and status = 'pending'`;
  if (n >= 2) throw new ValidationError("You already have a number request waiting for this receptionist. We'll be in touch.");
  const id = crypto.randomUUID();
  const [r] = await sql`
    insert into number_requests (id, org_id, client_id, kind, note, requested_by)
    values (${id}, ${ctx.org!.id}, ${clientId}, ${type}, ${note}, ${ctx.user.id}) returning *`;
  // Tell the platform team (printed to the log until email is set up). With
  // SINGLE_AGENCY there's no platform team: the agency's owners and admins buy it
  // themselves from the client's page.
  const single = singleAgency();
  const admins = single
    ? await sql`select u.email from memberships m join users u on u.id = m.user_id where m.org_id = ${ctx.org!.id} and m.role in ('owner', 'admin')`
    : await sql`select email from users where platform_admin`;
  for (const a of admins) {
    await sendAccountEmail(
      a.email,
      `Number request: ${businessName} (${ctx.org!.name})`,
      `${ctx.user.name || ctx.user.email} at ${ctx.org!.name} asked for a ${type === "mobile" ? "mobile (calls and texts)" : "local"} number for ${businessName}.\n${note ? `Note: ${note}\n` : ""}\n` +
        (single ? `Buy one from the client's page: ${base}/admin/clients/${clientId}` : `Buy and connect it from Agencies: ${base}/agencies`),
    ).catch((err) => console.error("[mail] number request", err.message));
  }
  return row(r);
}

function onlyPlatform(ctx: Ctx): void {
  if (!ctx.user.platformAdmin) throw new AuthError("Only the platform team can do that.", 403);
}

export async function listRequests(ctx: Ctx): Promise<AdminNumberRequest[]> {
  onlyPlatform(ctx);
  const rows = await sql`
    select r.*, o.name as org_name, c.data->'settings'->>'businessName' as business, c.data->'settings'->>'timezone' as timezone, u.email as by_email
    from number_requests r
    join orgs o on o.id = r.org_id
    join clients c on c.id = r.client_id
    left join users u on u.id = r.requested_by
    where r.status = 'pending' or r.resolved_at > now() - interval '14 days'
    order by (r.status = 'pending') desc, r.created_at desc limit 100`;
  return rows.map((r: any) => ({
    ...row(r),
    agency: r.org_name,
    business: r.business ?? "",
    requestedBy: r.by_email ?? "",
    clientId: r.client_id,
    country: countryForTimezone(r.timezone),
  }));
}

export async function pendingCount(): Promise<number> {
  const [{ n }] = await sql`select count(*)::int as n from number_requests where status = 'pending'`;
  return n;
}

// The pending request, for fulfilling or declining.
export async function pendingRequest(ctx: Ctx, id: string) {
  onlyPlatform(ctx);
  const [r] = await sql`select * from number_requests where id = ${id}`;
  if (!r) throw new ValidationError("Unknown request.");
  if (r.status !== "pending") throw new ValidationError("That request has already been dealt with.");
  return r as { id: string; client_id: string; org_id: string; kind: NumberType };
}

/** A number bought straight from the client's page answers that client's waiting requests (SINGLE_AGENCY, no queue). */
export async function settleRequests(clientId: string, phoneNumber: string): Promise<void> {
  await sql`update number_requests set status = 'done', phone_number = ${phoneNumber}, resolved_at = now() where client_id = ${clientId} and status = 'pending'`;
}

export async function markDone(id: string, phoneNumber: string): Promise<void> {
  await sql`update number_requests set status = 'done', phone_number = ${phoneNumber}, resolved_at = now() where id = ${id}`;
}

export async function declineRequest(ctx: Ctx, id: string, input: any): Promise<void> {
  await pendingRequest(ctx, id);
  await sql`update number_requests set status = 'declined', reason = ${textOf(input?.reason, 300)}, resolved_at = now() where id = ${id}`;
}
