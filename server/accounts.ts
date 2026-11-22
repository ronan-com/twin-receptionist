import { createHash, randomBytes } from "node:crypto";
import type { Account, OrgRole, TeamState } from "../src/lib/shared";
import { resolveBrand } from "./brand";
import { iso, sql } from "./db";
import { importLegacyData } from "./legacy";
import { mailerReady, sendAccountEmail } from "./mailer";
import { ValidationError } from "./prompt";

// People sign in with an email and password. Each person belongs to one or more
// organisations (an agency, the sales team, or a single business), with a role:
//   owner  - everything, including other owners
//   admin  - manages the team, deletes receptionists, buys numbers
//   member - sets up and runs receptionists
// Sessions, invites and reset links are random tokens; only their hashes are stored.

export type Ctx = {
  // Set while the platform team is viewing as an agency or a customer (read-only).
  viewing?: { org: string; client: string | null; business: string };
  tokenHash: string;
  user: { id: string; email: string; name: string; platformAdmin: boolean };
  org: { id: string; name: string } | null;
  role: OrgRole | null;
};

const COOKIE = "twin_sid";
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const RESET_MINUTES = 60;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const RANK: Record<OrgRole, number> = { customer: 0, member: 1, admin: 2, owner: 3 };

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

// ---- Input checks ----

export function emailOf(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  return email;
}

function passwordOf(value: unknown): string {
  const password = String(value ?? "");
  if (password.length < 10) throw new ValidationError("Use a password of at least 10 characters.");
  if (password.length > 200) throw new ValidationError("That password is too long.");
  return password;
}

export const textOf = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

const hashPassword = (password: string) => Bun.password.hash(password, { algorithm: "argon2id" });

// ---- Base URL for links in emails ----

export function appUrl(req: Request): string {
  const fixed = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
  if (fixed) return fixed;
  // Development: the Vite page the person is using.
  const origin = req.headers.get("origin");
  return origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : "http://localhost:5173";
}

// ---- Sessions ----

function cookieValue(req: Request): string {
  const found = (req.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  return found ? found.slice(COOKIE.length + 1) : "";
}

function secure(req: Request): boolean {
  return req.headers.get("x-forwarded-proto") === "https" || req.url.startsWith("https:") || (process.env.PUBLIC_URL ?? "").startsWith("https:");
}

export function sessionCookie(req: Request, token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure(req) ? "; Secure" : ""}`;
}

export function clearCookie(req: Request): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? "; Secure" : ""}`;
}

async function startSession(userId: string, orgId: string | null): Promise<string> {
  const token = newToken();
  await sql`
    insert into sessions (token_hash, user_id, org_id, expires_at)
    values (${hashToken(token)}, ${userId}, ${orgId}, ${new Date(Date.now() + SESSION_DAYS * 86_400_000)})`;
  // Housekeeping: drop this person's expired sessions.
  await sql`delete from sessions where user_id = ${userId} and expires_at < now()`;
  return token;
}

export async function sessionFrom(req: Request): Promise<Ctx | null> {
  const token = cookieValue(req);
  if (!token || token.length > 100) return null;
  const tokenHash = hashToken(token);
  const [s] = await sql`
    select s.org_id, s.view_org_id, s.view_client_id, u.id, u.email, u.name, u.platform_admin
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash} and s.expires_at > now()`;
  if (!s) return null;
  const user = { id: s.id, email: s.email, name: s.name, platformAdmin: s.platform_admin };
  // The platform team stepping into an agency (or a business's customer view), read-only.
  if (s.platform_admin && s.view_org_id) {
    const [o] = await sql`select id, name from orgs where id = ${s.view_org_id}`;
    if (o) {
      let business = "";
      let client: string | null = null;
      if (s.view_client_id) {
        const [c] = await sql`select id, data->'settings'->>'businessName' as business from clients where id = ${s.view_client_id} and org_id = ${o.id}`;
        if (c) {
          client = c.id;
          business = c.business ?? "";
        }
      }
      return {
        tokenHash,
        user,
        org: { id: o.id, name: o.name },
        role: client ? "customer" : "admin",
        viewing: { org: o.name, client, business },
      };
    }
  }
  // The org this session is working in, or their first one if they've left it.
  const [m] = await sql`
    select m.role, o.id, o.name from memberships m join orgs o on o.id = m.org_id
    where m.user_id = ${user.id}
    order by (m.org_id = ${s.org_id}) desc nulls last, m.created_at
    limit 1`;
  if (m && m.id !== s.org_id) await sql`update sessions set org_id = ${m.id} where token_hash = ${tokenHash}`;
  return { tokenHash, user, org: m ? { id: m.id, name: m.name } : null, role: m?.role ?? null };
}

