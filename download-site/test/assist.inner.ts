// The checks for assist.test.ts: "Set up for them" against small in-process fakes of Railway, Cloudflare and GoDaddy.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "assist-test-"));
const ADMIN = "boss@example.com";
const RW_TOKEN = "railway-test-token-good-0001";
const PROJECT = "prj-1", ENV = "env-1", APP = "svc-app", PG = "svc-pg";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// ---- the agency's own app ----
const app = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (r) => (new URL(r.url).pathname === "/api/health" ? Response.json({ ok: true }) : new Response("no", { status: 404 })) });

// ---- fake Railway ----
let customDomain = "";
let upload = 0;
const rail = Bun.serve({
  port: 0, hostname: "127.0.0.1", maxRequestBodySize: 50 * 1024 * 1024,
  async fetch(req) {
    const u = new URL(req.url);
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    const gql = (data: any) => Response.json({ data });
    const up = u.pathname.match(/^\/project\/([^/]+)\/environment\/([^/]+)\/up$/);
    if (up) { await req.arrayBuffer(); upload++; return Response.json({ deploymentId: `dep-${upload}` }); }
    if (tok !== RW_TOKEN) return Response.json({ data: null, errors: [{ message: "Not Authorized" }] });
    const { query = "", variables = {} } = (await req.json()) as any;
    const has = (f: string) => new RegExp(`\\b${f}\\s*[({]`).test(query);
    if (has("projectCreate")) return gql({ projectCreate: { id: PROJECT, environments: { edges: [{ node: { id: ENV, name: "production" } }] } } });
    if (has("serviceCreate")) return gql({ serviceCreate: { id: variables.input.name === "Postgres" ? PG : APP } });
    if (has("volumeCreate")) return gql({ volumeCreate: { id: "vol" } });
    if (has("serviceDomainCreate")) return gql({ serviceDomainCreate: { id: "sd", domain: `localhost:${app.port}` } });
    if (has("customDomainCreate")) {
      customDomain = variables.input.domain;
      return gql({ customDomainCreate: { id: "cd-1", domain: customDomain, status: { verified: false, certificateStatus: "CERTIFICATE_STATUS_TYPE_VALIDATING", verificationDnsHost: `_railway-verify.${customDomain.split(".")[0]}`, verificationToken: "railway-verify=abc123", dnsRecords: [{ recordType: "DNS_RECORD_TYPE_CNAME", hostlabel: customDomain.split(".")[0], fqdn: customDomain, zone: customDomain.split(".").slice(1).join("."), requiredValue: "x1y2.up.railway.app", currentValue: "", status: "DNS_RECORD_STATUS_REQUIRES_UPDATE", purpose: "DNS_RECORD_PURPOSE_TRAFFIC_ROUTE" }] } } });
    }
    if (has("customDomain")) return gql({ customDomain: { id: "cd-1", domain: customDomain, status: { verified: true, certificateStatus: "CERTIFICATE_STATUS_TYPE_VALID", verificationDnsHost: "", verificationToken: "", dnsRecords: [{ recordType: "DNS_RECORD_TYPE_CNAME", hostlabel: customDomain.split(".")[0], fqdn: customDomain, zone: customDomain.split(".").slice(1).join("."), requiredValue: "x1y2.up.railway.app", status: "DNS_RECORD_STATUS_PROPAGATED" }] } } });
    if (has("variableCollectionUpsert") || has("serviceInstanceUpdate")) return gql({ ok: true });
    if (has("me")) return /\bplan\b/.test(query) ? gql({ me: { workspaces: [{ id: "ws-1", plan: "HOBBY", customer: { isTrialing: false, defaultPaymentMethodId: "pm" } }] } }) : gql({ me: { email: "owner@example.com", workspaces: [{ id: "ws-1", name: "Owner" }] } });
    if (has("project")) return gql({ project: { id: PROJECT, environments: { edges: [{ node: { id: ENV, name: "production" } }] } } });
    if (has("deployment")) return gql({ deployment: { id: variables.id, status: "SUCCESS" } });
    if (has("buildLogs")) return gql({ buildLogs: [{ timestamp: "", message: "Build finished" }] });
    return Response.json({ data: null, errors: [{ message: "unsupported " + query.slice(0, 40) }] });
  },
});

