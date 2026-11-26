import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthError, hashToken, ownerResetLink, requireRole, sessionCookie, singleAgency, type Ctx } from "./accounts";
import { assistantConfigured } from "./assistant";
import { audit } from "./audit";
import { resolveBrand } from "./brand";
import { sql } from "./db";
import { mailConfig } from "./platformSettings";
import { UI_PRODUCT } from "./product";
import { ValidationError } from "./prompt";
import { json, readBody } from "./routes/http";
import { hasKey } from "./telnyx";
import { installProvider } from "./voice/config";
import { ACCESS_KEY, DURATIONS, SYNC_KEY, accessOpen, readAccess, readSync, supportSeller, syncAllowed, syncEnabled, type AccessSetting, type Duration, type SyncSetting } from "./supportAccess";
import { putSetting } from "./store";

// Two things a buyer's copy of the app can do with the setup provider that installed it. Both are
// disclosed to the owner in Settings, "Support", and both are the owner's choice.
//
// 1. The health heartbeat. ON by default, off with one switch. Every 15 minutes (and at start-up) the app
//    POSTs a small snapshot to SUPPORT_SYNC_URL with SUPPORT_SYNC_TOKEN: the app's version and address,
//    whether it is healthy, COUNTS only, the brand's name and logo address, and yes/no for the optional
//    extras. The shape is fixed in SHAPE below: nothing else can be sent. Never caller names or numbers,
//    transcripts, recordings, keys, or anything a caller or customer said.
// 2. Support access. OFF by default. When the owner turns it on, the provider can ask for a one-time
//    sign-in link (valid 60 seconds, single use) that opens the dashboard as a read-only "support" person.
//    Every link and every sign-in is written to the audit log and shown to the owner.
//
// Old installs without SUPPORT_SYNC_URL / SUPPORT_SYNC_TOKEN do neither, and Settings says so.
// SUPPORT_CALL_TOKEN is the secret the setup site presents when it calls in ("Sync now", "View as").

const HEARTBEAT_MS = 15 * 60_000;
const LINK_SECONDS = 60;
const SESSION_HOURS = 8;
export const SUPPORT_EMAIL = "support@support.invalid"; // never receives mail; the person can't sign in with a password

// ---------------------------------------------------------------------------------------------
// The whitelist
// ---------------------------------------------------------------------------------------------