export function requireRole(ctx: Ctx, needed: OrgRole): void {
  if (!ctx.role || RANK[ctx.role] < RANK[needed]) {
    throw new AuthError(needed === "owner" ? "Only an owner can do that." : "Only an owner or admin can do that.", 403);
  }
}

// A customer sees their own business's branding on top of their agency's.
async function brandClient(ctx: Ctx): Promise<string | null> {
  if (ctx.role !== "customer") return null;
  if (ctx.viewing?.client) return ctx.viewing.client;
  const [c] = await sql`select a.client_id from client_access a join clients c on c.id = a.client_id where a.user_id = ${ctx.user.id} and c.org_id = ${ctx.org!.id} limit 1`;
  return c?.client_id ?? null;
}

export async function account(ctx: Ctx): Promise<Account> {
  const orgs = await sql`
    select o.id, o.name, m.role from memberships m join orgs o on o.id = m.org_id
    where m.user_id = ${ctx.user.id} order by o.name`;
  let telnyx: Account["telnyx"] = "none";
  if (ctx.org) {
    const [t] = await sql`select telnyx_key is not null as own, platform_telnyx from orgs where id = ${ctx.org.id}`;
    telnyx = t?.own ? "own" : t?.platform_telnyx ? "platform" : "none";
  }
  return {
    user: ctx.user,
    org: ctx.org,
    role: ctx.role,
    orgs: orgs.map((o: any) => ({ id: o.id, name: o.name, role: o.role })),
    telnyx,
    ...(ctx.viewing ? { viewing: ctx.viewing } : {}),
    brand: ctx.org ? await resolveBrand(ctx.org.id, await brandClient(ctx)) : undefined,
  };
}

// ---- Sign up, sign in, sign out ----

// Signing up is open for the very first account (which becomes the platform
// admin). After that it's invite-only unless ALLOW_SIGNUP=true.
export async function signupOpen(): Promise<{ open: boolean; firstRun: boolean }> {
  const [{ n }] = await sql`select count(*)::int as n from users`;
  return { open: n === 0 || process.env.ALLOW_SIGNUP === "true", firstRun: n === 0 };
}

export async function signUp(input: any): Promise<string> {
  const email = emailOf(input?.email);
  const password = passwordOf(input?.password);
  const name = textOf(input?.name, 80);
  const orgName = textOf(input?.orgName, 80) || (name ? `${name}'s team` : "My team");
  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  let first = false;

  await sql.begin(async (tx) => {
    // Serialise sign-ups so two people can't both become the first account.
    await tx`select pg_advisory_xact_lock(727274002)`;
    const [{ n }] = await tx`select count(*)::int as n from users`;
    first = n === 0;
    // On a fresh server, only the expected owner may become the first (platform) account.
    const firstAdmin = (process.env.FIRST_ADMIN_EMAIL ?? "").trim().toLowerCase();
    if (first && firstAdmin && email !== firstAdmin) throw new AuthError("Sign-up is by invitation. Ask your team for an invite.", 403);
    if (!first && process.env.ALLOW_SIGNUP !== "true") throw new AuthError("Sign-up is by invitation. Ask your team for an invite.", 403);
    const [taken] = await tx`select 1 from users where email = ${email}`;
    if (taken) throw new ValidationError("There's already an account with that email. Sign in instead.");
    await tx`insert into orgs (id, name, platform_telnyx) values (${orgId}, ${orgName}, ${first})`;
    await tx`insert into users (id, email, name, password_hash, platform_admin) values (${userId}, ${email}, ${name}, ${passwordHash}, ${first})`;
    await tx`insert into memberships (org_id, user_id, role) values (${orgId}, ${userId}, 'owner')`;
  });
  // Receptionists made before accounts existed belong to the first account.
  if (first) await importLegacyData(orgId).catch((err) => console.error("[legacy import]", err));
  return startSession(userId, orgId);
}

