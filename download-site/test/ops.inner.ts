// The checks for ops.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "ops-test-"));
const PORT = 47000 + Math.floor(Math.random() * 900);
const APP_PORT = PORT + 1000;
const RAIL_PORT = PORT + 2000;
const SITE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.SITE_URL = SITE;
process.env.RAILWAY_API_BASE = `http://127.0.0.1:${RAIL_PORT}`;
for (const k of ["MOCK_FAST", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "PREVIEW_JUMP", "ALERT_WEBHOOK_URL", "ALERT_EMAIL_TO", "SITE_SMTP_URL", "SITE_MAIL_FROM", "ADMIN_EMAILS"]) delete process.env[k];

const { addBuyer, db, recordPackage, PACKAGES_DIR, sha256 } = await import("../lib");
const sync = await import("../sync");
const rel = await import("../releases");
const alerts = await import("../alerts");
const setup = await import("../setup");
const { updateSetup } = await import("../store");
const { newAdminLink } = await import("../admin-web");

const good = (over: Record<string, any> = {}) => ({
  v: 1, sentAt: new Date().toISOString(), appVersion: "1.0.0", publicUrl: "https://app.acme.example",
  health: { ok: true, db: true, phoneKey: true, openIncidents: 0 },
  counts: { agencies: 1, clients: 3, receptionists: 4, numbers: 4, calls24h: 5, calls7d: 31, calls30d: 120, bookings7d: 6, errors24h: 0 },
  lastCallAt: new Date().toISOString(),
  brand: { name: "Acme AI", logoUrl: "https://app.acme.example/brand/abc" },
  extras: { email: true, domain: false, openRouter: true },
  support: { sharing: true, access: false, accessUntil: null, edit: true },
  updates: { available: true, enabled: true, mode: "overnight", latest: "", lastResult: "", lastError: "", lastAt: null },
  problems: [] as any[],
  ...over,
});
const problem = (kind: string, msg = "something failed", count = 2) => ({ kind, msg, count, last: new Date().toISOString() });
const live = (name: string) => {
  const b = addBuyer(name, `${name.toLowerCase().replace(/\W/g, "")}@example.com`);
  const { token } = sync.newSyncToken(b.id);
  updateSetup(b.id, (s) => { s.phase = "done"; s.step = "done"; s.brand = { productName: `${name} AI`, ownerEmail: "o@example.com", ownPhoneAccount: true }; s.resultUrl = `http://127.0.0.1:${APP_PORT}`; });
  return { b, token };
};

// ---- a published release: a bundle with the app's source inside ----
// (a real tar.gz: both the update bundle and the source download list its files before serving it)
const srcDir = join(dir, "src-1.2.3");
mkdirSync(srcDir, { recursive: true });
writeFileSync(join(srcDir, "package.json"), "{}");
writeFileSync(join(srcDir, "pad.bin"), crypto.getRandomValues(new Uint8Array(6000)));
if (Bun.spawnSync(["tar", "-czf", join(dir, "src-1.2.3.tgz"), "-C", srcDir, "."]).exitCode !== 0) throw new Error("tar failed");
const SRC = new Uint8Array(readFileSync(join(dir, "src-1.2.3.tgz")));
const SRC_SHA = createHash("sha256").update(SRC).digest("hex");
{
  const work = join(dir, "work");
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "app-src.tgz"), SRC);
  mkdirSync(PACKAGES_DIR, { recursive: true });
  const file = "agency-server-1.2.3.tgz";
  // A bare archive name with cwd: GNU tar (Git Bash) reads "C:\..." in -f as a remote host.
  const p = Bun.spawnSync(["tar", "-czf", file, "-C", work, "./app-src.tgz"], { cwd: PACKAGES_DIR });
  if (p.exitCode !== 0) throw new Error("tar failed");
  recordPackage({ version: "1.2.3", file, size: 1, sha256: "x", notes: "- faster dashboard\n- fixes" });
}

describe("releases", () => {
  test("the checksum is of the exact bytes the bundle address serves, and the notes come along", async () => {
    const r = (await rel.latestRelease())!;
    expect(r).toMatchObject({ version: "1.2.3", sha256: SRC_SHA, size: SRC.length });
    expect(r.notes).toContain("faster dashboard");
    expect(rel.sha256Hex(await rel.appSource())).toBe(SRC_SHA);
  });

  test("signed addresses: valid, tampered, expired, for another buyer or version", () => {
    const at = Date.now();
    const { url, expiresAt } = rel.signBundleUrl(7, "1.2.3", at);
    const q = new URL(url).searchParams;
    expect(new URL(url).pathname).toBe("/api/releases/bundle/1.2.3");
    expect(Date.parse(expiresAt) - at).toBeLessThanOrEqual(600_000);
    const ok = (b: number, v: string, exp: string, sig: string, when = at) => rel.bundleSignatureOk(b, v, exp, sig, when);
    expect(ok(7, "1.2.3", q.get("exp")!, q.get("sig")!)).toBe(true);
    expect(ok(8, "1.2.3", q.get("exp")!, q.get("sig")!)).toBe(false); // another buyer
    expect(ok(7, "1.2.4", q.get("exp")!, q.get("sig")!)).toBe(false); // another version
    expect(ok(7, "1.2.3", String(Number(q.get("exp")) + 3600), q.get("sig")!)).toBe(false); // longer life
    expect(ok(7, "1.2.3", q.get("exp")!, q.get("sig")!.slice(0, -1) + (q.get("sig")!.endsWith("A") ? "B" : "A"))).toBe(false);
    expect(rel.bundleSignatureOk(7, "1.2.3", q.get("exp")!, q.get("sig")!, at, "source")).toBe(false); // a bundle address isn't a source address
    const src = new URL(rel.signBundleUrl(7, "1.2.3", at, "source").url).searchParams;
    expect(rel.bundleSignatureOk(7, "1.2.3", src.get("exp")!, src.get("sig")!, at, "source")).toBe(true);
    expect(ok(7, "1.2.3", src.get("exp")!, src.get("sig")!)).toBe(false); // and a source address isn't a bundle address
    expect(ok(7, "1.2.3", q.get("exp")!, "short")).toBe(false);
    expect(ok(7, "1.2.3", "abc", q.get("sig")!)).toBe(false);
    expect(ok(7, "1.2.3", q.get("exp")!, q.get("sig")!, at + 11 * 60_000)).toBe(false); // expired
    // an address someone signed far into the future isn't accepted either
    const far = rel.signBundleUrl(7, "1.2.3", at + 3600_000);
    expect(ok(7, "1.2.3", new URL(far.url).searchParams.get("exp")!, new URL(far.url).searchParams.get("sig")!)).toBe(false);
  });
});

