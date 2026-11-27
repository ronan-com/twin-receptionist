// The hosted site: one small Bun process + SQLite. Pages are rendered in pages.ts and
// wizard.ts; static files come from a fixed in-memory list (no URL path reaches the disk).
//   GET  /                          overview + "Open my setup" box
//   GET/POST /start/<code>          a generic onboarding link: name + email, then their own private /setup/<code> (genericlink.ts)
//   POST /go                        code box -> /setup/<code>
//   GET  /setup/<code>[?step=x]     the buyer's setup wizard (the old /download/<code> redirects here)
//   GET  /setup/<code>/status       JSON for live progress (wizard.js)
//   POST /setup/<code>/a/<action>   every wizard form (same-origin + per-session CSRF token)
//   POST /setup/<code>/a/help-request  "I need a person": a help ticket for us (wizhelp.ts; same checks, 5 an hour)
//   POST /setup/<code>/chat         "Need help?" question (JSON; same checks; only when OPENROUTER_API_KEY is set)
//   POST /chat                      the same from the public /guide page (same-origin only; no code, so no setup context)
//   GET  /p/<droplet token>/next    the buyer's new server asks for work ("wait", "go ...", "stop")
//   GET  /p/<attempt token>/bundle  one-time app download for that install attempt
//   POST /p/<attempt token>/log     install output, in order (?offset=<bytes already sent>)
//   POST /p/<attempt token>/exit    install.sh finished (?code=<exit code>)
//   POST /api/sync                  the buyer's app sends its health snapshot (Bearer sync token; sync.ts)
//   POST /api/tickets               a help ticket from the agency's app; GET /api/tickets/updates: our replies (Bearer sync token; tickets.ts)
//   GET  /api/tls-allowed?domain=X  Caddy only: 200 for a host registered to a buyer (hosts.ts); a buyer's own domain serves their wizard at /
//   GET  /api/releases/latest       the newest app release, for an app updating itself (Bearer sync token; releases.ts)
//   GET  /api/releases/bundle/<v>   its source, only with a signed address that runs out in 10 minutes
//   GET  /guide /styles.css /favicon.svg /wizard.js /chat.js /chat.css /healthz
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANY_MOCK, CODE_RE, CONFIG, db, extractCode, findBuyer, productionGuard, siteUrlWarnings, type Buyer } from "./lib";
import { loadContent } from "./content";
import { chatEnabled, chatReply, parseChatBody } from "./chat";
import { badCodePage, demoOfflinePage, forbiddenPage, guidePage, homePage, limitedPage, notFoundPage, revokedPage } from "./pages";
import { actions, allow, appUrlOf, canView, firstOpen, pBundle, pExit, pLog, pNext, startTicker } from "./setup";
import { STEPS, csrfOk, getSetup, logRead, newSessionId, redact, secretValues, siteKey, updateSetup, type SetupData, type StepId } from "./store";
import { HELP_SENT, noteStepError, wizardHelpRequest } from "./wizhelp";
import { statusRev, wizardPage } from "./wizard";
import { adminRoute } from "./admin-web";
import { inactivePage, startRoute } from "./genericlink";
import { ticketsApi } from "./tickets";
import { brokerApi } from "./broker";
import { MAX_SYNC_BODY, bearerOf, buyerBySyncToken, ownerResetLink, receive } from "./sync";
import { appSource, bundleSignatureOk, latestRelease, signBundleUrl } from "./releases";
import { startAlerts } from "./alerts";
import { DEMO, DEMO_KEY, DemoOffline, demoBuyer, demoDashboard } from "./demo";
import { serveOwnHost, tlsAllowedResponse } from "./hosts";
import { consumeState, exchangeCode, isProvider, mockOAuthRoute, oauthEnabled, oauthStart, readBrowserCookie, type OAuthProvider } from "./oauth";
import { oauthComplete, oauthGuard, OAUTH_STEP } from "./setup";

