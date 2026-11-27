// The checks for dnsdelete.test.ts:
// "Delete the project" takes back the DNS records the install wrote (GoDaddy or Cloudflare),
// and never one that was already there.
// Small in-process fakes only: nothing real is called.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "dnsdelete-test-"));
const GD_AUTH = "sso-key gd-key-0001:gd-secret-0001";

// ---- fake GoDaddy (example.com.au) ----
type GdRec = { type: string; name: string; data: string; ttl: number; priority?: number };
let gdRecords: GdRec[] = [];
const gdCalls: { method: string; path: string; body?: any }[] = [];
const gd = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    if (req.headers.get("authorization") !== GD_AUTH) return Response.json({ code: "UNABLE_TO_AUTHENTICATE" }, { status: 401 });
    const body = req.method === "PATCH" || req.method === "PUT" ? ((await req.json()) as any) : undefined;
    gdCalls.push({ method: req.method, path: u.pathname, body });
    const m = u.pathname.match(/^\/v1\/domains\/([^/]+)(\/records(?:\/([A-Z]+)(?:\/([^/]+))?)?)?$/);
    if (!m || m[1] !== "example.com.au") return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    if (!m[2]) return Response.json({ domain: "example.com.au", status: "ACTIVE" });
    const at = (r: GdRec) => (!m[3] || r.type === m[3]) && (!m[4] || r.name === decodeURIComponent(m[4]));
    if (req.method === "GET") return Response.json(gdRecords.filter(at));
    if (req.method === "PATCH") { gdRecords.push(...body); return new Response(null, { status: 200 }); }
    if (req.method === "PUT") { gdRecords = gdRecords.filter((r) => !at(r)).concat(body.map((r: any) => ({ type: m[3], name: decodeURIComponent(m[4]), ...r }))); return new Response(null, { status: 200 }); }
    if (req.method === "DELETE") { gdRecords = gdRecords.filter((r) => !at(r)); return new Response(null, { status: 204 }); }
    return new Response("no", { status: 400 });
  },
});

// ---- fake Cloudflare (zone z1) ----
let cfRecords: any[] = [];
const cfCalls: { method: string; path: string }[] = [];
const cf = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    const path = u.pathname.replace("/client/v4", "");
    cfCalls.push({ method: req.method, path });
    const ok = (result: any) => Response.json({ success: true, result });
    if (path === "/zones/z1/dns_records" && req.method === "GET") return ok(cfRecords.filter((r) => r.name === u.searchParams.get("name.exact") || r.name === u.searchParams.get("name")));
    if (path === "/zones/z1/dns_records" && req.method === "POST") { const r = { ...((await req.json()) as any), id: `r${cfRecords.length + 1}` }; cfRecords.push(r); return ok(r); }
    const m = path.match(/^\/zones\/z1\/dns_records\/(\w+)$/);
    if (m && req.method === "DELETE") { const had = cfRecords.some((r) => r.id === m[1]); cfRecords = cfRecords.filter((r) => r.id !== m[1]); return had ? ok({ id: m[1] }) : Response.json({ success: false }, { status: 404 }); }
    return Response.json({ success: false, errors: [{ message: "unsupported " + path }] }, { status: 404 });
  },
});

// ---- fake Railway (projectDelete) ----
const deleted: string[] = [];
const rail = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) { const { query } = (await req.json()) as any; if (/projectDelete/.test(query)) { deleted.push("project"); return Response.json({ data: { projectDelete: true } }); } return Response.json({ data: null, errors: [{ message: "unsupported" }] }); } });

process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
process.env.MOCK_RAILWAY = "1";
process.env.MOCK_FAST = "1"; // test mode: check on every tick
process.env.MOCK_TELNYX = "1";
process.env.RAILWAY_API_BASE = `http://127.0.0.1:${rail.port}`;
process.env.CF_API_BASE = `http://127.0.0.1:${cf.port}/client/v4`;
process.env.GODADDY_API_BASE = `http://127.0.0.1:${gd.port}`;
process.env.DNS_SERVERS = "127.0.0.1:9"; // nothing answers: "not live yet", never the real resolvers
for (const k of ["MOCK_CF", "MOCK_RESEND", "MOCK_OAUTH", "SITE_SMTP_URL", "SITE_MAIL_FROM"]) delete process.env[k];

