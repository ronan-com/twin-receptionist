import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./accounts";
import { sql } from "./db";
import { ValidationError } from "./prompt";
import { json, readBody, type RouteArgs } from "./routes/http";
import { getSetting, putSetting } from "./store";
import { supportSeller } from "./supportAccess";
import { supportConfig } from "./supportSync";

// Help tickets: "Contact support" in the help (?) menu.
//   - An agency's owner or admin writes to the setup provider (route "platform"). The ticket is sent to the setup
//     site (POST /api/tickets, with the same token as the heartbeat) and its replies come back the same way
//     (GET /api/tickets/updates), then show in the agency's "Support requests" with an unread dot.
//   - A business user writes to their own agency (route "agency"). Those never leave this app: they land in the
//     agency's "Support requests" list, and the agency replies there.
// What leaves this app for a platform ticket is fixed: the subject, the messages, an optional screenshot (an image,
// at most 2 MB) and a small context (page address without query or tokens, app version, browser, agency id,
// receptionist id). Never a key, and anything shaped like one is masked first.
//   GET  /api/tickets                 what I can see: my requests, the agency inbox, unread count, where a new one would go
//   POST /api/tickets                 { subject, message, screenshot?, page?, clientId? }
//   GET  /api/tickets/<id>            the conversation (clears the unread dot)
//   GET  /api/tickets/<id>/shot/<m>   a screenshot
//   POST /api/tickets/<id>/reply | close | reopen

export const MAX_SHOT = 2 * 1024 * 1024;
const MAX_BODY = Math.ceil((MAX_SHOT * 4) / 3) + 64 * 1024;
const MAX_SUBJECT = 160;
const MAX_TEXT = 5000;
const IMAGE: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1")),
  "image/webp": (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_KEY = "support_tickets_cursor";

// ---------------------------------------------------------------------------------------------
// Cleaning what a person types
// ---------------------------------------------------------------------------------------------

/** Masks anything shaped like a key or token. Someone pasting one into a help request shouldn't send it anywhere. */
export function redactSecrets(s: string): string {
  return s
    .replace(/\b(authorization|api[_-]?key|token|secret|password|passwd|cookie)\b(\s*[:=]\s*)\S+/gi, "$1$2[hidden]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [hidden]")
    .replace(/\b[a-z]{2,6}_[A-Za-z0-9_-]{16,}\b/g, "[hidden key]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[hidden key]")
    .replace(/[A-Za-z0-9_\-+/=]{40,}/g, "[hidden key]");
}
function clean(v: unknown, max: number, multiline = false): string {
  const t = typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, multiline ? "" : " ").trim() : "";
  return redactSecrets(t).slice(0, max);
}
/** A page address with no query, no hash and no path piece that looks like a token. Empty if it isn't an http(s) address. */
export function cleanPageUrl(v: unknown): string {
  try {
    const u = new URL(String(v ?? "").slice(0, 600));
    if (!/^https?:$/.test(u.protocol)) return "";
    const path = u.pathname.split("/").map((p) => (p.length >= 24 && !UUID.test(p) ? "[hidden]" : p)).join("/");
    return `${u.origin}${path}`.slice(0, 300);
  } catch {
    return "";
  }
}
type Shot = { name: string; type: string; data: Buffer };
/** Null when there is no screenshot. Throws a ValidationError when there is one and it isn't an image under 2 MB. */
export function readShot(raw: any): Shot | null {
  if (raw == null) return null;
  if (typeof raw !== "object") throw new ValidationError("The screenshot isn't valid.");
  const type = String(raw.type ?? "").toLowerCase();
  const check = IMAGE[type];
  if (!check) throw new ValidationError("The screenshot must be a PNG, JPEG, GIF or WebP image.");
  const b64 = typeof raw.data === "string" ? raw.data : "";
  if (b64.length > Math.ceil((MAX_SHOT * 4) / 3) + 8) throw new ValidationError("The screenshot is over 2 MB. Try a smaller one.");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new ValidationError("The screenshot isn't valid.");
  const data = Buffer.from(b64, "base64");
  if (data.length > MAX_SHOT) throw new ValidationError("The screenshot is over 2 MB. Try a smaller one.");
  if (!data.length || !check(data)) throw new ValidationError("The screenshot isn't a valid image.");
  return { name: clean(raw.name, 80).replace(/[^\w .()-]/g, "") || "screenshot", type, data };
}

