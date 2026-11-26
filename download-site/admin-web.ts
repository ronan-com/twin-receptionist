// /admin: our own dashboard for every buyer (Twin Technologies only). Same look as the wizard.
//   GET  /admin                       buyers list (search + status filter), or the sign-in page
//   POST /admin/login                 email + password (ADMIN_EMAILS + ADMIN_PASSWORD_HASH)
//   GET  /admin/login/<token>         one-time sign-in link from `bun admin.ts admin-link`; POST uses it
//   POST /admin/logout
//   POST /admin/buyers                add a buyer (optional welcome email, or tick Demo for a pretend-accounts run)
//   POST /admin/demo                  "Start a demo": a demo buyer, then straight to their setup link
//   GET  /admin/b/<id>                one buyer: link, step, status, the redacted install log
//   GET  /admin/b/<id>/setup          their wizard, read-only
//   POST /admin/b/<id>/<revoke|restore|reset|delete>
// Never shows a buyer's keys: only which ones we hold and their last 4 characters, and only
// while their setup is still running. There is no way in to a buyer's dashboard or accounts.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { CONFIG, RAILWAY, addBuyer, db, now, setupLink, sha256, type Buyer } from "./lib";
import { esc } from "./pages";
import { welcomeEmail } from "./content";
import { allow, stepDone } from "./setup";
import { DEMO_READY } from "./demo";
import { ALL_SECRETS, STEPS, getSetup, logRead, resetSetup, secretHint, type SetupData } from "./store";
import { wizardPage } from "./wizard";

// ---------------- settings ----------------
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const ADMIN_HASH = (process.env.ADMIN_PASSWORD_HASH || "").trim();
const SITE_SMTP = (process.env.SITE_SMTP_URL || "").trim(); // our own mail sender, for welcome emails
const SITE_FROM = (process.env.SITE_MAIL_FROM || "").trim();
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
    db().query("DELETE FROM download_log WHERE buyer_id = ?").run(id);
    db().query("DELETE FROM buyers WHERE id = ?").run(id);
  })();
}

// ---------------- welcome email ----------------
export const welcomeConfigured = () => !!SITE_SMTP && !!SITE_FROM;
async function sendWelcome(b: Buyer): Promise<string | null> {
  const w = welcomeEmail();
  if (!w) return "There's no welcome email text (handoff-content/welcome-email.md).";
  const vars: Record<string, string> = { buyer_first_name: b.name.split(/\s+/)[0] || b.name, setup_link: setupLink(b.code), seller_name: CONFIG.sellerName, support_email: CONFIG.supportEmail || SITE_FROM };
  const fill = (t: string) => t.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
  let body = fill(w.body);
  if (RAILWAY) body = body.replace(/A DigitalOcean account with a payment method/g, "A Railway account on the Hobby plan (it needs a card)");
  const t = nodemailer.createTransport(SITE_SMTP, { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 } as any);
  try {
    await t.sendMail({ from: SITE_FROM, to: b.email, subject: fill(w.subject), text: body });
    return null;
  } catch (e: any) {
    console.error(`[admin] welcome email to buyer ${b.id} failed: ${e?.code || e?.name || "error"}`);
    return "The welcome email didn't send. Copy the link and send it yourself.";
  } finally { t.close(); }
}