describe("push update now", () => {
  test("refused when the app can't or won't update itself; once asked, the next heartbeat's answer carries updateNow, once", () => {
    const { b, token } = live("Push Buyer");
    expect(sync.requestPush(b.id, "boss@example.com")).toEqual({ ok: false, reason: "unknown" });
    sync.receive(token, JSON.stringify(good({ updates: { ...good().updates, available: false } })));
    expect(sync.requestPush(b.id, "boss@example.com")).toEqual({ ok: false, reason: "unavailable" });
    sync.receive(token, JSON.stringify(good({ updates: { ...good().updates, enabled: false } })));
    expect(sync.requestPush(b.id, "boss@example.com")).toEqual({ ok: false, reason: "off" });
    sync.receive(token, JSON.stringify(good()));
    expect(sync.requestPush(b.id, "boss@example.com")).toEqual({ ok: true });
    expect(sync.pushPending(b.id)).toBe(true);
    expect(sync.receive(token, JSON.stringify(good())).body).toEqual({ ok: true, updateNow: true });
    expect(sync.receive(token, JSON.stringify(good())).body).toEqual({ ok: true });
    expect(sync.pushPending(b.id)).toBe(false);
  });
  test("a request that wasn't picked up within the hour is dropped, not sent late", () => {
    const { b, token } = live("Stale Push");
    sync.receive(token, JSON.stringify(good()));
    sync.requestPush(b.id, "x");
    expect(sync.takePush(b.id, Date.now() + 61 * 60_000)).toBe(false);
    expect(sync.pushPending(b.id)).toBe(false);
  });
  test("another buyer's request isn't sent to this one", () => {
    const a = live("Push A");
    const o = live("Push B");
    sync.receive(a.token, JSON.stringify(good()));
    sync.requestPush(a.b.id, "x");
    expect(sync.receive(o.token, JSON.stringify(good())).body).toEqual({ ok: true });
    expect(sync.pushPending(a.b.id)).toBe(true);
  });
});

describe("the heartbeat's arrays on the site", () => {
  test("the same shape as the app, problems kept (50 at most), nothing else", () => {
    const { b, token } = live("Arr Buyer");
    const dirty = good({ problems: Array.from({ length: 70 }, (_, i) => ({ ...problem("text_failed", `failed ${i}`), transcript: "hello" })), callerName: "Jane" });
    const r = sync.receive(token, JSON.stringify(dirty));
    expect(r.status).toBe(200);
    const st = sync.latestSnapshot(b.id)!;
    expect(st.snap.problems).toHaveLength(50);
    expect(JSON.stringify(st.snap)).not.toContain("hello");
    expect(JSON.stringify(st.snap)).not.toContain("Jane");
    expect(Object.keys(sync.cleanSnapshot(dirty)!).sort()).toEqual(Object.keys(sync.SHAPE).sort());
    expect(sync.cleanSnapshot(good({ problems: "nope" }))!.problems).toEqual([]);
    expect(sync.cleanSnapshot(good({ problems: [problem("x", "call jane@example.com or 0412 345 678")] }))!.problems[0].msg).toBe("");
  });
  test("a heartbeat with 50 problems fits under the size cap", () => {
    const { token } = live("Big Buyer");
    const body = JSON.stringify(good({ problems: Array.from({ length: 50 }, (_, i) => problem("text_failed", "x".repeat(190) + i)) }));
    expect(body.length).toBeLessThan(sync.MAX_SYNC_BODY);
    expect(sync.receive(token, body).status).toBe(200);
  });
});