const loginFailures = new Map<string, number[]>();
// Checked when an email isn't found, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = await hashPassword("not-a-real-password-just-for-timing");

function recentFailures(key: string): number[] {
  const cutoff = Date.now() - 15 * 60_000;
  const list = (loginFailures.get(key) ?? []).filter((t) => t > cutoff);
  loginFailures.set(key, list);
  return list;
}

export async function signIn(input: any): Promise<string> {
  const email = String(input?.email ?? "").trim().toLowerCase().slice(0, 254);
  const password = String(input?.password ?? "").slice(0, 200);
  if (recentFailures(email).length >= 8 || recentFailures("*").length >= 200) {
    throw new AuthError("Too many tries. Wait 15 minutes, or reset your password.", 429);
  }
  const [user] = await sql`select id, password_hash from users where email = ${email}`;
  const ok = await Bun.password.verify(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    recentFailures(email).push(Date.now());
    recentFailures("*").push(Date.now());
    throw new AuthError("That email and password don't match.");
  }
  loginFailures.delete(email);
  return startSession(user.id, null);
}

export async function signOut(ctx: Ctx | null): Promise<void> {
  if (ctx) await sql`delete from sessions where token_hash = ${ctx.tokenHash}`;
}

export async function switchOrg(ctx: Ctx, orgId: unknown): Promise<void> {
  const [m] = await sql`select 1 from memberships where user_id = ${ctx.user.id} and org_id = ${String(orgId ?? "")}::uuid`.catch(() => []);
  if (!m) throw new ValidationError("You're not part of that team.");
  await sql`update sessions set org_id = ${String(orgId)} where token_hash = ${ctx.tokenHash}`;
}

export async function createOrg(ctx: Ctx, input: any): Promise<void> {
  // Agencies are created by the platform team (see agencies.ts), not self-served.
  if (!ctx.user.platformAdmin) throw new AuthError("Ask the platform team to set up another team for you.", 403);
  const name = textOf(input?.name, 80);
  if (!name) throw new ValidationError("Give the team a name.");
  const id = crypto.randomUUID();
  await sql.begin(async (tx) => {
    await tx`insert into orgs (id, name, platform_telnyx) values (${id}, ${name}, true)`;
    await tx`insert into memberships (org_id, user_id, role) values (${id}, ${ctx.user.id}, 'owner')`;
  });
  await sql`update sessions set org_id = ${id} where token_hash = ${ctx.tokenHash}`;
}

export async function renameOrg(ctx: Ctx, input: any): Promise<void> {
  requireRole(ctx, "owner");
  const name = textOf(input?.name, 80);
  if (!name) throw new ValidationError("Give the team a name.");
  await sql`update orgs set name = ${name} where id = ${ctx.org!.id}`;
}

export async function updateProfile(ctx: Ctx, input: any): Promise<void> {
  if (input?.name !== undefined) await sql`update users set name = ${textOf(input.name, 80)} where id = ${ctx.user.id}`;
  if (input?.newPassword !== undefined) {
    const [u] = await sql`select password_hash from users where id = ${ctx.user.id}`;
    if (!(await Bun.password.verify(String(input?.currentPassword ?? ""), u.password_hash))) {
      throw new ValidationError("Your current password isn't right.");
    }
    const hash = await hashPassword(passwordOf(input.newPassword));
    await sql`update users set password_hash = ${hash} where id = ${ctx.user.id}`;
    // Sign out everywhere else.
    await sql`delete from sessions where user_id = ${ctx.user.id} and token_hash <> ${ctx.tokenHash}`;
  }
}

// ---- Team ----

export async function team(ctx: Ctx): Promise<TeamState> {
  const orgId = ctx.org!.id;
  const members = await sql`
    select u.id, u.email, u.name, m.role, m.created_at from memberships m join users u on u.id = m.user_id
    where m.org_id = ${orgId} and m.role <> 'customer' order by m.created_at`;
  const invites = await sql`
    select token_hash, email, role, expires_at from invites
    where org_id = ${orgId} and role <> 'customer' and expires_at > now() order by created_at desc`;
  return {
    members: members.map((m: any) => ({ id: m.id, email: m.email, name: m.name, role: m.role, joinedAt: iso(m.created_at) })),
    invites: invites.map((i: any) => ({ id: i.token_hash.slice(0, 16), email: i.email, role: i.role, expiresAt: iso(i.expires_at) })),
    emailsSent: mailerReady(),
  };
}

