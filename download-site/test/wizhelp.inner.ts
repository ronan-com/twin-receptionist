// The checks for wizhelp.test.ts: "I need a person" on the setup wizard, end to end against a real site process.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "wizhelp-test-"));
const PORT = 48000 + Math.floor(Math.random() * 900);
const HOOK_PORT = PORT + 1000;
const SITE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SITE_URL = SITE;
process.env.PRODUCT_NAME = "Zorbo";
process.env.SELLER_NAME = "Zorbo Co";
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "HOSTING", "PREVIEW_JUMP", "OPENROUTER_API_KEY"]) delete process.env[k];

const { addBuyer, db } = await import("../lib");
const { putSecret, updateSetup, getSetup } = await import("../store");
const T = await import("../tickets");
const { newAdminLink } = await import("../admin-web");
const { HELP_SENT, HELP_EMPTY, HELP_PER_HOUR } = await import("../wizhelp");

const UA = "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0";
const TOKEN_VALUE = "rail-token-abcdef0123456789-secret";
const escd = (s: string) => s.replace(/'/g, "&#39;");

let server: ReturnType<typeof Bun.spawn> | null = null;
let hook: ReturnType<typeof Bun.serve> | null = null;
const hooked: any[] = [];
beforeAll(async () => {
  hook = Bun.serve({ port: HOOK_PORT, hostname: "127.0.0.1", async fetch(req) { hooked.push(await req.json().catch(() => null)); return new Response("ok"); } });
  server = Bun.spawn(["bun", "server.ts"], {
    cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "ignore",
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", SITE_URL: SITE, DATA_DIR: dir, ADMIN_EMAILS: "boss@example.com", ALERT_WEBHOOK_URL: `http://127.0.0.1:${HOOK_PORT}/hook` },
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${SITE}/healthz`)).ok) return; } catch {}
    await Bun.sleep(100);
  }
  throw new Error("the site didn't start");
}, 30_000);
afterAll(() => { server?.kill(); hook?.stop(true); });

/** A buyer's browser: its session cookie and the page's CSRF token. */
async function browser(code: string) {
  const r = await fetch(`${SITE}/setup/${code}`, { headers: { "user-agent": UA } });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const t = (await r.text()).match(/name="t" value="([^"]+)"/)![1];
  const page = async (step = "") => (await fetch(`${SITE}/setup/${code}${step ? `?step=${step}` : ""}`, { headers: { cookie, "user-agent": UA } })).text();
  const post = (action: string, f: Record<string, string>, o: { t?: string; origin?: string } = {}) =>
    fetch(`${SITE}/setup/${code}/a/${action}`, { method: "POST", redirect: "manual", headers: { cookie, origin: o.origin ?? SITE, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: o.t ?? t, ...f }).toString() });
  return { cookie, t, page, post };
}
const personBlock = (html: string) => html.slice(html.indexOf('<div class="person"'), html.indexOf('<p class="foot">'));

const acme = addBuyer("Acme Agency", "acme@example.com", false, { style: "neutral" });
updateSetup(acme.id, (s) => { s.brand = { productName: "Acme Calls", ownerEmail: "owner@acme.test" } as any; s.domain = { host: "app.acme.test", zone: "acme.test", confirmed: true } as any; s.step = "server"; });
putSecret(acme.id, "do_token", TOKEN_VALUE);
let ticketId = 0;

describe("the wizard", () => {
  test("every step shows the Talk to a person form, prefilled with their owner email", async () => {
    const b = await browser(acme.code);
    for (const step of ["welcome", "brand", "server"]) {
      const html = await b.page(step);
      expect(html).toContain("Talk to a person");
      expect(html).toContain(`action="/setup/${acme.code}/a/help-request"`);
      expect(personBlock(html)).toContain('value="owner@acme.test"');
      expect(personBlock(html)).toContain(`value="${step}"`); // the step rides along
      expect(personBlock(html)).toContain('maxlength="1000"');
    }
  });

  test("needs the CSRF token and our own origin", async () => {
    const b = await browser(acme.code);
    expect((await b.post("help-request", { v: "server", problem: "x" }, { t: "wrong" })).status).toBe(403);
    expect((await b.post("help-request", { v: "server", problem: "x" }, { origin: "https://evil.example" })).status).toBe(403);
    expect(T.listTickets("all", acme.id)).toHaveLength(0);
  });

  test("a request becomes a Setup ticket with the step, last error, brand, key names and browser; never a secret", async () => {
    const b = await browser(acme.code);
    // An error on the step first (a real wizard form answering with an error), so it's the "last error".
    await b.post("brand", { v: "brand", productName: "", ownerEmail: "x" });
    const r = await b.post("help-request", { v: "brand", problem: `It keeps failing. My token is ${TOKEN_VALUE} and sk-abcdefghijklmnopqrstuvwxyz0123`, contact: "dana@acme.test", phone: "+61 400 000 000" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`/setup/${acme.code}?step=brand#person`);
    const t = T.listTickets("all", acme.id);
    expect(t).toHaveLength(1);
    ticketId = t[0].id;
    expect(t[0].source).toBe("wizard");
    expect(t[0].status).toBe("open");
    const c = JSON.parse(t[0].context);
    expect(c).toMatchObject({ source: "wizard", step: "brand", stepLabel: "Brand", lastError: "Give your brand a name.", brand: "Acme Calls", contactEmail: "dana@acme.test", contactPhone: "+61 400 000 000", browser: UA });
    expect(c.keysSet).toEqual(["do_token"]);
    const all = JSON.stringify([db().query("SELECT * FROM tickets").all(), db().query("SELECT * FROM ticket_messages").all()]);
    expect(all).not.toContain(TOKEN_VALUE);
    expect(all).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
    expect(all).toContain("It keeps failing.");
    // The confirmation, and the open request on the page.
    const html = await b.page("brand");
    expect(html).toContain(escd(HELP_SENT));
    expect(personBlock(html)).toContain("Your help request");
    expect(personBlock(html)).toContain("It keeps failing.");
    // Long text is cut to 1000 characters; asking again adds to the same open request.
    await b.post("help-request", { v: "brand", problem: "so stuck ".repeat(700) });
    expect(T.listTickets("all", acme.id)).toHaveLength(1);
    const ms = T.messagesOf(ticketId);
    expect(ms).toHaveLength(2);
    expect(ms[1].body.length).toBe(1000);
    expect(JSON.parse(T.ticketById(ticketId)!.context).contactEmail).toBe("dana@acme.test");
    expect(JSON.parse(T.ticketById(ticketId)!.context).lastError).toBe("Give your brand a name.");
  });

  test("the alert goes out: Help request from <agency> at step <step>", async () => {
    await Bun.sleep(300);
    expect(hooked.some((h) => String(h?.text || "").includes("Help request from Acme Agency at step Brand"))).toBe(true);
  });

  test("an empty or blank message is refused: no ticket, an error shown, and the box says it is required", async () => {
    const x = addBuyer("Quiet Agency", "quiet@example.com", false, { style: "neutral" });
    const b = await browser(x.code);
    for (const problem of ["", "   \n  "]) await b.post("help-request", { v: "welcome", problem, contact: "q@example.com" });
    await b.post("help-request", { v: "welcome", contact: "q@example.com" });
    expect(T.listTickets("all", x.id)).toHaveLength(0);
    const html = await b.page("welcome");
    expect(html).toContain(escd(HELP_EMPTY));
    expect(personBlock(html)).toMatch(/<textarea[^>]* required/);
  });

  test("rate limit: 5 an hour per setup code", async () => {
    const x = addBuyer("Busy Agency", "busy@example.com", false, { style: "neutral" });
    const b = await browser(x.code);
    for (let i = 0; i < HELP_PER_HOUR; i++) await b.post("help-request", { v: "welcome", problem: `try ${i}` });
    await b.post("help-request", { v: "welcome", problem: "one too many" });
    const t = T.listTickets("all", x.id);
    expect(T.messagesOf(t[0].id)).toHaveLength(HELP_PER_HOUR);
    expect(await b.page("welcome")).toContain("sent a few requests already");
  });
});

describe("the admin", () => {
  let cookie = "";
  let csrf = "";
  const get = (path: string) => fetch(`${SITE}${path}`, { headers: { cookie }, redirect: "manual" });
  const form = (path: string, f: Record<string, string> = {}, t = csrf) =>
    fetch(`${SITE}${path}`, { method: "POST", redirect: "manual", headers: { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, ...f }).toString() });

  test("Help tickets shows it with a Setup pill and the last error; the ticket links to the agency and Set up for them", async () => {
    const res = await fetch(newAdminLink("boss@example.com").replace(/^https?:\/\/[^/]+/, SITE), { method: "POST", redirect: "manual", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: "" });
    cookie = (res.headers.get("set-cookie") || "").split(";")[0];
    const list = await (await get("/admin/tickets")).text();
    csrf = list.match(/name="t" value="([^"]+)"/)![1];
    expect(list).toContain(`/admin/tickets/${ticketId}`);
    expect(list).toMatch(/<span class="pill in-setup"[^>]*>Setup<\/span>/);
    expect(list).toContain("Give your brand a name.");
    const view = await (await get(`/admin/tickets/${ticketId}`)).text();
    expect(view).toContain("step: Brand");
    expect(view).toContain("Give your brand a name.");
    expect(view).toContain("do_token");
    expect(view).toContain("dana@acme.test");
    expect(view).toContain(`href="/admin/b/${acme.id}"`);
    expect(view).toContain(`href="/admin/b/${acme.id}?tab=setup#assist"`);
    expect(view).toContain("Set up for them");
    expect(view).not.toContain(TOKEN_VALUE);
  });

  test("a red badge on Agencies and a Needs help pill on the agency row", async () => {
    const html = await (await get("/admin")).text();
    expect(html).toMatch(/Agencies[^<]*<span class="n">\d+<\/span> <span class="badge" data-badge="help"[^>]*>2<\/span>/); // Acme and Busy
    const row = html.slice(html.indexOf(`/admin/b/${acme.id}"`), html.indexOf("</tr>", html.indexOf(`/admin/b/${acme.id}"`)));
    expect(row).toContain("Needs help");
    expect(row).toContain(`/admin/tickets/${ticketId}`);
    expect(html).toContain('src="/admin-live.js"');
    expect(html).toContain("Turn on desktop alerts");
    expect(await (await get("/admin-live.js")).text()).toContain("/admin/alerts/live");
  });

  test("the live alert endpoint: signed-in only, and only what came in after since", async () => {
    expect((await fetch(`${SITE}/admin/alerts/live`)).status).toBe(401);
    const past: any = await (await get(`/admin/alerts/live?since=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`)).json();
    expect(past.ok).toBe(true);
    expect(past.needsHelp).toBe(2);
    expect(past.open).toBeGreaterThanOrEqual(2);
    const item = past.items.find((i: any) => i.id === ticketId);
    expect(item).toMatchObject({ agency: "Acme Agency", source: "wizard", url: `/admin/tickets/${ticketId}`, text: "Acme Agency needs help at the Brand step" });
    expect(JSON.stringify(past)).not.toContain("It keeps failing"); // no message bodies
    const later: any = await (await get(`/admin/alerts/live?since=${encodeURIComponent(past.now)}`)).json();
    expect(later.items).toHaveLength(0);
    expect(later.needsHelp).toBe(2);
    // A new message after "since" shows up again.
    const b = await browser(acme.code);
    await b.post("help-request", { v: "server", problem: "still stuck" });
    const again: any = await (await get(`/admin/alerts/live?since=${encodeURIComponent(past.now)}`)).json();
    expect(again.items.map((i: any) => i.id)).toContain(ticketId);
  });

  test("a reply shows on their wizard page; closing clears Needs help", async () => {
    expect((await form(`/admin/tickets/${ticketId}/reply`, { body: "Hi Dana, try the token again" }, "wrong")).status).toBe(403);
    const r = await form(`/admin/tickets/${ticketId}/reply`, { body: "Hi Dana, I've fixed the server step for you." });
    expect(r.headers.get("location")).toContain("m=ticket-replied");
    expect(T.ticketById(ticketId)!.status).toBe("waiting");
    const b = await browser(acme.code);
    const html = personBlock(await b.page("server"));
    expect(html).toContain("Hi Dana, I&#39;ve fixed the server step for you.");
    expect(html).toContain("We replied");
    // Nothing reaches an app's /api/tickets/updates (there's no app yet).
    expect(db().query("SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id = ?").get(ticketId)).toEqual({ n: 0 });
    await form(`/admin/tickets/${ticketId}/close`);
    expect(T.ticketById(ticketId)!.status).toBe("closed");
    const list = await (await get("/admin")).text();
    expect(list).toMatch(/Agencies[^<]*<span class="n">\d+<\/span> <span class="badge" data-badge="help"[^>]*>1<\/span>/);
    const row = list.slice(list.indexOf(`/admin/b/${acme.id}"`), list.indexOf("</tr>", list.indexOf(`/admin/b/${acme.id}"`)));
    expect(row).not.toContain("Needs help");
  });
});

describe("neutral style", () => {
  test("the buyer never sees our name: the form, the confirmation and our replies", async () => {
    const n = addBuyer("Quiet Agency", "quiet@example.com", false, { style: "neutral" });
    updateSetup(n.id, (s) => { s.brand = { productName: "Quiet Calls", ownerEmail: "q@quiet.test" } as any; s.domain = { host: "app.quiet.test", zone: "quiet.test", confirmed: true } as any; s.step = "server"; });
    const b = await browser(n.code);
    await b.post("help-request", { v: "server", problem: "help" });
    const t = T.listTickets("all", n.id)[0];
    T.replyToTicket(t.id, "boss@example.com", "On it.");
    const html = await b.page("server");
    const block = personBlock(html);
    expect(block).toContain("Your help request");
    expect(block).toContain("On it.");
    expect(block).toContain("<b>Support</b>");
    expect(html).toContain(escd(HELP_SENT).slice(0, 20));
    for (const name of ["Zorbo", "Twin"]) expect(block).not.toContain(name);
    expect(getSetup(n.id).flash).toBeUndefined();
  });
});