function appVersion(): string {
  const env = (process.env.APP_VERSION ?? "").trim();
  if (env) return env.slice(0, 40);
  try {
    return String(JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")).version ?? "").slice(0, 40);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------------------------

export type Route = "platform" | "agency";
export type Side = "requester" | "agency";
export type Row = {
  id: string; org_id: string; client_id: string | null; user_id: string | null; from_name: string; route: Route; subject: string;
  status: "open" | "waiting" | "closed"; context: Record<string, string>; requester_unread: boolean; agency_unread: boolean;
  needs_push: boolean; push_error: string; created_at: Date; updated_at: Date;
};
const isStaff = (ctx: Ctx) => ctx.role === "owner" || ctx.role === "admin" || ctx.role === "member";
const isManager = (ctx: Ctx) => ctx.role === "owner" || ctx.role === "admin";
const readOnly = (ctx: Ctx) => Boolean(ctx.viewing);

/** Where a new request from this person would go, or why it can't be sent. */
export function routeFor(ctx: Ctx): { route: Route | null; why: string } {
  if (readOnly(ctx) || !ctx.org) return { route: null, why: "You're looking at this account read-only." };
  if (ctx.role === "customer") return { route: "agency", why: "" };
  if (isManager(ctx)) return supportConfig().ok ? { route: "platform", why: "" } : { route: null, why: "Contacting support isn't set up on this copy of the app." };
  return { route: null, why: "Ask an owner or admin of your agency to contact support." };
}

/** How this person relates to a ticket: the one who asked, the agency answering, or neither. */
export function sideOf(ctx: Ctx, t: Row): Side | null {
  if (!ctx.org || ctx.org.id !== t.org_id) return null;
  if (t.user_id && t.user_id === ctx.user.id) return "requester";
  if (!isStaff(ctx)) return null;
  if (t.route === "agency") return "agency";
  return isManager(ctx) ? "requester" : null;
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

export type Summary = { id: string; subject: string; status: Row["status"]; route: Route; from: string; business: string; createdAt: string; updatedAt: string; unread: boolean; last: string };
type ListRow = Row & { business: string | null; last: string | null };

function summary(t: ListRow, side: Side): Summary {
  return {
    id: t.id, subject: t.subject, status: t.status, route: t.route, from: t.from_name, business: t.business ?? "",
    createdAt: new Date(t.created_at).toISOString(), updatedAt: new Date(t.updated_at).toISOString(),
    unread: side === "agency" ? t.agency_unread : t.requester_unread, last: (t.last ?? "").slice(0, 120),
  };
}

export async function listTickets(ctx: Ctx) {
  const where = routeFor(ctx);
  if (!ctx.org) return { canCreate: false, route: null, why: where.why, seller: supportSeller(), unread: 0, mine: [], inbox: [] };
  const rows = (await sql`
    select t.*, c.data->'settings'->>'businessName' as business,
      (select body from support_ticket_messages m where m.ticket_id = t.id order by m.created_at desc limit 1) as last
    from support_tickets t left join clients c on c.id = t.client_id
    where t.org_id = ${ctx.org.id} order by t.updated_at desc limit 300`) as ListRow[];
  const mine: Summary[] = [];
  const inbox: Summary[] = [];
  for (const t of rows) {
    const side = sideOf(ctx, t);
    if (!side) continue;
    // Agency staff see client requests in the inbox; their own and their team's requests to support are "mine".
    if (side === "agency" && t.user_id !== ctx.user.id) inbox.push(summary(t, "agency"));
    else mine.push(summary(t, side));
  }
  return { canCreate: where.route !== null, route: where.route, why: where.why, seller: supportSeller(), unread: mine.filter((x) => x.unread).length + inbox.filter((x) => x.unread).length, mine, inbox };
}

export async function ticketFor(ctx: Ctx, id: string): Promise<{ t: Row; side: Side } | null> {
  if (!UUID.test(id)) return null;
  const [t] = (await sql`select * from support_tickets where id = ${id}`) as Row[];
  const side = t ? sideOf(ctx, t) : null;
  return t && side ? { t, side } : null;
}

export async function conversation(ctx: Ctx, id: string) {
  const f = await ticketFor(ctx, id);
  if (!f) return null;
  const { t, side } = f;
  const msgs = await sql`select id, author, author_name, body, shot_type is not null as has_shot, shot_name, created_at from support_ticket_messages where ticket_id = ${id} order by created_at, id`;
  // Reading clears the dot for this side (not while the platform team is only looking).
  if (!readOnly(ctx)) {
    if (side === "agency" && t.agency_unread) await sql`update support_tickets set agency_unread = false where id = ${id}`;
    if (side === "requester" && t.requester_unread) await sql`update support_tickets set requester_unread = false where id = ${id}`;
  }
  const [biz] = t.client_id ? await sql`select data->'settings'->>'businessName' as name from clients where id = ${t.client_id}` : [null];
  return {
    ticket: { id: t.id, subject: t.subject, status: t.status, route: t.route, from: t.from_name, business: biz?.name ?? "", createdAt: new Date(t.created_at).toISOString(), context: t.context, pushError: t.push_error },
    side,
    canReply: !readOnly(ctx),
    // Who the other end is, for the page's wording.
    otherParty: t.route === "platform" ? supportSeller() : side === "agency" ? t.from_name || "the business" : "your agency",
    messages: msgs.map((m: any) => ({ id: m.id, author: m.author, name: m.author_name, body: m.body, at: new Date(m.created_at).toISOString(), shot: m.has_shot ? `/api/tickets/${id}/shot/${m.id}` : null, shotName: m.shot_name ?? "" })),
  };
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

export async function createTicket(ctx: Ctx, input: any, headers: { userAgent?: string } = {}): Promise<{ id: string; route: Route }> {
  const { route, why } = routeFor(ctx);
  if (!route || !ctx.org) throw new ValidationError(why || "You can't send a request from here.");
  const subject = clean(input?.subject, MAX_SUBJECT);
  const message = clean(input?.message, MAX_TEXT, true);
  if (!subject) throw new ValidationError("Give your request a subject.");
  if (!message) throw new ValidationError("Tell us what's wrong.");
  const shot = readShot(input?.screenshot);
  const [{ n }] = await sql`select count(*)::int as n from support_tickets where org_id = ${ctx.org.id} and created_at > now() - interval '1 hour'`;
  const [{ me }] = await sql`select count(*)::int as me from support_tickets where user_id = ${ctx.user.id} and created_at > now() - interval '1 hour'`;
  if (me >= 10 || n >= 30) throw new ValidationError("That's a lot of requests in a short time. Wait a little, or add to one you already sent.");
  // A business user's request is about one of their businesses.
  let clientId: string | null = null;
  if (ctx.role === "customer") {
    const mine = await sql`select client_id from client_access where user_id = ${ctx.user.id}`;
    const want = typeof input?.clientId === "string" ? input.clientId : "";
    clientId = mine.find((r: any) => r.client_id === want)?.client_id ?? mine[0]?.client_id ?? null;
  } else if (typeof input?.clientId === "string" && UUID.test(input.clientId)) {
    const [c] = await sql`select id from clients where id = ${input.clientId} and org_id = ${ctx.org.id}`;
    clientId = c?.id ?? null;
  }
  const context = {
    url: cleanPageUrl(input?.page), appVersion: appVersion(),
    browser: clean(headers.userAgent || input?.browser, 200),
    agencyId: ctx.org.id, receptionistId: clientId ?? "",
  };
  const from = clean(ctx.user.name || ctx.user.email.split("@")[0], 80);
  const id = await sql.begin(async (tx) => {
    const [t] = await tx`insert into support_tickets (org_id, client_id, user_id, from_name, route, subject, context, needs_push, agency_unread)
      values (${ctx.org!.id}, ${clientId}, ${ctx.user.id}, ${from}, ${route}, ${subject}, ${context as any}, ${route === "platform"}, ${route === "agency"}) returning id`;
    await tx`insert into support_ticket_messages (ticket_id, author, author_name, body, shot, shot_type, shot_name)
      values (${t.id}, 'requester', ${from}, ${message}, ${shot?.data ?? null}, ${shot?.type ?? null}, ${shot?.name ?? null})`;
    return t.id as string;
  });
  if (route === "platform") void pushTickets().catch((e) => console.error("[tickets] push", (e as Error).message));
  return { id, route };
}

export async function replyToTicket(ctx: Ctx, id: string, input: any): Promise<void> {
  const f = await ticketFor(ctx, id);
  if (!f) throw new ValidationError("That request isn't yours to answer.");
  if (readOnly(ctx)) throw new ValidationError("You're looking at this account read-only.");
  const { t, side } = f;
  const message = clean(input?.message, MAX_TEXT, true);
  if (!message) throw new ValidationError("Write your reply first.");
  const shot = readShot(input?.screenshot);
  const author = side === "agency" ? "agency" : "requester";
  const name = clean(ctx.user.name || ctx.user.email.split("@")[0], 80);
  await sql.begin(async (tx) => {
    await tx`insert into support_ticket_messages (ticket_id, author, author_name, body, shot, shot_type, shot_name)
      values (${id}, ${author}, ${name}, ${message}, ${shot?.data ?? null}, ${shot?.type ?? null}, ${shot?.name ?? null})`;
    // An agency's answer waits on the business; anything else puts it back in front of whoever answers.
    if (t.route === "agency") await tx`update support_tickets set status = ${author === "agency" ? "waiting" : "open"}, requester_unread = ${author === "agency"}, agency_unread = ${author !== "agency"}, updated_at = now() where id = ${id}`;
    else await tx`update support_tickets set status = 'open', needs_push = true, updated_at = now() where id = ${id}`;
  });
  if (t.route === "platform") void pushTickets().catch((e) => console.error("[tickets] push", (e as Error).message));
}

export async function setStatus(ctx: Ctx, id: string, status: "closed" | "open"): Promise<void> {
  const f = await ticketFor(ctx, id);
  if (!f) throw new ValidationError("That request isn't yours.");
  if (readOnly(ctx)) throw new ValidationError("You're looking at this account read-only.");
  const { t, side } = f;
  await sql`update support_tickets set status = ${status}, updated_at = now(),
    needs_push = needs_push or ${t.route === "platform"},
    requester_unread = requester_unread or ${t.route === "agency" && side === "agency"},
    agency_unread = agency_unread or ${t.route === "agency" && side === "requester"} where id = ${id}`;
  if (t.route === "platform") void pushTickets().catch((e) => console.error("[tickets] push", (e as Error).message));
}

export async function screenshot(ctx: Ctx, id: string, messageId: string): Promise<Response | null> {
  if (!UUID.test(messageId) || !(await ticketFor(ctx, id))) return null;
  const [m] = await sql`select shot, shot_type from support_ticket_messages where id = ${messageId} and ticket_id = ${id} and shot is not null`;
  if (!m || !IMAGE[m.shot_type]) return null;
  return new Response(m.shot, { headers: { "Content-Type": m.shot_type, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store" } });
}

// ---------------------------------------------------------------------------------------------
// To and from the setup site
// ---------------------------------------------------------------------------------------------

const siteBase = (): { tickets: string; updates: string; token: string } | null => {
  const c = supportConfig();
  if (!c.ok) return null;
  const u = new URL(c.url);
  return { tickets: new URL("/api/tickets", u).toString(), updates: new URL("/api/tickets/updates", u).toString(), token: c.token };
};

/** The one way out, swappable in tests. */
export const ticketDeps = { fetch: ((u: any, i: any) => fetch(u, i)) as typeof fetch };

let pushing: Promise<void> | null = null;
/** Sends every platform ticket that has something new. A refused ticket (4xx other than "slow down") is parked with the reason. One send at a time. */
export async function pushTickets(doFetch: typeof fetch = ticketDeps.fetch): Promise<void> {
  while (pushing) await pushing.catch(() => {});
  pushing = (async () => {
    try {
      const site = siteBase();
      if (!site) return;
      const rows = (await sql`select * from support_tickets where route = 'platform' and needs_push order by created_at limit 20`) as Row[];
      for (const t of rows) {
        const msgs = await sql`select id, author_name, body, created_at, shot, shot_type, shot_name from support_ticket_messages where ticket_id = ${t.id} and author = 'requester' and not pushed order by created_at, id limit 20`;
        const payload = {
          ticket: { id: t.id, subject: t.subject, from: t.from_name, context: t.context, status: t.status === "closed" ? "closed" : "open" },
          messages: msgs.map((m: any) => ({ id: m.id, body: m.body, at: new Date(m.created_at).toISOString(), name: m.author_name, ...(m.shot ? { screenshot: { name: m.shot_name, type: m.shot_type, data: Buffer.from(m.shot).toString("base64") } } : {}) })),
        };
        let res: Response;
        try {
          res = await doFetch(site.tickets, { method: "POST", headers: { authorization: `Bearer ${site.token}`, "content-type": "application/json" }, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(20_000) });
        } catch (e) {
          console.error("[tickets] couldn't reach the setup site:", (e as Error).name);
          return;
        }
        if (res.ok) {
          await sql`update support_ticket_messages set pushed = true where id in ${sql(msgs.map((m: any) => m.id))}`;
          await sql`update support_tickets set needs_push = false, push_error = '' where id = ${t.id}`;
        } else if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 401) {
          await sql`update support_tickets set needs_push = false, push_error = ${`The setup site refused it (${res.status}).`} where id = ${t.id}`;
        } else {
          console.error(`[tickets] the setup site answered ${res.status}; will retry`);
          return;
        }
      }
    } catch (e) {
      console.error("[tickets] push", (e as Error).message);
    }
  })();
  try {
    await pushing;
  } finally {
    pushing = null;
  }
}

let pulledAt = 0;
/** Replies and status changes from the setup site since the last cursor. Safe to call often (it waits 20 seconds between asks). */
export async function pullUpdates(doFetch: typeof fetch = ticketDeps.fetch, force = false): Promise<number> {
  const site = siteBase();
  if (!site || (!force && Date.now() - pulledAt < 20_000)) return 0;
  pulledAt = Date.now();
  const [any] = await sql`select 1 as x from support_tickets where route = 'platform' limit 1`;
  if (!any) return 0;
  const cur = ((await getSetting<{ cursor: number }>(CURSOR_KEY))?.cursor ?? 0) | 0;
  let res: Response;
  try {
    res = await doFetch(`${site.updates}?since=${cur}`, { headers: { authorization: `Bearer ${site.token}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch {
    return 0;
  }
  if (!res.ok) return 0;
  const j: any = await res.json().catch(() => null);
  if (!j?.ok || !Array.isArray(j.items)) return 0;
  let n = 0;
  for (const it of j.items.slice(0, 100)) {
    if (typeof it?.ticketId !== "string" || !UUID.test(it.ticketId)) continue;
    const status = it.status === "closed" || it.status === "waiting" || it.status === "open" ? it.status : null;
    const [t] = await sql`select id from support_tickets where id = ${it.ticketId} and route = 'platform'`;
    if (!t) continue;
    if (it.message && typeof it.message.body === "string" && Number.isInteger(it.message.id)) {
      const body = clean(it.message.body, MAX_TEXT, true);
      if (body) {
        const r = await sql`insert into support_ticket_messages (ticket_id, author, author_name, body, remote_id, pushed, created_at)
          values (${t.id}, 'support', ${clean(it.message.author, 80) || "Support"}, ${body}, ${it.message.id}, true, ${Number.isNaN(Date.parse(it.message.at)) ? new Date() : new Date(it.message.at)})
          on conflict (ticket_id, remote_id) where remote_id is not null do nothing returning id`;
        if (r.length) n++;
      }
    }
    // Only our own side's changes come back (a reply, close or reopen), so the person who asked has something new.
    await sql`update support_tickets set status = coalesce(${status}::text, status), requester_unread = true, updated_at = now() where id = ${t.id}`;
  }
  const next = Number(j.cursor);
  if (Number.isInteger(next) && next >= cur) await putSetting(CURSOR_KEY, { cursor: next });
  return n;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Every few minutes: send what's waiting, and fetch our replies. Does nothing at all when there are no platform tickets. */
export function startTicketSync(): void {
  if (!supportConfig().ok) return;
  const tick = () => void pushTickets().then(() => pullUpdates(ticketDeps.fetch, true)).catch((e) => console.error("[tickets]", (e as Error).message));
  setTimeout(tick, 20_000).unref?.();
  timer ??= setInterval(tick, 3 * 60_000);
  timer.unref?.();
}

// ---------------------------------------------------------------------------------------------
// The routes (called from server/index.ts once someone is signed in)
// ---------------------------------------------------------------------------------------------

export async function ticketRoutes(args: RouteArgs): Promise<Response | null> {
  const { req, path, method, ctx } = args;
  if (path === "/api/tickets" && method === "GET") {
    void pullUpdates().catch(() => {});
    return json(await listTickets(ctx));
  }
  if (path === "/api/tickets" && method === "POST") {
    if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return json({ error: "That's too big. Try a smaller screenshot." }, 413);
    const made = await createTicket(ctx, await readBody(req), { userAgent: req.headers.get("user-agent") ?? "" });
    return json(made, 201);
  }
  const m = path.match(/^\/api\/tickets\/([0-9a-f-]{36})(?:\/(reply|close|reopen|shot\/([0-9a-f-]{36})))?$/i);
  if (!m) return null;
  const [, id, what, shotId] = m;
  if (!what && method === "GET") {
    void pullUpdates().catch(() => {});
    const c = await conversation(ctx, id);
    return c ? json(c) : json({ error: "No such request." }, 404);
  }
  if (shotId && method === "GET") return (await screenshot(ctx, id, shotId)) ?? json({ error: "Not found." }, 404);
  if (method !== "POST") return null;
  if (what === "reply") {
    if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return json({ error: "That's too big. Try a smaller screenshot." }, 413);
    await replyToTicket(ctx, id, await readBody(req));
    return json({ ok: true });
  }
  if (what === "close" || what === "reopen") {
    await setStatus(ctx, id, what === "close" ? "closed" : "open");
    return json({ ok: true });
  }
  return null;
}
