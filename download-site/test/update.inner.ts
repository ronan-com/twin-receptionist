// The "Update your agency" flow against a small in-process fake of Railway's API.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "update-test-"));
const TOKEN = "railway-test-token-good-0001";
let railCalls: { op: string; body?: any }[] = [];
let uploads: { projectId: string; envId: string; serviceId: string; bytes: number }[] = [];
let syncToken = "";
let failBuilds = 0; // the next N deployments fail to build
let deployments = new Map<string, string>();
let appHasVolume = true;
const PROJECT = "prj-test-1", ENV = "env-test-1", APP = "svc-app-1", PG = "svc-pg-1";
// What the agency's service has in Railway today (what the install set up, plus the buyer's own additions).
const appVars: Record<string, string> = {
  PUBLIC_URL: "https://real-agency.up.railway.app", TELNYX_API_KEY: "KEYREALTELNYX", DATABASE_URL: "${{Postgres.DATABASE_URL}}", MAILBOX_KEY: "mailbox-secret", SMTP_URL: "smtps://x", OPENROUTER_API_KEY: "or-added-by-the-buyer", SINGLE_AGENCY: "1", PORT: "8791",
};

// ---- the agency's own app: answers /api/health ----
const app = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (r) => (new URL(r.url).pathname === "/api/health" ? Response.json({ ok: true }) : new Response("no", { status: 404 })) });

// ---- fake Railway ----
const rail = Bun.serve({
  port: 0, hostname: "127.0.0.1", maxRequestBodySize: 50 * 1024 * 1024,
  async fetch(req) {
    const u = new URL(req.url);
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    const gql = (data: any) => Response.json({ data });
    const bad = () => Response.json({ data: null, errors: [{ message: "Not Authorized" }] });
    const up = u.pathname.match(/^\/project\/([^/]+)\/environment\/([^/]+)\/up$/);
    if (up) {
      if (tok !== TOKEN) return Response.json({ message: "Unauthorized" }, { status: 401 });
      const bytes = (await req.arrayBuffer()).byteLength;
      uploads.push({ projectId: up[1], envId: up[2], serviceId: u.searchParams.get("serviceId") || "", bytes });
      const id = `dep-${uploads.length}`;
      deployments.set(id, failBuilds-- > 0 ? "FAILED" : "SUCCESS");
      railCalls.push({ op: "upload" });
      return Response.json({ deploymentId: id });
    }
    if (tok !== TOKEN) return bad();
    const { query = "", variables = {} } = (await req.json()) as any;
    const has = (f: string) => new RegExp(`\\b${f}\\s*[({]`).test(query);
    if (has("volumeCreate")) { railCalls.push({ op: "volumeCreate", body: variables.input }); return gql({ volumeCreate: true }); }
    for (const f of ["projectCreate", "serviceCreate", "projectDelete", "customDomainCreate", "serviceDomainCreate", "serviceInstanceUpdate"]) if (has(f)) { railCalls.push({ op: f }); return gql({ [f]: true }); }
    if (has("me")) return /\bplan\b/.test(query) ? gql({ me: { workspaces: [{ id: "ws-1", plan: "HOBBY", customer: { isTrialing: false, defaultPaymentMethodId: "pm" } }] } }) : gql({ me: { email: "owner@example.com", workspaces: [{ id: "ws-1", name: "Owner" }] } });
    if (has("variableCollectionUpsert")) { railCalls.push({ op: "upsert", body: variables.input }); Object.assign(appVars, variables.input.variables); return gql({ variableCollectionUpsert: true }); }
    if (has("variables")) { railCalls.push({ op: "variables" }); return variables.s === APP && variables.p === PROJECT ? gql({ variables: { ...appVars } }) : bad(); }
    if (has("project")) {
      if (variables.id !== PROJECT) return Response.json({ data: null, errors: [{ message: "Project not found" }] });
      if (/volumes/.test(query)) return gql({ project: { volumes: { edges: appHasVolume ? [{ node: { id: "vol-1", volumeInstances: { edges: [{ node: { serviceId: APP, environmentId: ENV } }] } } }] : [{ node: { id: "vol-pg", volumeInstances: { edges: [{ node: { serviceId: PG, environmentId: ENV } }] } } }] } } });
      return gql({ project: { id: PROJECT, environments: { edges: [{ node: { id: ENV, name: "production" } }] }, services: { edges: [{ node: { id: PG, name: "Postgres" } }, { node: { id: APP, name: "app" } }] } } });
    }
    if (has("deployment")) return gql({ deployment: { id: variables.id, status: deployments.get(variables.id) || "FAILED" } });
    if (has("buildLogs")) return gql({ buildLogs: failBuilds < 0 && deployments.get(variables.d) === "FAILED" ? [{ timestamp: "", message: "ERROR: failed to solve: exit code: 1" }] : [{ timestamp: "", message: "Build finished" }], ...(has("deploymentLogs") ? { deploymentLogs: [] } : {}) });
    return Response.json({ data: null, errors: [{ message: "unsupported " + query.slice(0, 40) }] });
  },
});