// ---- fake Cloudflare ----
const cfCalls: { method: string; path: string; body?: any }[] = [];
let cfRecords: any[] = [];
const cf = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    const path = u.pathname.replace("/client/v4", "");
    const ok = (result: any) => Response.json({ success: true, result });
    if ((req.headers.get("authorization") || "") !== "Bearer cf-good-token-0001") return Response.json({ success: false, errors: [{ code: 1000, message: "Invalid API Token" }] }, { status: 401 });
    const body = req.method === "GET" || req.method === "DELETE" ? undefined : ((await req.json()) as any);
    cfCalls.push({ method: req.method, path: path + u.search, body });
    const zone = { id: "z1", name: "example.com", status: "active", name_servers: ["a.ns.cloudflare.com", "b.ns.cloudflare.com"] };
    if (path === "/user/tokens/verify") return ok({ status: "active" });
    if (path === "/zones") return ok(u.searchParams.get("name") && u.searchParams.get("name") !== "example.com" ? [] : [zone]);
    if (path === "/zones/z1") return ok(zone);
    if (path === "/zones/z1/dns_records" && req.method === "GET") { const n = u.searchParams.get("name.exact"); return ok(cfRecords.filter((r) => r.name === n)); }
    if (path === "/zones/z1/dns_records" && req.method === "POST") { const r = { ...body, id: `r${cfRecords.length + 1}` }; cfRecords.push(r); return ok(r); }
    const m = path.match(/^\/zones\/z1\/dns_records\/(\w+)$/);
    if (m && req.method === "DELETE") { cfRecords = cfRecords.filter((r) => r.id !== m[1]); return ok({ id: m[1] }); }
    if (m && req.method === "PATCH") { const i = cfRecords.findIndex((r) => r.id === m[1]); cfRecords[i] = { ...cfRecords[i], ...body }; return ok(cfRecords[i]); }
    return Response.json({ success: false, errors: [{ message: "unsupported " + path }] }, { status: 404 });
  },
});

// ---- fake GoDaddy ----
const gdCalls: { method: string; path: string; body?: any; auth: string }[] = [];
let gdRecords: any[] = [];
const gd = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    const auth = req.headers.get("authorization") || "";
    if (auth !== "sso-key gd-key-0001:gd-secret-0001") return Response.json({ code: "UNABLE_TO_AUTHENTICATE", message: "Authenticated user is not allowed access" }, { status: 401 });
    const body = req.method === "GET" || req.method === "DELETE" ? undefined : ((await req.json()) as any);
    gdCalls.push({ method: req.method, path: u.pathname, body, auth });
    const m = u.pathname.match(/^\/v1\/domains\/([^/]+)(\/records(?:\/([A-Z]+)\/([^/]+))?)?$/);
    if (!m || m[1] !== "example.com.au") return Response.json({ code: "UNKNOWN_DOMAIN", message: "The given domain is not registered" }, { status: 404 });
    if (!m[2]) return Response.json({ domain: "example.com.au", status: "ACTIVE" });
    if (req.method === "GET") return Response.json(gdRecords);
    if (req.method === "PATCH") { gdRecords.push(...body); return new Response(null, { status: 200 }); }
    if (req.method === "PUT") { gdRecords = gdRecords.filter((r) => !(r.type === m[3] && r.name === m[4])).concat(body.map((r: any) => ({ type: m[3], name: m[4], ...r }))); return new Response(null, { status: 200 }); }
    if (req.method === "DELETE") { gdRecords = gdRecords.filter((r) => !(r.type === m[3] && r.name === m[4])); return new Response(null, { status: 204 }); }
    return new Response("no", { status: 400 });
  },
});

process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
process.env.MOCK_RAILWAY = "1";
process.env.MOCK_FAST = "1"; // test mode: check on every tick instead of every few seconds
process.env.MOCK_TELNYX = "1";
process.env.RAILWAY_API_BASE = `http://127.0.0.1:${rail.port}`;
process.env.CF_API_BASE = `http://127.0.0.1:${cf.port}/client/v4`;
process.env.GODADDY_API_BASE = `http://127.0.0.1:${gd.port}`;
process.env.DNS_SERVERS = "127.0.0.1";
process.env.ADMIN_EMAILS = ADMIN;
for (const k of ["MOCK_CF", "MOCK_RESEND", "MOCK_OAUTH", "SITE_SMTP_URL", "SITE_MAIL_FROM"]) delete process.env[k];
mkdirSync(join(dir, "packages"), { recursive: true });

const { addBuyer, findBuyer, recordPackage, PACKAGES_DIR } = await import("../lib");
const { actions, kick } = await import("../setup");
const store = await import("../store");
const { getSetup, hasSecret, secretHint } = store;
const A = await import("../assist");
const dnsm = await import("../dns");
const { fqdn } = await import("../providers");
const sync = await import("../sync");
const { wizardPage } = await import("../wizard");

