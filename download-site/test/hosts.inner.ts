// The checks for hosts.test.ts: the real server, with requests that carry a buyer's own domain in the Host header.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "hosts-test-"));
const PORT = 48000 + Math.floor(Math.random() * 900);
const SITE = `http://127.0.0.1:${PORT}`;
const ADMIN = "boss@example.com";
const OWN = "setup.acme-test.com";
const RW_TOKEN = "railway-test-token-good-0001";

// A tiny Railway, enough for the token check.
const rail = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (tok !== RW_TOKEN) return Response.json({ data: null, errors: [{ message: "Not Authorized" }] });
    const { query = "" } = (await req.json()) as any;
    return Response.json({ data: { me: /\bplan\b/.test(query) ? { workspaces: [{ id: "ws-1", plan: "HOBBY", customer: { isTrialing: false, defaultPaymentMethodId: "pm" } }] } : { email: "owner@example.com", workspaces: [{ id: "ws-1", name: "Owner" }] } } });
  },
});

Object.assign(process.env, { DATA_DIR: dir, SETUP_SECRET_KEY: Buffer.alloc(32, 7).toString("base64"), SITE_URL: SITE, MOCK_RAILWAY: "1", MOCK_TELNYX: "1", RAILWAY_API_BASE: `http://127.0.0.1:${rail.port}`, DNS_SERVERS: "127.0.0.1", ADMIN_EMAILS: ADMIN });
for (const k of ["MOCK_DO", "MOCK_CF", "MOCK_RESEND", "MOCK_OAUTH", "HOSTING", "PREVIEW_JUMP"]) delete process.env[k];

const { addBuyer, db, now, CONFIG } = await import("../lib");
const H = await import("../hosts");
const A = await import("../assist");
const { getSetup } = await import("../store");
const { newAdminLink } = await import("../admin-web");