process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
process.env.MOCK_RAILWAY = "1";
process.env.MOCK_FAST = "1"; // test mode: check on every tick instead of every few seconds
process.env.RAILWAY_API_BASE = `http://127.0.0.1:${rail.port}`;
for (const k of ["MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH"]) delete process.env[k];
mkdirSync(join(dir, "packages"), { recursive: true });

const { addBuyer, recordPackage, setPackageNotes, PACKAGES_DIR } = await import("../lib");
const { actions, kick, updateInfo, updateVarHooks, ensureAppVolume, APP_VOLUME_PATH } = await import("../setup");
const { getSetup, saveSetup, getSecret, hasSecret, putSecret, updateSetup, logRead } = await import("../store");
const { wizardPage } = await import("../wizard");

afterAll(() => { rail.stop(true); app.stop(true); });

const publish = (version: string, notes?: string) => {
  const file = `ai-receptionist-server-${version}.tgz`;
  writeFileSync(join(PACKAGES_DIR, file), "x");
  writeFileSync(join(PACKAGES_DIR, file.replace(/\.tgz$/, ".app-src.tgz")), Buffer.alloc(4096, 7)); // the app source, already unpacked
  recordPackage({ version, file, size: 1, sha256: "0".repeat(64), notes });
};
const run = async (b: any, name: string, f: Record<string, string> = {}) => actions[name](b, f);
const page = (b: any) => wizardPage(b, getSetup(b.id), b.code, "sid-test", "done");
async function until(id: number, fn: () => boolean, ms = 40_000) {
  const t0 = Date.now();
  while (!fn() && Date.now() - t0 < ms) { kick(id); await Bun.sleep(250); }
}

publish("1.0.2", "- first real release");
const buyer = addBuyer("Real Ronan Agency", "ronan@example.com");
saveSetup(buyer.id, {
  step: "done", phase: "done", brand: { productName: "Real Ronan Agency", ownerEmail: "ronan@example.com", ownPhoneAccount: false }, phones: { confirmed: true },
  railway: { workspaceName: "Owner", confirmed: true }, rw: { projectId: PROJECT, serviceDomain: `localhost:${app.port}` },
  tempUrl: `http://localhost:${app.port}`, resultUrl: `http://localhost:${app.port}`, attemptVersion: "1.0.2", installedAt: new Date().toISOString(), progress: [],
});