const { addBuyer } = await import("../lib");
const setup = await import("../setup");
const { actions } = setup;
const { getSetup, putSecret, updateSetup } = await import("../store");
const { asAdmin } = await import("../ctx");
const dnsm = await import("../dns");

afterAll(() => { gd.stop(true); cf.stop(true); rail.stop(true); });
const rec = (type: any, name: string, value: string, extra: any = {}) => ({ key: "k", purpose: "p", type, name, value, ttl: "Auto" as const, ...extra });
// As our admin ("Set up for them"): skips the "finish the earlier steps first" ordering, so a test can jump to a step.
const asUs = <T>(fn: () => Promise<T>) => asAdmin.run("boss@example.com", fn);

describe("DNS writers take back their own records", () => {
  test("GoDaddy: remove() deletes the record it wrote, keeps others at the same name, and never one that was already there", async () => {
    gdRecords = [
      { type: "TXT", name: "app", data: "someone-elses-txt", ttl: 600 },
      { type: "CNAME", name: "old", data: "already.example.net", ttl: 600 },
    ];
    const w = dnsm.godaddyWriter("gd-key-0001", "gd-secret-0001", "example.com.au");
    const cname = rec("CNAME", "app.example.com.au", "x1y2.up.railway.app");
    cname.cfId = await w.ensure(cname);
    const txt = rec("TXT", "app.example.com.au", "railway-verify=abc123");
    txt.cfId = await w.ensure(txt);
    const there = rec("CNAME", "old.example.com.au", "already.example.net");
    there.cfId = await w.ensure(there);
    expect(there.cfId).toEndWith("/existing");
    expect(gdRecords).toHaveLength(4);

    gdCalls.length = 0;
    await w.remove(cname); // only one CNAME at "app": DELETE
    expect(gdCalls.find((c) => c.method === "DELETE")?.path).toBe("/v1/domains/example.com.au/records/CNAME/app");
    await w.remove(txt); // another TXT shares "app": PUT back just that one
    expect(gdCalls.find((c) => c.method === "PUT")).toMatchObject({ path: "/v1/domains/example.com.au/records/TXT/app", body: [{ data: "someone-elses-txt", ttl: 600 }] });
    await w.remove(there); // was there before we wrote it
    expect(gdRecords).toHaveLength(2);
    expect(gdRecords).toContainEqual({ type: "TXT", name: "app", data: "someone-elses-txt", ttl: 600 });
    expect(gdRecords).toContainEqual({ type: "CNAME", name: "old", data: "already.example.net", ttl: 600 });
    // again, and a record changed by someone since: nothing more is touched
    gdCalls.length = 0;
    await w.remove(cname);
    gdRecords.push({ type: "A", name: "@", data: "198.51.100.7", ttl: 600 });
    await w.remove({ ...rec("A", "example.com.au", "203.0.113.9"), cfId: "@/A" });
    expect(gdCalls.filter((c) => c.method !== "GET")).toHaveLength(0);
    expect(gdRecords.some((r) => r.data === "198.51.100.7")).toBe(true);
  });

  test("a test site (any MOCK_* on) never points GoDaddy at the real API", () => {
    const set = process.env.GODADDY_API_BASE;
    delete process.env.GODADDY_API_BASE;
    try { expect(dnsm.GODADDY_API()).toBe(`http://127.0.0.1:${Number(process.env.MOCK_PORT_BASE || 4520) + 7}`); } finally { process.env.GODADDY_API_BASE = set; }
  });

  test("Cloudflare: remove() deletes by the id ensure() gave; one already gone is fine", async () => {
    cfRecords = []; cfCalls.length = 0;
    const w = dnsm.cloudflareWriter("cf-token-0001", "z1");
    const r = rec("CNAME", "app.example.com", "x1y2.up.railway.app");
    r.cfId = await w.ensure(r);
    expect(cfRecords).toHaveLength(1);
    await w.remove(r);
    expect(cfCalls.at(-1)).toEqual({ method: "DELETE", path: `/zones/z1/dns_records/${r.cfId}` });
    expect(cfRecords).toHaveLength(0);
    await w.remove(r); // 404 from Cloudflare: no error
    await w.remove({ ...r, cfId: undefined }); // nothing written: no call
    expect(cfCalls.filter((c) => c.method === "DELETE")).toHaveLength(2);
  });
});

