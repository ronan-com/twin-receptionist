import type { Business } from "../../src/lib/shared";
import { defaultHours, industry } from "../../src/lib/shared";
import { AuthError, emailOf, singleAgency, hashPassword, passwordOf, sessionCookie, signUp, startSession, textOf } from "../accounts";
import { industryKeyOf } from "../answered";
import { audit } from "../audit";
import { sql } from "../db";
import { newAgencyUsesPlatform } from "../phoneAccount";
import { UI_PRODUCT } from "../product";
import { ValidationError } from "../prompt";
import { runAsOrg } from "../telnyx";
import { readBody } from "./http";

// Self-serve sign-up for the Answered build (no session needed):
//   POST /api/signup/agency    { name, email, password, agencyName }
//   POST /api/signup/business  { name, email, password, businessName, industry, suburb, timezone }
// An agency gets its own org and lands on the console. A business gets a receptionist
// in the platform's "Direct" org and a manager login, and lands on the workspace.
// The very first account on a fresh server is still the platform admin and is locked
// to FIRST_ADMIN_EMAIL (the existing signUp path). Max 5 sign-ups per address an hour.
// SELF_SIGNUP=off switches both off.

export type SignupDeps = {
  /** The same path as POST /api/clients (server/index.ts createClient). */
  createClient: (orgId: string, input: unknown, opts?: { quick?: boolean }) => Promise<Business>;
};

const LIMIT = Number(process.env.SIGNUP_LIMIT_PER_HOUR ?? 5);
const recent = new Map<string, number[]>();

// Behind Caddy the first X-Forwarded-For entry is the visitor (Caddy sets it).
function addressOf(req: Request, server?: { requestIP(r: Request): { address: string } | null }): string {
  const fwd = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return fwd || server?.requestIP(req)?.address || "unknown";
}

function checkRate(ip: string): void {
  const cutoff = Date.now() - 3_600_000;
  const list = (recent.get(ip) ?? []).filter((t) => t > cutoff);
  recent.set(ip, list);
  if (list.length >= LIMIT) throw new AuthError("Too many sign-ups from this address. Try again in an hour.", 429);
}
const countSignup = (ip: string) => recent.get(ip)?.push(Date.now()) ?? recent.set(ip, [Date.now()]);

async function noUsersYet(): Promise<boolean> {
  const [{ n }] = await sql`select count(*)::int as n from users`;
  return n === 0;
}

async function emailFree(email: string): Promise<void> {
  const [taken] = await sql`select 1 from users where email = ${email}`;
  if (taken) throw new ValidationError("There's already an account with that email. Sign in instead.");
}

function people(input: any) {
  const name = textOf(input?.name, 80);
  if (!name) throw new ValidationError("Enter your name.");
  return { name, email: emailOf(input?.email), password: passwordOf(input?.password) };
}

const ok = (req: Request, token: string, home: "/admin" | "/app", status = 201) =>
  new Response(JSON.stringify({ ok: true, home }), {
    status,
    headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(req, token) },
  });

