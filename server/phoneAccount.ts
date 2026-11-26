import type { PhoneAccount } from "../src/lib/shared";
import { AuthError, requireRole, singleAgency, type Ctx } from "./accounts";
import { audit } from "./audit";
import { iso, sql } from "./db";
import { ValidationError } from "./prompt";
import { fakeProvider } from "./sandbox";
import { seal, unseal } from "./secrets";
import { TelnyxError, forgetKey, telnyx } from "./telnyx";

// An agency's own phone account: its Telnyx API key, checked against Telnyx and
// kept sealed (orgs.telnyx_key). With OWN_PHONE_ACCOUNT=required, new agencies start
// with no phone account and connect their own in Setup before they can do anything
// that needs one. Without it, new agencies run on the platform's account as before.

// With SINGLE_AGENCY the one agency always runs on the server's own key (from the install).
export const ownAccountRequired = () => process.env.OWN_PHONE_ACCOUNT === "required" && !singleAgency();

/** Whether a new agency starts on the platform's phone account. */
export const newAgencyUsesPlatform = () => !ownAccountRequired();

// Local test servers (fake provider) accept this pretend key, so the setup screens
// can be clicked through without a Telnyx account. A real server never does.
const TEST_KEY = "KEYTEST-LOCAL-DEMO-0001";
const isTestKey = (key: string) => fakeProvider() && key.startsWith("KEYTEST");

const LOW_CREDIT = 5;

type Balance = { amount: number; currency: string };

/** Asks Telnyx whether the key works. Throws a message the person can act on. */
export async function checkKey(raw: unknown): Promise<{ key: string; balance: Balance }> {
  const key = String(raw ?? "").trim();
  if (!key) throw new ValidationError("Paste your API key first.");
  if (/\s/.test(key) || key.length < 20 || key.length > 300) {
    throw new ValidationError("That doesn't look like a whole API key. Copy it again: it's one long line that starts with KEY.");
  }
  if (isTestKey(key)) return { key, balance: { amount: 25, currency: "USD" } };
  try {
    const res = await telnyx<{ data?: any }>("GET", "/balance", undefined, key);
    return { key, balance: { amount: Number(res.data?.available_credit ?? res.data?.balance ?? 0), currency: res.data?.currency ?? "USD" } };
  } catch (err) {
    if (err instanceof TelnyxError && (err.status === 401 || err.status === 403)) {
      throw new ValidationError("Telnyx didn't accept that key. Copy it again from API Keys in Telnyx, or make a new one.");
    }
    throw err;
  }
}