afterAll(() => { rail.stop(true); app.stop(true); cf.stop(true); gd.stop(true); });

writeFileSync(join(PACKAGES_DIR, "ai-receptionist-server-1.0.0.tgz"), "x");
writeFileSync(join(PACKAGES_DIR, "ai-receptionist-server-1.0.0.app-src.tgz"), Buffer.alloc(4096, 7));
recordPackage({ version: "1.0.0", file: "ai-receptionist-server-1.0.0.tgz", size: 1, sha256: "0".repeat(64) });

const page = (b: any, view: any) => wizardPage(b, getSetup(b.id), b.code, "sid-test", view);
const log = (b: any) => sync.supportLog(b.id, 100);
async function until(id: number, fn: () => boolean, ms = 40_000) { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) { kick(id); await Bun.sleep(250); } }

describe("admin fills steps, the buyer's wizard sees them", () => {
  const b = addBuyer("Part Buyer", "part@example.com");

  test("validation errors surface in admin, and nothing is marked or stored", async () => {
    expect((await A.fillStep(b, ADMIN, "phones", { key: "platform-fake-1234567890" })).message).toMatch(/Brand first/);
    expect(await A.fillStep(b, ADMIN, "brand", { productName: "", ownerEmail: "o@acme.test" })).toMatchObject({ ok: false, message: "Give your brand a name." });
    expect((await A.fillStep(b, ADMIN, "brand", { productName: "Acme", ownerEmail: "not an email" })).ok).toBe(false);
    expect(getSetup(b.id).brand).toBeUndefined();
    await A.fillStep(b, ADMIN, "brand", { productName: "Acme AI", ownerEmail: "o@acme.test", logo: PNG, colour: "#AA2244" });
    const bad = await A.fillStep(b, ADMIN, "railway", { token: "wrong-token-for-railway" });
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/Railway/);
    expect(hasSecret(b.id, "railway_token")).toBe(false);
    expect(getSetup(b.id).assist?.steps?.railway).toBeUndefined();
    const badT = await A.fillStep(b, ADMIN, "phones", { key: "KEYnot-a-fake-key" });
    expect(badT.ok).toBe(false);
    expect(badT.message).toMatch(/Telnyx/);
    expect(hasSecret(b.id, "telnyx_key")).toBe(false);
  });

  test("brand and Railway done by the admin: stored the buyer's way, marked, step pointer left at welcome", async () => {
    expect((await A.fillStep(b, ADMIN, "railway", { token: RW_TOKEN })).ok).toBe(true);
    const s = getSetup(b.id);
    expect(s.brand).toMatchObject({ productName: "Acme AI", ownerEmail: "o@acme.test", colour: "#aa2244", logo: PNG });
    expect(s.railway?.confirmed).toBe(true);
    expect(s.assist?.steps?.brand?.by).toBe(ADMIN);
    expect(s.assist?.steps?.railway?.by).toBe(ADMIN);
    expect(hasSecret(b.id, "railway_token")).toBe(true);
    expect(secretHint(b.id, "railway_token")).toMatch(/^••••0001$/);
    expect(JSON.stringify(s)).not.toContain(RW_TOKEN);
    expect(s.step).toBe("welcome");
    const rows = A.stepRows(b, s);
    expect(rows.find((r) => r.id === "brand")).toMatchObject({ done: true, by: "you" });
    expect(rows.find((r) => r.id === "phones")).toMatchObject({ done: false, by: null });
    expect(rows.find((r) => r.id === "phones")!.optional).toBe(false);
  });

  test("the buyer's wizard shows them done by their provider, with a change link, and says what's left", async () => {
    const brand = page(b, "brand");
    expect(brand).toContain("Brand: set up by your provider");
    expect(brand).toContain("Acme AI");
    expect(brand).toContain('/a/assist-release"');
    expect(brand).not.toContain('name="productName"');
    expect(page(b, "railway")).toContain("set up by your provider");
    const welcome = page(b, "welcome");
    expect(welcome).toContain("Your provider helped set this up.");
    expect(welcome).toContain("Done for you: Brand, Hosting (Railway).");
    expect(welcome).toContain("Left for you: Phones (Telnyx, or Vapi + Twilio), AI (OpenRouter).");
    expect(welcome).not.toContain('<span class="s">'); // the step list has no descriptions under the names
    expect(page(b, "phones")).toContain("Choose who carries your calls"); // theirs: the normal Voice screen
    expect(page(b, "phones")).not.toContain("set up by your provider");
  });

  test("pressing Start lands on what's left; changing a step shows its form; saving it makes it theirs", async () => {
    expect(await actions.start(b, {})).toBeNull();
    expect(getSetup(b.id).step).toBe("phones");
    expect(await actions["assist-release"](b, { step: "brand" })).toBeNull();
    expect(page(b, "brand")).toContain('name="productName"');
    expect(getSetup(b.id).assist?.steps?.brand).toBeDefined(); // still ours until they save
    expect(await actions.brand(b, { productName: "Acme AI Pty", ownerEmail: "o@acme.test" })).toBeNull();
    const s = getSetup(b.id);
    expect(s.assist?.steps?.brand).toBeUndefined();
    expect(A.stepRows(b, s).find((r) => r.id === "brand")).toMatchObject({ done: true, by: "buyer" });
    expect(s.brand?.productName).toBe("Acme AI Pty");
    expect(s.brand?.logo).toBe(PNG); // kept
    // their own Telnyx: theirs from the start
    expect(await actions.phones(b, { key: "platform-fake-buyer-own-key" })).toBeNull();
    expect(A.stepRows(b, getSetup(b.id)).find((r) => r.id === "phones")).toMatchObject({ done: true, by: "buyer" });
    expect(page(b, "done")).not.toContain("<script>");
  });

  test("an install that has started closes the admin's forms; a reset buyer can't be filled either", async () => {
    const c = addBuyer("Locked Buyer", "locked@example.com");
    store.updateSetup(c.id, (s) => { s.phase = "creating"; });
    expect((await A.fillStep(c, ADMIN, "brand", { productName: "X", ownerEmail: "x@x.test" })).message).toMatch(/started/);
    store.updateSetup(c.id, (s) => { s.phase = "idle"; });
    db_revoke(c.id);
    expect((await A.fillStep(findBuyer(c.code)!, ADMIN, "brand", { productName: "X", ownerEmail: "x@x.test" })).message).toMatch(/turned off/);
  });
});
function db_revoke(id: number) { const { db, now } = require("../lib"); db().query("UPDATE buyers SET revoked_at = ? WHERE id = ?").run(now(), id); }

