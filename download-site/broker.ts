// The shared Google / Microsoft sign-in ("OAuth broker"): one Google app and one Microsoft app owned by the platform
// owner, so an agency never has to register its own to connect Google Calendar, Gmail or Outlook.
//
// Why a broker and not just a shared client id: a refresh token only works with the client id AND secret that issued it,
// and that secret must stay on our server. So the app never gets the secret. It asks us each time it needs an access token.
//
//   connect   app --POST /api/broker/start--> us (Bearer sync token; app sends its own PKCE challenge, state, return address)
//             <-- {url}: the Google/Microsoft sign-in address; the app sends the browser there
//             browser --> Google/Microsoft --> GET /oauth/broker/<provider>/callback (we swap the code for tokens using our secret)
//             browser <-- redirect to the app's return address with ?code=<one-time ticket>&state=<app's state>
//             app --POST /api/broker/redeem {ticket, verifier}--> us: the app proves it is the one that started it (PKCE)
//             <-- {refreshToken, address}. refreshToken is OUR sealed wrapper ("brk1.…"), useless to anyone but that agency.
//   refresh   app --POST /api/broker/refresh {provider, purpose, refreshToken}--> us --> Google/Microsoft with our secret
//             <-- {accessToken, expiresIn, refreshToken?}  (the wrapper is replaced when Microsoft rotates the token)
//
// What we keep: nothing about anyone's mailbox or calendar. The Google/Microsoft refresh token exists on our side only
// inside the ticket (2 minutes, deleted on first use) and, from then on, only inside the agency's own database, sealed
// with a key only we hold. We never log tokens, codes or addresses.
// Config (all off until set): OAUTH_BROKER=1, GOOGLE_BROKER_CLIENT_ID/SECRET, MICROSOFT_BROKER_CLIENT_ID/SECRET,
// BROKER_URL (public https address on a domain we own; default SITE_URL), BROKER_GOOGLE_MAIL=1 (only after Google's
// restricted-scope assessment). BROKER_<P>_AUTH_URL / _TOKEN_URL replace the provider addresses (tests only).
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { CONFIG, db, now, sha256 } from "./lib";
import { buyerBySyncToken, bearerOf } from "./sync";
import { siteKey } from "./store";
import { BROKER_PROVIDERS, BROKER_PURPOSES, BROKER_SCOPES, type BrokerProvider, type BrokerPurpose } from "./brokerScopes";

const env = (k: string) => (process.env[k] ?? "").trim();
const STATE_MS = 10 * 60_000;
const TICKET_MS = 2 * 60_000;
const WRAP = "brk1.";