describe("Railway: Delete the project", () => {
  test("removes the app's GoDaddy records it wrote at Install, and keeps the rest of their DNS", async () => {
    const b = addBuyer("Rail Delete", "raildel@example.com");
    gdRecords = [{ type: "A", name: "@", data: "198.51.100.1", ttl: 600 }, { type: "MX", name: "@", data: "mail.example.com.au", ttl: 600, priority: 10 }];
    putSecret(b.id, "railway_token", "railway-test-token-0001");
    putSecret(b.id, "godaddy_key", "gd-key-0001"); putSecret(b.id, "godaddy_secret", "gd-secret-0001");
    const w = dnsm.godaddyWriter("gd-key-0001", "gd-secret-0001", "example.com.au");
    const recs = [rec("CNAME", "app.example.com.au", "x1y2.up.railway.app"), rec("TXT", "_railway-verify.app.example.com.au", "railway-verify=abc123")];
    for (const r of recs) r.cfId = await w.ensure(r); // what tickRailCreate does
    updateSetup(b.id, (s) => {
      s.brand = { productName: "Rail Delete", ownerEmail: "o@example.com", ownPhoneAccount: true };
      s.domain = { mode: "godaddy", zone: "example.com.au", sub: "app", host: "app.example.com.au", confirmed: true };
      s.step = "install"; s.phase = "create_failed"; s.error = "Railway is having a problem.";
      s.rw = { projectId: "prj-1", environmentId: "env-1", appId: "svc-app", records: recs, cfWritten: true };
    });
    expect(gdRecords).toHaveLength(4);
    deleted.length = 0;
    const out = await asUs(async () => actions["server-delete"](b, {}));
    expect(out).toMatchObject({ kind: "ok" });
    expect(deleted).toEqual(["project"]);
    expect(gdRecords).toEqual([{ type: "A", name: "@", data: "198.51.100.1", ttl: 600 }, { type: "MX", name: "@", data: "mail.example.com.au", ttl: 600, priority: 10 }]);
    expect(getSetup(b.id).rw).toBeUndefined();
    expect(getSetup(b.id).phase).toBe("idle");
  });

  test("and the Cloudflare ones, as before", async () => {
    const b = addBuyer("Rail Delete CF", "raildelcf@example.com");
    cfRecords = [{ id: "keep-me", type: "A", name: "example.com", content: "198.51.100.1" }];
    putSecret(b.id, "railway_token", "railway-test-token-0001");
    putSecret(b.id, "cf_token", "cf-token-0001");
    const w = dnsm.cloudflareWriter("cf-token-0001", "z1");
    const recs = [rec("CNAME", "app.example.com", "x1y2.up.railway.app")];
    for (const r of recs) r.cfId = await w.ensure(r);
    updateSetup(b.id, (s) => {
      s.brand = { productName: "Rail Delete CF", ownerEmail: "o@example.com", ownPhoneAccount: true };
      s.domain = { mode: "cloudflare", zone: "example.com", sub: "app", host: "app.example.com", confirmed: true, cf: { zones: [], zoneId: "z1", status: "active" } };
      s.step = "install"; s.phase = "create_failed";
      s.rw = { projectId: "prj-2", environmentId: "env-1", appId: "svc-app", records: recs, cfWritten: true };
    });
    expect(await asUs(async () => actions["server-delete"](b, {}))).toMatchObject({ kind: "ok" });
    expect(cfRecords.map((r) => r.id)).toEqual(["keep-me"]);
  });
});
