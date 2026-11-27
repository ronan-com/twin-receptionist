// Add or change the agency's own web address AFTER the install (the Done screen), against an in-process fake of Railway's API.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(40_000);
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "domainadd-test-"));
const TOKEN = "railway-test-token-good-0001";
const PROJECT = "prj-test-1", ENV = "env-test-1", APP = "svc-app-1", PG = "svc-pg-1";
let calls: { op: string; body?: any }[] = [];
let customDomains: { id: string; domain: string }[] = [];
const appVars: Record<string, string> = { PUBLIC_URL: "https://real-agency.up.railway.app", TELNYX_API_KEY: "KEYREAL", DATABASE_URL: "${{Postgres.DATABASE_URL}}", SINGLE_AGENCY: "1", PORT: "8791" };

// the agency's own app at its Railway address
const app = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (r) => (new URL(r.url).pathname === "/api/health" ? Response.json({ ok: true }) : new Response("no", { status: 404 })) });

const cdJson = (id: string, domain: string) => ({ id, domain, status: { verified: false, certificateStatus: "CERTIFICATE_STATUS_TYPE_VALIDATING", verificationDnsHost: `_railway-verify.${domain.split(".")[0]}`, verificationToken: "railway-verify=abc123",
  dnsRecords: [{ recordType: "DNS_RECORD_TYPE_CNAME", hostlabel: domain.split(".")[0], fqdn: domain, zone: domain.split(".").slice(1).join("."), requiredValue: "x1y2.up.railway.app", currentValue: "", status: "DNS_RECORD_STATUS_REQUIRES_UPDATE", purpose: "DNS_RECORD_PURPOSE_TRAFFIC_ROUTE" }] } });

const rail = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    const gql = (data: any) => Response.json({ data });
    const bad = () => Response.json({ data: null, errors: [{ message: "Not Authorized" }] });
    if (tok !== TOKEN) return bad();
    const { query = "", variables = {} } = (await req.json()) as any;
    const has = (f: string) => new RegExp(`\\b${f}\\s*[({]`).test(query);
    if (has("me")) return /\bplan\b/.test(query) ? gql({ me: { workspaces: [{ id: "ws-1", plan: "HOBBY", customer: { isTrialing: false, defaultPaymentMethodId: "pm" } }] } }) : gql({ me: { email: "owner@example.com", workspaces: [{ id: "ws-1", name: "Owner" }] } });
    if (has("domains")) { calls.push({ op: "domains" }); return gql({ domains: { customDomains: customDomains.map((c) => ({ id: c.id, domain: c.domain })) } }); }
    if (has("customDomainDelete")) { calls.push({ op: "customDomainDelete", body: variables }); customDomains = customDomains.filter((c) => c.id !== variables.id); return gql({ customDomainDelete: true }); }
    if (has("customDomainCreate")) {
      calls.push({ op: "customDomainCreate", body: variables.input });
      if (customDomains.some((c) => c.domain === variables.input.domain)) return Response.json({ data: null, errors: [{ message: "Domain is already in use" }] });
      const c = { id: `cd-${customDomains.length + 1}`, domain: variables.input.domain }; customDomains.push(c);
      return gql({ customDomainCreate: cdJson(c.id, c.domain) });
    }
    if (has("variableCollectionUpsert")) { calls.push({ op: "upsert", body: variables.input }); Object.assign(appVars, variables.input.variables); return gql({ variableCollectionUpsert: true }); }
    if (has("project")) {
      if (variables.id !== PROJECT) return Response.json({ data: null, errors: [{ message: "Project not found" }] });
      return gql({ project: { id: PROJECT, environments: { edges: [{ node: { id: ENV, name: "production" } }] }, services: { edges: [{ node: { id: PG, name: "Postgres" } }, { node: { id: APP, name: "app" } }] } } });
    }
    return Response.json({ data: null, errors: [{ message: "unsupported " + query.slice(0, 40) }] });
  },
});

process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
process.env.MOCK_RAILWAY = "1";
process.env.MOCK_FAST = "1";
process.env.RAILWAY_API_BASE = `http://127.0.0.1:${rail.port}`;
for (const k of ["MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH"]) delete process.env[k];

const { addBuyer } = await import("../lib");
const { actions, kick, tickDomainWatch, domainWatch, dashboardLink } = await import("../setup");
const { getSetup, getSecret, hasSecret, putSecret, updateSetup, saveSetup } = await import("../store");
const { wizardPage } = await import("../wizard");
afterAll(() => { rail.stop(true); app.stop(true); });

