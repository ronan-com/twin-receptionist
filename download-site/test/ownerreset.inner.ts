// The checks for ownerreset.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "ownerreset-test-"));
const PORT = 47000 + Math.floor(Math.random() * 900);
const APP_PORT = PORT + 1000;
const SITE = `http://127.0.0.1:${PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SITE_URL = SITE;
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "HOSTING", "PREVIEW_JUMP"]) delete process.env[k];

const { addBuyer } = await import("../lib");
const sync = await import("../sync");
const { updateSetup } = await import("../store");

const RESET = `${APP}/reset/${"R".repeat(43)}`;
let server: ReturnType<typeof Bun.spawn> | null = null;
let app: ReturnType<typeof Bun.serve> | null = null;
let mode: "ok" | "old" | "refused" | "evil" | "down" = "ok";
const appSeen: { path: string; auth: string }[] = [];

beforeAll(async () => {
  app = Bun.serve({
    port: APP_PORT, hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      appSeen.push({ path, auth: req.headers.get("authorization") || "" });
      if (path !== "/api/support/owner-reset-link") return new Response("no", { status: 404 });
      if (mode === "old") return Response.json({ error: "Not found" }, { status: 404 }); // a version before this existed
      if (mode === "refused") return Response.json({ error: "Not allowed." }, { status: 401 });
      if (mode === "evil") return Response.json({ ok: true, url: "https://evil.example/reset/" + "R".repeat(43), expiresInMinutes: 15 });
      return Response.json({ ok: true, url: RESET, expiresInMinutes: 15 });
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

function finished(name: string, token = true) {
  const b = addBuyer(name, `${name.replace(/\W/g, "").toLowerCase()}@example.com`);
  if (token) sync.newSyncToken(b.id);
  updateSetup(b.id, (s) => { s.phase = "done"; s.step = "done"; s.brand = { productName: "Acme AI", ownerEmail: "owner@example.com", ownPhoneAccount: true }; s.resultUrl = APP; s.phones = { confirmed: true, provider: "telnyx" }; s.railway = { workspaceName: "Acme", confirmed: true }; s.rw = { projectId: "p1" }; s.extrasDone = true; });
  return b;
}
/** Opens the buyer's setup link like a browser, then presses the button. */
async function press(code: string) {
  const page = await fetch(`${SITE}/setup/${code}`);
  const cookie = (page.headers.get("set-cookie") || "").split(";")[0];
  const html = await page.text();
  const t = html.match(/name="t" value="([^"]+)"/)![1];
  const res = await fetch(`${SITE}/setup/${code}/a/owner-reset`, { method: "POST", redirect: "manual", headers: { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, v: "done" }).toString() });
  return { page: html, res, cookie, body: await res.text() };
}

describe("ownerResetLink (the setup site calling the app)", () => {
  const fake = (status: number, body: unknown, seen: { url?: string; auth?: string } = {}) =>
    (async (url: any, init: any) => { seen.url = String(url); seen.auth = init?.headers?.authorization; return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;

  test("presents the call token, needs no Support access, and takes a link only on the app's own address", async () => {
    const b = addBuyer("Call Buyer", "callbuyer@example.com");
    const { callToken } = sync.newSyncToken(b.id);
    const seen: any = {};
    const ok = await sync.ownerResetLink(b.id, "https://app.acme.example", fake(200, { ok: true, url: `https://app.acme.example/reset/${"A".repeat(43)}`, expiresInMinutes: 15 }, seen));
    expect(ok).toEqual({ ok: true, url: `https://app.acme.example/reset/${"A".repeat(43)}`, minutes: 15 });
    expect(seen.url).toBe("https://app.acme.example/api/support/owner-reset-link");
    expect(seen.auth).toBe(`Bearer ${callToken}`);
    expect(await sync.ownerResetLink(b.id, "https://app.acme.example", fake(200, { ok: true, url: "https://evil.example/reset/x".padEnd(60, "x") }))).toMatchObject({ ok: false, reason: "error" });
    expect(await sync.ownerResetLink(b.id, "https://app.acme.example", fake(429, { error: "rate_limited" }))).toMatchObject({ ok: false, reason: "limited" });
    expect(await sync.ownerResetLink(b.id, "https://app.acme.example", (async () => { throw new Error("down"); }) as any)).toMatchObject({ ok: false, reason: "unreachable" });
  });

  test("an install from before this existed is told to update first", async () => {
    const b = addBuyer("Old Buyer", "oldbuyer@example.com"); // no call token at all
    expect(await sync.ownerResetLink(b.id, APP, fake(200, {}))).toEqual({ ok: false, reason: "outdated", message: "Update your agency first, then try again." });
    const c = addBuyer("Old Buyer 2", "oldbuyer2@example.com");
    sync.newSyncToken(c.id); // has the token, but its app doesn't know the route
    expect(await sync.ownerResetLink(c.id, "https://app.acme.example", fake(404, { error: "Not found" }))).toMatchObject({ ok: false, reason: "outdated" });
    expect(await sync.ownerResetLink(c.id, "https://app.acme.example", fake(401, { error: "Not allowed." }))).toMatchObject({ ok: false, reason: "outdated" });
  });
});