// A handful of checks a minute per agency is plenty; more looks like key guessing.
const checks = new Map<string, number[]>();
export function countCheck(orgId: string): void {
  const now = Date.now();
  const recent = (checks.get(orgId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 10) throw new AuthError("Too many tries. Wait a minute and try again.", 429);
  checks.set(orgId, [...recent, now]);
}

async function modeOf(orgId: string) {
  const [o] = await sql`select telnyx_key, telnyx_key_last4, telnyx_key_at, platform_telnyx from orgs where id = ${orgId}`;
  const mode: PhoneAccount["mode"] = o?.telnyx_key ? "own" : o?.platform_telnyx ? "platform" : "none";
  return { mode, row: o };
}

/** Refuses when the agency has no phone account yet (its own or the platform's). */
export async function requirePhoneAccount(orgId: string): Promise<void> {
  if ((await modeOf(orgId)).mode === "none") throw new ValidationError("Connect your Telnyx account first. Open Setup to do it.");
}

/** Local test servers: this agency's phone account is a pretend one, so nothing reaches Telnyx. */
export async function pretendAccount(orgId: string): Promise<boolean> {
  if (!fakeProvider()) return false;
  const { mode, row } = await modeOf(orgId);
  return mode !== "own" || isTestKey(unseal(row.telnyx_key));
}

/** Buying numbers: the platform team, or an agency paying from its own phone account. */
export async function canBuyNumbers(ctx: Ctx): Promise<boolean> {
  if (ctx.user.platformAdmin) return true;
  if (!ctx.org || ctx.viewing || (ctx.role !== "owner" && ctx.role !== "admin")) return false;
  const { mode } = await modeOf(ctx.org.id);
  // SINGLE_AGENCY: the agency's owners and admins buy straight on the server's key.
  if (singleAgency()) return mode !== "none";
  return mode === "own";
}

export async function phoneAccount(ctx: Ctx): Promise<PhoneAccount> {
  const orgId = ctx.org!.id;
  const { mode, row } = await modeOf(orgId);
  let balance: Balance | null = null;
  let problem = "";
  if (mode === "own") {
    try {
      balance = (await checkKey(unseal(row.telnyx_key))).balance;
    } catch (err) {
      problem = (err as Error).message;
    }
  }
  const [c] = await sql`
    select count(*)::int as clients,
      coalesce(sum(case when jsonb_typeof(data->'phoneNumbers') = 'array' then jsonb_array_length(data->'phoneNumbers') else 0 end), 0)::int as numbers
    from clients where org_id = ${orgId}`;
  const [k] = await sql`select count(*)::int as n from calendar_links l join clients c on c.id = l.client_id where c.org_id = ${orgId}`;
  return {
    mode,
    last4: mode === "own" ? (row?.telnyx_key_last4 ?? "") : "",
    connectedAt: mode === "own" ? iso(row?.telnyx_key_at) : "",
    balance,
    problem,
    lowCredit: balance !== null && balance.amount < LOW_CREDIT,
    required: ownAccountRequired(),
    installed: singleAgency(),
    counts: { clients: c?.clients ?? 0, numbers: c?.numbers ?? 0, calendars: k?.n ?? 0 },
    ...(fakeProvider() ? { testKey: TEST_KEY } : {}),
  };
}

const INSTALLED = "This server's Telnyx key was set when it was installed. Change TELNYX_API_KEY on the server instead.";

export async function connectPhoneAccount(ctx: Ctx, input: any): Promise<PhoneAccount> {
  requireRole(ctx, "admin");
  if (singleAgency()) throw new ValidationError(INSTALLED);
  const orgId = ctx.org!.id;
  countCheck(orgId);
  const { key } = await checkKey(input?.key);

  // Receptionists live inside one Telnyx account. A key from a different account
  // would leave every existing one unreachable, so check one of them answers to it.
  if (!isTestKey(key)) {
    const [existing] = await sql`
      select data->>'assistantId' as assistant from clients
      where org_id = ${orgId} and data->>'assistantId' not like 'demo-%' limit 1`;
    if (existing?.assistant) {
      try {
        await telnyx("GET", `/ai/assistants/${existing.assistant}`, undefined, key);
      } catch (err) {
        if (err instanceof TelnyxError && err.status < 500) {
          throw new ValidationError("That key belongs to a different Telnyx account from the one your receptionists are on. Use a key from the same account.");
        }
        throw err;
      }
    }
  }

  await sql`update orgs set telnyx_key = ${seal(key)}, telnyx_key_last4 = ${key.slice(-4)}, telnyx_key_at = now() where id = ${orgId}`;
  forgetKey(orgId);
  await audit(ctx, "phone_account.connect", { last4: key.slice(-4) });
  return phoneAccount(ctx);
}

export async function disconnectPhoneAccount(ctx: Ctx): Promise<PhoneAccount> {
  requireRole(ctx, "owner");
  if (singleAgency()) throw new ValidationError(INSTALLED);
  const orgId = ctx.org!.id;
  await sql`update orgs set telnyx_key = null, telnyx_key_last4 = null, telnyx_key_at = null where id = ${orgId}`;
  forgetKey(orgId);
  await audit(ctx, "phone_account.disconnect", {});
  return phoneAccount(ctx);
}