const TEMP = `http://127.0.0.1:${app.port}`;
function liveBuyer(n: string, withHost = "") {
  const b = addBuyer(`Buyer ${n}`, `da-${n}@example.com`);
  saveSetup(b.id, {
    step: "done", phase: "done", schema: 3, brand: { productName: "Acme", ownerEmail: "o@acme.test" }, railway: { confirmed: true }, phones: { confirmed: true, provider: "telnyx" }, extrasDone: true,
    resultUrl: withHost ? `https://${withHost}` : TEMP, tempUrl: TEMP, attemptVersion: "1.0.22", rw: { projectId: PROJECT, serviceDomain: `127.0.0.1:${app.port}`, domainOk: !!withHost },
    firstLogin: { token: "tok-" + n, at: new Date().toISOString() },
    ...(withHost ? { domain: { mode: "manual", zone: withHost.replace(/^app\./, ""), sub: "app", host: withHost, confirmed: true } } : {}),
  } as any);
  return b;
}
const waitFor = async (b: { id: number }, what: string, fn: () => boolean, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { kick(b.id); if (fn()) return; await Bun.sleep(250); } throw new Error("timed out: " + what); };
const html = (b: any) => wizardPage(b, getSetup(b.id), b.code, "sid", "done");

describe("add your own domain after the install", () => {
  test("the Done screen offers it, the form asks for the domain and the Railway token", async () => {
    const b = liveBuyer("a");
    expect(html(b)).toContain("Add your own domain");
    expect(await actions["domain-add-open"](b, {})).toBeNull();
    const form = html(b);
    expect(form).toContain("Add your own web address");
    expect(form).toContain('name="domain"');
    expect(form).toContain('name="token"');
    expect(form).toContain("for this change only, then delete it");
    expect(await actions["domain-add-cancel"](b, {})).toBeNull();
    expect(getSetup(b.id).domainAdd).toBeUndefined();
  });

  test("bad input: no domain, no token, a token Railway refuses: nothing changes and nothing is kept", async () => {
    const b = liveBuyer("b");
    await actions["domain-add-open"](b, {});
    expect((await actions["domain-add-start"](b, { domain: "", token: TOKEN }))?.kind).toBe("err");
    expect((await actions["domain-add-start"](b, { domain: "yourbiz.test", token: "" }))?.kind).toBe("err");
    const r = await actions["domain-add-start"](b, { domain: "yourbiz.test", token: "not-the-token" });
    expect(r?.kind).toBe("err");
    expect(hasSecret(b.id, "railway_token")).toBe(false);
    expect(getSetup(b.id).domainAdd?.phase).toBe("ask");
    expect(getSetup(b.id).domain).toBeUndefined();
  });

  test("it connects the domain on their app, points PUBLIC_URL at it and FALLBACK_URL at Railway, restarts, forgets the token, and the records show", async () => {
    calls = []; customDomains = [];
    const b = liveBuyer("c");
    await actions["domain-add-open"](b, {});
    expect(await actions["domain-add-start"](b, { domain: "Yourbiz.test", token: TOKEN })).toBeNull();
    expect(getSetup(b.id).domainAdd?.phase).toBe("running");
    expect(html(b)).toContain("Connecting app.yourbiz.test");
    await waitFor(b, "the change to finish", () => !getSetup(b.id).domainAdd);
    const s = getSetup(b.id);
    expect(s.domain).toMatchObject({ host: "app.yourbiz.test", zone: "yourbiz.test", confirmed: true });
    expect(s.domainPending).toBe(true);
    expect(s.finishRecords?.length).toBeGreaterThan(0);
    expect(s.finishRecords!.some((r) => r.type === "CNAME" && r.name === "app.yourbiz.test")).toBe(true);
    expect(hasSecret(b.id, "railway_token")).toBe(false); // used for this change only
    const create = calls.filter((c) => c.op === "customDomainCreate");
    expect(create).toHaveLength(1);
    expect(create[0].body).toMatchObject({ domain: "app.yourbiz.test", serviceId: APP, environmentId: ENV, projectId: PROJECT });
    const up = calls.find((c) => c.op === "upsert")!;
    expect(up.body.variables).toEqual({ PUBLIC_URL: "https://app.yourbiz.test", FALLBACK_URL: TEMP });
    expect(up.body.skipDeploys).toBeUndefined(); // so Railway restarts the app with them
    expect(calls.some((c) => c.op === "customDomainDelete")).toBe(false); // nothing to remove: there was no domain
    // the Done screen: temporary address first, records, and the dashboard link on the address that works now
    const page = html(b);
    expect(page).toContain("Records for app.yourbiz.test");
    expect(page).toContain(TEMP);
    expect(page).toContain("Change domain");
    expect(page).toContain(`href="${dashboardLink(s, TEMP)}"`);
  });

  test("once public DNS and the address answer, it shows live and the pending records go away", async () => {
    calls = []; customDomains = [];
    const seen: string[] = [];
    domainWatch.recordLive = (async (r: any) => { seen.push(r.name); return { ok: true, seen: r.value }; }) as any;
    domainWatch.answers = async () => false;
    const b = liveBuyer("d");
    await actions["domain-add-open"](b, {});
    await actions["domain-add-start"](b, { domain: "livebiz.test", token: TOKEN });
    await waitFor(b, "the change to finish", () => !getSetup(b.id).domainAdd);
    await Bun.sleep(1600);
    await tickDomainWatch(b.id);
    expect(getSetup(b.id).domainPending).toBe(true); // records are in but it doesn't answer yet
    expect(getSetup(b.id).finishRecords!.every((r) => r.ok)).toBe(true);
    domainWatch.answers = async () => true;
    await Bun.sleep(1600); // the watch looks at most every 1.5s in test mode
    await tickDomainWatch(b.id);
    const s = getSetup(b.id);
    expect(s.domainPending).toBe(false);
    expect(s.finishRecords).toBeUndefined();
    expect(s.resultUrl).toBe("https://app.livebiz.test");
    expect(html(b)).toContain("https://app.livebiz.test");
    expect(html(b)).not.toContain("Records for app.livebiz.test");
  });

  test("change domain: the old one comes off the app, the new one goes on", async () => {
    calls = []; customDomains = [{ id: "cd-old", domain: "app.oldbiz.test" }];
    const b = liveBuyer("e", "app.oldbiz.test");
    expect(html(b)).toContain("Change domain");
    expect(html(b)).not.toContain("Add your own domain");
    await actions["domain-add-open"](b, {});
    expect(html(b)).toContain("Change your web address");
    expect(await actions["domain-add-start"](b, { domain: "newbiz.test", token: TOKEN })).toBeNull();
    await waitFor(b, "the change to finish", () => !getSetup(b.id).domainAdd);
    expect(calls.filter((c) => c.op === "customDomainDelete").map((c) => c.body.id)).toEqual(["cd-old"]);
    expect(customDomains.map((c) => c.domain)).toEqual(["app.newbiz.test"]);
    expect(getSetup(b.id).domain?.host).toBe("app.newbiz.test");
    expect(calls.find((c) => c.op === "upsert")!.body.variables.PUBLIC_URL).toBe("https://app.newbiz.test");
  });

  test("Railway says the domain is taken: the change stops with the reason, nothing is lost, Try again works once it is free", async () => {
    calls = []; customDomains = [{ id: "cd-taken", domain: "app.takenbiz.test" }];
    const b = liveBuyer("f");
    await actions["domain-add-open"](b, {});
    await actions["domain-add-start"](b, { domain: "takenbiz.test", token: TOKEN });
    await waitFor(b, "the failure", () => getSetup(b.id).domainAdd?.phase === "failed");
    const page = html(b);
    expect(page).toContain("The change stopped");
    expect(page).toContain("Nothing was lost");
    expect(page).toContain("domain-add-retry");
    expect(getSetup(b.id).domain).toBeUndefined();
    expect(getSetup(b.id).resultUrl).toBe(TEMP);
    customDomains = [];
    expect(await actions["domain-add-retry"](b, {})).toBeNull();
    await waitFor(b, "the retry to finish", () => !getSetup(b.id).domainAdd);
    expect(getSetup(b.id).domain?.host).toBe("app.takenbiz.test");
  });

  test("not available before the install is done, or for a test run", async () => {
    const b = addBuyer("Early", "early@example.com");
    expect(await actions["domain-add-open"](b, {})).toBeNull();
    expect(getSetup(b.id).domainAdd).toBeUndefined();
    expect((await actions["domain-add-start"](b, { domain: "x.test", token: TOKEN }))?.kind).toBe("err");
    const demo = addBuyer("Demo", "demo@example.com", true);
    saveSetup(demo.id, { step: "done", phase: "done", schema: 3, rw: { projectId: PROJECT } } as any);
    expect((await actions["domain-add-start"](demo, { domain: "x.test", token: TOKEN }))?.kind).toBe("err");
  });
});