type Field = "number" | "boolean" | "string" | "string?" | { [k: string]: Field };
/** Every field the heartbeat may carry. Anything not listed here is dropped (and fails the tests). */
export const SHAPE: { [k: string]: Field } = {
  v: "number",
  sentAt: "string",
  appVersion: "string",
  publicUrl: "string",
  health: { ok: "boolean", db: "boolean", phoneKey: "boolean", openIncidents: "number" },
  counts: { agencies: "number", clients: "number", receptionists: "number", numbers: "number", calls24h: "number", calls7d: "number", calls30d: "number", bookings7d: "number", errors24h: "number" },
  lastCallAt: "string?",
  brand: { name: "string", logoUrl: "string" },
  extras: { email: "boolean", domain: "boolean", openRouter: "boolean" },
  support: { sharing: "boolean", access: "boolean", accessUntil: "string?" },
};
/** Text fields that must have an exact format (so they can't carry anything else), and the one free-text field (the brand's name), which is checked for personal details. */
const ISO = (s: string) => /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(s);
const FORMAT: Record<string, (s: string) => boolean> = {
  appVersion: (s) => /^[A-Za-z0-9._+-]{1,40}$/.test(s),
  sentAt: ISO,
  lastCallAt: ISO,
  accessUntil: ISO,
  publicUrl: (s) => /^https?:\/\/[^\s"'<>\\]{1,300}$/.test(s),
  logoUrl: (s) => /^https?:\/\/[^\s"'<>\\]{1,400}$/.test(s),
};
const MAX_LEN: Record<string, number> = { name: 80 };

const looksPersonal = (s: string) => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(s) || /(?:\+|\b)\d[\d\s().-]{7,}\d/.test(s);
/** Is this text acceptable for this field? Empty is always fine. */
const textOk = (k: string, s: string) => !s || (FORMAT[k] ? FORMAT[k](s) : !looksPersonal(s));

/** Keeps only what SHAPE allows, with the right types. Null when the basics are missing. */
export function cleanSnapshot(raw: unknown): Record<string, any> | null {
  const walk = (shape: { [k: string]: Field }, v: any): any => {
    const out: Record<string, any> = {};
    for (const [k, f] of Object.entries(shape)) {
      const x = v && typeof v === "object" ? v[k] : undefined;
      if (typeof f === "object") out[k] = walk(f, x);
      else if (f === "number") out[k] = typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0;
      else if (f === "boolean") out[k] = x === true;
      else {
        const s = typeof x === "string" ? x.slice(0, MAX_LEN[k] ?? 400) : "";
        out[k] = !s || !textOk(k, s) ? (f === "string?" ? null : "") : s;
      }
    }
    return out;
  };
  if (!raw || typeof raw !== "object" || (raw as any).v !== 1) return null;
  return walk(SHAPE, raw);
}

/** For the tests: throws if a payload has a field the shape doesn't list, or a personal detail in a string. */
export function assertWhitelisted(payload: unknown): void {
  const walk = (shape: { [k: string]: Field }, v: any, path: string) => {
    if (!v || typeof v !== "object") throw new Error(`${path || "payload"} is not an object`);
    for (const k of Object.keys(v)) if (!(k in shape)) throw new Error(`${path}${k} is not on the whitelist`);
    for (const [k, f] of Object.entries(shape)) {
      const x = v[k];
      if (typeof f === "object") walk(f, x, `${path}${k}.`);
      else if (f === "string" || f === "string?") {
        if (x === null && f === "string?") continue;
        if (typeof x !== "string") throw new Error(`${path}${k} must be text`);
        if (!textOk(k, x)) throw new Error(`${path}${k} ${FORMAT[k] ? "isn't in the expected format" : "looks like a personal detail"}`);
      } else if (typeof x !== f) throw new Error(`${path}${k} must be a ${f}`);
    }
  };
  walk(SHAPE, payload, "");
}

/** What the owner is told in Settings, in the same words the tests and the docs use. */
export const SENT_LIST = [
  "The app's version and its address",
  "Whether it is healthy, and how many problems were logged",
  "Counts: agencies, clients, receptionists, phone numbers, calls in the last 24 hours, 7 days and 30 days, bookings in the last 7 days, and errors in the last 24 hours",
  "When the last call came in",
  "Your brand's name and logo address",
  "Yes or no for the optional extras: email, your own domain, AI help",
  "Whether sharing and Support access are on",
];
export const NEVER_SENT = "Never caller names or numbers, messages, transcripts, recordings, customer details, passwords or keys.";

// ---------------------------------------------------------------------------------------------
// Configuration and the shared token
// ---------------------------------------------------------------------------------------------

export function supportConfig() {
  const url = (process.env.SUPPORT_SYNC_URL ?? "").trim();
  const token = (process.env.SUPPORT_SYNC_TOKEN ?? "").trim();
  // The setup site's way back in ("Sync now", "View as"): a different secret, so the one this copy sends out
  // can't be used to ask it for anything.
  const callToken = (process.env.SUPPORT_CALL_TOKEN ?? "").trim();
  let ok = false;
  try {
    const u = new URL(url);
    ok = u.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  } catch {}
  return { url, token, callToken: callToken.length >= 20 && callToken !== token ? callToken : "", ok: ok && token.length >= 20 };
}
export const supportConfigured = () => supportConfig().ok;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** True when the request carries this app's SUPPORT_CALL_TOKEN (constant time). The sync token, which only goes out, is refused here. */
export function tokenOk(req: Request): boolean {
  const c = supportConfig();
  if (!c.ok || !c.callToken) return false;
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S{1,200})$/i);
  if (!m) return false;
  return timingSafeEqual(digest(m[1]), digest(c.callToken));
}

// ---------------------------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------------------------

