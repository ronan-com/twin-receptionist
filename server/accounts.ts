import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Account, OrgRole, TeamState } from "../src/lib/shared";
import { clientAccessOf, consoleOf } from "./answered";
import { canUseAssistant } from "./assistant";
import { applyInstallBrand, resolveBrand } from "./brand";
import { audit } from "./audit";
import { publicUrl } from "./booking";
import { iso, sql } from "./db";
import { purgeOrphanUsers } from "./deleteUsers";
import { importLegacyData } from "./legacy";
import { mailerReady, sendAccountEmail } from "./mailer";
import { ValidationError } from "./prompt";
import { UI_PRODUCT } from "./product";
import { accountMode, providerOfOrg } from "./voice/config";
import { supportAccessOpen, supportEditAllowed, supportSeller } from "./supportAccess";
export { readOnlyView } from "./supportChanges";

// People sign in with an email and password. Each person belongs to one or more
// organisations (an agency, the sales team, or a single business), with a role:
//   owner  - everything, including other owners
//   admin  - manages the team, deletes receptionists, buys numbers
//   member - sets up and runs receptionists
// Sessions, invites and reset links are random tokens; only their hashes are stored.

export type Ctx = {
  // Set while the platform team is viewing as an agency or a customer (read-only).
  // `support` marks a sign-in by the setup provider's support person (Settings, "Support access").
  viewing?: { org: string; client: string | null; business: string; support?: boolean; by?: string; canEdit?: boolean };
  tokenHash: string;
  user: { id: string; email: string; name: string; platformAdmin: boolean };
  org: { id: string; name: string } | null;
  role: OrgRole | null;
};

const COOKIE = "twin_sid";
// The product name in account emails: the same name the screens show (PRODUCT_NAME).
const PRODUCT = UI_PRODUCT;
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const RESET_MINUTES = 60;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
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

export function passwordOf(value: unknown): string {
  const password = String(value ?? "");
  if (password.length < 10) throw new ValidationError("Use a password of at least 10 characters.");
  if (password.length > 200) throw new ValidationError("That password is too long.");
  return password;
}

export const textOf = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

export const hashPassword = (password: string) => Bun.password.hash(password, { algorithm: "argon2id" });

// ---- Base URL for links in emails ----

