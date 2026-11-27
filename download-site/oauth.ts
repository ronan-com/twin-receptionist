// "Login with ..." for the setup wizard: OAuth 2.0 authorization code + PKCE (S256) for Railway, Telnyx and OpenRouter.
//
//   start     GET /setup/<code>/oauth/<provider>   makes a state + PKCE verifier, remembers them (SQLite), sets a browser cookie, redirects
//   callback  GET /oauth/<provider>/callback       checks state (single use, 10 minutes, same buyer, same browser), swaps the code for a token
//
// What each provider needs (all config: env vars, see README "OAuth" and deploy/aws/ssm notes):
//   OpenRouter  nothing to register. On by default (the callback must be https, or localhost). Returns the user's own API key.
//   Railway     register an OAuth app (workspace Developer settings): RAILWAY_OAUTH_CLIENT_ID (+ RAILWAY_OAUTH_CLIENT_SECRET for a web app),
//               or RAILWAY_OAUTH=1 to register a public client by itself (dynamic registration, once).
//   Telnyx      TELNYX_OAUTH_CLIENT_ID, or TELNYX_OAUTH=1 to register one by itself (dynamic client registration, once).
//   Redirect addresses to register: <SITE_URL>/oauth/railway/callback and <SITE_URL>/oauth/telnyx/callback (OpenRouter: none).
// A provider whose button is not configured is simply not shown: the paste-a-key form is always there.
// Mock mode (MOCK_OAUTH=1): the site answers as all three providers itself under /__mock/oauth (tests and screenshots only).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CONFIG, db, now, sha256 } from "./lib";
import { getSecret, getSetup, putSecret, updateSetup } from "./store";

export type OAuthProvider = "railway" | "telnyx" | "openrouter";
export const OAUTH_PROVIDERS: OAuthProvider[] = ["railway", "telnyx", "openrouter"];
export const isProvider = (v: string): v is OAuthProvider => (OAUTH_PROVIDERS as string[]).includes(v);

const STATE_MINUTES = 10;
const env = (k: string) => (process.env[k] ?? "").trim();
const UA = "receptionist-setup/1.0";

/** The address each provider sends the buyer back to. Register exactly this. */
export const redirectUri = (p: OAuthProvider) => `${CONFIG.siteUrl}/oauth/${p}/callback`;
const mockBase = (p: OAuthProvider) => `${CONFIG.siteUrl}/__mock/oauth/${p}`;
const local = () => /^(localhost|127\.|\[::1\])/.test(new URL(CONFIG.siteUrl).hostname);

export function endpoints(p: OAuthProvider) {
  if (CONFIG.mockOAuth) {
    const b = mockBase(p);
    return { authorize: `${b}/authorize`, token: `${b}/token`, register: `${b}/register`, apiKeys: `${b}/api_keys` };
  }
  switch (p) {
    case "railway": { const b = env("RAILWAY_OAUTH_BASE") || "https://backboard.railway.com/oauth"; return { authorize: `${b}/auth`, token: `${b}/token`, register: `${b}/register`, apiKeys: "" }; }
    case "telnyx": { const b = env("TELNYX_API_BASE") || "https://api.telnyx.com"; return { authorize: `${b}/v2/oauth/authorize`, token: `${b}/v2/oauth/token`, register: `${b}/v2/oauth/register`, apiKeys: `${b}/v2/api_keys` }; }
    case "openrouter": return { authorize: "https://openrouter.ai/auth", token: `${env("OPENROUTER_API_BASE") || "https://openrouter.ai/api/v1"}/auth/keys`, register: "", apiKeys: "" };
  }
}

/**
 * "Sign in with ..." that is parked: the code stays, the button and the start route are off. For launch every provider in the
 * wizard is paste-an-API-key only: Railway (token), Telnyx and Vapi (keys), OpenRouter (key). Telnyx's sign-in could not make the
 * key the agency needs and its popup took over the wizard; the others are parked with it so the whole wizard behaves the same.
 * Set OAUTH_PARKED_ON=1 to bring a parked sign-in back (tests do, to keep covering the code).
 */
export const PARKED: OAuthProvider[] = ["telnyx", "openrouter", "railway"];
const parked = (p: OAuthProvider) => PARKED.includes(p) && env("OAUTH_PARKED_ON") !== "1";

/** Is the "Login with ..." button shown for this provider? */
export function oauthEnabled(p: OAuthProvider): boolean {
  if (parked(p)) return false;
  if (CONFIG.mockOAuth) return true;
  switch (p) {
    case "railway": return !!env("RAILWAY_OAUTH_CLIENT_ID") || env("RAILWAY_OAUTH") === "1";
    case "telnyx": return !!env("TELNYX_OAUTH_CLIENT_ID") || env("TELNYX_OAUTH") === "1";
    // OpenRouter refuses a plain-http callback (PKCE can't protect it) except on localhost.
    case "openrouter": return env("OPENROUTER_OAUTH") !== "0" && (CONFIG.siteUrl.startsWith("https:") || local());
  }
}

