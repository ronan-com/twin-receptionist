// The checks for tickets.test.ts. They run in their own bun process against a database of their own.
import { beforeAll, describe, expect, test } from "bun:test";
import type { Ctx } from "./accounts";
import { migrate, sql } from "./db";
import {
  MAX_SHOT, cleanPageUrl, ticketDeps, conversation, createTicket, listTickets, pullUpdates, pushTickets, redactSecrets, replyToTicket, routeFor, screenshot, setStatus, ticketRoutes,
} from "./tickets";

const SYNC = "st_" + "Qx7".repeat(15);
const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();
const ids = { ownerA: crypto.randomUUID(), adminA: crypto.randomUUID(), memberA: crypto.randomUUID(), custA: crypto.randomUUID(), cust2A: crypto.randomUUID(), ownerB: crypto.randomUUID() };
const clientA = crypto.randomUUID();
const client2A = crypto.randomUUID();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]);
const shot = (b: Buffer = PNG, type = "image/png") => ({ name: "s.png", type, data: b.toString("base64") });

const who = (id: string, role: Ctx["role"], org: string, name: string, extra: Partial<Ctx> = {}): Ctx => ({ tokenHash: "x", user: { id, email: `${name.toLowerCase()}@example.com`, name, platformAdmin: false }, org: { id: org, name: org === orgA ? "Agency A" : "Agency B" }, role, ...extra });
const ownerA = who(ids.ownerA, "owner", orgA, "Dana");
const adminA = who(ids.adminA, "admin", orgA, "Alex");
const memberA = who(ids.memberA, "member", orgA, "Mel");
const custA = who(ids.custA, "customer", orgA, "Cleo");
const cust2A = who(ids.cust2A, "customer", orgA, "Cody");
const ownerB = who(ids.ownerB, "owner", orgB, "Bea");
const saved: Record<string, string | undefined> = {};
for (const k of ["SUPPORT_SYNC_URL", "SUPPORT_SYNC_TOKEN", "SUPPORT_SELLER_NAME"]) saved[k] = process.env[k];

beforeAll(async () => {
  // Nothing in these checks reaches a real site: the background send after each request gets a 503 and tries again later.
  ticketDeps.fetch = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
  process.env.SUPPORT_SYNC_URL = "https://setup.example.com/api/sync";
  process.env.SUPPORT_SYNC_TOKEN = SYNC;
  process.env.SUPPORT_SELLER_NAME = "Acme Setups";
  await migrate();
  for (const [o, n] of [[orgA, "Agency A"], [orgB, "Agency B"]]) await sql`insert into orgs (id, name) values (${o}, ${n})`;
  for (const [role, id, org] of [["owner", ids.ownerA, orgA], ["admin", ids.adminA, orgA], ["member", ids.memberA, orgA], ["customer", ids.custA, orgA], ["customer", ids.cust2A, orgA], ["owner", ids.ownerB, orgB]] as const) {
    await sql`insert into users (id, email, name, password_hash) values (${id}, ${`${id}@example.com`}, 'x', 'x')`;
    await sql`insert into memberships (org_id, user_id, role) values (${org}, ${id}, ${role})`;
  }
  const settings = (n: string) => ({ settings: { businessName: n } });
  await sql`insert into clients (id, org_id, data, created_at, updated_at) values (${clientA}, ${orgA}, ${settings("Cleo's Plumbing") as any}, now(), now())`;
  await sql`insert into clients (id, org_id, data, created_at, updated_at) values (${client2A}, ${orgA}, ${settings("Cody's Cafe") as any}, now(), now())`;
  await sql`insert into client_access (user_id, client_id) values (${ids.custA}, ${clientA}), (${ids.cust2A}, ${client2A})`;
}, 120_000);

