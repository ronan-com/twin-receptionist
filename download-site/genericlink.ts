// Onboarding links that anyone can open: ONE reusable address (a "generic link") that starts a new agency for whoever
// opens it, as an alternative to the private /setup/<code> link our admin makes for one named person.
//   GET  /start/<code>   a short form (name, email); opens the visitor's own private setup if this browser already started
//   POST /start/<code>   makes a normal agency record (marked with this link), then sends them to their private /setup/<code>
// From then on everything is exactly the normal wizard. Every link is generic: no product or company name of ours shows
// anywhere (the buyer's own brand name once they enter it). The old "style" column is kept but is always "neutral".
// Safety: per-IP sign-up limit, a hidden honeypot field, a minimum time to fill the form, the same same-origin + per-browser
// CSRF checks as the wizard, an email format check and length limits. A visitor never learns about other agencies: an email
// that already started here is only ever sent back to its own private link by the cookie that browser holds, or by email.
import { mailDeps, siteMailConfigured, htmlMail, mailFrom } from "./mailer";
import { CONFIG, addBuyer, asStyle, db, findBuyer, hashCode, newCode, now, CODE_RE, type Buyer, type Style } from "./lib";
import { allow } from "./setup";
import { esc } from "./pages";
import { logSupport } from "./sync";
import { csrfOk, csrfToken, newSessionId } from "./store";
import { startShell } from "./wizard";
import { dashboardPreview } from "./dashboard-preview";

export interface GenericLink {
  id: number;
  code: string;
  label: string;
  style: Style;
  enabled: number;
  cap: number | null;
  started: number;
  created_at: string;
  rotated_at: string | null;
}

export const linkUrl = (l: Pick<GenericLink, "code">) => `${CONFIG.siteUrl}/start/${l.code}`;
export const isActive = (l: GenericLink) => !!l.enabled && (l.cap == null || l.started < l.cap);
export const listLinks = () => db().query("SELECT * FROM generic_links ORDER BY id").all() as GenericLink[];
export const linkById = (id: number) => db().query("SELECT * FROM generic_links WHERE id = ?").get(id) as GenericLink | null;
export function linkByCode(code: string): GenericLink | null {
  if (!CODE_RE.test(code)) return null;
  return (db().query("SELECT * FROM generic_links WHERE code_hash = ?").get(hashCode(code)) as GenericLink | null) ?? null;
}

const cleanLabel = (v: unknown) => String(v ?? "").trim().replace(/[\r\n\t]+/g, " ").slice(0, 60);
/** "" or "0" means no cap; otherwise a whole number up to 100,000. null = invalid. */
function parseCap(v: unknown): number | null | undefined {
  const t = String(v ?? "").trim();
  if (!t || t === "0") return null;
  return /^\d{1,6}$/.test(t) && Number(t) <= 100_000 ? Number(t) : undefined;
}

export function createLink(admin: string, label: unknown, style: unknown, capIn: unknown): GenericLink | null {
  const cap = parseCap(capIn);
  if (cap === undefined) return null;
  const code = newCode();
  const lab = cleanLabel(label);
  const r = db().query("INSERT INTO generic_links (code, code_hash, label, style, enabled, cap, started, created_at) VALUES (?, ?, ?, ?, 1, ?, 0, ?)").run(code, hashCode(code), lab, asStyle(style), cap, now());
  const l = linkById(Number(r.lastInsertRowid))!;
  logSupport(0, admin, "onboarding-link-created", `#${l.id} ${lab} (${l.style})`);
  console.log(`[admin] ${admin} created onboarding link ${l.id}`);
  return l;
}
export function saveLink(admin: string, id: number, label: unknown, style: unknown, capIn: unknown): boolean {
  const cap = parseCap(capIn);
  if (cap === undefined || !linkById(id)) return false;
  db().query("UPDATE generic_links SET label = ?, style = ?, cap = ? WHERE id = ?").run(cleanLabel(label), asStyle(style), cap, id);
  logSupport(0, admin, "onboarding-link-saved", `#${id}`);
  return true;
}
export function toggleLink(admin: string, id: number): boolean | null {
  const l = linkById(id);
  if (!l) return null;
  const on = l.enabled ? 0 : 1;
  db().query("UPDATE generic_links SET enabled = ? WHERE id = ?").run(on, id);
  logSupport(0, admin, on ? "onboarding-link-on" : "onboarding-link-off", `#${id}`);
  return !!on;
}
/** A new address; the old one stops working at once. Agencies already started keep their own private links. */
export function rotateLink(admin: string, id: number): boolean {
  if (!linkById(id)) return false;
  const code = newCode();
  db().query("UPDATE generic_links SET code = ?, code_hash = ?, rotated_at = ? WHERE id = ?").run(code, hashCode(code), now(), id);
  logSupport(0, admin, "onboarding-link-rotated", `#${id}`);
  return true;
}

