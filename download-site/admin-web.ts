// /admin: our own dashboard for every agency (Twin Technologies only). Same look as the wizard.
//   GET  /admin (or /admin/agencies)  real agencies (search + status filter), test runs collapsed at the bottom, or the sign-in page
//   POST /admin/login                 email + password (ADMIN_EMAILS + ADMIN_PASSWORD_HASH)
//   GET  /admin/login/<token>         one-time sign-in link from `bun admin.ts admin-link`; POST uses it
//   POST /admin/logout
//   POST /admin/buyers                add an agency (generic: no product name anywhere); emails nobody unless "Email them now" is ticked
//   POST /admin/demo                  "Start a test run": a test agency, then straight to their setup link
//   GET  /admin/problems              every problem every agency reported in the last 24 hours
//   GET  /admin/alerts                every alert we raised (alerts.ts)
//   GET  /admin/tickets[?status=]     help tickets from the agencies' apps (tickets.ts); /admin/tickets/<id>[/reply|close|reopen|file/<n>]
//   GET  /admin/b/<id>                one agency (also /admin/a/<id>): link, step, status, health, the redacted install log
//   GET  /admin/b/<id>/setup          their wizard, read-only
//   POST /admin/b/<id>/<revoke|restore|reset|delete>
//   POST /admin/b/<id>/sync           "Sync now": ask their app for its health snapshot (sync.ts)
//   POST /admin/b/<id>/view-as        a one-time sign-in link, only while Support access is on in their app (on by default; theirs to switch off)
//   POST /admin/b/<id>/push-update    "Push update now": their app updates on its next heartbeat, if its owner allows it
//   POST /admin/b/<id>/logs           "Fetch recent logs" (masked by their app; shown, not kept)
//   GET  /admin/b/<id>/status         the install log's live status while we install for them (assist-web.ts)
//   POST /admin/b/<id>/assist/<what>  "Set up for them": fill a wizard step, DNS, install, owner login; "Invite them" (assist.ts)
// Never shows a buyer's keys: only which ones we hold and their last 4 characters. Keys are deleted when the install
// finishes, except a DNS key the admin chose to keep. The way into an agency's dashboard is "View as", and only while Support
// access is on in their own app (on by default, with "Support can make changes"; the owner can switch either off); their app
// writes each sign-in and each change to its audit log.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sendSiteMail, siteMailConfigured } from "./mailer";
import { CONFIG, RAILWAY, addBuyer, currentPackage, db, markInvited, now, setupLink, sha256, unbrand, type Buyer } from "./lib";
import { esc } from "./pages";
import { welcomeEmail } from "./content";
import { agencyUrl, allow, appUrlOf, stepDone, updateInfo } from "./setup";
import { ago, hasSyncToken, allSnapshots, deleteSyncData, dot, fetchLogs, history, latestSnapshot, logSupport, pushPending, requestPush, seen, supportLog, syncNow, viewAsLink, type Stored } from "./sync";
import { alertHistory } from "./alerts";
import { DEMO_READY } from "./demo";
import { ALL_SECRETS, STEPS, getSetup, logRead, resetSetup, secretHint, type SetupData } from "./store";
import { wizardPage } from "./wizard";
import { agenciesNavHtml, liveAlerts, needsHelp, deleteTickets, fileOf, navLinkHtml, replyToTicket, setTicketStatus, ticketById, ticketViewHtml, ticketsListHtml, type Status as TicketStatus } from "./tickets";
import { assistPanel, assistRoute, inviteCard, isInstalling, statusJson } from "./assist-web";
import { removeHost } from "./hosts";
import { createLink, rotateLink, toggleLink, listLinks } from "./genericlink";

// ---------------- settings ----------------
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const ADMIN_HASH = (process.env.ADMIN_PASSWORD_HASH || "").trim();
const SITE_FROM = () => (process.env.SITE_MAIL_FROM || "").trim();
export const adminEnabled = () => ADMIN_EMAILS.length > 0;
export const isAdminEmail = (e: string) => ADMIN_EMAILS.includes(e.trim().toLowerCase());
const SESSION_HOURS = 12;
const LINK_MINUTES = 15;
const SECURE = CONFIG.siteUrl.startsWith("https:");

