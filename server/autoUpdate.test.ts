// The update decision logic (no database): versions, the overnight window, the owner's switch, the checksum,
// the setup site's answer. The flows that touch the database are in ops.test.ts.
//   bun test --env-file=../.env server/autoUpdate.test.ts
import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { decideUpdate, inOvernightWindow, isNewer, localHour, normaliseSetting, parseRelease, sha256Matches, updateConfig } from "./autoUpdate";
import { createProjectToken, railwayHeaders, railwayUpload, RailwayError } from "./railwayUp";

const SITE = "https://setup.example.com";
const on = { enabled: true, mode: "overnight" as const };
const base = { configured: true, setting: on, current: "1.0.0", latest: "1.1.0", busy: false, at: new Date("2026-11-27T16:30:00Z"), tz: "Australia/Sydney" }; // 03:30 in Sydney (AEDT)

describe("versions", () => {
  test("dotted numbers compare by number; other labels only need to differ", () => {
    expect(isNewer("1.10.0", "1.9.0")).toBe(true);
    expect(isNewer("1.9.0", "1.10.0")).toBe(false);
    expect(isNewer("2026.11.9", "2026.11.1")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("1.0", "1.0.0")).toBe(false);
    expect(isNewer("1.0.1", "1.0")).toBe(true);
    expect(isNewer("", "1.0.0")).toBe(false);
    expect(isNewer("build-7", "build-6")).toBe(true);
    expect(isNewer("build-7", "build-7")).toBe(false);
  });
});

describe("overnight 2 to 4am local", () => {
  test("the hour is local to the agency's zone, daylight saving included", () => {
    expect(localHour(new Date("2026-11-27T16:30:00Z"), "Australia/Sydney")).toBe(3); // AEDT +11
    expect(localHour(new Date("2026-07-01T16:30:00Z"), "Australia/Sydney")).toBe(2); // AEST +10
    expect(localHour(new Date("2026-11-27T09:00:00Z"), "America/New_York")).toBe(4);
    expect(localHour(new Date("2026-11-27T16:30:00Z"), "Not/AZone")).toBe(3); // falls back to Sydney
  });
  test("the window is 02:00 to 03:59", () => {
    const at = (h: number, m: number) => new Date(Date.UTC(2026, 10, 27, h - 11 + 24, m)); // Sydney local h:m on the 28th... as UTC
    expect(inOvernightWindow(at(1, 59), "Australia/Sydney")).toBe(false);
    expect(inOvernightWindow(at(2, 0), "Australia/Sydney")).toBe(true);
    expect(inOvernightWindow(at(3, 59), "Australia/Sydney")).toBe(true);
    expect(inOvernightWindow(at(4, 0), "Australia/Sydney")).toBe(false);
    expect(inOvernightWindow(at(14, 0), "Australia/Sydney")).toBe(false);
  });
});

describe("decideUpdate", () => {
  test("overnight: waits during the day, goes in the window", () => {
    expect(decideUpdate({ ...base, at: new Date("2026-11-27T03:00:00Z") })).toEqual({ action: "wait", reason: "not-yet" }); // 14:00 Sydney
    expect(decideUpdate(base)).toEqual({ action: "update", reason: "overnight" });
  });
  test("as soon as available: goes any time", () => {
    expect(decideUpdate({ ...base, setting: { enabled: true, mode: "asap" }, at: new Date("2026-11-27T03:00:00Z") })).toEqual({ action: "update", reason: "asap" });
  });
  test("a push (force) skips the wait", () => {
    expect(decideUpdate({ ...base, at: new Date("2026-11-27T03:00:00Z"), force: true })).toEqual({ action: "update", reason: "now" });
  });
  test("the owner's off switch beats everything, including a push", () => {
    const off = { enabled: false, mode: "asap" as const };
    expect(decideUpdate({ ...base, setting: off })).toEqual({ action: "none", reason: "off" });
    expect(decideUpdate({ ...base, setting: off, force: true })).toEqual({ action: "none", reason: "off" });
  });
  test("nothing to do when current, when there's no release, when busy, or when this copy can't update itself", () => {
    expect(decideUpdate({ ...base, latest: "1.0.0" })).toEqual({ action: "none", reason: "current" });
    expect(decideUpdate({ ...base, latest: "0.9.0" })).toEqual({ action: "none", reason: "current" });
    expect(decideUpdate({ ...base, latest: "" })).toEqual({ action: "none", reason: "no-release" });
    expect(decideUpdate({ ...base, busy: true })).toEqual({ action: "none", reason: "busy" });
    expect(decideUpdate({ ...base, configured: false, force: true })).toEqual({ action: "none", reason: "unavailable" });
  });
  test("settings: on and overnight unless the owner chose otherwise", () => {
    expect(normaliseSetting(null)).toEqual({ enabled: true, mode: "overnight" });
    expect(normaliseSetting({ enabled: false })).toMatchObject({ enabled: false, mode: "overnight" });
    expect(normaliseSetting({ mode: "asap" } as any)).toMatchObject({ enabled: true, mode: "asap" });
    expect(normaliseSetting({ mode: "whenever" } as any).mode).toBe("overnight");
  });
});

