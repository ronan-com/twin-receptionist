// The checks for ops.test.ts: automatic updates, problems, support changes, default-on access, the logs route.
// They run in their own bun process against a database of their own (made and dropped by that file).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { AuthError, sessionFrom, type Ctx } from "./accounts";
import { STATE_KEY, SETTING_KEY, checkAndUpdate, readUpdateState, reconcileOnBoot, tokenTag, updateConfig, updatesRoute, updatesStatus, watchDeployment, type Deps } from "./autoUpdate";
import { migrate, sql } from "./db";
import { clearLogRing, collectProblems, pushLog, recordProblem } from "./problems";
import { ACCESS_KEY, EDIT_KEY, SYNC_KEY, accessOpen, readAccess } from "./supportAccess";
import { readOnlyView, supportGate } from "./supportChanges";
import { assertWhitelisted, buildSnapshot, issueLoginLink, redeemLoginLink, sendHeartbeat, supportPublicRoutes, supportSettingsRoute } from "./supportSync";

const SITE = "https://setup.example.com";
const CALL = "sc_test_token_0123456789abcdef0123456789";
const TOKEN = "st_test_token_0123456789abcdef0123456789";
const orgId = crypto.randomUUID();
const ownerId = crypto.randomUUID();
const KEYS = ["SUPPORT_SYNC_URL", "SUPPORT_SYNC_TOKEN", "SUPPORT_CALL_TOKEN", "SUPPORT_SELLER_NAME", "SINGLE_AGENCY", "PUBLIC_URL", "SUPPORT_ACCESS_DEFAULT", "APP_VERSION"];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

