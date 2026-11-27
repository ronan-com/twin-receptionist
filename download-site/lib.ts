// Shared by server.ts (the website + setup wizard) and admin.ts (the command line).
// Settings come from environment variables; everything we store lives in DATA_DIR:
//   DATA_DIR/site.db            buyers, published server bundles, setups, encrypted secrets (SQLite)
//   DATA_DIR/packages/*.tgz     the published server bundles (what the wizard's servers download)
import { Database } from "bun:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const env = (k: string, d: string) => (process.env[k] ?? "").trim() || d;
const int = (k: string, d: number) => {
  const n = Number.parseInt(env(k, String(d)), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const on = (k: string) => env(k, "0") === "1";

const siteUrl = env("SITE_URL", "http://localhost:4500").replace(/\/+$/, "");

export const CONFIG = {
  sellerName: env("SELLER_NAME", "Twin Technologies"),
  productName: env("PRODUCT_NAME", "AI Receptionist"),
  supportEmail: env("SUPPORT_EMAIL", ""),
  siteUrl,
  // The address new servers use to download the app and report progress. Normally SITE_URL.
  provisionUrl: env("PROVISION_URL", siteUrl).replace(/\/+$/, ""),
  // Where "Download your full source code" points, with {version} filled in (e.g. a GitHub release). Empty: our own signed download.
  sourceDownloadUrl: env("SOURCE_DOWNLOAD_URL", ""),
  host: env("HOST", "127.0.0.1"),
  port: int("PORT", 4500),
  // Test mode only: a second address to listen on (the fake droplets' network gateway).
  extraListen: env("EXTRA_LISTEN", ""),
  dataDir: resolve(env("DATA_DIR", join(import.meta.dir, "data"))),
  contentDir: env("CONTENT_DIR", ""),
  lookupsPerMinute: int("LOOKUPS_PER_MINUTE", 20), // failed code lookups per IP per minute
  requestsPerMinute: int("REQUESTS_PER_MINUTE", 600), // everything else per IP per minute
  checksPer10Min: int("CHECKS_PER_10_MIN", 20), // provider checks per buyer
  testEmailsPerHour: int("TEST_EMAILS_PER_HOUR", 3),
  secretsIdleDays: int("SECRETS_IDLE_DAYS", 14), // stored keys of an untouched setup are deleted after this
  trustProxy: env("TRUST_PROXY", "0") === "1",
  secretKey: env("SETUP_SECRET_KEY", ""),
  // Where buyers' agencies run: "railway" (the default, easiest) or "digitalocean" (own server).
  hosting: (env("HOSTING", "railway") === "digitalocean" ? "digitalocean" : "railway") as "railway" | "digitalocean",
  // Test switches. Each one replaces a provider with a local fake; none of them is ever set in production.
  mockDO: on("MOCK_DO"),
  mockRailway: on("MOCK_RAILWAY"),
  // Test sites only: every step can be opened and skipped, to look at the whole flow.
  previewJump: on("PREVIEW_JUMP"),
  mockCF: on("MOCK_CF"),
  mockResend: on("MOCK_RESEND"),
  mockTelnyx: on("MOCK_TELNYX"),
  mockOAuth: on("MOCK_OAUTH"),
  mockBase: env("MOCK_BASE", "http://127.0.0.1"),
  // Public resolvers we ask directly (never the system resolver). Tests point this at the fake DNS.
  dnsServers: env("DNS_SERVERS", "1.1.1.1,8.8.8.8").split(",").map((s) => s.trim()).filter(Boolean),
};
// A test site never calls the real Railway: with any other fake on, the Railway fake is on too (unless MOCK_RAILWAY=0).
if (!CONFIG.mockRailway && env("MOCK_RAILWAY", "") === "" && (CONFIG.mockDO || CONFIG.mockCF || CONFIG.mockResend || CONFIG.mockTelnyx || CONFIG.mockOAuth)) CONFIG.mockRailway = true;
export const ANY_MOCK = CONFIG.mockDO || CONFIG.mockRailway || CONFIG.mockCF || CONFIG.mockResend || CONFIG.mockTelnyx || CONFIG.mockOAuth;
export const RAILWAY = CONFIG.hosting === "railway";
// Never on without a fake provider: a real site must not let anyone skip steps.
if (CONFIG.previewJump && !ANY_MOCK) CONFIG.previewJump = false;

/** Things about SITE_URL that will break setup links or new servers' callbacks. */
export function siteUrlWarnings(): string[] {
  const out: string[] = [];
  const raw = (process.env.SITE_URL || "").trim();
  let u: URL | null = null;
  try { u = new URL(CONFIG.siteUrl); } catch { return [`SITE_URL "${CONFIG.siteUrl}" isn't a valid address, like https://setup.yourcompany.com`]; }
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname);
  if (!raw && !ANY_MOCK) out.push(`SITE_URL is not set, so setup links and new servers use ${CONFIG.siteUrl}. Set it to the public address, like https://setup.yourcompany.com`);
  else if (local && !ANY_MOCK) out.push(`SITE_URL is ${CONFIG.siteUrl}: buyers and their new servers can't reach a local address. Set it to the public https address.`);
  if (!local && u.protocol !== "https:") out.push(`SITE_URL ${CONFIG.siteUrl} is not https. Put the site behind Caddy (deploy/) and use the https address.`);
  if (u.pathname !== "/" || u.search || u.hash) out.push(`SITE_URL should be just the address with no path (got ${CONFIG.siteUrl}).`);
  if (!local && !CONFIG.trustProxy && CONFIG.host !== "127.0.0.1") out.push("TRUST_PROXY is off: behind Caddy set TRUST_PROXY=1 so rate limits see the visitor's address, not the proxy's.");
  if (!RAILWAY && !/^https:/.test(CONFIG.provisionUrl) && !ANY_MOCK) out.push(`PROVISION_URL ${CONFIG.provisionUrl} is not https: new servers download the app and report progress over it.`);
  return out;
}

/**
 * Test switches on a site that looks public (https, not localhost) are refused, so a real
 * site can never run with fake providers or skippable steps. Quick tunnels
 * (*.trycloudflare.com) and TEST_SITE=1 are the only exceptions: those are test sites.
 */
export function productionGuard(): string | null {
  const flags = ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "PREVIEW_JUMP", "DO_API_BASE", "CF_API_BASE", "RESEND_API_BASE", "RAILWAY_API_BASE", "GODADDY_API_BASE"]
    .filter((k) => (process.env[k] ?? "").trim() && (process.env[k] ?? "").trim() !== "0");
  if (!flags.length) return null;
  let u: URL;
  try { u = new URL(CONFIG.siteUrl); } catch { return null; }
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname);
  if (local || u.protocol !== "https:" || on("TEST_SITE") || u.hostname.endsWith(".trycloudflare.com")) return null;
  return `${flags.join(", ")} ${flags.length > 1 ? "are" : "is"} for test sites only, but SITE_URL is the public address ${CONFIG.siteUrl}. Remove ${flags.length > 1 ? "them" : "it"} (or set TEST_SITE=1 on a test site). Refusing to start.`;
}

