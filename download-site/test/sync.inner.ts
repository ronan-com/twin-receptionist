// The checks for sync.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "sync-test-"));
const PORT = 46000 + Math.floor(Math.random() * 900);
const APP_PORT = PORT + 1000;
const SITE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SITE_URL = SITE;
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "HOSTING", "PREVIEW_JUMP"]) delete process.env[k];

const { addBuyer, db } = await import("../lib");
const sync = await import("../sync");
const { updateSetup } = await import("../store");
const { newAdminLink } = await import("../admin-web");

const good = (over: Record<string, any> = {}) => ({
  v: 1, sentAt: new Date().toISOString(), appVersion: "2026.11.1", publicUrl: "https://app.acme.example",
  health: { ok: true, db: true, phoneKey: true, openIncidents: 0 },
  counts: { agencies: 1, clients: 3, receptionists: 4, numbers: 4, calls24h: 5, calls7d: 31, calls30d: 120, bookings7d: 6, errors24h: 0 },
  lastCallAt: new Date().toISOString(),
  brand: { name: "Acme AI", logoUrl: "https://app.acme.example/brand/abc" },
  extras: { email: true, domain: false, openRouter: true },
  support: { sharing: true, access: false, accessUntil: null },
  ...over,
});
const post = (token: string | null, body: unknown, extra: Record<string, string> = {}) =>
  new Request(`${SITE}/api/sync`, { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("tokens", () => {
  test("only the hash is stored; the token authenticates; a new token replaces the old", () => {
    const b = addBuyer("Tok Buyer", "tok@example.com");
    const { token, callToken } = sync.newSyncToken(b.id);
    expect(token).toMatch(sync.TOKEN_RE);
    expect(sync.buyerBySyncToken(token)).toBe(b.id);
    expect(sync.buyerBySyncToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(sync.buyerBySyncToken("nope")).toBeNull();
    // No table holds the token or the call token.
    for (const t of ["sync_tokens", "sync_snapshots", "sync_history", "setups", "buyers", "secrets"]) {
      expect(JSON.stringify(db().query(`SELECT * FROM ${t}`).all())).not.toContain(token.slice(3));
      expect(JSON.stringify(db().query(`SELECT * FROM ${t}`).all())).not.toContain(callToken.slice(3));
    }
    expect(callToken).toMatch(/^sc_[A-Za-z0-9_-]{43}$/);
    expect(callToken).not.toBe(token);
    expect(sync.callToken(b.id)).toBe(callToken);
    for (const t = Date.now(); Date.now() - t < 5; ); // the call token is derived from the creation time (ms): don't create both in the same ms
    const second = sync.newSyncToken(b.id);
    expect(sync.buyerBySyncToken(token)).toBeNull();
    expect(sync.buyerBySyncToken(second.token)).toBe(b.id);
    expect(second.callToken).not.toBe(callToken);
    const other = addBuyer("Other", "o@example.com");
    expect(sync.newSyncToken(other.id).callToken).not.toBe(second.callToken);
    expect(sync.callToken(99999)).toBeNull();
  });
});

describe("receiving a heartbeat", () => {
  test("a good snapshot is stored (latest + a short history)", () => {
    const b = addBuyer("Rx Buyer", "rx@example.com");
    const { token } = sync.newSyncToken(b.id);
    const r = sync.receive(token, JSON.stringify(good()));
    expect(r.status).toBe(200);
    const st = sync.latestSnapshot(b.id)!;
    expect(st.snap.counts.calls7d).toBe(31);
    expect(st.snap.appVersion).toBe("2026.11.1");
    expect(sync.history(b.id)).toHaveLength(1);
    for (let i = 0; i < 60; i++) sync.receive(token, JSON.stringify(good()));
    expect(sync.history(b.id, 100)).toHaveLength(48);
  });

  test("wrong token, bad JSON, wrong version, oversized: refused and nothing stored", () => {
    const b = addBuyer("Bad Buyer", "bad@example.com");
    const { token } = sync.newSyncToken(b.id);
    expect(sync.receive("st_" + "x".repeat(43), JSON.stringify(good())).status).toBe(401);
    expect(sync.receive(token, "{nope").status).toBe(400);
    expect(sync.receive(token, JSON.stringify({ ...good(), v: 2 })).status).toBe(400);
    expect(sync.receive(token, JSON.stringify({ ...good(), brand: { name: "x".repeat(sync.MAX_SYNC_BODY), logoUrl: "" } })).status).toBe(413);
    expect(sync.latestSnapshot(b.id)).toBeNull();
  });

  test("whitelist: unknown fields are dropped and personal details in text never get stored", () => {
    const b = addBuyer("Pii Buyer", "pii@example.com");
    const { token } = sync.newSyncToken(b.id);
    const dirty = good({
      callerName: "Jane Citizen", transcript: "I need help with my tax", from_number: "+61412345678",
      brand: { name: "Ring 0412 345 678", logoUrl: "javascript:alert(1)", owner: "me@example.com" },
      counts: { ...good().counts, callers: ["+61400000000"] },
      health: { ...good().health, lastError: "KEY0123456789012345678901_abcdefghijk" },
    });
    expect(sync.receive(token, JSON.stringify(dirty)).status).toBe(200);
    const stored = JSON.stringify(db().query("SELECT data FROM sync_snapshots WHERE buyer_id = ?").all(b.id)) + JSON.stringify(db().query("SELECT data FROM sync_history WHERE buyer_id = ?").all(b.id));
    for (const x of ["Jane", "tax", "61412345678", "0412 345 678", "javascript", "me@example.com", "61400000000", "KEY01234", "callerName"]) expect(stored).not.toContain(x);
    expect(sync.latestSnapshot(b.id)!.snap.brand.name).toBe("");
    expect(Object.keys(sync.cleanSnapshot(dirty)!).sort()).toEqual(Object.keys(sync.SHAPE).sort());
  });
});

describe("how a buyer looks", () => {
  const at = (minsAgo: number, over: Record<string, any> = {}) => ({ snap: sync.cleanSnapshot(good(over))!, receivedAt: new Date(Date.now() - minsAgo * 60_000).toISOString(), source: "heartbeat" });
  test("live, quiet, offline, never; and the health dot", () => {
    expect(sync.seen(null)).toBe("never");
    expect(sync.seen(at(10))).toBe("live");
    expect(sync.seen(at(120))).toBe("quiet");
    expect(sync.seen(at(60 * 30))).toBe("offline");
    expect(sync.dot(null)).toBe("grey");
    expect(sync.dot(at(10))).toBe("green");
    expect(sync.dot(at(10, { counts: { ...good().counts, errors24h: 2 } }))).toBe("amber");
    expect(sync.dot(at(10, { health: { ...good().health, ok: false } }))).toBe("amber");
    expect(sync.dot(at(10, { health: { ...good().health, db: false } }))).toBe("red");
    expect(sync.dot(at(120))).toBe("amber");
    expect(sync.dot(at(60 * 30))).toBe("red");
  });
});

describe("calling the buyer's app", () => {
  const APP = "https://app.acme.example";
  const fake = (status: number, body: unknown, seen: { url?: string; auth?: string } = {}) =>
    (async (url: any, init: any) => { seen.url = String(url); seen.auth = init?.headers?.authorization; return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;

  test("we only call an app's own https address", () => {
    expect(sync.appBase("https://app.acme.example/x?y")).toBe("https://app.acme.example");
    for (const bad of ["http://app.acme.example", "https://127.0.0.1", "https://169.254.169.254", "https://localhost", "https://app.internal", "https://user:pw@app.acme.example", "https://app.acme.example:8443", "ftp://x.example", "", "not a url", "https://[::1]"]) expect(sync.appBase(bad)).toBeNull();
  });

  test("Sync now presents the call token, stores what the app answers, and respects sharing being off", async () => {
    const b = addBuyer("Call Buyer", "call@example.com");
    const { callToken } = sync.newSyncToken(b.id);
    const seenReq: any = {};
    const ok = await sync.syncNow(b.id, APP, fake(200, { ok: true, sharing: true, snapshot: good({ junk: 1 }) }, seenReq));
    expect(ok.ok).toBe(true);
    expect(seenReq.url).toBe(`${APP}/api/support/ping`);
    expect(seenReq.auth).toBe(`Bearer ${callToken}`);
    expect(sync.latestSnapshot(b.id)!.source).toBe("sync-now");
    expect(await sync.syncNow(b.id, APP, fake(200, { ok: true, sharing: false }))).toMatchObject({ ok: false, reason: "off" });
    expect(await sync.syncNow(b.id, APP, fake(401, { error: "x" }))).toMatchObject({ ok: false, reason: "refused" });
    expect(await sync.syncNow(b.id, "", fake(200, {}))).toMatchObject({ ok: false, reason: "no-app" });
    expect(await sync.syncNow(b.id, APP, (async () => { throw new Error("down"); }) as any)).toMatchObject({ ok: false, reason: "unreachable" });
    const old = addBuyer("Old Buyer", "old@example.com"); // installed before syncing: no token
    expect(await sync.syncNow(old.id, APP, fake(200, {}))).toMatchObject({ ok: false, reason: "no-app" });
  });

  test("View as: refused when the buyer has access off; a link only on the app's own address", async () => {
    const b = addBuyer("View Buyer", "view@example.com");
    const { callToken } = sync.newSyncToken(b.id);
    const tok = "A".repeat(43);
    const seenReq: any = {};
    const ok = await sync.viewAsLink(b.id, APP, fake(200, { ok: true, url: `${APP}/api/support/in/${tok}`, expiresInSeconds: 60 }, seenReq));
    expect(ok).toEqual({ ok: true, url: `${APP}/api/support/in/${tok}` });
    expect(seenReq.url).toBe(`${APP}/api/support/login-link`);
    expect(seenReq.auth).toBe(`Bearer ${callToken}`);
    expect(await sync.viewAsLink(b.id, APP, fake(403, { ok: false, error: "access_off" }))).toMatchObject({ ok: false, reason: "off" });
    expect(await sync.viewAsLink(b.id, APP, fake(200, { ok: true, url: `https://evil.example/api/support/in/${tok}` }))).toMatchObject({ ok: false, reason: "error" });
    expect(await sync.viewAsLink(b.id, APP, fake(200, { ok: true, url: `${APP}/api/support/in/${tok}" onclick="x` }))).toMatchObject({ ok: false });
    expect(await sync.viewAsLink(b.id, APP, fake(401, {}))).toMatchObject({ ok: false, reason: "refused" });
  });
});

// ---- the real server, and a pretend buyer's app ----
let server: ReturnType<typeof Bun.spawn> | null = null;
let app: ReturnType<typeof Bun.serve> | null = null;
const appSeen: { path: string; auth: string }[] = [];
let appAccess = false;

beforeAll(async () => {
  app = Bun.serve({
    port: APP_PORT, hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      appSeen.push({ path, auth: req.headers.get("authorization") || "" });
      if (path === "/api/support/ping") return Response.json({ ok: true, sharing: true, snapshot: good({ appVersion: "2026.11.9", counts: { ...good().counts, calls7d: 77 }, support: { sharing: true, access: appAccess, accessUntil: null } }) });
      if (path === "/api/support/login-link") return appAccess ? Response.json({ ok: true, url: `http://127.0.0.1:${APP_PORT}/api/support/in/${"B".repeat(43)}`, expiresInSeconds: 60 }) : Response.json({ ok: false, error: "access_off" }, { status: 403 });
      return new Response("no", { status: 404 });
    },
  });
  server = Bun.spawn(["bun", "server.ts"], {
    cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "ignore",
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", SITE_URL: SITE, DATA_DIR: dir, ADMIN_EMAILS: "boss@example.com", MOCK_RAILWAY: "1" },
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${SITE}/healthz`)).ok) return; } catch {}
    await Bun.sleep(100);
  }
  throw new Error("the site didn't start");
}, 30_000);
afterAll(() => { server?.kill(); app?.stop(true); });

describe("POST /api/sync on the real site", () => {
  test("token auth, then the per-buyer rate limit, then the per-address limit for bad tokens", async () => {
    const b = addBuyer("Http Buyer", "http@example.com");
    const { token } = sync.newSyncToken(b.id);
    expect((await fetch(post(token, good()))).status).toBe(200);
    expect(sync.latestSnapshot(b.id)!.snap.appVersion).toBe("2026.11.1");
    expect((await fetch(post(null, good()))).status).toBe(401);
    expect((await fetch(post("st_" + "z".repeat(43), good()))).status).toBe(401);
    expect((await fetch(`${SITE}/api/sync`)).status).toBe(405);
    expect((await fetch(post(token, "x".repeat(70_000)))).status).toBe(413);
    let limited = 0;
    for (let i = 0; i < 25; i++) if ((await fetch(post(token, good()))).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
    let badLimited = 0;
    for (let i = 0; i < 40; i++) if ((await fetch(post("st_" + "q".repeat(43), good()))).status === 429) badLimited++;
    expect(badLimited).toBeGreaterThan(0);
  });
});

describe("the admin pages", () => {
  let cookie = "";
  let csrf = "";
  const adminGet = (path: string) => fetch(`${SITE}${path}`, { headers: { cookie }, redirect: "manual" });
  const adminPost = (path: string, form: Record<string, string> = {}) =>
    fetch(`${SITE}${path}`, { method: "POST", redirect: "manual", headers: { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: csrf, ...form }).toString() });
  let buyerId = 0;

  test("sign in, and the buyers list shows Live, version, calls 7d and receptionists", async () => {
    const link = newAdminLink("boss@example.com");
    const res = await fetch(link.replace(/^https?:\/\/[^/]+/, SITE), { method: "POST", redirect: "manual", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: "" });
    cookie = (res.headers.get("set-cookie") || "").split(";")[0];
    expect(cookie).toMatch(/^as=/);
    const b = addBuyer("Live Buyer", "live@example.com");
    buyerId = b.id;
    sync.newSyncToken(b.id);
    updateSetup(b.id, (s) => { s.phase = "done"; s.step = "done"; s.brand = { productName: "Acme AI", ownerEmail: "owner@example.com", ownPhoneAccount: true }; s.resultUrl = `http://127.0.0.1:${APP_PORT}`; });
    sync.storeSnapshot(b.id, sync.cleanSnapshot(good({ appVersion: "2026.11.5" }))!, "heartbeat");
    const html = await (await adminGet("/admin")).text();
    csrf = html.match(/name="t" value="([^"]+)"/)![1];
    const row = html.slice(html.indexOf("Live Buyer"));
    expect(row).toContain("seen-live");
    expect(row).toContain("2026.11.5");
    expect(row).toContain(">31<");
  });

  test("the buyer page shows the snapshot; with Support access off it says to ask the buyer", async () => {
    expect(await (await adminGet(`/admin/b/${buyerId}`)).text()).toContain("<h2>Health</h2>");
    const html = await (await adminGet(`/admin/b/${buyerId}?tab=support`)).text();
    expect(html).toContain("Support tools");
    expect(html).toContain("Sync now");
    expect(html).toContain("The agency has switched Support access off");
    expect(html).toMatch(/<button class="btn o" type="button" disabled>View as<\/button>/);
    expect(html).not.toContain("callerName");
  });

  test("Sync now calls their app with our token and refreshes the numbers", async () => {
    appAccess = false;
    appSeen.length = 0;
    const r = await adminPost(`/admin/b/${buyerId}/sync`);
    expect(r.headers.get("location")).toContain("m=sync-ok");
    expect(appSeen[0].path).toBe("/api/support/ping");
    expect(appSeen[0].auth).toBe(`Bearer ${sync.callToken(buyerId)}`);
    expect(sync.latestSnapshot(buyerId)!.snap.counts.calls7d).toBe(77);
    expect((await adminPost(`/admin/b/${buyerId}/sync`, { t: "wrong" })).status).toBe(403);
  });

  test("View as: refused while access is off; with it on we get a one-time link; both are logged", async () => {
    appAccess = false;
    const off = await adminPost(`/admin/b/${buyerId}/view-as`);
    expect(off.headers.get("location")).toContain("m=view-off");
    appAccess = true;
    const on = await adminPost(`/admin/b/${buyerId}/view-as`);
    expect(on.status).toBe(200);
    const html = await on.text();
    expect(html).toContain(`href="http://127.0.0.1:${APP_PORT}/api/support/in/${"B".repeat(43)}"`);
    expect(html).toContain("works once");
    const log = sync.supportLog(buyerId, 10);
    expect(log.map((l) => l.action + ":" + l.note)).toEqual(expect.arrayContaining(["view-as:refused: off", "view-as:link issued", "sync-now:ok"]));
    expect(log.every((l) => l.admin_email === "boss@example.com")).toBe(true);
  });

  test("deleting a buyer deletes what we held from their app", async () => {
    const r = await adminPost(`/admin/b/${buyerId}/delete`);
    expect(r.headers.get("location")).toContain("m=deleted");
    for (const t of ["sync_tokens", "sync_snapshots", "sync_history"]) expect(db().query(`SELECT COUNT(*) AS n FROM ${t} WHERE buyer_id = ?`).get(buyerId)).toEqual({ n: 0 });
  });
});