// ---------------- admin panel ----------------
interface PanelHelpers { hiddenT: (sid: string) => string; copyBtn: (v: string) => string }
/** The onboarding link panel at the top of the Agencies page: each link with on/off, the address with Copy, and "Make a new link". */
export function linksPanel(sid: string, h: PanelHelpers): string {
  const T = h.hiddenT(sid);
  const links = listLinks();
  const rows = links.map((l) => {
    const url = linkUrl(l);
    const name = l.label || "Onboarding link";
    return `<div class="linkblock" data-link="${l.id}">
<div class="titlerow"><b>${esc(name)}</b> ${l.enabled ? `<span class="pill live">On</span>` : `<span class="pill">Off</span>`} <span class="hint">${l.started} started</span>
<form method="post" action="/admin/links/${l.id}/toggle">${T}<button class="btn ${l.enabled ? "o" : "p"}" type="submit">${l.enabled ? "Turn off" : "Turn on"}</button></form></div>
${l.enabled ? `<div class="linkrow"><code${l.id === links[0]?.id ? ' id="neutral-link"' : ""}>${esc(url)}</code>${h.copyBtn(url)}</div>
<form method="post" action="/admin/links/${l.id}/rotate">${T}<button class="btn o" type="submit" data-confirm="Make a new address for this link? Its old address stops working straight away. Other links are not affected. People who already started keep their own private links.">New address for this link</button></form>` : ""}
</div>`;
  }).join("\n");
  return `<section class="card" id="onboarding-link">
<h2>Onboarding links</h2>
<p class="lead">Reusable addresses anyone can open to start their own onboarding; each person then gets their own private setup link. Make as many as you like (one per post, list or partner); they all work at the same time. For one known agency, use Add an agency below instead.</p>
${rows || '<p class="hint">No links yet.</p>'}
<form method="post" action="/admin/links/add" class="linkadd">${T}
<label>Label <input name="label" maxlength="60" placeholder="e.g. Facebook post, Jesse's list"></label>
<button class="btn p" type="submit">Add a link</button>
</form>
</section>`;
}

// ---------------- the visitor's side ----------------
export interface StartCtx {
  ip: string;
  sameOrigin: (req: Request) => boolean;
  readForm: (req: Request) => Promise<Record<string, string> | null>;
  html: (body: string, status?: number, extra?: Record<string, string>) => Response;
  redirect: (to: string, extra?: Record<string, string>) => Response;
  secure: boolean;
}
const envInt = (k: string, d: number) => { const n = Number.parseInt(process.env[k] || "", 10); return Number.isFinite(n) && n >= 0 ? n : d; };
const perHour = () => envInt("GENERIC_SIGNUPS_PER_HOUR", 5);
const minSeconds = () => envInt("GENERIC_MIN_SECONDS", 2);
const MAX_AGE_MS = 6 * 3600_000;