describe("alerts", () => {
  const hooks: { url: string; body: any }[] = [];
  const mails: { smtp: string; mail: any }[] = [];
  const realFetch = alerts.alertDeps.fetch;
  const realMail = alerts.alertDeps.sendMail;
  beforeAll(() => {
    alerts.alertDeps.fetch = (async (url: any, init: any) => { hooks.push({ url: String(url), body: JSON.parse(init.body) }); return new Response("ok"); }) as any;
    alerts.alertDeps.sendMail = async (smtp, mail) => { mails.push({ smtp, mail }); };
  });
  afterAll(() => { alerts.alertDeps.fetch = realFetch; alerts.alertDeps.sendMail = realMail; delete process.env.ALERT_WEBHOOK_URL; delete process.env.SITE_SMTP_URL; });

  const snap = (over: Record<string, any> = {}) => sync.cleanSnapshot(good(over))!;

  test("what a heartbeat should alert about: new problem kinds, and a new update failure; nothing for the same again", () => {
    const none = snap();
    expect(alerts.heartbeatAlerts(none, snap())).toEqual([]);
    const a = alerts.heartbeatAlerts(none, snap({ problems: [problem("text_failed", "Text-back failed", 3), problem("text_failed", "another"), problem("provider_api")] }));
    expect(a.map((x) => x.kind)).toEqual(["problem:text_failed", "problem:provider_api"]);
    expect(a[0].message).toContain("Text-back failed");
    expect(alerts.heartbeatAlerts(snap({ problems: [problem("text_failed")] }), snap({ problems: [problem("text_failed", "different message")] }))).toEqual([]);
    expect(alerts.heartbeatAlerts(snap({ problems: [problem("text_failed")] }), snap({ problems: [problem("text_failed"), problem("booking_sync")] })).map((x) => x.kind)).toEqual(["problem:booking_sync"]);
    const failed = (at: string) => snap({ updates: { ...good().updates, lastResult: "failed", lastError: "checksum didn't match", lastAt: at } });
    expect(alerts.heartbeatAlerts(none, failed("2026-11-27T10:00:00.000Z")).map((x) => x.kind)).toEqual(["update_failed"]);
    expect(alerts.heartbeatAlerts(failed("2026-11-27T10:00:00.000Z"), failed("2026-11-27T10:00:00.000Z"))).toEqual([]); // the same failure again
    expect(alerts.heartbeatAlerts(failed("2026-11-27T10:00:00.000Z"), failed("2026-11-28T10:00:00.000Z")).map((x) => x.kind)).toEqual(["update_failed"]); // a new one
  });

  test("channels are used only if set: webhook (Slack/Discord-style text), email; history is kept either way", async () => {
    const { b } = live("Chan Buyer");
    const r0 = await alerts.raise(b.id, "no_heartbeat", "no heartbeat for 40 minutes");
    expect(r0).toEqual({ raised: true, sent: [] });
    expect(alerts.alertHistory(5, b.id)[0]).toMatchObject({ kind: "no_heartbeat", sent: "" });

    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/services/T/B/x";
    process.env.SITE_SMTP_URL = "smtps://u:p@smtp.example.com:465";
    process.env.SITE_MAIL_FROM = "alerts@us.example.com";
    process.env.ALERT_EMAIL_TO = "boss@us.example.com, ops@us.example.com";
    const r1 = await alerts.raise(b.id, "update_failed", "the automatic update failed: checksum");
    expect(r1.sent.sort()).toEqual(["email", "webhook"]);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].url).toBe("https://hooks.example.com/services/T/B/x");
    expect(hooks[0].body.text).toContain("Chan Buyer");
    expect(hooks[0].body.text).toContain("the automatic update failed");
    expect(hooks[0].body.text).toContain(`/admin/b/${b.id}`);
    expect(hooks[0].body.content).toBe(hooks[0].body.text); // Discord reads "content", Slack "text"
    expect(mails).toHaveLength(1);
    expect(mails[0].mail).toMatchObject({ from: "alerts@us.example.com", to: "boss@us.example.com, ops@us.example.com" });
    expect(mails[0].mail.text).toContain("checksum");
    expect(alerts.alertHistory(5, b.id)[0].sent).toContain("webhook");
  });

  test("an insecure or broken webhook address is never called; a failing channel doesn't stop the other", async () => {
    const { b } = live("Fail Buyer");
    process.env.ALERT_WEBHOOK_URL = "http://hooks.example.com/x"; // http, not https
    process.env.ALERT_EMAIL_TO = "boss@us.example.com";
    const n = hooks.length;
    expect((await alerts.raise(b.id, "no_heartbeat", "x")).sent).toEqual(["email"]);
    expect(hooks).toHaveLength(n);
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/x";
    alerts.alertDeps.sendMail = async () => { throw new Error("smtp down"); };
    expect((await alerts.raise(b.id, "update_failed", "x")).sent).toEqual(["webhook"]);
    alerts.alertDeps.sendMail = async (smtp, mail) => { mails.push({ smtp, mail }); };
  });

  test("one alert per agency per kind per hour", async () => {
    const a = live("Dedupe A");
    const o = live("Dedupe B");
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/x";
    const t0 = Date.now();
    hooks.length = 0;
    expect((await alerts.raise(a.b.id, "problem:text_failed", "one", t0)).raised).toBe(true);
    expect((await alerts.raise(a.b.id, "problem:text_failed", "two", t0 + 59 * 60_000)).raised).toBe(false); // same agency, same kind, within the hour
    expect((await alerts.raise(a.b.id, "problem:booking_sync", "three", t0 + 1000)).raised).toBe(true); // another kind
    expect((await alerts.raise(o.b.id, "problem:text_failed", "four", t0 + 1000)).raised).toBe(true); // another agency
    expect((await alerts.raise(a.b.id, "problem:text_failed", "five", t0 + 61 * 60_000)).raised).toBe(true); // an hour on
    expect(hooks).toHaveLength(4);
    expect(alerts.alertHistory(50, a.b.id).filter((x) => x.kind === "problem:text_failed")).toHaveLength(2);
  });

  test("a heartbeat with a new kind of problem raises one alert, and the same heartbeat again raises none", async () => {
    const { b, token } = live("Hook Buyer");
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/x";
    sync.receive(token, JSON.stringify(good()));
    hooks.length = 0;
    sync.receive(token, JSON.stringify(good({ problems: [problem("provider_api", "Telnyx answered 502")] })));
    sync.receive(token, JSON.stringify(good({ problems: [problem("provider_api", "Telnyx answered 502")] })));
    await Bun.sleep(100);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].body.text).toContain("provider_api");
    expect(alerts.alertHistory(10, b.id).map((x) => x.kind)).toEqual(["problem:provider_api"]);
  });

  test("silence: 30 minutes quiet and the app doesn't answer = alert; owner turned sharing off = no alert; recent = nothing", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/x";
    const quiet = live("Quiet Buyer");
    const off = live("Off Buyer");
    const fresh = live("Fresh Buyer");
    const old = (id: number, mins: number) => db().query("UPDATE sync_snapshots SET received_at = ? WHERE buyer_id = ?").run(new Date(Date.now() - mins * 60_000).toISOString(), id);
    for (const x of [quiet, off, fresh]) sync.receive(x.token, JSON.stringify(good()));
    old(quiet.b.id, 45);
    old(off.b.id, 45);
    old(fresh.b.id, 10);
    const probed: number[] = [];
    const probe = (async (id: number) => { probed.push(id); return id === off.b.id ? "sharing-off" : "unreachable"; }) as unknown as typeof sync.probeApp;
    hooks.length = 0;
    const r1 = await alerts.checkSilence(Date.now(), probe);
    expect(r1.filter((x) => [quiet.b.id, off.b.id, fresh.b.id].includes(x.buyerId))).toEqual([{ buyerId: quiet.b.id, result: "unreachable" }, { buyerId: off.b.id, result: "sharing-off" }].filter((x) => probed.includes(x.buyerId)));
    expect(probed).toContain(quiet.b.id);
    expect(probed).not.toContain(fresh.b.id);
    const mine = alerts.alertHistory(100).filter((a) => [quiet.b.id, off.b.id, fresh.b.id].includes(a.buyer_id));
    expect(mine.map((a) => [a.buyer_id, a.kind])).toEqual([[quiet.b.id, "no_heartbeat"]]);
    expect(mine[0].message).toContain("doesn't answer");
    // the next tick (five minutes on): no second probe or alert for the same agency; the one that turned sharing off is left alone
    probed.length = 0;
    await alerts.checkSilence(Date.now() + 5 * 60_000, probe);
    expect(probed).not.toContain(quiet.b.id);
    expect(probed).not.toContain(off.b.id);
    expect(alerts.alertHistory(100).filter((a) => a.buyer_id === quiet.b.id)).toHaveLength(1);
    // when its heartbeat comes back, the "sharing off" note is cleared
    sync.receive(off.token, JSON.stringify(good()));
    expect(db().query("SELECT 1 FROM sync_off WHERE buyer_id = ?").get(off.b.id)).toBeNull();
  });

  test("silence with the app up says its heartbeat is stuck; revoked and test buyers are never alerted about", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/x";
    const up = live("Stuck Buyer");
    const rev = live("Revoked Buyer");
    const demo = addBuyer("Demo Quiet", "demoquiet@example.com", true);
    sync.newSyncToken(demo.id);
    for (const x of [up, rev]) sync.receive(x.token, JSON.stringify(good()));
    sync.storeSnapshot(demo.id, sync.cleanSnapshot(good())!);
    db().query("UPDATE buyers SET revoked_at = ? WHERE id = ?").run(new Date().toISOString(), rev.b.id);
    db().query("UPDATE sync_snapshots SET received_at = ? WHERE buyer_id IN (?, ?, ?)").run(new Date(Date.now() - 90 * 60_000).toISOString(), up.b.id, rev.b.id, demo.id);
    const ids: number[] = [];
    await alerts.checkSilence(Date.now(), (async (id: number) => (ids.push(id), "alive")) as any);
    expect(ids).toContain(up.b.id);
    expect(ids).not.toContain(rev.b.id);
    expect(ids).not.toContain(demo.id);
    expect(alerts.alertHistory(5, up.b.id)[0].message).toContain("stuck");
  });
});

