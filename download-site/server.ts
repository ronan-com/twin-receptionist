// The hosted site: one small Bun process + SQLite. Pages are rendered in pages.ts and
// wizard.ts; static files come from a fixed in-memory list (no URL path reaches the disk).
//   GET  /                          overview + "Open my setup" box
//   POST /go                        code box -> /setup/<code>
//   GET  /setup/<code>[?step=x]     the buyer's setup wizard (the old /download/<code> redirects here)
//   GET  /setup/<code>/status       JSON for live progress (wizard.js)
//   POST /setup/<code>/a/<action>   every wizard form (same-origin + per-session CSRF token)
//   GET  /p/<droplet token>/next    the buyer's new server asks for work ("wait", "go ...", "stop")
//   GET  /p/<attempt token>/bundle  one-time app download for that install attempt
//   POST /p/<attempt token>/log     install output, in order (?offset=<bytes already sent>)
//   POST /p/<attempt token>/exit    install.sh finished (?code=<exit code>)
//   GET  /guide /styles.css /favicon.svg /wizard.js /healthz
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANY_MOCK, CODE_RE, CONFIG, db, extractCode, findBuyer, productionGuard, siteUrlWarnings, type Buyer } from "./lib";
import { loadContent } from "./content";
import { badCodePage, forbiddenPage, guidePage, homePage, limitedPage, notFoundPage, revokedPage } from "./pages";
import { actions, allow, canView, firstOpen, pBundle, pExit, pLog, pNext, startTicker } from "./setup";
import { STEPS, csrfOk, getSetup, logRead, newSessionId, siteKey, updateSetup, type StepId } from "./store";
import { statusRev, wizardPage } from "./wizard";
import { adminRoute } from "./admin-web";
import { DEMO, DEMO_KEY, demoBuyer, demoDashboard } from "./demo";

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
function clientIp(req: Request, server: Bun.Server): string {
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
  if (b.revoked_at) return { error: html(revokedPage(), 410) };
  return { buyer: b };
}

const SETUP = /^\/setup\/([^/]*)\/?$/;
const STATUS = /^\/setup\/([^/]*)\/status$/;
const ACTION = /^\/setup\/([^/]*)\/a\/([a-z-]{2,40})$/;
const PROV = /^\/p\/([ad]_[A-Za-z0-9_-]{32})\/(next|bundle|log|exit)$/;
const OLD = /^\/download\/([^/]*)(?:\/.*)?$/;

async function handle(req: Request, srv: Bun.Server): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const isGet = method === "GET" || method === "HEAD";

  if (isGet && path === "/") return html(homePage());
  if (isGet && path === "/guide") return html(guidePage(), 200, { "Cache-Control": "public, max-age=300" });
  if (isGet && path === "/healthz") return respond("ok", 200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  if (isGet && path === "/robots.txt") return respond("User-agent: *\nDisallow: /\n", 200, { "Content-Type": "text/plain" });
  if (isGet && ASSETS[path]) return respond(ASSETS[path].body, 200, { "Content-Type": ASSETS[path].type, "Cache-Control": "public, max-age=300" });

  const ip = clientIp(req, srv);
  const r0 = allow(`ip:${ip}`, CONFIG.requestsPerMinute, 60_000);
  if (r0) return tooMany(r0);

  // ---- team demo: a fresh start link, and the door into the real dashboard ----
  if (DEMO && isGet && DEMO_KEY && path === `/demo/${DEMO_KEY}`) return redirect(`/setup/${demoBuyer()}`);
  const dm = DEMO && isGet && path.match(/^\/setup\/([^/]*)\/open$/);
  if (dm) {
    const r = lookupBuyer(dm[1], ip);
    if (r.error) return r.error;
    const s = getSetup(r.buyer!.id);
    if (!s.brand) return redirect(`/setup/${dm[1]}`);
    return redirect(await demoDashboard(r.buyer!.id, s.brand.productName, s.brand.ownerEmail, s.brand.logo, s.brand.colour));
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
    const after = updateSetup(b.id, (s) => { if (flash) { if (flash.form) for (const k of Object.keys(flash.form)) if (/token|key|pass|secret|^t$/i.test(k)) delete flash.form[k]; s.flash = flash; } });
    const view = STEPS.includes(f.v as StepId) ? f.v : "";
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
  maxRequestBodySize: 128 * 1024,
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

console.log(`Setup site for ${CONFIG.productName} (${CONFIG.sellerName}) on http://${server.hostname}:${server.port}${CONFIG.extraListen ? ` and ${CONFIG.extraListen}` : ""}  data: ${CONFIG.dataDir}`);
if (ANY_MOCK) console.log(`TEST MODE: ${Object.entries({ PREVIEW_JUMP: CONFIG.previewJump, MOCK_RAILWAY: CONFIG.mockRailway, MOCK_DO: CONFIG.mockDO, MOCK_CF: CONFIG.mockCF, MOCK_RESEND: CONFIG.mockResend, MOCK_TELNYX: CONFIG.mockTelnyx, MOCK_OAUTH: CONFIG.mockOAuth }).filter(([, v]) => v).map(([k]) => k).join(" ")} (fake providers; nothing real is called)`);