describe("the checksum", () => {
  const bytes = new Uint8Array(5000).map((_, i) => i % 251);
  const sha = createHash("sha256").update(bytes).digest("hex");
  test("matches only the exact bytes", () => {
    expect(sha256Matches(bytes, sha)).toBe(true);
    expect(sha256Matches(bytes, sha.toUpperCase())).toBe(true);
    const tampered = bytes.slice();
    tampered[10] ^= 1;
    expect(sha256Matches(tampered, sha)).toBe(false);
    expect(sha256Matches(bytes, "0".repeat(64))).toBe(false);
    expect(sha256Matches(bytes, "")).toBe(false);
    expect(sha256Matches(bytes, sha.slice(0, 63))).toBe(false);
    expect(sha256Matches(bytes, "zz" + sha.slice(2))).toBe(false);
  });
});

describe("the setup site's answer", () => {
  const good = { version: "1.1.0", notes: "- faster", bundleUrl: `${SITE}/api/releases/bundle/1.1.0?b=1&exp=9999999999&sig=abc`, sha256: "a".repeat(64), size: 123456 };
  test("a good answer is accepted", () => expect(parseRelease(good, SITE)).toMatchObject({ version: "1.1.0", sha256: "a".repeat(64) }));
  test("anything odd is refused: another host, a bad checksum, a bad version, junk", () => {
    expect(parseRelease({ ...good, bundleUrl: "https://evil.example/x.tgz" }, SITE)).toBeNull();
    expect(parseRelease({ ...good, bundleUrl: `${SITE}.evil.example/x` }, SITE)).toBeNull();
    expect(parseRelease({ ...good, bundleUrl: `${SITE}/x" onclick="y` }, SITE)).toBeNull();
    expect(parseRelease({ ...good, sha256: "abc" }, SITE)).toBeNull();
    expect(parseRelease({ ...good, version: "1 2" }, SITE)).toBeNull();
    expect(parseRelease(null, SITE)).toBeNull();
    expect(parseRelease("x", SITE)).toBeNull();
  });
});

describe("what this copy needs to update itself", () => {
  const env = { RAILWAY_PROJECT_TOKEN: "t".repeat(30), AUTOUPDATE_PROJECT_ID: "p1", AUTOUPDATE_ENVIRONMENT_ID: "e1", AUTOUPDATE_SERVICE_ID: "s1", SUPPORT_SYNC_TOKEN: "st_" + "x".repeat(40), SUPPORT_SYNC_URL: `${SITE}/api/sync` };
  test("all of it, or it is unavailable", () => {
    expect(updateConfig(env)).toMatchObject({ projectId: "p1", environmentId: "e1", serviceId: "s1", siteBase: SITE, auth: { kind: "project" } });
    for (const k of Object.keys(env)) expect(updateConfig({ ...env, [k]: "" })).toBeNull();
    expect(updateConfig({ ...env, SUPPORT_SYNC_URL: "http://setup.example.com/api/sync" })).toBeNull();
    expect(updateConfig({})).toBeNull();
  });
  test("Railway's own ids are used when ours aren't set", () => {
    const { AUTOUPDATE_PROJECT_ID, AUTOUPDATE_ENVIRONMENT_ID, AUTOUPDATE_SERVICE_ID, ...rest } = env;
    expect(updateConfig({ ...rest, RAILWAY_PROJECT_ID: "rp", RAILWAY_ENVIRONMENT_ID: "re", RAILWAY_SERVICE_ID: "rs" })).toMatchObject({ projectId: "rp", environmentId: "re", serviceId: "rs" });
  });
});