// ---------------- HTML ----------------
const when = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") : "");
const pill = (st: Status) => `<span class="pill ${st.replace(/\s/g, "-")}">${st}</span>`;
const copyBtn = (v: string) => `<button type="button" class="copy" data-copy="${esc(v)}">Copy</button>`;
function page(title: string, body: string, opts: { sid?: string; email?: string; wide?: boolean } = {}) {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Admin</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/wizard.css">
<script src="/wizard.js" defer></script>
</head>
<body class="adm">
<div class="ribbon" aria-hidden="true"></div>
<header class="top"><a class="mark" href="/admin"><span>${esc(CONFIG.sellerName)} · Admin</span></a>
<nav>${opts.sid ? `<span class="who">${esc(opts.email || "")}</span><form method="post" action="/admin/logout"><input type="hidden" name="t" value="${esc(csrf(opts.sid))}"><button class="linkbtn" type="submit">Sign out</button></form>` : ""}</nav></header>
<div class="shell wiz admshell"><main>${body}</main></div>
</body>
</html>`;
}
const hiddenT = (sid: string) => `<input type="hidden" name="t" value="${esc(csrf(sid))}">`;
const notice = (kind: "ok" | "err" | "info", html: string) => `<div class="notice ${kind}"><div>${html}</div></div>`;

function loginPage(msg = "", email = "") {
  return page("Sign in", `<section class="card narrow">
<h1>Admin sign-in</h1><p class="lead">For ${esc(CONFIG.sellerName)} staff only.</p>
${msg ? notice("err", esc(msg)) : ""}
${ADMIN_HASH ? `<form method="post" action="/admin/login" class="body">
  <label class="f" for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username" value="${esc(email)}">
  <label class="f" for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password">
  <div class="nav"><span></span><div class="right"><button class="btn p" type="submit">Sign in</button></div></div>
</form>` : `<p class="hint">Sign in with a one-time link: run <code>bun admin.ts admin-link you@yourcompany.com</code> on the server.</p>`}
</section>`);
}

function listPage(sid: string, email: string, q: string, filter: string, flash = "", kind = "") {
  const all = rows();
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((r) => r.status === s).length]));
  const demoCount = all.filter((r) => r.b.demo === 1).length;
  const needle = q.trim().toLowerCase();
  const shown = all.filter((r) => (!filter || r.status === filter) && (!kind || (kind === "demo") === (r.b.demo === 1)) && (!needle || [r.b.name, r.b.email, r.s.brand?.productName, r.s.domain?.host].some((v) => String(v || "").toLowerCase().includes(needle))));
  const tr = shown.map((r) => `<tr>
<td data-l="Buyer"><a href="/admin/b/${r.b.id}"><b>${esc(r.b.name)}</b></a>${r.b.demo === 1 ? ` <span class="pill demo">Test</span>` : ""}<br><span class="hint">${esc(r.b.email)}</span></td>
<td data-l="Brand">${esc(r.s.brand?.productName || "")}</td>
<td data-l="Status">${pill(r.status)}</td>
<td data-l="Step">${esc(r.s.phase === "done" ? "Done" : r.s.step)}</td>
<td data-l="Live at">${r.live ? `<a href="${esc(r.live)}" target="_blank" rel="noopener noreferrer">${esc(r.live.replace(/^https?:\/\//, ""))}</a>` : ""}</td>
<td data-l="Created">${esc(when(r.b.created_at))}</td>
<td data-l="Last activity">${esc(when(r.updated))}</td></tr>`).join("");
  return page("Buyers", `${flash}
<section class="card">
<div class="titlerow"><h1>Buyers</h1>${DEMO_READY ? `<form method="post" action="/admin/demo" target="_blank">${hiddenT(sid)}<button class="btn p" type="submit" title="Makes a test buyer with pretend accounts and opens their setup in a new tab">Start a test run</button></form>` : ""}</div>
<p class="lead">${all.length} buyer${all.length === 1 ? "" : "s"}${demoCount ? ` (${demoCount} test)` : ""}. ${counts.live} live, ${counts.installing} installing, ${counts.failed} failed.</p>
<form method="get" action="/admin" class="filters">
  <input name="q" type="search" placeholder="Search name, email, brand or domain" value="${esc(q)}" aria-label="Search">
  <select name="status" aria-label="Status"><option value="">All statuses</option>${STATUSES.map((s) => `<option value="${s}"${s === filter ? " selected" : ""}>${s} (${counts[s]})</option>`).join("")}</select>
  <select name="kind" aria-label="Type"><option value="">Real and test</option><option value="real"${kind === "real" ? " selected" : ""}>Real buyers only (${all.length - demoCount})</option><option value="demo"${kind === "demo" ? " selected" : ""}>Test runs only (${demoCount})</option></select>
  <button class="btn o" type="submit">Show</button>
</form>
${shown.length ? `<table class="records buyers"><thead><tr><th>Buyer</th><th>Brand</th><th>Status</th><th>Step</th><th>Live at</th><th>Created</th><th>Last activity</th></tr></thead><tbody>${tr}</tbody></table>` : `<p class="hint">No buyers match.</p>`}
</section>
<section class="card">
<h2>Add a buyer</h2>
<form method="post" action="/admin/buyers" class="body">${hiddenT(sid)}
  <div class="two"><div><label class="f" for="name">Name</label><input id="name" name="name" required maxlength="120"></div>
  <div><label class="f" for="bemail">Email</label><input id="bemail" name="email" type="email" required maxlength="200"></div></div>
  ${DEMO_READY ? `<label class="opt inline"><input type="checkbox" name="demo" value="1"> <b>Test run (pretend accounts)</b> <span class="hint">No email is sent; their setup accepts anything and ends on a test dashboard.</span></label>` : ""}
  ${welcomeConfigured() ? `<label class="opt inline"><input type="checkbox" name="welcome" value="1" checked> <b>Send the welcome email</b></label>` : `<p class="hint">You'll get their private link to send. (Set SITE_SMTP_URL and SITE_MAIL_FROM to email it from here.)</p>`}
  <div class="nav"><span></span><div class="right"><button class="btn p" type="submit">Add buyer</button></div></div>
</form>
</section>`, { sid, email });
}

function buyerPage(sid: string, email: string, b: Buyer, flash = "") {
  const s = getSetup(b.id);
  const st = statusOf(b, s);
  const link = setupLink(b.code);
  const held = s.phase === "done" ? [] : ALL_SECRETS.map((n) => [n, secretHint(b.id, n)] as const).filter(([, h]) => h);
  const { text } = logRead(b.id);
  const steps = STEPS.map((id) => `<li class="${stepDone(b, s, id) ? "ok" : id === s.step ? "run" : ""}"><i></i>${esc(id)}</li>`).join("");
  const act = (what: string, label: string, cls: string, confirm = "") => `<form method="post" action="/admin/b/${b.id}/${what}">${hiddenT(sid)}<button class="${cls}" type="submit"${confirm ? ` data-confirm="${esc(confirm)}"` : ""}>${label}</button></form>`;
  const hostNote = RAILWAY ? "Their Railway project stays in their account." : "Their server stays in their DigitalOcean account.";
  const rowsHtml: [string, string][] = [
    ["Email", esc(b.email)], ["Brand", esc(s.brand?.productName || "")], ["Owner email", esc(s.brand?.ownerEmail || "")],
    ["Domain", esc(s.domain?.host || "")], ["Status", pill(st)], ["Step", esc(s.phase === "done" ? "Done" : `${s.step}${s.phase !== "idle" ? ` (${s.phase})` : ""}`)],
    ["Live at", s.resultUrl ? `<a href="${esc(s.resultUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.resultUrl)}</a>${s.domainPending && s.tempUrl ? ` · now at <a href="${esc(s.tempUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.tempUrl)}</a>` : ""}` : ""],
    ["Created", esc(when(b.created_at))], ["Installed", esc(when(s.installedAt))],
  ];
  return page(b.name, `${flash}
<p><a href="/admin">← All buyers</a></p>
<section class="card">
<h1>${esc(b.name)}${b.demo === 1 ? ` <span class="pill demo">Test</span>` : ""}</h1>
<div class="summary">${rowsHtml.filter(([, v]) => v).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>
${s.error && st === "failed" ? notice("err", esc(s.error)) : ""}
<label class="f">Private setup link</label>
<div class="linkrow"><code id="setup-link">${esc(link)}</code>${copyBtn(link)}</div>
${b.revoked_at ? notice("info", `This link was turned off on ${esc(when(b.revoked_at))}.`) : ""}
<h2>Keys we hold</h2>
${held.length ? `<ul class="keys">${held.map(([n, h]) => `<li><b>${esc(n)}</b> <code>${esc(h)}</code></li>`).join("")}</ul>` : `<p class="hint">${s.phase === "done" ? "None: every key was deleted when the install finished." : "None yet."}</p>`}
<h2>Steps</h2><ul class="stages small">${steps}</ul>
<p><a class="btn o" href="/admin/b/${b.id}/setup">Open their setup (read-only)</a></p>
<details class="log"${text ? "" : " hidden"}><summary>Install log (keys hidden)</summary><pre>${esc(text.slice(-60000))}</pre></details>
<div class="nav"><div class="right left">
  ${b.revoked_at ? act("restore", "Turn the link back on", "btn o") : act("revoke", "Turn the link off", "btn o", "Turn this buyer's setup link off?")}
  ${st === "failed" || st === "in setup" || st === "installing" ? act("reset", "Reset their setup", "btn o", `Wipe ${b.name}'s setup and any keys we hold, so they start again? ${hostNote}`) : ""}
  ${act("delete", "Delete buyer", "btn danger", `Delete ${b.name} and everything we hold for them? Their link stops working. ${hostNote}`)}
</div></div>
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
    deleted: ["ok", "Buyer deleted."], bad: ["err", "That didn't work. Reload the page and try again."],
  };
  const x = m ? msgs[m] : null;
  return x ? notice(x[0] as "ok" | "err", esc(x[1])).replace('class="notice ', 'class="notice flash ') : "";
};