export const PACKAGES_DIR = join(CONFIG.dataDir, "packages");

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "product";

// ---------------- buyer codes ----------------
// 128 random bits, base64url: 22 characters from [A-Za-z0-9_-].
export const CODE_RE = /^[A-Za-z0-9_-]{22}$/;
export const newCode = () => randomBytes(16).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();
export const hashCode = sha256;
export const setupLink = (code: string) => `${CONFIG.siteUrl}/setup/${code}`;

// Accepts a bare code or a pasted link (".../setup/<code>" or the old ".../download/<code>").
export function extractCode(input: string): string | null {
  const s = String(input || "").trim();
  if (CODE_RE.test(s)) return s;
  const m = s.match(/\/(?:setup|download)\/([A-Za-z0-9_-]{22})(?:\/[^?#]*)?\/?(?:[?#].*)?$/);
  return m ? m[1] : null;
}

// ---------------- database ----------------
export interface Buyer {
  id: number;
  code: string;
  code_hash: Buffer;
  name: string;
  email: string;
  created_at: string;
  revoked_at: string | null;
  downloads: number;
  last_download_at: string | null;
  /** 1 = a demo buyer: pretend accounts, no provider is ever called for them. */
  demo: number;
  /** Always "neutral": the setup site is generic and shows nobody's name but the buyer's own. (Older rows may hold "branded"; they are rewritten at startup and render the same.) */
  style: Style;
  /** The generic onboarding link (genericlink.ts) this agency started from, or null for a private link made by our admin. */
  source_link: number | null;
  /** When we last emailed them their invite (setup link or dashboard login) from the agency page, or null. */
  invited_at: string | null;
}
/** Generic is the only style. The column stays so stored buyers keep working; any stored value renders generic. */
export type Style = "neutral";
export const asStyle = (_v?: unknown): Style => "neutral";
/** Takes any product or seller name out of text (emails, prompts): PRODUCT_NAME and SELLER_NAME never show to a buyer. */
export function unbrand(text: string): string {
  let t = text;
  for (const [name, instead] of [[CONFIG.sellerName, "your provider"], [CONFIG.productName, "your AI receptionist agency"]] as const) {
    if (name && name.trim().length >= 3) t = t.split(name).join(instead);
  }
  return t;
}
export interface Pkg {
  id: number;
  version: string;
  file: string;
  size: number;
  sha256: string;
  published_at: string;
  /** What's new in this version, one change per line (shown to buyers on the Update screen). */
  notes: string | null;
}

/**
 * Adds a column if it isn't there yet. Safe to run twice and from two processes: if another one added it between our look and our
 * ALTER, SQLite says "duplicate column name" and that counts as done.
 */
export function addColumn(d: Database, table: string, column: string, ddl: string) {
  if ((d.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column)) return;
  try { d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`); } catch (e) { if (!/duplicate column name/i.test(String((e as Error)?.message))) throw e; }
}

let _db: Database | null = null;
export function db(): Database {
  if (_db) return _db;
  mkdirSync(PACKAGES_DIR, { recursive: true, mode: 0o700 });
  const d = new Database(join(CONFIG.dataDir, "site.db"), { create: true, strict: true });
  // secure_delete: deleted secrets are overwritten with zeros, not left in free pages.
  // busy_timeout first: the server and `admin.ts publish` can open a fresh site.db at the same moment.
  d.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;");
  // The whole schema setup runs under one write lock, so a second process opening the same new file waits and then finds it all done.
  d.exec("BEGIN IMMEDIATE");
  try {
  d.exec(`
    CREATE TABLE IF NOT EXISTS buyers (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      code_hash BLOB NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      downloads INTEGER NOT NULL DEFAULT 0,
      last_download_at TEXT
    );
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY,
      version TEXT NOT NULL UNIQUE,
      file TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      published_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS download_log (
      id INTEGER PRIMARY KEY,
      buyer_id INTEGER NOT NULL REFERENCES buyers(id),
      version TEXT NOT NULL,
      ip TEXT NOT NULL,
      at TEXT NOT NULL
    );
    -- One wizard run per buyer. data is JSON with no secrets in it.
    CREATE TABLE IF NOT EXISTS setups (
      buyer_id INTEGER PRIMARY KEY REFERENCES buyers(id),
      data TEXT NOT NULL DEFAULT '{}',
      droplet_token_hash BLOB UNIQUE,
      attempt_token_hash BLOB UNIQUE,
      log TEXT NOT NULL DEFAULT '',
      log_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    -- Buyer secrets, AES-256-GCM encrypted with SETUP_SECRET_KEY. Deleted after a successful install.
    CREATE TABLE IF NOT EXISTS secrets (
      buyer_id INTEGER NOT NULL REFERENCES buyers(id),
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      last4 TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (buyer_id, name)
    );
    -- The heartbeat (sync.ts). The token's hash only; the latest snapshot; a short history of counts.
    CREATE TABLE IF NOT EXISTS sync_tokens (
      buyer_id INTEGER PRIMARY KEY REFERENCES buyers(id),
      token_hash BLOB NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_snapshots (
      buyer_id INTEGER PRIMARY KEY REFERENCES buyers(id),
      data TEXT NOT NULL,
      received_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'heartbeat'
    );
    CREATE TABLE IF NOT EXISTS sync_history (
      id INTEGER PRIMARY KEY,
      buyer_id INTEGER NOT NULL REFERENCES buyers(id),
      at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sync_history_buyer ON sync_history (buyer_id, id DESC);
    -- "Push update now" (releases.ts): the next heartbeat answer carries updateNow, once.
    CREATE TABLE IF NOT EXISTS sync_push (
      buyer_id INTEGER PRIMARY KEY,
      requested_at TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT ''
    );
    -- Alerts we sent about an agency (alerts.ts). Kept for the admin's alert history; de-duped per agency, kind and hour.
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY,
      buyer_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      at TEXT NOT NULL,
      sent TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS alerts_buyer_kind ON alerts (buyer_id, kind, id DESC);
    -- Agencies whose owner switched sharing off: their silence is not an outage. Cleared when a heartbeat arrives.
    CREATE TABLE IF NOT EXISTS sync_off (
      buyer_id INTEGER PRIMARY KEY,
      at TEXT NOT NULL
    );
    -- Our staff's "Sync now" and "View as" clicks. No foreign key: it outlives a deleted buyer.
    CREATE TABLE IF NOT EXISTS support_log (
      id INTEGER PRIMARY KEY,
      buyer_id INTEGER NOT NULL,
      admin_email TEXT NOT NULL,
      action TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL
    );
  `);
  // Older databases (the live one) have no demo column: add it, off for everyone already there.
  addColumn(d, "buyers", "demo", "INTEGER NOT NULL DEFAULT 0");
  // Same for release notes (the live database has no notes column on packages).
  addColumn(d, "packages", "notes", "TEXT");
  // Onboarding links (genericlink.ts): which look a buyer gets, and which generic link they started from.
  addColumn(d, "buyers", "style", "TEXT NOT NULL DEFAULT 'neutral'");
  addColumn(d, "buyers", "source_link", "INTEGER");
  // "Invite them" on the agency page: when we emailed them. Existing agencies start as not invited.
  addColumn(d, "buyers", "invited_at", "TEXT");
  d.exec(`
    CREATE TABLE IF NOT EXISTS generic_links (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      code_hash BLOB NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      style TEXT NOT NULL DEFAULT 'neutral',
      enabled INTEGER NOT NULL DEFAULT 1,
      cap INTEGER,
      started INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      rotated_at TEXT
    );
  `);
  // Generic is the only style now: anything stored as "branded" renders (and is kept) as generic.
  d.exec("UPDATE buyers SET style = 'neutral' WHERE style <> 'neutral'");
  d.exec("UPDATE generic_links SET style = 'neutral' WHERE style <> 'neutral'");
  d.exec("COMMIT");
  } catch (e) {
    try { d.exec("ROLLBACK"); } catch { /* nothing open */ }
    d.close();
    throw e;
  }
  _db = d;
  return d;
}

export const now = () => new Date().toISOString();

// Looks a buyer up by the SHA-256 of the code and confirms with a constant-time
// comparison, so response time doesn't depend on how much of a guess was right.
const DUMMY = Buffer.alloc(32);
export function findBuyer(code: string): Buyer | null {
  if (!CODE_RE.test(code)) return null;
  const h = hashCode(code);
  const row = db().query("SELECT * FROM buyers WHERE code_hash = ?").get(h) as Buyer | null;
  const stored = row ? Buffer.from(row.code_hash) : DUMMY;
  const same = timingSafeEqual(stored, h);
  return row && same ? row : null;
}

/** Every agency is generic: no name of ours anywhere. */
export function addBuyer(name: string, email: string, demo = false, opts: { style?: Style; sourceLink?: number } = {}): Buyer {
  const code = newCode();
  const style: Style = asStyle(opts.style);
  db().query("INSERT INTO buyers (code, code_hash, name, email, created_at, demo, style, source_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(code, hashCode(code), name, email, now(), demo ? 1 : 0, style, opts.sourceLink ?? null);
  return findBuyer(code)!;
}
export const setBuyerStyle = (id: number, style: Style) => db().query("UPDATE buyers SET style = ? WHERE id = ?").run(asStyle(style), id).changes;
export const markInvited = (id: number) => db().query("UPDATE buyers SET invited_at = ? WHERE id = ?").run(now(), id).changes;

export const listBuyers = () => db().query("SELECT * FROM buyers ORDER BY id").all() as Buyer[];
export const revokeBuyer = (id: number) => db().query("UPDATE buyers SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now(), id).changes;
export const restoreBuyer = (id: number) => db().query("UPDATE buyers SET revoked_at = NULL WHERE id = ?").run(id).changes;

// Published server bundles (selfhost-bundle.tgz). The newest is what new installs get.
export const currentPackage = () => db().query("SELECT * FROM packages WHERE file LIKE '%.tgz' ORDER BY id DESC LIMIT 1").get() as Pkg | null;
export const listPackages = () => db().query("SELECT * FROM packages ORDER BY id").all() as Pkg[];
export function recordPackage(p: Omit<Pkg, "id" | "published_at" | "notes"> & { notes?: string | null }) {
  db().query("INSERT INTO packages (version, file, size, sha256, published_at, notes) VALUES (?, ?, ?, ?, ?, ?)").run(p.version, p.file, p.size, p.sha256, now(), p.notes?.trim() || null);
}
export const setPackageNotes = (version: string, notes: string) => db().query("UPDATE packages SET notes = ? WHERE version = ?").run(notes.trim() || null, version).changes;

// ---------------- formatting ----------------
export function humanSize(n: number) {
  if (n < 1024) return `${n} bytes`;
  const u = ["KB", "MB", "GB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}