function appVersion(): string {
  const env = (process.env.APP_VERSION ?? "").trim();
  if (env) return env;
  try {
    return String(JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")).version ?? "");
  } catch {
    return "";
  }
}

const publicBase = () => (process.env.PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
const ownDomain = (base: string) => {
  try {
    const h = new URL(base).hostname;
    return Boolean(h) && !/\.up\.railway\.app$/.test(h) && !/^(localhost|127\.)/.test(h);
  } catch {
    return false;
  }
};

export async function buildSnapshot(): Promise<Record<string, any>> {
  const base = publicBase();
  let dbOk = true;
  let c: any = {};
  const brandName = UI_PRODUCT;
  let logoUrl = "";
  let access: AccessSetting | null = null;
  try {
    [c] = await sql`
      select
        (select count(*)::int from orgs where not sandbox) as agencies,
        (select count(distinct coalesce(c.company_id, c.id))::int from clients c join orgs o on o.id = c.org_id where not o.sandbox) as clients,
        (select count(*)::int from clients c join orgs o on o.id = c.org_id where not o.sandbox) as receptionists,
        (select coalesce(sum(jsonb_array_length(c.data->'phoneNumbers')), 0)::int from clients c join orgs o on o.id = c.org_id
           where not o.sandbox and jsonb_typeof(c.data->'phoneNumbers') = 'array') as numbers,
        (select count(*)::int from call_log where channel = 'call' and provider_call_id not like 'demo-%' and started_at > now() - interval '24 hours') as calls24h,
        (select count(*)::int from call_log where channel = 'call' and provider_call_id not like 'demo-%' and started_at > now() - interval '7 days') as calls7d,
        (select count(*)::int from call_log where channel = 'call' and provider_call_id not like 'demo-%' and started_at > now() - interval '30 days') as calls30d,
        (select count(*)::int from booking_requests where data->>'kind' = 'booking' and created_at > now() - interval '7 days') as bookings7d,
        (select count(*)::int from incidents where created_at > now() - interval '24 hours') as errors24h,
        (select count(*)::int from incidents where status = 'open') as open_incidents,
        (select max(started_at) from call_log where channel = 'call' and provider_call_id not like 'demo-%') as last_call`;
    const [o] = await sql`select id from orgs where not sandbox order by created_at limit 1`;
    if (o) logoUrl = (await resolveBrand(o.id)).logo;
    access = await readAccess();
  } catch (err) {
    dbOk = false;
    console.error("[support sync] snapshot", (err as Error).message);
  }
  const sharing = syncAllowed(await readSync().catch(() => null));
  const raw = {
    v: 1,
    sentAt: new Date().toISOString(),
    appVersion: appVersion(),
    publicUrl: base,
    health: { ok: dbOk && (c.open_incidents ?? 0) === 0, db: dbOk, phoneKey: installProvider() === "vapi" ? Boolean(process.env.VAPI_API_KEY) : hasKey(), openIncidents: c.open_incidents ?? 0 },
    counts: {
      agencies: c.agencies, clients: c.clients, receptionists: c.receptionists, numbers: c.numbers,
      calls24h: c.calls24h, calls7d: c.calls7d, calls30d: c.calls30d, bookings7d: c.bookings7d, errors24h: c.errors24h,
    },
    lastCallAt: c.last_call ? new Date(c.last_call).toISOString() : null,
    brand: { name: brandName, logoUrl: logoUrl ? (logoUrl.startsWith("/") ? base + logoUrl : logoUrl) : "" },
    extras: { email: Boolean(mailConfig().smtpUrl), domain: ownDomain(base), openRouter: assistantConfigured() },
    support: { sharing, access: accessOpen(access), accessUntil: accessOpen(access) ? access?.until ?? null : null },
  };
  return cleanSnapshot(raw)!;
}

// ---------------------------------------------------------------------------------------------
// The heartbeat
// ---------------------------------------------------------------------------------------------

export const heartbeatStatus: { lastSentAt: string | null; lastOk: boolean | null; lastError: string } = { lastSentAt: null, lastOk: null, lastError: "" };

export type SendResult = { sent: boolean; reason?: "not-configured" | "off" | "failed" };

/** Sends one heartbeat, unless sharing is off (then nothing leaves the server at all). */
export async function sendHeartbeat(doFetch: typeof fetch = fetch): Promise<SendResult> {
  const c = supportConfig();
  if (!c.ok) return { sent: false, reason: "not-configured" };
  if (!(await syncEnabled())) return { sent: false, reason: "off" };
  const body = await buildSnapshot();
  // The owner may have switched it off while the snapshot was being built.
  if (!(await syncEnabled())) return { sent: false, reason: "off" };
  try {
    const res = await doFetch(c.url, {
      method: "POST",
      headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    heartbeatStatus.lastSentAt = new Date().toISOString();
    heartbeatStatus.lastOk = res.ok;
    heartbeatStatus.lastError = res.ok ? "" : `The setup site answered ${res.status}.`;
    return { sent: res.ok, ...(res.ok ? {} : { reason: "failed" as const }) };
  } catch (err) {
    heartbeatStatus.lastOk = false;
    heartbeatStatus.lastError = "Couldn't reach the setup site.";
    console.error("[support sync] heartbeat failed:", (err as Error).name);
    return { sent: false, reason: "failed" };
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startSupportSync(): void {
  if (!supportConfigured()) {
    console.log("[support sync] not set up on this copy (no SUPPORT_SYNC_URL / SUPPORT_SYNC_TOKEN): nothing is shared");
    return;
  }
  console.log(`[support sync] on unless switched off in Settings: sharing counts and health with ${supportSeller()} every 15 minutes`);
  const tick = () => void sendHeartbeat().catch((err) => console.error("[support sync]", (err as Error).message));
  setTimeout(tick, 10_000).unref?.();
  timer ??= setInterval(tick, HEARTBEAT_MS);
  timer.unref?.();
}

// ---------------------------------------------------------------------------------------------
// Support access: one-time sign-in links
// ---------------------------------------------------------------------------------------------

export class SupportRefused extends Error {
  constructor(
    message: string,
    public code: "access_off" | "not_supported",
    public status = 403,
  ) {
    super(message);
  }
}

async function agencyOrg(): Promise<{ id: string; name: string } | null> {
  const [o] = await sql`select id, name from orgs where not sandbox order by created_at limit 1`;
  return o ?? null;
}

/** A link for the setup provider's support person to open: valid 60 seconds, once. Refused unless the owner turned Support access on. */
export async function issueLoginLink(base: string): Promise<{ url: string; expiresInSeconds: number }> {
  if (!singleAgency()) throw new SupportRefused("Support sign-in is only for a single-agency copy.", "not_supported", 404);
  const org = await agencyOrg();
  if (!org) throw new SupportRefused("There's no agency to sign in to yet.", "not_supported", 404);
  if (!accessOpen(await readAccess())) {
    await audit(null, "support.link_refused", { summary: `${supportSeller()} asked to sign in, but Support access is off` }, { orgId: org.id });
    throw new SupportRefused("The owner hasn't turned on Support access.", "access_off");
  }
  const token = randomBytes(32).toString("base64url");
  await sql`delete from support_login_links where expires_at < now() - interval '1 day'`;
  await sql`insert into support_login_links (token_hash, expires_at) values (${hashToken(token)}, ${new Date(Date.now() + LINK_SECONDS * 1000)})`;
  await audit(null, "support.link_issued", { summary: `${supportSeller()} asked for a sign-in link (valid ${LINK_SECONDS} seconds)` }, { orgId: org.id });
  return { url: `${base}/api/support/in/${token}`, expiresInSeconds: LINK_SECONDS };
}

async function supportUser(): Promise<string> {
  const name = `${supportSeller()} support`.slice(0, 80);
  const [u] = await sql`select id from users where email = ${SUPPORT_EMAIL}`;
  if (u) {
    await sql`update users set name = ${name}, support = true where id = ${u.id}`;
    return u.id;
  }
  const id = crypto.randomUUID();
  // A password nobody knows, so the usual sign-in can never open this account.
  const hash = await Bun.password.hash(randomBytes(32).toString("base64url"), { algorithm: "argon2id" });
  await sql`insert into users (id, email, name, password_hash, support) values (${id}, ${SUPPORT_EMAIL}, ${name}, ${hash}, true) on conflict (email) do nothing`;
  const [again] = await sql`select id from users where email = ${SUPPORT_EMAIL}`;
  return again.id;
}

/** Spends a link (once, within 60 seconds, only while access is on) and opens a support session. Returns the session token or null. */
export async function redeemLoginLink(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [used] = await sql`
    update support_login_links set used_at = now()
    where token_hash = ${hashToken(token)} and used_at is null and expires_at > now() returning token_hash`;
  if (!used) return null;
  const org = await agencyOrg();
  const access = await readAccess();
  if (!org || !accessOpen(access)) return null;
  const userId = await supportUser();
  const sessionToken = randomBytes(32).toString("base64url");
  const ends = Math.min(Date.now() + SESSION_HOURS * 3600_000, access?.until ? Date.parse(access.until) : Infinity);
  await sql`delete from sessions where user_id = ${userId} and expires_at < now()`;
  await sql`insert into sessions (token_hash, user_id, org_id, expires_at, support) values (${hashToken(sessionToken)}, ${userId}, ${org.id}, ${new Date(ends)}, true)`;
  await audit({ user: { id: userId }, org: { id: org.id } }, "support.signin", { summary: `${supportSeller()} signed in to help (read-only support access)` });
  return sessionToken;
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

let failures: number[] = [];
const tooManyFailures = () => {
  const cut = Date.now() - 10 * 60_000;
  failures = failures.filter((t) => t > cut);
  return failures.length >= 20;
};
const noStore = { "cache-control": "no-store" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...noStore, "content-type": "application/json" } });

let resets: number[] = [];
const OWNER_RESET_LIMIT = 5; // per 10 minutes
/**
 * The owner's own "locked out" way back in, for copies with no email set up. The buyer opens their private
 * setup link, the setup site calls this with the call token, and gets a 15-minute, single-use reset link for
 * the agency OWNER (never anyone else). It does NOT depend on Support access: it is the owner resetting
 * their own account. Audited, and rate-limited.
 */
async function ownerResetRoute(req: Request): Promise<Response> {
  if (!singleAgency()) return reply({ ok: false, error: "not_supported", message: "Owner reset is only for a single-agency copy." }, 404);
  const cut = Date.now() - 10 * 60_000;
  resets = resets.filter((t) => t > cut);
  if (resets.length >= OWNER_RESET_LIMIT) return reply({ ok: false, error: "rate_limited", message: "Too many reset requests. Wait a few minutes and try again." }, 429);
  resets.push(Date.now());
  const base = publicBase() || new URL(req.url).origin;
  const r = await ownerResetLink(base);
  if (!r) return reply({ ok: false, error: "not_supported", message: "There's no agency owner to reset yet." }, 404);
  await audit(null, "support.owner_reset", { summary: "Owner password reset via setup link" }, { orgId: r.orgId });
  return reply({ ok: true, url: r.url, expiresInMinutes: r.expiresInMinutes });
}

/**
 * No session: the setup site calls these with the shared token, or a browser opens a one-time link.
 *   POST /api/support/ping         "Sync now": the snapshot, straight back (or {sharing:false})
 *   POST /api/support/login-link   a one-time link, only while Support access is on
 *   POST /api/support/owner-reset-link   a 15-minute, one-time password-reset link for the owner (no Support access needed)
 *   GET  /api/support/in/<token>   spends the link, signs in as support, goes to the dashboard
 */
export async function supportPublicRoutes(req: Request, path: string, method: string): Promise<Response | null> {
  const redeem = path.match(/^\/api\/support\/in\/([A-Za-z0-9_-]{20,64})$/);
  if (redeem && method === "GET") {
    if (tooManyFailures()) return new Response("Too many tries. Wait a few minutes.", { status: 429, headers: noStore });
    const session = await redeemLoginLink(redeem[1]);
    if (!session) {
      failures.push(Date.now());
      return new Response("This sign-in link has expired or was already used. Ask for a new one.", { status: 410, headers: { ...noStore, "content-type": "text/plain; charset=utf-8" } });
    }
    return new Response(null, { status: 302, headers: { ...noStore, location: "/admin", "set-cookie": sessionCookie(req, session) } });
  }
  if (path !== "/api/support/ping" && path !== "/api/support/login-link" && path !== "/api/support/owner-reset-link") return null;
  if (method !== "POST") return reply({ error: "Not found" }, 404);
  if (tooManyFailures()) return reply({ error: "Too many tries." }, 429);
  if (!tokenOk(req)) {
    failures.push(Date.now());
    return reply({ error: "Not allowed." }, 401);
  }
  if (path === "/api/support/owner-reset-link") return ownerResetRoute(req);
  if (path === "/api/support/ping") {
    if (!(await syncEnabled())) return reply({ ok: true, sharing: false });
    return reply({ ok: true, sharing: true, snapshot: await buildSnapshot() });
  }
  try {
    const base = publicBase() || new URL(req.url).origin;
    return reply({ ok: true, ...(await issueLoginLink(base)) });
  } catch (err) {
    if (err instanceof SupportRefused) return reply({ ok: false, error: err.code, message: err.message }, err.status);
    throw err;
  }
}

/** What the owner sees in Settings, "Support". */
export async function supportSettings(ctx: Ctx) {
  const configured = supportConfigured();
  const sync = await readSync();
  const access = await readAccess();
  const recent = ctx.org
    ? await sql`
        select action, detail, created_at from audit_log
        where org_id = ${ctx.org.id} and action like 'support.%' order by created_at desc limit 20`
    : [];
  return {
    configured,
    seller: supportSeller(),
    sync: { enabled: syncAllowed(sync), ...heartbeatStatus },
    access: { enabled: accessOpen(access), until: accessOpen(access) ? access?.until ?? null : null, grantedAt: access?.grantedAt ?? null },
    sends: SENT_LIST,
    neverSent: NEVER_SENT,
    recent: recent.map((r: any) => ({ action: r.action, summary: String(r.detail?.summary ?? ""), at: new Date(r.created_at).toISOString() })),
  };
}

/** The owner's switches. Only the agency's owner, never while viewing as someone, and never the support person. */
export async function supportSettingsRoute(req: Request, method: string, ctx: Ctx): Promise<Response> {
  if (method === "GET") return json(await supportSettings(ctx));
  if (method !== "PUT") return json({ error: "Not found" }, 404);
  if (ctx.viewing) throw new AuthError("You're viewing as someone else. These settings are the owner's to change.", 403);
  requireRole(ctx, "owner");
  if (!supportConfigured()) throw new ValidationError("This copy isn't connected to a setup provider, so there is nothing to share.");
  const input = await readBody(req);
  const who = ctx.user.email;
  const now = new Date().toISOString();
  if (typeof input?.sync === "boolean") {
    const was = syncAllowed(await readSync());
    await putSetting(SYNC_KEY, { enabled: input.sync, changedAt: now, by: who } satisfies SyncSetting);
    if (was !== input.sync) {
      await audit(ctx, input.sync ? "support.sharing_on" : "support.sharing_off", { summary: input.sync ? `Turned on sharing health and usage stats with ${supportSeller()}` : `Turned off sharing health and usage stats with ${supportSeller()}` });
    }
    if (input.sync) void sendHeartbeat().catch(() => {});
  }
  if (input?.access && typeof input.access.enabled === "boolean") {
    if (input.access.enabled) {
      const d = String(input.access.for ?? "7d") as Duration;
      if (!(d in DURATIONS)) throw new ValidationError("Choose 24 hours, 7 days, or until you turn it off.");
      const until = DURATIONS[d] ? new Date(Date.now() + DURATIONS[d]).toISOString() : null;
      await putSetting(ACCESS_KEY, { enabled: true, until, grantedAt: now, by: who } satisfies AccessSetting);
      await audit(ctx, "support.access_granted", { until, summary: `Turned on Support access for ${supportSeller()} (${d === "forever" ? "until turned off" : d === "24h" ? "24 hours" : "7 days"})` });
    } else {
      const was = accessOpen(await readAccess());
      await putSetting(ACCESS_KEY, { enabled: false, until: null, grantedAt: now, by: who } satisfies AccessSetting);
      // Anyone signed in as support is signed out now.
      await sql`delete from sessions where support`;
      if (was) await audit(ctx, "support.access_revoked", { summary: `Turned off Support access for ${supportSeller()}` });
    }
    // Let the setup site see the new state without waiting for the next heartbeat.
    void sendHeartbeat().catch(() => {});
  }
  return json(await supportSettings(ctx));
}
