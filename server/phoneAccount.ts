import type { PhoneAccount, TwilioAccount, VoiceProviderId } from "../src/lib/shared";
import { AuthError, requireRole, singleAgency, type Ctx } from "./accounts";
import { audit } from "./audit";
import { iso, sql } from "./db";
import { ValidationError } from "./prompt";
import { fakeProvider } from "./sandbox";
import { seal, unseal } from "./secrets";
import { TelnyxError, forgetKey, telnyx } from "./telnyx";
import { VapiError, accountMode, asProvider, forgetVapiKey, installProvider, ownKeyInstall, platformVapi, providerOfOrg, vapiCredsFor } from "./voice/config";
import { checkVapiKey, vapi } from "./voice/vapi";
import { TEST_SID, TEST_TOKEN, checkTwilio, clearTwilio, isTestTwilio, parseTwilioInput, saveTwilio, twilioCredsFor } from "./twilio";

// An agency's own phone account: its Telnyx API key (or, when it chooses Vapi, its Vapi
// private and public keys), checked against the provider and kept sealed (orgs.telnyx_key,
// orgs.vapi_key). The engine it chooses is orgs.voice_provider (server/voice/config.ts). With OWN_PHONE_ACCOUNT=required, new agencies start
// with no phone account and connect their own in Setup before they can do anything
// that needs one. Without it, new agencies run on the platform's account as before.

// With SINGLE_AGENCY the one agency runs on the server's own key (from the install), unless the
// install was made with no key (ownKeyInstall: the buyer skipped Phones in setup). Then the agency
// connects its own key in Connections, like any agency that brings its own account.
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

/**
 * A Telnyx account still on "pretrial" accepts the key and shows a balance, but can't create AI assistants or buy
 * numbers. Telnyx has no endpoint for the account level, so ask two cheap read-only lists a pretrial account isn't
 * allowed: a permission refusal, or an answer about pretrial / account level / upgrading, means pretrial. Network
 * trouble or Telnyx being down never blocks anyone. Same rule as the setup site (download-site/providers.ts).
 */
export const PRETRIAL_MSG = "Your Telnyx account is still on pretrial. Upgrade it in Telnyx (profile → Account Level → Upgrade, confirm with LinkedIn or GitHub, add US$10), then press Check again.";
const PRETRIAL_RE = /pre-?trial|account level|upgrade (?:your|the) account|trial account or higher|requires? (?:a )?(?:trial|paid|verified) account/i;
export function telnyxSaysPretrial(status: number, detail: string): boolean {
  if (status === 401 || status === 403) return true;
  return status >= 400 && status < 500 && status !== 404 && status !== 429 && PRETRIAL_RE.test(detail);
}
export async function isPretrial(key: string): Promise<boolean> {
  const probe = (path: string) => telnyx("GET", path, undefined, key).then(() => false, (err) => err instanceof TelnyxError && err.status !== 502 && telnyxSaysPretrial(err.status, err.message));
  const [ai, cc] = await Promise.all([probe("/ai/assistants?page[size]=1"), probe("/call_control_applications?page[size]=1")]);
  return ai || cc;
}
/** A key being connected (or tested) in Connections: it works, and the account isn't on pretrial. */
export async function checkNewKey(raw: unknown): Promise<{ key: string; balance: Balance }> {
  const r = await checkKey(raw);
  if (!isTestKey(r.key) && (await isPretrial(r.key))) throw new ValidationError(PRETRIAL_MSG);
  return r;
}