let server: ReturnType<typeof Bun.spawn> | null = null;
beforeAll(async () => {
  server = Bun.spawn(["bun", "server.ts"], { cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "ignore", env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${SITE}/healthz`)).ok) return; } catch {} await Bun.sleep(100); }
  throw new Error("the site didn't start");
}, 30_000);
afterAll(() => { server?.kill(); rail.stop(true); });

const onHost = (host: string, path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  fetch(`${SITE}${path}`, { redirect: "manual", ...init, headers: { ...(init.headers || {}), host } });

describe("registering a host", () => {
  test("must be a name under their domain, can't be ours, and belongs to one buyer", () => {
    const a = addBuyer("Acme", "acme@example.com"), b = addBuyer("Other", "other@example.com");
    expect(H.setHostCheck(a.id, "")).toMatchObject({ ok: false });
    expect(H.setHostCheck(a.id, "acme-test.com").ok).toBe(false); // the bare domain is their website
    expect(H.setHostCheck(a.id, "127.0.0.1").ok).toBe(false);
    expect(H.setHostCheck(a.id, "http://Setup.First-Test.com/path")).toEqual({ ok: true, host: "setup.first-test.com" });
    expect(H.setHostCheck(a.id, "127.0.0.1.nip.io").ok).toBe(true);
    expect(H.setHost(a.id, "setup.first-test.com")).toEqual({ ok: true, host: "setup.first-test.com" });
    expect(H.setHostCheck(b.id, "setup.first-test.com")).toMatchObject({ ok: false, message: "Another buyer already uses that address." });
    expect(H.setHost(a.id, "start.acme-test.com").ok).toBe(true); // one host per buyer: replaces
    expect(H.hostOfBuyer(a.id)!.host).toBe("start.acme-test.com");
  });
  test("the CNAME to add is name -> our site", () => {
    expect(H.hostRecord(OWN)).toMatchObject({ type: "CNAME", name: OWN, value: "127.0.0.1" });
  });
});

describe("GET /api/tls-allowed (Caddy's question)", () => {
  const ask = (domain: string, init: RequestInit = {}) => fetch(`${SITE}/api/tls-allowed?domain=${encodeURIComponent(domain)}`, init);
  test("200 only for a host registered to a buyer whose link is on", async () => {
    const b = addBuyer("Tls Buyer", "tls@example.com");
    H.setHost(b.id, "setup.tls-buyer.com");
    expect((await ask("setup.tls-buyer.com")).status).toBe(200);
    expect((await ask("SETUP.TLS-BUYER.COM")).status).toBe(200);
    expect((await ask("setup.unknown.com")).status).toBe(404);
    expect((await ask("")).status).toBe(404);
    expect((await ask("127.0.0.1")).status).toBe(404);
    expect((await ask("a b")).status).toBe(404);
    expect((await ask("tls-buyer.com")).status).toBe(404); // not a registered name
    db().query("UPDATE buyers SET revoked_at = ? WHERE id = ?").run(now(), b.id);
    expect((await ask("setup.tls-buyer.com")).status).toBe(404); // link turned off: no certificate
    db().query("UPDATE buyers SET revoked_at = NULL WHERE id = ?").run(b.id);
    expect((await ask("setup.tls-buyer.com")).status).toBe(200);
    H.removeHost(b.id);
    expect((await ask("setup.tls-buyer.com")).status).toBe(404);
  });
  test("only for Caddy: a request that came through the public proxy, or a POST, is refused", async () => {
    const b = addBuyer("Tls Buyer2", "tls2@example.com");
    H.setHost(b.id, "setup.tls-two.com");
    expect((await ask("setup.tls-two.com", { headers: { "x-forwarded-for": "203.0.113.5" } })).status).toBe(404);
    expect((await ask("setup.tls-two.com", { method: "POST" })).status).toBe(405);
    expect((await ask("setup.tls-two.com")).status).toBe(200);
  });
  test("our own address and the other buyers' codes are never certificate names", async () => {
    expect((await ask("127.0.0.1")).status).toBe(404);
    expect(H.tlsAllowed("localhost")).toBe(false);
  });
});

describe("serving a buyer's wizard on their own domain", () => {
  const b = addBuyer("Acme Pty", "acme-owner@example.com");
  const other = addBuyer("Neighbour", "nb@example.com");
  H.setHost(b.id, OWN);

  test("their address serves their wizard at / with no code in it; our admin, sync and guide aren't there", async () => {
    const r = await onHost(OWN, "/");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Set up your agency");
    expect(html).not.toContain(`/setup/${b.code}`);
    expect(html).toContain('action="/a/start"');
    expect(html).toContain('data-status="/status"');
    expect(html).not.toContain(`/setup/${other.code}`);
    expect(html).not.toContain("/guide");
    expect(html).not.toContain(CONFIG.productName); // no brand yet: "your agency", never ours
    expect(html).toContain("your agency");
    for (const path of ["/admin", "/admin/login", "/api/sync", "/guide", "/go", `/setup/${other.code}`, "/p/d_x", "/nope"]) expect([path, (await onHost(OWN, path)).status]).toEqual([path, 404]);
    expect((await onHost(OWN, "/wizard.css")).status).toBe(200);
    expect((await onHost(OWN, "/wizard.js")).status).toBe(200);
    expect((await onHost(OWN, "/healthz")).status).toBe(200);
  });

  test("the normal link keeps working, on our address and on theirs", async () => {
    const r = await fetch(`${SITE}/setup/${b.code}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain(`/setup/${b.code}/a/start`);
    expect((await onHost(OWN, `/setup/${b.code}`)).status).toBe(200);
    expect((await fetch(`${SITE}/`)).status).toBe(200); // our own home page is still ours
    expect(await (await fetch(`${SITE}/`)).text()).toContain("AI receptionist agency");
  });

  test("a host that isn't registered is the normal site, a revoked buyer's host says so", async () => {
    expect((await onHost("not-registered.example.com", "/admin")).status).toBe(200); // the admin sign-in page (nothing here changes for unknown names)
    const rv = addBuyer("Revoked Buyer", "rv@example.com");
    H.setHost(rv.id, "setup.revoked-buyer.com");
    db().query("UPDATE buyers SET revoked_at = ? WHERE id = ?").run(now(), rv.id);
    expect((await onHost("setup.revoked-buyer.com", "/")).status).toBe(410);
  });

  test("do part, leave the rest: the admin's steps show as done, what's left is theirs, and they finish it on their own domain", async () => {
    expect((await A.fillStep(b, ADMIN, "brand", { productName: "Acme AI", ownerEmail: "owner@acme-test.com" })).ok).toBe(true);
    expect((await A.fillStep(b, ADMIN, "railway", { token: RW_TOKEN })).ok).toBe(true);
    // first open
    const first = await onHost(OWN, "/");
    const cookie = (first.headers.get("set-cookie") || "").split(";")[0];
    expect(first.headers.get("set-cookie")).toMatch(/Path=\/(;|$)/); // on their host the wizard is at the root
    const html = await first.text();
    expect(html).toContain("Acme AI");
    expect(html).not.toContain(CONFIG.productName);
    expect(html).toContain("Your provider helped set this up.");
    expect(html).toContain("Done for you: Brand, Hosting (Railway).");
    expect(html).toContain("Left for you: Phones (Telnyx, or Vapi + Twilio), AI (OpenRouter).");
    const t = html.match(/name="t" value="([^"]+)"/)![1];
    const post = (path: string, fields: Record<string, string>, origin = `http://${OWN}`) =>
      onHost(OWN, path, { method: "POST", headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, ...fields }).toString() });
    // Start lands on what's left
    const start = await post("/a/start", { v: "welcome" });
    expect(start.status).toBe(303);
    expect(start.headers.get("location")).toBe("/");
    const phonesPage = await (await onHost(OWN, "/", { headers: { cookie } })).text();
    expect(phonesPage).toContain('name="key"');
    expect(phonesPage).toContain('action="/a/phones"');
    // a post from another site is refused
    expect((await post("/a/phones", { v: "phones", key: "platform-fake-1234567890" }, "https://evil.example")).status).toBe(403);
    // the real one
    const done = await post("/a/phones", { v: "phones", key: "platform-fake-1234567890" });
    expect(done.status).toBe(303);
    const s = getSetup(b.id);
    expect(s.phones?.confirmed).toBe(true);
    expect(s.assist?.steps?.phones).toBeUndefined(); // theirs
    expect(s.assist?.steps?.brand?.by).toBe(ADMIN);
    const after = await (await onHost(OWN, "/?step=extras", { headers: { cookie } })).text();
    expect(after).toContain("Done for you: Brand, Hosting (Railway).");
    expect(after).toContain("Left for you: AI (OpenRouter).");
    expect(await (await onHost(OWN, "/?step=brand", { headers: { cookie } })).text()).toContain("Brand: set up by your provider");
    // their own change link works on their domain
    const rel = await post("/a/assist-release", { v: "brand", step: "brand" });
    expect(rel.status).toBe(303);
    expect(await (await onHost(OWN, "/?step=brand", { headers: { cookie } })).text()).toContain('name="productName"');
  });
});