export async function adminRoute(req: Request, url: URL, c: AdminCtx): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "") || "/admin";
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

  const sess = sessionOf(req);
  if (!sess) return method === "GET" && path === "/admin" ? c.html(loginPage()) : method === "GET" ? c.redirect("/admin") : c.html(loginPage("Please sign in again."), 401);

  // ---- every change: same origin + the session's CSRF token ----
  let f: Record<string, string> = {};
  if (method === "POST") {
    const form = await c.readForm(req);
    if (!form || !c.sameOrigin(req) || !csrfOk(sess.sid, form.t || "")) return c.html(page("Reload", `<section class="card narrow"><h1>Please reload the page</h1><p class="lead">Your form expired, so we didn't act on it.</p><p><a class="btn o" href="/admin">Back to buyers</a></p></section>`), 403);
    f = form;
  }
  if (path === "/admin/logout" && method === "POST") {
    db().query("DELETE FROM admin_sessions WHERE id_hash = ?").run(sha256(sess.sid));
    return c.redirect("/admin", { "Set-Cookie": endCookie });
  }
  if (path === "/admin" && method === "GET") return c.html(listPage(sess.sid, sess.email, url.searchParams.get("q") || "", STATUSES.includes(url.searchParams.get("status") as Status) ? url.searchParams.get("status")! : "", flashOf(url), ["real", "demo"].includes(url.searchParams.get("kind") || "") ? url.searchParams.get("kind")! : ""));

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

  if (path === "/admin/buyers" && method === "POST") {
    const name = String(f.name || "").trim().replace(/[\r\n]/g, " ").slice(0, 120);
    const email = String(f.email || "").trim().toLowerCase().slice(0, 200);
    if (!name || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return c.html(listPage(sess.sid, sess.email, "", "", notice("err", "Give a name and a real email address.").replace('class="notice ', 'class="notice flash ')), 400);
    const demo = f.demo === "1" && DEMO_READY;
    const b = addBuyer(name, email, demo);
    console.log(`[admin] ${sess.email} added ${demo ? "demo " : ""}buyer ${b.id}`);
    let mail = "";
    if (!demo && f.welcome === "1" && welcomeConfigured()) {
      const wait = allow(`welcome:${sess.email}`, 30, 60 * 60_000);
      const errMail = wait ? "Too many welcome emails just now; send this one yourself." : await sendWelcome(b);
      mail = errMail ? notice("err", esc(errMail)) : notice("ok", `Welcome email sent to ${esc(b.email)}.`);
    }
    const link = setupLink(b.code);
    return c.html(page("Buyer added", `<section class="card">
<h1>${esc(b.name)} is added</h1><p class="lead">Send them this private link. It's the only way into their setup.</p>
<div class="linkrow"><code id="new-link">${esc(link)}</code>${copyBtn(link)}</div>
${mail}
<div class="nav"><a class="btn g" href="/admin">← All buyers</a><div class="right"><a class="btn p" href="/admin/b/${b.id}">Open buyer</a></div></div>
</section>`, sess));
  }

  m = path.match(/^\/admin\/b\/(\d{1,9})(?:\/(setup|revoke|restore|reset|delete))?$/);
  if (m) {
    const b = buyerById(Number(m[1]));
    if (!b) return c.html(page("Not found", `<section class="card narrow"><h1>No such buyer</h1><p><a href="/admin">← All buyers</a></p></section>`), 404);
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
    if (what === "revoke") { db().query("UPDATE buyers SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now(), b.id); return c.redirect(`/admin/b/${b.id}?m=revoked`); }
    if (what === "restore") { db().query("UPDATE buyers SET revoked_at = NULL WHERE id = ?").run(b.id); return c.redirect(`/admin/b/${b.id}?m=restored`); }
    if (what === "reset") { resetSetup(b.id); return c.redirect(`/admin/b/${b.id}?m=reset`); }
    if (what === "delete") { deleteBuyer(b.id); return c.redirect("/admin?m=deleted"); }
  }
  return c.html(page("Not found", `<section class="card narrow"><h1>Page not found</h1><p><a href="/admin">← All buyers</a></p></section>`), 404);
}