if ((process.env.PREVIEW_JUMP || "").trim() === "1" && !ANY_MOCK) {
  console.error("PREVIEW_JUMP=1 is for test sites only and needs a MOCK_* switch on too. Refusing to start.");
  process.exit(1);
}
{ const g = productionGuard(); if (g) { console.error(g); process.exit(1); } }
for (const w of siteUrlWarnings()) console.warn(`WARNING: ${w}`);
db(); // create tables / folders on start
try { siteKey(); } catch (e) { console.error((e as Error).message); process.exit(1); }
const content = loadContent();
console.log(`content: ${[...content.values()].filter((h) => !h.placeholder).length} provider how-tos loaded (${[...content.values()].filter((h) => h.placeholder).length} placeholders)`);
{ const missing = [...content.values()].filter((h) => h.placeholder).map((h) => h.id); if (missing.length && !ANY_MOCK) console.warn(`WARNING: no how-to file for ${missing.join(", ")} (short built-in text is shown). Copy handoff-content/providers into download-site/content/providers before building.`); }

const ASSETS: Record<string, { body: Uint8Array; type: string }> = {
  "/styles.css": { body: readFileSync(join(import.meta.dir, "public/styles.css")), type: "text/css; charset=utf-8" },
  "/favicon.svg": { body: readFileSync(join(import.meta.dir, "public/favicon.svg")), type: "image/svg+xml" },
  "/wizard.js": { body: readFileSync(join(import.meta.dir, "public/wizard.js")), type: "text/javascript; charset=utf-8" },
  "/chat.js": { body: readFileSync(join(import.meta.dir, "public/chat.js")), type: "text/javascript; charset=utf-8" },
  "/chat.css": { body: readFileSync(join(import.meta.dir, "public/chat.css")), type: "text/css; charset=utf-8" },
  "/admin-live.js": { body: readFileSync(join(import.meta.dir, "public/admin-live.js")), type: "text/javascript; charset=utf-8" },
  "/tickets.css": { body: readFileSync(join(import.meta.dir, "public/tickets.css")), type: "text/css; charset=utf-8" },
  "/wizard.css": { body: readFileSync(join(import.meta.dir, "public/wizard.css")), type: "text/css; charset=utf-8" },
};
for (const w of [400, 500, 600, 700]) ASSETS[`/fonts/inter-latin-${w}-normal.woff2`] = { body: readFileSync(join(import.meta.dir, `public/fonts/inter-latin-${w}-normal.woff2`)), type: "font/woff2" };

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // Setup links carry the code: never send it to other sites. (Not "no-referrer": that makes
  // browsers send "Origin: null" on our own form posts, which the CSRF check needs.)
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
};
const respond = (body: BodyInit | null, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { ...SECURITY_HEADERS, ...headers } });
const html = (body: string, status = 200, extra: Record<string, string> = {}) => respond(body, status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extra });
const redirect = (to: string, extra: Record<string, string> = {}) => respond(null, 303, { Location: to, "Cache-Control": "no-store", ...extra });