let made = false;
function tables() {
  if (made) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS admin_sessions (id_hash BLOB PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_links (token_hash BLOB PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
  `);
  made = true;
}

/** A one-time sign-in link (15 minutes), for `bun admin.ts admin-link <email>`. */
export function newAdminLink(email: string): string {
  tables();
  const tok = randomBytes(32).toString("base64url");
  db().query("INSERT INTO admin_links (token_hash, email, expires_at) VALUES (?, ?, ?)").run(sha256(tok), email.toLowerCase(), new Date(Date.now() + LINK_MINUTES * 60_000).toISOString());
  return `${CONFIG.siteUrl}/admin/login/${tok}`;
}

// ---------------- sessions + CSRF ----------------
const csrfKey = () => createHmac("sha256", Buffer.from(CONFIG.secretKey, "base64")).update("admin-csrf").digest();
const csrf = (sid: string) => createHmac("sha256", csrfKey()).update(sid).digest("base64url");
function csrfOk(sid: string, t: string) {
  const a = Buffer.from(csrf(sid)), b = Buffer.from(String(t || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
function cookieSid(req: Request) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)as=([A-Za-z0-9_-]{43})/);
  return m ? m[1] : null;
}
function sessionOf(req: Request): { sid: string; email: string } | null {
  tables();
  const sid = cookieSid(req);
  if (!sid) return null;
  const r = db().query("SELECT email, expires_at FROM admin_sessions WHERE id_hash = ?").get(sha256(sid)) as { email: string; expires_at: string } | null;
  if (!r || Date.parse(r.expires_at) < Date.now() || !isAdminEmail(r.email)) return null;
  return { sid, email: r.email };
}
function startSession(email: string): string {
  tables();
  db().query("DELETE FROM admin_sessions WHERE expires_at < ?").run(now());
  const sid = randomBytes(32).toString("base64url");
  db().query("INSERT INTO admin_sessions (id_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sha256(sid), email, now(), new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString());
  return `as=${sid}; Path=/admin; HttpOnly; SameSite=Strict${SECURE ? "; Secure" : ""}; Max-Age=${SESSION_HOURS * 3600}`;
}
const endCookie = `as=; Path=/admin; HttpOnly; SameSite=Strict${SECURE ? "; Secure" : ""}; Max-Age=0`;

// ---------------- buyers ----------------
type Status = "not started" | "in setup" | "installing" | "failed" | "live" | "revoked";
const STATUSES: Status[] = ["not started", "in setup", "installing", "failed", "live", "revoked"];
function statusOf(b: Buyer, s: SetupData): Status {
  if (b.revoked_at) return "revoked";
  if (s.phase === "done") return "live";
  if (s.phase === "failed" || s.phase === "create_failed") return "failed";
  if (s.phase !== "idle") return "installing";
  if (s.step === "welcome" && !s.brand) return "not started";
  return "in setup";
}
interface Row { b: Buyer; s: SetupData; updated: string; status: Status; live: string }
function rows(): Row[] {
  const list = db().query("SELECT b.*, s.data AS sdata, s.updated_at AS supdated FROM buyers b LEFT JOIN setups s ON s.buyer_id = b.id ORDER BY b.id DESC").all() as any[];
  return list.map((r) => {
    const s: SetupData = r.sdata ? JSON.parse(r.sdata) : { step: "welcome", phase: "idle" };
    const b = r as Buyer;
    return { b, s, updated: r.supdated || b.created_at, status: statusOf(b, s), live: s.phase === "done" ? s.domainPending && s.tempUrl ? s.tempUrl : s.resultUrl || "" : "" };
  });
}
const buyerById = (id: number) => db().query("SELECT * FROM buyers WHERE id = ?").get(id) as Buyer | null;
function deleteBuyer(id: number) {
  db().transaction(() => {
    resetSetup(id);
    deleteSyncData(id);
    deleteTickets(id);
    removeHost(id);
    db().query("DELETE FROM support_log WHERE buyer_id = ?").run(id);
    db().query("DELETE FROM download_log WHERE buyer_id = ?").run(id);
    db().query("DELETE FROM buyers WHERE id = ?").run(id);
  })();
}

// ---------------- welcome email ----------------
export const welcomeConfigured = siteMailConfigured;
async function sendWelcome(b: Buyer): Promise<string | null> {
  const w = welcomeEmail();
  if (!w) return "There's no welcome email text (handoff-content/welcome-email.md).";
  const vars: Record<string, string> = { buyer_first_name: b.name.split(/\s+/)[0] || b.name, setup_link: setupLink(b.code), seller_name: "", support_email: CONFIG.supportEmail || SITE_FROM() };
  // Emails are generic: no product or company name, whatever the template says.
  const fill = (t: string) => unbrand(t.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? ""));
  let body = fill(w.body);
  if (RAILWAY) body = body.replace(/A DigitalOcean account with a payment method/g, "A Railway account on the Hobby plan (it needs a card)");
  const err = await sendSiteMail(b.email, fill(w.subject), body, { label: "Open your setup", url: setupLink(b.code) });
  if (err) return "The welcome email didn't send. Copy the link and send it yourself.";
  markInvited(b.id);
  return null;
}

// ---------------- HTML ----------------
const when = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") : "");
const pill = (st: Status) => `<span class="pill ${st.replace(/\s/g, "-")}">${st}</span>`;
/** The installed app version and an "Update available" pill when we've published a newer one. */
function versionCell(b: Buyer, s: SetupData): string {
  const u = updateInfo(b, s);
  return u ? `${esc(u.installed || "unknown")}${u.available ? ` <span class="pill installing" title="Version ${esc(u.latest)} is published; this agency hasn't updated yet">Update available</span>` : ""}` : "";
}
const invitedCell = (b: Buyer) => (b.invited_at ? `<span class="pill live">Invited ${esc(when(b.invited_at))}</span>` : `<span class="pill not-started">Not invited yet</span>`);
const copyBtn = (v: string) => `<button type="button" class="copy" data-copy="${esc(v)}">Copy</button>`;
function page(title: string, body: string, opts: { sid?: string; email?: string; wide?: boolean; live?: { status: string; rev: string } } = {}) {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · AI Agency Admin</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/wizard.css">
<link rel="stylesheet" href="/tickets.css">
<script src="/wizard.js" defer></script>
${opts.sid ? `<script src="/admin-live.js" defer></script>` : ""}
</head>
<body class="adm"${opts.sid ? ` data-live-alerts="/admin/alerts/live" data-since="${esc(now())}"` : ""}>
${opts.sid ? `<div class="livebar" id="livebar" role="alert" hidden><span class="livetext"></span><span><a class="liveopen" href="/admin/tickets">Open</a> <button type="button" class="livex" aria-label="Dismiss">Dismiss</button></span></div>` : ""}
<div class="ribbon" aria-hidden="true"></div>
<header class="top"><a class="mark" href="/admin"><span>AI Agency Admin</span></a>
<nav>${opts.sid ? `${agenciesNavHtml()} <a href="/admin/problems">Problems</a> <a href="/admin/alerts">Alerts</a> ${navLinkHtml()} <button type="button" class="linkbtn notifbtn" id="notifbtn" hidden>Turn on desktop alerts</button> <span class="who">${esc(opts.email || "")}</span><form method="post" action="/admin/logout"><input type="hidden" name="t" value="${esc(csrf(opts.sid))}"><button class="linkbtn" type="submit">Sign out</button></form>` : ""}</nav></header>
<div class="shell wiz admshell"${opts.live ? ` data-live="1" data-status="${esc(opts.live.status)}" data-rev="${esc(opts.live.rev)}"` : ""}><main>${body}</main></div>
</body>
</html>`;
}
const hiddenT = (sid: string) => `<input type="hidden" name="t" value="${esc(csrf(sid))}">`;
const notice = (kind: "ok" | "err" | "info", html: string) => `<div class="notice ${kind}"><div>${html}</div></div>`;

/**
 * Emails an admin a one-time sign-in link. Only for an address in ADMIN_EMAILS, at most 3 an hour per address (older unused
 * links for it are cancelled first). Returns what happened for tests and logs; the page never says which.
 */
export async function sendForgotLink(email: string): Promise<"sent" | "unknown" | "limited" | "no-mail" | "failed"> {
  tables();
  if (!isAdminEmail(email)) return "unknown";
  if (allow(`adminforgot-mail:${email}`, 3, 60 * 60_000)) return "limited";
  if (!siteMailConfigured()) { console.log("[admin] forgot password asked, but this site can't send email"); return "no-mail"; }
  db().query("DELETE FROM admin_links WHERE email = ? AND used_at IS NULL").run(email);
  const link = newAdminLink(email);
  const err = await sendSiteMail(email, "Sign in to AI Agency Admin", `Hi,\n\nUse this link to sign in. It works once and runs out in ${LINK_MINUTES} minutes.\n\n${link}\n\nIf you didn't ask for it, ignore this email.`, { label: "Sign in", url: link });
  return err ? "failed" : "sent";
}
function forgotPage(msg = "", sent = false) {
  return page("Forgot password", `<section class="card narrow">
<h1>Forgot your password?</h1>
${sent ? notice("ok", "If that address is an admin, a sign-in link is on its way. It works once and runs out in 15 minutes.") : `<p class="lead">We'll email you a one-time sign-in link.</p>`}
${msg ? notice("err", esc(msg)) : ""}
${sent ? "" : `<form method="post" action="/admin/forgot" class="body">
  <label class="f" for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username">
  <div class="nav"><span></span><div class="right"><button class="btn p" type="submit">Email me a link</button></div></div>
</form>`}
<p><a href="/admin">Back to sign in</a></p>
</section>`);
}
function loginPage(msg = "", email = "") {
  return page("Sign in", `<section class="card narrow">
<h1>AI Agency Admin</h1><p class="lead">Sign in to manage your agencies.</p>
${msg ? notice("err", esc(msg)) : ""}
${ADMIN_HASH ? `<form method="post" action="/admin/login" class="body">
  <label class="f" for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username" value="${esc(email)}">
  <label class="f" for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password">
  <div class="nav"><span></span><div class="right"><button class="btn p" type="submit">Sign in</button></div></div>
</form>
<p class="hint"><a href="/admin/forgot">Forgot your password?</a></p>` : `<p class="hint">Sign in with a one-time link: run <code>bun admin.ts admin-link you@yourcompany.com</code> on the server.</p>`}
</section>`);
}

const SEEN_LABEL = { live: "Live", quiet: "Quiet", offline: "Offline", never: "No sync" } as const;
function syncCell(st: Stored | null) {
  const k = seen(st);
  if (!st) return `<span class="hdot grey" title="Nothing heard yet"></span><span class="hint">None yet</span>`;
  return `<span class="hdot ${dot(st)}" title="${esc(st.snap.health.ok ? "Healthy" : "Needs a look")}"></span><span class="pill seen-${k}">${SEEN_LABEL[k]}</span> <span class="hint">${esc(ago(st.receivedAt))}</span>`;
}

/** Their automatic updates, in one line: on/off, unavailable (buyer must press Update), or failed. */
function autoState(st: Stored | null): { text: string; tone: "ok" | "off" | "bad" | "" } {
  if (!st) return { text: "", tone: "" };
  const u = st.snap.updates;
  if (!u.available) return { text: "Auto-update unavailable — agency must press Update", tone: "off" };
  if (u.lastResult === "failed") return { text: `Auto-update failed${u.lastError ? `: ${u.lastError}` : ""}`, tone: "bad" };
  if (!u.enabled) return { text: "Auto-update off (the owner's choice)", tone: "off" };
  const latest = currentPackage()?.version || "";
  const behind = latest && st.snap.appVersion && latest !== st.snap.appVersion;
  return { text: `Auto-update on (${u.mode === "asap" ? "as soon as available" : "overnight 2-4am"})${behind ? `, ${latest} waiting` : ""}`, tone: "ok" };
}
const problemBadge = (st: Stored | null) => (st && st.snap.problems.length ? ` <a class="pill failed" href="/admin/problems" title="${esc(st.snap.problems.map((p) => p.kind).join(", "))}">${st.snap.problems.length} problem${st.snap.problems.length === 1 ? "" : "s"}</a>` : "");

function listPage(sid: string, email: string, q: string, filter: string, flash = "") {
  const everyone = rows();
  // The list is real agencies only. Test runs (the demo flag) sit in a small collapsed section at the bottom.
  const all = everyone.filter((r) => r.b.demo !== 1);
  const tests = everyone.filter((r) => r.b.demo === 1);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((r) => r.status === s).length]));
  const needle = q.trim().toLowerCase();
  const shown = all.filter((r) => (!filter || r.status === filter) && (!needle || [r.b.name, r.b.email, r.s.brand?.productName, r.s.domain?.host].some((v) => String(v || "").toLowerCase().includes(needle))));
  const snaps = allSnapshots();
  const syncing = all.filter((r) => seen(snaps.get(r.b.id) ?? null) === "live").length;
  const help = needsHelp();
  const tr = shown.map((r) => { const st = snaps.get(r.b.id) ?? null; return `<tr>
<td data-l="Agency"><a href="/admin/b/${r.b.id}"><b>${esc(r.b.name)}</b></a>${help.has(r.b.id) ? ` <a class="pill failed" href="/admin/tickets/${help.get(r.b.id)}" title="They asked for a person during setup">Needs help</a>` : ""}${problemBadge(st)}<br><span class="hint">${esc(r.b.email)}</span></td>
<td data-l="Brand">${esc(r.s.brand?.productName || "")}</td>
<td data-l="Status">${pill(r.status)}</td>
<td data-l="Invited">${invitedCell(r.b)}</td>
<td data-l="Live at">${r.live ? `<a href="${esc(r.live)}" target="_blank" rel="noopener noreferrer">${esc(r.live.replace(/^https?:\/\//, ""))}</a>` : ""}</td>
<td data-l="Sync">${syncCell(st)}</td>
<td data-l="Version">${versionCell(r.b, r.s) || esc(st?.snap.appVersion || "")}${st ? `<br><span class="hint ${autoState(st).tone === "bad" ? "bad" : ""}">${esc(autoState(st).text)}</span>` : ""}</td>
<td data-l="Calls 7d">${st ? st.snap.counts.calls7d : ""}</td>
<td data-l="Receptionists">${st ? st.snap.counts.receptionists : ""}</td>
<td data-l="Last activity">${esc(when(r.updated))}</td></tr>`; }).join("");
  const testRows = tests.map((r) => `<tr>
<td data-l="Test run"><a href="/admin/b/${r.b.id}">${esc(r.b.name)}</a></td>
<td data-l="Created">${esc(when(r.b.created_at))}</td>
<td data-l="Status">${pill(r.status)}</td>
<td data-l=""><form method="post" action="/admin/b/${r.b.id}/delete">${hiddenT(sid)}<button class="linkbtn" type="submit" data-confirm="${esc(`Delete the test run ${r.b.name}?`)}">Delete</button></form></td></tr>`).join("");
  const testsSection = tests.length || DEMO_READY ? `<section class="card tests">
<div class="titlerow"><details><summary>Test runs (${tests.length})</summary>${tests.length ? `<form method="post" action="/admin/demo/delete-all">${hiddenT(sid)}<button class="btn danger" type="submit" data-confirm="${esc(`Delete all ${tests.length} test runs?`)}">Delete all test runs</button></form>` : ""}${tests.length ? `<div style="overflow-x:auto"><table class="records"><thead><tr><th>Name</th><th>Created</th><th>Status</th><th></th></tr></thead><tbody>${testRows}</tbody></table></div>` : `<p class="hint">No test runs.</p>`}</details>
${DEMO_READY ? `<form method="post" action="/admin/demo" target="_blank">${hiddenT(sid)}<button class="btn o" type="submit" title="Makes a test agency with pretend accounts and opens their setup in a new tab">Start a test run</button></form>` : ""}</div>
</section>` : "";
  return page("Agencies", `${flash}
<section class="card">
<div class="titlerow"><h1>Agencies</h1></div>
<p class="lead">${all.length} agenc${all.length === 1 ? "y" : "ies"}. ${counts.live} live, ${counts.installing} installing, ${counts.failed} failed. ${syncing} syncing now.</p>
<form method="get" action="/admin" class="filters">
  <input name="q" type="search" placeholder="Search name, email, brand or domain" value="${esc(q)}" aria-label="Search">
  <select name="status" aria-label="Status"><option value="">All statuses</option>${STATUSES.map((s) => `<option value="${s}"${s === filter ? " selected" : ""}>${s} (${counts[s]})</option>`).join("")}</select>
  <button class="btn o" type="submit">Show</button>
</form>
${shown.length ? `<div style="overflow-x:auto"><table class="records buyers"><thead><tr><th>Agency</th><th>Brand</th><th>Status</th><th>Invited</th><th>Live at</th><th>Sync</th><th>Version</th><th>Calls 7d</th><th>Receptionists</th><th>Last activity</th></tr></thead><tbody>${tr}</tbody></table></div>` : `<p class="hint">${all.length ? "No agencies match." : "No agencies yet. Add one below."}</p>`}
</section>
<section class="card">
<h2>Add an agency</h2>
<form method="post" action="/admin/buyers" class="body">${hiddenT(sid)}
  <div class="two"><div><label class="f" for="name">Name</label><input id="name" name="name" required maxlength="120"></div>
  <div><label class="f" for="bemail">Email</label><input id="bemail" name="email" type="email" required maxlength="200"></div></div>
  ${welcomeConfigured() ? `<label class="opt inline"><input type="checkbox" name="welcome" value="1"> <b>Email them now</b> <span class="hint">Off: nobody is emailed. Set things up for them first, then send the invite from their agency page.</span></label>` : `<p class="hint">Nobody is emailed. Set things up for them, then invite them from their agency page. (Set SITE_SMTP_URL and SITE_MAIL_FROM to email from here.)</p>`}
  <div class="nav"><span></span><div class="right"><button class="btn p" type="submit">Add agency</button></div></div>
</form>
</section>
${testsSection}`, { sid, email });
}

const yn = (v: boolean) => (v ? "Yes" : "No");
/** Their running app: last heartbeat, the counts it sent, and our two buttons. Nothing here is more than the app chose to send. */
function healthSection(sid: string, b: Buyer, s: SetupData): string {
  if (b.demo === 1 || s.phase !== "done") return "";
  const st = latestSnapshot(b.id);
  const act = (what: string, label: string, cls: string, extra = "") => `<form method="post" action="/admin/b/${b.id}/${what}">${hiddenT(sid)}<button class="${cls}" type="submit"${extra}>${label}</button></form>`;
  if (!st && !hasSyncToken(b.id)) {
    return `<h2>Health and support</h2><p class="hint">This agency was installed before syncing existed, so it sends us nothing and we can't view it. That's how it was sold, so nothing here applies.</p>`;
  }
  const k = seen(st);
  const x = st?.snap;
  const beats = history(b.id, 8);
  const accessOff = !!x && !x.support.access;
  const log = supportLog(b.id, 8);
  return `<h2>Health and support</h2>
<div class="summary">
  <div><span>Last heard</span><b>${st ? `<span class="hdot ${dot(st)}"></span><span class="pill seen-${k}">${SEEN_LABEL[k]}</span> ${esc(ago(st.receivedAt))} (${esc(when(st.receivedAt))} UTC)` : "Nothing yet"}</b></div>
  ${x ? `<div><span>App version</span><b>${esc(x.appVersion || "unknown")}</b></div>
  <div><span>Health</span><b>${x.health.ok ? "Healthy" : "Needs a look"}${x.health.openIncidents ? ` · ${x.health.openIncidents} open problem${x.health.openIncidents === 1 ? "" : "s"}` : ""}${x.health.phoneKey ? "" : " · no phone key loaded"}</b></div>
  <div><span>Brand</span><b>${esc(x.brand.name)}${x.brand.logoUrl ? ` · <a href="${esc(x.brand.logoUrl)}" target="_blank" rel="noopener noreferrer">logo</a>` : ""}</b></div>
  <div><span>Extras</span><b>Email: ${yn(x.extras.email)} · Own domain: ${yn(x.extras.domain)} · AI help: ${yn(x.extras.openRouter)}</b></div>
  <div><span>Their choices</span><b>Sharing ${x.support.sharing ? "on" : "off"} · Support access ${x.support.access ? `on${x.support.accessUntil ? ` until ${esc(when(x.support.accessUntil))} UTC` : " until they turn it off"}` : "off"}</b></div>
  <div><span>Last call</span><b>${x.lastCallAt ? esc(when(x.lastCallAt)) + " UTC" : "None yet"}</b></div>` : ""}
</div>
${x ? `<div class="counts">${([["Calls 24h", x.counts.calls24h], ["Calls 7d", x.counts.calls7d], ["Calls 30d", x.counts.calls30d], ["Bookings 7d", x.counts.bookings7d], ["Errors 24h", x.counts.errors24h], ["Receptionists", x.counts.receptionists], ["Clients", x.counts.clients], ["Numbers", x.counts.numbers], ["Agencies", x.counts.agencies]] as [string, number][]).map(([l, n]) => `<div><b>${n}</b><span>${l}</span></div>`).join("")}</div>
<p class="hint">Counts and health only: the app never sends caller names or numbers, messages, recordings or keys.</p>` : ""}
<div class="summary"><div><span>Automatic updates</span><b>${esc(autoState(st).text || "Unknown")}${x ? ` · ${x.support.edit ? "support can make changes" : "support is read-only"}` : ""}</b></div></div>
<div class="nav"><div class="right left">
  ${act("sync", "Sync now", "btn o")}
  ${accessOff ? `<button class="btn o" type="button" disabled>View as</button>` : act("view-as", "View as", "btn p")}
  ${x && x.updates.available && x.updates.enabled ? (pushPending(b.id) ? `<button class="btn o" type="button" disabled title="They'll be asked on their next heartbeat (within 15 minutes)">Update requested</button>` : act("push-update", "Push update now", "btn o")) : `<button class="btn o" type="button" disabled title="${x ? (x.updates.available ? "The owner turned automatic updates off" : "This agency can't update itself: the agency presses Update on their setup link") : "Nothing heard yet"}">Push update now</button>`}
  ${accessOff ? `<button class="btn o" type="button" disabled>Fetch recent logs</button>` : act("logs", "Fetch recent logs", "btn o")}
</div></div>
${problemsPanel(b.id, st)}
${accessOff ? `<p class="hint"><b>The agency has switched Support access off.</b> It's on by default; it's off now in their app (Settings, Support). Ask them to turn it back on, for 24 hours, 7 days or until they turn it off. "Sync now" refreshes this.</p>` : `<p class="hint">"View as" opens their dashboard as a support person, through a link that works once for 60 seconds: you can look, and ${x?.support.edit === false ? "can't make changes (the owner switched that off)" : "make changes unless the owner switches that off"}. Never their keys, billing or owner account. It only works while Support access is on, and their app records every sign-in and change in their audit log.</p>`}
${beats.length ? `<details class="log"><summary>Recent heartbeats</summary><div class="beats">${beats.map((h) => `${esc(when(h.at))} · ${h.ok ? "healthy" : "needs a look"} · ${h.calls24h} calls today · ${h.errors24h} errors · v${esc(h.v)}`).join("<br>")}</div></details>` : ""}
${log.length ? `<details class="log"><summary>What we did (our side)</summary><div class="beats">${log.map((l) => `${esc(when(l.at))} · ${esc(l.admin_email)} · ${esc(l.action)}${l.note ? ` · ${esc(l.note)}` : ""}`).join("<br>")}</div></details>` : ""}`;
}

const PROBLEM_HELP: Record<string, string> = {
  booking_sync: "Calendar or booking sync", text_failed: "Texts that didn't send", email_failed: "Emails that didn't send", provider_api: "Phone, AI or other provider errors",
  automation_apply: "Automations that couldn't be applied", update_failed: "Automatic update failed", call_sync: "Call history sync", server_error: "Unexpected server errors",
};
/** The problems the app reported in the last 24 hours (already scrubbed by the app and again by us). */
function problemsPanel(buyerId: number, st: Stored | null): string {
  const ps = st?.snap.problems ?? [];
  if (!st) return "";
  const h = alertHistory(5, buyerId);
  return `<h3>Problems (last 24 hours)</h3>
${ps.length ? `<table class="records"><thead><tr><th>Kind</th><th>What</th><th>Times</th><th>Last</th></tr></thead><tbody>${ps.map((p) => `<tr><td data-l="Kind"><span class="pill failed">${esc(p.kind)}</span><br><span class="hint">${esc(PROBLEM_HELP[p.kind] || "")}</span></td><td data-l="What">${esc(p.msg)}</td><td data-l="Times">${p.count}</td><td data-l="Last">${esc(ago(p.last))}</td></tr>`).join("")}</tbody></table>` : `<p class="hint">No problems reported.</p>`}
${h.length ? `<details class="log"><summary>Recent alerts for this agency</summary><div class="beats">${h.map((a) => `${esc(when(a.at))} · ${esc(a.kind)} · ${esc(a.message)}${a.sent ? ` · sent: ${esc(a.sent)}` : " · not sent (no channel set)"}`).join("<br>")}</div></details>` : ""}`;
}

function buyerPage(sid: string, email: string, b: Buyer, flash = "") {
  const s = getSetup(b.id);
  const st = statusOf(b, s);
  const link = setupLink(b.code);
  const held = ALL_SECRETS.map((n) => [n, secretHint(b.id, n)] as const).filter(([, h]) => h);
  const { text } = logRead(b.id);
  const live = isInstalling(s);
  const steps = STEPS.map((id) => `<li class="${stepDone(b, s, id) ? "ok" : id === s.step ? "run" : ""}"><i></i>${esc(id)}</li>`).join("");
  const act = (what: string, label: string, cls: string, confirm = "") => `<form method="post" action="/admin/b/${b.id}/${what}">${hiddenT(sid)}<button class="${cls}" type="submit"${confirm ? ` data-confirm="${esc(confirm)}"` : ""}>${label}</button></form>`;
  const hostNote = RAILWAY ? "Their Railway project stays in their account." : "Their server stays in their DigitalOcean account.";
  const rowsHtml: [string, string][] = [
    ["Email", esc(b.email)], ["Brand", esc(s.brand?.productName || "")], ["Owner email", esc(s.brand?.ownerEmail || "")],
    ["Domain", esc(s.domain?.host || "")], ["Status", pill(st)], ["Step", esc(s.phase === "done" ? "Done" : `${s.step}${s.phase !== "idle" ? ` (${s.phase})` : ""}`)],
    ["Live at", s.resultUrl ? `<a href="${esc(s.resultUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.resultUrl)}</a>${s.domainPending && s.tempUrl ? ` · now at <a href="${esc(s.tempUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.tempUrl)}</a>` : ""}` : ""],
    ["Created", esc(when(b.created_at))], ["Installed", esc(when(s.installedAt))], ["App version", versionCell(b, s)],
    ["Invited", invitedCell(b)],
  ];
  return page(b.name, `${flash}
<p><a href="/admin">← All agencies</a></p>
<section class="card">
<h1>${esc(b.name)}${b.demo === 1 ? ` <span class="pill demo">Test</span>` : ""}${needsHelp().has(b.id) ? ` <span class="pill failed">Needs help</span>` : ""}</h1>
${needsHelp().has(b.id) ? notice("err", `<b>They asked for a person during setup.</b> <a href="/admin/tickets/${needsHelp().get(b.id)}">Read and reply</a> · <a href="#assist">Set up for them</a>`) : ""}
<div class="summary">${rowsHtml.filter(([, v]) => v).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>
${s.error && st === "failed" ? notice("err", esc(s.error)) : ""}
<label class="f">Private setup link</label>
<div class="linkrow"><code id="setup-link">${esc(link)}</code>${copyBtn(link)}</div>
${updateInfo(b, s)?.available ? `<p class="hint">An update (version ${esc(updateInfo(b, s)!.latest)}) is available for this agency. The update link is their setup link: it opens on "Update your agency". ${copyBtn(link)}</p>` : ""}
${b.revoked_at ? notice("info", `This link was turned off on ${esc(when(b.revoked_at))}.`) : ""}
${healthSection(sid, b, s)}
<h2>Keys we hold</h2>
${held.length ? `<ul class="keys">${held.map(([n, h]) => `<li><b>${esc(n)}</b> <code>${esc(h)}</code></li>`).join("")}</ul>` : `<p class="hint">${s.phase === "done" ? "None: every key was deleted when the install finished." : "None yet."}</p>`}
<h2>Steps</h2><ul class="stages small">${steps}</ul>
<p><a class="btn o" href="/admin/b/${b.id}/setup">Open their setup (read-only)</a></p>
${assistPanel({ hiddenT, notice, copyBtn, when, page }, sid, b, s)}
<details class="log"${text ? "" : " hidden"}><summary>Install log (keys hidden)</summary><pre>${esc(text.slice(-60000))}</pre></details>
<div class="nav"><div class="right left">
  ${b.revoked_at ? act("restore", "Turn the link back on", "btn o") : act("revoke", "Turn the link off", "btn o", "Turn this agency's setup link off?")}
  ${st === "failed" || st === "in setup" || st === "installing" ? act("reset", "Reset their setup", "btn o", `Wipe ${b.name}'s setup and any keys we hold, so they start again? ${hostNote}`) : ""}
  ${act("delete", "Delete agency", "btn danger", `Delete ${b.name} and everything we hold for them? Their link stops working. ${hostNote}`)}
</div></div>
</section>
${inviteCard({ hiddenT, notice, copyBtn, when, page }, sid, b, s)}`, { sid, email, live: live ? { status: `/admin/b/${b.id}/status`, rev: statusJson(b, 0).rev } : undefined });
}

/** Every problem every live agency reported in the last 24 hours, newest first. */
function problemsPage(sid: string, email: string) {
  const snaps = allSnapshots();
  const names = new Map(rows().map((r) => [r.b.id, r] as const));
  const all = [...snaps].flatMap(([id, st]) => (names.get(id)?.b.demo === 1 ? [] : st.snap.problems.map((p) => ({ id, p, name: names.get(id)?.b.name || `Agency ${id}`, brand: names.get(id)?.s.brand?.productName || "" }))))
    .sort((a, b) => (a.p.last < b.p.last ? 1 : -1));
  const agencies = new Set(all.map((x) => x.id)).size;
  return page("Problems", `<p><a href="/admin">← All agencies</a></p>
<section class="card"><h1>Problems</h1>
<p class="lead">${all.length ? `${all.length} problem${all.length === 1 ? "" : "s"} across ${agencies} agenc${agencies === 1 ? "y" : "ies"}, from the last 24 hours.` : "Nothing reported by any agency in the last 24 hours."} The apps send a kind and a masked one-line description, never names, numbers or what anyone said.</p>
${all.length ? `<div style="overflow-x:auto"><table class="records"><thead><tr><th>Agency</th><th>Kind</th><th>What</th><th>Times</th><th>Last</th></tr></thead><tbody>${all.map((x) => `<tr><td data-l="Agency"><a href="/admin/b/${x.id}"><b>${esc(x.name)}</b></a>${x.brand ? `<br><span class="hint">${esc(x.brand)}</span>` : ""}</td><td data-l="Kind"><span class="pill failed">${esc(x.p.kind)}</span></td><td data-l="What">${esc(x.p.msg)}</td><td data-l="Times">${x.p.count}</td><td data-l="Last">${esc(ago(x.p.last))}</td></tr>`).join("")}</tbody></table></div>` : ""}
</section>`, { sid, email });
}

function alertsPage(sid: string, email: string) {
  const list = alertHistory(200);
  const names = new Map(rows().map((r) => [r.b.id, r.b.name] as const));
  return page("Alerts", `<p><a href="/admin">← All agencies</a></p>
<section class="card"><h1>Alerts</h1>
<p class="lead">Raised when an agency goes quiet for 30 minutes, a new kind of problem appears, or an automatic update fails. One per agency per kind per hour.${process.env.ALERT_WEBHOOK_URL || process.env.SITE_SMTP_URL ? "" : " <b>No alert channel is set (ALERT_WEBHOOK_URL, or SITE_SMTP_URL + SITE_MAIL_FROM), so these are only recorded here.</b>"}</p>
${list.length ? `<div style="overflow-x:auto"><table class="records"><thead><tr><th>When (UTC)</th><th>Agency</th><th>Kind</th><th>What</th><th>Sent to</th></tr></thead><tbody>${list.map((a) => `<tr><td data-l="When">${esc(when(a.at))}</td><td data-l="Agency"><a href="/admin/b/${a.buyer_id}">${esc(names.get(a.buyer_id) || `Buyer ${a.buyer_id}`)}</a></td><td data-l="Kind"><span class="pill failed">${esc(a.kind)}</span></td><td data-l="What">${esc(a.message)}</td><td data-l="Sent to">${esc(a.sent || "nowhere")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="hint">No alerts yet.</p>`}
</section>`, { sid, email });
}

// ---------------- routes ----------------
export interface AdminCtx {
  ip: string;
  sameOrigin: (req: Request) => boolean;
  readForm: (req: Request) => Promise<Record<string, string> | null>;
  html: (body: string, status?: number, extra?: Record<string, string>) => Response;
  redirect: (to: string, extra?: Record<string, string>) => Response;
}
const flashOf = (url: URL) => {
  const m = url.searchParams.get("m");
  const msgs: Record<string, [string, string]> = {
    revoked: ["ok", "Link turned off."], restored: ["ok", "Link turned back on."], reset: ["ok", "Setup wiped. Their link starts from the beginning."],
    deleted: ["ok", "Agency deleted."], "tests-deleted": ["ok", "All test runs deleted."], "tests-none": ["info", "There are no test runs."],
    "link-on": ["ok", "The generic onboarding link is on."], "link-off": ["ok", "The generic onboarding link is off."], "link-rotated": ["ok", "Made a new link. The old one no longer works."],
    "sync-ok": ["ok", "Synced: their app answered with its latest numbers."],
    "sync-off": ["info", "They've turned sharing off, so their app sends us nothing."],
    "sync-no-app": ["err", "We don't have this app's address, or it was installed before syncing existed."],
    "sync-unreachable": ["err", "Their app didn't answer. It may be down, restarting or asleep."],
    "sync-refused": ["err", "Their app didn't accept our token. It was installed before syncing existed, or its settings changed."],
    "sync-error": ["err", "Their app's answer wasn't what we expected."],
    "push-ok": ["ok", "Asked. Their app gets the request with its next heartbeat (within 15 minutes) and updates if its owner has automatic updates on."],
    "push-unavailable": ["err", "This agency can't update itself (no project token). The agency presses Update on their setup link."],
    "push-off": ["info", "The owner turned automatic updates off, so we can't push an update."],
    "push-unknown": ["err", "We haven't heard from this app yet."],
    "push-current": ["info", "Already on the newest version."],
    "logs-off": ["info", "The agency has switched Support access off, so we can't fetch logs."],
    "logs-no-app": ["err", "We don't have this app's address, or it was installed before syncing existed."],
    "logs-unreachable": ["err", "Their app didn't answer. It may be down, restarting or asleep."],
    "logs-refused": ["err", "This version of the app can't send logs yet. The agency needs to update."],
    "logs-error": ["err", "Their app's answer wasn't what we expected."],
    "view-off": ["info", "The agency has switched Support access off in their app (Settings, Support). Ask them to turn it back on."],
    "view-no-app": ["err", "We don't have this app's address, or it was installed before syncing existed."],
    "view-unreachable": ["err", "Their app didn't answer. It may be down, restarting or asleep."],
    "view-refused": ["err", "Their app didn't accept our token. It was installed before syncing existed, or its settings changed."],
    "view-error": ["err", "Their app didn't give a usable sign-in link."],
    "ticket-replied": ["ok", "Reply sent. Their app shows it within a few minutes."],
    "ticket-empty": ["err", "Write a reply first."],
    "ticket-closed": ["ok", "Ticket closed."],
    "ticket-reopened": ["ok", "Ticket reopened."],
    bad: ["err", "That didn't work. Reload the page and try again."],
  };
  const x = m ? msgs[m] : null;
  return x ? notice(x[0] as "ok" | "err", esc(x[1])).replace('class="notice ', 'class="notice flash ') : "";
};

export async function adminRoute(req: Request, url: URL, c: AdminCtx): Promise<Response> {
  const path = (url.pathname.replace(/\/+$/, "") || "/admin").replace(/^\/admin\/agencies$/, "/admin").replace(/^\/admin\/a\/(?=\d)/, "/admin/b/");
  const method = req.method;
  if (!adminEnabled()) return c.html(page("Admin", `<section class="card narrow"><h1>Admin is off</h1><p class="lead">Set ADMIN_EMAILS (and ADMIN_PASSWORD_HASH, or use <code>bun admin.ts admin-link</code>) to turn it on.</p></section>`), 404);
  tables();

  // ---- signing in ----
  let m = path.match(/^\/admin\/login\/([A-Za-z0-9_-]{43})$/);
  if (m) {
    const r = db().query("SELECT email, expires_at, used_at FROM admin_links WHERE token_hash = ?").get(sha256(m[1])) as { email: string; expires_at: string; used_at: string | null } | null;
    const okLink = r && !r.used_at && Date.parse(r.expires_at) > Date.now() && isAdminEmail(r.email);
    if (method === "GET") {
      if (!okLink) return c.html(loginPage("That sign-in link has expired or was already used. Make a new one."), 410);
      // A button, so link previews and scanners can't use it up.
      return c.html(page("Sign in", `<section class="card narrow"><h1>Sign in as ${esc(r!.email)}</h1><form method="post" action="${esc(path)}"><div class="nav"><span></span><div class="right"><button class="btn p" type="submit">Sign in</button></div></div></form></section>`));
    }
    if (method !== "POST" || !c.sameOrigin(req)) return c.html(loginPage("Please try again."), 403);
    const wait = allow(`adminlogin:${c.ip}`, 10, 15 * 60_000);
    if (wait) return c.html(loginPage(`Too many tries. Wait ${Math.ceil(wait / 60)} minutes.`), 429);
    if (!okLink) return c.html(loginPage("That sign-in link has expired or was already used. Make a new one."), 410);
    db().query("UPDATE admin_links SET used_at = ? WHERE token_hash = ?").run(now(), sha256(m[1]));
    console.log(`[admin] ${r!.email} signed in with a one-time link`);
    return c.redirect("/admin", { "Set-Cookie": startSession(r!.email) });
  }
  if (path === "/admin/login") {
    if (method !== "POST") return c.redirect("/admin");
    if (!c.sameOrigin(req)) return c.html(loginPage("Please try again."), 403);
    const f = (await c.readForm(req)) || {};
    const email = String(f.email || "").trim().toLowerCase().slice(0, 200);
    const wait = allow(`adminlogin:${c.ip}`, 10, 15 * 60_000) || allow(`adminlogin:${email}`, 10, 15 * 60_000);
    if (wait) return c.html(loginPage(`Too many tries. Wait ${Math.ceil(wait / 60)} minutes.`, email), 429);
    // Always check a hash, so a wrong email takes as long as a wrong password.
    const good = ADMIN_HASH ? await Bun.password.verify(String(f.password || "").slice(0, 200), ADMIN_HASH).catch(() => false) : false;
    if (!good || !isAdminEmail(email)) { console.log(`[admin] failed sign-in from ${c.ip}`); return c.html(loginPage("That email and password don't match.", email), 401); }
    console.log(`[admin] ${email} signed in`);
    return c.redirect("/admin", { "Set-Cookie": startSession(email) });
  }

  // ---- forgot password: a one-time sign-in link by email (15 minutes, same as `admin-link`). Same answer for every address. ----
  if (path === "/admin/forgot") {
    if (method === "GET") return c.html(forgotPage());
    if (method !== "POST" || !c.sameOrigin(req)) return c.html(forgotPage("Please try again."), 403);
    const f2 = (await c.readForm(req)) || {};
    const email = String(f2.email || "").trim().toLowerCase().slice(0, 200);
    const wait = allow(`adminforgot:${c.ip}`, 5, 60 * 60_000);
    if (wait) return c.html(forgotPage(`Too many tries. Wait ${Math.ceil(wait / 60)} minutes.`), 429);
    await sendForgotLink(email);
    return c.html(forgotPage("", true));
  }

  const sess = sessionOf(req);
  // The live alert every admin page polls (admin-live.js): help requests waiting on us, and what came in since.
  if (path === "/admin/alerts/live") {
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    if (!sess) return json({ error: "sign in" }, 401);
    if (method !== "GET") return json({ error: "GET only" }, 405);
    const raw = url.searchParams.get("since") || "";
    const t = /^\d{10,15}$/.test(raw) ? Number(raw) : Date.parse(raw);
    const since = Number.isFinite(t) ? new Date(Math.min(t, Date.now())).toISOString() : now();
    return json({ ok: true, now: now(), ...liveAlerts(since) });
  }
  if (!sess) return method === "GET" && path === "/admin" ? c.html(loginPage()) : method === "GET" ? c.redirect("/admin") : c.html(loginPage("Please sign in again."), 401);

  // ---- every change: same origin + the session's CSRF token ----
  let f: Record<string, string> = {};
  if (method === "POST") {
    const form = await c.readForm(req);
    if (!form || !c.sameOrigin(req) || !csrfOk(sess.sid, form.t || "")) return c.html(page("Reload", `<section class="card narrow"><h1>Please reload the page</h1><p class="lead">Your form expired, so we didn't act on it.</p><p><a class="btn o" href="/admin">Back to agencies</a></p></section>`), 403);
    f = form;
  }
  if (path === "/admin/logout" && method === "POST") {
    db().query("DELETE FROM admin_sessions WHERE id_hash = ?").run(sha256(sess.sid));
    return c.redirect("/admin", { "Set-Cookie": endCookie });
  }
  if (path === "/admin" && method === "GET") return c.html(listPage(sess.sid, sess.email, url.searchParams.get("q") || "", STATUSES.includes(url.searchParams.get("status") as Status) ? url.searchParams.get("status")! : "", flashOf(url)));

  // The whole fleet: every problem, and every alert we've raised.
  if (path === "/admin/problems" && method === "GET") return c.html(problemsPage(sess.sid, sess.email));
  if (path === "/admin/alerts" && method === "GET") return c.html(alertsPage(sess.sid, sess.email));

  // "Start a demo": a demo buyer (no email), then their setup link. The button opens this in a new tab.
  if (path === "/admin/demo" && method === "POST") {
    if (!DEMO_READY) return c.html(listPage(sess.sid, sess.email, "", "", notice("err", "Test runs aren't set up on this site (DEMO_APP_URL and the test app's admin sign-in).").replace('class="notice ', 'class="notice flash ')), 400);
    const wait = allow(`demo:${sess.email}`, 30, 60 * 60_000);
    if (wait) return c.html(listPage(sess.sid, sess.email, "", "", notice("err", "Too many test runs just now. Wait a few minutes.").replace('class="notice ', 'class="notice flash ')), 429);
    const stamp = new Date().toISOString().slice(11, 16);
    const b = addBuyer(`Test ${stamp}`, `demo-${randomBytes(3).toString("hex")}@example.com`, true);
    console.log(`[admin] ${sess.email} started demo buyer ${b.id}`);
    return c.redirect(`/setup/${b.code}`);
  }

  // "Delete all test runs": every demo buyer and what we hold for them. Real agencies are never touched.
  if (path === "/admin/demo/delete-all" && method === "POST") {
    const ids = (db().query("SELECT id FROM buyers WHERE demo = 1").all() as { id: number }[]).map((r) => r.id);
    for (const id of ids) deleteBuyer(id);
    console.log(`[admin] ${sess.email} deleted ${ids.length} test runs`);
    return c.redirect(`/admin?m=${ids.length ? "tests-deleted" : "tests-none"}`);
  }

  // The generic onboarding link (genericlink.ts): turn it on/off, make a new address.
  if (path === "/admin/links/add" && method === "POST") {
    const l = createLink(sess.email, f.label, "neutral", "");
    return c.redirect(l ? "/admin?m=link-on#onboarding-link" : "/admin?m=bad");
  }
  m = path.match(/^\/admin\/links\/(new|new-neutral|\d{1,9}\/(?:toggle|rotate))$/);
  if (m && method === "POST") {
    const [what, act] = m[1].split("/");
    if (what.startsWith("new")) {
      const l = listLinks()[0] ?? createLink(sess.email, "", "neutral", "");
      if (l && !l.enabled) toggleLink(sess.email, l.id);
      return c.redirect("/admin?m=link-on");
    }
    const id = Number(what);
    if (act === "toggle") { const on = toggleLink(sess.email, id); return c.redirect(on == null ? "/admin?m=bad" : on ? "/admin?m=link-on" : "/admin?m=link-off"); }
    return c.redirect(rotateLink(sess.email, id) ? "/admin?m=link-rotated" : "/admin?m=bad");
  }

  if (path === "/admin/buyers" && method === "POST") {
    const name = String(f.name || "").trim().replace(/[\r\n]/g, " ").slice(0, 120);
    const email = String(f.email || "").trim().toLowerCase().slice(0, 200);
    if (!name || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return c.html(listPage(sess.sid, sess.email, "", "", notice("err", "Give a name and a real email address.").replace('class="notice ', 'class="notice flash ')), 400);
    const b = addBuyer(name, email, false);
    console.log(`[admin] ${sess.email} added buyer ${b.id}`);
    let mail = "";
    if (f.welcome === "1" && welcomeConfigured()) {
      const wait = allow(`welcome:${sess.email}`, 30, 60 * 60_000);
      const errMail = wait ? "Too many welcome emails just now; send this one yourself." : await sendWelcome(b);
      mail = errMail ? notice("err", esc(errMail)) : notice("ok", `Welcome email sent to ${esc(b.email)}.`);
    }
    const link = setupLink(b.code);
    return c.html(page("Agency added", `<section class="card">
<h1>${esc(b.name)} is added</h1><p class="lead">${mail ? "Their private setup link:" : `Nobody was emailed. Set up what you can for them on their agency page, then use <b>Invite them</b> at the bottom of it.`}</p>
<div class="linkrow"><code id="new-link">${esc(link)}</code>${copyBtn(link)}</div>
${mail}
<div class="nav"><a class="btn g" href="/admin">← All agencies</a><div class="right"><a class="btn p" href="/admin/b/${b.id}">Open agency</a></div></div>
</section>`, sess));
  }

  // "Set up for them" (assist.ts): the forms in the panel, and the install log's live status.
  m = path.match(/^\/admin\/b\/(\d{1,9})\/(status|assist\/[a-z-]{2,30})$/);
  if (m) {
    const b = buyerById(Number(m[1]));
    if (!b) return c.html(page("Not found", `<section class="card narrow"><h1>No such agency</h1><p><a href="/admin">← All agencies</a></p></section>`), 404);
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    if (m[2] === "status") return method === "GET" ? json(statusJson(b, Number(url.searchParams.get("from") || 0) || 0)) : c.redirect(`/admin/b/${b.id}`);
    if (method !== "POST") return c.redirect(`/admin/b/${b.id}`);
    console.log(`[admin] ${sess.email}: ${m[2]} buyer ${b.id}`);
    return assistRoute(m[2].slice(7), b, f, { sid: sess.sid, email: sess.email, h: { hiddenT, notice, copyBtn, when, page }, redirect: (to) => c.redirect(to), html: (body, status) => c.html(body, status), json });
  }

  // ---- help tickets (tickets.ts) ----
  if (path === "/admin/tickets" && method === "GET") {
    const st = url.searchParams.get("status");
    return c.html(page("Help tickets", ticketsListHtml(st === "waiting" || st === "closed" || st === "all" ? st : "open"), { sid: sess.sid, email: sess.email }));
  }
  m = path.match(/^\/admin\/tickets\/(\d{1,9})(?:\/(reply|close|reopen|file\/(\d{1,9})))?$/);
  if (m) {
    const t = ticketById(Number(m[1]));
    if (!t) return c.html(page("Not found", `<section class="card narrow"><h1>No such ticket</h1><p><a href="/admin/tickets">← Help tickets</a></p></section>`), 404);
    const what = m[2];
    if (what?.startsWith("file/") && method === "GET") {
      const f = fileOf(t.id, Number(m[3]));
      if (!f) return c.html(page("Not found", `<section class="card narrow"><h1>No such file</h1></section>`), 404);
      return new Response(f.data, { status: 200, headers: { "Content-Type": f.type, "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store" } });
    }
    if (!what && method === "GET") return c.html(page(t.subject, ticketViewHtml(t, hiddenT(sess.sid), flashOf(url)), { sid: sess.sid, email: sess.email }));
    if (method !== "POST") return c.redirect(`/admin/tickets/${t.id}`);
    console.log(`[admin] ${sess.email}: ${what} ticket ${t.id}`);
    if (what === "reply") {
      const r = replyToTicket(t.id, sess.email, f.body || "");
      return c.redirect(`/admin/tickets/${t.id}${r.ok ? "?m=ticket-replied" : "?m=ticket-empty"}`);
    }
    if (what === "close" || what === "reopen") {
      setTicketStatus(t.id, (what === "close" ? "closed" : "open") as TicketStatus);
      return c.redirect(what === "close" ? "/admin/tickets?m=ticket-closed" : `/admin/tickets/${t.id}?m=ticket-reopened`);
    }
  }

  m = path.match(/^\/admin\/b\/(\d{1,9})(?:\/(setup|revoke|restore|reset|delete|sync|view-as|push-update|logs))?$/);
  if (m) {
    const b = buyerById(Number(m[1]));
    if (!b) return c.html(page("Not found", `<section class="card narrow"><h1>No such agency</h1><p><a href="/admin">← All agencies</a></p></section>`), 404);
    const what = m[2];
    if (!what && method === "GET") return c.html(buyerPage(sess.sid, sess.email, b, flashOf(url)));
    if (what === "setup" && method === "GET") {
      // Their wizard as they see it, with every form switched off and links kept inside /admin.
      const s = getSetup(b.id);
      const want = url.searchParams.get("step");
      const view = (s.phase === "done" ? "done" : STEPS.includes(want as any) ? want : s.step) as any;
      let html = wizardPage(b, s, b.code, "admin-read-only-view", view);
      html = html
        .replace(/<form [^>]*>/g, (f) => f.replace(/action="[^"]*"/, 'action="#"').replace("<form ", "<form data-ro "))
        .replace(/<(button|input|select|textarea)\b/g, "<$1 disabled")
        .replaceAll(`href="/setup/${b.code}?step=`, `href="/admin/b/${b.id}/setup?step=`)
        .replaceAll(`href="/setup/${b.code}"`, `href="/admin/b/${b.id}/setup"`)
        .replace(/ data-live="1"/, "")
        .replace('<div class="ribbon" aria-hidden="true"></div>', `<div class="ribbon" aria-hidden="true"></div><div class="robar">Read-only view of ${esc(b.name)}'s setup · <a href="/admin/b/${b.id}">Back to admin</a></div>`);
      return c.html(html);
    }
    if (method !== "POST") return c.redirect(`/admin/b/${b.id}`);
    console.log(`[admin] ${sess.email}: ${what} buyer ${b.id}`);
    if (["revoke", "restore", "reset"].includes(what!)) logSupport(b.id, sess.email, what === "revoke" ? "turned their link off" : what === "restore" ? "turned their link back on" : "reset their setup");
    if (what === "revoke") { db().query("UPDATE buyers SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now(), b.id); return c.redirect(`/admin/b/${b.id}?m=revoked`); }
    if (what === "restore") { db().query("UPDATE buyers SET revoked_at = NULL WHERE id = ?").run(b.id); return c.redirect(`/admin/b/${b.id}?m=restored`); }
    if (what === "reset") { resetSetup(b.id); return c.redirect(`/admin/b/${b.id}?m=reset`); }
    if (what === "delete") { deleteBuyer(b.id); return c.redirect("/admin?m=deleted"); }
    if (what === "push-update") {
      const wait = allow(`support:${sess.email}`, 60, 60 * 60_000);
      if (wait) return c.redirect(`/admin/b/${b.id}?m=bad`);
      const r = requestPush(b.id, sess.email);
      logSupport(b.id, sess.email, "push-update", r.ok ? "requested" : `refused: ${r.reason}`);
      return c.redirect(`/admin/b/${b.id}?m=${r.ok ? "push-ok" : `push-${r.reason}`}`);
    }
    if (what === "logs") {
      const wait = allow(`support:${sess.email}`, 60, 60 * 60_000);
      if (wait) return c.redirect(`/admin/b/${b.id}?m=bad`);
      const r = await fetchLogs(b.id, appUrlOf(getSetup(b.id)));
      logSupport(b.id, sess.email, "fetch-logs", r.ok ? `${r.lines.length} lines` : `refused: ${r.reason}`);
      if (!r.ok) return c.redirect(`/admin/b/${b.id}?m=logs-${r.reason}`);
      return c.html(page("Recent logs", `<section class="card">
<h1>Recent logs: ${esc(b.name)}</h1>
<p class="lead">The last ${r.lines.length} lines their app logged, with numbers, emails, links, keys and anything in quotes already masked by the app. Shown here only; we don't keep them. Their app records that we looked.</p>
<pre class="loglines">${esc(r.lines.map((l) => `${l.at.slice(11, 19)} ${l.level.padEnd(5)} ${l.line}`).join("\n"))}</pre>
<p><a href="/admin/b/${b.id}">← Back to ${esc(b.name)}</a></p>
</section>`, sess));
    }
    if (what === "sync" || what === "view-as") {
      const url = appUrlOf(getSetup(b.id));
      const wait = allow(`support:${sess.email}`, 60, 60 * 60_000);
      if (wait) return c.redirect(`/admin/b/${b.id}?m=bad`);
      if (what === "sync") {
        const r = await syncNow(b.id, url);
        logSupport(b.id, sess.email, "sync-now", r.ok ? "ok" : r.reason);
        return c.redirect(`/admin/b/${b.id}?m=${r.ok ? "sync-ok" : `sync-${r.reason}`}`);
      }
      const r = await viewAsLink(b.id, url);
      logSupport(b.id, sess.email, "view-as", r.ok ? "link issued" : `refused: ${r.reason}`);
      if (!r.ok) return c.redirect(`/admin/b/${b.id}?m=view-${r.reason}`);
      // A page with a link, not a redirect: the site's form-action rule keeps forms from sending the browser elsewhere.
      return c.html(page("View as", `<section class="card narrow">
<h1>Open ${esc(b.name)}'s dashboard</h1>
<p class="lead">This link works once and runs out in 60 seconds. It opens their dashboard as a support person who can view and, if the agency allows changes (on unless they switched it off), edit. Never their keys, billing or owner account. Their app records the sign-in and every change in their audit log.</p>
<p><a class="btn p" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Open their dashboard</a></p>
<p><a href="/admin/b/${b.id}">← Back to ${esc(b.name)}</a></p>
</section>`, sess));
    }
  }
  return c.html(page("Not found", `<section class="card narrow"><h1>Page not found</h1><p><a href="/admin">← All agencies</a></p></section>`), 404);
}
