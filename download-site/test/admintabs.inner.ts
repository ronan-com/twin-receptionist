// The checks for admintabs.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "tabs-test-"));
const PORT = 48000 + Math.floor(Math.random() * 900);
const SITE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.SITE_URL = SITE;
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "HOSTING", "ADMIN_EMAILS"]) delete process.env[k];

const { addBuyer } = await import("../lib");
const { updateSetup } = await import("../store");
const { newAdminLink } = await import("../admin-web");

let server: ReturnType<typeof Bun.spawn> | null = null;
let cookie = "";
let csrf = "";
const get = (path: string) => fetch(`${SITE}${path}`, { headers: { cookie }, redirect: "manual" });
const post = (path: string, form: Record<string, string> = {}) =>
  fetch(`${SITE}${path}`, { method: "POST", redirect: "manual", headers: { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: csrf, ...form }) });
const A = addBuyer("Tabs Agency", "tabs@example.com");
const B = addBuyer("Failed Agency", "failed@example.com");
updateSetup(A.id, (s) => { s.phase = "done"; s.step = "done"; s.brand = { productName: "Tabs AI", ownerEmail: "o@example.com", ownPhoneAccount: true } as any; s.resultUrl = "https://tabs.up.railway.app"; s.tempUrl = "https://tabs.up.railway.app"; s.firstLogin = { token: "SECRETTOKEN".repeat(4), at: new Date().toISOString() }; });
updateSetup(B.id, (s) => { s.phase = "failed"; s.step = "install"; s.error = "boom"; });

beforeAll(async () => {
  server = Bun.spawn(["bun", "server.ts"], { cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "ignore", env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", SITE_URL: SITE, DATA_DIR: dir, ADMIN_EMAILS: "boss@example.com", MOCK_RAILWAY: "1" } });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${SITE}/healthz`)).ok) break; } catch {}
    await Bun.sleep(100);
  }
  const link = newAdminLink("boss@example.com");
  const res = await fetch(link.replace(/^https?:\/\/[^/]+/, SITE), { method: "POST", redirect: "manual", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: "" });
  cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  csrf = (await (await get("/admin")).text()).match(/name="t" value="([^"]+)"/)![1];
}, 30_000);
afterAll(() => { server?.kill(); });

describe("top tabs", () => {
  test("the signed-out page has no tabs; the stylesheet is served", async () => {
    const out = await (await fetch(`${SITE}/admin`)).text();
    expect(out).toContain("AI Agency Admin");
    expect(out).not.toContain('class="atabs"');
    expect(out).not.toMatch(/chloe/i);
    const css = await fetch(`${SITE}/admin.css`);
    expect(css.status).toBe(200);
  });
  for (const [path, tab] of [["/admin", "Agencies"], ["/admin/agencies", "Agencies"], ["/admin/tickets", "Help tickets"], ["/admin/alerts", "Alerts"], ["/admin/problems", "Alerts"], ["/admin/releases", "Releases"], ["/admin/settings", "Settings"]] as const) {
    test(`${path} renders with the ${tab} tab selected`, async () => {
      const r = await get(path);
      expect(r.status).toBe(200);
      const h = await r.text();
      expect(h).toContain('<nav class="atabs"');
      for (const t of ["Agencies", "Help tickets", "Alerts", "Releases", "Settings"]) expect(h).toContain(t);
      expect(h).toMatch(new RegExp(`class="atab t-\\w+ on" aria-current="page"><svg[^>]*>.*?</svg>${tab}`));
      expect(h).not.toMatch(/chloe/i);
    });
  }
  test("the agencies list: search button, no stray Show button, test runs moved to Settings", async () => {
    const h = await (await get("/admin")).text();
    expect(h).toContain("Tabs Agency");
    expect(h).toContain(">Search</button>");
    expect(h).not.toContain(">Show</button>");
    expect(h).toContain('action="/admin/buyers"');
    expect((await (await get("/admin?q=failed")).text())).not.toContain("Tabs Agency");
  });
});

describe("agency tabs", () => {
  test("Overview (default), Setup steps, Support, Settings all render", async () => {
    const want: Record<string, string[]> = {
      "": ["Summary", "Private setup link"],
      "?tab=setup": ["Keys we hold", "Open their setup (read-only)", 'id="assist"', 'id="invite"'],
      "?tab=support": ["Support tools", "Help tickets"],
      "?tab=settings": ["Danger zone", `action="/admin/b/${A.id}/revoke"`, `action="/admin/b/${A.id}/delete"`],
    };
    for (const [q, bits] of Object.entries(want)) {
      const r = await get(`/admin/b/${A.id}${q}`);
      expect(r.status).toBe(200);
      const h = await r.text();
      expect(h).toContain('class="dtabs"');
      for (const b of bits) expect(h).toContain(b);
      for (const t of ["Overview", "Setup steps", "Support", "Settings"]) expect(h).toContain(t);
    }
    expect(await (await get(`/admin/a/${A.id}`)).text()).toContain("Summary"); // the old /admin/a/ address
    expect((await get(`/admin/b/${A.id}?tab=nonsense`)).status).toBe(200);
    expect((await get("/admin/b/99999")).status).toBe(404);
  });
  test("Support tools show Sync now / View as on a live agency", async () => {
    const h = await (await get(`/admin/b/${A.id}?tab=support`)).text();
    // not synced yet (installed with no heartbeat): the tab explains instead of showing dead buttons
    expect(h).toMatch(/installed before syncing existed|Sync now/);
  });
  test("the read-only setup view never shows the owner's one-time sign-in token", async () => {
    const h = await (await get(`/admin/b/${A.id}/setup`)).text();
    expect(h).not.toContain("SECRETTOKEN");
    expect(h).not.toContain("/welcome?t=");
  });
  test("a failed agency shows Reset in its danger zone; the read-only setup view and the actions still work", async () => {
    expect(await (await get(`/admin/b/${B.id}?tab=settings`)).text()).toContain(`action="/admin/b/${B.id}/reset"`);
    expect((await get(`/admin/b/${A.id}/setup`)).status).toBe(200);
    const rv = await post(`/admin/b/${A.id}/revoke`);
    expect(rv.headers.get("location")).toContain(`/admin/b/${A.id}?tab=settings&m=revoked`);
    expect(await (await get(`/admin/b/${A.id}?tab=settings`)).text()).toContain(`action="/admin/b/${A.id}/restore"`);
    expect((await post(`/admin/b/${A.id}/restore`)).headers.get("location")).toContain("m=restored");
    expect((await post(`/admin/b/${B.id}/reset`)).headers.get("location")).toContain("m=reset");
    expect((await post(`/admin/b/${B.id}/delete`)).headers.get("location")).toBe("/admin?m=deleted");
    expect((await post(`/admin/b/${A.id}/revoke`, { t: "wrong" })).status).toBe(403);
  });
});