// The platform's own org for self-serve businesses, made on first use.
async function directOrgId(): Promise<string> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(727274003)`;
    const [o] = await tx`select id from orgs where direct limit 1`;
    if (o) return o.id as string;
    const id = crypto.randomUUID();
    await tx`insert into orgs (id, name, platform_telnyx, direct) values (${id}, ${process.env.DIRECT_ORG_NAME || `${UI_PRODUCT} Direct`}, true, true)`;
    return id;
  });
}

async function agency(req: Request, input: any, ip: string): Promise<Response> {
  const who = people(input);
  const agencyName = textOf(input?.agencyName, 80);
  if (!agencyName) throw new ValidationError("Enter your agency's name.");
  // A fresh server: the first account becomes the platform admin (FIRST_ADMIN_EMAIL lock inside).
  if (await noUsersYet()) {
    const token = await signUp({ ...who, orgName: agencyName, firstOnly: true });
    countSignup(ip);
    return ok(req, token, "/admin");
  }
  await emailFree(who.email);
  const userId = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  const hash = await hashPassword(who.password);
  await sql.begin(async (tx) => {
    const [taken] = await tx`select 1 from users where email = ${who.email}`;
    if (taken) throw new ValidationError("There's already an account with that email. Sign in instead.");
    await tx`insert into orgs (id, name, platform_telnyx) values (${orgId}, ${agencyName}, ${newAgencyUsesPlatform()})`;
    await tx`insert into users (id, email, name, password_hash) values (${userId}, ${who.email}, ${who.name}, ${hash})`;
    await tx`insert into memberships (org_id, user_id, role) values (${orgId}, ${userId}, 'owner')`;
  });
  countSignup(ip);
  await audit({ user: { id: userId }, org: { id: orgId } }, "signup.agency", { agency: agencyName });
  return ok(req, await startSession(userId, orgId), "/admin");
}

async function business(req: Request, input: any, ip: string, deps: SignupDeps): Promise<Response> {
  const who = people(input);
  const businessName = textOf(input?.businessName, 80);
  if (businessName.length < 2) throw new ValidationError("Enter your business name.");
  if (await noUsersYet()) {
    const token = await signUp({ ...who, orgName: businessName, firstOnly: true });
    countSignup(ip);
    return ok(req, token, "/admin");
  }
  await emailFree(who.email);
  const key = industryKeyOf(input?.industry);
  const orgId = await directOrgId();
  // The receptionist first: if the phone provider says no, no half-made account is left behind.
  const client = await runAsOrg(orgId, () =>
    deps.createClient(
      orgId,
      {
        businessName,
        industry: key,
        hours: defaultHours(key),
        suburb: textOf(input?.suburb, 60),
        timezone: input?.timezone,
        services: industry(key).services,
        receptionistName: textOf(input?.receptionistName, 30) || "Mia",
        voiceId: input?.voiceId,
      },
      { quick: true },
    ),
  );
  const userId = crypto.randomUUID();
  const hash = await hashPassword(who.password);
  try {
    await sql.begin(async (tx) => {
      const [taken] = await tx`select 1 from users where email = ${who.email}`;
      if (taken) throw new ValidationError("There's already an account with that email. Sign in instead.");
      await tx`insert into users (id, email, name, password_hash) values (${userId}, ${who.email}, ${who.name}, ${hash})`;
      await tx`insert into memberships (org_id, user_id, role) values (${orgId}, ${userId}, 'customer')`;
      await tx`insert into client_access (user_id, client_id, role) values (${userId}, ${client.id}, 'manager')`;
    });
  } catch (err) {
    // Rare race on the same email: don't keep a receptionist nobody can reach.
    await sql`delete from clients where id = ${client.id}`.catch(() => {});
    throw err;
  }
  countSignup(ip);
  await audit({ user: { id: userId }, org: { id: orgId } }, "signup.business", { business: businessName }, { clientId: client.id });
  return ok(req, await startSession(userId, orgId), "/app");
}

export async function signupRoutes(
  req: Request,
  path: string,
  deps: SignupDeps,
  server?: { requestIP(r: Request): { address: string } | null },
): Promise<Response | null> {
  const kind = path === "/api/signup/agency" ? "agency" : path === "/api/signup/business" ? "business" : null;
  if (!kind || req.method !== "POST") return null;
  if (process.env.SELF_SIGNUP === "off") throw new AuthError("Sign-up is closed. Ask for an invite.", 403);
  const ip = addressOf(req, server);
  checkRate(ip);
  // One agency per server (SINGLE_AGENCY): only the very first account signs itself up.
  if (singleAgency() && !(await noUsersYet())) throw new AuthError("Sign-up is closed. Ask for an invite.", 403);
  const input = await readBody(req);
  return kind === "agency" ? agency(req, input, ip) : business(req, input, ip, deps);
}
