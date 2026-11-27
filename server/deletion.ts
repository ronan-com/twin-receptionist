import { AuthError, requireRole, singleAgency, type Ctx } from "./accounts";
import { audit } from "./audit";
import { purgeOrphanUsers, soleOwnerOrgs, uuidArray } from "./deleteUsers";
import { sql } from "./db";
import { recordIncident } from "./incidents";
import { ValidationError } from "./prompt";
import { isDemo } from "./sandbox";
import { forgetKey, runAsOrg } from "./telnyx";
import { voiceFor } from "./voice";
import { forgetVapiKey } from "./voice/config";

// Deleting things for good: a client business (company), a whole agency (org) and a person's account.
//
// What goes: the rows (the database cascades from clients and orgs, see the foreign keys in server/migrations)
// and the receptionists' assistants on the voice provider (Telnyx or Vapi). What stays, always: the phone
// numbers on the carrier account, and the carrier account itself. A provider that fails to delete an assistant
// never blocks the delete: the failure is logged as an incident and handed back as a warning, so the person can
// remove that assistant by hand.
//
// Every delete asks for the name typed back (input.confirm) here on the server, not only in the dialog.

const UUID = /^[a-f0-9-]{36}$/;

export type DeleteWarning = { receptionist: string; assistantId: string; provider: string; error: string };

export type Impact = {
  receptionists: { id: string; name: string; assistantId: string; provider: string; numbers: string[] }[];
  numbers: string[];
  calls: number;
  bookings: number;
  followUps: number;
  websiteChats: number;
  knowledge: number;
  logins: number;
};

export type DeletePreview = Impact & {
  name: string;
  /** Agency only: how many clients, and how many people on the team. */
  clients?: number;
  members?: number;
  /** Set when the delete would be refused, in words. */
  blocked?: string;
};

export type DeleteResult = DeletePreview & { ok: true; warnings: DeleteWarning[] };

// ---------------------------------------------------------------- small pieces

/** The typed confirmation: exactly the name, ignoring spaces at the ends. */
export function requireConfirm(input: any, expected: string, what: string): void {
  const typed = String(input?.confirm ?? "").trim();
  if (!typed || typed !== expected.trim()) throw new ValidationError(`Type "${expected.trim()}" exactly to confirm deleting ${what}.`);
}

function noSupport(ctx: Ctx): void {
  // Viewing as someone is read-only, and the setup provider's support person never deletes anything.
  if (ctx.viewing) throw new AuthError("Exit the view first. Deleting isn't available while you're viewing as someone else.", 403);
}

function onlyPlatform(ctx: Ctx): void {
  noSupport(ctx);
  if (!ctx.user.platformAdmin || singleAgency()) throw new AuthError("Only the platform team can do that.", 403);
}

async function impactOf(orgId: string, clientIds: string[]): Promise<Impact> {
  const ids = uuidArray(clientIds);
  const rows = clientIds.length ? await sql`select id, data from clients where id = any(${ids}::uuid[]) order by created_at` : [];
  const logins = (await customerLogins(orgId, clientIds)).length;
  const [n] = clientIds.length
    ? await sql`
        select
          (select count(*)::int from call_log where client_id = any(${ids}::uuid[])) as calls,
          (select count(*)::int from booking_requests where client_id = any(${ids}::uuid[])) as bookings,
          (select count(*)::int from followup_messages where client_id = any(${ids}::uuid[])) as follow_ups,
          (select count(*)::int from webchat_conversations where client_id = any(${ids}::uuid[])) as chats,
          (select count(*)::int from knowledge_items where client_id = any(${ids}::uuid[])) as knowledge`
    : [{ calls: 0, bookings: 0, follow_ups: 0, chats: 0, knowledge: 0 }];
  const receptionists: Impact["receptionists"] = rows.map((r: any) => ({
    id: r.id as string,
    name: String(r.data?.settings?.receptionistName || r.data?.settings?.businessName || "Receptionist"),
    assistantId: String(r.data?.assistantId ?? ""),
    provider: r.data?.voiceProvider === "vapi" ? "vapi" : "telnyx",
    numbers: ((r.data?.phoneNumbers ?? []) as string[]).map(String),
  }));
  return {
    receptionists,
    numbers: [...new Set(receptionists.flatMap((r) => r.numbers))],
    calls: n.calls,
    bookings: n.bookings,
    followUps: n.follow_ups,
    websiteChats: n.chats,
    knowledge: n.knowledge,
    logins,
  };
}

