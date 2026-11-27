// Help tickets: an agency's "Contact support" requests, sent from their own app to us.
//   POST /api/tickets            the app sends a ticket and/or new messages (Bearer sync token). Idempotent: the
//                                app's own ids are the keys, so a retry never doubles anything.
//   GET  /api/tickets/updates    our replies and status changes since a cursor (same token). The app asks for
//                                these with its heartbeat, so a reply shows up in the agency's dashboard.
//   /admin/tickets...            the admin side (admin-web.ts calls the functions below).
// What a ticket carries is fixed here, like the heartbeat: a subject, a message, an optional screenshot (an image,
// at most 2 MB) and a small context (page address with no query or token, app version, browser, agency and
// receptionist ids). Never a key. Anything that looks like one is masked before it is stored.
import { addColumn, db, now } from "./lib";
import { esc } from "./pages";
import { allow } from "./setup";
import { ago, bearerOf, buyerBySyncToken } from "./sync";

export const MAX_SCREENSHOT = 2 * 1024 * 1024;
/** A body is the text plus a base64 screenshot (4/3 bigger) plus a little JSON. */
export const MAX_TICKET_BODY = Math.ceil((MAX_SCREENSHOT * 4) / 3) + 64 * 1024;
const MAX_SUBJECT = 160;
const MAX_TEXT = 5000;
const MAX_MESSAGES_PER_POST = 20;
const MAX_OPEN_PER_AGENCY = 50;
const IMAGE_TYPES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1")),
  "image/webp": (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};
export type Status = "open" | "waiting" | "closed";
export const STATUS_LABEL: Record<Status, string> = { open: "Open", waiting: "Waiting on agency", closed: "Closed" };

