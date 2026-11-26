import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthError, requireRole, type Ctx } from "./accounts";
import { audit } from "./audit";
import { sql } from "./db";
import { recordIncident, resolveIncidents } from "./incidents";
import { recordProblem, scrub } from "./problems";
import { RailwayError, deploymentStatus, railwayUpload, setServiceVariables, type RailwayAuth, type RailwayFetch } from "./railwayUp";
import { json, readBody } from "./routes/http";
import { putSetting } from "./store";

// Automatic updates (Settings, "Updates"). Each agency runs in the buyer's own Railway account. At install (and
// at the next manual "Update your agency") the setup site makes a Railway PROJECT token, scoped to that one
// project, and gives it to the app as RAILWAY_PROJECT_TOKEN (the setup site does not keep it). With it the app can
// update itself:
//   1. once an hour it asks the setup site for the newest release (GET /api/releases/latest, with its sync token)
//   2. if the owner's switch is on, and it is the right time ("overnight 2-4am local" or "as soon as available"),
//      it downloads the bundle from a short-lived signed address, checks its SHA-256, sets APP_VERSION and uploads
//      the source to its own service, which Railway rebuilds and swaps in. A failed build leaves this version running.
//   3. the new version reports "ok" in its first heartbeat; a failure is recorded as an incident and a problem.
// The owner's switch is respected always, including a "push update now" from the setup site's admin.
// A copy without the project token (older install, or Railway wouldn't make one) says so, and the buyer presses
// "Update your agency" on their setup link as before.
//
// Not yet proven against real Railway: whether a project token is accepted by variableCollectionUpsert, by the
// /up upload (Project-Access-Token header) and by deployment(id). So a refusal from Railway on any of those calls
// turns automatic updates OFF for that token ("Auto-update unavailable" in Settings and in the setup site's admin),
// once, instead of retrying every hour. The manual "Update your agency" on the setup link doesn't use this token and
// keeps working. It also gives the app a new project token (it does when the last result was "failed"), and a new
// token turns automatic updates back on by itself.

export const SETTING_KEY = "auto_update";
export const STATE_KEY = "auto_update_state";
export const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;
const CHECK_MS = 60 * 60_000;
const DEPLOY_TIMEOUT_MS = 60 * 60_000;

export type Mode = "overnight" | "asap";
export type UpdateSetting = { enabled: boolean; mode: Mode; changedAt?: string; by?: string };
export type UpdateState = {
  phase: "idle" | "deploying";
  from?: string;
  to?: string;
  deploymentId?: string;
  startedAt?: string;
  latest?: string;
  checkedAt?: string;
  lastResult?: "ok" | "failed" | "";
  lastError?: string;
  lastAt?: string;
  /** Railway refused the project token on one of the update calls: automatic updates are off for THIS token.
   *  `token` is a short SHA-256 tag of it (never the token), so a new token from the setup site re-arms it. */
  off?: { token: string; reason: string; at: string };
};

export const DEFAULT_SETTING: UpdateSetting = { enabled: true, mode: "overnight" };
export const normaliseSetting = (v: Partial<UpdateSetting> | null | undefined): UpdateSetting => ({
  enabled: v?.enabled !== false,
  mode: v?.mode === "asap" ? "asap" : "overnight",
  ...(v?.changedAt ? { changedAt: v.changedAt } : {}),
  ...(v?.by ? { by: v.by } : {}),
});

async function read<T>(key: string): Promise<T | null> {
  const [r] = await sql`select value from app_settings where key = ${key}`;
  return (r?.value as T) ?? null;
}
export const readUpdateSetting = async () => normaliseSetting(await read<UpdateSetting>(SETTING_KEY));
export const readUpdateState = async (): Promise<UpdateState> => (await read<UpdateState>(STATE_KEY)) ?? { phase: "idle" };
const saveState = async (patch: Partial<UpdateState>) => putSetting(STATE_KEY, { ...(await readUpdateState()), ...patch });