describe("update your agency", () => {
  test("shows the new version with what's new on the Done screen, and nothing when up to date", () => {
    expect(updateInfo(buyer, getSetup(buyer.id))).toMatchObject({ installed: "1.0.2", latest: "1.0.2", available: false });
    expect(page(buyer)).toContain("on version 1.0.2, the latest");
    publish("1.0.3");
    setPackageNotes("1.0.3", "- Calls show in a new timeline\n* Fixes the booking reminder time");
    const info = updateInfo(buyer, getSetup(buyer.id))!;
    expect(info).toMatchObject({ installed: "1.0.2", latest: "1.0.3", available: true });
    expect(info.notes).toEqual([{ version: "1.0.3", lines: ["Calls show in a new timeline", "Fixes the booking reminder time"] }]);
    const html = page(buyer);
    expect(html).toContain("Your agency is on version 1.0.2. Version 1.0.3 is available.");
    expect(html).toContain("Calls show in a new timeline");
    expect(html).toContain('action="/setup/' + buyer.code + '/a/update-open"');
  });

  test("Update now asks for the token again, checks it, and refuses one that can't see the project", async () => {
    expect(await run(buyer, "update-open")).toBeNull();
    expect(getSetup(buyer.id).update?.phase).toBe("ask");
    const html = page(buyer);
    expect(html).toContain('name="token"');
    expect(html).toContain("Step-by-step guide");
    const bad = await run(buyer, "update-start", { token: "some-other-token-nope" });
    expect(bad?.kind).toBe("err");
    expect(getSetup(buyer.id).update?.phase).toBe("ask");
    expect(hasSecret(buyer.id, "railway_token")).toBe(false);
    expect((await run(buyer, "update-start", {}))?.kind).toBe("err"); // nothing pasted
  });

  test("redeploys the same project and service, keeps every variable, adds only new ones, records the version, deletes the token", async () => {
    updateVarHooks.push(() => ({ NEW_THING: "1", PUBLIC_URL: "https://hijack.example" })); // a new setting, and an attempt to touch an existing one
    railCalls = []; uploads = [];
    const before = { ...appVars };
    expect(await run(buyer, "update-start", { token: TOKEN })).toBeNull();
    expect(hasSecret(buyer.id, "railway_token")).toBe(true); // held only while it runs
    expect(getSetup(buyer.id).update?.phase).toBe("running");
    expect(page(buyer)).toContain("Updating Real Ronan Agency");
    await until(buyer.id, () => getSetup(buyer.id).update?.phase !== "running");
    const s = getSetup(buyer.id);
    expect(s.update).toMatchObject({ phase: "done", from: "1.0.2", to: "1.0.3" });
    // Same project, environment and service: one upload to the ids the install made, and nothing new created.
    expect(uploads).toEqual([{ projectId: PROJECT, envId: ENV, serviceId: APP, bytes: 4096 }]);
    expect(railCalls.filter((c) => ["projectCreate", "serviceCreate", "volumeCreate", "projectDelete", "customDomainCreate", "serviceDomainCreate"].includes(c.op))).toEqual([]);
    // Variables: everything that was there is exactly as it was; only APP_VERSION and the new setting were written.
    for (const [k, v] of Object.entries(before)) expect(appVars[k]).toBe(v);
    expect(appVars.APP_VERSION).toBe("1.0.3");
    expect(appVars.NEW_THING).toBe("1");
    expect(appVars.SUPPORT_SYNC_URL).toBe("http://localhost:4500/api/sync"); // an agency installed before sync existed gets it
    expect(appVars.SUPPORT_SYNC_TOKEN).toMatch(/\S{20,}/);
    expect(appVars.SUPPORT_CALL_TOKEN).toMatch(/\S{20,}/);
    expect(appVars.SUPPORT_SELLER_NAME).toBeTruthy();
    syncToken = appVars.SUPPORT_SYNC_TOKEN;
    expect(appVars.PUBLIC_URL).toBe("https://real-agency.up.railway.app");
    const upsert = railCalls.find((c) => c.op === "upsert")!.body;
    expect(Object.keys(upsert.variables).sort()).toEqual(["APP_VERSION", "NEW_THING", "RAILWAY_RUN_UID", "SUPPORT_CALL_TOKEN", "SUPPORT_SELLER_NAME", "SUPPORT_SYNC_TOKEN", "SUPPORT_SYNC_URL"]);
    expect(upsert.skipDeploys).toBe(true);
    // Recorded, and the token is gone again.
    expect(s.attemptVersion).toBe("1.0.3");
    expect(hasSecret(buyer.id, "railway_token")).toBe(false);
    expect(updateInfo(buyer, s)).toMatchObject({ installed: "1.0.3", available: false });
    expect(s.flash?.text).toContain("1.0.3");
    expect(JSON.stringify(s)).not.toContain(TOKEN);
    expect(logRead(buyer.id).text).not.toContain(TOKEN);
    expect(page(buyer)).toContain("on version 1.0.3, the latest");
  }, 60_000);

  test("an agency with no app volume gets one (once, on the app service); one that has it is left alone", async () => {
    railCalls = [];
    appHasVolume = false;
    expect(await ensureAppVolume(TOKEN, PROJECT, ENV, APP)).toBe(true);
    expect(railCalls.filter((c) => c.op === "volumeCreate").map((c) => c.body)).toEqual([{ projectId: PROJECT, environmentId: ENV, serviceId: APP, mountPath: APP_VOLUME_PATH }]);
    appHasVolume = true;
    railCalls = [];
    expect(await ensureAppVolume(TOKEN, PROJECT, ENV, APP)).toBe(false);
    expect(railCalls.filter((c) => c.op === "volumeCreate")).toEqual([]);
    expect(await ensureAppVolume("wrong-token", PROJECT, ENV, APP)).toBe(false); // best effort: never throws
  });

  test("a failed build loses nothing: clear error, still on the old version, Try again works", async () => {
    publish("1.0.4", "- Another fix");
    failBuilds = 1; uploads = [];
    expect(await run(buyer, "update-open")).toBeNull();
    expect(await run(buyer, "update-start", { token: TOKEN })).toBeNull();
    await until(buyer.id, () => getSetup(buyer.id).update?.phase !== "running");
    let s = getSetup(buyer.id);
    expect(s.update?.phase).toBe("failed");
    expect(s.update?.error).toMatch(/couldn't build/i);
    expect(s.update?.error).toContain("still running version 1.0.3");
    expect(s.attemptVersion).toBe("1.0.3"); // nothing recorded
    expect(hasSecret(buyer.id, "railway_token")).toBe(true); // kept so Try again needs no paste
    const html = page(buyer);
    expect(html).toContain("The update stopped");
    expect(html).toContain("Nothing was lost");
    expect(html).toContain("/a/update-retry");
    // Try again: a fresh build, same ids.
    expect(await run(buyer, "update-retry")).toMatchObject({ kind: "info" });
    await until(buyer.id, () => getSetup(buyer.id).update?.phase !== "running");
    s = getSetup(buyer.id);
    expect(s.update).toMatchObject({ phase: "done", to: "1.0.4" });
    expect(uploads.length).toBe(2);
    expect(uploads.every((u) => u.projectId === PROJECT && u.serviceId === APP)).toBe(true);
    expect(s.attemptVersion).toBe("1.0.4");
    expect(appVars.APP_VERSION).toBe("1.0.4");
    expect(appVars.SUPPORT_SYNC_TOKEN).toBe(syncToken); // already there: not made again
    expect(hasSecret(buyer.id, "railway_token")).toBe(false);
  }, 90_000);

  test("a test run shows the banner and fakes the update without calling anything", async () => {
    const realFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (u: any) => { seen.push(String(u)); throw new Error("a test run must not call out: " + u); }) as any;
    try {
      const d = addBuyer("Test run", "demo@example.com", true);
      saveSetup(d.id, { step: "done", phase: "done", brand: { productName: "Demo Co", ownerEmail: "d@d.test", ownPhoneAccount: false }, phones: { confirmed: true }, rw: { projectId: "demo" }, resultUrl: "http://x/open", progress: [] });
      const info = updateInfo(d, getSetup(d.id))!;
      expect(info.available).toBe(true);
      expect(info.installed).not.toBe(info.latest);
      expect(page(d)).toContain("is available");
      await run(d, "update-open");
      expect((await run(d, "update-start", { token: "anything" }))).toBeNull();
      expect(hasSecret(d.id, "railway_token")).toBe(false);
      await until(d.id, () => getSetup(d.id).update?.phase !== "running", 30_000);
      expect(getSetup(d.id).update?.phase).toBe("done");
      expect(getSetup(d.id).attemptVersion).toBe(info.latest);
      expect(updateInfo(d, getSetup(d.id))!.available).toBe(false);
      expect(seen).toEqual([]);
    } finally { globalThis.fetch = realFetch; }
  }, 40_000);
});