let made = false;
function tables() {
  if (made) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, buyer_id INTEGER NOT NULL, app_id TEXT NOT NULL, subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', context TEXT NOT NULL DEFAULT '{}', from_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'app', UNIQUE (buyer_id, app_id)
    );
    CREATE INDEX IF NOT EXISTS tickets_status ON tickets (status, updated_at);
    CREATE TABLE IF NOT EXISTS ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, author TEXT NOT NULL, author_name TEXT NOT NULL DEFAULT '',
      app_msg_id TEXT, body TEXT NOT NULL, at TEXT NOT NULL, file_type TEXT, file_name TEXT, file BLOB,
      UNIQUE (ticket_id, app_msg_id)
    );
    CREATE TABLE IF NOT EXISTS ticket_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, buyer_id INTEGER NOT NULL, ticket_id INTEGER NOT NULL, message_id INTEGER, at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ticket_events_buyer ON ticket_events (buyer_id, id);
  `);
  // Older sites made the table before "source" existed: app = sent from their installed app, wizard = "I need a person" on the setup wizard.
  addColumn(db(), "tickets", "source", "TEXT NOT NULL DEFAULT 'app'");
  made = true;
}
export const ticketTables = tables;

export type Source = "app" | "wizard";
export interface Ticket { id: number; buyer_id: number; app_id: string; subject: string; status: Status; context: string; from_name: string; created_at: string; updated_at: string; source: Source }
export interface TicketMessage { id: number; ticket_id: number; author: "agency" | "support"; author_name: string; app_msg_id: string | null; body: string; at: string; file_type: string | null; file_name: string | null; has_file: number }
export interface TicketContext { url: string; appVersion: string; browser: string; agencyId: string; receptionistId: string; page: string }

// ---------------- cleaning what arrives ----------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Masks anything shaped like a key or token. A person pasting one into a help request shouldn't leave it with us. */
export function redactSecrets(s: string): string {
  return s
    .replace(/\b(authorization|api[_-]?key|token|secret|password|passwd|cookie)\b(\s*[:=]\s*)\S+/gi, "$1$2[hidden]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [hidden]")
    .replace(/\b[a-z]{2,6}_[A-Za-z0-9_-]{16,}\b/g, "[hidden key]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[hidden key]")
    .replace(/[A-Za-z0-9_\-+/=]{40,}/g, "[hidden key]");
}
export const text = (v: unknown, max: number, multiline = false) => {
  const t = typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, multiline ? "" : " ").trim() : "";
  return redactSecrets(t).slice(0, max);
};
/** A page address with no query, no hash and no path piece that looks like a token. Empty when it isn't an http(s) address. */
export function cleanUrl(v: unknown): string {
  try {
    const u = new URL(String(v ?? "").slice(0, 600));
    if (!/^https?:$/.test(u.protocol)) return "";
    const path = u.pathname.split("/").map((p) => (p.length >= 24 && !UUID.test(p) ? "[hidden]" : p)).join("/");
    return `${u.origin}${path}`.slice(0, 300);
  } catch { return ""; }
}
export function cleanContext(raw: any): TicketContext {
  const r = raw && typeof raw === "object" ? raw : {};
  const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : "");
  return {
    url: cleanUrl(r.url),
    page: text(r.page, 80),
    appVersion: /^[A-Za-z0-9._+-]{1,40}$/.test(String(r.appVersion ?? "")) ? String(r.appVersion) : "",
    browser: text(r.browser, 200),
    agencyId: id(r.agencyId),
    receptionistId: id(r.receptionistId),
  };
}

type Shot = { name: string; type: string; data: Buffer };
/** Null when there's no screenshot; a string when there is one and it isn't acceptable. */
export function cleanShot(raw: any): Shot | null | string {
  if (raw == null) return null;
  if (typeof raw !== "object") return "The screenshot isn't valid.";
  const type = String(raw.type ?? "").toLowerCase();
  const check = IMAGE_TYPES[type];
  if (!check) return "The screenshot must be a PNG, JPEG, GIF or WebP image.";
  const b64 = typeof raw.data === "string" ? raw.data : "";
  if (b64.length > Math.ceil((MAX_SCREENSHOT * 4) / 3) + 8) return "The screenshot is over 2 MB.";
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return "The screenshot isn't valid.";
  const data = Buffer.from(b64, "base64");
  if (!data.length || data.length > MAX_SCREENSHOT) return data.length ? "The screenshot is over 2 MB." : "The screenshot isn't valid.";
  if (!check(data)) return "The screenshot doesn't look like the image type it says.";
  return { name: text(raw.name, 80).replace(/[^\w .()-]/g, "") || "screenshot", type, data };
}

// ---------------- the hook for alerts ----------------
/**
 * Called once for each new ticket. Tells us on the same channels as other alerts (ALERT_WEBHOOK_URL, and email if
 * SITE_SMTP_URL is set) when the alerts module (alerts.ts) is present; does nothing when it isn't.
 */
export const ticketHooks = {
  async notifyNewTicket(t: { id: number; buyerId: number; subject: string }): Promise<void> {
    try {
      const mod: any = await import(/* @vite-ignore */ ["./", "alerts"].join(""));
      if (typeof mod.raise === "function") await mod.raise(t.buyerId, `problem:ticket-${t.id}`, `a new help request: "${t.subject.slice(0, 120)}"`);
    } catch { /* no alerts module on this site */ }
  },
};

// ---------------- storing ----------------
export const ticketById = (id: number): Ticket | null => (tables(), db().query("SELECT * FROM tickets WHERE id = ?").get(id) as Ticket | null);
export const touch = (id: number, status: Status) => db().query("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
// A setup-wizard request has no app to tell: its replies show on the wizard page instead.
const event = (t: Ticket, messageId: number | null) => t.source === "wizard" ? undefined : db().query("INSERT INTO ticket_events (buyer_id, ticket_id, message_id, at) VALUES (?, ?, ?, ?)").run(t.buyer_id, t.id, messageId, now());

export type ReceiveResult = { status: number; body: Record<string, unknown> };

/** One POST from an app: the ticket (made if new) and any messages on it. */
export async function receiveTicket(buyerId: number, rawBody: string): Promise<ReceiveResult> {
  tables();
  let raw: any;
  try { raw = JSON.parse(rawBody); } catch { return { status: 400, body: { error: "not json" } }; }
  const t = raw?.ticket;
  const appId = typeof t?.id === "string" && UUID.test(t.id) ? t.id.toLowerCase() : "";
  if (!appId) return { status: 400, body: { error: "ticket id missing" } };
  const msgs: any[] = Array.isArray(raw.messages) ? raw.messages.slice(0, MAX_MESSAGES_PER_POST) : [];
  const existing = db().query("SELECT * FROM tickets WHERE buyer_id = ? AND app_id = ? AND source = 'app'").get(buyerId, appId) as Ticket | null;
  const subject = text(t.subject, MAX_SUBJECT);
  if (!existing && (!subject || !msgs.length)) return { status: 400, body: { error: "a ticket needs a subject and a message" } };
  if (!existing && (db().query("SELECT COUNT(*) AS n FROM tickets WHERE buyer_id = ? AND status <> 'closed'").get(buyerId) as { n: number }).n >= MAX_OPEN_PER_AGENCY) return { status: 429, body: { error: "too many open tickets" } };

  // Check every message before writing any of them.
  const clean: { id: string; body: string; at: string; name: string; shot: Shot | null }[] = [];
  for (const m of msgs) {
    const id = typeof m?.id === "string" && UUID.test(m.id) ? m.id.toLowerCase() : "";
    const body = text(m?.body, MAX_TEXT, true);
    if (!id || !body) return { status: 400, body: { error: "a message needs an id and some text" } };
    const shot = cleanShot(m.screenshot);
    if (typeof shot === "string") return { status: 400, body: { error: shot } };
    const at = typeof m.at === "string" && !Number.isNaN(Date.parse(m.at)) ? new Date(m.at).toISOString() : now();
    clean.push({ id, body, at, name: text(m.name, 80), shot });
  }

  let ticket = existing;
  let created = false;
  if (!ticket) {
    const from = text(t.from, 80);
    const info = db().query("INSERT INTO tickets (buyer_id, app_id, subject, status, context, from_name, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?, ?)").run(buyerId, appId, subject, JSON.stringify(cleanContext(t.context)), from, now(), now());
    ticket = ticketById(Number(info.lastInsertRowid))!;
    created = true;
  }
  let added = 0;
  for (const m of clean) {
    const r = db().query("INSERT OR IGNORE INTO ticket_messages (ticket_id, author, author_name, app_msg_id, body, at, file_type, file_name, file) VALUES (?, 'agency', ?, ?, ?, ?, ?, ?, ?)")
      .run(ticket.id, m.name, m.id, m.body, m.at, m.shot?.type ?? null, m.shot?.name ?? null, m.shot ? m.shot.data : null);
    if (r.changes) added++;
  }
  // A new message from the agency puts the ticket back in front of us; "closed" from the app closes it.
  const want: Status | null = t.status === "closed" ? "closed" : added || (t.status === "open" && ticket.status === "closed") ? "open" : null;
  if (want && want !== ticket.status) touch(ticket.id, want);
  else if (added) touch(ticket.id, ticket.status);
  if (created) void ticketHooks.notifyNewTicket({ id: ticket.id, buyerId, subject: ticket.subject }).catch(() => {});
  return { status: 200, body: { ok: true, ticketId: ticket.id, created, added, status: ticketById(ticket.id)!.status } };
}

/** What happened on our side since `since`: replies and status changes, for this agency only. */
export function ticketUpdates(buyerId: number, since: number) {
  tables();
  const ev = db().query("SELECT e.id, e.ticket_id, e.message_id FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id AND t.source = 'app' WHERE e.buyer_id = ? AND e.id > ? ORDER BY e.id LIMIT 100").all(buyerId, Math.max(0, since)) as { id: number; ticket_id: number; message_id: number | null }[];
  const items = ev.map((e) => {
    const t = ticketById(e.ticket_id);
    const m = e.message_id ? (db().query("SELECT id, body, at, author_name FROM ticket_messages WHERE id = ? AND author = 'support'").get(e.message_id) as { id: number; body: string; at: string; author_name: string } | null) : null;
    return t ? { eventId: e.id, ticketId: t.app_id, status: t.status, message: m ? { id: m.id, body: m.body, at: m.at, author: m.author_name || "Support" } : null } : null;
  }).filter(Boolean);
  return { cursor: ev.length ? ev[ev.length - 1].id : Math.max(0, since), items };
}

/** The two /api/tickets routes. Same token and the same kind of limits as /api/sync. Null when the path isn't ours. */
export async function ticketsApi(req: Request, url: URL, ip: string): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/api/tickets" && path !== "/api/tickets/updates") return null;
  const json = (o: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...h } });
  const wantMethod = path === "/api/tickets" ? "POST" : "GET";
  if (req.method !== wantMethod) return json({ error: `${wantMethod} only` }, 405, { Allow: wantMethod });
  const buyerId = buyerBySyncToken(bearerOf(req));
  if (buyerId == null) {
    const retry = allow(`ticketbad:${ip}`, 30, 10 * 60_000);
    return retry ? json({ error: "too many tries" }, 429, { "Retry-After": String(retry) }) : json({ error: "unauthorised" }, 401);
  }
  if (path === "/api/tickets/updates") {
    const retry = allow(`ticketpoll:${buyerId}`, 60, 15 * 60_000);
    if (retry) return json({ error: "too many requests" }, 429, { "Retry-After": String(retry) });
    return json({ ok: true, ...ticketUpdates(buyerId, Number(url.searchParams.get("since")) || 0) });
  }
  const retry = allow(`ticket:${buyerId}`, 40, 60 * 60_000);
  if (retry) return json({ error: "too many requests" }, 429, { "Retry-After": String(retry) });
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_TICKET_BODY) return json({ error: "too large" }, 413);
  const body = (await req.text()).slice(0, MAX_TICKET_BODY + 1);
  if (body.length > MAX_TICKET_BODY) return json({ error: "too large" }, 413);
  const r = await receiveTicket(buyerId, body);
  return json(r.body, r.status);
}

// ---------------- the admin's side ----------------
export function messagesOf(ticketId: number): TicketMessage[] {
  tables();
  return db().query("SELECT id, ticket_id, author, author_name, app_msg_id, body, at, file_type, file_name, (file IS NOT NULL) AS has_file FROM ticket_messages WHERE ticket_id = ? ORDER BY id").all(ticketId) as TicketMessage[];
}
export function fileOf(ticketId: number, messageId: number): { type: string; name: string; data: Uint8Array } | null {
  tables();
  const r = db().query("SELECT file_type, file_name, file FROM ticket_messages WHERE id = ? AND ticket_id = ? AND file IS NOT NULL").get(messageId, ticketId) as { file_type: string; file_name: string; file: Uint8Array } | null;
  return r && IMAGE_TYPES[r.file_type] ? { type: r.file_type, name: r.file_name, data: r.file } : null;
}
export function openCount(): number {
  tables();
  return (db().query("SELECT COUNT(*) AS n FROM tickets WHERE status = 'open'").get() as { n: number }).n;
}
export function ticketCounts(): Record<Status, number> {
  tables();
  const out: Record<Status, number> = { open: 0, waiting: 0, closed: 0 };
  for (const r of db().query("SELECT status, COUNT(*) AS n FROM tickets GROUP BY status").all() as { status: Status; n: number }[]) if (r.status in out) out[r.status] = r.n;
  return out;
}
export interface TicketRow extends Ticket { agency: string; demo: number; last_at: string }
export function listTickets(status: Status | "all", buyerId?: number): TicketRow[] {
  tables();
  const where = [status === "all" ? "" : "t.status = ?", buyerId ? "t.buyer_id = ?" : ""].filter(Boolean).join(" AND ");
  const args = [status === "all" ? null : status, buyerId ?? null].filter((x) => x != null) as (string | number)[];
  return db().query(`SELECT t.*, COALESCE(b.name, 'Deleted agency') AS agency, COALESCE(b.demo, 0) AS demo, t.updated_at AS last_at FROM tickets t LEFT JOIN buyers b ON b.id = t.buyer_id ${where ? `WHERE ${where}` : ""} ORDER BY t.updated_at DESC LIMIT 300`).all(...args) as TicketRow[];
}
export function ticketsOfAgency(buyerId: number): TicketRow[] { return listTickets("all", buyerId); }

/** Our reply. The ticket goes to "waiting" (on the agency), and the app picks the reply up with its next heartbeat. */
export function replyToTicket(id: number, adminEmail: string, bodyIn: string): { ok: true } | { ok: false; message: string } {
  tables();
  const t = ticketById(id);
  if (!t) return { ok: false, message: "That ticket is gone." };
  const body = text(bodyIn, MAX_TEXT, true);
  if (!body) return { ok: false, message: "Write a reply first." };
  const r = db().query("INSERT INTO ticket_messages (ticket_id, author, author_name, body, at) VALUES (?, 'support', ?, ?, ?)").run(id, adminEmail.split("@")[0].slice(0, 40), body, now());
  touch(id, "waiting");
  event(t, Number(r.lastInsertRowid));
  return { ok: true };
}
export function setTicketStatus(id: number, status: Status): boolean {
  tables();
  const t = ticketById(id);
  if (!t) return false;
  if (t.status !== status) { touch(id, status); event(t, null); }
  return true;
}
export function deleteTickets(buyerId: number) {
  tables();
  db().query("DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE buyer_id = ?)").run(buyerId);
  db().query("DELETE FROM ticket_events WHERE buyer_id = ?").run(buyerId);
  db().query("DELETE FROM tickets WHERE buyer_id = ?").run(buyerId);
}

// ---------------- admin pages (bodies only: admin-web.ts puts them in the page) ----------------
const when = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") : "");
const pill = (s: Status) => `<span class="pill ${s === "open" ? "failed" : s === "waiting" ? "installing" : "live"}">${STATUS_LABEL[s]}</span>`;
const CSS = `<link rel="stylesheet" href="/tickets.css">`;

export function ticketsListHtml(filter: Status | "all"): string {
  const counts = ticketCounts();
  const rows = listTickets(filter);
  const tab = (s: Status | "all", label: string, n: number) => `<a class="tab${s === filter ? " on" : ""}" href="/admin/tickets${s === "open" ? "" : `?status=${s}`}">${label} <span class="n">${n}</span></a>`;
  return `${CSS}<section class="card">