/** Business logins that only reach these receptionists (no other business anywhere): they go with them. */
async function customerLogins(orgId: string, clientIds: string[]): Promise<string[]> {
  if (!clientIds.length) return [];
  const rows = await sql`
    select distinct a.user_id from client_access a
    where a.client_id = any(${uuidArray(clientIds)}::uuid[])
      and not exists (select 1 from client_access b where b.user_id = a.user_id and not (b.client_id = any(${uuidArray(clientIds)}::uuid[])))
      and exists (select 1 from memberships m where m.user_id = a.user_id and m.org_id = ${orgId} and m.role = 'customer')`;
  return rows.map((r: any) => r.user_id as string);
}

/** Deletes the assistants on the voice provider, one by one. A failure is logged and returned, never thrown. */
export async function removeAssistants(
  orgId: string,
  clients: Impact["receptionists"],
  incidentOrg: string | null,
  label: string,
): Promise<DeleteWarning[]> {
  const warnings: DeleteWarning[] = [];
  for (const r of clients) {
    if (!r.assistantId || isDemo(r.assistantId)) continue;
    try {
      await runAsOrg(orgId, () => voiceFor({ voiceProvider: r.provider as "telnyx" | "vapi" }).deleteAssistant({ id: r.id, assistantId: r.assistantId, voiceProvider: r.provider } as any));
    } catch (err) {
      const error = (err as Error).message || "Unknown error";
      warnings.push({ receptionist: r.name, assistantId: r.assistantId, provider: r.provider, error });
      await recordIncident({
        kind: "assistant_delete_failed",
        message: `Couldn't delete ${r.provider === "vapi" ? "Vapi" : "Telnyx"} assistant ${r.assistantId} (${r.name}, ${label}). Remove it by hand.`,
        orgId: incidentOrg,
        detail: { assistantId: r.assistantId, provider: r.provider, receptionist: r.name, owner: label, error },
      });
    }
  }
  return warnings;
}

// ---------------------------------------------------------------- a client business (company)

async function companyFor(ctx: Ctx, id: string) {
  noSupport(ctx);
  if (!UUID.test(id)) throw new ValidationError("Unknown client.");
  const [m] = await sql`select id, org_id, name from companies where id = ${id}`;
  // Another agency's client looks exactly like one that doesn't exist.
  if (!m || (!ctx.user.platformAdmin && m.org_id !== ctx.org?.id)) throw new AuthError("That client isn't in your console.", 404);
  if (!ctx.user.platformAdmin) requireRole(ctx, "admin");
  return m as { id: string; org_id: string; name: string };
}

export async function previewCompanyDelete(ctx: Ctx, id: string): Promise<DeletePreview> {
  const m = await companyFor(ctx, id);
  const ids = (await sql`select id from clients where company_id = ${m.id} and org_id = ${m.org_id}`).map((r: any) => r.id as string);
  return { name: m.name, ...(await impactOf(m.org_id, ids)) };
}

export async function deleteCompany(ctx: Ctx, id: string, input: any): Promise<DeleteResult> {
  const m = await companyFor(ctx, id);
  requireConfirm(input, m.name, `the client ${m.name}`);
  const ids = (await sql`select id from clients where company_id = ${m.id} and org_id = ${m.org_id}`).map((r: any) => r.id as string);
  const impact = await impactOf(m.org_id, ids);
  const logins = await customerLogins(m.org_id, ids);

  // The assistants first (a failure is only a warning), then the rows in one go.
  const warnings = await removeAssistants(m.org_id, impact.receptionists, m.org_id, `client ${m.name}`);
  await sql.begin(async (tx) => {
    // The receptionists' calls, bookings, follow-ups, chats, knowledge, mailboxes and invites cascade from these rows.
    await tx`delete from clients where company_id = ${m.id} and org_id = ${m.org_id}`;
    await tx`delete from companies where id = ${m.id}`;
    // Business logins that only had this client lose their business access, and their account if they have nothing else.
    if (logins.length) {
      await tx`delete from memberships where org_id = ${m.org_id} and role = 'customer' and user_id = any(${uuidArray(logins)}::uuid[])`;
      await purgeOrphanUsers(logins, tx as any);
    }
  });
  await audit(
    ctx,
    "company.deleted",
    {
      companyId: m.id,
      summary: `Deleted client ${m.name} (${impact.receptionists.length} receptionist${impact.receptionists.length === 1 ? "" : "s"}, ${impact.calls} call${impact.calls === 1 ? "" : "s"}, ${logins.length} login${logins.length === 1 ? "" : "s"})`,
      receptionists: impact.receptionists.length,
      calls: impact.calls,
      keptNumbers: impact.numbers,
      assistantWarnings: warnings.map((w) => w.assistantId),
    },
    { orgId: m.org_id },
  );
  return { ok: true, name: m.name, ...impact, warnings };
}