// ---------------------------------------------------------------------------------------------
// What the app can do (its own environment)
// ---------------------------------------------------------------------------------------------

export type Cfg = { auth: RailwayAuth; projectId: string; environmentId: string; serviceId: string; siteBase: string; syncToken: string };
/** A short tag for a token, to tell one from another without keeping it. */
export const tokenTag = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 16);
/** True when automatic updates turned themselves off for the token this copy has now. */
export const offForToken = (cfg: Cfg | null, state: UpdateState) => Boolean(cfg && state.off?.token && state.off.token === tokenTag(cfg.auth.token));

/** Null when this copy can't update itself: no project token (or no ids), or it isn't connected to a setup site. */
export function updateConfig(env: Record<string, string | undefined> = process.env): Cfg | null {
  const t = (k: string) => (env[k] ?? "").trim();
  const token = t("RAILWAY_PROJECT_TOKEN");
  // The setup site sets AUTOUPDATE_* next to the token; Railway also puts its own RAILWAY_* ids in every service.
  const projectId = t("AUTOUPDATE_PROJECT_ID") || t("RAILWAY_PROJECT_ID");
  const environmentId = t("AUTOUPDATE_ENVIRONMENT_ID") || t("RAILWAY_ENVIRONMENT_ID");
  const serviceId = t("AUTOUPDATE_SERVICE_ID") || t("RAILWAY_SERVICE_ID");
  const syncToken = t("SUPPORT_SYNC_TOKEN");
  let siteBase = "";
  try {
    const u = new URL(t("SUPPORT_SYNC_URL"));
    if (u.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) siteBase = u.origin;
  } catch {}
  if (token.length < 16 || !projectId || !environmentId || !serviceId || syncToken.length < 20 || !siteBase) return null;
  return { auth: { token, kind: "project" }, projectId, environmentId, serviceId, siteBase, syncToken };
}