export async function invite(ctx: Ctx, input: any, base: string): Promise<{ url: string; emailed: boolean }> {
  requireRole(ctx, "admin");
  const role: OrgRole = input?.role === "admin" ? "admin" : "member";
  return createInvite(ctx.org!.id, ctx.org!.name, emailOf(input?.email), role, ctx.user, base);
}

// Makes (or replaces) an invite link for someone to join an org.
export async function createInvite(
  orgId: string,
  orgName: string,
  email: string,
  role: OrgRole,
  by: { id: string; name: string; email: string },
  base: string,
  clientId: string | null = null,
  businessName = "",
): Promise<{ url: string; emailed: boolean }> {
  const [already] = await sql`
    select 1 from memberships m join users u on u.id = m.user_id where m.org_id = ${orgId} and u.email = ${email}`;
  if (already) throw new ValidationError(`${email} is already in this team.`);
  const [{ n }] = await sql`select count(*)::int as n from invites where org_id = ${orgId} and created_at > now() - interval '1 day'`;
  if (n >= 50) throw new ValidationError("That's a lot of invites today. Try again tomorrow.");

  const token = newToken();
  await sql`delete from invites where org_id = ${orgId} and email = ${email}`;
  await sql`
    insert into invites (token_hash, org_id, email, role, invited_by, expires_at, client_id)
    values (${hashToken(token)}, ${orgId}, ${email}, ${role}, ${by.id}, ${new Date(Date.now() + INVITE_DAYS * 86_400_000)}, ${clientId})`;
  const url = `${base}/invite/${token}`;
  const who = by.name || by.email;
  const emailed = await sendAccountEmail(
    email,
    role === "customer" ? `${who} gave you access to your calls` : `${who} invited you to ${orgName}`,
    role === "customer"
      ? `${who} (${orgName}) has set up your receptionist${businessName ? ` for ${businessName}` : ""}. Sign in to see every call, booking and follow-up.\n\nSet up your login:\n${url}\n\nThe link works for ${INVITE_DAYS} days.`
      : `${who} has invited you to ${role === "owner" ? "set up and run" : "join"} ${orgName} on Twin Receptionist.\n\nAccept the invite:\n${url}\n\nThe link works for ${INVITE_DAYS} days.`,
  ).catch((err) => {
    console.error("[mail] invite", err.message);
    return false;
  });
  return { url, emailed };
}

export async function revokeInvite(ctx: Ctx, id: unknown): Promise<void> {
  requireRole(ctx, "admin");
  const prefix = String(id ?? "");
  if (!/^[a-f0-9]{16}$/.test(prefix)) throw new ValidationError("Unknown invite.");
  await sql`delete from invites where org_id = ${ctx.org!.id} and left(token_hash, 16) = ${prefix}`;
}

async function ownerCount(orgId: string): Promise<number> {
  const [{ n }] = await sql`select count(*)::int as n from memberships where org_id = ${orgId} and role = 'owner'`;
  return n;
}

export async function changeRole(ctx: Ctx, userId: string, input: any): Promise<void> {
  requireRole(ctx, "admin");
  const role = input?.role as OrgRole;
  if (!["owner", "admin", "member"].includes(role)) throw new ValidationError("Choose owner, admin or member.");
  const orgId = ctx.org!.id;
  const [m] = await sql`select role from memberships where org_id = ${orgId} and user_id = ${userId}`;
  if (!m) throw new ValidationError("They're not in this team.");
  // Only owners can make or unmake owners.
  if ((role === "owner" || m.role === "owner") && ctx.role !== "owner") throw new AuthError("Only an owner can do that.", 403);
  if (m.role === "owner" && role !== "owner" && (await ownerCount(orgId)) <= 1) {
    throw new ValidationError("A team needs at least one owner. Make someone else an owner first.");
  }
  await sql`update memberships set role = ${role} where org_id = ${orgId} and user_id = ${userId}`;
}