describe("DNS writers", () => {
  const rec = (type: any, name: string, value: string, extra: any = {}) => ({ key: "k", purpose: "p", type, name, value, ttl: "Auto" as const, ...extra });

  test("Cloudflare: subdomain CNAME and TXT, DNS only, no duplicate on the second run", async () => {
    cfCalls.length = 0; cfRecords = [];
    const w = dnsm.cloudflareWriter("cf-good-token-0001", "z1");
    const id = await w.ensure(rec("CNAME", "app.example.com", "x1y2.up.railway.app"));
    await w.ensure(rec("TXT", "_railway-verify.app.example.com", "railway-verify=abc123"));
    const posts = cfCalls.filter((c) => c.method === "POST");
    expect(posts[0].body).toMatchObject({ type: "CNAME", name: "app.example.com", content: "x1y2.up.railway.app", ttl: 1, proxied: false });
    expect(posts[1].body).toMatchObject({ type: "TXT", name: "_railway-verify.app.example.com", content: '"railway-verify=abc123"' });
    expect(id).toBeTruthy();
    const before = cfCalls.filter((c) => c.method === "POST").length;
    await w.ensure(rec("CNAME", "app.example.com", "x1y2.up.railway.app"));
    expect(cfCalls.filter((c) => c.method === "POST").length).toBe(before);
    // apex A record name stays the bare domain
    await w.ensure(rec("A", "example.com", "203.0.113.9"));
    expect(cfCalls.filter((c) => c.method === "POST").at(-1)!.body).toMatchObject({ type: "A", name: "example.com", content: "203.0.113.9" });
  });

  test("GoDaddy: the key is checked first (GET /v1/domains/{domain}), parents are tried, errors are plain", async () => {
    gdCalls.length = 0;
    expect(await dnsm.checkGoDaddy("gd-key-0001", "gd-secret-0001", "example.com.au")).toMatchObject({ ok: true, zone: "example.com.au" });
    expect(gdCalls[0]).toMatchObject({ method: "GET", path: "/v1/domains/example.com.au", auth: "sso-key gd-key-0001:gd-secret-0001" });
    expect(await dnsm.checkGoDaddy("gd-key-0001", "gd-secret-0001", "setup.example.com.au")).toMatchObject({ ok: true, zone: "example.com.au" });
    expect(gdCalls.map((c) => c.path)).toContain("/v1/domains/setup.example.com.au"); // tried the full name first
    expect((await dnsm.checkGoDaddy("gd-key-0001", "wrong", "example.com.au")).message).toMatch(/didn't accept that key and secret/);
    expect((await dnsm.checkGoDaddy("gd-key-0001", "gd-secret-0001", "other.com")).message).toMatch(/isn't in this GoDaddy account/);
    expect((await dnsm.checkGoDaddy("", "", "example.com.au")).ok).toBe(false);
  });

  test("GoDaddy: PATCH /v1/domains/{domain}/records with names relative to the domain (apex @, subdomain, Resend's fqdn() names)", async () => {
    gdCalls.length = 0; gdRecords = [];
    const w = dnsm.godaddyWriter("gd-key-0001", "gd-secret-0001", "example.com.au");
    await w.ensure(rec("CNAME", "app.example.com.au", "x1y2.up.railway.app"));
    await w.ensure(rec("TXT", "_railway-verify.app.example.com.au", "railway-verify=abc123"));
    await w.ensure(rec("A", "example.com.au", "203.0.113.9"));
    // Resend gives names relative to the root; fqdn() makes them full, then GoDaddy wants them relative to the domain again.
    await w.ensure(rec("TXT", fqdn("resend._domainkey", "example.com.au", "example.com.au"), "p=MIGfMA0"));
    await w.ensure(rec("MX", fqdn("send", "example.com.au", "example.com.au"), "feedback-smtp.ap-northeast-1.amazonses.com", { priority: 10 }));
    const patches = gdCalls.filter((c) => c.method === "PATCH");
    expect(patches.map((p) => p.path)).toEqual(Array(5).fill("/v1/domains/example.com.au/records"));
    expect(patches.map((p) => p.body[0])).toEqual([
      { type: "CNAME", name: "app", data: "x1y2.up.railway.app", ttl: 600 },
      { type: "TXT", name: "_railway-verify.app", data: "railway-verify=abc123", ttl: 600 },
      { type: "A", name: "@", data: "203.0.113.9", ttl: 600 },
      { type: "TXT", name: "resend._domainkey", data: "p=MIGfMA0", ttl: 600 },
      { type: "MX", name: "send", data: "feedback-smtp.ap-northeast-1.amazonses.com", ttl: 600, priority: 10 },
    ]);
    // a subdomain zone-style sending domain
    expect(dnsm.gdName(fqdn("resend._domainkey.mail.t1", "mail.t1.chloeeai.co", "chloeeai.co"), "chloeeai.co")).toBe("resend._domainkey.mail.t1");
    expect(() => dnsm.gdName("app.other.com", "example.com.au")).toThrow(/isn't part of/);
    // again: nothing new is sent
    gdCalls.length = 0;
    await w.ensure(rec("CNAME", "app.example.com.au", "x1y2.up.railway.app"));
    expect(gdCalls.filter((c) => c.method === "PATCH").length).toBe(0);
  });

  test("GoDaddy: a record already pointing elsewhere is refused unless the admin says replace", async () => {
    gdCalls.length = 0;
    gdRecords = [{ type: "CNAME", name: "app", data: "old.example.net", ttl: 600 }];
    const keep = dnsm.godaddyWriter("gd-key-0001", "gd-secret-0001", "example.com.au");
    await expect(keep.ensure(rec("CNAME", "app.example.com.au", "x1y2.up.railway.app"))).rejects.toThrow(/already points somewhere else/);
    expect(gdCalls.some((c) => c.method !== "GET")).toBe(false);
    const swap = dnsm.godaddyWriter("gd-key-0001", "gd-secret-0001", "example.com.au", { replace: true });
    await swap.ensure(rec("CNAME", "app.example.com.au", "x1y2.up.railway.app"));
    expect(gdCalls.find((c) => c.method === "PUT")).toMatchObject({ path: "/v1/domains/example.com.au/records/CNAME/app", body: [{ data: "x1y2.up.railway.app", ttl: 600 }] });
    expect(gdRecords.filter((r) => r.name === "app")).toHaveLength(1);
  });
});

describe("domain + DNS for them", () => {
  test("Cloudflare: token check lists their domains; the Domain step is the wizard's own; a bad token is an error", async () => {
    const b = addBuyer("CF Buyer", "cf@example.com");
    cfRecords = [];
    expect((await A.cloudflareCheck(b, ADMIN, "cf-bad")).ok).toBe(false);
    expect(hasSecret(b.id, "cf_token")).toBe(false);
    expect(await A.cloudflareCheck(b, ADMIN, "cf-good-token-0001")).toMatchObject({ ok: true });
    expect(getSetup(b.id).assist?.cfZones).toEqual(["example.com"]);
    const bad = await A.setDomain(b, ADMIN, { provider: "cloudflare", domain: "notmine.org", token: "cf-good-token-0001" });
    expect(bad.message).toMatch(/can't see notmine.org/);
    const ok = await A.setDomain(b, ADMIN, { provider: "cloudflare", domain: "example.com", keep: true });
    expect(ok.ok).toBe(true);
    const s = getSetup(b.id);
    expect(s.domain).toMatchObject({ mode: "cloudflare", zone: "example.com", host: "app.example.com", confirmed: true });
    expect(s.assist).toMatchObject({ dnsBy: "cloudflare", keepDns: true });
    expect(s.assist?.steps?.domain?.by).toBe(ADMIN);
    expect(page(b, "domain")).toContain("Domain: set up by your provider");
    expect(page(b, "domain")).toContain("app.example.com");
  });

  test("GoDaddy: key + secret validated, the Domain step done, keys sealed; the buyer sees it done", async () => {
    const b = addBuyer("GD Buyer", "gd@example.com");
    const bad = await A.setDomain(b, ADMIN, { provider: "godaddy", domain: "example.com.au", gdKey: "gd-key-0001", gdSecret: "nope" });
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/GoDaddy/);
    expect(hasSecret(b.id, "godaddy_key")).toBe(false);
    gdRecords = [{ type: "CNAME", name: "app", data: "old.example.net", ttl: 600 }];
    const clash = await A.setDomain(b, ADMIN, { provider: "godaddy", domain: "example.com.au", gdKey: "gd-key-0001", gdSecret: "gd-secret-0001" });
    expect(clash.message).toMatch(/already points somewhere else/);
    gdRecords = [];
    const ok = await A.setDomain(b, ADMIN, { provider: "godaddy", domain: "example.com.au", gdKey: "gd-key-0001", gdSecret: "gd-secret-0001" });
    expect(ok.ok).toBe(true);
    const s = getSetup(b.id);
    expect(s.domain).toMatchObject({ mode: "godaddy", zone: "example.com.au", host: "app.example.com.au", confirmed: true });
    expect(s.assist?.dnsBy).toBe("godaddy");
    expect(hasSecret(b.id, "godaddy_key") && hasSecret(b.id, "godaddy_secret")).toBe(true);
    expect(JSON.stringify(s)).not.toContain("gd-secret-0001");
    expect(A.detailOf(b, s, "domain")).toContain("GoDaddy");
    // "change": clears the domain and the GoDaddy login so they choose again
    await actions["assist-release"](b, { step: "domain" });
    expect(getSetup(b.id).domain).toBeUndefined();
    expect(hasSecret(b.id, "godaddy_key")).toBe(false);
  });

  test("by hand: the records are listed, nothing is stored, and a buyer's own DNS login would go too", async () => {
    const b = addBuyer("Hand Buyer", "hand@example.com");
    const out = await A.setDomain(b, ADMIN, { provider: "manual", domain: "handmade.example.org" });
    expect(out.ok).toBe(true);
    const s = getSetup(b.id);
    expect(s.domain).toMatchObject({ mode: "manual", host: "app.handmade.example.org", confirmed: true });
    expect(s.assist?.keepDns).toBe(false);
    for (const n of ["cf_token", "godaddy_key", "godaddy_secret"] as const) expect(hasSecret(b.id, n)).toBe(false);
  });
});

describe("install for them", () => {
  async function ready(name: string, domain?: { provider: "cloudflare" | "godaddy"; keep?: boolean }) {
    const b = addBuyer(name, `${name.replace(/\W/g, "").toLowerCase()}@example.com`);
    await A.fillStep(b, ADMIN, "brand", { productName: `${name} AI`, ownerEmail: "owner@acme.test", logo: PNG });
    await A.fillStep(b, ADMIN, "railway", { token: RW_TOKEN });
    await A.fillStep(b, ADMIN, "phones", { key: "platform-fake-12345678" });
    await A.fillStep(b, ADMIN, "ai", { key: "platform-fake-or-12345678" });
    if (domain?.provider === "godaddy") await A.setDomain(b, ADMIN, { provider: "godaddy", domain: "example.com.au", gdKey: "gd-key-0001", gdSecret: "gd-secret-0001", keep: domain.keep });
    if (domain?.provider === "cloudflare") await A.setDomain(b, ADMIN, { provider: "cloudflare", domain: "example.com", token: "cf-good-token-0001", keep: domain.keep });
    return b;
  }

  test("refused until the required steps are filled, and says which", async () => {
    const b = addBuyer("Early Buyer", "early@example.com");
    expect((await A.installFor(b, ADMIN)).message).toMatch(/Still to fill in: Brand, Hosting \(Railway\), Phones \(Telnyx, or Vapi \+ Twilio\), AI \(OpenRouter\)/);
    await A.fillStep(b, ADMIN, "brand", { productName: "Early", ownerEmail: "e@e.test" });
    expect((await A.installFor(b, ADMIN)).message).toMatch(/Still to fill in: Hosting \(Railway\), Phones \(Telnyx, or Vapi \+ Twilio\), AI \(OpenRouter\)/);
    expect(getSetup(b.id).phase).toBe("idle");
  });

  test("happy path with their own domain on GoDaddy: same engine, app records written, every key deleted, extras finished, who installed recorded", async () => {
    gdRecords = []; gdCalls.length = 0;
    const b = await ready("Gdinstall", { provider: "godaddy" });
    expect(A.canInstall(b, getSetup(b.id))).toEqual({ ok: true });
    const out = await A.installFor(b, ADMIN);
    expect(out.ok).toBe(true);
    expect(getSetup(b.id).phase).toBe("creating");
    await until(b.id, () => getSetup(b.id).phase === "done" || getSetup(b.id).phase.endsWith("failed"), 60_000);
    const s = getSetup(b.id);
    expect(s.error).toBeUndefined();
    expect(s.phase).toBe("done");
    expect(s.resultUrl).toBe("https://app.example.com.au");
    expect(s.assist?.installBy?.by).toBe(ADMIN);
    expect(s.assist?.steps?.brand?.by).toBe(ADMIN); // survives the install
    // the app's own records went to GoDaddy: CNAME for the address, relative names
    expect(gdRecords.some((r) => r.type === "CNAME" && r.name === "app" && r.data === "x1y2.up.railway.app")).toBe(true);
    // every key deleted when the install finished (GoDaddy's included: nobody ticked keep)
    for (const n of store.ALL_SECRETS) expect(hasSecret(b.id, n)).toBe(false);
    const whole = JSON.stringify(s) + store.logRead(b.id).text;
    for (const secret of [RW_TOKEN, "gd-secret-0001", "gd-key-0001", "platform-fake-12345678"]) expect(whole).not.toContain(secret);
    // the buyer's own page: still says their provider helped, and "Delete your GoDaddy API key"
    const done = page(b, "done");
    expect(done).toContain("Your provider helped set this up.");
    expect(done).toContain("Delete your GoDaddy API key");
    // audit: who did what, when, never a key
    const entries = log(b);
    const actionsSeen = entries.map((e) => e.action);
    for (const a of ["filled: brand", "filled: railway", "filled: phones", "filled: ai", "filled: domain", "install started"]) expect(actionsSeen).toContain(a);
    expect(entries.every((e) => e.admin_email === ADMIN && !!e.at)).toBe(true);
    expect(JSON.stringify(entries)).not.toMatch(/gd-secret-0001|platform-fake|railway-test-token/);
  }, 90_000);

  test("Send owner their login: a reset link when the owner exists, the first-account page when not; email only when our site can send", async () => {
    const b = addBuyer("Login Buyer", "login@example.com");
    store.saveSetup(b.id, { step: "done", phase: "done", brand: { productName: "Login AI", ownerEmail: "owner@login.test", ownPhoneAccount: false }, phones: { confirmed: true }, railway: { confirmed: true }, resultUrl: "https://app.login.test", progress: [], extrasDone: true });
    sync.newSyncToken(b.id);
    const seen: string[] = [];
    const reply = (status: number, body: any) => (async (u: any, init: any) => { seen.push(String(u) + " " + init?.headers?.authorization?.slice(0, 10)); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
    const reset = await A.ownerLogin(b, ADMIN, false, reply(200, { ok: true, url: `https://app.login.test/reset/${"R".repeat(43)}`, expiresInMinutes: 15 }));
    expect(reset).toMatchObject({ ok: true, kind: "reset", minutes: 15, to: "owner@login.test", mailed: false });
    expect(seen[0]).toContain("https://app.login.test/api/support/owner-reset-link Bearer sc_");
    const first = await A.ownerLogin(b, ADMIN, true, reply(404, { ok: false, error: "not_supported", message: "There's no agency owner to reset yet." }));
    expect(first).toMatchObject({ ok: true, kind: "first", url: "https://app.login.test/", mailed: false });
    expect((first as any).mailError).toMatch(/Email isn.t set up on the setup site/);
    const down = await A.ownerLogin(b, ADMIN, false, (async () => { throw new Error("down"); }) as any);
    expect(down.ok).toBe(false);
    const entries = log(b).map((e) => `${e.action} ${e.note}`).join("\n");
    expect(entries).toContain("owner login: reset link made");
    expect(entries).toContain("owner login: first-account link");
    expect(entries).not.toContain("/reset/R");
    expect((await A.ownerLogin(addBuyer("Not Done", "nd@example.com"), ADMIN, false)).ok).toBe(false);
  });

  test("keep for later changes: the Cloudflare login survives the install (and only it); Delete it now removes it", async () => {
    cfRecords = []; cfCalls.length = 0;
    const b = await ready("Cfkeep", { provider: "cloudflare", keep: true });
    expect((await A.installFor(b, ADMIN)).ok).toBe(true);
    await until(b.id, () => getSetup(b.id).phase === "done" || getSetup(b.id).phase.endsWith("failed"), 60_000);
    const s = getSetup(b.id);
    expect(s.phase).toBe("done");
    expect(cfRecords.some((r) => r.type === "CNAME" && r.name === "app.example.com" && r.content === "x1y2.up.railway.app")).toBe(true);
    for (const n of store.ALL_SECRETS) expect(hasSecret(b.id, n)).toBe(n === "cf_token");
    expect(s.assist?.keepDns).toBe(true);
    expect(page(b, "done")).toContain("kept the Cloudflare access");
    expect(A.dropDnsCreds(b, ADMIN).message).toMatch(/deleted/);
    expect(hasSecret(b.id, "cf_token")).toBe(false);
    expect(getSetup(b.id).assist?.keepDns).toBe(false);
    expect(log(b).map((e) => e.action)).toContain("deleted DNS login");
    // a reset wipes even a kept login
    const c = await ready("Cfkeep2", { provider: "cloudflare", keep: true });
    store.resetSetup(c.id);
    expect(hasSecret(c.id, "cf_token")).toBe(false);
  }, 90_000);

  test("Check DNS: records are looked up and saved, and an unreachable resolver means 'waiting', not an error", async () => {
    const b = addBuyer("Dns Buyer", "dns@example.com");
    store.saveSetup(b.id, { step: "welcome", phase: "idle", domain: { mode: "manual", zone: "nowhere.invalid", sub: "app", host: "app.nowhere.invalid", confirmed: true },
      email: { mode: "resend", confirmed: true, resend: { status: "pending", records: [{ key: "dkim", purpose: "x", type: "TXT", name: "resend._domainkey.nowhere.invalid", value: "p=abc", ttl: "Auto" }], dmarc: null } } });
    expect(A.dnsRows(getSetup(b.id))).toHaveLength(1);
    const r = await A.checkDns(b);
    expect(r.all).toBe(false);
    expect(r.rows[0]).toMatchObject({ ok: false });
    expect(getSetup(b.id).email!.resend!.records![0].ok).toBe(false);
  }, 40_000);
});

describe("OpenRouter is the AI step", () => {
  test("the key is checked, sealed and goes in as OPENROUTER_API_KEY and finishes the AI step", async () => {
    const seen: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: any, init: any) => {
      if (!String(u).startsWith("https://openrouter.ai")) return real(u, init);
      seen.push(`${u} ${init?.headers?.Authorization}`);
      return new Response("{}", { status: (init?.headers?.Authorization || "").endsWith("good-or-key-0001") ? 200 : 401 });
    }) as any;
    try {
      const b = addBuyer("Or Buyer", "or@example.com");
      expect((await A.setOpenRouter(b, ADMIN, "bad-or-key-0001")).message).toMatch(/didn't accept/);
      expect(hasSecret(b.id, "openrouter_key")).toBe(false);
      expect((await A.setOpenRouter(b, ADMIN, "good-or-key-0001")).ok).toBe(true);
      expect(hasSecret(b.id, "openrouter_key")).toBe(true);
      expect(seen[0]).toContain("https://openrouter.ai/api/v1/auth/key Bearer bad-or-key-0001");
      expect(log(b).map((e) => e.action)).toContain("filled: openrouter");
      expect(JSON.stringify(log(b))).not.toContain("good-or-key");
      await A.fillStep(b, ADMIN, "brand", { productName: "Or", ownerEmail: "o@o.test" });
      await A.fillStep(b, ADMIN, "railway", { token: RW_TOKEN });
      await A.fillStep(b, ADMIN, "phones", { key: "platform-fake-12345678" });
      // The OpenRouter key counts as the AI step being done.
      expect(getSetup(b.id).ai?.confirmed).toBe(true);
      expect(A.stepRows(b, getSetup(b.id)).find((r) => r.id === "ai")?.done).toBe(true);
    } finally { globalThis.fetch = real; }
  });
});