const req = (path: string, init: RequestInit = {}) => new Request(`https://app.example.com${path}`, init);
const post = (path: string, headers: Record<string, string> = {}) => req(path, { method: "POST", headers });
const put = (path: string, body: unknown) => req(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const owner = (over: Partial<Ctx> = {}): Ctx => ({ tokenHash: "x", user: { id: ownerId, email: "owner@example.com", name: "Owner", platformAdmin: false }, org: { id: orgId, name: "Test Agency" }, role: "owner", ...over });
const setting = (key: string, v: unknown) => sql`insert into app_settings (key, value) values (${key}, ${v as any}) on conflict (key) do update set value = excluded.value`;
const actions = async () => (await sql`select action from audit_log where org_id = ${orgId} order by created_at`).map((r: any) => r.action as string);
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

const BUNDLE = new Uint8Array(4000).map((_, i) => (i * 7) % 256);
const SHA = createHash("sha256").update(BUNDLE).digest("hex");
const ENV = { RAILWAY_PROJECT_TOKEN: "ptok_0123456789abcdef", AUTOUPDATE_PROJECT_ID: "proj1", AUTOUPDATE_ENVIRONMENT_ID: "env1", AUTOUPDATE_SERVICE_ID: "svc1", SUPPORT_SYNC_TOKEN: TOKEN, SUPPORT_SYNC_URL: `${SITE}/api/sync`, APP_VERSION: "1.0.0" };
const NIGHT = new Date("2026-11-27T16:30:00Z"); // 03:30 in Sydney
const DAY = new Date("2026-11-27T03:00:00Z"); // 14:00 in Sydney

type World = { site: string[]; railway: { url: string; method: string; headers: Record<string, string>; body: any }[]; deps: Deps };
type RailwayStandIn = (url: string, body: any) => Response | null;
function world(o: { sha?: string; bytes?: Uint8Array; env?: Record<string, string | undefined>; now?: Date; uploadStatus?: number; version?: string; railway?: RailwayStandIn; pollMs?: number } = {}): World {
  const w: World = { site: [], railway: [], deps: null as any };
  const site = (async (url: any, init: any) => {
    const u = String(url);
    w.site.push(u);
    if (u.endsWith("/api/releases/latest")) {
      if (init?.headers?.authorization !== `Bearer ${TOKEN}`) return new Response("{}", { status: 401 });
      return Response.json({ version: o.version ?? "1.1.0", notes: "- faster", sha256: o.sha ?? SHA, size: BUNDLE.length, bundleUrl: `${SITE}/api/releases/bundle/${o.version ?? "1.1.0"}?b=1&exp=9999999999&sig=${"s".repeat(43)}` });
    }
    if (u.includes("/api/releases/bundle/")) return new Response((o.bytes ?? BUNDLE) as unknown as BodyInit);
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;
  const railway = (async (url: any, init: any) => {
    const u = String(url);
    const body = u.endsWith("/graphql/v2") ? JSON.parse(init.body) : { bytes: init.body?.length };
    w.railway.push({ url: u, method: init.method, headers: init.headers, body });
    const special = o.railway?.(u, body);
    if (special) return special;
    if (u.includes("/up?")) return o.uploadStatus && o.uploadStatus !== 200 ? new Response("{}", { status: o.uploadStatus }) : Response.json({ deploymentId: "dep-1" });
    if (/\bdeployment\(/.test(body.query ?? "")) return Response.json({ data: { deployment: { id: "dep-1", status: "BUILDING" } } });
    return Response.json({ data: { variableCollectionUpsert: true } });
  }) as unknown as typeof fetch;
  w.deps = { fetch: site, railwayFetch: railway, railwayBase: "https://railway.test", env: o.env ?? ENV, pollMs: o.pollMs ?? 3_600_000, now: () => o.now ?? NIGHT, timezone: async () => "Australia/Sydney" };
  return w;
}

beforeAll(async () => {
  process.env.SUPPORT_SYNC_URL = "http://127.0.0.1:9/api/sync";
  process.env.SUPPORT_SYNC_TOKEN = TOKEN;
  process.env.SUPPORT_CALL_TOKEN = CALL;
  process.env.SUPPORT_SELLER_NAME = "Acme Setups";
  process.env.SINGLE_AGENCY = "1";
  process.env.PUBLIC_URL = "https://app.example.com";
  delete process.env.SUPPORT_ACCESS_DEFAULT;
  await migrate();
  await sql`insert into orgs (id, name, created_at) values (${orgId}, 'Test Agency', '1970-01-01')`;
  await sql`insert into users (id, email, name, password_hash) values (${ownerId}, ${`owner-${ownerId}@example.com`}, 'Owner', 'x')`;
  await sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${ownerId}, 'owner')`;
}, 120_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(async () => {
  await sql`delete from app_settings where key in (${ACCESS_KEY}, ${SYNC_KEY}, ${EDIT_KEY}, ${SETTING_KEY}, ${STATE_KEY})`;
  await sql`delete from sessions where support`;
  await sql`delete from support_login_links`;
  await sql`delete from audit_log where org_id = ${orgId}`;
  await sql`delete from incidents`;
  await sql`delete from problem_log`;
  delete process.env.SUPPORT_ACCESS_DEFAULT;
  clearLogRing();
});

describe("automatic updates", () => {
  test("a copy with no project token can't update itself, and says so", async () => {
    const w = world({ env: { ...ENV, RAILWAY_PROJECT_TOKEN: "" } });
    expect(await checkAndUpdate({}, w.deps)).toEqual({ ok: true, started: false, reason: "unavailable" });
    expect(w.site).toHaveLength(0);
    expect(w.railway).toHaveLength(0);
    expect((await updatesStatus()).available).toBe(false);
  });

  test("the good path: version set without a deploy, the exact bytes uploaded with the PROJECT token, state recorded", async () => {
    const w = world();
    const r = await checkAndUpdate({}, w.deps);
    expect(r).toEqual({ ok: true, started: true, version: "1.1.0" });
    const [vars, up] = w.railway;
    expect(vars.body.query).toContain("variableCollectionUpsert");
    expect(vars.body.variables.input).toMatchObject({ projectId: "proj1", environmentId: "env1", serviceId: "svc1", variables: { APP_VERSION: "1.1.0" }, skipDeploys: true });
    expect(up.url).toStartWith("https://railway.test/project/proj1/environment/env1/up?serviceId=svc1");
    expect(up.headers["Project-Access-Token"]).toBe(ENV.RAILWAY_PROJECT_TOKEN);
    expect(up.headers.Authorization).toBeUndefined();
    expect(up.body.bytes).toBe(BUNDLE.length);
    const s = await readUpdateState();
    expect(s).toMatchObject({ phase: "deploying", from: "1.0.0", to: "1.1.0", deploymentId: "dep-1", latest: "1.1.0" });
    expect(await actions()).toContain("updates.started");
  });

  test("a checksum mismatch installs nothing, and is recorded as a failure the owner and we can see", async () => {
    const tampered = BUNDLE.slice();
    tampered[100] ^= 1;
    const w = world({ bytes: tampered });
    const r = await checkAndUpdate({}, w.deps);
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toContain("checksum");
    expect(w.railway).toHaveLength(0); // nothing was sent to Railway
    const s = await readUpdateState();
    expect(s).toMatchObject({ phase: "idle", lastResult: "failed" });
    expect(s.lastError).toContain("checksum");
    const [inc] = await sql`select kind, message from incidents`;
    expect(inc.kind).toBe("update_failed");
    expect((await collectProblems()).map((p) => p.kind)).toContain("update_failed");
    expect((await updatesStatus()).lastResult).toBe("failed");
  });

  test("the owner's off switch is respected, even for a push from the setup site", async () => {
    await setting(SETTING_KEY, { enabled: false, mode: "asap" });
    const w = world();
    expect(await checkAndUpdate({ force: true }, w.deps)).toMatchObject({ started: false, reason: "off" });
    expect(w.site.some((u) => u.includes("/bundle/"))).toBe(false);
    expect(w.railway).toHaveLength(0);
  });

  test("overnight: waits by day, goes in the window; as soon as available goes any time; a push skips the wait", async () => {
    const day = world({ now: DAY });
    expect(await checkAndUpdate({}, day.deps)).toMatchObject({ started: false, reason: "not-yet", latest: "1.1.0" });
    expect(day.railway).toHaveLength(0);
    await setting(SETTING_KEY, { enabled: true, mode: "asap" });
    expect(await checkAndUpdate({}, world({ now: DAY }).deps)).toMatchObject({ started: true });
    await sql`delete from app_settings where key = ${STATE_KEY}`;
    await setting(SETTING_KEY, { enabled: true, mode: "overnight" });
    expect(await checkAndUpdate({ force: true }, world({ now: DAY }).deps)).toMatchObject({ started: true });
  });

  test("nothing happens when already on the newest, or one is already being installed", async () => {
    expect(await checkAndUpdate({}, world({ version: "1.0.0" }).deps)).toMatchObject({ started: false, reason: "current" });
    await setting(STATE_KEY, { phase: "deploying", from: "1.0.0", to: "1.1.0", startedAt: NIGHT.toISOString() });
    const w = world();
    expect(await checkAndUpdate({}, w.deps)).toMatchObject({ started: false, reason: "busy" });
    expect(w.railway).toHaveLength(0);
  });

  test("Railway refusing the project token fails cleanly and puts the old version label back", async () => {
    const w = world({ uploadStatus: 401 });
    const r = await checkAndUpdate({}, w.deps);
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toContain("project token");
    const upserts = w.railway.filter((c) => c.body?.variables?.input?.variables);
    expect(upserts.map((c) => c.body.variables.input.variables.APP_VERSION)).toEqual(["1.1.0", "1.0.0"]);
    expect(await readUpdateState()).toMatchObject({ phase: "idle", lastResult: "failed" });
  });

  test("the setup site refusing our token is an error, not an update", async () => {
    const w = world({ env: { ...ENV, SUPPORT_SYNC_TOKEN: "st_other_token_0123456789abcdef012345" } });
    const r = await checkAndUpdate({}, w.deps);
    expect(r).toMatchObject({ ok: false });
    expect(w.railway).toHaveLength(0);
  });

  test("after the restart: the new version reports ok; an overdue one is a failure", async () => {
    await setting(STATE_KEY, { phase: "deploying", from: "1.0.0", to: "1.1.0", startedAt: NIGHT.toISOString() });
    expect(await reconcileOnBoot({ APP_VERSION: "1.1.0" }, NIGHT)).toBe("ok");
    expect(await readUpdateState()).toMatchObject({ phase: "idle", lastResult: "ok" });
    expect(await actions()).toContain("updates.done");

    await setting(STATE_KEY, { phase: "deploying", from: "1.0.0", to: "1.1.0", startedAt: NIGHT.toISOString() });
    expect(await reconcileOnBoot({ APP_VERSION: "1.0.0" }, new Date(NIGHT.getTime() + 10 * 60_000))).toBe("waiting");
    expect(await reconcileOnBoot({ APP_VERSION: "1.0.0" }, new Date(NIGHT.getTime() + 90 * 60_000))).toBe("failed");
    expect(await readUpdateState()).toMatchObject({ phase: "idle", lastResult: "failed" });
    expect((await sql`select count(*)::int as n from incidents where kind = 'update_failed' and status = 'open'`)[0].n).toBe(1);

    // a later success closes the incident
    await setting(STATE_KEY, { phase: "deploying", from: "1.0.0", to: "1.2.0", startedAt: NIGHT.toISOString() });
    await reconcileOnBoot({ APP_VERSION: "1.2.0" }, NIGHT);
    expect((await sql`select count(*)::int as n from incidents where kind = 'update_failed' and status = 'open'`)[0].n).toBe(0);
  });
});

describe("Railway refusing the project token turns automatic updates off, and the manual Update keeps working", () => {
  // None of these calls has been made against real Railway with a project token (projectTokenCreate, the
  // Project-Access-Token header on /up, variableCollectionUpsert, deployment(id)). Whatever Railway answers, the
  // running version is untouched, auto-update turns itself off once (not every hour), Settings and the setup
  // site's admin say it's unavailable, and the setup link's "Update your agency" (the buyer's account token, not
  // this one) stays the way to update. A new project token from that turns it back on.
  const gqlRefused = (match: RegExp, message = "Not Authorized"): RailwayStandIn => (u, body) =>
    u.endsWith("/graphql/v2") && match.test(body.query ?? "") ? Response.json({ errors: [{ message }] }) : null;
  const offState = async () => (await readUpdateState()).off;

  const expectOff = async (w: World, why: RegExp) => {
    const off = await offState();
    expect(off?.token).toBe(tokenTag(ENV.RAILWAY_PROJECT_TOKEN));
    expect(off?.reason).toMatch(why);
    const st = await updatesStatus(ENV);
    expect(st).toMatchObject({ available: false, lastResult: "failed" });
    expect(st.unavailableReason).toMatch(why);
    expect(JSON.stringify(await readUpdateState())).not.toContain(ENV.RAILWAY_PROJECT_TOKEN); // a tag, never the token
    // the next hourly check, the owner's "Check and update now" and a push from the setup site all do nothing
    for (const o of [{}, { owner: true }, { force: true }]) {
      const again = world();
      expect(await checkAndUpdate(o, again.deps)).toEqual({ ok: true, started: false, reason: "unavailable" });
      expect(again.site).toHaveLength(0);
      expect(again.railway).toHaveLength(0);
    }
    // recorded for the owner and for us
    expect((await collectProblems()).some((p) => p.kind === "update_failed" && /unavailable/i.test(p.msg))).toBe(true);
    expect(w.railway.some((c) => JSON.stringify(c.body).includes(ENV.RAILWAY_PROJECT_TOKEN))).toBe(false);
  };

  test("variableCollectionUpsert refused: nothing uploaded, no label to put back, auto-update off", async () => {
    const w = world({ railway: gqlRefused(/variableCollectionUpsert/) });
    const r = await checkAndUpdate({}, w.deps);
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toContain("project token");
    expect(w.railway.filter((c) => c.url.includes("/up?"))).toHaveLength(0);
    expect(w.railway).toHaveLength(1); // the refused upsert only
    expect((await readUpdateState()).phase).toBe("idle");
    await expectOff(w, /version number.*project token/);
  });

  test("variableCollectionUpsert not understood for a project token (a schema or input error): off too", async () => {
    const w = world({ railway: (u, body) => (u.endsWith("/graphql/v2") && /variableCollectionUpsert/.test(body.query) ? new Response(JSON.stringify({ errors: [{ message: "Unknown argument skipDeploys" }] }), { status: 400 }) : null) });
    expect(await checkAndUpdate({}, w.deps)).toMatchObject({ ok: false });
    await expectOff(w, /error when setting the new version number/);
  });

  test("/up refuses the Project-Access-Token header (401): label put back, auto-update off", async () => {
    const w = world({ uploadStatus: 401 });
    expect(await checkAndUpdate({}, w.deps)).toMatchObject({ ok: false });
    const upserts = w.railway.filter((c) => c.body?.variables?.input?.variables);
    expect(upserts.map((c) => c.body.variables.input.variables.APP_VERSION)).toEqual(["1.1.0", "1.0.0"]);
    await expectOff(w, /sending the new version.*project token/);
  });

  test("/up answering something else (400, 500): off as well, the old version keeps running", async () => {
    for (const status of [400, 500]) {
      await sql`delete from app_settings where key = ${STATE_KEY}`;
      const w = world({ uploadStatus: status });
      expect(await checkAndUpdate({}, w.deps)).toMatchObject({ ok: false });
      expect(await readUpdateState()).toMatchObject({ phase: "idle", lastResult: "failed" });
      await expectOff(w, /sending the new version/);
    }
  });

  test("Railway can't be reached at all: a failure this time, but not turned off (tried again next hour)", async () => {
    const w = world();
    const railwayFetch = w.deps.railwayFetch!;
    w.deps.railwayFetch = (async (url: any, init: any) => {
      if (String(url).includes("/up?")) throw new TypeError("fetch failed");
      return railwayFetch(url, init);
    }) as unknown as typeof fetch;
    expect(await checkAndUpdate({}, w.deps)).toMatchObject({ ok: false });
    expect(await offState()).toBeUndefined();
    expect((await updatesStatus(ENV)).available).toBe(true);
    expect(await checkAndUpdate({}, world().deps)).toMatchObject({ ok: true, started: true });
  });

  test("deployment(id) refused: stops watching after three tries, off, and a new version that starts still says ok", async () => {
    await setting(STATE_KEY, { phase: "deploying", from: "1.0.0", to: "1.1.0", deploymentId: "dep-1", startedAt: new Date().toISOString() });
    const w = world({ railway: gqlRefused(/\bdeployment\(/), pollMs: 1 });
    await watchDeployment(updateConfig(ENV)!, "dep-1", "1.0.0", "1.1.0", w.deps);
    expect(w.railway.filter((c) => /\bdeployment\(/.test(c.body.query ?? ""))).toHaveLength(3);
    expect(w.railway.filter((c) => /variableCollectionUpsert/.test(c.body.query ?? ""))).toHaveLength(0); // we don't know it failed
    expect((await readUpdateState()).phase).toBe("deploying");
    expect((await offState())?.reason).toMatch(/checking the build.*project token/);
    expect((await updatesStatus(ENV)).available).toBe(false);
    // the new version boots: that's recorded, but it stays "failed" and off so the next manual update brings a new token
    expect(await reconcileOnBoot({ ...ENV, APP_VERSION: "1.1.0" })).toBe("ok");
    expect(await readUpdateState()).toMatchObject({ phase: "idle", lastResult: "failed" });
    expect((await updatesStatus({ ...ENV, APP_VERSION: "1.1.0" })).available).toBe(false);
  });

  test("deployment(id) busy for a moment (503) is waited out, not turned off", async () => {
    let n = 0;
    const w = world({
      pollMs: 1,
      railway: (_u, body) => {
        if (!/\bdeployment\(/.test(body.query ?? "")) return null;
        return ++n < 3 ? new Response("{}", { status: 503 }) : Response.json({ data: { deployment: { id: "dep-1", status: "SUCCESS" } } });
      },
    });
    await watchDeployment(updateConfig(ENV)!, "dep-1", "1.0.0", "1.1.0", w.deps);
    expect(n).toBe(3);
    expect(await offState()).toBeUndefined();
  });

  test("the manual Update gives a new project token: automatic updates are back on by themselves", async () => {
    await checkAndUpdate({}, world({ uploadStatus: 401 }).deps);
    // what makes the setup site's "Update your agency" make a new token: the heartbeat's lastResult "failed"
    expect(await updatesStatus(ENV)).toMatchObject({ available: false, lastResult: "failed" });
    const NEW = { ...ENV, RAILWAY_PROJECT_TOKEN: "ptok_fedcba9876543210" };
    expect(await updatesStatus(NEW)).toMatchObject({ available: true, unavailableReason: "" });
    const w = world({ env: NEW });
    expect(await checkAndUpdate({}, w.deps)).toEqual({ ok: true, started: true, version: "1.1.0" });
    expect(w.railway.find((c) => c.url.includes("/up?"))!.headers["Project-Access-Token"]).toBe(NEW.RAILWAY_PROJECT_TOKEN);
  });

  test("a copy without a project token says why, too", async () => {
    expect(await updatesStatus({ ...ENV, RAILWAY_PROJECT_TOKEN: "" })).toMatchObject({ available: false, unavailableReason: "no-token" });
    expect(await updatesStatus(ENV)).toMatchObject({ available: true, unavailableReason: "" });
  });

  test("an install that never reported back stops showing as being installed after an hour", async () => {
    const at = new Date();
    await setting(STATE_KEY, { phase: "deploying", from: "1.0.0", to: "1.1.0", startedAt: new Date(at.getTime() - 10 * 60_000).toISOString() });
    expect((await updatesStatus(ENV, at)).deploying).toBe(true);
    expect((await updatesStatus(ENV, new Date(at.getTime() + 2 * 3600_000))).deploying).toBe(false);
  });
});

describe("the owner's Updates settings", () => {
  test("on and overnight by default; the owner changes it; it is audited", async () => {
    expect(await updatesStatus()).toMatchObject({ enabled: true, mode: "overnight" });
    const res = await updatesRoute(put("/api/updates/settings", { enabled: true, mode: "asap" }), "PUT", "/api/updates/settings", owner());
    expect(((await res.json()) as any).mode).toBe("asap");
    await updatesRoute(put("/api/updates/settings", { enabled: false }), "PUT", "/api/updates/settings", owner());
    expect(await updatesStatus()).toMatchObject({ enabled: false, mode: "asap" });
    expect((await actions()).filter((a: string) => a === "updates.setting")).toHaveLength(2);
    const ignored = await updatesRoute(put("/api/updates/settings", { mode: "whenever" }), "PUT", "/api/updates/settings", owner());
    expect(((await ignored.json()) as any).mode).toBe("asap");
  });
  test("a team member, or anyone viewing (support included), can't change it", async () => {
    await expect(updatesRoute(put("/api/updates/settings", { enabled: false }), "PUT", "/api/updates/settings", owner({ role: "member" }))).rejects.toBeInstanceOf(AuthError);
    await expect(updatesRoute(put("/api/updates/settings", { enabled: false }), "PUT", "/api/updates/settings", owner({ role: "admin", viewing: { org: "x", client: null, business: "", support: true, canEdit: true } }))).rejects.toBeInstanceOf(AuthError);
    await expect(updatesRoute(post("/api/updates/check"), "POST", "/api/updates/check", owner({ viewing: { org: "x", client: null, business: "" } }))).rejects.toBeInstanceOf(AuthError);
    expect(await updatesStatus()).toMatchObject({ enabled: true });
  });
  test("Check and update now, as the owner, without a project token, says it can't", async () => {
    const res = await updatesRoute(post("/api/updates/check"), "POST", "/api/updates/check", owner());
    expect(((await res.json()) as any).result).toMatchObject({ ok: true, started: false, reason: "unavailable" });
  });
});

describe("the heartbeat carries problems and update state, and can be told to update now", () => {
  test("the snapshot has the new fields, whitelisted, scrubbed", async () => {
    await recordProblem("text_failed", "Text-back failed for +61412345678 (jane@example.com)");
    await sql`insert into incidents (kind, message, detail) values ('automations_apply', ${'Couldn\'t apply automation "Jane\'s Plumbing"'}, ${{ count: 4 } as any})`;
    const snap = await buildSnapshot();
    expect(() => assertWhitelisted(snap)).not.toThrow();
    const kinds = snap.problems.map((p: any) => p.kind).sort();
    expect(kinds).toEqual(["automations_apply", "text_failed"]);
    const text = JSON.stringify(snap);
    for (const secret of ["61412345678", "jane@example.com", "Jane", "Plumbing"]) expect(text).not.toContain(secret);
    expect(snap.problems.find((p: any) => p.kind === "automations_apply").count).toBe(4);
    expect(snap.updates).toMatchObject({ available: false, enabled: true, mode: "overnight" });
    expect(snap.support.edit).toBe(true);
  });
  test("an update failure shows in the heartbeat", async () => {
    await setting(STATE_KEY, { phase: "idle", lastResult: "failed", lastError: "the download's checksum didn't match", lastAt: NIGHT.toISOString() });
    const snap = await buildSnapshot();
    expect(snap.updates).toMatchObject({ lastResult: "failed", lastError: "the download's checksum didn't match", lastAt: NIGHT.toISOString() });
    expect(() => assertWhitelisted(snap)).not.toThrow();
  });
  test("the answer's updateNow is passed on; a plain answer isn't", async () => {
    const answer = (body: string) => (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    expect(await sendHeartbeat(answer(JSON.stringify({ ok: true, updateNow: true })))).toEqual({ sent: true, updateNow: true });
    expect(await sendHeartbeat(answer(JSON.stringify({ ok: true })))).toEqual({ sent: true });
    expect(await sendHeartbeat(answer("not json"))).toEqual({ sent: true });
    expect(await sendHeartbeat((async () => new Response("{}", { status: 500 })) as any)).toMatchObject({ sent: false, reason: "failed" });
  });
});

describe("support can make changes", () => {
  const openSession = async () => {
    await setting(ACCESS_KEY, { enabled: true, until: null });
    const t = (await issueLoginLink("https://app.example.com")).url.split("/").pop()!;
    return `twin_sid=${(await redeemLoginLink(t))!}`;
  };
  test("on by default: a support session may edit; read-only for a customer's view", async () => {
    const cookie = await openSession();
    const ctx = await sessionFrom(req("/", { headers: { cookie } }));
    expect(ctx?.viewing).toMatchObject({ support: true, canEdit: true, by: "Acme Setups" });
    expect(ctx?.role).toBe("admin");
    expect(readOnlyView(ctx!)).toBe(false);
    expect(ctx?.user.platformAdmin).toBe(false);
  });
  test("the owner turns it off: the same session becomes read only on its next request, audited", async () => {
    const cookie = await openSession();
    const res = await supportSettingsRoute(put("/api/support/settings", { edit: false }), "PUT", owner());
    expect(((await res.json()) as any).edit.enabled).toBe(false);
    const ctx = await sessionFrom(req("/", { headers: { cookie } }));
    expect(ctx?.viewing?.canEdit).toBe(false);
    expect(readOnlyView(ctx!)).toBe(true);
    expect(await actions()).toContain("support.edit_off");
    await supportSettingsRoute(put("/api/support/settings", { edit: true }), "PUT", owner());
    expect(await actions()).toContain("support.edit_on");
    expect((await sessionFrom(req("/", { headers: { cookie } })))?.viewing?.canEdit).toBe(true);
  });
  test("only the owner, and not while viewing, can change the switch", async () => {
    await expect(supportSettingsRoute(put("/api/support/settings", { edit: false }), "PUT", owner({ role: "admin" }))).rejects.toBeInstanceOf(AuthError);
    await expect(supportSettingsRoute(put("/api/support/settings", { edit: false }), "PUT", owner({ viewing: { org: "x", client: null, business: "", support: true, canEdit: true } }))).rejects.toBeInstanceOf(AuthError);
    const [r] = await sql`select value from app_settings where key = ${EDIT_KEY}`;
    expect(r).toBeUndefined();
  });
  test("what support did shows to the owner in Support activity", async () => {
    await sql`insert into audit_log (org_id, actor, action, detail) values (${orgId}, ${ownerId}, 'support.change', ${{ summary: "By support (Acme Setups): Changed automations (PUT /api/automations/:id)" } as any})`;
    const s = (await (await supportSettingsRoute(req("/api/support/settings"), "GET", owner())).json()) as any;
    expect(s.recent.map((r: any) => r.action)).toContain("support.change");
    expect(s.recent.find((r: any) => r.action === "support.change").summary).toContain("By support");
    expect(s.edit).toEqual({ enabled: true });
  });
});

describe("support sessions are allowed or blocked per the deny-by-default matrix (the gate server/index.ts runs)", () => {
  const ID = "0a1b2c3d-1111-2222-3333-444455556666";
  const ID2 = "9f8e7d6c-1111-2222-3333-444455556666";
  const ALLOWED: [string, string][] = [
    ["POST", "/api/clients"],
    ["PUT", `/api/clients/${ID}`],
    ["POST", `/api/clients/${ID}/numbers/attach`],
    ["PUT", `/api/automations/${ID}`],
    ["PUT", `/api/website-chat/${ID}`],
    ["PUT", `/api/manage/${ID}/receptionist`],
    ["DELETE", `/api/manage/${ID}/knowledge/${ID2}`],
    ["PUT", "/api/org/brand"],
    ["PUT", "/api/console/businesses/abc"],
  ];
  const DENIED: [string, string, RegExp][] = [
    ["PUT", "/api/phone-account", /keys/],
    ["PUT", "/api/twilio-account", /keys/],
    ["PUT", `/api/clients/${ID}/email`, /connections/],
    ["PUT", `/api/manage/${ID}/calendar`, /connections/],
    ["DELETE", `/api/clients/${ID}`, /deleting/],
    ["POST", "/api/team/invites", /owner/],
    ["PUT", "/api/account", /owner/],
    ["POST", "/api/password-reset", /owner/],
    ["PUT", "/api/support/settings", /Support settings/],
    ["PUT", "/api/updates/settings", /Updates settings/],
    ["POST", "/api/updates/check", /isn't something/],
    ["POST", "/api/admin/agencies", /isn't something/],
    ["POST", "/api/console/platform-admins", /platform admins/],
    ["POST", `/api/console/companies/${ID}/members`, /sharing/],
    ["POST", `/api/workspace/${ID}/export`, /exporting/],
    ["POST", "/api/billing/checkout", /billing/],
    ["POST", "/api/brand-new-route-nobody-listed", /isn't something/], // deny by default
  ];
  const supportCtx = async () => {
    await setting(ACCESS_KEY, { enabled: true, until: null });
    const t = (await issueLoginLink("https://app.example.com")).url.split("/").pop()!;
    const cookie = `twin_sid=${(await redeemLoginLink(t))!}`;
    return { cookie, ctx: async () => (await sessionFrom(req("/", { headers: { cookie } })))! };
  };
  const gate = (ctx: Ctx, m: string, p: string) => supportGate(ctx, m, p, "Acme Setups");

  test("default (changes on): the allowed list goes through and is audited, the denied list is refused, reads pass", async () => {
    const s = await supportCtx();
    const ctx = await s.ctx();
    expect(ctx.viewing).toMatchObject({ support: true, canEdit: true });
    for (const [m, p] of ALLOWED) {
      const g = gate(ctx, m, p);
      expect(g.action).toBe("audit");
      expect((g as any).summary).toStartWith("By support (Acme Setups): Changed ");
      expect((g as any).summary).not.toContain(ID);
    }
    for (const [m, p, why] of DENIED) {
      const g = gate(ctx, m, p);
      expect(g.action).toBe("deny");
      expect((g as any).error).toMatch(why);
    }
    for (const p of ["/api/phone-account", "/api/team", `/api/clients/${ID}/email`]) expect(gate(ctx, "GET", p)).toEqual({ action: "pass" });
    expect(gate(ctx, "POST", "/api/logout")).toEqual({ action: "pass" });
    expect(gate(ctx, "POST", "/api/admin/view-as")).toEqual({ action: "pass" });
  });

  test("the owner switches changes off: every write from the same session is refused, reads still pass", async () => {
    const s = await supportCtx();
    await supportSettingsRoute(put("/api/support/settings", { edit: false }), "PUT", owner());
    const ctx = await s.ctx();
    expect(ctx.viewing?.canEdit).toBe(false);
    for (const [m, p] of [...ALLOWED, ...DENIED.map(([m, p]) => [m, p] as [string, string])]) {
      const g = gate(ctx, m, p);
      expect(g.action).toBe("deny");
      expect((g as any).error).toContain("read-only");
    }
    expect(gate(ctx, "GET", "/api/console/overview")).toEqual({ action: "pass" });
  });

  test("support looking at one business's own view can't change anything there", async () => {
    const ctx = owner({ role: "admin", viewing: { org: "Test Agency", client: ID, business: "Alpha", support: true } });
    for (const [m, p] of ALLOWED) expect(gate(ctx, m, p).action).toBe("deny");
    // a stray canEdit on a business view is still read-only
    const odd = owner({ role: "admin", viewing: { org: "Test Agency", client: ID, business: "Alpha", support: true, canEdit: true } });
    expect(gate(odd, "PUT", `/api/clients/${ID}`).action).toBe("deny");
  });

  test("the owner switches Support access off: the session no longer signs in at all", async () => {
    const s = await supportCtx();
    await supportSettingsRoute(put("/api/support/settings", { access: { enabled: false } }), "PUT", owner());
    expect(await sessionFrom(req("/", { headers: { cookie: s.cookie } }))).toBeNull();
  });

  test("the owner and the team are never judged by the support matrix", async () => {
    for (const [m, p] of DENIED) expect(gate(owner(), m, p)).toEqual({ action: "pass" });
    // viewing as someone (not support) is handled by the read-only view rule further on
    expect(gate(owner({ viewing: { org: "x", client: null, business: "" } }), "PUT", "/api/phone-account")).toEqual({ action: "pass" });
  });
});

describe("Support access on by default for a fresh install", () => {
  test("without SUPPORT_ACCESS_DEFAULT it is off, as before", async () => {
    expect(accessOpen(await readAccess())).toBe(false);
    await expect(issueLoginLink("https://app.example.com")).rejects.toThrow();
  });
  test("with it, access is on until the owner chooses; the owner can switch it off and it stays off", async () => {
    process.env.SUPPORT_ACCESS_DEFAULT = "on";
    expect(accessOpen(await readAccess())).toBe(true);
    const s = (await (await supportSettingsRoute(req("/api/support/settings"), "GET", owner())).json()) as any;
    expect(s.access).toMatchObject({ enabled: true, until: null, isDefault: true });
    expect((await issueLoginLink("https://app.example.com")).expiresInSeconds).toBe(60);
    const heartbeat = await buildSnapshot();
    expect(heartbeat.support.access).toBe(true);

    await supportSettingsRoute(put("/api/support/settings", { access: { enabled: false } }), "PUT", owner());
    expect(accessOpen(await readAccess())).toBe(false);
    const off = (await (await supportSettingsRoute(req("/api/support/settings"), "GET", owner())).json()) as any;
    expect(off.access).toMatchObject({ enabled: false, isDefault: false });
    await expect(issueLoginLink("https://app.example.com")).rejects.toThrow();
  });
  test("an owner's earlier choice beats the default", async () => {
    process.env.SUPPORT_ACCESS_DEFAULT = "on";
    await setting(ACCESS_KEY, { enabled: false, until: null });
    expect(accessOpen(await readAccess())).toBe(false);
  });
});

describe("Fetch recent logs", () => {
  const PATH = "/api/support/logs";
  const call = (h: Record<string, string>) => supportPublicRoutes(post(PATH, h), PATH, "POST");
  test("needs the call token (the sync token and no token are refused)", async () => {
    await setting(ACCESS_KEY, { enabled: true, until: null });
    expect((await call({}))!.status).toBe(401);
    expect((await call({ authorization: `Bearer ${TOKEN}` }))!.status).toBe(401);
    expect((await supportPublicRoutes(req(PATH), PATH, "GET"))!.status).toBe(404);
  });
  test("refused while Support access is off, and that is audited", async () => {
    const res = await call({ authorization: `Bearer ${CALL}` });
    expect(res!.status).toBe(403);
    expect(((await res!.json()) as any).error).toBe("access_off");
    expect(await actions()).toContain("support.logs_refused");
    pushLog("log", "this must not leave");
  });
  test("with access on: the scrubbed ring, audited", async () => {
    await setting(ACCESS_KEY, { enabled: true, until: null });
    pushLog("error", "[texting a1] to +61412345678 failed for jane@example.com");
    pushLog("log", "all fine");
    const res = await call({ authorization: `Bearer ${CALL}` });
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.lines.map((l: any) => l.level)).toEqual(["error", "log"]);
    expect(JSON.stringify(body)).not.toContain("61412345678");
    expect(JSON.stringify(body)).not.toContain("jane@");
    expect(await actions()).toContain("support.logs");
  });
  test("works on a default-on install too", async () => {
    process.env.SUPPORT_ACCESS_DEFAULT = "on";
    expect((await call({ authorization: `Bearer ${CALL}` }))!.status).toBe(200);
  });
});