export function currentVersion(env: Record<string, string | undefined> = process.env): string {
  const v = (env.APP_VERSION ?? "").trim();
  if (v) return v;
  try {
    return String(JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")).version ?? "");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------------------------
// The decision (pure, so it is easy to test)
// ---------------------------------------------------------------------------------------------

/** Dotted numbers compare by number ("1.10.0" > "1.9.0"); anything else only counts as different. */
export function isNewer(latest: string, current: string): boolean {
  if (!latest || latest === current) return false;
  const num = (v: string) => (/^\d+(\.\d+){0,3}$/.test(v) ? v.split(".").map(Number) : null);
  const a = num(latest);
  const b = num(current);
  if (!a || !b) return true;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** The local hour (0-23) in a time zone; falls back to Sydney for a zone the runtime doesn't know. */
export function localHour(at: Date, tz: string): number {
  for (const zone of [tz, "Australia/Sydney"]) {
    try {
      const h = new Intl.DateTimeFormat("en-AU", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).formatToParts(at).find((p) => p.type === "hour")?.value;
      if (h !== undefined) return Number(h) % 24;
    } catch {}
  }
  return at.getUTCHours();
}
/** 2:00 to 3:59 local. */
export const inOvernightWindow = (at: Date, tz: string) => {
  const h = localHour(at, tz);
  return h >= 2 && h < 4;
};

export type Decision = { action: "update" | "wait" | "none"; reason: "unavailable" | "off" | "busy" | "no-release" | "current" | "now" | "asap" | "overnight" | "not-yet" };
export function decideUpdate(i: {
  configured: boolean;
  setting: UpdateSetting;
  current: string;
  latest: string;
  busy: boolean;
  at: Date;
  tz: string;
  /** a "push update now" from the setup site: skips the overnight wait, never the owner's off switch */
  force?: boolean;
}): Decision {
  if (!i.configured) return { action: "none", reason: "unavailable" };
  if (!i.setting.enabled) return { action: "none", reason: "off" };
  if (i.busy) return { action: "none", reason: "busy" };
  if (!i.latest) return { action: "none", reason: "no-release" };
  if (!isNewer(i.latest, i.current)) return { action: "none", reason: "current" };
  if (i.force) return { action: "update", reason: "now" };
  if (i.setting.mode === "asap") return { action: "update", reason: "asap" };
  return inOvernightWindow(i.at, i.tz) ? { action: "update", reason: "overnight" } : { action: "wait", reason: "not-yet" };
}

/** The bundle's SHA-256 matches what the setup site said (constant time). */
export function sha256Matches(bytes: Uint8Array, expectedHex: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(expectedHex)) return false;
  const got = createHash("sha256").update(bytes).digest();
  return timingSafeEqual(got, Buffer.from(expectedHex.toLowerCase(), "hex"));
}

export type Release = { version: string; notes: string; bundleUrl: string; sha256: string; size: number };
/** Checks the setup site's answer: a version, a 64-hex checksum, and a download address on the setup site itself. */
export function parseRelease(j: any, siteBase: string): Release | null {
  if (!j || typeof j !== "object") return null;
  const version = String(j.version ?? "");
  const sha = String(j.sha256 ?? "");
  const url = String(j.bundleUrl ?? "");
  if (!/^[A-Za-z0-9._+-]{1,40}$/.test(version) || !/^[a-f0-9]{64}$/i.test(sha)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== siteBase || /[\s"'<>]/.test(url)) return null;
  return { version, notes: String(j.notes ?? "").slice(0, 4000), bundleUrl: url, sha256: sha.toLowerCase(), size: Number(j.size) || 0 };
}

// ---------------------------------------------------------------------------------------------
// Doing it
// ---------------------------------------------------------------------------------------------

export type Deps = {
  fetch: typeof fetch;
  railwayFetch?: RailwayFetch;
  railwayBase?: string;
  env: Record<string, string | undefined>;
  /** how often to look at a build's progress (tests make it long so nothing runs behind them) */
  pollMs?: number;
  now: () => Date;
  timezone: () => Promise<string>;
};
const realDeps = (): Deps => ({ fetch, env: process.env, now: () => new Date(), timezone: agencyTimezone });

/** The time zone most of this agency's receptionists use (Settings), else AGENCY_TIMEZONE, else Sydney. */
export async function agencyTimezone(): Promise<string> {
  try {
    const [r] = await sql`
      select c.data->'settings'->>'timezone' as tz, count(*) as n from clients c join orgs o on o.id = c.org_id
      where not o.sandbox and coalesce(c.data->'settings'->>'timezone', '') <> '' group by tz order by n desc limit 1`;
    if (r?.tz) return String(r.tz);
  } catch {}
  return (process.env.AGENCY_TIMEZONE ?? "").trim() || "Australia/Sydney";
}

let running = false;
export const updateRunning = () => running;

export type Outcome =
  | { ok: true; started: false; reason: Decision["reason"]; latest?: string }
  | { ok: true; started: true; version: string }
  | { ok: false; error: string };

/**
 * Railway refused one of the calls made with the project token: turn automatic updates off for this token, record
 * why once (a problem and an incident, for the owner and for us), and leave everything else as it is.
 */
async function turnOff(cfg: Cfg, why: string): Promise<void> {
  const reason = scrub(why, 160);
  const at = new Date().toISOString();
  await saveState({ off: { token: tokenTag(cfg.auth.token), reason, at }, lastResult: "failed", lastError: reason, lastAt: at });
  await recordIncident({ kind: "update_failed", message: `Automatic updates are unavailable: ${reason}. Update with "Update your agency" on the setup link.` });
  await recordProblem("update_failed", `Auto-update unavailable: ${reason}`);
  console.log(`[updates] automatic updates turned off for this project token: ${reason}`);
}

/** Why a Railway call failed, in words for the owner (and our admin). Never contains the token. */
function railwayWhy(step: string, err: unknown): string {
  const e = err as RailwayError;
  // Ends on "token": scrub() hides whatever follows that word.
  if (e?.code === "auth") return `When ${step}, Railway refused the app's project token`;
  if (e?.code === "plan") return `Railway needs a paid plan for ${step}`;
  if (e?.code === "network") return `Railway couldn't be reached when ${step}`;
  return `Railway gave an error when ${step} (${scrub(e?.message || "unknown", 100)})`;
}

async function fail(from: string, to: string, why: string): Promise<Outcome> {
  const msg = scrub(why, 160);
  await saveState({ phase: "idle", lastResult: "failed", lastError: msg, lastAt: new Date().toISOString(), to, from, deploymentId: undefined });
  await recordIncident({ kind: "update_failed", message: `Automatic update to ${to || "the newest version"} failed: ${msg}` });
  await recordProblem("update_failed", `Automatic update failed: ${msg}`);
  return { ok: false, error: msg };
}

/** Asks the setup site for the newest release. */
export async function fetchRelease(cfg: Cfg, doFetch: typeof fetch): Promise<Release | null> {
  const res = await doFetch(`${cfg.siteBase}/api/releases/latest`, {
    headers: { authorization: `Bearer ${cfg.syncToken}`, accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The setup site answered ${res.status}.`);
  return parseRelease(await res.json().catch(() => null), cfg.siteBase);
}

async function download(rel: Release, doFetch: typeof fetch): Promise<Uint8Array> {
  const res = await doFetch(rel.bundleUrl, { redirect: "error", signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`The download answered ${res.status}.`);
  if (Number(res.headers.get("content-length") || 0) > MAX_BUNDLE_BYTES) throw new Error("The download is far larger than expected.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BUNDLE_BYTES || bytes.length < 1000) throw new Error("The download isn't the size expected.");
  return bytes;
}

/**
 * One check: is there a newer release, is it allowed and the right time, then download, verify and upload it.
 * `force` (a push from the setup site) skips only the overnight wait.
 */
export async function checkAndUpdate(o: { force?: boolean; owner?: boolean } = {}, deps: Deps = realDeps()): Promise<Outcome> {
  if (running) return { ok: true, started: false, reason: "busy" };
  running = true;
  try {
    const cfg = updateConfig(deps.env);
    const setting = o.owner ? { ...(await readUpdateSetting()), enabled: true } : await readUpdateSetting();
    const state = await readUpdateState();
    const current = currentVersion(deps.env);
    const stillDeploying = state.phase === "deploying" && state.startedAt && deps.now().getTime() - Date.parse(state.startedAt) < DEPLOY_TIMEOUT_MS;
    if (!cfg || offForToken(cfg, state)) return { ok: true, started: false, reason: "unavailable" };
    let rel: Release | null = null;
    try {
      rel = await fetchRelease(cfg, deps.fetch);
    } catch (err) {
      return { ok: false, error: scrub((err as Error).message, 160) };
    }
    await saveState({ latest: rel?.version ?? "", checkedAt: deps.now().toISOString() });
    const d = decideUpdate({ configured: true, setting, current, latest: rel?.version ?? "", busy: Boolean(stillDeploying), at: deps.now(), tz: await deps.timezone(), force: o.force || o.owner });
    if (d.action !== "update" || !rel) return { ok: true, started: false, reason: d.reason, latest: rel?.version };

    const from = current;
    await saveState({ phase: "deploying", from, to: rel.version, startedAt: deps.now().toISOString(), deploymentId: undefined, lastError: "" });
    let bytes: Uint8Array;
    try {
      bytes = await download(rel, deps.fetch);
    } catch (err) {
      return fail(from, rel.version, `couldn't download the update (${(err as Error).message})`);
    }
    if (!sha256Matches(bytes, rel.sha256)) return fail(from, rel.version, "the download's checksum didn't match, so it was not installed");
    const rd = { base: deps.railwayBase, doFetch: deps.railwayFetch };
    const ids = { projectId: cfg.projectId, environmentId: cfg.environmentId, serviceId: cfg.serviceId };
    // Neither call has been run against real Railway with a project token. A refusal turns automatic updates off
    // for this token (see the top of this file); the version that is running stays as it is.
    let step = "setting the new version number";
    let labelSet = false;
    try {
      await setServiceVariables(cfg.auth, ids, { APP_VERSION: rel.version }, rd);
      labelSet = true;
      step = "sending the new version";
      const up = await railwayUpload(cfg.auth, ids, bytes, `Automatic update ${rel.version}`, rd);
      await saveState({ deploymentId: up.deploymentId });
      await audit(null, "updates.started", { summary: `Automatic update from ${from || "?"} to ${rel.version} started` }, { orgId: await firstOrgId() });
      void watchDeployment(cfg, up.deploymentId, from, rel.version, deps);
      return { ok: true, started: true, version: rel.version };
    } catch (err) {
      // The old version is still running: put its version label back (if it was changed).
      if (labelSet) await setServiceVariables(cfg.auth, ids, { APP_VERSION: from }, rd).catch(() => {});
      const why = railwayWhy(step, err);
      const out = await fail(from, rel.version, why);
      // Couldn't reach Railway at all: not a refusal, so try again next hour. Anything Railway answered turns this off.
      if (!(err instanceof RailwayError && err.code === "network")) await turnOff(cfg, why);
      return out;
    }
  } finally {
    running = false;
  }
}

const firstOrgId = async (): Promise<string | null> => (await sql`select id from orgs where not sandbox order by created_at limit 1`)[0]?.id ?? null;

/** Polls the build while this version is still running. If the new one takes over, boot (reconcileOnBoot) records success. */
export async function watchDeployment(cfg: Cfg, deploymentId: string, from: string, to: string, deps: Deps): Promise<void> {
  const end = Date.now() + DEPLOY_TIMEOUT_MS;
  let refused = 0;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, deps.pollMs ?? 20_000).unref?.());
    let st = "";
    try {
      st = await deploymentStatus(cfg.auth, deploymentId, { base: deps.railwayBase, doFetch: deps.railwayFetch });
      refused = 0;
    } catch (err) {
      if (err instanceof RailwayError && ["network", "rate", "server"].includes(err.code)) continue; // try again shortly
      // Railway won't tell this token how the build is going (deployment(id) is unproven with a project token).
      // After three refusals in a row stop watching and turn automatic updates off. The phase stays "deploying":
      // if the new version starts it reports "ok" itself at boot (reconcileOnBoot); if not, this version keeps running.
      if (++refused >= 3) {
        await turnOff(cfg, railwayWhy("checking the build", err));
        return;
      }
      continue;
    }
    if (st === "SUCCESS") return; // the new version takes over and reports "ok" when it starts
    if (["FAILED", "CRASHED", "REMOVED", "SKIPPED"].includes(st)) {
      await setServiceVariables(cfg.auth, { projectId: cfg.projectId, environmentId: cfg.environmentId, serviceId: cfg.serviceId }, { APP_VERSION: from }, { base: deps.railwayBase, doFetch: deps.railwayFetch }).catch(() => {});
      await fail(from, to, st === "CRASHED" ? "the new version started but then stopped, so Railway kept this one" : "Railway couldn't build the new version, so this one is still running");
      return;
    }
  }
  await fail(from, to, "the new version took far longer than expected to start");
}

/** At start-up: a deploy we began has either taken over (success) or is overdue (failed). */
export async function reconcileOnBoot(env: Record<string, string | undefined> = process.env, at = new Date()): Promise<"ok" | "failed" | "waiting" | "none"> {
  const s = await readUpdateState();
  if (s.phase !== "deploying") return "none";
  if (s.to && currentVersion(env) === s.to) {
    // Still "failed" while automatic updates are off for this token: that is what makes the setup site's
    // "Update your agency" give the app a new project token (download-site/setup.ts).
    const off = offForToken(updateConfig(env), s);
    await saveState({ phase: "idle", lastResult: off ? "failed" : "ok", lastError: off ? s.off!.reason : "", lastAt: at.toISOString(), deploymentId: undefined });
    if (!off) await resolveIncidents("update_failed");
    await audit(null, "updates.done", { summary: `Updated automatically to ${s.to}` }, { orgId: await firstOrgId() });
    return "ok";
  }
  if (s.startedAt && at.getTime() - Date.parse(s.startedAt) > DEPLOY_TIMEOUT_MS) {
    await fail(s.from ?? "", s.to ?? "", "the new version never started");
    return "failed";
  }
  return "waiting";
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startAutoUpdate(): void {
  if (!updateConfig()) {
    console.log("[updates] automatic updates are unavailable on this copy (no project token): the owner presses Update on the setup link");
    return;
  }
  const tick = () => void checkAndUpdate().catch((err) => console.error("[update]", (err as Error).message));
  setTimeout(() => void reconcileOnBoot().catch(() => {}), 5_000).unref?.();
  setTimeout(tick, 5 * 60_000).unref?.();
  timer ??= setInterval(tick, CHECK_MS);
  timer.unref?.();
}

// ---------------------------------------------------------------------------------------------
// For the heartbeat and Settings
// ---------------------------------------------------------------------------------------------

export async function updatesStatus(env: Record<string, string | undefined> = process.env, at = new Date()) {
  const [setting, state] = [await readUpdateSetting(), await readUpdateState()];
  const cfg = updateConfig(env);
  const off = offForToken(cfg, state);
  return {
    // False: Settings says automatic updates aren't available, the setup site's admin "Auto-update unavailable".
    available: cfg !== null && !off,
    /** "" when available; "no-token" for a copy without a project token; else why it turned itself off. */
    unavailableReason: !cfg ? "no-token" : off ? state.off!.reason : "",
    enabled: setting.enabled,
    mode: setting.mode,
    version: currentVersion(env),
    latest: state.latest ?? "",
    // An install we started that never reported back stops counting as "being installed" after the timeout.
    deploying: state.phase === "deploying" && Boolean(state.startedAt) && at.getTime() - Date.parse(state.startedAt!) < DEPLOY_TIMEOUT_MS,
    lastResult: state.lastResult ?? "",
    lastError: state.lastError ?? "",
    lastAt: state.lastAt ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Settings, "Updates"
// ---------------------------------------------------------------------------------------------

/**
 *   GET  /api/updates/settings   the owner's switch and how updating is going (anyone signed in to the agency console)
 *   PUT  /api/updates/settings   { enabled?, mode? }  owner or admin; never a support session
 *   POST /api/updates/check      { }  owner or admin: look for a newer version now and install it (ignores the overnight wait)
 */
export async function updatesRoute(req: Request, method: string, path: string, ctx: Ctx): Promise<Response> {
  const noView = () => {
    if (ctx.viewing) throw new AuthError("You're viewing as someone else. Updates are the owner's to change.", 403);
    requireRole(ctx, "admin");
  };
  if (path === "/api/updates/check") {
    if (method !== "POST") return json({ error: "Not found" }, 404);
    noView();
    const r = await checkAndUpdate({ owner: true });
    return json({ result: r, status: await updatesStatus() });
  }
  if (method === "GET") return json(await updatesStatus());
  if (method !== "PUT") return json({ error: "Not found" }, 404);
  noView();
  const input = await readBody(req);
  const was = await readUpdateSetting();
  const next: UpdateSetting = { enabled: typeof input?.enabled === "boolean" ? input.enabled : was.enabled, mode: input?.mode === "asap" || input?.mode === "overnight" ? input.mode : was.mode, changedAt: new Date().toISOString(), by: ctx.user.email };
  await putSetting(SETTING_KEY, next);
  if (next.enabled !== was.enabled || next.mode !== was.mode) {
    await audit(ctx, "updates.setting", { summary: next.enabled ? `Automatic updates on (${next.mode === "asap" ? "as soon as available" : "overnight, 2 to 4am"})` : "Automatic updates turned off" });
  }
  return json(await updatesStatus());
}