// A handful of checks a minute per agency is plenty; more looks like key guessing.
const checks = new Map<string, number[]>();
export function countCheck(orgId: string): void {
  const now = Date.now();
  const recent = (checks.get(orgId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 10) throw new AuthError("Too many tries. Wait a minute and try again.", 429);
  checks.set(orgId, [...recent, now]);
}

async function modeOf(orgId: string, engine?: VoiceProviderId) {
  const provider = engine ?? (await providerOfOrg(orgId));
  const [o] = await sql`select telnyx_key, telnyx_key_last4, telnyx_key_at, vapi_key, vapi_key_last4, vapi_public_key, vapi_key_at, platform_telnyx from orgs where id = ${orgId}`;
  const mode: PhoneAccount["mode"] = await accountMode(orgId, provider);
  return { mode, row: o, provider };
}

const NAME: Record<VoiceProviderId, string> = { telnyx: "Telnyx", vapi: "Vapi" };

/** Refuses when the agency has no phone account yet (its own or the platform's) for its engine, or for `engine`. */
export async function requirePhoneAccount(orgId: string, engine?: VoiceProviderId): Promise<void> {
  const { mode, provider } = await modeOf(orgId, engine);
  if (mode === "none") {
    throw new ValidationError(
      singleAgency()
        ? `Connect your phone provider first: open Connections and paste your ${NAME[provider]} API key. Then you can make receptionists.`
        : `Connect your ${NAME[provider]} account first. Open Setup to do it.`,
    );
  }
}

/** Local test servers: this agency's phone account is a pretend one, so nothing reaches Telnyx. */
export async function pretendAccount(orgId: string): Promise<boolean> {
  if (!fakeProvider()) return false;
  const { mode, row, provider } = await modeOf(orgId);
  return mode !== "own" || isTestKey(unseal(provider === "vapi" ? row.vapi_key : row.telnyx_key));
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

/**
 * Using numbers the agency already owns on its Telnyx account: only its owners and admins,
 * and only on its own account (or the one server key of a SINGLE_AGENCY install). On the
 * platform's key the account holds every agency's numbers, so this is off there.
 */
export const ownNumbersAllowed = (ctx: Pick<Ctx, "org" | "viewing" | "role">, mode: PhoneAccount["mode"], single: boolean): boolean =>
  Boolean(ctx.org) && !ctx.viewing && (ctx.role === "owner" || ctx.role === "admin") && (single ? mode !== "none" : mode === "own");

export async function canUseOwnNumbers(ctx: Ctx): Promise<boolean> {
  if (!ctx.org) return false;
  const { mode, provider } = await modeOf(ctx.org.id);
  // Numbers on the agency's own Telnyx account: a Vapi agency brings Twilio numbers instead.
  return provider === "telnyx" && ownNumbersAllowed(ctx, mode, singleAgency());
}

export async function phoneAccount(ctx: Ctx): Promise<PhoneAccount> {
  const orgId = ctx.org!.id;
  const { mode, row, provider } = await modeOf(orgId);
  let balance: Balance | null = null;
  let problem = "";
  if (mode === "own") {
    try {
      if (provider === "vapi") {
        const key = unseal(row.vapi_key);
        if (!isTestKey(key)) await checkVapiKey(key);
      } else {
        balance = (await checkKey(unseal(row.telnyx_key))).balance;
      }
    } catch (err) {
      problem = (err as Error).message;
    }
  }
  const [c] = await sql`
    select count(*)::int as clients,
      coalesce(sum(case when jsonb_typeof(data->'phoneNumbers') = 'array' then jsonb_array_length(data->'phoneNumbers') else 0 end), 0)::int as numbers
    from clients where org_id = ${orgId}`;
  const [k] = await sql`select count(*)::int as n from calendar_links l join clients c on c.id = l.client_id where c.org_id = ${orgId}`;
  const own = mode === "own";
  const engines = {
    telnyx: { mode: await accountMode(orgId, "telnyx"), last4: row?.telnyx_key ? (row.telnyx_key_last4 ?? "") : "", connectedAt: row?.telnyx_key ? iso(row.telnyx_key_at) : "" },
    vapi: { mode: await accountMode(orgId, "vapi"), last4: row?.vapi_key ? (row.vapi_key_last4 ?? "") : "", connectedAt: row?.vapi_key ? iso(row.vapi_key_at) : "", publicKey: row?.vapi_key ? (row.vapi_public_key ?? "") : platformVapi().publicKey },
  };
  return {
    provider,
    engines,
    installProvider: installProvider(),
    mode,
    last4: own ? ((provider === "vapi" ? row?.vapi_key_last4 : row?.telnyx_key_last4) ?? "") : "",
    connectedAt: own ? iso(provider === "vapi" ? row?.vapi_key_at : row?.telnyx_key_at) : "",
    ...(provider === "vapi" ? { vapiPublicKey: (own ? row?.vapi_public_key : platformVapi().publicKey) ?? "" } : {}),
    balance,
    problem,
    lowCredit: balance !== null && balance.amount < LOW_CREDIT,
    required: ownAccountRequired(),
    // An install with no key of its own: nothing was set at install, the agency connects its own here.
    installed: singleAgency() && !ownKeyInstall(),
    counts: { clients: c?.clients ?? 0, numbers: c?.numbers ?? 0, calendars: k?.n ?? 0 },
    ...(fakeProvider() ? { testKey: TEST_KEY } : {}),
  };
}

/** Asks Vapi whether the keys work. The private key is read with a cheap GET; the public one is only checked for shape. */
export async function checkVapiKeys(rawKey: unknown, rawPublic: unknown): Promise<{ key: string; publicKey: string }> {
  const key = String(rawKey ?? "").trim();
  const publicKey = String(rawPublic ?? "").trim();
  if (!key) throw new ValidationError("Paste your Vapi private API key first.");
  if (/\s/.test(key) || key.length < 20 || key.length > 300) {
    throw new ValidationError("That doesn't look like a whole Vapi API key. Copy it again from API Keys in the Vapi dashboard: it's one long line.");
  }
  if (!publicKey) throw new ValidationError("Paste your Vapi public key too. It's the other key on the same page, and it lets the browser test call work.");
  if (/\s/.test(publicKey) || publicKey.length < 20 || publicKey.length > 300) throw new ValidationError("That doesn't look like a whole Vapi public key. Copy it again from API Keys in the Vapi dashboard.");
  if (key === publicKey) throw new ValidationError("Those are the same key. The private key and the public key are two different ones on the Vapi API Keys page.");
  if (isTestKey(key)) return { key, publicKey };
  try {
    await checkVapiKey(key);
  } catch (err) {
    if (err instanceof VapiError && (err.status === 401 || err.status === 403)) {
      throw new ValidationError("Vapi didn't accept that private key. Copy it again from API Keys in the Vapi dashboard, or make a new one.");
    }
    throw err;
  }
  return { key, publicKey };
}

/**
 * Saves a phone key from Connections (an agency's owners and admins, at any time, including on a SINGLE_AGENCY
 * install where the server's own key, if any, is only the fallback). `makeDefault: false` adds a key as a
 * backup without changing which engine new receptionists run on.
 */
export async function connectPhoneAccount(ctx: Ctx, input: any): Promise<PhoneAccount> {
  requireRole(ctx, "admin");
  const makeDefault = input?.makeDefault !== false;
  const orgId = ctx.org!.id;
  countCheck(orgId);

  if (input?.provider === "vapi") {
    const { key, publicKey } = await checkVapiKeys(input?.key, input?.publicKey);
    // Receptionists live inside one Vapi account too: a key from another one would leave them unreachable.
    if (!isTestKey(key)) {
      const [existing] = await sql`
        select data->>'assistantId' as assistant from clients
        where org_id = ${orgId} and data->>'voiceProvider' = 'vapi' and data->>'assistantId' not like 'demo-%' limit 1`;
      if (existing?.assistant) {
        try {
          await vapi("GET", `/assistant/${existing.assistant}`, undefined, key);
        } catch (err) {
          if (err instanceof VapiError && err.status < 500) {
            throw new ValidationError("That key belongs to a different Vapi account from the one your receptionists are on. Use a key from the same account.");
          }
          throw err;
        }
      }
    }
    await sql`update orgs set vapi_key = ${seal(key)}, vapi_key_last4 = ${key.slice(-4)}, vapi_public_key = ${publicKey}, vapi_key_at = now() where id = ${orgId}`;
    if (makeDefault) await sql`update orgs set voice_provider = 'vapi' where id = ${orgId}`;
    forgetVapiKey(orgId);
    await audit(ctx, "phone_account.connect", { provider: "vapi", last4: key.slice(-4) });
    return phoneAccount(ctx);
  }

  const { key } = await checkNewKey(input?.key);

  // Receptionists live inside one Telnyx account. A key from a different account
  // would leave every existing one unreachable, so check one of them answers to it.
  if (!isTestKey(key)) {
    const [existing] = await sql`
      select data->>'assistantId' as assistant from clients
      where org_id = ${orgId} and coalesce(data->>'voiceProvider', 'telnyx') = 'telnyx' and data->>'assistantId' not like 'demo-%' limit 1`;
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

  // Connecting Telnyx also makes it this agency's engine for new receptionists.
  await sql`update orgs set telnyx_key = ${seal(key)}, telnyx_key_last4 = ${key.slice(-4)}, telnyx_key_at = now() where id = ${orgId}`;
  if (makeDefault) await sql`update orgs set voice_provider = ${installProvider() === "telnyx" ? null : "telnyx"} where id = ${orgId}`;
  forgetKey(orgId);
  await audit(ctx, "phone_account.connect", { last4: key.slice(-4) });
  return phoneAccount(ctx);
}

export async function disconnectPhoneAccount(ctx: Ctx, which?: unknown): Promise<PhoneAccount> {
  requireRole(ctx, "owner");
  const orgId = ctx.org!.id;
  const provider = which === "vapi" || which === "telnyx" ? which : asProvider((await modeOf(orgId)).provider);
  if (provider === "vapi") {
    // Receptionists made on Vapi are unreachable without its key, unless the server's own key stands in.
    if (!platformVapi().key) {
      const [n] = await sql`select count(*)::int as n from clients where org_id = ${orgId} and data->>'voiceProvider' = 'vapi'`;
      if (n?.n > 0) throw new ValidationError("Some receptionists run on Vapi. Move them to Telnyx first, then remove the Vapi keys.");
    }
    await sql`update orgs set vapi_key = null, vapi_key_last4 = null, vapi_public_key = null, vapi_key_at = null, voice_provider = case when voice_provider = 'vapi' then null else voice_provider end where id = ${orgId}`;
    forgetVapiKey(orgId);
  } else {
    await sql`update orgs set telnyx_key = null, telnyx_key_last4 = null, telnyx_key_at = null where id = ${orgId}`;
    forgetKey(orgId);
  }
  await audit(ctx, "phone_account.disconnect", { provider });
  return phoneAccount(ctx);
}

/**
 * The Test button: checks a key with its provider without saving it. With nothing typed in it checks what's
 * already in use for that engine (the agency's saved key, else the server's own).
 */
export async function testPhoneKeys(ctx: Ctx, input: any): Promise<{ ok: true; balance: Balance | null; source: "typed" | "saved" | "server" }> {
  requireRole(ctx, "admin");
  const orgId = ctx.org!.id;
  countCheck(orgId);
  const provider = asProvider(input?.provider);
  const typed = String(input?.key ?? "").trim();
  if (provider === "vapi") {
    if (typed) {
      await checkVapiKeys(input.key, input.publicKey);
      return { ok: true, balance: null, source: "typed" };
    }
    const creds = await vapiCredsFor(orgId).catch(() => null);
    if (!creds) throw new ValidationError("No Vapi keys are saved yet. Paste them first.");
    if (!isTestKey(creds.key)) await checkVapiKey(creds.key).catch((err) => {
      if (err instanceof VapiError && (err.status === 401 || err.status === 403)) throw new ValidationError("Vapi didn't accept the saved private key. Replace it.");
      throw err;
    });
    return { ok: true, balance: null, source: creds.own ? "saved" : "server" };
  }
  if (typed) return { ok: true, balance: (await checkNewKey(typed)).balance, source: "typed" };
  const [o] = await sql`select telnyx_key from orgs where id = ${orgId}`;
  const own = Boolean(o?.telnyx_key);
  const key = own ? unseal(o.telnyx_key) : (process.env.TELNYX_API_KEY ?? "").trim();
  if (!key) throw new ValidationError("No Telnyx key is saved yet. Paste it first.");
  return { ok: true, balance: (await checkNewKey(key)).balance, source: own ? "saved" : "server" };
}

// ---- Twilio (optional): another place numbers come from ----------------------------------
// Connected beside the voice engine, not instead of it. A Twilio number is answered by a Vapi
// receptionist and sends its texts (server/twilio.ts), so it's offered for Vapi receptionists.

/** Using the agency's Twilio account (search, buy, connect numbers): its owners and admins, once connected. */
export const twilioAllowed = (ctx: Pick<Ctx, "org" | "viewing" | "role">, connected: boolean): boolean =>
  connected && Boolean(ctx.org) && !ctx.viewing && (ctx.role === "owner" || ctx.role === "admin");

export async function canUseTwilio(ctx: Ctx): Promise<boolean> {
  if (!ctx.org) return false;
  return twilioAllowed(ctx, Boolean(await twilioCredsFor(ctx.org.id)));
}

export async function twilioAccount(ctx: Ctx): Promise<TwilioAccount> {
  const orgId = ctx.org!.id;
  const [row] = await sql`select twilio_account_sid, twilio_last4, twilio_name, twilio_at, twilio_creds from orgs where id = ${orgId}`;
  const creds = await twilioCredsFor(orgId);
  const mode: TwilioAccount["mode"] = !creds ? "none" : creds.own ? "own" : "platform";
  let problem = "";
  let name = row?.twilio_name ?? "";
  if (creds) {
    try {
      name = (await checkTwilio(creds)).name || name;
    } catch (err) {
      problem = (err as Error).message;
    }
  }
  return {
    connected: Boolean(creds),
    mode,
    accountSid: creds?.accountSid ?? "",
    authKind: creds?.kind ?? "token",
    last4: creds?.own ? (row?.twilio_last4 ?? "") : "",
    name,
    connectedAt: creds?.own ? iso(row?.twilio_at) : "",
    problem,
    // The install's own account (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN), until the agency saves its own.
    installed: creds && !creds.own ? true : undefined,
    ...(fakeProvider() ? { testSid: TEST_SID, testToken: TEST_TOKEN } : {}),
  };
}

/** Checks the credentials with Twilio without saving them. */
export async function testTwilio(ctx: Ctx, input: unknown): Promise<{ ok: true; name: string; source: "typed" | "saved" | "server" }> {
  requireRole(ctx, "admin");
  countCheck(ctx.org!.id);
  const b = (input ?? {}) as Record<string, unknown>;
  // Nothing typed in: check what's already in use (the agency's saved account, else the server's own).
  if (!String(b.accountSid ?? "").trim() && !String(b.authToken ?? "").trim() && !String(b.apiKeySid ?? "").trim()) {
    const saved = await twilioCredsFor(ctx.org!.id);
    if (!saved) throw new ValidationError("No Twilio account is saved yet. Paste its keys first.");
    return { ok: true, name: (await checkTwilio(saved)).name, source: saved.own ? "saved" : "server" };
  }
  const creds = { ...parseTwilioInput(input), own: true };
  return { ok: true, name: (await checkTwilio(creds)).name, source: "typed" };
}

export async function connectTwilio(ctx: Ctx, input: unknown): Promise<TwilioAccount> {
  requireRole(ctx, "admin");
  const orgId = ctx.org!.id;
  countCheck(orgId);
  const parsed = parseTwilioInput(input);
  const creds = { ...parsed, own: true };
  const { name } = await checkTwilio(creds);
  await saveTwilio(orgId, parsed, name);
  await audit(ctx, "twilio.connect", { last4: parsed.secret.slice(-4), kind: parsed.kind, test: isTestTwilio(creds) });
  return twilioAccount(ctx);
}

export async function disconnectTwilio(ctx: Ctx): Promise<TwilioAccount> {
  requireRole(ctx, "owner");
  await clearTwilio(ctx.org!.id);
  await audit(ctx, "twilio.disconnect", {});
  return twilioAccount(ctx);
}