describe("Railway calls (shared with the setup site)", () => {
  test("a project token goes in Project-Access-Token, an account token in Authorization", () => {
    expect(railwayHeaders({ token: "ptok", kind: "project" })).toMatchObject({ "Project-Access-Token": "ptok" });
    expect(railwayHeaders({ token: "ptok", kind: "project" }).Authorization).toBeUndefined();
    expect(railwayHeaders({ token: "atok", kind: "account" })).toMatchObject({ Authorization: "Bearer atok" });
    expect(railwayHeaders({ token: "atok", kind: "account" })["Project-Access-Token"]).toBeUndefined();
  });
  test("projectTokenCreate asks for one project and one environment, with the account token", async () => {
    let seen: any = null;
    const f = (async (url: any, init: any) => { seen = { url: String(url), headers: init.headers, body: JSON.parse(init.body) }; return Response.json({ data: { projectTokenCreate: "ptok-" + "q".repeat(30) } }); }) as unknown as typeof fetch;
    const t = await createProjectToken("acct-token", "proj1", "env1", "Automatic updates", { base: "https://railway.test", doFetch: f });
    expect(t).toStartWith("ptok-");
    expect(seen.url).toBe("https://railway.test/graphql/v2");
    expect(seen.headers.Authorization).toBe("Bearer acct-token");
    expect(seen.body.query).toContain("projectTokenCreate");
    expect(seen.body.variables.input).toEqual({ projectId: "proj1", environmentId: "env1", name: "Automatic updates" });
  });
  test("a refusal is a clean error with a code", async () => {
    const bad = (status: number, msg: string) => (async () => Response.json({ errors: [{ message: msg }] }, { status })) as unknown as typeof fetch;
    await expect(createProjectToken("a", "p", "e", "n", { doFetch: bad(200, "Not Authorized") })).rejects.toMatchObject({ code: "auth" });
    await expect(createProjectToken("a", "p", "e", "n", { doFetch: bad(429, "slow down") })).rejects.toMatchObject({ code: "rate" });
    await expect(createProjectToken("a", "p", "e", "n", { doFetch: (async () => Response.json({ data: { projectTokenCreate: "" } })) as any })).rejects.toBeInstanceOf(RailwayError);
    await expect(createProjectToken("a", "p", "e", "n", { doFetch: (async () => { throw new Error("down"); }) as any })).rejects.toMatchObject({ code: "network" });
  });
  test("upload: the project token, the right address, the service", async () => {
    let seen: any = null;
    const f = (async (url: any, init: any) => { seen = { url: String(url), headers: init.headers, len: init.body.length }; return Response.json({ deploymentId: "dep1" }); }) as unknown as typeof fetch;
    const r = await railwayUpload({ token: "ptok", kind: "project" }, { projectId: "p1", environmentId: "e1", serviceId: "s1" }, new Uint8Array(2000), "Automatic update 1.1.0", { base: "https://railway.test", doFetch: f });
    expect(r.deploymentId).toBe("dep1");
    expect(seen.url).toStartWith("https://railway.test/project/p1/environment/e1/up?serviceId=s1");
    expect(seen.headers["Project-Access-Token"]).toBe("ptok");
    expect(seen.len).toBe(2000);
    await expect(railwayUpload({ token: "x", kind: "project" }, { projectId: "p", environmentId: "e", serviceId: "s" }, new Uint8Array(1), "m", { doFetch: (async () => new Response("{}", { status: 401 })) as any })).rejects.toMatchObject({ code: "auth" });
  });
});