export async function removeMember(ctx: Ctx, userId: string): Promise<void> {
  const orgId = ctx.org!.id;
  const leaving = userId === ctx.user.id;
  if (!leaving) requireRole(ctx, "admin");
  const [m] = await sql`select role from memberships where org_id = ${orgId} and user_id = ${userId}`;
  if (!m) throw new ValidationError("They're not in this team.");
  if (m.role === "owner" && !leaving && ctx.role !== "owner") throw new AuthError("Only an owner can remove an owner.", 403);
  if (m.role === "owner" && (await ownerCount(orgId)) <= 1) {
    throw new ValidationError("A team needs at least one owner. Make someone else an owner first.");
  }
  await sql`delete from memberships where org_id = ${orgId} and user_id = ${userId}`;
}

// ---- Accepting an invite ----

async function inviteFor(token: string) {
  const [i] = await sql`
    select i.token_hash, i.org_id, i.email, i.role, i.client_id, o.name as org_name, u.id as user_id,
      (select c.data->'settings'->>'businessName' from clients c where c.id = i.client_id) as business
    from invites i join orgs o on o.id = i.org_id left join users u on u.email = i.email
    where i.token_hash = ${hashToken(token)} and i.expires_at > now()`;
  if (!i) throw new ValidationError("This invite has expired or was already used. Ask for a new one.");
  return i;
}

export async function inviteInfo(token: string) {
  const i = await inviteFor(token);
  return { orgName: i.org_name, email: i.email, role: i.role, hasAccount: Boolean(i.user_id), businessName: i.business ?? undefined };
}

// New people choose a name and password; people with an account confirm theirs.
export async function acceptInvite(token: string, input: any): Promise<string> {
  const i = await inviteFor(token);
  let userId: string = i.user_id;
  if (userId) {
    const [u] = await sql`select password_hash from users where id = ${userId}`;
    if (!(await Bun.password.verify(String(input?.password ?? ""), u.password_hash))) {
      throw new AuthError("That password isn't right for this account.");
    }
  } else {
    userId = crypto.randomUUID();
    const hash = await hashPassword(passwordOf(input?.password));
    await sql`insert into users (id, email, name, password_hash) values (${userId}, ${i.email}, ${textOf(input?.name, 80)}, ${hash})`;
  }
  await sql.begin(async (tx) => {
    await tx`insert into memberships (org_id, user_id, role) values (${i.org_id}, ${userId}, ${i.role}) on conflict do nothing`;
    if (i.client_id) await tx`insert into client_access (user_id, client_id) values (${userId}, ${i.client_id}) on conflict do nothing`;
    await tx`delete from invites where token_hash = ${i.token_hash}`;
  });
  return startSession(userId, i.org_id);
}

// ---- Forgotten passwords ----

export async function requestReset(input: any, base: string): Promise<void> {
  const email = String(input?.email ?? "").trim().toLowerCase().slice(0, 254);
  if (recentFailures(`reset:${email}`).length >= 3) return;
  recentFailures(`reset:${email}`).push(Date.now());
  const [u] = await sql`select id from users where email = ${email}`;
  // Same answer either way, so this can't be used to find out who has an account.
  if (!u) return;
  const token = newToken();
  await sql`delete from password_resets where user_id = ${u.id}`;
  await sql`
    insert into password_resets (token_hash, user_id, expires_at)
    values (${hashToken(token)}, ${u.id}, ${new Date(Date.now() + RESET_MINUTES * 60_000)})`;
  await sendAccountEmail(
    email,
    "Reset your Twin Receptionist password",
    `Someone asked to reset the password for this account. If it was you, choose a new one here:\n${base}/reset/${token}\n\nThe link works for ${RESET_MINUTES} minutes. If it wasn't you, ignore this email.`,
  ).catch((err) => console.error("[mail] reset", err.message));
}

export async function resetPassword(token: string, input: any): Promise<string> {
  const hash = await hashPassword(passwordOf(input?.password));
  const [r] = await sql`delete from password_resets where token_hash = ${hashToken(token)} returning user_id, expires_at`;
  if (!r || new Date(r.expires_at).getTime() < Date.now()) throw new ValidationError("This reset link has expired. Ask for a new one.");
  await sql`update users set password_hash = ${hash} where id = ${r.user_id}`;
  // Anyone signed in with the old password is signed out.
  await sql`delete from sessions where user_id = ${r.user_id}`;
  return startSession(r.user_id, null);
}