// ---------------- state ----------------
let made = false;
function tables() {
  if (made) return;
  db().exec(`
    -- One row per "Login with ..." click. Single use, 10 minutes. The verifier never leaves this table and our token request.
    CREATE TABLE IF NOT EXISTS oauth_states (
      state_hash BLOB PRIMARY KEY,
      buyer_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      verifier TEXT NOT NULL,
      browser_hash BLOB NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT
    );
    -- Telnyx dynamic client registration: one public client per redirect address, made the first time it is needed.
    CREATE TABLE IF NOT EXISTS oauth_clients (
      provider TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      client_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (provider, redirect_uri)
    );
  `);
  made = true;
}
const b64 = (b: Buffer) => b.toString("base64url");
export const challengeOf = (verifier: string) => b64(createHash("sha256").update(verifier).digest());

/** The cookie that ties a callback to the browser that started it. Path /oauth only. */
export const OAUTH_COOKIE = "ob";
export const browserCookie = (id: string) => `${OAUTH_COOKIE}=${id}; Path=/oauth; HttpOnly; SameSite=Lax${CONFIG.siteUrl.startsWith("https:") ? "; Secure" : ""}; Max-Age=${STATE_MINUTES * 60}`;
export const readBrowserCookie = (req: Request) => (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${OAUTH_COOKIE}=([A-Za-z0-9_-]{20,64})`))?.[1] || "";

async function clientId(p: OAuthProvider): Promise<string> {
  if (CONFIG.mockOAuth) return `mock-${p}-client`;
  if (p === "openrouter") return "";
  const fixed = env(`${p.toUpperCase()}_OAUTH_CLIENT_ID`);
  if (fixed) return fixed;
  tables();
  const r = db().query("SELECT client_id FROM oauth_clients WHERE provider = ? AND redirect_uri = ?").get(p, redirectUri(p)) as { client_id: string } | null;
  if (r) return r.client_id;
  // Dynamic client registration (RFC 7591): a public client (no secret; PKCE protects the code), made the first time it is needed.
  // https://developers.telnyx.com/api-reference/oauth-protocol  https://docs.railway.com/integrations/oauth
  const scope = p === "railway" ? env("RAILWAY_OAUTH_SCOPES") || RAILWAY_SCOPES : env("TELNYX_OAUTH_SCOPE") || TELNYX_SCOPES;
  const res = await fetch(endpoints(p).register, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ client_name: env("OAUTH_APP_NAME") || "Agency setup", redirect_uris: [redirectUri(p)], grant_types: p === "railway" ? ["authorization_code", "refresh_token"] : ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none", scope }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.client_id) throw new Error(`${p} registration refused`);
  db().query("INSERT OR REPLACE INTO oauth_clients (provider, redirect_uri, client_id, created_at) VALUES (?, ?, ?, ?)").run(p, redirectUri(p), String(j.client_id), now());
  return String(j.client_id);
}
// Telnyx's registration refuses the old catch-all "admin" scope (invalid_client_metadata: allowed_scopes); it takes the granular
// ones listed at https://api.telnyx.com/.well-known/oauth-authorization-server. These cover what the receptionist uses.
const TELNYX_SCOPES = "ai.read ai.write messaging.read messaging.write numbers.read numbers.write voice.read voice.write billing.read account_management.read speech.read reporting.read";
const RAILWAY_SCOPES = "openid email profile offline_access workspace:admin project:admin";

/** Starts a login: remembers state + verifier, returns where to send the buyer and the cookie to set. */
export async function oauthStart(buyerId: number, p: OAuthProvider): Promise<{ url: string; cookie: string }> {
  tables();
  db().query("DELETE FROM oauth_states WHERE created_at < ?").run(new Date(Date.now() - 24 * 3600_000).toISOString());
  const state = b64(randomBytes(32)), verifier = b64(randomBytes(48)), browser = b64(randomBytes(24));
  db().query("INSERT INTO oauth_states (state_hash, buyer_id, provider, verifier, browser_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(sha256(state), buyerId, p, verifier, sha256(browser), now());
  const e = endpoints(p);
  const q = new URLSearchParams();
  if (p === "openrouter") {
    // OpenRouter does not hand `state` back, so ours rides inside the callback address itself (?s=...) and is matched exactly.
    q.set("callback_url", `${redirectUri(p)}?s=${encodeURIComponent(state)}`); q.set("code_challenge", challengeOf(verifier)); q.set("code_challenge_method", "S256"); q.set("state", state);
  } else {
    q.set("response_type", "code"); q.set("client_id", await clientId(p)); q.set("redirect_uri", redirectUri(p)); q.set("state", state);
    q.set("code_challenge", challengeOf(verifier)); q.set("code_challenge_method", "S256");
    q.set("scope", p === "railway" ? env("RAILWAY_OAUTH_SCOPES") || RAILWAY_SCOPES : env("TELNYX_OAUTH_SCOPE") || TELNYX_SCOPES);
  }
  return { url: `${e.authorize}?${q}`, cookie: browserCookie(browser) };
}

export type Consumed = { ok: true; buyerId: number; verifier: string; /** Set only for the cookie-only fallback: the row is still unused until markStateUsed(key) after a good exchange. */ key?: Buffer } | { ok: false; reason: "bad-state" | "expired" | "browser" | "used" | "denied" };
/**
 * Checks a callback's state and uses it up. Fails when the state is unknown, for another provider, already used, older
 * than 10 minutes, or arrives from a different browser than the one that started it. Always uses the state up once seen.
 */
export function consumeState(p: OAuthProvider, state: string, browser: string, at = Date.now()): Consumed {
  tables();
  type Row = { state_hash: Buffer; buyer_id: number; provider: string; verifier: string; browser_hash: Buffer; created_at: string; used_at: string | null };
  let r: Row | null;
  if (!state && p === "openrouter" && browser) {
    // OpenRouter sends the buyer back with only ?code=: it does not hand our state back. The browser cookie (set when the sign-in
    // started, and only ever sent by that browser) finds the login instead: the newest one this browser started that is still unused.
    // Only for a callback that carries no state at all (an older sign-in started before the state rode in the address).
    r = db().query("SELECT * FROM oauth_states WHERE provider = 'openrouter' AND browser_hash = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1").get(sha256(browser)) as Row | null;
    if (!r) return { ok: false, reason: "bad-state" };
    if (at - Date.parse(r.created_at) > STATE_MINUTES * 60_000) {
      db().query("UPDATE oauth_states SET used_at = ? WHERE state_hash = ?").run(new Date(at).toISOString(), r.state_hash);
      return { ok: false, reason: "expired" };
    }
    // The browser matched by construction. The row is used up by markStateUsed once the code has been swapped for a key.
    return { ok: true, buyerId: r.buyer_id, verifier: r.verifier, key: r.state_hash };
  } else {
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(state)) return { ok: false, reason: "bad-state" };
    r = db().query("SELECT * FROM oauth_states WHERE state_hash = ?").get(sha256(state)) as Row | null;
    if (!r || r.provider !== p) return { ok: false, reason: "bad-state" };
    if (r.used_at) return { ok: false, reason: "used" };
  }
  db().query("UPDATE oauth_states SET used_at = ? WHERE state_hash = ?").run(new Date(at).toISOString(), r.state_hash);
  if (at - Date.parse(r.created_at) > STATE_MINUTES * 60_000) return { ok: false, reason: "expired" };
  const want = Buffer.from(r.browser_hash), got = sha256(browser || "-");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "browser" };
  return { ok: true, buyerId: r.buyer_id, verifier: r.verifier };
}

/** Uses up a state found by the cookie-only fallback, after its code was exchanged (or the buyer cancelled). */
export function markStateUsed(key: Buffer, at = Date.now()): void {
  tables();
  db().query("UPDATE oauth_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL").run(new Date(at).toISOString(), key);
}

export interface Tokens { access: string; refresh?: string; expiresIn?: number }
/** Swaps the code for a token. OpenRouter answers with the user's API key (as access). Never throws the provider's text at the buyer. */
export async function exchangeCode(p: OAuthProvider, code: string, verifier: string): Promise<Tokens> {
  const e = endpoints(p);
  const post = async (url: string, body: BodyInit, headers: Record<string, string>) => {
    const res = await fetch(url, { method: "POST", body, headers: { "User-Agent": UA, Accept: "application/json", ...headers }, redirect: "error", signal: AbortSignal.timeout(25_000) });
    return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as any };
  };
  if (p === "openrouter") {
    const r = await post(e.token, JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }), { "Content-Type": "application/json" });
    if (!r.ok || typeof r.json?.key !== "string" || !r.json.key) throw new Error(`openrouter ${r.status}`);
    return { access: r.json.key };
  }
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(p), code_verifier: verifier, client_id: await clientId(p) });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const secret = CONFIG.mockOAuth ? "" : p === "railway" ? env("RAILWAY_OAUTH_CLIENT_SECRET") : env("TELNYX_OAUTH_CLIENT_SECRET");
  if (secret) headers.Authorization = `Basic ${Buffer.from(`${form.get("client_id")}:${secret}`).toString("base64")}`;
  const r = await post(e.token, form, headers);
  if (!r.ok || typeof r.json?.access_token !== "string") throw new Error(`${p} ${r.status} ${String(r.json?.error || "")}`.trim());
  return { access: r.json.access_token, refresh: typeof r.json.refresh_token === "string" ? r.json.refresh_token : undefined, expiresIn: Number(r.json.expires_in) || undefined };
}

/**
 * Telnyx: an OAuth access token runs out, but the installed app needs a key that doesn't. Ask Telnyx to make one with it.
 * Returns null when Telnyx won't (the caller then asks the buyer to paste a key instead).
 */
export async function telnyxKeyFrom(access: string): Promise<string | null> {
  try {
    const res = await fetch(endpoints("telnyx").apiKeys, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA }, body: "{}" });
    const j: any = await res.json().catch(() => ({}));
    const key = j?.data?.api_key || j?.data?.value || j?.data?.key;
    return res.ok && typeof key === "string" && key ? key : null;
  } catch { return null; }
}

// ---------------- Railway tokens run out after an hour ----------------
const REFRESH_EARLY_MS = 5 * 60_000;
/**
 * The buyer's Railway token, fresh. A pasted token never runs out (returned as is). One from "Login with Railway" lasts
 * an hour: this swaps it for a new one with the refresh token when it is about to run out, so a buyer who comes back
 * later (or an install that takes a while) still works.
 */
export async function railwayToken(buyerId: number): Promise<string | null> {
  const token = getSecret(buyerId, "railway_token");
  const s = getSetup(buyerId);
  const exp = s.railway?.expiresAt ? Date.parse(s.railway.expiresAt) : 0;
  if (!token || s.railway?.via !== "oauth" || !exp || exp - Date.now() > REFRESH_EARLY_MS) return token;
  const refresh = getSecret(buyerId, "railway_refresh");
  if (!refresh) return token;
  try {
    const cid = await clientId("railway");
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": UA };
    const secret = CONFIG.mockOAuth ? "" : env("RAILWAY_OAUTH_CLIENT_SECRET");
    if (secret) headers.Authorization = `Basic ${Buffer.from(`${cid}:${secret}`).toString("base64")}`;
    const res = await fetch(endpoints("railway").token, { method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(20_000), body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: cid }) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || typeof j.access_token !== "string") return token;
    putSecret(buyerId, "railway_token", j.access_token);
    if (typeof j.refresh_token === "string") putSecret(buyerId, "railway_refresh", j.refresh_token);
    updateSetup(buyerId, (x) => { if (x.railway) x.railway.expiresAt = new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000).toISOString(); });
    return j.access_token;
  } catch { return token; }
}

// ---------------- the fakes (MOCK_OAUTH=1 only) ----------------
/** The three providers, as the site answers them for itself in test mode. The authorize page just sends the browser straight back. */
export async function mockOAuthRoute(req: Request, url: URL): Promise<Response | null> {
  if (!CONFIG.mockOAuth) return null;
  const m = url.pathname.match(/^\/__mock\/oauth\/(railway|telnyx|openrouter)\/(authorize|token|register|api_keys)$/);
  if (!m) return null;
  const [, p, what] = m;
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  if (what === "authorize") {
    const q = url.searchParams;
    if (!q.get("code_challenge") || q.get("code_challenge_method") !== "S256") return json({ error: "pkce required" }, 400);
    const back = new URL(q.get("redirect_uri") || q.get("callback_url") || "");
    if (q.get("mock") === "deny") back.searchParams.set("error", "access_denied"); else back.searchParams.set("code", `mock-code-${p}`);
    // The real OpenRouter does not send our state back (only ?code=); the fake behaves the same, so the callback is tested the real way.
    if (q.get("state") && p !== "openrouter") back.searchParams.set("state", q.get("state")!);
    return new Response(null, { status: 302, headers: { Location: back.toString() } });
  }
  if (what === "register") return json({ client_id: "mock-telnyx-client", client_id_issued_at: Math.floor(Date.now() / 1000) }, 201);
  if (what === "api_keys") return json({ data: { id: "k1", api_key: "platform-fake-oauth-key-0123456789abcdef" } }, 201);
  const body: any = (req.headers.get("content-type") || "").includes("json") ? await req.json().catch(() => ({})) : Object.fromEntries(new URLSearchParams(await req.text()));
  if (!body.code_verifier) return json({ error: "invalid_grant" }, 400);
  if (p === "openrouter") return json({ key: "sk-or-v1-mock0123456789abcdef0123456789" });
  if (p === "railway") return json({ access_token: "mock-rail-token-ok", refresh_token: "mock-rail-refresh", expires_in: 3600, token_type: "Bearer" });
  return json({ access_token: "mock-telnyx-access", expires_in: 3600, token_type: "Bearer" });
}
