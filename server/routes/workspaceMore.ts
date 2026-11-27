import type { Business } from "../../src/lib/shared";
import { CalendarError, linkedEvents, providerOf } from "../calendars";
import { iso, sql } from "../db";
import { emailStatus } from "../email";
import { isPublicHost } from "../net";
import { ValidationError } from "../prompt";
import { saveClient } from "../store";
import { audit } from "../audit";
import { json, readBody, type ClientRouteArgs } from "./http";
import { manageDeps } from "./manage";
import { answeredCall, appointmentsFor, bizOf, isRefusedBooking, phoneKey, rangeOf, requestsOf, type CallRow, type StoredRequest } from "./workspace";

// The business app's Inbox, Calendar, Contacts and "connect your apps" box (the clean UI).
// Paths: /api/workspace/<clientId>/inbox | calendar | contacts | contacts/<key> | contacts.csv | mcp
// Same guards as server/routes/workspace.ts (the dispatcher has checked access; viewers read only).

const MINUTE = 60_000;
const DAY = 86_400_000;
const MAX_CALLS = 5000;
const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/* ------------------------------------------------------------------ */
/* Web chats                                                            */
/* ------------------------------------------------------------------ */

type ChatRow = { id: string; started_at: Date | string; last_message_at: Date | string; outcome: string | null; visitor_name: string; first: string | null };

async function chatsOf(clientId: string, from: Date, to: Date): Promise<ChatRow[]> {
  return (await sql`
    select c.id, c.started_at, c.last_message_at, c.outcome, c.visitor_name,
      (select m.content from webchat_messages m where m.conversation_id = c.id and m.role = 'user' order by m.id limit 1) as first
    from webchat_conversations c
    where c.client_id = ${clientId} and c.last_message_at between ${from} and ${to}
    order by c.last_message_at desc limit 1000`) as ChatRow[];
}

/** The booking or message a chat left behind: a web request logged while the chat ran. */
function requestForChat(chat: ChatRow, requests: StoredRequest[]): StoredRequest | undefined {
  const a = new Date(chat.started_at).getTime();
  const b = new Date(chat.last_message_at).getTime() + 5 * MINUTE;
  return requests.find((r) => r.channel === "web" && Date.parse(r.at) >= a - MINUTE && Date.parse(r.at) <= b);
}

/* ------------------------------------------------------------------ */
/* Inbox                                                                */
/* ------------------------------------------------------------------ */