export function appUrl(req: Request): string {
  if (process.env.PUBLIC_URL) return publicUrl() || process.env.PUBLIC_URL.replace(/\/$/, "");
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

// SINGLE_AGENCY=1 (self-hosted copies): the server is one agency selling receptionists
// to its own clients, with no platform above it. The first account owns that agency
// and gets the agency console (not the platform one); nobody is a platform admin,
// self-serve sign-up is off after the first account, and numbers are bought straight
// on the server's own Telnyx key (TELNYX_API_KEY, set by the install).
export const singleAgency = () => ["1", "true", "yes", "on"].includes((process.env.SINGLE_AGENCY ?? "").trim().toLowerCase());

/** Who may change the server's own settings (Settings, "Email and calendars"). */
export const canChangeServerSettings = (ctx: Ctx) =>
  ctx.user.platformAdmin || (singleAgency() && ctx.role === "owner" && !ctx.viewing);

export async function startSession(userId: string, orgId: string | null): Promise<string> {
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
    select s.org_id, s.view_org_id, s.view_client_id, s.support, u.id, u.email, u.name, u.platform_admin
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash} and s.expires_at > now()`;
  if (!s) return null;
  // With SINGLE_AGENCY there's no platform team: the first account is the agency's owner.
  const user = { id: s.id, email: s.email, name: s.name, platformAdmin: Boolean(s.platform_admin) && !singleAgency() };
  // The setup provider's support person: the agency's console, read-only, and only while the owner has
  // Support access on (turning it off or letting it expire ends the session on its next request).
  if (s.support) {
    const [o] = s.org_id ? await sql`select id, name from orgs where id = ${s.org_id}` : [];
    if (!o || !(await supportAccessOpen())) {
      await sql`delete from sessions where token_hash = ${tokenHash}`;
      return null;
    }
    let client: string | null = null;
    let business = "";
    if (s.view_client_id) {
      const [c] = await sql`select id, data->'settings'->>'businessName' as business from clients where id = ${s.view_client_id} and org_id = ${o.id}`;
      if (c) {
        client = c.id;
        business = c.business ?? "";
      }
    }
    return {
      tokenHash,
      user: { ...user, platformAdmin: false },
      org: { id: o.id, name: o.name },
      role: client ? "customer" : "admin",
      // canEdit: the owner lets support make changes (the default). Only for the agency itself, never for a customer's view.
      viewing: { org: o.name, client, business, support: true, by: supportSeller(), ...(client ? {} : { canEdit: await supportEditAllowed() }) },
    };
  }
  // The platform team stepping into an agency (or a business's customer view), read-only.
  if (user.platformAdmin && s.view_org_id) {
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
  // Agency owners/admins viewing one of their own clients' workspaces, read-only.
  if (!user.platformAdmin && s.view_client_id) {
    const [c] = await sql`
      select c.id, c.data->'settings'->>'businessName' as business, o.id as org_id, o.name
      from clients c join orgs o on o.id = c.org_id
      join memberships m on m.org_id = o.id and m.user_id = ${user.id} and m.role in ('owner', 'admin')
      where c.id = ${s.view_client_id} and o.id = ${s.view_org_id}`;
    if (c) {
      return {
        tokenHash,
        user,
        org: { id: c.org_id, name: c.name },
        role: "customer",
        viewing: { org: c.name, client: c.id, business: c.business ?? "" },
      };
    }
    await sql`update sessions set view_org_id = null, view_client_id = null where token_hash = ${tokenHash}`;
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
    telnyx = await accountMode(ctx.org.id, await providerOfOrg(ctx.org.id));
  }
  const consoleKind = consoleOf(ctx);
  const [pw] = await sql`select password_unset from users where id = ${ctx.user.id}`;
  return {
    user: ctx.user,
    // An owner the install made, who hasn't chosen a password yet (Settings asks for no current password).
    ...(pw?.password_unset ? { needsPassword: true } : {}),
    org: ctx.org,
    role: ctx.role,
    orgs: orgs.map((o: any) => ({ id: o.id, name: o.name, role: o.role })),
    telnyx,
    // The Answered UI: which screens this person uses, and their access to each business.
    console: consoleKind,
    home: consoleKind ? "/admin" : "/app",
    access: await clientAccessOf(ctx),
    singleAgency: singleAgency(),
    serverSettings: canChangeServerSettings(ctx),
    // The "Ask for help" Helper: this person is an agency owner or admin. (With no AI key it says so in the chat.)
    assistant: canUseAssistant(ctx),
    ...(ctx.viewing ? { viewing: ctx.viewing } : {}),
    brand: ctx.org ? await resolveBrand(ctx.org.id, await brandClient(ctx)) : undefined,
  };
}

// ---- Sign up, sign in, sign out ----

// Signing up is open for the very first account (which becomes the platform
// admin). After that it's invite-only unless ALLOW_SIGNUP=true.
export async function signupOpen(): Promise<{ open: boolean; firstRun: boolean }> {
  const [{ n }] = await sql`select count(*)::int as n from users`;
  // One agency per server: after its first account, people join by invite only.
  if (singleAgency()) return { open: n === 0, firstRun: n === 0 };
  return { open: n === 0 || process.env.ALLOW_SIGNUP === "true", firstRun: n === 0 };
}

export async function signUp(input: any): Promise<string> {
  const email = emailOf(input?.email);
  const password = passwordOf(input?.password);
  const name = textOf(input?.name, 80);
  // A buyer's own copy is one agency, named after its brand.
  const orgName = singleAgency() ? UI_PRODUCT : textOf(input?.orgName, 80) || (name ? `${name}'s team` : "My team");
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
    if (first && firstAdmin && email !== firstAdmin) {
      throw new AuthError(
        singleAgency()
          ? "Use the owner email you gave during setup to create the first account."
          : "Sign-up is by invitation. Ask your team for an invite.",
        403,
      );
    }
    // The self-serve sign-up (server/routes/signup.ts) only comes here for the very first account.
    if (!first && input?.firstOnly === true) throw new AuthError("The first account was just created. Refresh and try again.", 409);
    if (!first && (process.env.ALLOW_SIGNUP !== "true" || singleAgency())) throw new AuthError("Sign-up is by invitation. Ask your team for an invite.", 403);
    const [taken] = await tx`select 1 from users where email = ${email}`;
    if (taken) throw new ValidationError("There's already an account with that email. Sign in instead.");
    await tx`insert into orgs (id, name, platform_telnyx) values (${orgId}, ${orgName}, ${first})`;
    await tx`insert into users (id, email, name, password_hash, platform_admin) values (${userId}, ${email}, ${name}, ${passwordHash}, ${first})`;
    await tx`insert into memberships (org_id, user_id, role) values (${orgId}, ${userId}, 'owner')`;
  });
  // Receptionists made before accounts existed belong to the first account.
  if (first) await importLegacyData(orgId).catch((err) => console.error("[legacy import]", err));
  if (first && singleAgency()) await applyInstallBrand(orgId);
  return startSession(userId, orgId);
}

