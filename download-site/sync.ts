// The heartbeat and "View as": what our site keeps about a buyer's running app, and how it asks the app for
// a one-time sign-in link. Both are disclosed to the buyer (in their app's Settings, "Support", the Done
// screen and the guide) and both are the buyer's choice:
//   - the app POSTs a small snapshot of counts and health to /api/sync every 15 minutes, unless the buyer
//     switched sharing off. The shape is fixed below; whatever else arrives is dropped. (The app has the same
//     list, in server/supportSync.ts; keep them in step.)
//   - "View as" works only while Support access is on in the buyer's app (on by default for a fresh install; theirs to switch off). We ask the app (with the
//     buyer's own sync token) for a link that works once, for 60 seconds, and open it. The app refuses when
//     access is off, and records every link and sign-in in the buyer's audit log.
// Tokens are stored as hashes; the buyer's app holds the only copy.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ANY_MOCK, CONFIG, db, now, sha256 } from "./lib";
import { siteKey } from "./store";

// ---------------- the whitelist ----------------
type Shape = { [k: string]: Field };
type Field = "number" | "boolean" | "string" | "string?" | Shape | { $array: Shape; max: number };
const isArray = (f: Field): f is { $array: Shape; max: number } => typeof f === "object" && "$array" in f && typeof (f as any).max === "number";
export const SHAPE: Shape = {
  v: "number",
  sentAt: "string",
  appVersion: "string",
  publicUrl: "string",
  health: { ok: "boolean", db: "boolean", phoneKey: "boolean", openIncidents: "number" },
  counts: { agencies: "number", clients: "number", receptionists: "number", numbers: "number", calls24h: "number", calls7d: "number", calls30d: "number", bookings7d: "number", errors24h: "number" },
  lastCallAt: "string?",
  brand: { name: "string", logoUrl: "string" },
  extras: { email: "boolean", domain: "boolean", openRouter: "boolean" },
  support: { sharing: "boolean", access: "boolean", accessUntil: "string?", edit: "boolean" },
  updates: { available: "boolean", enabled: "boolean", mode: "string", latest: "string", lastResult: "string", lastError: "string", lastAt: "string?" },
  problems: { $array: { kind: "string", msg: "string", count: "number", last: "string" }, max: 50 },
};
const ISO = (s: string) => /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(s);
const FORMAT: Record<string, (s: string) => boolean> = {
  appVersion: (s) => /^[A-Za-z0-9._+-]{1,40}$/.test(s),
  sentAt: ISO,
  lastCallAt: ISO,
  accessUntil: ISO,
  lastAt: ISO,
  last: ISO,
  kind: (s) => /^[a-z0-9_.:-]{1,40}$/.test(s),
  mode: (s) => s === "overnight" || s === "asap",
  latest: (s) => /^[A-Za-z0-9._+-]{1,40}$/.test(s),
  lastResult: (s) => s === "ok" || s === "failed",
  publicUrl: (s) => /^https?:\/\/[^\s"'<>\\]{1,300}$/.test(s),
  logoUrl: (s) => /^https?:\/\/[^\s"'<>\\]{1,400}$/.test(s),
};
const MAX_LEN: Record<string, number> = { name: 80, msg: 200, lastError: 200 };
const looksPersonal = (s: string) => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(s) || /(?:\+|\b)\d[\d\s().-]{7,}\d/.test(s);
const textOk = (k: string, s: string) => !s || (FORMAT[k] ? FORMAT[k](s) : !looksPersonal(s));

export type Snapshot = {
  v: number; sentAt: string; appVersion: string; publicUrl: string;
  health: { ok: boolean; db: boolean; phoneKey: boolean; openIncidents: number };
  counts: { agencies: number; clients: number; receptionists: number; numbers: number; calls24h: number; calls7d: number; calls30d: number; bookings7d: number; errors24h: number };
  lastCallAt: string | null;
  brand: { name: string; logoUrl: string };
  extras: { email: boolean; domain: boolean; openRouter: boolean };
  support: { sharing: boolean; access: boolean; accessUntil: string | null; edit: boolean };
  updates: { available: boolean; enabled: boolean; mode: string; latest: string; lastResult: string; lastError: string; lastAt: string | null };
  problems: Problem[];
};
export type Problem = { kind: string; msg: string; count: number; last: string };

/** Keeps only what SHAPE allows. We never trust the app's payload: unknown fields are dropped, text is clipped. */
export function cleanSnapshot(raw: unknown): Snapshot | null {
  const walk = (shape: Shape, v: any): any => {
    const out: Record<string, any> = {};
    for (const [k, f] of Object.entries(shape)) {
      const x = v && typeof v === "object" ? v[k] : undefined;
      if (isArray(f)) out[k] = (Array.isArray(x) ? x.slice(0, f.max) : []).map((item) => walk(f.$array, item));
      else if (typeof f === "object") out[k] = walk(f, x);
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
  return walk(SHAPE, raw) as Snapshot;
}

// ---------------- tokens ----------------
export const SYNC_URL = () => `${CONFIG.siteUrl}/api/sync`;
export const TOKEN_RE = /^st_[A-Za-z0-9_-]{43}$/;

/** Makes (or replaces) a buyer's sync token. Only its hash is kept; the one copy goes to their app's settings. */
export function newSyncToken(buyerId: number): { token: string; callToken: string } {
  const token = `st_${randomBytes(32).toString("base64url")}`;
  db().query("INSERT INTO sync_tokens (buyer_id, token_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (buyer_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at").run(buyerId, sha256(token), now());
  return { token, callToken: callToken(buyerId)! };
}
/**
 * The second secret, for our calls INTO their app ("Sync now", "View as"). We keep only a hash of the sync token, so
 * we can't use it to call the app; instead this one is worked out from our site key and the token's creation time,
 * and set on their app next to the sync token (SUPPORT_CALL_TOKEN). Nothing extra is stored. Null if there's no token.
 */
export function callToken(buyerId: number): string | null {
  const r = db().query("SELECT created_at FROM sync_tokens WHERE buyer_id = ?").get(buyerId) as { created_at: string } | null;
  return r ? `sc_${createHmac("sha256", siteKey()).update(`support-call:${buyerId}:${r.created_at}`).digest("base64url")}` : null;
}
export const hasSyncToken = (buyerId: number) => !!db().query("SELECT 1 FROM sync_tokens WHERE buyer_id = ?").get(buyerId);
export function buyerBySyncToken(token: string): number | null {
  if (!TOKEN_RE.test(token)) return null;
  const h = sha256(token);
  const r = db().query("SELECT buyer_id, token_hash FROM sync_tokens WHERE token_hash = ?").get(h) as { buyer_id: number; token_hash: Buffer } | null;
  return r && timingSafeEqual(Buffer.from(r.token_hash), h) ? r.buyer_id : null;
}
export const bearerOf = (req: Request) => (req.headers.get("authorization") || "").match(/^Bearer\s+(\S{1,200})$/i)?.[1] || "";
export const deleteSyncData = (buyerId: number) => {
  db().query("DELETE FROM sync_tokens WHERE buyer_id = ?").run(buyerId);
  db().query("DELETE FROM sync_snapshots WHERE buyer_id = ?").run(buyerId);
  db().query("DELETE FROM sync_history WHERE buyer_id = ?").run(buyerId);
  db().query("DELETE FROM sync_push WHERE buyer_id = ?").run(buyerId);
  db().query("DELETE FROM sync_off WHERE buyer_id = ?").run(buyerId);
};

// ---------------- "Push update now" ----------------
const PUSH_MINUTES = 60;
/** Asks for the next heartbeat's answer to carry updateNow. Refused when the app can't or won't update itself. */
export function requestPush(buyerId: number, by: string): { ok: true } | { ok: false; reason: "unavailable" | "off" | "current" | "unknown" } {
  const st = latestSnapshot(buyerId);
  if (!st) return { ok: false, reason: "unknown" };
  if (!st.snap.updates.available) return { ok: false, reason: "unavailable" };
  if (!st.snap.updates.enabled) return { ok: false, reason: "off" };
  db().query("INSERT INTO sync_push (buyer_id, requested_at, requested_by) VALUES (?, ?, ?) ON CONFLICT (buyer_id) DO UPDATE SET requested_at = excluded.requested_at, requested_by = excluded.requested_by").run(buyerId, now(), by.slice(0, 200));
  return { ok: true };
}
export const pushPending = (buyerId: number, at = Date.now()): boolean => {
  const r = db().query("SELECT requested_at FROM sync_push WHERE buyer_id = ?").get(buyerId) as { requested_at: string } | null;
  return !!r && at - Date.parse(r.requested_at) < PUSH_MINUTES * 60_000;
};
/** True once, then the request is gone (and an expired one is dropped without being sent). */
export function takePush(buyerId: number, at = Date.now()): boolean {
  const live = pushPending(buyerId, at);
  db().query("DELETE FROM sync_push WHERE buyer_id = ?").run(buyerId);
  return live;
}

// ---------------- what happens after a heartbeat is stored (alerts.ts registers here) ----------------
export type HeartbeatHook = (buyerId: number, prev: Snapshot | null, next: Snapshot) => void;
export const heartbeatHooks: HeartbeatHook[] = [];

// ---------------- storing ----------------
const KEEP_HISTORY = 48;
export function storeSnapshot(buyerId: number, snap: Snapshot, source: "heartbeat" | "sync-now" = "heartbeat") {
  const t = now();
  const data = JSON.stringify(snap);
  db().query("INSERT INTO sync_snapshots (buyer_id, data, received_at, source) VALUES (?, ?, ?, ?) ON CONFLICT (buyer_id) DO UPDATE SET data = excluded.data, received_at = excluded.received_at, source = excluded.source").run(buyerId, data, t, source);
  const small = JSON.stringify({ ok: snap.health.ok, calls24h: snap.counts.calls24h, calls7d: snap.counts.calls7d, receptionists: snap.counts.receptionists, errors24h: snap.counts.errors24h, v: snap.appVersion });
  db().query("INSERT INTO sync_history (buyer_id, at, data) VALUES (?, ?, ?)").run(buyerId, t, small);
  db().query("DELETE FROM sync_history WHERE buyer_id = ? AND id NOT IN (SELECT id FROM sync_history WHERE buyer_id = ? ORDER BY id DESC LIMIT ?)").run(buyerId, buyerId, KEEP_HISTORY);
}
export interface Stored { snap: Snapshot; receivedAt: string; source: string }
export function latestSnapshot(buyerId: number): Stored | null {
  const r = db().query("SELECT data, received_at, source FROM sync_snapshots WHERE buyer_id = ?").get(buyerId) as { data: string; received_at: string; source: string } | null;
  const snap = r ? cleanSnapshot(JSON.parse(r.data)) : null;
  return r && snap ? { snap, receivedAt: r.received_at, source: r.source } : null;
}
export function allSnapshots(): Map<number, Stored> {
  const out = new Map<number, Stored>();
  for (const r of db().query("SELECT buyer_id, data, received_at, source FROM sync_snapshots").all() as { buyer_id: number; data: string; received_at: string; source: string }[]) {
    const snap = cleanSnapshot(JSON.parse(r.data));
    if (snap) out.set(r.buyer_id, { snap, receivedAt: r.received_at, source: r.source });
  }
  return out;
}
export interface Beat { at: string; ok: boolean; calls24h: number; calls7d: number; receptionists: number; errors24h: number; v: string }
export const history = (buyerId: number, n = 12): Beat[] =>
  (db().query("SELECT at, data FROM sync_history WHERE buyer_id = ? ORDER BY id DESC LIMIT ?").all(buyerId, n) as { at: string; data: string }[]).map((r) => ({ at: r.at, ...JSON.parse(r.data) }));

// ---------------- the app calling in ----------------
export const MAX_SYNC_BODY = 64 * 1024;
export type Received = { status: number; body: Record<string, unknown>; buyerId?: number };

/** POST /api/sync: token auth, a size cap, the whitelist. Rate limits are applied by the caller (server.ts). */
export function receive(token: string, bodyText: string): Received {
  const id = buyerBySyncToken(token);
  if (id == null) return { status: 401, body: { error: "unauthorised" } };
  if (bodyText.length > MAX_SYNC_BODY) return { status: 413, body: { error: "too large" }, buyerId: id };
  let raw: unknown;
  try { raw = JSON.parse(bodyText); } catch { return { status: 400, body: { error: "bad json" }, buyerId: id }; }
  const snap = cleanSnapshot(raw);
  if (!snap) return { status: 400, body: { error: "bad snapshot" }, buyerId: id };
  const prev = latestSnapshot(id)?.snap ?? null;
  storeSnapshot(id, snap, "heartbeat");
  db().query("DELETE FROM sync_off WHERE buyer_id = ?").run(id);
  for (const h of heartbeatHooks) { try { h(id, prev, snap); } catch (e) { console.error(`[sync] hook failed: ${(e as Error)?.name}`); } }
  // The app may be asked to update now. It still only does so if its owner has automatic updates on.
  return { status: 200, body: takePush(id) ? { ok: true, updateNow: true } : { ok: true }, buyerId: id };
}

// ---------------- how a buyer looks ----------------
export type Seen = "live" | "quiet" | "offline" | "never";
export const LIVE_MIN = 35; // a heartbeat is every 15 minutes
export function seen(st: Stored | null, at = Date.now()): Seen {
  if (!st) return "never";
  const mins = (at - Date.parse(st.receivedAt)) / 60_000;
  return mins <= LIVE_MIN ? "live" : mins <= 24 * 60 ? "quiet" : "offline";
}
export type Dot = "green" | "amber" | "red" | "grey";
/** green: live and healthy. amber: live with problems logged, or a quiet gap. red: not healthy, or silent for over a day. grey: never heard. */
export function dot(st: Stored | null, at = Date.now()): Dot {
  const s = seen(st, at);
  if (!st || s === "never") return "grey";
  if (s === "offline" || !st.snap.health.db) return "red";
  if (s === "quiet" || !st.snap.health.ok || st.snap.counts.errors24h > 0) return "amber";
  return "green";
}
export function ago(iso: string, at = Date.now()): string {
  const m = Math.max(0, Math.round((at - Date.parse(iso)) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

// ---------------- calling the buyer's app ----------------
/** Where we may call: the app's own https address (any address in a test site). Never a bare IP or a local name. */
export function appBase(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (ANY_MOCK) return /^https?:$/.test(u.protocol) ? u.origin : null;
  if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
  if (/^\[|^\d+(\.\d+){3}$/.test(u.hostname) || !u.hostname.includes(".") || /(^|\.)(localhost|local|internal|localdomain)$/.test(u.hostname)) return null;
  return u.origin;
}

async function callApp(base: string, path: string, token: string, doFetch: typeof fetch): Promise<{ status: number; json: any } | null> {
  try {
    const res = await doFetch(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}", redirect: "error", signal: AbortSignal.timeout(15_000) });
    const text = (await res.text()).slice(0, 32 * 1024);
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json };
  } catch { return null; }
}

export type Outcome<T = {}> = ({ ok: true } & T) | { ok: false; reason: "no-app" | "unreachable" | "off" | "refused" | "error"; message: string };

/** "Sync now": ask the app for its snapshot right away. The app answers with it (or says sharing is off). */
export async function syncNow(buyerId: number, appUrl: string, doFetch: typeof fetch = fetch): Promise<Outcome<{ snapshot: Stored }>> {
  const base = appBase(appUrl);
  const tok = callToken(buyerId);
  if (!base || !tok) return { ok: false, reason: "no-app", message: "We don't have this app's address, or it was installed before syncing existed." };
  const r = await callApp(base, "/api/support/ping", tok, doFetch);
  if (!r) return { ok: false, reason: "unreachable", message: "The app didn't answer. It may be down, restarting or asleep." };
  if (r.status === 401) return { ok: false, reason: "refused", message: "The app didn't accept our token. It was installed before syncing existed, or its settings changed." };
  if (r.status !== 200 || !r.json?.ok) return { ok: false, reason: "error", message: `The app answered ${r.status}.` };
  if (r.json.sharing === false) return { ok: false, reason: "off", message: "The buyer has turned off sharing, so the app sends us nothing." };
  const snap = cleanSnapshot(r.json.snapshot);
  if (!snap) return { ok: false, reason: "error", message: "The app's answer wasn't in the expected shape." };
  storeSnapshot(buyerId, snap, "sync-now");
  return { ok: true, snapshot: latestSnapshot(buyerId)! };
}

/** "View as": a one-time sign-in link (the app makes it valid for 60 seconds, once). The app refuses while Support access is off. */
export async function viewAsLink(buyerId: number, appUrl: string, doFetch: typeof fetch = fetch): Promise<Outcome<{ url: string }>> {
  const base = appBase(appUrl);
  const tok = callToken(buyerId);
  if (!base || !tok) return { ok: false, reason: "no-app", message: "We don't have this app's address, or it was installed before syncing existed." };
  const r = await callApp(base, "/api/support/login-link", tok, doFetch);
  if (!r) return { ok: false, reason: "unreachable", message: "The app didn't answer. It may be down, restarting or asleep." };
  if (r.status === 403 && r.json?.error === "access_off") return { ok: false, reason: "off", message: "The buyer has switched Support access off." };
  if (r.status === 401) return { ok: false, reason: "refused", message: "The app didn't accept our token. It was installed before syncing existed, or its settings changed." };
  const link = typeof r.json?.url === "string" ? r.json.url : "";
  // The link must be on the app's own address: never follow one that points elsewhere.
  if (r.status !== 200 || !link.startsWith(`${base}/api/support/in/`) || /[\s"'<>]/.test(link)) {
    if (r.status === 200 && link) return { ok: false, reason: "error", message: "The app gave a link to a different address, so we didn't open it." };
    return { ok: false, reason: "error", message: `The app answered ${r.status}.` };
  }
  return { ok: true, url: link };
}

export type LogLine = { at: string; level: string; line: string };
/** "Fetch recent logs": the app's last 200 log lines (scrubbed by the app), only while Support access is on. Never stored. */
export async function fetchLogs(buyerId: number, appUrl: string, doFetch: typeof fetch = fetch): Promise<Outcome<{ lines: LogLine[] }>> {
  const base = appBase(appUrl);
  const tok = callToken(buyerId);
  if (!base || !tok) return { ok: false, reason: "no-app", message: "We don't have this app's address, or it was installed before syncing existed." };
  const r = await callApp(base, "/api/support/logs", tok, doFetch);
  if (!r) return { ok: false, reason: "unreachable", message: "The app didn't answer. It may be down, restarting or asleep." };
  if (r.status === 403 && r.json?.error === "access_off") return { ok: false, reason: "off", message: "The buyer has switched Support access off." };
  if (r.status === 401 || r.status === 404) return { ok: false, reason: "refused", message: "This version of the app can't send logs yet. The buyer needs to update." };
  if (r.status !== 200 || !r.json?.ok || !Array.isArray(r.json.lines)) return { ok: false, reason: "error", message: `The app answered ${r.status}.` };
  const lines: LogLine[] = r.json.lines.slice(-200).filter((l: any) => l && typeof l.line === "string").map((l: any) => ({ at: String(l.at || "").slice(0, 30), level: String(l.level || "log").slice(0, 8), line: String(l.line).slice(0, 300) }));
  return { ok: true, lines };
}

/** Is a silent app down, or did its owner just turn sharing off? Asks it directly (with the call token). */
export async function probeApp(buyerId: number, appUrl: string, doFetch: typeof fetch = fetch): Promise<"sharing-off" | "alive" | "unreachable" | "refused" | "no-app"> {
  const base = appBase(appUrl);
  const tok = callToken(buyerId);
  if (!base || !tok) return "no-app";
  const r = await callApp(base, "/api/support/ping", tok, doFetch);
  if (!r) return "unreachable";
  if (r.status === 401) return "refused";
  if (r.status === 200 && r.json?.sharing === false) return "sharing-off";
  return r.status === 200 ? "alive" : "unreachable";
}

export type OwnerReset = { ok: true; url: string; minutes: number } | { ok: false; reason: "outdated" | "unreachable" | "limited" | "error"; message: string };

/**
 * "Locked out? Reset your owner password" on the buyer's own setup link. We ask their app for a one-time
 * password-reset link for its owner (15 minutes, single use, never emailed) with the call token. It doesn't need
 * Support access: it's the owner resetting their own account. Apps from before this existed answer 404 (or have no
 * call token at all): the buyer is told to update first.
 */
export async function ownerResetLink(buyerId: number, appUrl: string, doFetch: typeof fetch = fetch): Promise<OwnerReset> {
  const outdated: OwnerReset = { ok: false, reason: "outdated", message: "Update your agency first, then try again." };
  const base = appBase(appUrl);
  const tok = callToken(buyerId);
  if (!tok) return outdated;
  if (!base) return { ok: false, reason: "error", message: "We don't have your agency's address yet." };
  const r = await callApp(base, "/api/support/owner-reset-link", tok, doFetch);
  if (!r) return { ok: false, reason: "unreachable", message: "Your agency didn't answer. It may be restarting. Wait a minute and try again." };
  if (r.status === 429) return { ok: false, reason: "limited", message: "Too many reset requests. Wait a few minutes and try again." };
  // A 404 that isn't the app's own "not_supported" answer, or a refused token: an older version (or settings that changed since). Update fixes both.
  if (r.status === 401 || (r.status === 404 && r.json?.error !== "not_supported")) return outdated;
  const link = typeof r.json?.url === "string" ? r.json.url : "";
  // The link must be on the app's own address: never offer one that points elsewhere.
  if (r.status !== 200 || !link.startsWith(`${base}/reset/`) || /[\s"'<>]/.test(link)) {
    if (r.status === 200 && link) return { ok: false, reason: "error", message: "Your agency gave a link to a different address, so we didn't offer it." };
    return { ok: false, reason: "error", message: typeof r.json?.message === "string" && r.json.message ? r.json.message.slice(0, 200) : `Your agency answered ${r.status}.` };
  }
  return { ok: true, url: link, minutes: Number(r.json?.expiresInMinutes) || 15 };
}

// ---------------- what we did (our side of the audit trail) ----------------
export function logSupport(buyerId: number, adminEmail: string, action: string, note = "") {
  db().query("INSERT INTO support_log (buyer_id, admin_email, action, note, at) VALUES (?, ?, ?, ?, ?)").run(buyerId, adminEmail, action, note.slice(0, 300), now());
}
export const supportLog = (buyerId: number, n = 10) =>
  db().query("SELECT admin_email, action, note, at FROM support_log WHERE buyer_id = ? ORDER BY id DESC LIMIT ?").all(buyerId, n) as { admin_email: string; action: string; note: string; at: string }[];