async function inbox(args: ClientRouteArgs) {
  const client = args.client!;
  const { from, to } = rangeOf(args.url);
  const [rows, requests, biz, chats, mail] = await Promise.all([
    sql`select * from call_log where client_id = ${client.id} and started_at between ${from} and ${to} order by started_at desc limit ${MAX_CALLS}`,
    requestsOf(client.id),
    bizOf(client, args.clientOrgId!),
    chatsOf(client.id, from, to),
    emailStatus(client.id).catch(() => null),
  ]);
  const items: any[] = [];
  for (const c of rows as CallRow[]) {
    const a = answeredCall(c, client, biz, requests);
    items.push({
      id: c.id,
      kind: c.channel.startsWith("sms") ? "text" : "call",
      at: a.started_at,
      who: a.contact.full_name,
      phone: c.from_number,
      email: null,
      summary: c.summary,
      outcome: a.outcome,
      callId: c.id,
      booking: a.outcome === "booked",
    });
  }
  for (const ch of chats) {
    const r = requestForChat(ch, requests);
    items.push({
      id: `chat-${ch.id}`,
      kind: "chat",
      at: iso(ch.last_message_at),
      who: ch.visitor_name || r?.name || null,
      phone: r?.phone || null,
      email: r?.email || null,
      summary: ch.first ? clip(ch.first, 200) : null,
      outcome: ch.outcome === "booked" ? "booked" : ch.outcome === "callback" ? "callback_requested" : null,
      callId: null,
      booking: ch.outcome === "booked",
    });
  }
  for (const m of mail?.activity ?? []) {
    const at = Date.parse(m.receivedAt);
    if (m.action === "skipped" || !Number.isFinite(at) || at < from.getTime() || at > to.getTime()) continue;
    const match = m.from.match(/^(.*?)\s*<([^>]+)>/);
    items.push({
      id: `email-${m.id}`,
      kind: "email",
      at: new Date(at).toISOString(),
      who: match?.[1]?.replace(/"/g, "").trim() || null,
      phone: null,
      email: (match?.[2] ?? m.from).toLowerCase(),
      summary: clip(`${m.subject}${m.note ? ` (${m.note})` : ""}`, 200),
      outcome: m.action === "sent" ? "replied" : m.action === "drafted" ? "draft_ready" : "failed",
      callId: null,
      booking: false,
    });
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  return json({ items });
}

/* ------------------------------------------------------------------ */
/* Calendar                                                             */
/* ------------------------------------------------------------------ */

function calRange(url: URL): { from: number; to: number } {
  const f = Date.parse(url.searchParams.get("from") ?? "");
  const t = Date.parse(url.searchParams.get("to") ?? "");
  const from = Number.isFinite(f) ? f : Date.now() - 7 * DAY;
  const to = Number.isFinite(t) ? t : from + 70 * DAY;
  if (to < from) throw new ValidationError("The start of the range is after its end.");
  return { from, to: Math.min(to, from + 400 * DAY) };
}

const CAL_STATUS: Record<string, string> = { pending: "pending", declined: "declined", cancelled: "cancelled", confirmed: "confirmed", completed: "confirmed", no_show: "confirmed" };

async function calendar(args: ClientRouteArgs) {
  const client = args.client!;
  const { from, to } = calRange(args.url);
  const appts = (await appointmentsFor(client)).filter((a) => {
    const t = Date.parse(a.starts_at);
    return t >= from && t <= to;
  });
  const events: any[] = appts.map((a) => ({
    id: a.id,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    title: a.service || "Appointment",
    customer_name: a.customer_name,
    phone: a.customer_phone,
    status: CAL_STATUS[a.status] ?? "confirmed",
    source: String(a.id).startsWith("cal-") ? "builtin" : "booking",
    requestId: String(a.id).startsWith("cal-") ? null : a.id,
  }));
  // Events on a linked Google or Outlook calendar that we didn't make. A failure just leaves them out.
  const provider = providerOf(client);
  if (client.booking && provider !== "builtin") {
    try {
      const known = appts.map((a) => Date.parse(a.starts_at));
      for (const e of await linkedEvents(client, from, to)) {
        // Ours: made by the receptionist, or the same start as one of the bookings above.
        if (/Booked by the AI receptionist/.test(e.description) || known.some((k) => Math.abs(k - e.start) < 5 * MINUTE)) continue;
        events.push({
          id: `ext-${e.id}`,
          starts_at: new Date(e.start).toISOString(),
          ends_at: new Date(e.end).toISOString(),
          title: e.title,
          customer_name: null,
          phone: null,
          status: "confirmed",
          source: provider === "google" ? "google" : "microsoft",
          requestId: null,
        });
      }
    } catch (err) {
      if (!(err instanceof CalendarError)) console.error(`[calendar ${client.id}]`, (err as Error).message);
    }
  }
  events.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return json({ events });
}

/* ------------------------------------------------------------------ */
/* Contacts                                                             */
/* ------------------------------------------------------------------ */

const STATUSES = ["new", "active", "customer", "closed"];
type Entry = { at: string; kind: "call" | "text" | "booking" | "callback" | "chat"; title: string; summary: string | null; callId: string | null };
type Contact = { id: string; name: string; phone: string; email: string; status: string; notes: string; last_at: string; counts: { calls: number; bookings: number; chats: number }; timeline: Entry[] };

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const KEY = /^(?:\d{3,20}|e:[^\s/]{3,254})$/;

async function buildContacts(client: Business): Promise<Contact[]> {
  const from = new Date(Date.now() - 400 * DAY);
  const [requests, calls, chats, notes] = await Promise.all([
    requestsOf(client.id),
    sql`select * from call_log where client_id = ${client.id} and started_at > ${from} order by started_at desc limit ${MAX_CALLS}` as Promise<CallRow[]>,
    chatsOf(client.id, from, new Date()),
    sql`select key, name, notes, status from contact_notes where client_id = ${client.id}`,
  ]);
  const byKey = new Map<string, Contact>();
  const emailKey = new Map<string, string>();
  const get = (key: string): Contact => {
    let c = byKey.get(key);
    if (!c) byKey.set(key, (c = { id: key, name: "", phone: "", email: "", status: "new", notes: "", last_at: "", counts: { calls: 0, bookings: 0, chats: 0 }, timeline: [] }));
    return c;
  };
  const keyOf = (phone: string | null | undefined, email: string | null | undefined): string | null => {
    const p = phoneKey(phone);
    const e = String(email ?? "").trim().toLowerCase();
    if (p.length >= 3) {
      if (EMAIL.test(e)) emailKey.set(e, p);
      return p;
    }
    if (EMAIL.test(e)) return emailKey.get(e) ?? `e:${e}`;
    return null;
  };
  const add = (c: Contact, at: string, e: Entry, who: { name?: string; phone?: string | null; email?: string | null }) => {
    c.timeline.push({ ...e, at });
    if (at > c.last_at) c.last_at = at;
    // The newest entry's details win (requests/calls arrive newest first).
    if (!c.name && who.name) c.name = who.name;
    if (!c.phone && who.phone) c.phone = who.phone;
    if (!c.email && who.email) c.email = who.email.toLowerCase();
  };
  // Requests with both a phone and an email first, so an email-only entry can join the phone's contact.
  for (const r of requests) keyOf(r.phone, r.email);
  for (const r of requests) {
    const key = keyOf(r.phone, r.email);
    if (!key) continue;
    const c = get(key);
    if (r.kind === "callback") {
      add(c, r.at, { at: r.at, kind: "callback", title: r.service ? `Call back: ${r.service}` : "Asked for a call back", summary: r.note || null, callId: null }, r);
    } else if (!isRefusedBooking(r)) {
      c.counts.bookings++;
      const state = r.status === "pending" ? "needs approval" : r.status === "declined" ? "declined" : (r as any).apptStatus === "cancelled" ? "cancelled" : "booked";
      add(c, r.at, { at: r.at, kind: "booking", title: `${r.service || "Booking"} (${state}) for ${r.start.slice(0, 16).replace("T", " ")}`, summary: r.note || null, callId: null }, r);
    }
  }
  for (const call of calls) {
    const key = keyOf(call.from_number, null);
    if (!key) continue;
    const c = get(key);
    const text = call.channel.startsWith("sms");
    if (!text) c.counts.calls++;
    const at = iso(call.started_at);
    add(c, at, { at, kind: text ? "text" : "call", title: text ? "Text conversation" : `Call${call.outcome ? ` (${call.outcome.replace(/_/g, " ")})` : ""}`, summary: call.summary, callId: call.id }, { phone: call.from_number });
  }
  // A chat belongs to the visitor whose booking or message it produced.
  for (const ch of chats) {
    const r = requestForChat(ch, requests);
    const key = r ? keyOf(r.phone, r.email) : null;
    if (!key) continue;
    const c = get(key);
    c.counts.chats++;
    const at = iso(ch.last_message_at);
    add(c, at, { at, kind: "chat", title: "Website chat", summary: ch.first ? clip(ch.first, 200) : null, callId: null }, { name: ch.visitor_name || r?.name });
  }
  for (const n of notes as any[]) {
    const c = byKey.get(n.key);
    if (!c) continue;
    c.notes = n.notes;
    c.status = n.status;
    if (n.name) c.name = n.name;
  }
  // Names that came from a request: use the newest one (requests are newest first).
  const out = [...byKey.values()];
  for (const c of out) {
    c.timeline.sort((a, b) => b.at.localeCompare(a.at));
    if (!c.phone && /^\d+$/.test(c.id)) c.phone = c.id;
  }
  return out.sort((a, b) => b.last_at.localeCompare(a.last_at));
}

const summaryOf = ({ timeline: _t, ...c }: Contact) => c;

const csvCell = (v: unknown) => {
  let s = String(v ?? "");
  // A spreadsheet runs a cell that starts with these as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function contactsCsv(args: ClientRouteArgs) {
  const list = await buildContacts(args.client!);
  const head = ["Name", "Phone", "Email", "Status", "Last contact", "Calls", "Bookings", "Chats", "Notes"];
  const rows = list.map((c) => [c.name, c.phone, c.email, c.status, c.last_at, c.counts.calls, c.counts.bookings, c.counts.chats, c.notes]);
  const body = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="contacts.csv"' } });
}

async function patchContact(args: ClientRouteArgs, key: string) {
  const client = args.client!;
  const body = await readBody(args.req);
  const list = await buildContacts(client);
  const existing = list.find((c) => c.id === key);
  if (!existing) throw new ValidationError("Unknown contact.");
  const name = body.name !== undefined ? clip(body.name, 80) : existing.name;
  const notes = body.notes !== undefined ? clip(body.notes, 4000) : existing.notes;
  const status = body.status !== undefined ? String(body.status) : existing.status;
  if (!STATUSES.includes(status)) throw new ValidationError("Choose New, Active, Customer or Closed.");
  await sql`
    insert into contact_notes (client_id, key, name, notes, status) values (${client.id}, ${key}, ${name}, ${notes}, ${status})
    on conflict (client_id, key) do update set name = excluded.name, notes = excluded.notes, status = excluded.status, updated_at = now()`;
  await audit(args.ctx, "contact.updated", { summary: "Contact notes changed" }, { orgId: args.clientOrgId!, clientId: client.id });
  return json({ contact: summaryOf({ ...existing, name, notes, status }) });
}

/* ------------------------------------------------------------------ */
/* Connect your apps (MCP)                                              */
/* ------------------------------------------------------------------ */

const mcpView = (c: Business) => ({ mcp: { url: c.mcp?.url ?? "", headerName: c.mcp?.headerName ?? "", hasHeader: Boolean(c.mcp?.headerName && c.mcp?.headerValue) } });

async function putMcp(args: ClientRouteArgs) {
  const client = args.client!;
  const body = await readBody(args.req);
  const url = clip(body.url, 500);
  let next: Business;
  if (!url) {
    const { mcp: _m, ...rest } = client;
    next = rest as Business;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ValidationError("That isn't a valid link.");
    }
    if (parsed.protocol !== "https:") throw new ValidationError("The link must start with https://");
    if (!(await isPublicHost(parsed.hostname))) throw new ValidationError("The link must be a public website.");
    const headerName = clip(body.headerName, 60);
    if (headerName && !/^[A-Za-z0-9-]{1,60}$/.test(headerName)) throw new ValidationError("The header name can only have letters, numbers and dashes.");
    // Leaving the value blank keeps the saved one (it is never sent back to the browser).
    const given = clip(body.headerValue, 500);
    const keep = headerName && !given && client.mcp?.headerName === headerName ? client.mcp.headerValue : "";
    const headerValue = headerName ? given || keep || "" : "";
    if (headerName && !headerValue) throw new ValidationError("Enter the header's value, or clear the header name.");
    next = { ...client, mcp: { url, ...(headerName ? { headerName, headerValue } : {}) } };
  }
  await saveClient(next);
  let warning = "";
  try {
    await manageDeps()?.syncAssistant(next);
  } catch (err) {
    warning = `Saved, but the phone assistant couldn't be updated just now: ${(err as Error).message}`;
  }
  await audit(args.ctx, "integration.mcp.saved", { summary: url ? "Connected apps link saved" : "Connected apps link removed" }, { orgId: args.clientOrgId!, clientId: client.id });
  return json({ ...mcpView(next), ...(warning ? { warning } : {}) });
}

/* ------------------------------------------------------------------ */
/* Router                                                               */
/* ------------------------------------------------------------------ */

export async function workspaceMoreRoutes(args: ClientRouteArgs): Promise<Response | null> {
  const { client, method, rest } = args;
  if (!client || !args.clientOrgId) return null;
  const get = method === "GET" || method === "HEAD";
  if (!get && args.access === "viewer") return json({ error: "Your access to this business is view-only. Ask a manager to change it." }, 403);

  if (rest === "/inbox" && get) return inbox(args);
  if (rest === "/calendar" && get) return calendar(args);
  if (rest === "/contacts" && get) return json({ contacts: (await buildContacts(client)).map(summaryOf) });
  if (rest === "/contacts.csv" && get) return contactsCsv(args);
  const one = rest.match(/^\/contacts\/([^/]+)$/);
  if (one) {
    let key = "";
    try {
      key = decodeURIComponent(one[1]).replace(/^\+/, "");
    } catch {
      throw new ValidationError("Unknown contact.");
    }
    if (!KEY.test(key)) throw new ValidationError("Unknown contact.");
    if (method === "PATCH") return patchContact(args, key);
    if (get) {
      const c = (await buildContacts(client)).find((x) => x.id === key);
      return c ? json({ contact: summaryOf(c), timeline: c.timeline }) : json({ error: "That contact isn't here any more." }, 404);
    }
  }
  if (rest === "/mcp") {
    if (get) return json(mcpView(client));
    if (method === "PUT") return putMcp(args);
  }
  return null;
}