// ---- First run: the owner is made at start-up, from what the buyer gave the setup wizard ----

export const FIRST_LOGIN_HOURS = 24;

/**
 * A fresh SINGLE_AGENCY copy that the installer configured (FIRST_ADMIN_EMAIL plus OWNER_NAME, AGENCY_NAME
 * or FIRST_LOGIN_TOKEN) gets its owner account on first start, so nobody sees a "create your account" form.
 * The owner has no password yet. FIRST_LOGIN_TOKEN (made by the installer, shown only as the done screen's
 * button) is stored hashed with a 24 hour expiry and works once (see firstLogin). A copy that already has
 * any account, or one the installer did not configure, is left exactly as it was (the old sign-up form).
 */
export async function bootstrapOwner(): Promise<"created" | "skipped"> {
  await sql`delete from first_logins where expires_at < now()`;
  if (!singleAgency()) return "skipped";
  const emailRaw = (process.env.FIRST_ADMIN_EMAIL ?? "").trim();
  const ownerName = textOf(process.env.OWNER_NAME, 80);
  const agencyName = textOf(process.env.AGENCY_NAME, 80);
  const token = (process.env.FIRST_LOGIN_TOKEN ?? "").trim();
  if (!emailRaw || !(ownerName || agencyName || token)) return "skipped";
  const email = emailOf(emailRaw);
  const userId = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  // Nobody can sign in with this: it is replaced when the owner chooses a password.
  const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
  let made = false;
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(727274002)`;
    const [{ n }] = await tx`select count(*)::int as n from users`;
    if (n > 0) return;
    await tx`insert into orgs (id, name, platform_telnyx) values (${orgId}, ${agencyName || UI_PRODUCT}, true)`;
    await tx`insert into users (id, email, name, password_hash, platform_admin, password_unset) values (${userId}, ${email}, ${ownerName || email.split("@")[0]}, ${passwordHash}, true, true)`;
    await tx`insert into memberships (org_id, user_id, role) values (${orgId}, ${userId}, 'owner')`;
    if (token.length >= 32) {
      await tx`insert into first_logins (token_hash, user_id, expires_at) values (${hashToken(token)}, ${userId}, ${new Date(Date.now() + FIRST_LOGIN_HOURS * 3_600_000)})`;
    }
    made = true;
  });
  if (!made) return "skipped";
  await importLegacyData(orgId).catch((err) => console.error("[legacy import]", err));
  await applyInstallBrand(orgId);
  console.log(`[first run] owner account made for ${email}`);
  return "created";
}

/**
 * The one-time sign-in link (/welcome?t=...). The token is compared by its hash in constant time, deleted
 * the moment it matches (so it works once, even if two requests race), and refused after 24 hours.
 */
export async function firstLogin(input: any): Promise<string> {
  const refuse = () => {
    recentFailures("welcome").push(Date.now());
    return new AuthError("This sign-in link has already been used or has expired. Sign in with your email, or choose \"Forgot password\".", 401);
  };
  if (recentFailures("welcome").length >= 10) throw new AuthError("Too many tries. Wait 15 minutes, then sign in with your email.", 429);
  const token = String(input?.token ?? "").slice(0, 200);
  if (token.length < 32) throw refuse();
  const given = Buffer.from(hashToken(token), "hex");
  const rows = await sql`select token_hash, user_id, expires_at from first_logins`;
  let hit: { token_hash: string; user_id: string; expires_at: Date } | null = null;
  for (const r of rows as any[]) {
    const stored = Buffer.from(String(r.token_hash), "hex");
    if (stored.length === given.length && timingSafeEqual(stored, given)) hit = r;
  }
  if (!hit) throw refuse();
  const [burned] = await sql`delete from first_logins where token_hash = ${hit.token_hash} returning user_id`;
  if (!burned || new Date(hit.expires_at).getTime() < Date.now()) throw refuse();
  return startSession(hit.user_id, null);
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
  const [user] = await sql`select id, password_hash from users where email = ${email} and not support`;
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
    const [u] = await sql`select password_hash, password_unset from users where id = ${ctx.user.id}`;
    // An owner made by the install has no password yet, so there is no current one to ask for.
    if (!u.password_unset && !(await Bun.password.verify(String(input?.currentPassword ?? ""), u.password_hash))) {
      throw new ValidationError("Your current password isn't right.");
    }
    const hash = await hashPassword(passwordOf(input.newPassword));
    await sql`update users set password_hash = ${hash}, password_unset = false where id = ${ctx.user.id}`;
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
  // For a business invite: what they get once they accept (client_access.role).
  accessRole: "manager" | "viewer" | null = null,
): Promise<{ url: string; emailed: boolean }> {
  const [already] = await sql`
    select 1 from memberships m join users u on u.id = m.user_id where m.org_id = ${orgId} and u.email = ${email}`;
  if (already) throw new ValidationError(`${email} is already in this team.`);
  const [{ n }] = await sql`select count(*)::int as n from invites where org_id = ${orgId} and created_at > now() - interval '1 day'`;
  if (n >= 50) throw new ValidationError("That's a lot of invites today. Try again tomorrow.");

  const token = newToken();
  await sql`delete from invites where org_id = ${orgId} and email = ${email}`;
  await sql`
    insert into invites (token_hash, org_id, email, role, invited_by, expires_at, client_id, access_role)
    values (${hashToken(token)}, ${orgId}, ${email}, ${role}, ${by.id}, ${new Date(Date.now() + INVITE_DAYS * 86_400_000)}, ${clientId}, ${clientId ? accessRole : null})`;
  const url = `${base}/invite/${token}`;
  const who = by.name || by.email;
  const emailed = await sendAccountEmail(
    email,
    role === "customer" ? `${who} gave you access to your calls` : `${who} invited you to ${orgName}`,
    role === "customer"
      ? `${who} (${orgName}) has set up your receptionist${businessName ? ` for ${businessName}` : ""}. Sign in to see every call, booking and follow-up.\n\nSet up your login:\n${url}\n\nThe link works for ${INVITE_DAYS} days.`
      : `${who} has invited you to ${role === "owner" ? "set up and run" : "join"} ${orgName} on ${PRODUCT}.\n\nAccept the invite:\n${url}\n\nThe link works for ${INVITE_DAYS} days.`,
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

/**
 * Takes someone out of this team for good: their membership and their sign-ins here go, and so does their
 * account if they belong to no other team. `input.confirm` must be their email (typed in the dialog).
 */
export async function removeMember(ctx: Ctx, userId: string, input: any = {}): Promise<{ userDeleted: boolean }> {
  const orgId = ctx.org!.id;
  const leaving = userId === ctx.user.id;
  if (!leaving) requireRole(ctx, "admin");
  const [m] = await sql`select m.role, u.email from memberships m join users u on u.id = m.user_id where m.org_id = ${orgId} and m.user_id = ${userId}`;
  if (!m) throw new ValidationError("They're not in this team.");
  if (m.role === "owner" && !leaving && ctx.role !== "owner") throw new AuthError("Only an owner can remove an owner.", 403);
  if (m.role === "owner" && (await ownerCount(orgId)) <= 1) {
    throw new ValidationError("A team needs at least one owner. Make someone else an owner first.");
  }
  if (String(input?.confirm ?? "").trim() !== m.email) throw new ValidationError(`Type "${m.email}" exactly to confirm removing them.`);
  let userDeleted = false;
  await sql.begin(async (tx) => {
    await tx`delete from memberships where org_id = ${orgId} and user_id = ${userId}`;
    await tx`delete from client_access a using clients c where c.id = a.client_id and c.org_id = ${orgId} and a.user_id = ${userId}`;
    // Anything they had open in this team is closed; sign-ins to other teams stay.
    await tx`update sessions set org_id = null where org_id = ${orgId} and user_id = ${userId}`;
    userDeleted = (await purgeOrphanUsers([userId], tx as any)).length > 0;
  });
  await audit(ctx, "member.removed", { email: m.email, userDeleted, summary: `${leaving ? `${m.email} left` : `Removed ${m.email} from`} the team${userDeleted ? " (account deleted)" : ""}` });
  return { userDeleted };
}

// ---- Accepting an invite ----

async function inviteFor(token: string) {
  const [i] = await sql`
    select i.token_hash, i.org_id, i.email, i.role, i.client_id, i.access_role, i.company_id, o.name as org_name, u.id as user_id,
      (select c.data->'settings'->>'businessName' from clients c where c.id = i.client_id) as business
    from invites i join orgs o on o.id = i.org_id left join users u on u.email = i.email
    where i.token_hash = ${hashToken(token)} and i.expires_at > now()`;
  if (!i) throw new ValidationError("This invite has expired or was already used. Ask for a new one.");
  return i;
}

export async function inviteInfo(token: string) {
  const i = await inviteFor(token);
  return {
    orgName: i.org_name,
    email: i.email,
    role: i.role,
    hasAccount: Boolean(i.user_id),
    businessName: i.business ?? undefined,
    ...(i.client_id ? { accessRole: (i.access_role ?? "viewer") as "manager" | "viewer" } : {}),
  };
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
    // A business invite carries the access it gives (manager or viewer; viewer if unset).
    if (i.client_id) {
      const role = i.access_role === "manager" ? "manager" : "viewer";
      await tx`
        insert into client_access (user_id, client_id, role) values (${userId}, ${i.client_id}, ${role})
        on conflict (user_id, client_id) do update set role = excluded.role`;
    }
    // An invite from a company (console): every receptionist of that company.
    if (i.company_id) {
      const role = i.access_role === "manager" ? "manager" : "viewer";
      await tx`
        insert into client_access (user_id, client_id, role)
        select ${userId}, c.id, ${role} from clients c where c.company_id = ${i.company_id} and c.org_id = ${i.org_id}
        on conflict (user_id, client_id) do update set role = excluded.role`;
    }
    await tx`delete from invites where token_hash = ${i.token_hash}`;
  });
  return startSession(userId, i.org_id);
}

// ---- Forgotten passwords ----

/** Makes a one-hour reset link for a user and emails it if mail is set up. Returns the link either way. */
async function makeReset(userId: string, email: string, base: string, opts: { minutes?: number; send?: boolean } = {}): Promise<{ url: string; emailed: boolean }> {
  const minutes = opts.minutes ?? RESET_MINUTES;
  const token = newToken();
  await sql`delete from password_resets where user_id = ${userId}`;
  await sql`
    insert into password_resets (token_hash, user_id, expires_at)
    values (${hashToken(token)}, ${userId}, ${new Date(Date.now() + minutes * 60_000)})`;
  const url = `${base}/reset/${token}`;
  if (opts.send === false) return { url, emailed: false };
  const emailed = await sendAccountEmail(
    email,
    `Reset your ${PRODUCT} password`,
    `Someone asked to reset the password for this account. If it was you, choose a new one here:\n${url}\n\nThe link works for ${minutes} minutes. If it wasn't you, ignore this email.`,
  ).catch((err) => {
    console.error("[mail] reset", err.message);
    return false;
  });
  return { url, emailed };
}