// ---------------------------------------------------------------- an agency (org)

/** The platform's own team: the oldest team a platform admin belongs to (not the test lab). */
export async function platformHomeOrg(): Promise<string | null> {
  const [o] = await sql`
    select o.id from orgs o
    where not o.sandbox and exists (select 1 from memberships m join users u on u.id = m.user_id where m.org_id = o.id and u.platform_admin)
    order by o.created_at limit 1`;
  return o?.id ?? null;
}

async function agencyFor(ctx: Ctx, id: string) {
  onlyPlatform(ctx);
  if (!UUID.test(id)) throw new ValidationError("Unknown agency.");
  const [o] = await sql`select id, name, sandbox from orgs where id = ${id}`;
  if (!o) throw new ValidationError("Unknown agency.");
  return o as { id: string; name: string; sandbox: boolean };
}

async function agencyBlocked(ctx: Ctx, id: string): Promise<string> {
  if ((await platformHomeOrg()) === id) return "This is the platform's own team. It can't be deleted.";
  if (ctx.org?.id === id) return "This is the team you're working in. Switch to another team first.";
  return "";
}

export async function previewAgencyDelete(ctx: Ctx, id: string): Promise<DeletePreview> {
  const o = await agencyFor(ctx, id);
  const ids = (await sql`select id from clients where org_id = ${o.id}`).map((r: any) => r.id as string);
  const [n] = await sql`
    select (select count(*)::int from companies where org_id = ${o.id}) as clients,
           (select count(*)::int from memberships where org_id = ${o.id} and role <> 'customer') as members`;
  const impact = await impactOf(o.id, ids);
  return { name: o.name, ...impact, clients: n.clients, members: n.members, blocked: (await agencyBlocked(ctx, o.id)) || undefined };
}

export async function deleteAgency(ctx: Ctx, id: string, input: any): Promise<DeleteResult> {
  const o = await agencyFor(ctx, id);
  const blocked = await agencyBlocked(ctx, o.id);
  if (blocked) throw new ValidationError(blocked);
  requireConfirm(input, o.name, `the agency ${o.name}`);

  const ids = (await sql`select id from clients where org_id = ${o.id}`).map((r: any) => r.id as string);
  const impact = await impactOf(o.id, ids);
  const [counts] = await sql`select (select count(*)::int from companies where org_id = ${o.id}) as clients, (select count(*)::int from memberships where org_id = ${o.id} and role <> 'customer') as members`;
  const people = (await sql`select user_id from memberships where org_id = ${o.id}`).map((r: any) => r.user_id as string);

  // The org's own provider keys are needed to delete its assistants, so this runs before the rows go. The incident
  // is filed platform-wide (no org): the org's own rows disappear with it.
  const warnings = await removeAssistants(o.id, impact.receptionists, null, `agency ${o.name}`);
  await sql.begin(async (tx) => {
    // clients are protected from org deletion, so remove them first (their data cascades).
    await tx`delete from clients where org_id = ${o.id}`;
    // Members, sessions, invites, clients' companies, calls, audit and the rest cascade from the org.
    await tx`delete from orgs where id = ${o.id}`;
    await purgeOrphanUsers(people, tx as any);
  });
  forgetKey(o.id);
  forgetVapiKey(o.id);
  // The agency's own audit log went with it, so the record lives in the platform team's.
  await audit(ctx, "agency.deleted", {
    agencyId: o.id,
    summary: `Deleted agency ${o.name} (${counts.clients} client${counts.clients === 1 ? "" : "s"}, ${impact.receptionists.length} receptionist${impact.receptionists.length === 1 ? "" : "s"}, ${people.length} ${people.length === 1 ? "person" : "people"})`,
    keptNumbers: impact.numbers,
    assistantWarnings: warnings.map((w) => w.assistantId),
  });
  return { ok: true, name: o.name, ...impact, clients: counts.clients, members: counts.members, warnings };
}

// ---------------------------------------------------------------- a person's account