// ---- the real server, a pretend buyer's app, and a pretend Railway ----
let server: ReturnType<typeof Bun.spawn> | null = null;
let app: ReturnType<typeof Bun.serve> | null = null;
let railway: ReturnType<typeof Bun.serve> | null = null;
const appSeen: { path: string; auth: string }[] = [];
const railSeen: { query: string; auth: string; ptok: string }[] = [];
let appAccess = true;
let railMode: "ok" | "deny" = "ok";

beforeAll(async () => {
  app = Bun.serve({
    port: APP_PORT, hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      appSeen.push({ path, auth: req.headers.get("authorization") || "" });
      if (path === "/api/support/logs") return appAccess ? Response.json({ ok: true, lines: [{ at: "2026-11-27T10:00:00.000Z", level: "error", line: "[texting a1] to [number] failed <b>x</b>" }, { at: "2026-11-27T10:00:01.000Z", level: "log", line: "all fine" }] }) : Response.json({ ok: false, error: "access_off" }, { status: 403 });
      if (path === "/api/support/ping") return Response.json({ ok: true, sharing: true, snapshot: good() });
      return new Response("no", { status: 404 });
    },
  });
  railway = Bun.serve({
    port: RAIL_PORT, hostname: "127.0.0.1",
    async fetch(req) {
      const j: any = await req.json().catch(() => ({}));
      railSeen.push({ query: String(j.query || ""), auth: req.headers.get("authorization") || "", ptok: req.headers.get("project-access-token") || "" });
      if (railMode === "deny") return Response.json({ errors: [{ message: "Not Authorized" }] });
      if (String(j.query).includes("projectTokenCreate")) return Response.json({ data: { projectTokenCreate: `ptok-${"z".repeat(30)}` } });
      return Response.json({ data: {} });
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
afterAll(() => { server?.kill(); app?.stop(true); railway?.stop(true); });

describe("GET /api/releases/latest and the bundle, on the real site", () => {
  test("needs the app's sync token; answers with the version, checksum and a signed address", async () => {
    const { b, token } = live("Rel Buyer");
    const get = (t: string | null) => fetch(`${SITE}/api/releases/latest`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
    expect((await get(null)).status).toBe(401);
    expect((await get("st_" + "z".repeat(43))).status).toBe(401);
    expect((await get(sync.callToken(b.id))).status).toBe(401); // the call token isn't a way in here
    expect((await fetch(`${SITE}/api/releases/latest`, { method: "POST", headers: { authorization: `Bearer ${token}` } })).status).toBe(405);
    const res = await get(token);
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j).toMatchObject({ version: "1.2.3", sha256: SRC_SHA, size: SRC.length });
    expect(j.notes).toContain("faster dashboard");
    expect(j.bundleUrl.startsWith(`${SITE}/api/releases/bundle/1.2.3?`)).toBe(true);
    // The signed address downloads the exact bytes whose checksum we gave...
    const dl = await fetch(j.bundleUrl);
    expect(dl.status).toBe(200);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(j.sha256);
    // ...and nothing else works.
    const u = new URL(j.bundleUrl);
    const bad = (mut: (q: URLSearchParams) => void) => { const c = new URL(j.bundleUrl); mut(c.searchParams); return fetch(c); };
    expect((await bad((q) => q.set("sig", "A".repeat(43)))).status).toBe(403);
    expect((await bad((q) => q.set("b", String(b.id + 1)))).status).toBe(403);
    expect((await bad((q) => q.delete("sig"))).status).toBe(403);
    expect((await fetch(`${SITE}/api/releases/bundle/1.2.3`)).status).toBe(403);
    const old = rel.signBundleUrl(b.id, "1.2.3", Date.now() - 11 * 60_000).url;
    expect((await fetch(old)).status).toBe(403);
    const other = rel.signBundleUrl(b.id, "0.0.1").url; // signed, but not the current release
    expect((await fetch(other)).status).toBe(404);
    db().query("UPDATE buyers SET revoked_at = ? WHERE id = ?").run(new Date().toISOString(), b.id);
    expect((await fetch(j.bundleUrl)).status).toBe(404);
    expect(u.search).not.toContain(token);
  });
});

describe("the project token, at install and at update", () => {
  test("a project token for this one project and environment, handed to the app with its ids; nothing kept", async () => {
    railSeen.length = 0;
    railMode = "ok";
    const { b } = live("Tok Buyer");
    const v = await setup.autoUpdateVars(b.id, "ACCOUNT-TOKEN", { projectId: "proj1", environmentId: "env1", serviceId: "svc1" });
    expect(v).toEqual({ RAILWAY_PROJECT_TOKEN: `ptok-${"z".repeat(30)}`, AUTOUPDATE_PROJECT_ID: "proj1", AUTOUPDATE_ENVIRONMENT_ID: "env1", AUTOUPDATE_SERVICE_ID: "svc1" });
    expect(railSeen[0].query).toContain("projectTokenCreate");
    expect(railSeen[0].auth).toBe("Bearer ACCOUNT-TOKEN");
    expect(railSeen[0].ptok).toBe("");
    // We don't keep it: not in any table.
    for (const t of ["buyers", "setups", "secrets", "sync_tokens", "sync_snapshots", "support_log", "alerts"]) expect(JSON.stringify(db().query(`SELECT * FROM ${t}`).all())).not.toContain("zzzzzzzzzz");
  });
  test("when Railway won't make one, the install carries on with no variables (the buyer presses Update as before)", async () => {
    railMode = "deny";
    const { b } = live("Deny Buyer");
    expect(await setup.autoUpdateVars(b.id, "ACCOUNT-TOKEN", { projectId: "proj1", environmentId: "env1", serviceId: "svc1" })).toEqual({});
    expect(await setup.autoUpdateVars(b.id, "ACCOUNT-TOKEN", { projectId: "proj1" })).toEqual({});
    railMode = "ok";
  });
  test("Update your agency mints a new project token when there is none, the last automatic update failed, or the heartbeat says unavailable", () => {
    const snap = (u: { available: boolean; lastResult?: string | null }) => ({ snap: { updates: u } });
    const has = { RAILWAY_PROJECT_TOKEN: "ptok-old" };
    expect(setup.needsProjectToken({}, null)).toBe(true);
    expect(setup.needsProjectToken({}, snap({ available: true }))).toBe(true);
    expect(setup.needsProjectToken(has, null)).toBe(false); // nothing heard yet: keep the one it has
    expect(setup.needsProjectToken(has, snap({ available: true, lastResult: "ok" }))).toBe(false);
    expect(setup.needsProjectToken(has, snap({ available: true, lastResult: "failed" }))).toBe(true);
    expect(setup.needsProjectToken(has, snap({ available: false }))).toBe(true);
    expect(setup.needsProjectToken(has, snap({ available: false, lastResult: null }))).toBe(true);
  });
  test("Support access starts on only for a fresh install: the update hook never sets it", () => {
    const fresh = setup.updateVarHooks.flatMap((h) => Object.keys(h(1, {})));
    expect(fresh).not.toContain("SUPPORT_ACCESS_DEFAULT");
    expect(fresh).not.toContain("RAILWAY_PROJECT_TOKEN");
    expect(Bun.file(join(import.meta.dir, "..", "setup.ts")).size).toBeGreaterThan(0);
  });
});

describe("the admin pages", () => {
  let cookie = "";
  let csrf = "";
  const adminGet = (path: string) => fetch(`${SITE}${path}`, { headers: { cookie }, redirect: "manual" });
  const adminPost = (path: string, form: Record<string, string> = {}) =>
    fetch(`${SITE}${path}`, { method: "POST", redirect: "manual", headers: { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: csrf, ...form }) });
  let ids = { ok: 0, off: 0, none: 0 };

  test("sign in; the list shows version and auto-update state, and a red problems badge", async () => {
    const link = newAdminLink("boss@example.com");
    const res = await fetch(link.replace(/^https?:\/\/[^/]+/, SITE), { method: "POST", redirect: "manual", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: "" });
    cookie = (res.headers.get("set-cookie") || "").split(";")[0];
    const a = live("Alpha Agency");
    const o = live("Bravo Agency");
    const n = live("Charlie Agency");
    ids = { ok: a.b.id, off: o.b.id, none: n.b.id };
    sync.receive(a.token, JSON.stringify(good({ appVersion: "1.0.0", problems: [problem("text_failed", "Text-back failed", 3), problem("provider_api", "Telnyx answered 502", 1)] })));
    sync.receive(o.token, JSON.stringify(good({ updates: { ...good().updates, enabled: false } })));
    sync.receive(n.token, JSON.stringify(good({ updates: { ...good().updates, available: false } })));
    const html = await (await adminGet("/admin")).text();
    csrf = html.match(/name="t" value="([^"]+)"/)![1];
    const row = (name: string) => html.slice(html.indexOf(name), html.indexOf("</tr>", html.indexOf(name)));
    expect(row("Alpha Agency")).toContain("Auto-update on (overnight 2-4am)");
    expect(row("Alpha Agency")).toContain("1.2.3 waiting");
    expect(row("Alpha Agency")).toContain("2 problems");
    expect(row("Alpha Agency")).toContain('class="pill failed"');
    expect(row("Bravo Agency")).toMatch(/Auto-update off \(the owner(&#39;|')s choice\)/);
    expect(row("Charlie Agency")).toMatch(/Auto-update unavailable — (buyer|agency) must press Update/);
    expect(row("Bravo Agency")).not.toContain("problem");
  });

  test("the buyer page: the Problems panel, auto-update state, and Push update now (only when it can work)", async () => {
    const a = await (await adminGet(`/admin/b/${ids.ok}?tab=support`)).text();
    expect(a).toContain("Problems (last 24 hours)");
    // "Send owner their login" is on the Support tab of a live agency (email it, or show the link)
    expect(a).toContain(`action="/admin/b/${ids.ok}/assist/owner-login"`);
    expect(a).toContain("Send owner their login");
    expect(a).toContain("Show me the link");
    expect(a).toContain("Text-back failed");
    expect(a).toContain("Telnyx answered 502");
    expect(a).toContain(`action="/admin/b/${ids.ok}/push-update"`);
    expect(a).toContain("Fetch recent logs");
    const o = await (await adminGet(`/admin/b/${ids.off}?tab=support`)).text();
    expect(o).toContain("The owner turned automatic updates off");
    expect(o).not.toContain(`/admin/b/${ids.off}/push-update"`);
    const n = await (await adminGet(`/admin/b/${ids.none}?tab=support`)).text();
    expect(n).toMatch(/(buyer|agency) presses Update on their setup link/);
  });

  test("Push update now: queued, shown as requested, handed to the next heartbeat once; refused when the owner has it off", async () => {
    expect((await adminPost(`/admin/b/${ids.off}/push-update`)).headers.get("location")).toContain("m=push-off");
    expect((await adminPost(`/admin/b/${ids.none}/push-update`)).headers.get("location")).toContain("m=push-unavailable");
    expect((await adminPost(`/admin/b/${ids.ok}/push-update`)).headers.get("location")).toContain("m=push-ok");
    expect(await (await adminGet(`/admin/b/${ids.ok}?tab=support`)).text()).toContain("Update requested");
    const tok = (await import("../sync")).latestSnapshot(ids.ok); // snapshot exists; the token was returned by live()
    expect(tok).not.toBeNull();
    expect(sync.supportLog(ids.ok, 5).map((l) => l.action + ":" + l.note)).toContain("push-update:requested");
    expect((await adminPost(`/admin/b/${ids.ok}/push-update`, { t: "wrong" })).status).toBe(403);
  });

  test("Fetch recent logs: asks the app with our call token, shows the scrubbed lines, stores nothing", async () => {
    appAccess = true;
    appSeen.length = 0;
    const r = await adminPost(`/admin/b/${ids.ok}/logs`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("[texting a1] to [number] failed");
    expect(html).toContain("all fine");
    expect(html).not.toContain("<b>x</b>"); // shown as text, not markup
    expect(html).toContain("&lt;b&gt;");
    expect(appSeen[0]).toEqual({ path: "/api/support/logs", auth: `Bearer ${sync.callToken(ids.ok)}` });
    expect(sync.supportLog(ids.ok, 5).map((l) => l.action + ":" + l.note)).toContain("fetch-logs:2 lines");
    for (const t of ["support_log", "alerts", "sync_snapshots"]) expect(JSON.stringify(db().query(`SELECT * FROM ${t}`).all())).not.toContain("all fine");
    appAccess = false;
    expect((await adminPost(`/admin/b/${ids.ok}/logs`)).headers.get("location")).toContain("m=logs-off");
    expect((await adminPost(`/admin/b/${ids.ok}/logs`, { t: "wrong" })).status).toBe(403);
  });

  test("the logs call: auth, the app's refusal, odd answers", async () => {
    const b = live("Logs Buyer").b;
    const fake = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const APP = "https://app.acme.example";
    const ok: any = await sync.fetchLogs(b.id, APP, fake(200, { ok: true, lines: [{ at: "t", level: "log", line: "x".repeat(900) }, { nope: 1 }] }));
    expect(ok.ok).toBe(true);
    expect(ok.lines).toHaveLength(1);
    expect(ok.lines[0].line.length).toBe(300);
    expect(await sync.fetchLogs(b.id, APP, fake(403, { error: "access_off" }))).toMatchObject({ ok: false, reason: "off" });
    expect(await sync.fetchLogs(b.id, APP, fake(404, {}))).toMatchObject({ ok: false, reason: "refused" });
    expect(await sync.fetchLogs(b.id, "", fake(200, {}))).toMatchObject({ ok: false, reason: "no-app" });
    expect(await sync.fetchLogs(b.id, APP, (async () => { throw new Error("x"); }) as any)).toMatchObject({ ok: false, reason: "unreachable" });
    expect(await sync.fetchLogs(addBuyer("Old", "old@example.com").id, APP, fake(200, {}))).toMatchObject({ ok: false, reason: "no-app" });
  });

  test("the Problems page lists every agency's problems; the Alerts page lists what we raised", async () => {
    const p = await (await adminGet("/admin/problems")).text();
    expect(p).toContain("Alpha Agency");
    expect(p).toContain("Text-back failed");
    expect(p).not.toContain("Bravo Agency</b>");
    await alerts.raise(ids.ok, "problem:text_failed", "a new kind of problem, \"text_failed\"");
    const a = await (await adminGet("/admin/alerts")).text();
    expect(a).toContain("problem:text_failed");
    expect(a).toContain("Alpha Agency");
    expect((await fetch(`${SITE}/admin/problems`, { redirect: "manual" })).status).not.toBe(200); // signed out: no
  });
});

// ---- "Download your full source code": the source of the version an agency runs, with no keys in it ----
describe("source download", () => {
  const publish = (version: string, files: Record<string, string>) => {
    const w = join(dir, `src-${version}`);
    mkdirSync(w, { recursive: true });
    // A real source is far bigger than a thousand bytes (the app refuses smaller ones as damaged).
    writeFileSync(join(w, "pad.bin"), crypto.getRandomValues(new Uint8Array(4000)));
    for (const [name, text] of Object.entries(files)) { mkdirSync(join(w, name, ".."), { recursive: true }); writeFileSync(join(w, name), text); }
    const appSrc = `app-src-${version}.tgz`;
    if (Bun.spawnSync(["tar", "-czf", join(dir, appSrc), "-C", w, "."]).exitCode !== 0) throw new Error("tar failed");
    const work = join(dir, `bundle-${version}`);
    mkdirSync(work, { recursive: true });
    copyFileSync(join(dir, appSrc), join(work, "app-src.tgz"));
    const file = `agency-server-${version}.tgz`;
    if (Bun.spawnSync(["tar", "-czf", file, "-C", work, "./app-src.tgz"], { cwd: PACKAGES_DIR }).exitCode !== 0) throw new Error("tar failed");
    recordPackage({ version, file, size: 1, sha256: "x" });
  };
  const cleanup = (...versions: string[]) => { for (const v of versions) db().query("DELETE FROM packages WHERE version = ?").run(v); };

  test("what counts as a secret", () => {
    expect(rel.secretNamesIn(["./package.json", "./server/index.ts", "./.env.example", "./deploy/Dockerfile", "./src/env.ts"])).toEqual([]);
    expect(rel.secretNamesIn(["./.env", "./a/.env.local", "./keys/server.pem", "./.secrets/x", "./secrets.env", "./id_rsa", "./x/private.key", "./.npmrc"]).length).toBe(8);
    expect(rel.secretNamesIn(["./prod.env", "./.netrc", "./home/.pgpass", "./.aws/credentials", "./.git/config", "./data/app.sqlite", "./x.db", "./release.jks", "./service-account-prod.json", "./gcp/service_account.json", "./api.token", "./old/backup.tgz", "./a.zip", "./b.tar.gz", "./b.gz", "./.ssh/id_ed25519"]).length).toBe(16);
    expect(rel.secretNamesIn(["./.env.example", "./.github/workflows/x.yml", "./.gitignore", "./src/lib/db.ts", "./token.ts", "./docs/tokens.md", "./src/service-accounts.ts"])).toEqual([]);
  });

  test("the app asks with its sync token for the version it runs; the signed link serves a clean source, only that version, only once signed", async () => {
    publish("9.0.0", { "package.json": '{"name":"app","version":"9.0.0"}', "server/index.ts": "export {}\n", ".env.example": "X=\n" });
    try {
      const { b, token } = live("Src Buyer");
      const ask = (t: string | null, v = "9.0.0") => fetch(`${SITE}/api/releases/source-link?version=${v}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
      expect((await ask(null)).status).toBe(401);
      expect((await ask(sync.callToken(b.id))).status).toBe(401);
      expect((await ask(token, "0.0.1")).status).toBe(404);
      expect((await ask(token, "../x")).status).toBe(404);
      const res = await ask(token);
      expect(res.status).toBe(200);
      const j: any = await res.json();
      expect(j.version).toBe("9.0.0");
      expect(j.url.startsWith(`${SITE}/api/releases/source/9.0.0?`)).toBe(true);
      expect(j.url).not.toContain(token);
      const dl = await fetch(j.url);
      if (dl.status !== 200) throw new Error(`${dl.status} ${await dl.text()}`);
      expect(dl.headers.get("content-disposition")).toContain("source-9.0.0.tar.gz");
      const out = join(dir, "got-9.0.0.tgz");
      writeFileSync(out, new Uint8Array(await dl.arrayBuffer()));
      const list = Bun.spawnSync(["tar", "-tzf", out]).stdout.toString();
      expect(list).toContain("package.json");
      expect(list).toContain("server/index.ts");
      expect(list).not.toMatch(/(^|\/)\.env$/m);
      // A changed signature, no signature, an old signature, another buyer's: all refused.
      const c = new URL(j.url);
      for (const mut of [(q: URLSearchParams) => q.set("sig", "A".repeat(43)), (q: URLSearchParams) => q.delete("sig"), (q: URLSearchParams) => q.set("b", String(b.id + 1))]) {
        const x = new URL(j.url); mut(x.searchParams);
        expect((await fetch(x)).status).toBe(403);
      }
      expect((await fetch(rel.signBundleUrl(b.id, "9.0.0", Date.now() - 11 * 60_000, "source").url.replace("/bundle/", "/source/"))).status).toBe(403);
      expect(c.pathname).toBe("/api/releases/source/9.0.0");
    } finally { cleanup("9.0.0"); }
  });

  test("a bundle that holds a settings file or key is never served", async () => {
    publish("9.0.1", { "package.json": "{}", ".env": "TELNYX_API_KEY=KEYsecret\n", "server/a.ts": "x" });
    try {
      const { b } = live("Src Leak");
      const r = await fetch(rel.signBundleUrl(b.id, "9.0.1", Date.now(), "source").url.replace("/bundle/", "/source/"));
      expect(r.status).toBe(503);
      const text = await r.text();
      expect(text).not.toContain("KEYsecret");
      expect(text).toMatch(/can't be offered/);
      // The update bundle (the current release) gets the same check.
      const u = await fetch(rel.signBundleUrl(b.id, "9.0.1").url);
      expect(u.status).toBe(503);
      expect(await u.text()).not.toContain("KEYsecret");
      // A source address is no use as a bundle address, and the other way round.
      expect((await fetch(rel.signBundleUrl(b.id, "9.0.1", Date.now(), "source").url)).status).toBe(403);
      expect((await fetch(rel.signBundleUrl(b.id, "9.0.1").url.replace("/bundle/", "/source/"))).status).toBe(403);
    } finally { cleanup("9.0.1"); }
  });

  test("the Done screen's button goes to the source of the version that agency installed (the setup code is the login)", async () => {
    publish("9.0.2", { "package.json": "{}" });
    try {
      const { b } = live("Src Done");
      updateSetup(b.id, (s) => { s.attemptVersion = "9.0.2"; });
      const r = await fetch(`${SITE}/setup/${b.code}/source`, { redirect: "manual" });
      expect([302, 303]).toContain(r.status);
      expect(r.headers.get("location")).toContain("/api/releases/source/9.0.2?");
      expect((await fetch(`${SITE}/setup/${b.code.slice(0, -1)}x/source`, { redirect: "manual" })).status).toBeGreaterThanOrEqual(400);
      updateSetup(b.id, (s) => { s.attemptVersion = "0.0.1"; });
      expect((await fetch(`${SITE}/setup/${b.code}/source`, { redirect: "manual" })).status).toBe(404);
    } finally { cleanup("9.0.2"); }
  });
});
