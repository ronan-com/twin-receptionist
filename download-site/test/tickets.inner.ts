// The checks for tickets.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "tickets-test-"));
const PORT = 47000 + Math.floor(Math.random() * 900);
const HOOK_PORT = PORT + 1000;
const SITE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SITE_URL = SITE;
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "HOSTING", "PREVIEW_JUMP"]) delete process.env[k];

const { addBuyer, db } = await import("../lib");
const sync = await import("../sync");
const T = await import("../tickets");
const { newAdminLink } = await import("../admin-web");

const uuid = () => crypto.randomUUID();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const SECRET = "st_" + "Zq9".repeat(15);
const ctx = { url: "https://app.acme.example/admin/clients?token=" + SECRET + "#x", appVersion: "2026.11.5", browser: "Firefox 130 on Linux", agencyId: uuid(), receptionistId: uuid(), apiKey: "never" };
const ticketBody = (over: Record<string, any> = {}, msg: Record<string, any> = {}) => ({
  ticket: { id: uuid(), subject: "Calls aren't coming through", from: "Dana Owner", context: ctx, ...over },
  messages: [{ id: uuid(), body: "Since this morning nothing rings.", at: new Date().toISOString(), name: "Dana Owner", ...msg }],
});
const post = (token: string | null, body: unknown) =>
  fetch(`${SITE}/api/tickets`, { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const updates = (token: string, since = 0) => fetch(`${SITE}/api/tickets/updates?since=${since}`, { headers: { authorization: `Bearer ${token}` } });

let server: ReturnType<typeof Bun.spawn> | null = null;
let hook: ReturnType<typeof Bun.serve> | null = null;
const hooked: any[] = [];
beforeAll(async () => {
  hook = Bun.serve({ port: HOOK_PORT, hostname: "127.0.0.1", async fetch(req) { hooked.push(await req.json().catch(() => null)); return new Response("ok"); } });
  server = Bun.spawn(["bun", "server.ts"], {
    cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "ignore",
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", SITE_URL: SITE, DATA_DIR: dir, ADMIN_EMAILS: "boss@example.com", MOCK_RAILWAY: "1", ALERT_WEBHOOK_URL: `http://127.0.0.1:${HOOK_PORT}/hook` },
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${SITE}/healthz`)).ok) return; } catch {}
    await Bun.sleep(100);
  }
  throw new Error("the site didn't start");
}, 30_000);
afterAll(() => { server?.kill(); hook?.stop(true); });

const agency = addBuyer("Acme Agency", "acme@example.com");
const { token } = sync.newSyncToken(agency.id);
const other = addBuyer("Other Agency", "other@example.com");
const otherToken = sync.newSyncToken(other.id).token;
let ticketAppId = "";
let ticketId = 0;

describe("POST /api/tickets", () => {
  test("needs the app's sync token, and only POST", async () => {
    expect((await post(null, ticketBody())).status).toBe(401);
    expect((await post("st_" + "x".repeat(43), ticketBody())).status).toBe(401);
    expect((await fetch(`${SITE}/api/tickets`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(405);
    expect((await fetch(`${SITE}/api/tickets/updates`)).status).toBe(401);
    expect(T.openCount()).toBe(0);
  });

  test("a ticket is stored with a cleaned context: no query, no token, no unknown fields", async () => {
    const body = ticketBody();
    ticketAppId = body.ticket.id;
    const r = await post(token, body);
    expect(r.status).toBe(200);
    const j: any = await r.json();
    ticketId = j.ticketId;
    expect(j).toMatchObject({ ok: true, created: true, added: 1, status: "open" });
    const t = T.ticketById(ticketId)!;
    const c = JSON.parse(t.context);
    expect(Object.keys(c).sort()).toEqual(["agencyId", "appVersion", "browser", "page", "receptionistId", "url"]);
    expect(c.url).toBe("https://app.acme.example/admin/clients");
    expect(c.appVersion).toBe("2026.11.5");
    expect(JSON.stringify(db().query("SELECT * FROM tickets").all())).not.toContain("Zq9Zq9");
    expect(JSON.stringify(db().query("SELECT * FROM tickets").all())).not.toContain("never");
    expect(T.messagesOf(ticketId)).toHaveLength(1);
  });

  test("a retry changes nothing; a follow-up adds a message; another agency can't touch it", async () => {
    const first = ticketBody({ id: ticketAppId });
    const again = await (await post(token, { ...first, messages: T.messagesOf(ticketId).map((m) => ({ id: m.app_msg_id, body: m.body })) })).json() as any;
    expect(again).toMatchObject({ ok: true, created: false, added: 0 });
    const more = await (await post(token, { ticket: { id: ticketAppId }, messages: [{ id: uuid(), body: "Still broken." }] })).json() as any;
    expect(more).toMatchObject({ created: false, added: 1 });
    expect(T.messagesOf(ticketId)).toHaveLength(2);
    // The same id from a different agency is a different ticket, not an update of ours.
    const theirs = await (await post(otherToken, { ticket: { id: ticketAppId, subject: "Theirs" }, messages: [{ id: uuid(), body: "hi" }] })).json() as any;
    expect(theirs.created).toBe(true);
    expect(theirs.ticketId).not.toBe(ticketId);
    expect(T.messagesOf(ticketId)).toHaveLength(2);
  });

  test("limits: size, screenshot size, type and content, missing fields; secrets in the text are masked", async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 10, 1);
    const shot = (buf: Buffer, type = "image/png") => ({ screenshot: { name: "s.png", type, data: buf.toString("base64") } });
    const bad = async (b: unknown, status = 400) => expect((await post(token, b)).status).toBe(status);
    await bad(ticketBody({}, shot(Buffer.concat([PNG.subarray(0, 8), big]))));
    await bad(ticketBody({}, shot(Buffer.alloc(100, 1))));                       // not really a PNG
    await bad(ticketBody({}, shot(PNG, "text/html")));                            // not an image type
    await bad(ticketBody({}, { screenshot: { name: "s.png", type: "image/png", data: "<script>" } }));
    await bad(ticketBody({ subject: "" }));
    await bad({ ticket: { id: uuid(), subject: "x" }, messages: [] });
    await bad({ ticket: { id: "nope", subject: "x" }, messages: [{ id: uuid(), body: "x" }] });
    await bad("{not json");
    await bad("x".repeat(T.MAX_TICKET_BODY + 5), 413);
    // An image just under the limit is fine, and is served back as an image.
    const okBody = ticketBody({}, shot(Buffer.concat([PNG, Buffer.alloc(1_900_000, 2)])));
    const r: any = await (await post(token, okBody)).json();
    expect(r.ok).toBe(true);
    const text = await post(token, ticketBody({ subject: `Key ${SECRET} leaked` }, { body: `my api_key: sk-abcdefghijklmnopqrstuvwxyz0123 and Bearer abcdefghijklmnop1234 and token=${SECRET} and it's broken` }));
    const t: any = await text.json();
    const stored = JSON.stringify([T.ticketById(t.ticketId), T.messagesOf(t.ticketId)]);
    expect(stored).not.toContain("Zq9Zq9");
    expect(stored).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
    expect(stored).not.toContain("abcdefghijklmnop1234");
    expect(stored).toContain("it's broken");
  });

  test("a new ticket raises an alert through the webhook (when the alerts module and ALERT_WEBHOOK_URL are set)", async () => {
    await Bun.sleep(300);
    expect(hooked.some((h) => String(h?.text || "").includes("help request") && String(h?.text || "").includes("Acme Agency"))).toBe(true);
  });
});

describe("the admin: list, reply, close", () => {
  let cookie = "";
  let csrf = "";
  const get = (path: string) => fetch(`${SITE}${path}`, { headers: { cookie }, redirect: "manual" });
  const form = (path: string, f: Record<string, string> = {}, t = csrf) =>
    fetch(`${SITE}${path}`, { method: "POST", redirect: "manual", headers: { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, ...f }).toString() });

  test("sign in; the nav shows the open count; the list shows agency, subject and status", async () => {
    const res = await fetch(newAdminLink("boss@example.com").replace(/^https?:\/\/[^/]+/, SITE), { method: "POST", redirect: "manual", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: "" });
    cookie = (res.headers.get("set-cookie") || "").split(";")[0];
    const html = await (await get("/admin/tickets")).text();
    csrf = html.match(/name="t" value="([^"]+)"/)?.[1] || (await (await get("/admin")).text()).match(/name="t" value="([^"]+)"/)![1];
    expect(html).toContain("Help tickets");
    expect(html).toMatch(/Help tickets <span class="badge"[^>]*>\d+<\/span>/);
    expect(html).toContain("Acme Agency");
    expect(html).toContain("Calls aren&#39;t coming through");
    expect(html).toContain(`/admin/tickets/${ticketId}`);
    expect(html).toContain("Open");
    expect(await (await fetch(`${SITE}/admin/tickets`, { redirect: "manual" })).text()).not.toContain("Calls aren");
  });

  test("the ticket page shows the conversation, the context and a link to the agency", async () => {
    const html = await (await get(`/admin/tickets/${ticketId}`)).text();
    expect(html).toContain("Since this morning nothing rings.");
    expect(html).toContain("Still broken.");
    expect(html).toContain("https://app.acme.example/admin/clients");
    expect(html).toContain("Firefox 130 on Linux");
    expect(html).toContain(`href="/admin/b/${agency.id}"`);
    expect(html).toContain("Send reply");
    expect(html).not.toContain(SECRET);
  });

  test("a reply needs the CSRF token, goes to waiting, and comes back through /api/tickets/updates once", async () => {
    expect((await form(`/admin/tickets/${ticketId}/reply`, { body: "We're looking" }, "wrong")).status).toBe(403);
    expect(T.messagesOf(ticketId).filter((m) => m.author === "support")).toHaveLength(0);
    const r = await form(`/admin/tickets/${ticketId}/reply`, { body: "We're looking into your numbers now." });
    expect(r.headers.get("location")).toContain("m=ticket-replied");
    expect(T.ticketById(ticketId)!.status).toBe("waiting");
    const u: any = await (await updates(token, 0)).json();
    expect(u.ok).toBe(true);
    const item = u.items.find((i: any) => i.message);
    expect(item).toMatchObject({ ticketId: ticketAppId, status: "waiting", message: { author: "boss", body: "We're looking into your numbers now." } });
    // Nothing new after the cursor, and another agency never sees it.
    expect((await (await updates(token, u.cursor)).json() as any).items).toHaveLength(0);
    expect((await (await updates(otherToken, 0)).json() as any).items).toHaveLength(0);
    // An agency reply puts it back in front of us.
    await post(token, { ticket: { id: ticketAppId }, messages: [{ id: uuid(), body: "Thanks, it's the Sydney number." }] });
    expect(T.ticketById(ticketId)!.status).toBe("open");
  });

  test("close and reopen, with the status flowing back to the app", async () => {
    const before = ((await (await updates(token, 0)).json()) as any).cursor;
    const c = await form(`/admin/tickets/${ticketId}/close`);
    expect(c.headers.get("location")).toContain("m=ticket-closed");
    expect(T.ticketById(ticketId)!.status).toBe("closed");
    const u: any = await (await updates(token, before)).json();
    expect(u.items).toEqual([expect.objectContaining({ ticketId: ticketAppId, status: "closed", message: null })]);
    expect(await (await get("/admin/tickets")).text()).not.toContain(`/admin/tickets/${ticketId}"`);
    expect(await (await get("/admin/tickets?status=closed")).text()).toContain(`/admin/tickets/${ticketId}`);
    await form(`/admin/tickets/${ticketId}/reopen`);
    expect(T.ticketById(ticketId)!.status).toBe("open");
  });

  test("a screenshot is served as an image, sandboxed, only to a signed-in admin", async () => {
    const m = db().query("SELECT t.id AS tid, m.id AS mid FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id WHERE m.file IS NOT NULL").get() as { tid: number; mid: number };
    const res = await get(`/admin/tickets/${m.tid}/file/${m.mid}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect((await fetch(`${SITE}/admin/tickets/${m.tid}/file/${m.mid}`, { redirect: "manual" })).status).not.toBe(200);
    expect((await get(`/admin/tickets/${m.tid}`).then((r) => r.text()))).toContain(`/admin/tickets/${m.tid}/file/${m.mid}`);
  });

  test("deleting an agency deletes its tickets", async () => {
    const x = addBuyer("Gone Agency", "gone@example.com");
    const tk = sync.newSyncToken(x.id).token;
    const r: any = await (await post(tk, ticketBody())).json();
    expect(T.ticketById(r.ticketId)).not.toBeNull();
    await form(`/admin/b/${x.id}/delete`);
    expect(T.ticketById(r.ticketId)).toBeNull();
  });
});

describe("the agencies list", () => {
  test("shows real agencies only; test runs sit in a collapsed section at the bottom; the Real/Test filter is gone", async () => {
    const cookie = (await fetch(newAdminLink("boss@example.com").replace(/^https?:\/\/[^/]+/, SITE), { method: "POST", redirect: "manual", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: "" })).headers.get("set-cookie")!.split(";")[0];
    addBuyer("Pretend Test Run", "demo-1@example.com", true);
    const html = await (await fetch(`${SITE}/admin`, { headers: { cookie } })).text();
    const mainEnd = html.indexOf("Test runs (");
    expect(mainEnd).toBeGreaterThan(0);
    const main = html.slice(0, mainEnd);
    expect(main).toContain("Acme Agency");
    expect(main).not.toContain("Pretend Test Run");
    expect(html.slice(mainEnd)).toContain("Pretend Test Run");
    expect(html).toMatch(/<details>\s*<summary>Test runs \(1\)<\/summary>/);
    expect(html).not.toContain('name="kind"');
    expect(html).toContain("<h1>Agencies</h1>");
    expect(html).not.toMatch(/>Buyers?</);
    // The aliases.
    expect((await fetch(`${SITE}/admin/agencies`, { headers: { cookie } })).status).toBe(200);
    expect((await fetch(`${SITE}/admin/a/${agency.id}`, { headers: { cookie } })).status).toBe(200);
  });
});