// ---------------- rate limits per IP ----------------
const SITE_ORIGIN = new URL(CONFIG.siteUrl).origin;
const SECURE = SITE_ORIGIN.startsWith("https:");
function clientIp(req: Request, server: Bun.Server<unknown>): string {
  if (CONFIG.trustProxy) {
    const last = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return server.requestIP(req)?.address || "unknown";
}
const tooMany = (retry: number) => html(limitedPage(retry), 429, { "Retry-After": String(retry) });

// ---------------- sessions + CSRF ----------------
function cookie(req: Request, name: string) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]{16,64})`));
  return m ? m[1] : null;
}
function session(req: Request): { sid: string; set?: string } {
  const sid = cookie(req, "ws");
  if (sid) return { sid };
  const n = newSessionId();
  return { sid: n, set: `ws=${n}; Path=/setup/; HttpOnly; SameSite=Lax${SECURE ? "; Secure" : ""}; Max-Age=2592000` };
}
/**
 * POSTs must come from our own pages. "Our origin" is SITE_URL, or the address the browser
 * actually used: the Host header, or X-Forwarded-Host + X-Forwarded-Proto from a proxy or
 * tunnel in front of us. A browser on another site can't set any of those to our name, and
 * every POST also needs the session's CSRF token, so this stays safe when SITE_URL is wrong.
 */
const first = (v: string | null) => (v || "").split(",")[0].trim().toLowerCase();
function ownOrigins(req: Request): string[] {
  const out = [SITE_ORIGIN];
  const proto = new URL(req.url).protocol.replace(":", "");
  const fproto = first(req.headers.get("x-forwarded-proto"));
  const protos = [...new Set([proto, fproto === "http" || fproto === "https" ? fproto : "", req.headers.get("cf-visitor")?.includes('"https"') ? "https" : ""].filter(Boolean))];
  for (const h of [first(req.headers.get("x-forwarded-host")), first(req.headers.get("host"))]) {
    if (!h || !/^[a-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-f:.]+\](:\d{1,5})?$/.test(h)) continue;
    for (const p of protos) {
      out.push(`${p}://${h}`);
      // Default ports never appear in an Origin header.
      out.push(`${p}://${h.replace(p === "https" ? /:443$/ : /:80$/, "")}`);
    }
  }
  return out;
}
let warnedOrigin = false;
function sameOrigin(req: Request): boolean {
  const allowed = ownOrigins(req);
  const o = req.headers.get("origin");
  let got = "";
  if (o && o !== "null") got = o.toLowerCase();
  else {
    const sfs = req.headers.get("sec-fetch-site");
    if (sfs) return sfs === "same-origin";
    const ref = req.headers.get("referer");
    try { got = ref ? new URL(ref).origin.toLowerCase() : ""; } catch { got = ""; }
  }
  if (!got || !allowed.includes(got)) return false;
  if (got !== SITE_ORIGIN && !warnedOrigin) {
    warnedOrigin = true;
    console.warn(`WARNING: a form was posted from ${got}, but SITE_URL is ${SITE_ORIGIN}. Accepted it (same host). Set SITE_URL to the public address: setup links and new servers use it.`);
  }
  return true;
}

async function readForm(req: Request): Promise<Record<string, string> | null> {
  if (!(req.headers.get("content-type") || "").startsWith("application/x-www-form-urlencoded")) return {};
  if (Number(req.headers.get("content-length") || 0) > (DEMO ? 400 : 48) * 1024) return null;
  const text = await req.text();
  if (text.length > (DEMO ? 400 : 48) * 1024) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) if (!(k in out)) out[k] = v;
  return out;
}

function lookupBuyer(code: string, ip: string): { buyer?: Buyer; error?: Response } {
  const b = CODE_RE.test(code) ? findBuyer(code) : null;
  if (!b) {
    const retry = allow(`bad:${ip}`, CONFIG.lookupsPerMinute, 60_000);
    return { error: retry ? tooMany(retry) : html(badCodePage(), 404) };
  }
  if (b.revoked_at) return { error: html(b.style === "neutral" ? inactivePage("neutral") : revokedPage(), 410) };
  return { buyer: b };
}

const SETUP = /^\/setup\/([^/]*)\/?$/;
const STATUS = /^\/setup\/([^/]*)\/status$/;
const CHAT = /^\/setup\/([^/]*)\/chat$/;
const ACTION = /^\/setup\/([^/]*)\/a\/([a-z-]{2,40})$/;
const PROV = /^\/p\/([ad]_[A-Za-z0-9_-]{32})\/(next|bundle|log|exit)$/;
const OLD = /^\/download\/([^/]*)(?:\/.*)?$/;