/**
 * "Forgot password". The answer is the same whether or not the email has an account (so it can't be
 * used to find out who does), but it says whether this server can send email at all: without it the
 * page can say "ask your owner for a reset link" instead of "check your inbox".
 */
export async function requestReset(input: any, base: string): Promise<{ emailsSetUp: boolean }> {
  const emailsSetUp = mailerReady();
  const email = String(input?.email ?? "").trim().toLowerCase().slice(0, 254);
  if (recentFailures(`reset:${email}`).length >= 3) return { emailsSetUp };
  recentFailures(`reset:${email}`).push(Date.now());
  const [u] = await sql`select id from users where email = ${email} and not support`;
  if (!u) return { emailsSetUp };
  await makeReset(u.id, email, base);
  return { emailsSetUp };
}

/**
 * An owner or admin makes a reset link for someone in their team and gets it back to copy, for
 * servers where email isn't set up (or the email didn't arrive). Only for people in their own team;
 * only an owner can do it for an owner.
 */
export async function memberResetLink(ctx: Ctx, userId: string, base: string): Promise<{ url: string; emailed: boolean; email: string }> {
  requireRole(ctx, "admin");
  const [m] = await sql`
    select u.email, m.role from memberships m join users u on u.id = m.user_id where m.org_id = ${ctx.org!.id} and m.user_id = ${userId}`;
  if (!m || m.role === "customer") throw new ValidationError("They're not in this team.");
  if (m.role === "owner" && ctx.role !== "owner") throw new AuthError("Only an owner can reset an owner's password.", 403);
  return { ...(await makeReset(userId, m.email, base)), email: m.email };
}