const ck = (req: Request, name: string) => (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]{16,64})`))?.[1] ?? null;
const tsToken = (gf: string, code: string, ms: number) => `${ms}.${csrfToken(gf, `ts:${code}:${ms}`)}`;
/** The age of the form in ms, or null if the token isn't ours for this browser and link. */
function tsAge(gf: string, code: string, tok: string): number | null {
  const [ms, sig] = String(tok || "").split(".");
  if (!/^\d{10,16}$/.test(ms || "") || !sig || !csrfOk(gf, `ts:${code}:${ms}`, sig)) return null;
  return Date.now() - Number(ms);
}
const isEmail = (v: string) => v.length <= 200 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v);
const note = (kind: "err" | "info" | "ok", text: string) => `<div class="notice ${kind}"><div>${esc(text)}</div></div>`;

const heading = (_style?: Style) => "Start your AI receptionist agency";
function formPage(l: GenericLink, gf: string, c: { error?: string; name?: string; email?: string } = {}) {
  const t = csrfToken(gf, `start:${l.code}`);
  return startShell(l.style, heading(l.style), `
<h1>${esc(heading(l.style))}</h1>
<p class="lead">Tell us who you are and we'll open your own private setup page. It takes about 15 minutes, and you can close it and come back whenever you like.</p>
${c.error ? note("err", c.error) : ""}
<form method="post" action="/start/${esc(l.code)}" class="body" autocomplete="on">
  <input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="ts" value="${esc(tsToken(gf, l.code, Date.now()))}">
  <div class="sr" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off" value=""></label></div>
  <label class="f" for="sname">Your name</label>
  <input id="sname" name="name" required maxlength="120" autocomplete="name" value="${esc(c.name || "")}">
  <label class="f" for="semail">Your email</label>
  <input id="semail" name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(c.email || "")}">
  <p class="hint">We use it to send your owner login later, and so you can pick up where you left off.</p>
  <div class="nav"><span></span><div class="right"><a class="btn o" href="/start/${esc(l.code)}?preview=dashboard">Preview your dashboard</a><button class="btn p" type="submit">Continue</button></div></div>
</form>`);
}
export function inactivePage(style: Style = "neutral") {
  return startShell(style, "This link isn't active", `<h1>This link isn't active</h1><p class="lead">Ask your provider for a new one.</p>`);
}
const messagePage = (style: Style, title: string, text: string) => startShell(style, title, `<h1>${esc(title)}</h1><p class="lead">${esc(text)}</p>`);

const gsCookie = (code: string, secure: boolean) => `gs=${code}; Path=/start; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=${30 * 86400}`;

/** Emails a person their own private link, when this site can send email (SITE_SMTP_URL). Returns false if it can't. */
export const resumeEmailConfigured = siteMailConfigured;
async function sendResume(b: Buyer): Promise<boolean> {
  if (!resumeEmailConfigured()) return false;
  const link = `${CONFIG.siteUrl}/setup/${b.code}`;
  const text = `Hi ${b.name.split(/\s+/)[0] || b.name},\n\nHere is your private setup link:\n\n${link}\n\nIt's just for you, so please don't share it.`;
  try {
    await mailDeps.deliver((process.env.SITE_SMTP_URL || "").trim(), { from: mailFrom(), to: b.email, subject: "Your private setup link", text, html: htmlMail(text, { label: "Continue setup", url: link }) });
    return true;
  } catch (e: any) {
    console.error(`[start] resume email failed: ${e?.code || e?.name || "error"}`);
    return false;
  }
}