async function handle(req: Request, srv: Bun.Server<unknown>): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const isGet = method === "GET" || method === "HEAD";

  // Caddy asks here before getting a certificate for a buyer's own domain (internal only), then their own domain serves their wizard (hosts.ts).
  if (path === "/api/tls-allowed") return tlsAllowedResponse(req, url);
  const own = await serveOwnHost(req, (r) => handle(r, srv));
  if (own) return own;

  if (isGet && path === "/") return html(homePage());
  if (isGet && path === "/guide") return html(guidePage(), 200, { "Cache-Control": "public, max-age=300" });
  if (isGet && path === "/healthz") return respond("ok", 200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  if (isGet && path === "/robots.txt") return respond("User-agent: *\nDisallow: /\n", 200, { "Content-Type": "text/plain" });
  if (isGet && ASSETS[path]) return respond(ASSETS[path].body, 200, { "Content-Type": ASSETS[path].type, "Cache-Control": "public, max-age=300" });

  const ip = clientIp(req, srv);
  const r0 = allow(`ip:${ip}`, CONFIG.requestsPerMinute, 60_000);
  if (r0) return tooMany(r0);

  // ---- "Login with Railway / Telnyx / OpenRouter" (oauth.ts). The fakes only answer when MOCK_OAUTH=1. ----
  if (path.startsWith("/__mock/oauth/")) { const r = await mockOAuthRoute(req, url); if (r) return r; return html(notFoundPage(), 404); }
  const os = isGet && path.match(/^\/setup\/([^/]*)\/oauth\/([a-z]+)$/);
  if (os) {
    const r = lookupBuyer(os[1], ip);
    if (r.error) return r.error;
    const b = r.buyer!;
    if (!isProvider(os[2]) || !oauthEnabled(os[2])) return html(notFoundPage(), 404);
    const p: OAuthProvider = os[2];
    const wait = allow(`oauthstart:${b.id}`, 20, 10 * 60_000);
    if (wait) return tooMany(wait);
    const step = OAUTH_STEP[p];
    if (oauthGuard(b, p)) return redirect(`/setup/${os[1]}`);
    try {
      const o = await oauthStart(b.id, p);
      return redirect(o.url, { "Set-Cookie": o.cookie });
    } catch (e) {
      console.error(`[oauth] start ${p}: ${(e as Error)?.message || "error"}`);
      updateSetup(b.id, (s) => { s.flash = { kind: "err", text: "That sign-in isn't available just now. Paste a key instead." }; });
      return redirect(`/setup/${os[1]}?step=${step}`);
    }
  }
  const oc = isGet && path.match(/^\/oauth\/([a-z]+)\/callback$/);
  if (oc) {
    if (!isProvider(oc[1])) return html(notFoundPage(), 404);
    const p: OAuthProvider = oc[1];
    const wait = allow(`oauthcb:${ip}`, 30, 10 * 60_000);
    if (wait) return tooMany(wait);
    const c = consumeState(p, url.searchParams.get("state") || "", readBrowserCookie(req));
    const clear = { "Set-Cookie": "ob=; Path=/oauth; HttpOnly; Max-Age=0" };
    if (!c.ok) return html(badCodePage(), 400, clear);
    const b = db().query("SELECT * FROM buyers WHERE id = ?").get(c.buyerId) as Buyer | null;
    if (!b || b.revoked_at) return html(badCodePage(), 404, clear);
    const step = OAUTH_STEP[p];
    const back = `/setup/${b.code}?step=${step}`;
    let flash: SetupData["flash"] | null = null;
    const before = getSetup(b.id).step;
    if (url.searchParams.get("error") || !url.searchParams.get("code")) flash = { kind: "err", text: "Sign-in was cancelled. Try again, or paste a key instead." };
    else {
      try { flash = await oauthComplete(b, p, await exchangeCode(p, url.searchParams.get("code")!, c.verifier)); }
      catch (e) { console.error(`[oauth] ${p}: ${(e as Error)?.message || "error"}`); flash = { kind: "err", text: "That sign-in didn't work. Try again, or paste a key instead." }; }
    }
    const after = updateSetup(b.id, (s) => { if (flash) s.flash = flash; });
    return redirect(after.step !== before ? `/setup/${b.code}` : back, clear);
  }

  // ---- team demo: a fresh start link, and the door into the real dashboard ----
  if (DEMO && isGet && DEMO_KEY && path === `/demo/${DEMO_KEY}`) return redirect(`/setup/${demoBuyer()}`);
  // The door into the demo dashboard: the global team demo, or a demo buyer once their install has finished.
  const dm = isGet && path.match(/^\/setup\/([^/]*)\/open$/);
  if (dm && (DEMO || CODE_RE.test(dm[1]))) {
    const r = lookupBuyer(dm[1], ip);
    if (r.error) return r.error;
    const b = r.buyer!;
    if (!DEMO && b.demo !== 1) return html(notFoundPage(), 404);
    const s = getSetup(b.id);
    if (!s.brand || (b.demo === 1 && s.phase !== "done")) return redirect(`/setup/${dm[1]}`);
    try {
      return redirect(await demoDashboard(b.demo === 1 ? b.code : String(b.id), s.brand.productName, s.brand.ownerEmail, s.brand.logo, s.brand.colour));
    } catch (e) {
      if (e instanceof DemoOffline) return html(demoOfflinePage(`/setup/${dm[1]}`), 503);
      throw e;
    }
  }

  // ---- the shared Google / Microsoft sign-in for agencies (broker.ts). Answers 404 unless OAUTH_BROKER=1. ----
  if (path.startsWith("/api/broker/") || path.startsWith("/oauth/broker/")) { const r = await brokerApi(req, url, ip, allow); if (r) return respond(r.body, r.status, Object.fromEntries(r.headers)); }

  // ---- the buyer's app reporting its health: counts only, token auth, rate-limited ----
  if (path === "/api/sync") {
    const json = (o: unknown, status = 200, h: Record<string, string> = {}) => respond(JSON.stringify(o), status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...h });
    if (method !== "POST") return json({ error: "POST only" }, 405, { Allow: "POST" });
    const tok = bearerOf(req);
    const buyerId = buyerBySyncToken(tok);
    if (buyerId == null) {
      const retry = allow(`syncbad:${ip}`, 30, 10 * 60_000);
      return retry ? json({ error: "too many tries" }, 429, { "Retry-After": String(retry) }) : json({ error: "unauthorised" }, 401);
    }
    const retry = allow(`sync:${buyerId}`, 20, 15 * 60_000);
    if (retry) return json({ error: "too many requests" }, 429, { "Retry-After": String(retry) });
    if (Number(req.headers.get("content-length") || 0) > MAX_SYNC_BODY) return json({ error: "too large" }, 413);
    const r = receive(tok, (await req.text()).slice(0, MAX_SYNC_BODY + 1));
    return json(r.body, r.status);
  }

  // ---- the app's help tickets, and our replies back (Bearer sync token; tickets.ts) ----
  if (path === "/api/tickets" || path === "/api/tickets/updates") { const r = (await ticketsApi(req, url, ip))!; return respond(r.body, r.status, Object.fromEntries(r.headers)); }

  // ---- an app updating itself (the buyer's Settings, "Updates"): what's newest, and the bundle by a signed address ----
  if (path === "/api/releases/latest" || path.startsWith("/api/releases/bundle/")) {
    const json = (o: unknown, status = 200, h: Record<string, string> = {}) => respond(JSON.stringify(o), status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...h });
    if (!isGet) return json({ error: "GET only" }, 405, { Allow: "GET" });
    if (path === "/api/releases/latest") {
      const buyerId = buyerBySyncToken(bearerOf(req));
      if (buyerId == null) {
        const retry = allow(`relbad:${ip}`, 30, 10 * 60_000);
        return retry ? json({ error: "too many tries" }, 429, { "Retry-After": String(retry) }) : json({ error: "unauthorised" }, 401);
      }
      const retry = allow(`rel:${buyerId}`, 30, 60 * 60_000);
      if (retry) return json({ error: "too many requests" }, 429, { "Retry-After": String(retry) });
      const rel = await latestRelease();
      if (!rel) return json({ error: "no release" }, 404);
      const signed = signBundleUrl(buyerId, rel.version);
      return json({ version: rel.version, notes: rel.notes, sha256: rel.sha256, size: rel.size, bundleUrl: signed.url, expiresAt: signed.expiresAt });
    }
    const bm = path.match(/^\/api\/releases\/bundle\/([A-Za-z0-9._+-]{1,40})$/);
    const buyerId = Number(url.searchParams.get("b"));
    const retry = allow(`relbundle:${ip}`, 20, 60 * 60_000);
    if (retry) return json({ error: "too many requests" }, 429, { "Retry-After": String(retry) });
    if (!bm || !Number.isInteger(buyerId) || !bundleSignatureOk(buyerId, bm[1], url.searchParams.get("exp") || "", url.searchParams.get("sig") || "")) return json({ error: "expired or invalid" }, 403);
    const buyer = db().query("SELECT revoked_at FROM buyers WHERE id = ?").get(buyerId) as { revoked_at: string | null } | null;
    const rel = await latestRelease();
    if (!buyer || buyer.revoked_at || !rel || rel.version !== bm[1]) return json({ error: "not found" }, 404);
    console.log(`[release] buyer ${buyerId} downloaded ${rel.version}`);
    return respond(await appSource(), 200, { "Content-Type": "application/gzip", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="app-${rel.version}.tgz"` });
  }

  // ---- our admin dashboard ----
  if (path === "/admin" || path.startsWith("/admin/")) return adminRoute(req, url, { ip, sameOrigin, readForm, html, redirect });

  // ---- the buyer's server calling in ----
  let m = path.match(PROV);
  if (m) {
    const [, tok, what] = m;
    if (what === "next" && isGet && tok.startsWith("d_")) return pNext(tok);
    if (what === "bundle" && isGet && tok.startsWith("a_")) return pBundle(tok);
    if (what === "log" && method === "POST" && tok.startsWith("a_")) return pLog(tok, Number(url.searchParams.get("offset") ?? -1), req);
    if (what === "exit" && method === "POST" && tok.startsWith("a_")) return pExit(tok, Number(url.searchParams.get("code") ?? 1));
    return respond("no\n", 405);
  }
  if (path.startsWith("/p/")) {
    const retry = allow(`bad:${ip}`, CONFIG.lookupsPerMinute, 60_000);
    return retry ? tooMany(retry) : respond("stop\n", 404, { "Content-Type": "text/plain" });
  }

  // ---- a generic onboarding link: anyone with it can start their own agency (genericlink.ts) ----
  const sm = path.match(/^\/start\/([^/]*)\/?$/);
  if (sm) {
    if (!isGet && method !== "POST") return respond("no\n", 405, { Allow: "GET, POST" });
    return startRoute(req, sm[1], { ip, sameOrigin, readForm, html, redirect, secure: SECURE });
  }
  if (path === "/start" || path.startsWith("/start/")) return html(inactivePage(), 404);

  if (path === "/go") {
    if (method !== "POST") return redirect("/#code");
    const raw = (await readForm(req))?.code || "";
    const code = extractCode(raw);
    if (!code || !findBuyer(code)) {
      const retry = allow(`bad:${ip}`, CONFIG.lookupsPerMinute, 60_000);
      if (retry) return tooMany(retry);
      return html(homePage("We couldn't find that code. Check you copied the whole link from your purchase email.", raw.slice(0, 300)), 404);
    }
    return redirect(`/setup/${code}`);
  }

  // ---- the help chat: JSON in, JSON out. Off (404) unless OPENROUTER_API_KEY is set. ----
  const cm = method === "POST" && (path === "/chat" ? [path, ""] : path.match(CHAT));
  if (cm) {
    const json = (o: unknown, status = 200, h: Record<string, string> = {}) => respond(JSON.stringify(o), status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...h });
    if (!chatEnabled()) return json({ error: "Help chat is off." }, 404);
    const code = cm[1];
    let b: Buyer | undefined;
    if (code) {
      const r = lookupBuyer(code, ip);
      if (r.error) return r.error;
      b = r.buyer!;
    }
    if (!(req.headers.get("content-type") || "").startsWith("application/json")) return json({ error: "That didn't look right. Reload the page and try again." }, 415);
    if (Number(req.headers.get("content-length") || 0) > 16 * 1024) return json({ error: "That was too long." }, 413);
    const text = await req.text();
    if (text.length > 16 * 1024) return json({ error: "That was too long." }, 413);
    const body = parseChatBody(text);
    const sid = cookie(req, "ws");
    if (!sameOrigin(req) || (b && (!sid || !csrfOk(sid, code, body.t)))) return json({ error: "Please reload the page and try again." }, 403);
    if (!body.ok) return json({ error: body.error }, 400);
    const wait = (b ? allow(`chat:${b.id}`, 15, 10 * 60_000) : 0) || allow(`chatip:${ip}`, 30, 10 * 60_000) || allow("chat:all", 3000, 24 * 3600_000);
    if (wait) return json({ error: `You've asked a lot in a short time. Please wait ${wait > 90 ? `${Math.ceil(wait / 60)} minutes` : `${wait} seconds`} and try again.` }, 429, { "Retry-After": String(wait) });
    const r = await chatReply(body.messages, b ? { buyer: b, setup: getSetup(b.id), view: body.view } : {});
    return r.ok ? json({ reply: r.reply }) : json({ error: r.error }, r.status);
  }

  // Old links from earlier emails keep working.
  m = path.match(OLD);
  if (m && isGet) return CODE_RE.test(m[1]) ? respond(null, 308, { Location: `/setup/${m[1]}` }) : html(badCodePage(), 404);

  m = path.match(SETUP);
  if (m && isGet) {
    const r = lookupBuyer(m[1], ip);
    if (r.error) return r.error;
    const b = r.buyer!;
    const sess = session(req);
    let s = getSetup(b.id);
    const flash = s.flash;
    if (flash) s = updateSetup(b.id, (x) => { delete x.flash; });
    const want = url.searchParams.get("step") as StepId | null;
    let view: StepId = s.phase === "done" ? "done" : want && STEPS.includes(want) && canView(b, s, want) ? want : s.step;
    if (!canView(b, s, view)) view = firstOpen(b, s);
    return html(wizardPage(b, s, m[1], sess.sid, view, flash), 200, sess.set ? { "Set-Cookie": sess.set } : {});
  }

  m = path.match(STATUS);
  if (m && isGet) {
    const r = lookupBuyer(m[1], ip);
    if (r.error) return respond(JSON.stringify({ error: "gone" }), 404, { "Content-Type": "application/json" });
    const s = getSetup(r.buyer!.id);
    const from = Number(url.searchParams.get("from") || 0) || 0;
    const log = logRead(r.buyer!.id, from);
    return respond(JSON.stringify({ rev: statusRev({ b: r.buyer!, s }), phase: s.phase, step: s.step, log: log.text.slice(-60000), next: log.next }), 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  }

  m = path.match(ACTION);
  if (m) {
    if (method !== "POST") return redirect(`/setup/${m[1]}`);
    const r = lookupBuyer(m[1], ip);
    if (r.error) return r.error;
    const b = r.buyer!;
    const sid = cookie(req, "ws");
    const f = await readForm(req);
    if (!f) return respond("Too large", 413);
    if (!sameOrigin(req) || !sid || !csrfOk(sid, m[1], f.t || "")) return html(forbiddenPage(), 403);
    // "Locked out? Reset your owner password": the one-time link is shown on this response only, never saved.
    if (m[2] === "owner-reset") {
      const s0 = getSetup(b.id);
      const wait = allow(`ownerreset:${b.id}`, 5, 10 * 60_000);
      const r = s0.phase !== "done" ? null : wait ? null : await ownerResetLink(b.id, appUrlOf(s0));
      const flash = !r
        ? { kind: "err" as const, text: wait ? `That was a lot of tries. Wait ${Math.ceil(wait / 60)} minutes and try again.` : "Your agency isn't finished yet." }
        : r.ok
          ? { kind: "ok" as const, text: `Here is your reset link. It works once and runs out in ${r.minutes} minutes. Your agency records this in its audit log.`, link: r.url }
          : { kind: "err" as const, text: r.message };
      console.log(`[owner-reset] buyer ${b.id}: ${r ? (r.ok ? "link issued" : r.reason) : "not allowed"}`);
      return html(wizardPage(b, getSetup(b.id), m[1], sid, "done", flash));
    }
    // "I need a person" (wizhelp.ts): a help ticket for us, and back to the same step with a confirmation.
    if (m[2] === "help-request") {
      const r0 = wizardHelpRequest(b, getSetup(b.id), f, req.headers.get("user-agent") || "", m[1]);
      updateSetup(b.id, (s) => { s.flash = r0.ok ? { kind: "ok", text: HELP_SENT } : { kind: "err", text: r0.message }; });
      const v0 = STEPS.includes(f.v as StepId) ? f.v : "";
      return redirect(`/setup/${m[1]}${v0 ? `?step=${v0}` : ""}#person`);
    }
    const act = actions[m[2]];
    if (!act) return html(notFoundPage(), 404);
    const before = getSetup(b.id).step;
    let flash = null;
    try {
      flash = await act(b, f);
    } catch (e) {
      console.error(`[action] ${m[2]} for buyer ${b.id}: ${(e as Error)?.name || "error"}`);
      flash = { kind: "err" as const, text: "Something went wrong on our side. Please try again." };
    }
    const view = STEPS.includes(f.v as StepId) ? f.v : "";
    const after = updateSetup(b.id, (s) => {
      if (flash) { if (flash.form) for (const k of Object.keys(flash.form)) if (/token|key|pass|secret|^t$/i.test(k)) delete flash.form[k]; s.flash = flash; }
      // Kept so "I need a person" can tell us what went wrong on this step.
      if (flash?.kind === "err" && view) noteStepError(s, view as StepId, redact(flash.text, secretValues(b.id)));
    });
    return redirect(after.step !== before || !view ? `/setup/${m[1]}` : `/setup/${m[1]}?step=${view}`);
  }

  if (path.startsWith("/setup/") || path === "/setup") {
    const retry = allow(`bad:${ip}`, CONFIG.lookupsPerMinute, 60_000);
    return retry ? tooMany(retry) : html(badCodePage(), 404);
  }
  return html(notFoundPage(), 404);
}

const opts = {
  port: CONFIG.port,
  maxRequestBodySize: 3 * 1024 * 1024, // 128 KB is plenty for every route except /api/tickets (a screenshot of up to 2 MB); each route checks its own size
  development: false,
  idleTimeout: 60,
  fetch: handle,
  error(e: Error) {
    console.error(`[server] ${e?.name || "error"}`); // never the message: it could quote a request
    return new Response("Something went wrong.", { status: 500, headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain" } });
  },
};
const server = Bun.serve({ ...opts, hostname: CONFIG.host });
if (CONFIG.extraListen) {
  // Test mode: also listen where the fake droplets can reach us (their network's gateway).
  const [h, p] = CONFIG.extraListen.split(":");
  Bun.serve({ ...opts, hostname: h, port: Number(p || CONFIG.port) });
}
startTicker();
startAlerts();

console.log(`AI agency setup site on http://${server.hostname}:${server.port}${CONFIG.extraListen ? ` and ${CONFIG.extraListen}` : ""}  data: ${CONFIG.dataDir}`);
if (ANY_MOCK) console.log(`TEST MODE: ${Object.entries({ PREVIEW_JUMP: CONFIG.previewJump, MOCK_RAILWAY: CONFIG.mockRailway, MOCK_DO: CONFIG.mockDO, MOCK_CF: CONFIG.mockCF, MOCK_RESEND: CONFIG.mockResend, MOCK_TELNYX: CONFIG.mockTelnyx, MOCK_OAUTH: CONFIG.mockOAuth }).filter(([, v]) => v).map(([k]) => k).join(" ")} (fake providers; nothing real is called)`);