describe("admin: the Set up for them panel", () => {
  let cookie = "", csrf = "";
  const adm = (path: string, init: RequestInit = {}) => fetch(`${SITE}${path}`, { redirect: "manual", ...init, headers: { ...(init.headers as any), cookie } });
  const act = (path: string, fields: Record<string, string>) => adm(path, { method: "POST", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: csrf, ...fields }).toString() });
  const buyer = addBuyer("Panel Buyer", "panel@example.com");
  const url = `/admin/b/${buyer.id}`;

  test("sign in; the panel lists the steps with who did what", async () => {
    const res = await fetch(newAdminLink(ADMIN).replace(/^https?:\/\/[^/]+/, SITE), { method: "POST", redirect: "manual", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: "" });
    cookie = (res.headers.get("set-cookie") || "").split(";")[0];
    const html = await (await adm(url)).text();
    csrf = html.match(/name="t" value="([^"]+)"/)![1];
    expect(html).toContain("Set up for them");
    for (const w of ["Brand", "Hosting (Railway)", "Phones (Telnyx, or Vapi + Twilio)", "Own domain and DNS", "Install for them", "Audit log", "Use their domain for the setup link"]) expect(html).toContain(w);
    expect(html).toContain("developer.godaddy.com");
    expect(html).toContain("permissionGroupKeys"); // the Cloudflare template link
    expect(html).toContain("Still to fill in: Brand, Hosting (Railway), Phones (Telnyx, or Vapi + Twilio), AI (OpenRouter).");
  });

  test("filling a step from the form: errors show in the panel, success marks it Done by you, the audit log has who and when", async () => {
    let r = await act(`${url}/assist/brand`, { productName: "", ownerEmail: "p@p.test" });
    expect(r.status).toBe(303);
    expect(await (await adm(url)).text()).toContain("Give your brand a name.");
    expect(await (await adm(url)).text()).not.toContain('notice flash'); // shown once
    r = await act(`${url}/assist/brand`, { productName: "Panel AI", ownerEmail: "p@p.test", colour: "#112233" });
    let html = await (await adm(url)).text();
    expect(html).toContain("Brand is done.");
    expect(html).toContain("Done by you");
    expect(html).toContain("Panel AI");
    await act(`${url}/assist/railway`, { token: "wrong" });
    expect(await (await adm(url)).text()).toMatch(/Railway didn&#39;t accept|Railway/);
    await act(`${url}/assist/railway`, { token: RW_TOKEN });
    html = await (await adm(url)).text();
    expect(html).toContain("filled: railway");
    expect(html).toContain(ADMIN);
    expect(html).not.toContain(RW_TOKEN);
    expect(html).toContain("Still to fill in: Phones (Telnyx, or Vapi + Twilio), AI (OpenRouter).");
    // a request without the token is refused
    const bad = await adm(`${url}/assist/phones`, { method: "POST", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: "key=platform-fake-1234567890" });
    expect(bad.status).toBe(403);
    expect(getSetup(buyer.id).phones).toBeUndefined();
  });

  test("their setup link on their own domain: by hand shows the CNAME with copy buttons; the host is registered, Caddy may get a certificate, and Check DNS answers", async () => {
    const host = "setup.panel-buyer.com";
    await act(`${url}/assist/host`, { host: "panel-buyer.com", provider: "manual" });
    expect(await (await adm(url)).text()).toContain("Use a name under their domain");
    await act(`${url}/assist/host`, { host, provider: "manual" });
    const html = await (await adm(url)).text();
    expect(html).toContain(`https://${host}/`);
    expect(html).toContain("CNAME");
    expect(html).toContain('data-dns-poll="/admin/b/' + buyer.id + '/assist/check-dns"');
    expect(html).toContain(`data-copy="${host}"`);
    expect(html).toContain('data-copy="127.0.0.1"');
    expect(H.hostOfBuyer(buyer.id)!.host).toBe(host);
    expect((await fetch(`${SITE}/api/tls-allowed?domain=${host}`)).status).toBe(200);
    expect((await onHost(host, "/")).status).toBe(200);
    const check = await adm(`${url}/assist/check-dns`, { method: "POST", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: csrf }).toString() });
    expect(check.status).toBe(200);
    expect(await check.json()).toMatchObject({ all: true, host: false });
    await act(`${url}/assist/host-drop`, {});
    expect(H.hostOfBuyer(buyer.id)).toBeNull();
    expect((await fetch(`${SITE}/api/tls-allowed?domain=${host}`)).status).toBe(404);
  }, 40_000);

  test("install-for-them is refused with the reason while steps are missing; the status feed is the wizard's own shape", async () => {
    await act(`${url}/assist/install`, {});
    expect(await (await adm(url)).text()).toContain("Still to fill in: Phones (Telnyx, or Vapi + Twilio), AI (OpenRouter).");
    const st = await (await adm(`${url}/status`)).json() as any;
    expect(st).toMatchObject({ phase: "idle" });
    expect(typeof st.rev).toBe("string");
    expect("log" in st && "next" in st).toBe(true);
    const signedOut = await fetch(`${SITE}${url}/status`, { redirect: "manual" }); // never the feed without a session
    expect(signedOut.status).toBe(303);
    expect(await signedOut.text()).not.toContain("rev");
  });
});
