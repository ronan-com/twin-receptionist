// Per-buyer wizard state (SQLite) and the encrypted secrets vault.
//   setups.data   JSON, never holds a secret
//   secrets       AES-256-GCM, key = SETUP_SECRET_KEY, bound to (buyer, name) so rows can't be swapped
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CONFIG, RAILWAY, db, now, sha256 } from "./lib";

// ---------------- the site key ----------------
let KEY: Buffer | null = null;
export function siteKey(): Buffer {
  if (KEY) return KEY;
  const raw = CONFIG.secretKey;
  if (!raw) throw new Error("SETUP_SECRET_KEY is not set. Make one with: bun admin.ts gen-key");
  const b = Buffer.from(raw, "base64");
  if (b.length !== 32) throw new Error("SETUP_SECRET_KEY must be 32 bytes, base64 encoded (bun admin.ts gen-key makes one).");
  KEY = b;
  return KEY;
}
const subKey = (label: string) => createHmac("sha256", siteKey()).update(label).digest();

function encrypt(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", subKey("vault"), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function decrypt(box: string, aad: string): string {
  const b = Buffer.from(box.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", subKey("vault"), b.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

export type SecretName = "do_token" | "railway_token" | "cf_token" | "telnyx_key" | "vapi_key" | "vapi_public" | "twilio_token" | "resend_key" | "smtp_password" | "google_secret" | "microsoft_secret" | "godaddy_key" | "godaddy_secret" | "openrouter_key" | "railway_refresh" | "telnyx_refresh";
export const ALL_SECRETS: SecretName[] = ["do_token", "railway_token", "cf_token", "telnyx_key", "vapi_key", "vapi_public", "twilio_token", "resend_key", "smtp_password", "google_secret", "microsoft_secret", "godaddy_key", "godaddy_secret", "openrouter_key", "railway_refresh", "telnyx_refresh"];
/** DNS logins: the only keys that may outlive the install, and only when our admin ticked "keep for later changes". */
export const DNS_SECRETS: SecretName[] = ["cf_token", "godaddy_key", "godaddy_secret"];

export const last4 = (v: string) => (v.length > 8 ? v.slice(-4) : "");
export const mask = (l4?: string) => (l4 ? `••••${l4}` : "••••");

export function putSecret(buyerId: number, name: SecretName, value: string) {
  db().query("INSERT INTO secrets (buyer_id, name, value, last4, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (buyer_id, name) DO UPDATE SET value = excluded.value, last4 = excluded.last4, updated_at = excluded.updated_at")
    .run(buyerId, name, encrypt(value, `${buyerId}:${name}`), last4(value), now());
}
export function getSecret(buyerId: number, name: SecretName): string | null {
  const r = db().query("SELECT value FROM secrets WHERE buyer_id = ? AND name = ?").get(buyerId, name) as { value: string } | null;
  return r ? decrypt(r.value, `${buyerId}:${name}`) : null;
}
export function secretHint(buyerId: number, name: SecretName): string | null {
  const r = db().query("SELECT last4 FROM secrets WHERE buyer_id = ? AND name = ?").get(buyerId, name) as { last4: string } | null;
  return r ? mask(r.last4) : null;
}
export const hasSecret = (buyerId: number, name: SecretName) => !!db().query("SELECT 1 FROM secrets WHERE buyer_id = ? AND name = ?").get(buyerId, name);
export const deleteSecret = (buyerId: number, name: SecretName) => db().query("DELETE FROM secrets WHERE buyer_id = ? AND name = ?").run(buyerId, name);
/**
 * Deletes every key we hold for a buyer. The one exception is a DNS login the admin chose to keep for later changes
 * (setups.data assist.keepDns); `everything` (reset / delete buyer) ignores that.
 */
export function deleteAllSecrets(buyerId: number, everything = false): number {
  if (!everything) {
    const r = db().query("SELECT data FROM setups WHERE buyer_id = ?").get(buyerId) as { data: string } | null;
    let keep = false;
    try { keep = !!(r && JSON.parse(r.data).assist?.keepDns); } catch {}
    if (keep) return db().query(`DELETE FROM secrets WHERE buyer_id = ? AND name NOT IN (${DNS_SECRETS.map(() => "?").join(",")})`).run(buyerId, ...DNS_SECRETS).changes;
  }
  return db().query("DELETE FROM secrets WHERE buyer_id = ?").run(buyerId).changes;
}

/** Every secret value we hold for a buyer, plus the forms they could show up in, for redaction. */
export function secretValues(buyerId: number): string[] {
  const out: string[] = [];
  for (const n of ALL_SECRETS) {
    const v = getSecret(buyerId, n);
    if (v && v.length >= 6) out.push(v, encodeURIComponent(v));
  }
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}
export function redact(text: string, values: string[]): string {
  let t = text;
  for (const v of values) if (v) t = t.split(v).join("[hidden]");
  // Belt and braces: anything shaped like a known key format.
  return t
    .replace(/\bdop_v1_[a-f0-9]{20,}\b/g, "[hidden]")
    .replace(/\bKEY[0-9A-F]{20,}_[A-Za-z0-9]{10,}\b/g, "[hidden]")
    .replace(/\bre_[A-Za-z0-9_]{16,}\b/g, "[hidden]")
    .replace(/(smtps?:\/\/[^:\s/@]+:)[^@\s]+@/g, "$1[hidden]@");
}

// ---------------- wizard state ----------------
export type StepId = "welcome" | "brand" | "railway" | "domain" | "server" | "phones" | "ai" | "email" | "calendars" | "extras" | "vapi" | "twilio" | "install" | "done";
/**
 * Railway (the default): only Brand, Railway and Telnyx are needed. "extras" is one screen of
 * optional cards (email, your own domain, calendars); each opens its own step, which can be skipped.
 * DigitalOcean still needs a domain (its server gets an https certificate for it), so it keeps the long path.
 */
export const STEPS: StepId[] = RAILWAY
  ? ["welcome", "brand", "railway", "phones", "ai", "extras", "email", "domain", "calendars", "twilio", "install", "done"]
  : ["welcome", "brand", "domain", "server", "phones", "vapi", "twilio", "email", "calendars", "install", "done"];
/**
 * Steps that are never required. Railway: the pages behind the "Connect more" screen (extras): email, your own domain and Twilio,
 * each skippable. DigitalOcean: the backup phone options.
 */
export const OPTIONAL_STEPS: StepId[] = RAILWAY ? ["email", "domain", "calendars", "twilio"] : ["vapi", "twilio"];
/**
 * Railway steps that used to be in the path (extras, email, domain, calendars, Vapi, Twilio). Email, your own domain and
 * calendars are now "later" items on the Done screen; Vapi + Twilio is on the Voice step. Old stored setups may sit on one
 * of these: migrate() moves them on, and what they stored (email, domain, ...) is still installed.
 */
export const LEGACY_STEPS: StepId[] = ["extras", "email", "domain", "calendars", "vapi", "twilio"];
/** The backup phone options (Vapi, Twilio) are optional in both flows: Telnyx is the main path. */
export const BACKUP_STEPS: StepId[] = ["vapi", "twilio"];
export const isOptional = (id: StepId) => OPTIONAL_STEPS.includes(id);
/** The screen optional steps hang off and go back to: "Connect more" (Railway), or Voice (DigitalOcean). */
export const OPTIONAL_HUB: StepId = RAILWAY ? "extras" : "phones";

export interface DnsRecord {
  key: string; // stable id, e.g. "a", "dkim", "spf-mx"
  purpose: string; // "Your dashboard", "Email signing (DKIM)", ...
  type: "A" | "TXT" | "MX" | "CNAME";
  name: string; // fully qualified
  value: string;
  priority?: number;
  ttl: number | "Auto";
  ok?: boolean; // last public DNS check
  seen?: string; // what public DNS answered, for the "found something else" hint
  cfId?: string; // Cloudflare record id once written
}

export type Phase = "idle" | "creating" | "create_failed" | "dns" | "starting" | "installing" | "deploying" | "domain" | "failed" | "done";

export interface SetupData {
  /** 2 once moved to the short wizard, 3 once it has the "Connect more" step (see migrate). Old rows have none. */
  schema?: number;
  step: StepId;
  /** Set by nextStep(): where the buyer was just sent. The site uses it to redirect after a form (then clears it), so "Continue" always moves on, even from a step the buyer went Back to. */
  moved?: StepId;
  brand?: { productName: string; ownerEmail: string; ownPhoneAccount: boolean ; logo?: string; /** The main brand colour (the first one). */ colour?: string; /** 1 to 3 brand colours, the first is the main one. */ colours?: string[]; /** The look of the dashboard to start with; the owner can switch it later in the dashboard. */ theme?: "light" | "dark" };
  domain?: {
    mode: "cloudflare" | "godaddy" | "manual";
    zone?: string; // example.com
    sub: string; // "app"
    host?: string; // app.example.com (DOMAIN)
    cf?: {
      zones: { id: string; name: string; status: string; nameServers: string[] }[];
      zoneId?: string;
      status?: string; // pending | active
      nameServers?: string[];
      canEdit?: boolean;
      existing?: string; // what's at host today, if anything
      replace?: boolean;
      checks?: number;
      lastCheck?: string;
    };
    confirmed?: boolean; // the buyer pressed Continue with a usable domain
    replace?: boolean; // GoDaddy: replace what is at app.<zone> (Cloudflare keeps this in cf.replace)
  };
  server?: {
    accountEmail?: string;
    regions?: { slug: string; name: string }[];
    sizes?: { slug: string; label: string; price: number; regions: string[] }[];
    region?: string;
    size?: string;
    price?: number;
    sshPublicKey?: string;
    chosen?: boolean;
  };
  // provider: the voice engine chosen on the phones step (missing means Telnyx).
  // Telnyx is the main path. provider is kept in step with the backup choice below (vapi when Vapi is confirmed).
  // deferred: the buyer has no Telnyx account yet and went on to the backup options instead.
  phones?: { via?: "oauth" | "paste"; /** Phone numbers already on the Telnyx account (read-only, shown after connecting). */ numbers?: string[]; numbersAt?: string; balance?: string; checked?: boolean; confirmed?: boolean; provider?: "telnyx" | "vapi"; deferred?: boolean; /** Legacy: a Twilio Account SID saved on the phones step. Now see twilio. */ twilioSid?: string };
  /** AI step (OpenRouter): confirmed once a key is saved (pasted, or from "Sign in with OpenRouter"). The key itself is the openrouter_key secret. */
  ai?: { confirmed?: boolean; via?: "oauth" | "paste" };
  /** Backup option: Vapi instead of Telnyx for voice. Its keys are the vapi_key and vapi_public secrets. */
  vapi?: { confirmed?: boolean };
  /** Backup option: a Twilio account for numbers and texts (with Vapi). Its token is the twilio_token secret. */
  twilio?: { sid?: string; confirmed?: boolean };
  railway?: { via?: "oauth" | "paste"; expiresAt?: string; email?: string; workspaceId?: string; workspaceName?: string; plan?: string; /** On Railway's free trial: it can set up, but stops after 30 days or US$5. Shown on the Hosting step until they upgrade. */ trial?: boolean; /** We could not read the plan. */ planUnknown?: boolean; /** They saw the plan warning and chose to go on. */ planAck?: boolean; confirmed?: boolean };
  /** What we made in the buyer's Railway account (ids only). */
  rw?: {
    projectId?: string; environmentId?: string; pgId?: string; pgVolume?: boolean; appId?: string; appVolume?: boolean; varsSet?: boolean; settingsSet?: boolean;
    deploymentId?: string; deployStatus?: string; deployedAt?: string; serviceDomain?: string;
    customDomainId?: string; records?: DnsRecord[]; certStatus?: string; domainOk?: boolean; cfWritten?: boolean; healthy?: boolean;
    uploadedAt?: string; createdAt?: string;
  };
  email?: {
    mode: "resend" | "smtp";
    from?: string; // "Brand <hello@mail.example.com>"
    address?: string;
    sendingDomain?: string;
    resend?: { domainId?: string; status?: string; records?: DnsRecord[]; dmarc?: DnsRecord | null; written?: boolean; verifyAt?: string; lastCheck?: string };
    smtp?: { host: string; port: number; user: string };
    checked?: boolean;
    testSentTo?: string;
    confirmed?: boolean;
  };
  calendars?: { google?: { clientId: string }; microsoft?: { clientId: string }; done?: boolean };
  /** Railway: the buyer pressed Continue on the optional extras screen (whatever they added or skipped). */
  extrasDone?: boolean;
  /** Railway: extras the buyer chose to leave for later. */
  /** phones: the buyer skipped the phone provider (Telnyx approval can take a day or two) and connects it later in their dashboard (Connections). Railway only. */
  skipped?: { ai?: boolean; email?: boolean; domain?: boolean; calendars?: boolean; vapi?: boolean; twilio?: boolean; phones?: boolean };
  /**
   * "Update your agency" (Railway, after Done): the buyer pastes a Railway token again and we send the newest
   * app to the same project. ask = token screen, running = deploying, failed = nothing changed, done = last result.
   */
  update?: {
    phase: "ask" | "running" | "failed" | "done";
    from?: string; to?: string;
    envId?: string; appId?: string; varsSet?: boolean; volumeSet?: boolean;
    deploymentId?: string; deployStatus?: string; uploadedAt?: string; healthSince?: string;
    error?: string; startedAt?: string; at?: string; attempt?: number;
  };
  // the install
  phase: Phase;
  progress?: string[];
  dropletId?: number;
  ip?: string;
  aRecord?: DnsRecord;
  dnsChecks?: number;
  dnsSkipped?: boolean;
  attempt?: number;
  pendingAttempt?: number;
  attemptIssuedAt?: string;
  attemptVersion?: string;
  bundleFetches?: number;
  lastSeenAt?: string; // the server last asked us for work
  lastLogAt?: string;
  installStep?: string; // "4/10 Keeping the database password..."
  error?: string;
  resultUrl?: string;
  /** The one-time sign-in link's token (the app keeps only its hash). Shown only as the done screen's button, for 23 hours. */
  firstLogin?: { token: string; at: string };
  tempUrl?: string; // Railway's own https://<x>.up.railway.app address
  domainPending?: boolean; // finished before app.<domain> was ready
  finishRecords?: DnsRecord[]; // kept for the Done page when the domain was still pending
  serverCreatedAt?: string;
  installedAt?: string;
  purgedAt?: string;
  sshKeyAdded?: boolean;
  flash?: { kind: "ok" | "err" | "info"; text: string; form?: Record<string, string>; link?: string };
  /** The last error message each step showed (kept after the flash is gone), for "I need a person" (wizhelp.ts). Never a key. */
  lastErrors?: Partial<Record<StepId, { text: string; at: string }>>;
  /**
   * "Set up for them" (assist.ts): steps our admin filled in for the buyer, so the wizard shows them done with
   * "Set up by your provider" and a change link. Never holds a secret.
   *   steps    stepId -> who/when; the mark goes when the buyer saves that step themselves
   *   released stepIds the buyer pressed "change" on: the normal form shows again
   *   keepDns  the admin chose to keep the DNS login after the install (for later changes)
   *   dnsBy    which writer put the records in: cloudflare, godaddy or manual
   *   cfZones  zone names the Cloudflare token can see (the admin picks one)
   *   installBy / installedFor  who pressed Install
   */
  assist?: {
    steps?: Partial<Record<StepId | "openrouter", { by: string; at: string }>>;
    released?: StepId[];
    keepDns?: boolean;
    dnsBy?: "cloudflare" | "godaddy" | "manual";
    cfZones?: string[];
    installBy?: { by: string; at: string };
    openrouter?: boolean;
  };
}

interface Row { buyer_id: number; data: string; log: string; log_bytes: number; created_at: string; updated_at: string }

export function getSetup(buyerId: number): SetupData {
  const r = db().query("SELECT data FROM setups WHERE buyer_id = ?").get(buyerId) as { data: string } | null;
  if (!r) {
    const t = now();
    db().query("INSERT OR IGNORE INTO setups (buyer_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)").run(buyerId, JSON.stringify({ step: "welcome", phase: "idle" }), t, t);
    return { step: "welcome", phase: "idle" };
  }
  return migrate(JSON.parse(r.data));
}
/**
 * The short wizard (schema 2). Old stored setups keep working: whatever they stored stays, and a buyer who was sitting
 * on a step that is no longer in the path (Extras, Email, Domain, Calendars, Vapi, Twilio) is moved to the next step that is.
 * Email through Resend and calendar sign-in need a domain: a half-finished one (the domain step was never completed) is
 * dropped, so it can't block the install. Pure and idempotent; the new shape is saved with the next write.
 */
export function migrate(s: SetupData): SetupData {
  if (!RAILWAY || s.schema === 3) return s;
  if (s.schema === 2) {
    // The "Connect more" step is new: anyone already at Install (or past it) has nothing left to do there.
    s.schema = 3;
    if (s.phase !== "idle" || s.step === "install" || s.step === "done") s.extrasDone = true;
    return s;
  }
  s.schema = 3;
  if (s.phase !== "idle" || s.step === "install" || s.step === "done") s.extrasDone = true;
  if (s.phase === "idle" && !s.domain?.host) {
    if (s.email?.mode === "resend") { delete s.email; s.skipped = { ...s.skipped, email: true }; }
    if (s.calendars?.google || s.calendars?.microsoft) { s.calendars = { done: true }; s.skipped = { ...s.skipped, calendars: true }; }
  }
  if (LEGACY_STEPS.includes(s.step)) {
    const phonesDone = !!(s.phones?.confirmed || s.phones?.deferred || s.vapi?.confirmed || s.skipped?.phones);
    s.step = !s.brand ? "brand" : phonesDone ? "ai" : "phones";
  }
  return s;
}
export function saveSetup(buyerId: number, s: SetupData) {
  getSetup(buyerId); // makes the row
  db().query("UPDATE setups SET data = ?, updated_at = ? WHERE buyer_id = ?").run(JSON.stringify(s), now(), buyerId);
}
/** Read-modify-write. bun:sqlite is synchronous, so nothing else runs in between. */
export function updateSetup(buyerId: number, fn: (s: SetupData) => void): SetupData {
  const s = getSetup(buyerId);
  fn(s);
  saveSetup(buyerId, s);
  return s;
}
export function setupMeta(buyerId: number) {
  return db().query("SELECT buyer_id, log_bytes, created_at, updated_at FROM setups WHERE buyer_id = ?").get(buyerId) as Omit<Row, "data" | "log"> | null;
}
export const activeSetups = () =>
  (db().query("SELECT buyer_id, data FROM setups").all() as { buyer_id: number; data: string }[]).map((r) => ({ buyerId: r.buyer_id, s: JSON.parse(r.data) as SetupData }));

/** Buyers who still have keys stored but haven't touched their setup in `days` days. */
export function staleSecretBuyers(days: number): number[] {
  const cut = new Date(Date.now() - days * 86400_000).toISOString();
  return (db().query("SELECT DISTINCT s.buyer_id AS id FROM secrets s JOIN setups u ON u.buyer_id = s.buyer_id WHERE u.updated_at < ? AND s.updated_at < ?").all(cut, cut) as { id: number }[]).map((r) => r.id);
}

export function resetSetup(buyerId: number) {
  deleteAllSecrets(buyerId, true);
  db().query("DELETE FROM setups WHERE buyer_id = ?").run(buyerId);
}

// ---------------- install log ----------------
export function logRead(buyerId: number, from = 0): { text: string; next: number } {
  const r = db().query("SELECT log FROM setups WHERE buyer_id = ?").get(buyerId) as { log: string } | null;
  const log = r?.log || "";
  return { text: from >= log.length ? "" : log.slice(Math.max(0, from)), next: log.length };
}
export function logAppend(buyerId: number, text: string, bytes = 0) {
  db().query("UPDATE setups SET log = substr(log || ?, -400000), log_bytes = log_bytes + ? WHERE buyer_id = ?").run(text, bytes, buyerId);
}
export function logClear(buyerId: number) {
  db().query("UPDATE setups SET log = '', log_bytes = 0 WHERE buyer_id = ?").run(buyerId);
}
export const logBytes = (buyerId: number) => (db().query("SELECT log_bytes FROM setups WHERE buyer_id = ?").get(buyerId) as { log_bytes: number } | null)?.log_bytes ?? 0;

// ---------------- provisioning tokens ----------------
// The droplet token lives in the server's user_data and only lets it ask "anything for me?".
// Each install attempt gets a fresh attempt token (bundle download + progress reports).
export const newToken = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;
export function setDropletToken(buyerId: number, token: string | null) {
  db().query("UPDATE setups SET droplet_token_hash = ? WHERE buyer_id = ?").run(token ? sha256(token) : null, buyerId);
}
export function setAttemptToken(buyerId: number, token: string | null) {
  db().query("UPDATE setups SET attempt_token_hash = ? WHERE buyer_id = ?").run(token ? sha256(token) : null, buyerId);
}
function byToken(col: "droplet_token_hash" | "attempt_token_hash", token: string): number | null {
  if (!/^[da]_[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const h = sha256(token);
  const r = db().query(`SELECT buyer_id, ${col} AS h FROM setups WHERE ${col} = ?`).get(h) as { buyer_id: number; h: Buffer } | null;
  return r && timingSafeEqual(Buffer.from(r.h), h) ? r.buyer_id : null;
}
export const buyerByDropletToken = (t: string) => byToken("droplet_token_hash", t);
export const buyerByAttemptToken = (t: string) => byToken("attempt_token_hash", t);

// ---------------- sessions / CSRF ----------------
export const newSessionId = () => randomBytes(18).toString("base64url");
export const csrfToken = (sid: string, code: string) => createHmac("sha256", subKey("csrf")).update(`${sid}:${code}`).digest("base64url");
export function csrfOk(sid: string, code: string, token: string) {
  const want = Buffer.from(csrfToken(sid, code));
  const got = Buffer.from(String(token || ""));
  return got.length === want.length && timingSafeEqual(got, want);
}
export const fingerprint = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