export const OWNER_RESET_MINUTES = 15;

/**
 * A one-time reset link for the agency OWNER only (the oldest owner of the oldest real agency), valid
 * 15 minutes, never emailed. For the setup site's "Reset your owner password" (see supportSync.ts).
 * Returns null when there's no owner to reset.
 */
export async function ownerResetLink(base: string): Promise<{ url: string; expiresInMinutes: number; orgId: string } | null> {
  const [o] = await sql`
    select m.org_id, u.id as user_id, u.email
    from memberships m join users u on u.id = m.user_id join orgs g on g.id = m.org_id
    where m.role = 'owner' and not g.sandbox and not u.support
    order by g.created_at, m.created_at limit 1`;
  if (!o) return null;
  const { url } = await makeReset(o.user_id, o.email, base, { minutes: OWNER_RESET_MINUTES, send: false });
  return { url, expiresInMinutes: OWNER_RESET_MINUTES, orgId: o.org_id };
}

export async function resetPassword(token: string, input: any): Promise<string> {
  const hash = await hashPassword(passwordOf(input?.password));
  const [r] = await sql`delete from password_resets where token_hash = ${hashToken(token)} returning user_id, expires_at`;
  if (!r || new Date(r.expires_at).getTime() < Date.now()) throw new ValidationError("This reset link has expired. Ask for a new one.");
  await sql`update users set password_hash = ${hash}, password_unset = false where id = ${r.user_id}`;
  // Anyone signed in with the old password is signed out.
  await sql`delete from sessions where user_id = ${r.user_id}`;
  return startSession(r.user_id, null);
}