<h1>Help tickets</h1>
<p class="lead">Requests from agencies: from their own app (a reply shows up in their dashboard within a few minutes) and, marked <span class="pill in-setup">Setup</span>, from someone stuck in the setup wizard (a reply shows on their setup page).</p>
<div class="tabs">${tab("open", "Open", counts.open)}${tab("waiting", "Waiting on agency", counts.waiting)}${tab("closed", "Closed", counts.closed)}${tab("all", "All", counts.open + counts.waiting + counts.closed)}</div>
${rows.length ? `<div class="xscroll"><table class="records tickets"><thead><tr><th>Agency</th><th>Subject</th><th>From</th><th>Status</th><th>Age</th></tr></thead><tbody>${rows.map((r) => `<tr>
<td data-l="Agency"><a href="/admin/b/${r.buyer_id}"><b>${esc(r.agency)}</b></a></td>
<td data-l="Subject"><a href="/admin/tickets/${r.id}">${esc(r.subject)}</a>${r.source === "wizard" ? ` <span class="pill in-setup" title="Asked for a person during setup">Setup</span>${wizardCtx(r).lastError ? `<br><span class="hint bad">${esc(wizardCtx(r).lastError!.slice(0, 140))}</span>` : ""}` : ""}</td>
<td data-l="From">${esc(r.from_name)}</td>
<td data-l="Status">${pill(r.status)}</td>
<td data-l="Age" title="${esc(when(r.created_at))} UTC">${esc(ago(r.last_at))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="hint">${filter === "open" ? "Nothing open. Nice." : "No tickets here."}</p>`}
</section>`;
}

export function ticketViewHtml(t: Ticket, hidden: string, flash = ""): string {
  const ctx = (() => { try { return JSON.parse(t.context) as Partial<TicketContext>; } catch { return {}; } })();
  const buyer = db().query("SELECT id, name FROM buyers WHERE id = ?").get(t.buyer_id) as { id: number; name: string } | null;
  const msgs = messagesOf(t.id);
  const wz = t.source === "wizard" ? wizardCtx(t) : null;
  const ctxRows: [string, string][] = wz
    ? [["Where", `<span class="pill in-setup">Setup</span> step: ${esc(wz.stepLabel || wz.step || "")}`], ["Last error on that step", wz.lastError ? `<span class="bad">${esc(wz.lastError)}</span>` : "None shown"], ["Brand", esc(wz.brand || "")],
      ["Keys they've given", wz.keysSet?.length ? esc(wz.keysSet.join(", ")) : "None yet"], ["Reach them at", [wz.contactEmail, wz.contactPhone].filter(Boolean).map((v) => esc(v!)).join(" · ")], ["Browser", esc(wz.browser || "")]]
    : [["Page", ctx.url ? esc(ctx.url) : ""], ["App version", esc(ctx.appVersion || "")], ["Browser", esc(ctx.browser || "")], ["Agency id", ctx.agencyId ? `<code>${esc(ctx.agencyId)}</code>` : ""], ["Receptionist id", ctx.receptionistId ? `<code>${esc(ctx.receptionistId)}</code>` : ""]];
  const act = (what: string, label: string, cls: string) => `<form method="post" action="/admin/tickets/${t.id}/${what}">${hidden}<button class="${cls}" type="submit">${label}</button></form>`;
  return `${CSS}<p><a href="/admin/tickets">← Help tickets</a></p>
<section class="card">
${flash}
<div class="titlerow"><h1>${esc(t.subject)}</h1>${pill(t.status)}</div>
<p class="lead">${buyer ? `<a href="/admin/b/${buyer.id}"><b>${esc(buyer.name)}</b></a>` : "A deleted agency"}${t.from_name ? ` · from ${esc(t.from_name)}` : ""} · opened ${esc(when(t.created_at))} UTC</p>
<div class="summary">${ctxRows.filter(([, v]) => v).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>
${buyer && wz ? `<div class="nav"><div class="right left"><a class="btn o" href="/admin/b/${buyer.id}">Agency page</a><a class="btn p" href="/admin/b/${buyer.id}#assist">Set up for them</a><a class="btn o" href="/admin/b/${buyer.id}/setup${wz.step ? `?step=${esc(wz.step)}` : ""}">See their step (read-only)</a></div></div>
<p class="hint">Your reply shows on their setup page next time they load it. They asked from the setup wizard, so nothing is installed yet${wz.contactEmail ? `; you can also email them at ${esc(wz.contactEmail)}` : ""}.</p>` : ""}
${buyer && !wz ? `<p class="hint">On their agency page: <a href="/admin/b/${buyer.id}">health, problems and recent logs</a>, and "View as" while Support access is on (it is unless they switched it off).</p>` : ""}
<div class="thread">${msgs.map((m) => `<div class="msg ${m.author}"><div class="who"><b>${m.author === "support" ? `You${m.author_name ? ` (${esc(m.author_name)})` : ""}` : esc(m.author_name || t.from_name || "Agency")}</b> <span class="hint">${esc(when(m.at))} UTC</span></div>
<div class="text">${esc(m.body)}</div>${m.has_file ? `<a href="/admin/tickets/${t.id}/file/${m.id}" target="_blank" rel="noopener noreferrer"><img class="shot" src="/admin/tickets/${t.id}/file/${m.id}" alt="Screenshot${m.file_name ? `: ${esc(m.file_name)}` : ""}"></a>` : ""}</div>`).join("")}</div>
${t.status === "closed" ? `<p class="hint">This ticket is closed. Replying reopens it for them.</p>` : ""}
<form method="post" action="/admin/tickets/${t.id}/reply" class="body">${hidden}
  <label class="f" for="reply">Your reply</label><textarea id="reply" name="body" rows="5" maxlength="${MAX_TEXT}" required></textarea>
  <div class="nav"><span></span><div class="right"><button class="btn p" type="submit">Send reply</button></div></div>
</form>
<div class="nav"><div class="right left">${t.status === "closed" ? act("reopen", "Reopen", "btn o") : act("close", "Close ticket", "btn o")}</div></div>
</section>`;
}

// ---------------- the setup wizard's "I need a person" (wizhelp.ts makes them) ----------------
export interface WizardContext { source: "wizard"; step: string; stepLabel: string; lastError: string; brand: string; keysSet: string[]; browser: string; contactEmail: string; contactPhone: string }
export function wizardCtx(t: Pick<Ticket, "context">): Partial<WizardContext> { try { return JSON.parse(t.context); } catch { return {}; } }
/** Agencies with a setup-wizard request waiting on us (status open), with the newest ticket id. */
export function needsHelp(): Map<number, number> {
  tables();
  const out = new Map<number, number>();
  for (const r of db().query("SELECT buyer_id, MAX(id) AS id FROM tickets WHERE source = 'wizard' AND status = 'open' GROUP BY buyer_id").all() as { buyer_id: number; id: number }[]) out.set(r.buyer_id, r.id);
  return out;
}
/**
 * For the live alert on every admin page (/admin/alerts/live): how many requests are waiting on us, and the newest
 * few that came in (or got a new message) after `since`. Never a message body: just who, where and a link.
 */
export function liveAlerts(sinceIso: string) {
  tables();
  const rows = db().query("SELECT t.id, t.buyer_id, t.source, t.subject, t.context, t.from_name, t.updated_at, COALESCE(b.name, 'Deleted agency') AS agency FROM tickets t LEFT JOIN buyers b ON b.id = t.buyer_id WHERE t.status = 'open' AND t.updated_at > ? ORDER BY t.updated_at DESC LIMIT 5").all(sinceIso) as (Ticket & { agency: string })[];
  return {
    open: openCount(),
    needsHelp: needsHelp().size,
    items: rows.map((r) => {
      const w = r.source === "wizard" ? wizardCtx(r) : null;
      return { id: r.id, agency: r.agency, source: r.source, step: w?.stepLabel || "", at: r.updated_at, url: `/admin/tickets/${r.id}`,
        text: w ? `${r.agency} needs help at the ${w.stepLabel || "setup"} step` : `${r.agency} sent a help request: ${r.subject.slice(0, 80)}` };
    }),
  };
}
/** "Agencies" in the nav, with a red count of agencies stuck in setup and asking for a person. */
export const agenciesNavHtml = (): string => { const n = needsHelp().size; return `<a href="/admin" data-nav="agencies">Agencies${n ? ` <span class="badge" data-badge="help" title="${n} need${n === 1 ? "s" : ""} help with setup">${n}</span>` : ` <span class="badge" data-badge="help" hidden></span>`}</a>`; };

/** The nav link, with a count when something is waiting for us. */
export const navLinkHtml = (): string => { const n = openCount(); return `<a href="/admin/tickets" data-nav="tickets">Help tickets${n ? ` <span class="badge" data-badge="open" title="${n} open">${n}</span>` : ` <span class="badge" data-badge="open" hidden></span>`}</a>`; };