export const brokerOn = () => env("OAUTH_BROKER") === "1";
const P = (p: BrokerProvider) => p.toUpperCase();
function client(p: BrokerProvider): { id: string; secret: string } | null {
  const id = env(`${P(p)}_BROKER_CLIENT_ID`), secret = env(`${P(p)}_BROKER_CLIENT_SECRET`);
  return id && secret ? { id, secret } : null;
}
/** Which sign-ins we offer, by provider and purpose. Gmail (restricted scope) needs its own switch. */
export function offered(): Record<BrokerProvider, Record<BrokerPurpose, boolean>> {
  const on = brokerOn();
  const g = on && !!client("google"), m = on && !!client("microsoft");
  return { google: { calendar: g, mail: g && env("BROKER_GOOGLE_MAIL") === "1" }, microsoft: { calendar: m, mail: m } };
}
export const brokerBase = () => (env("BROKER_URL") || CONFIG.siteUrl).replace(/\/+$/, "");
/** Register exactly this with Google and Microsoft. */
export const brokerRedirectUri = (p: BrokerProvider) => `${brokerBase()}/oauth/broker/${p}/callback`;
function urls(p: BrokerProvider): { auth: string; token: string; extra: Record<string, string> } {
  return p === "google"
    ? { auth: env("BROKER_GOOGLE_AUTH_URL") || "https://accounts.google.com/o/oauth2/v2/auth", token: env("BROKER_GOOGLE_TOKEN_URL") || "https://oauth2.googleapis.com/token", extra: { access_type: "offline", prompt: "consent" } }
    : { auth: env("BROKER_MICROSOFT_AUTH_URL") || "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: env("BROKER_MICROSOFT_TOKEN_URL") || "https://login.microsoftonline.com/common/oauth2/v2.0/token", extra: { prompt: "select_account" } };
}

// ---------------- storage: short-lived and single-use ----------------
let made = false;
function tables() {
  if (made) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS broker_states (
      state_hash BLOB PRIMARY KEY, buyer_id INTEGER NOT NULL, provider TEXT NOT NULL, purpose TEXT NOT NULL,
      return_url TEXT NOT NULL, app_state TEXT NOT NULL, challenge TEXT NOT NULL, verifier TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS broker_tickets (
      ticket_hash BLOB PRIMARY KEY, buyer_id INTEGER NOT NULL, challenge TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
    );`);
  made = true;
}
const sweep = () => {
  db().query("DELETE FROM broker_states WHERE created_at < ?").run(new Date(Date.now() - STATE_MS).toISOString());
  db().query("DELETE FROM broker_tickets WHERE created_at < ?").run(new Date(Date.now() - TICKET_MS).toISOString());
};

// ---------------- sealing (the "brk1." wrapper and the ticket) ----------------
const key = (label: string) => createHmac("sha256", siteKey()).update(`broker:${label}`).digest();
function seal(plain: string, label: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(label), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
function open(box: string, label: string, aad: string): string | null {
  try {
    const b = Buffer.from(box, "base64url");
    const d = createDecipheriv("aes-256-gcm", key(label), b.subarray(0, 12));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch { return null; }
}
/** The provider's refresh token, sealed so it only works for this agency, this provider and this purpose. */
export const wrapToken = (buyerId: number, p: BrokerProvider, purpose: BrokerPurpose, refresh: string) => WRAP + seal(refresh, "wrap", `${buyerId}:${p}:${purpose}`);
export const unwrapToken = (buyerId: number, p: BrokerProvider, purpose: BrokerPurpose, wrapped: string) => (wrapped.startsWith(WRAP) ? open(wrapped.slice(WRAP.length), "wrap", `${buyerId}:${p}:${purpose}`) : null);

// ---------------- helpers ----------------
const b64 = (b: Buffer) => b.toString("base64url");
const B64 = /^[A-Za-z0-9_-]{20,128}$/;
const json = (o: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...h } });
const page = (title: string, text: string, status = 400) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px system-ui;max-width:32em;margin:15vh auto;padding:0 1em"><h1 style="font-size:1.3em">${title}</h1><p>${text}</p>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

/** Where the browser may be sent back to: an https address (or localhost for development), no fragment. */
export function returnUrlOk(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 400) return false;
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) && !u.hash && !u.username && !u.password;
  } catch { return false; }
}
function emailFromIdToken(idToken: unknown): string {
  try {
    // Straight from the provider's token endpoint over TLS, so the payload can be read without checking the signature.
    const payload = JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString("utf8"));
    return String(payload.email || payload.preferred_username || "").toLowerCase();
  } catch { return ""; }
}
async function tokenCall(p: BrokerProvider, body: Record<string, string>): Promise<{ ok: boolean; status: number; data: any }> {
  const c = client(p)!;
  const res = await fetch(urls(p).token, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...body }),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}
const isProvider = (v: unknown): v is BrokerProvider => (BROKER_PROVIDERS as unknown[]).includes(v);
const isPurpose = (v: unknown): v is BrokerPurpose => (BROKER_PURPOSES as unknown[]).includes(v);
async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get("content-length") || 0) > 8_000) return null;
  try { const t = (await req.text()).slice(0, 8_001); if (t.length > 8_000) return null; const j = JSON.parse(t); return j && typeof j === "object" ? j : null; } catch { return null; }
}

// ---------------- routes ----------------
type Allow = (key: string, max: number, windowMs: number) => number;

/**
 * Handles /api/broker/* and /oauth/broker/<provider>/callback. Returns null for any other path. With the broker
 * off (the default) every one of them answers 404, as if it didn't exist.
 */
export async function brokerApi(req: Request, url: URL, ip: string, allow: Allow): Promise<Response | null> {
  const path = url.pathname;
  const cb = path.match(/^\/oauth\/broker\/([a-z]+)\/callback$/);
  if (!cb && !path.startsWith("/api/broker/")) return null;
  if (!brokerOn()) return json({ error: "Not found" }, 404);
  tables();
  sweep();

  // The provider sends the person's browser here.
  if (cb) {
    if (req.method !== "GET") return json({ error: "GET only" }, 405, { Allow: "GET" });
    const wait = allow(`brokercb:${ip}`, 30, 10 * 60_000);
    if (wait) return json({ error: "too many requests" }, 429, { "Retry-After": String(wait) });
    return callback(url, cb[1]);
  }

  // Everything else is the agency's app talking to us, signed with its sync token.
  const token = bearerOf(req);
  const buyerId = buyerBySyncToken(token);
  if (buyerId == null) {
    const wait = allow(`brokerbad:${ip}`, 30, 10 * 60_000);
    return wait ? json({ error: "too many tries" }, 429, { "Retry-After": String(wait) }) : json({ error: "unauthorised" }, 401);
  }
  const route = path.slice("/api/broker/".length);
  if (route === "status") {
    if (req.method !== "GET") return json({ error: "GET only" }, 405, { Allow: "GET" });
    return json({ enabled: true, offered: offered() });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405, { Allow: "POST" });
  const limits: Record<string, [number, number]> = { start: [20, 3600_000], redeem: [30, 3600_000], refresh: [600, 3600_000] };
  if (!limits[route]) return json({ error: "Not found" }, 404);
  const wait = allow(`broker:${route}:${buyerId}`, limits[route][0], limits[route][1]);
  if (wait) return json({ error: "too many requests" }, 429, { "Retry-After": String(wait) });
  const body = await bodyOf(req);
  if (!body) return json({ error: "bad request" }, 400);
  if (route === "start") return start(buyerId, body);
  if (route === "redeem") return redeem(buyerId, body);
  return refresh(buyerId, body);
}

function start(buyerId: number, b: Record<string, unknown>): Response {
  const { provider, purpose, returnUrl, state, challenge } = b;
  if (!isProvider(provider) || !isPurpose(purpose) || !returnUrlOk(returnUrl) || typeof state !== "string" || typeof challenge !== "string" || !B64.test(state) || !B64.test(challenge)) {
    return json({ error: "bad request" }, 400);
  }
  if (!offered()[provider][purpose]) return json({ error: "not_offered", message: "That sign-in isn't available through the shared connection." }, 403);
  const own = b64(randomBytes(24)), verifier = b64(randomBytes(32));
  db().query("INSERT INTO broker_states (state_hash, buyer_id, provider, purpose, return_url, app_state, challenge, verifier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(sha256(own), buyerId, provider, purpose, returnUrl, state, challenge, verifier, now());
  const q = new URLSearchParams({
    client_id: client(provider)!.id, redirect_uri: brokerRedirectUri(provider), response_type: "code", scope: BROKER_SCOPES[provider][purpose], state: own,
    code_challenge: b64(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", ...urls(provider).extra,
  });
  return json({ url: `${urls(provider).auth}?${q}` });
}

async function callback(url: URL, providerName: string): Promise<Response> {
  const state = url.searchParams.get("state") || "";
  if (!isProvider(providerName) || !B64.test(state)) return page("That sign-in didn't work", "Close this tab and start again from your dashboard.");
  const r = db().query("DELETE FROM broker_states WHERE state_hash = ? RETURNING *").get(sha256(state)) as
    { buyer_id: number; provider: string; purpose: BrokerPurpose; return_url: string; app_state: string; challenge: string; verifier: string; created_at: string } | null;
  if (!r || r.provider !== providerName || Date.now() - Date.parse(r.created_at) > STATE_MS) {
    return page("That sign-in took too long", "Close this tab and start again from your dashboard.");
  }
  const back = (params: Record<string, string>) => {
    const u = new URL(r.return_url);
    for (const [k, v] of Object.entries({ ...params, state: r.app_state })) u.searchParams.set(k, v);
    return new Response(null, { status: 302, headers: { Location: u.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  };
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return back({ error: "cancelled" });
  let t;
  try {
    t = await tokenCall(providerName, { grant_type: "authorization_code", code, redirect_uri: brokerRedirectUri(providerName), code_verifier: r.verifier });
  } catch { return back({ error: "unavailable" }); }
  if (!t.ok) { console.error(`[broker] ${providerName} code exchange refused (${t.status})`); return back({ error: "refused" }); }
  const address = emailFromIdToken(t.data.id_token);
  if (!t.data.refresh_token || !address) return back({ error: "no_refresh_token" });
  const ticket = b64(randomBytes(32));
  const payload = seal(JSON.stringify({ refreshToken: wrapToken(r.buyer_id, providerName, r.purpose, String(t.data.refresh_token)), address }), "ticket", `${r.buyer_id}:${sha256(ticket).toString("hex")}`);
  db().query("INSERT INTO broker_tickets (ticket_hash, buyer_id, challenge, payload, created_at) VALUES (?, ?, ?, ?, ?)").run(sha256(ticket), r.buyer_id, r.challenge, payload, now());
  return back({ code: ticket });
}

function redeem(buyerId: number, b: Record<string, unknown>): Response {
  const { ticket, verifier } = b;
  if (typeof ticket !== "string" || typeof verifier !== "string" || !B64.test(ticket) || !B64.test(verifier)) return json({ error: "bad request" }, 400);
  // Used up as it is read, whatever happens next.
  const r = db().query("DELETE FROM broker_tickets WHERE ticket_hash = ? RETURNING *").get(sha256(ticket)) as { buyer_id: number; challenge: string; payload: string; created_at: string } | null;
  if (!r || r.buyer_id !== buyerId || Date.now() - Date.parse(r.created_at) > TICKET_MS) return json({ error: "expired", message: "That sign-in took too long or was already used." }, 400);
  if (b64(createHash("sha256").update(verifier).digest()) !== r.challenge) return json({ error: "expired", message: "That sign-in took too long or was already used." }, 400);
  const plain = open(r.payload, "ticket", `${buyerId}:${sha256(ticket).toString("hex")}`);
  return plain ? json(JSON.parse(plain)) : json({ error: "expired" }, 400);
}

async function refresh(buyerId: number, b: Record<string, unknown>): Promise<Response> {
  const { provider, purpose, refreshToken } = b;
  if (!isProvider(provider) || !isPurpose(purpose) || typeof refreshToken !== "string" || refreshToken.length > 4000) return json({ error: "bad request" }, 400);
  // Not "offered" any more (switched off, or the agency's own app took over): existing connections keep refreshing while the app is set up.
  if (!client(provider)) return json({ error: "not_offered" }, 403);
  const real = unwrapToken(buyerId, provider, purpose, refreshToken);
  if (!real) return json({ error: "invalid_grant", message: "This connection isn't valid any more. Connect it again." }, 400);
  let t;
  try { t = await tokenCall(provider, { grant_type: "refresh_token", refresh_token: real, scope: BROKER_SCOPES[provider][purpose] }); }
  catch { return json({ error: "unavailable", message: "The sign-in service didn't answer." }, 502); }
  if (!t.ok) {
    // 400/401: the person revoked access or it lapsed. Anything else is the provider having a bad moment: try again later.
    const gone = t.status === 400 || t.status === 401;
    return json({ error: gone ? "invalid_grant" : "unavailable", message: String(t.data.error_description || t.data.error || `The sign-in service returned ${t.status}.`).slice(0, 300) }, gone ? 400 : 502);
  }
  const rotated = t.data.refresh_token && t.data.refresh_token !== real ? wrapToken(buyerId, provider, purpose, String(t.data.refresh_token)) : undefined;
  return json({ accessToken: String(t.data.access_token), expiresIn: Number(t.data.expires_in ?? 3600), ...(rotated ? { refreshToken: rotated } : {}) });
}