function soleOwnerMessage(orgs: { name: string }[], who: "you" | "them"): string {
  const names = orgs.map((o) => o.name).join(", ");
  return who === "you"
    ? `You're the only owner of ${names}. Make someone else an owner first (Settings, Team), or delete the agency, then delete your account.`
    : `They're the only owner of ${names}. Make someone else an owner first, or delete the agency, then delete their account.`;
}

async function auditInTheirOrgs(ctx: Ctx, userId: string, action: string, detail: Record<string, unknown>) {
  const orgs = await sql`select org_id from memberships where user_id = ${userId}`;
  for (const o of orgs) await audit(ctx, action, detail, { orgId: o.org_id });
}

/** A person deletes their own account (Settings, Account). */
export async function deleteOwnAccount(ctx: Ctx, input: any): Promise<void> {
  noSupport(ctx);
  const [u] = await sql`select email, name, password_hash, platform_admin from users where id = ${ctx.user.id}`;
  if (!u) throw new AuthError("Please sign in.", 401);
  if (u.platform_admin) throw new ValidationError("Platform admins can't delete themselves here. Ask another platform admin to remove your platform access first.");
  requireConfirm(input, u.email, "your account");
  if (!(await Bun.password.verify(String(input?.password ?? ""), u.password_hash))) throw new ValidationError("Your password isn't right.");
  const sole = await soleOwnerOrgs(ctx.user.id);
  if (sole.length) throw new ValidationError(soleOwnerMessage(sole, "you"));
  await auditInTheirOrgs(ctx, ctx.user.id, "account.deleted", { email: u.email, summary: `${u.email} deleted their own account`, self: true });
  // Sessions, memberships, reset links and business access cascade; what they created stays, unattributed.
  await sql`delete from users where id = ${ctx.user.id}`;
}

export type AccountRow = {
  id: string;
  email: string;
  name: string;
  platformAdmin: boolean;
  createdAt: string;
  orgs: { id: string; name: string; role: string }[];
  /** Why this person can't be deleted from here, in words (empty: they can). */
  blocked: string;
};

/** Every account on the platform (platform team only). */
export async function listAccounts(ctx: Ctx): Promise<AccountRow[]> {
  onlyPlatform(ctx);
  const rows = await sql`
    select u.id, u.email, u.name, u.platform_admin, u.created_at,
      coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'role', m.role) order by o.name)
                from memberships m join orgs o on o.id = m.org_id where m.user_id = u.id), '[]'::jsonb) as orgs,
      coalesce((select array_agg(o.name order by o.name) from memberships m join orgs o on o.id = m.org_id
                where m.user_id = u.id and m.role = 'owner'
                  and not exists (select 1 from memberships x where x.org_id = m.org_id and x.role = 'owner' and x.user_id <> u.id)), '{}') as sole
    from users u order by u.created_at desc limit 2000`;
  return rows.map((r: any) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    platformAdmin: Boolean(r.platform_admin),
    createdAt: new Date(r.created_at).toISOString(),
    orgs: r.orgs,
    blocked: r.id === ctx.user.id
      ? "You"
      : r.platform_admin
        ? "Platform admin"
        : r.sole.length
          ? soleOwnerMessage(r.sole.map((name: string) => ({ name })), "them")
          : "",
  }));
}

/** The platform team deletes any account that isn't a platform admin's. */
export async function deleteAccountAsPlatform(ctx: Ctx, userId: string, input: any): Promise<{ ok: true; email: string }> {
  onlyPlatform(ctx);
  if (!UUID.test(userId)) throw new ValidationError("Unknown account.");
  const [u] = await sql`select id, email, platform_admin from users where id = ${userId}`;
  if (!u) throw new ValidationError("Unknown account.");
  if (u.id === ctx.user.id) throw new ValidationError("You can't delete your own account from here. Use Settings, Account.");
  if (u.platform_admin) throw new ValidationError("That person is a platform admin. Remove their platform access first (Settings, Platform admins).");
  requireConfirm(input, u.email, `the account ${u.email}`);
  const sole = await soleOwnerOrgs(u.id);
  if (sole.length) throw new ValidationError(soleOwnerMessage(sole, "them"));
  await auditInTheirOrgs(ctx, u.id, "account.deleted", { email: u.email, summary: `The platform team deleted the account ${u.email}` });
  await sql`delete from users where id = ${u.id}`;
  return { ok: true, email: u.email };
}