describe("the Done screen on the real site, with a fake app", () => {
  test("the Done screen offers 'Locked out? Reset your owner password'", async () => {
    const b = finished("Done Screen");
    const page = await (await fetch(`${SITE}/setup/${b.code}`)).text();
    expect(page).toContain("Locked out? Reset your owner password");
    expect(page).toContain("/a/owner-reset");
    expect(page).not.toContain("data-owner-reset-link");
  });

  test("pressing it shows a big 'Set a new password' button with the app's link, once", async () => {
    mode = "ok";
    appSeen.length = 0;
    const b = finished("Happy Path");
    const r = await press(b.code);
    expect(r.res.status).toBe(200);
    expect(r.body).toContain("Set a new password");
    expect(r.body).toContain(`href="${RESET}"`);
    expect(r.body).toContain("data-owner-reset-link");
    expect(appSeen).toEqual([{ path: "/api/support/owner-reset-link", auth: `Bearer ${sync.callToken(b.id)}` }]);
    // Not stored: loading the setup link again doesn't show the link.
    const again = await (await fetch(`${SITE}/setup/${b.code}`, { headers: { cookie: r.cookie } })).text();
    expect(again).not.toContain("R".repeat(43));
    expect(JSON.stringify((await import("../store")).getSetup(b.id))).not.toContain("R".repeat(43));
  });

  test("an install without the call token says to update first and never calls the app", async () => {
    appSeen.length = 0;
    const b = finished("Old Install", false);
    const r = await press(b.code);
    expect(r.body).toContain("Update your agency first, then try again.");
    expect(r.body).not.toContain("data-owner-reset-link");
    expect(appSeen.length).toBe(0);
  });

  test("an app that doesn't know the route says to update first; a link to another address isn't offered", async () => {
    const b = finished("Old App");
    mode = "old";
    expect((await press(b.code)).body).toContain("Update your agency first, then try again.");
    mode = "evil";
    const e = await press(b.code);
    expect(e.body).not.toContain("evil.example");
    expect(e.body).not.toContain("data-owner-reset-link");
    mode = "down";
  });

  test("an unfinished install can't use it, and a wrong form token is refused", async () => {
    const b = addBuyer("Unfinished", "unfinished@example.com");
    sync.newSyncToken(b.id);
    const r = await press(b.code);
    expect(r.body).not.toContain("data-owner-reset-link");
    const page = await fetch(`${SITE}/setup/${b.code}`);
    const cookie = (page.headers.get("set-cookie") || "").split(";")[0];
    const bad = await fetch(`${SITE}/setup/${b.code}/a/owner-reset`, { method: "POST", redirect: "manual", headers: { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: "t=wrong" });
    expect(bad.status).toBe(403);
  });

  test("it is rate-limited per buyer", async () => {
    mode = "ok";
    const b = finished("Limited");
    let limited = false;
    for (let i = 0; i < 8; i++) if ((await press(b.code)).body.includes("Wait")) limited = true;
    expect(limited).toBe(true);
  });
});