export async function startRoute(req: Request, code: string, c: StartCtx): Promise<Response> {
  const link = linkByCode(code);
  const post = req.method === "POST";
  if (!link) {
    const wait = allow(`bad:${c.ip}`, CONFIG.lookupsPerMinute, 60_000);
    return c.html(inactivePage("neutral"), wait ? 429 : 404, wait ? { "Retry-After": String(wait) } : {});
  }
  const style = link.style;

  // Same browser as before: straight back to their own private setup.
  const had = ck(req, "gs");
  const mine = had && CODE_RE.test(had) ? findBuyer(had) : null;
  const resume = mine && !mine.revoked_at && mine.demo !== 1 ? mine : null;

  if (!post) {
    const url = new URL(req.url);
    const preview = url.searchParams.get("preview") === "dashboard";
    if (resume) return c.redirect(`/setup/${resume.code}${preview ? "?preview=dashboard" : ""}`);
    if (!isActive(link)) return c.html(inactivePage(style), 410);
    if (preview) return c.html(dashboardPreview(`/start/${link.code}`, url.searchParams.get("section")));
    const have = ck(req, "gf");
    const gf = have || newSessionId();
    return c.html(formPage(link, gf), 200, have ? {} : { "Set-Cookie": `gf=${gf}; Path=/start; HttpOnly; SameSite=Lax${c.secure ? "; Secure" : ""}; Max-Age=7200` });
  }

  // ---- POST ----
  const f = await c.readForm(req);
  const gf = ck(req, "gf");
  if (!f) return c.html(messagePage(style, "That was too much", "Please go back and try again."), 413);
  if (!c.sameOrigin(req) || !gf || !csrfOk(gf, `start:${link.code}`, f.t || "")) return c.html(messagePage(style, "Please reload the page", "Your form expired, so we didn't act on it. Reload the page and try again."), 403);
  // A bot filled the hidden field: act as if nothing happened and make nothing.
  if ((f.website || "").trim()) { console.log(`[start] honeypot hit from ${c.ip}`); return c.redirect("/"); }
  if (resume) return c.redirect(`/setup/${resume.code}`, { "Set-Cookie": gsCookie(resume.code, c.secure) });
  if (!isActive(link)) return c.html(inactivePage(style), 410);

  const name = String(f.name || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, 120);
  const email = String(f.email || "").trim().toLowerCase().slice(0, 200);
  const keep = { name, email };
  const age = tsAge(gf, link.code, f.ts || "");
  if (age == null) return c.html(formPage(link, gf, { ...keep, error: "Please try that again." }), 400);
  if (age < minSeconds() * 1000) return c.html(formPage(link, gf, { ...keep, error: "That was very quick. Check your details and press Continue again." }), 429);
  if (age > MAX_AGE_MS) return c.html(formPage(link, gf, { ...keep, error: "That page was open for a while. Check your details and press Continue again." }), 200);
  if (!name || !isEmail(email)) return c.html(formPage(link, gf, { ...keep, error: "Please give your name and a real email address." }), 400);

  // Someone already started from this link with this email: never reveal anything about them.
  const dup = db().query("SELECT * FROM buyers WHERE source_link = ? AND lower(email) = ? ORDER BY id LIMIT 1").get(link.id, email) as Buyer | null;
  if (dup) {
    const wait = allow(`startdup:${c.ip}`, 10, 3600_000);
    if (wait) return c.html(messagePage(style, "Too many tries", "Please wait a while and try again."), 429, { "Retry-After": String(wait) });
    let sent = false;
    if (!dup.revoked_at && resumeEmailConfigured() && !allow(`startmail:${email}`, 3, 3600_000)) sent = await sendResume(dup);
    return c.html(messagePage(style, "You've already started", sent ? "We've sent your private setup link to that email address. Open it to carry on." : "Use the private link you were given, or ask your provider."), 200);
  }

  const wait = allow(`gensignup:${c.ip}`, perHour(), 3600_000) || allow(`gensignup:all:${link.id}`, 300, 24 * 3600_000);
  if (wait) return c.html(messagePage(style, "Too many sign-ups from here", "Please wait a while and try again."), 429, { "Retry-After": String(wait) });

  // The cap and the count move together, so two people can't both take the last place.
  const b = db().transaction(() => {
    const l = linkById(link.id)!;
    if (!isActive(l)) return null;
    db().query("UPDATE generic_links SET started = started + 1 WHERE id = ?").run(l.id);
    return addBuyer(name, email, false, { style: l.style, sourceLink: l.id });
  })();
  if (!b) return c.html(inactivePage(style), 410);
  logSupport(b.id, "(visitor)", "signed-up-from-generic-link", `link #${link.id}${link.label ? ` ${link.label}` : ""}`);
  console.log(`[start] agency ${b.id} started from generic link ${link.id}`);
  return c.redirect(`/setup/${b.code}`, { "Set-Cookie": gsCookie(b.code, c.secure) });
}