const fakeSite = (answers: { status?: number; body?: any }[] = [], seen: { url: string; auth: string; body: any }[] = []) => {
  let i = 0;
  const f = (async (url: any, init: any) => {
    seen.push({ url: String(url), auth: init?.headers?.authorization ?? "", body: init?.body ? JSON.parse(init.body) : null });
    const a = answers[Math.min(i++, answers.length - 1)] ?? { status: 200, body: { ok: true } };
    return new Response(JSON.stringify(a.body ?? { ok: true }), { status: a.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, seen };
};
const noPushNow = async () => { await new Promise((r) => setTimeout(r, 50)); };

describe("routing", () => {
  test("owners and admins write to the setup provider, business users to their agency, members and read-only views to nobody", () => {
    expect(routeFor(ownerA).route).toBe("platform");
    expect(routeFor(adminA).route).toBe("platform");
    expect(routeFor(custA).route).toBe("agency");
    expect(routeFor(memberA)).toMatchObject({ route: null });
    expect(routeFor({ ...ownerA, viewing: { org: "Agency A", client: null, business: "", support: true } })).toMatchObject({ route: null });
    delete process.env.SUPPORT_SYNC_TOKEN;
    expect(routeFor(ownerA)).toMatchObject({ route: null });
    expect(routeFor(custA).route).toBe("agency"); // never needs the setup site
    process.env.SUPPORT_SYNC_TOKEN = SYNC;
  });
});

describe("creating a request", () => {
  test("the context is only what the form may attach; no query, no tokens, no keys", async () => {
    const { id } = await createTicket(ownerA, { subject: "Calls not ringing", message: "Since this morning.", page: `https://app.acme.example/admin/clients/${clientA}?token=${SYNC}#frag`, apiKey: "no", context: { token: SYNC } }, { userAgent: "Firefox 130" });
    const [t] = await sql`select * from support_tickets where id = ${id}`;
    expect(Object.keys(t.context).sort()).toEqual(["agencyId", "appVersion", "browser", "receptionistId", "url"]);
    expect(t.context.url).toBe(`https://app.acme.example/admin/clients/${clientA}`);
    expect(t.context.agencyId).toBe(orgA);
    expect(t.context.browser).toBe("Firefox 130");
    expect(JSON.stringify(t)).not.toContain("Qx7Qx7");
    expect(t.route).toBe("platform");
    expect(cleanPageUrl("javascript:alert(1)")).toBe("");
    expect(cleanPageUrl("https://x.example/reset/" + "a".repeat(43))).toBe("https://x.example/reset/[hidden]");
  });

  test("text and subject need content; keys pasted into the text are masked; the screenshot must be a small image", async () => {
    const bad = async (input: any, re: RegExp) => expect(createTicket(ownerA, input)).rejects.toThrow(re);
    await bad({ subject: "", message: "x" }, /subject/i);
    await bad({ subject: "x", message: " " }, /what's wrong/i);
    await bad({ subject: "x", message: "x", screenshot: shot(Buffer.concat([PNG, Buffer.alloc(MAX_SHOT, 1)])) }, /2 MB/);
    await bad({ subject: "x", message: "x", screenshot: shot(Buffer.alloc(50, 1)) }, /valid image/);
    await bad({ subject: "x", message: "x", screenshot: shot(PNG, "text/html") }, /PNG, JPEG/);
    await bad({ subject: "x", message: "x", screenshot: { type: "image/png", data: "<svg onload=1>" } }, /valid/);
    const { id } = await createTicket(adminA, { subject: `Key ${SYNC}`, message: `my api_key: sk-abcdefghijklmnopqrstuvwxyz0123 and token=${SYNC}, it's broken`, screenshot: shot() });
    const stored = JSON.stringify([await sql`select subject from support_tickets where id = ${id}`, await sql`select body from support_ticket_messages where ticket_id = ${id}`]);
    expect(stored).not.toContain("Qx7Qx7");
    expect(stored).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
    expect(stored).toContain("it's broken");
    expect(redactSecrets("Bearer abcdefghijklmnop1234")).toBe("Bearer [hidden]");
  });

  test("a person can't flood the queue", async () => {
    let failed = 0;
    for (let i = 0; i < 12; i++) await createTicket(who(ids.ownerB, "owner", orgB, "Bea"), { subject: `Flood ${i}`, message: "x" }).catch(() => failed++);
    expect(failed).toBeGreaterThan(0);
  });
});

describe("to the setup site and back", () => {
  test("a platform request is sent with the sync token, in the fixed shape; the messages are marked sent; a retry sends nothing", async () => {
    await sql`delete from support_tickets`;
    const { id } = await createTicket(ownerA, { subject: "Sync me", message: "Hello", screenshot: shot(), page: "https://app.acme.example/admin" }, { userAgent: "UA" });
    await noPushNow();
    const site = fakeSite();
    await pushTickets(site.f);
    expect(site.seen).toHaveLength(1);
    expect(site.seen[0].url).toBe("https://setup.example.com/api/tickets");
    expect(site.seen[0].auth).toBe(`Bearer ${SYNC}`);
    const b = site.seen[0].body;
    expect(Object.keys(b)).toEqual(["ticket", "messages"]);
    expect(Object.keys(b.ticket).sort()).toEqual(["context", "from", "id", "status", "subject"]);
    expect(b.ticket.id).toBe(id);
    expect(b.messages[0]).toMatchObject({ body: "Hello", name: "Dana", screenshot: { type: "image/png", name: "s.png" } });
    expect(JSON.stringify(b)).not.toContain(SYNC);
    const again = fakeSite();
    await pushTickets(again.f);
    expect(again.seen).toHaveLength(0);
  });

  test("an unreachable site or a 5xx is retried later; a refused ticket is parked with a reason", async () => {
    const { id } = await createTicket(ownerA, { subject: "Retry me", message: "x" });
    await noPushNow();
    await sql`update support_tickets set needs_push = true where id = ${id}`;
    const down = fakeSite([{ status: 503 }]);
    await pushTickets(down.f);
    expect((await sql`select needs_push from support_tickets where id = ${id}`)[0].needs_push).toBe(true);
    const refuse = fakeSite([{ status: 400, body: { error: "bad" } }]);
    await pushTickets(refuse.f);
    const [t] = await sql`select needs_push, push_error from support_tickets where id = ${id}`;
    expect(t.needs_push).toBe(false);
    expect(t.push_error).toContain("400");
  });

  test("our reply comes back once, the ticket is unread with its status, and reading clears the dot", async () => {
    const { id } = await createTicket(ownerA, { subject: "Reply to me", message: "Help" });
    await noPushNow();
    const reply = { ok: true, cursor: 7, items: [{ eventId: 7, ticketId: id, status: "waiting", message: { id: 41, body: "We're on it.", at: new Date().toISOString(), author: "boss" } }] };
    const site = fakeSite([{ body: reply }]);
    expect(await pullUpdates(site.f, true)).toBe(1);
    expect(site.seen[0].url).toBe("https://setup.example.com/api/tickets/updates?since=0");
    expect(site.seen[0].auth).toBe(`Bearer ${SYNC}`);
    // The same reply again is ignored; the cursor moved on.
    const again = fakeSite([{ body: reply }]);
    expect(await pullUpdates(again.f, true)).toBe(0);
    expect(again.seen[0].url).toBe("https://setup.example.com/api/tickets/updates?since=7");
    expect(await sql`select 1 from support_ticket_messages where ticket_id = ${id} and author = 'support'`).toHaveLength(1);
    const list = await listTickets(ownerA);
    const mine = list.mine.find((x) => x.id === id)!;
    expect(mine).toMatchObject({ status: "waiting", unread: true });
    expect(list.unread).toBeGreaterThan(0);
    // Another admin of the same agency sees it too; another agency doesn't.
    expect((await listTickets(adminA)).mine.some((x) => x.id === id)).toBe(true);
    expect((await listTickets(ownerB)).mine.some((x) => x.id === id)).toBe(false);
    const c = await conversation(ownerA, id);
    expect(c!.messages.map((m: any) => m.author)).toEqual(["requester", "support"]);
    expect(c!.otherParty).toBe("Acme Setups");
    expect((await listTickets(ownerA)).mine.find((x) => x.id === id)!.unread).toBe(false);
    expect(await conversation(ownerB, id)).toBeNull();
    // A reply from the agency goes back out and reopens it; a close is sent too.
    await replyToTicket(ownerA, id, { message: "Thanks, here's more." });
    await noPushNow();
    expect((await sql`select status from support_tickets where id = ${id}`)[0].status).toBe("open");
    await setStatus(ownerA, id, "closed");
    expect((await sql`select status from support_tickets where id = ${id}`)[0].status).toBe("closed");
    await sql`update support_tickets set needs_push = true where id = ${id}`;
    const out = fakeSite();
    await pushTickets(out.f);
    expect(out.seen.at(-1)!.body.ticket.status).toBe("closed");
  });

  test("a made-up id or someone else's ticket in the answer is ignored", async () => {
    const bad = fakeSite([{ body: { ok: true, cursor: 99, items: [{ ticketId: crypto.randomUUID(), status: "closed", message: { id: 5, body: "x" } }, { ticketId: "nope", status: "closed" }] } }]);
    expect(await pullUpdates(bad.f, true)).toBe(0);
  });
});

describe("a business user writes to their agency", () => {
  let ticket = "";
  test("the request stays in the app, in the agency's inbox, and only that agency's staff and the person who sent it can see it", async () => {
    const site = fakeSite();
    const made = await createTicket(custA, { subject: "My number is wrong", message: "Please check", page: "https://app.acme.example/app/settings" });
    ticket = made.id;
    expect(made.route).toBe("agency");
    await pushTickets(site.f);
    expect(site.seen).toHaveLength(0);
    expect((await sql`select client_id, needs_push from support_tickets where id = ${ticket}`)[0]).toMatchObject({ client_id: clientA, needs_push: false });
    const inbox = (await listTickets(ownerA)).inbox;
    expect(inbox.find((x) => x.id === ticket)).toMatchObject({ subject: "My number is wrong", business: "Cleo's Plumbing", unread: true });
    expect((await listTickets(memberA)).inbox.some((x) => x.id === ticket)).toBe(true);
    expect((await listTickets(custA)).mine.some((x) => x.id === ticket)).toBe(true);
    expect((await listTickets(cust2A)).mine.some((x) => x.id === ticket)).toBe(false);
    expect(await conversation(cust2A, ticket)).toBeNull();
    expect(await conversation(ownerB, ticket)).toBeNull();
    expect(await replyToTicket(cust2A, ticket, { message: "hi" }).catch((e) => e.message)).toMatch(/isn't yours/);
  });

  test("the agency replies, the customer sees an unread dot; the customer replies, the agency does", async () => {
    await conversation(ownerA, ticket); // the agency reads it
    expect((await listTickets(ownerA)).inbox.find((x) => x.id === ticket)!.unread).toBe(false);
    await replyToTicket(adminA, ticket, { message: "Checking now.", screenshot: shot() });
    expect((await sql`select status, requester_unread, agency_unread from support_tickets where id = ${ticket}`)[0]).toMatchObject({ status: "waiting", requester_unread: true, agency_unread: false });
    expect((await listTickets(custA)).mine.find((x) => x.id === ticket)).toMatchObject({ unread: true, status: "waiting" });
    const c = await conversation(custA, ticket);
    expect(c!.messages.map((m: any) => m.author)).toEqual(["requester", "agency"]);
    expect(c!.otherParty).toBe("your agency");
    expect(c!.messages[1].shot).toBeTruthy();
    expect((await listTickets(custA)).mine.find((x) => x.id === ticket)!.unread).toBe(false);
    await replyToTicket(custA, ticket, { message: "Thanks!" });
    expect((await listTickets(ownerA)).inbox.find((x) => x.id === ticket)).toMatchObject({ unread: true, status: "open" });
    expect(await sql`select 1 from support_tickets where id = ${ticket} and needs_push`).toHaveLength(0);
  });

  test("screenshots are served only to people who can see the ticket, as sandboxed images", async () => {
    const [m] = await sql`select id from support_ticket_messages where ticket_id = ${ticket} and shot is not null`;
    const res = await screenshot(custA, ticket, m.id);
    expect(res!.headers.get("content-type")).toBe("image/png");
    expect(res!.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res!.headers.get("content-security-policy")).toContain("sandbox");
    expect(await screenshot(cust2A, ticket, m.id)).toBeNull();
    expect(await screenshot(ownerB, ticket, m.id)).toBeNull();
  });

  test("the HTTP routes: create, list, read, reply, close; a read-only view can't write", async () => {
    const call = (ctx: Ctx, method: string, path: string, body?: unknown) => ticketRoutes({ req: new Request(`https://app.example.com${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), url: new URL(`https://app.example.com${path}`), path, method, ctx, orgId: ctx.org!.id, appUrl: "https://app.example.com" });
    const made = await call(custA, "POST", "/api/tickets", { subject: "Via HTTP", message: "Hi" });
    expect(made!.status).toBe(201);
    const { id } = (await made!.json()) as any;
    const list: any = await (await call(custA, "GET", "/api/tickets"))!.json();
    expect(list).toMatchObject({ canCreate: true, route: "agency" });
    expect(list.mine.some((x: any) => x.id === id)).toBe(true);
    expect((await call(custA, "GET", `/api/tickets/${id}`))!.status).toBe(200);
    expect((await call(cust2A, "GET", `/api/tickets/${id}`))!.status).toBe(404);
    expect((await call(adminA, "POST", `/api/tickets/${id}/reply`, { message: "Sure" }))!.status).toBe(200);
    expect((await call(adminA, "POST", `/api/tickets/${id}/close`))!.status).toBe(200);
    expect((await sql`select status from support_tickets where id = ${id}`)[0].status).toBe("closed");
    expect((await call(adminA, "POST", `/api/tickets/${id}/reopen`))!.status).toBe(200);
    const ro = { ...adminA, viewing: { org: "Agency A", client: null, business: "" } } as Ctx;
    expect(await call(ro, "POST", `/api/tickets/${id}/reply`, { message: "no" }).catch((e) => e.message)).toMatch(/read-only/);
    expect(await call(ro, "POST", "/api/tickets", { subject: "x", message: "y" }).catch((e) => e.message)).toMatch(/read-only/);
    expect(await call(custA, "GET", "/api/tickets/not-a-ticket")).toBeNull();
  });
});
