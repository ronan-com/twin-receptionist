import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { AuthError, requireRole, singleAgency, type Ctx } from "./accounts";
import { audit } from "./audit";
import { sql } from "./db";
import { databaseLimitMb } from "./providerStatus";
import { json, readBody } from "./routes/http";
import { seal, unseal } from "./secrets";
import { getSetting, putSetting } from "./store";

// Backups (Settings, "Backups"). Railway's Hobby plan has no volume backups, so each agency's app makes its own:
//   - once a day it writes a compressed logical dump of its own database (every table, as JSON lines in a .gz file)
//     into BACKUP_DIR (a Railway volume mounted on the app service at install) and keeps the newest 7;
//   - if the agency fills in S3-compatible settings (Cloudflare R2, Backblaze, AWS...), it also uploads each one there;
//   - a daily clean-up deletes transcripts and chat messages older than "Keep transcripts for N months" (default 12),
//     keeping every call row with its summary and outcome.
// Restore: server/backupRestore.ts (CLI: bun server/restoreCli.ts <file>), only into an empty database.
// pg_dump isn't in the app image (and its version has to match the server's), so the dump is made in SQL.

export const KEEP_BACKUPS = 7;
export const FORMAT = "twin-backup-1";
export const DAY_MS = 24 * 3_600_000;
/** Months to keep transcripts and chat messages; 0 = forever. */
export const RETENTION_CHOICES = [3, 6, 12, 24, 0] as const;
export const DEFAULT_RETENTION_MONTHS = 12;
const NAME_RE = /^backup-\d{8}-\d{6}\.jsonl\.gz$/;
export const SETTINGS_KEY = "backup_settings";
export const STATE_KEY = "backup_state";

/** BACKUP_DIR, else the app's Railway volume (set at install; RAILWAY_VOLUME_MOUNT_PATH), else ./data/backups. */
export const backupDir = () => process.env.BACKUP_DIR || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "backups") : join(import.meta.dir, "..", "data", "backups"));
/** On by default for a single agency's own copy (SINGLE_AGENCY); BACKUPS=on/off overrides. */
export const backupsEnabled = () => (process.env.BACKUPS === "off" ? false : process.env.BACKUPS === "on" || singleAgency());
/** On Railway: is a volume mounted on this service? "n/a" anywhere else. */
export const volumeState = (): "mounted" | "missing" | "n/a" => (process.env.RAILWAY_VOLUME_MOUNT_PATH ? "mounted" : process.env.RAILWAY_ENVIRONMENT_ID ? "missing" : "n/a");

// ---- Settings and state ---------------------------------------------------------------------

export type S3Settings = { endpoint: string; bucket: string; region: string; accessKeyId: string; secret: string /* sealed */ };
export type BackupSettings = { retentionMonths: number; s3: S3Settings | null };
export type BackupState = { lastAt?: string; lastFile?: string; lastError?: string; offsiteAt?: string; offsiteError?: string; retentionAt?: string; retentionRemoved?: { transcripts: number; messages: number } };

export const normaliseMonths = (v: unknown): number => {
  const n = Number(v);
  return (RETENTION_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_RETENTION_MONTHS;
};
export async function readSettings(): Promise<BackupSettings> {
  const s = await getSetting<Partial<BackupSettings>>(SETTINGS_KEY);
  return { retentionMonths: s?.retentionMonths === undefined ? DEFAULT_RETENTION_MONTHS : normaliseMonths(s.retentionMonths), s3: s?.s3?.bucket ? (s.s3 as S3Settings) : null };
}
export const readState = async (): Promise<BackupState> => (await getSetting<BackupState>(STATE_KEY)) ?? {};
const patchState = async (p: Partial<BackupState>) => putSetting(STATE_KEY, { ...(await readState()), ...p });

// ---- The files ------------------------------------------------------------------------------

export type BackupFile = { name: string; size: number; at: string };
export function listBackups(dir = backupDir()): BackupFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => NAME_RE.test(f))
    .map((name) => ({ name, size: statSync(join(dir, name)).size, at: statSync(join(dir, name)).mtime.toISOString() }))
    .sort((a, b) => b.name.localeCompare(a.name));
}
export const backupName = (d = new Date()) => `backup-${d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}.jsonl.gz`;
export const isBackupName = (n: string) => NAME_RE.test(n);

/** Tables to dump, parents before children (so a restore inserts in file order). schema_migrations is not dumped. */
export async function dumpTables(db: typeof sql = sql): Promise<string[]> {
  const tables: string[] = (await db`select c.relname from pg_class c where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace and c.relname <> 'schema_migrations' order by c.relname`).map((r: any) => r.relname);
  const deps = await db`
    select child.relname as child, parent.relname as parent
    from pg_constraint k join pg_class child on child.oid = k.conrelid join pg_class parent on parent.oid = k.confrelid
    where k.contype = 'f' and child.relnamespace = 'public'::regnamespace and child.oid <> parent.oid`;
  const needs = new Map<string, Set<string>>(tables.map((t) => [t, new Set()]));
  for (const d of deps) needs.get(d.child)?.add(d.parent);
  const out: string[] = [];
  const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => [...needs.get(t)!].every((p) => !left.has(p)));
    const next = ready.length ? ready : [[...left][0]]; // a cycle: break it anywhere
    for (const t of next) { out.push(t); left.delete(t); }
  }
  return out;
}

export type BackupResult = { name: string; path: string; size: number; rows: number; tables: number; at: string };

/**
 * Writes one backup file: a header line, then one line per row ({"t": table, "r": row}). Taken in a single
 * repeatable-read transaction so the tables agree with each other. Written to a .part file and renamed when done.
 */
export async function createBackup(opts: { db?: typeof sql; dir?: string; now?: Date } = {}): Promise<BackupResult> {
  const db = opts.db ?? sql;
  const dir = opts.dir ?? backupDir();
  const now = opts.now ?? new Date();
  mkdirSync(dir, { recursive: true });
  const name = backupName(now);
  const path = join(dir, name);
  const part = `${path}.part`;
  const gz = createGzip({ level: 6 });
  const out = createWriteStream(part);
  const done = new Promise<void>((res, rej) => { out.on("finish", res); out.on("error", rej); gz.on("error", rej); });
  gz.pipe(out);
  const put = (line: string) => (gz.write(line + "\n") ? Promise.resolve() : new Promise<void>((r) => gz.once("drain", r)));
  let rows = 0;
  let tables: string[] = [];
  try {
    await db.begin(async (tx: any) => {
      await tx`set transaction isolation level repeatable read read only`;
      tables = await dumpTables(tx);
      const migrations = (await tx`select name from schema_migrations order by name`).map((r: any) => r.name);
      await put(JSON.stringify({ format: FORMAT, createdAt: now.toISOString(), migrations, tables }));
      for (const t of tables) {
        // A server-side cursor, 500 rows at a time, so a big table never sits in memory.
        await tx.unsafe(`declare bk cursor for select to_jsonb(x) as r from "${t}" x`);
        for (;;) {
          const batch = await tx.unsafe("fetch 500 from bk");
          if (!batch.length) break;
          for (const row of batch) { await put(JSON.stringify({ t, r: row.r })); rows++; }
        }
        await tx.unsafe("close bk");
      }
    });
    gz.end();
    await done;
    renameSync(part, path);
  } catch (err) {
    gz.destroy();
    out.destroy();
    try { unlinkSync(part); } catch {}
    throw err;
  }
  pruneBackups(dir);
  return { name, path, size: statSync(path).size, rows, tables: tables.length, at: now.toISOString() };
}

/** Keeps the newest KEEP_BACKUPS files. Returns the names it removed. */
export function pruneBackups(dir = backupDir(), keep = KEEP_BACKUPS): string[] {
  const gone: string[] = [];
  for (const f of listBackups(dir).slice(keep)) { try { unlinkSync(join(dir, f.name)); gone.push(f.name); } catch {} }
  return gone;
}

// ---- Off-site copy (any S3-compatible service) ------------------------------------------------

export type Uploader = (cfg: Omit<S3Settings, "secret"> & { secretAccessKey: string }, key: string, path: string) => Promise<void>;
export const liveUploader: Uploader = async (cfg, key, path) => {
  const { S3Client } = await import("bun");
  const client = new S3Client({ endpoint: cfg.endpoint, bucket: cfg.bucket, region: cfg.region || "auto", accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey });
  await client.write(key, Bun.file(path));
};
export async function uploadOffsite(s3: S3Settings, path: string, name: string, upload: Uploader = liveUploader): Promise<void> {
  await upload({ endpoint: s3.endpoint, bucket: s3.bucket, region: s3.region, accessKeyId: s3.accessKeyId, secretAccessKey: unseal(s3.secret) }, `backups/${name}`, path);
}

// ---- Clean-up: old transcripts and chat messages -----------------------------------------------

export const cutoffFor = (months: number, now = new Date()): Date | null => {
  if (!months) return null;
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};
/** Deletes transcript text and chat messages older than `months`. Call rows, summaries and outcomes stay. */
export async function runRetention(months: number, now = new Date(), db: typeof sql = sql): Promise<{ transcripts: number; messages: number }> {
  const cutoff = cutoffFor(months, now);
  if (!cutoff) return { transcripts: 0, messages: 0 };
  const t = await db`update call_log set transcript = null where transcript is not null and started_at < ${cutoff} returning 1`;
  const m = await db`delete from webchat_messages where created_at < ${cutoff} returning 1`;
  return { transcripts: t.length, messages: m.length };
}

export async function databaseMb(db: typeof sql = sql): Promise<number> {
  const [r] = await db`select pg_database_size(current_database())::float8 as bytes`;
  return Number(r?.bytes ?? 0) / 1_048_576;
}

// ---- The daily job ----------------------------------------------------------------------------

let running = false;
export type JobDeps = { upload?: Uploader; dir?: string; now?: Date };

/** Backs up now (file, then the off-site copy if set up) and records the outcome. Never throws. */
export async function runBackup(deps: JobDeps = {}): Promise<{ ok: boolean; result?: BackupResult; error?: string }> {
  if (running) return { ok: false, error: "A backup is already running." };
  running = true;
  try {
    const result = await createBackup({ dir: deps.dir, now: deps.now });
    await patchState({ lastAt: result.at, lastFile: result.name, lastError: "" });
    const s3 = (await readSettings()).s3;
    if (s3) {
      try {
        await uploadOffsite(s3, result.path, result.name, deps.upload);
        await patchState({ offsiteAt: result.at, offsiteError: "" });
      } catch (e) {
        await patchState({ offsiteError: (e as Error).message.slice(0, 300) });
      }
    }
    return { ok: true, result };
  } catch (e) {
    const error = (e as Error).message.slice(0, 300);
    await patchState({ lastError: error }).catch(() => {});
    return { ok: false, error };
  } finally {
    running = false;
  }
}

/** One pass of the job: a backup if the newest is over a day old, the clean-up if it hasn't run today. */
export async function backupTick(deps: JobDeps = {}): Promise<{ backedUp: boolean; cleaned: boolean }> {
  const now = deps.now ?? new Date();
  const newest = listBackups(deps.dir)[0];
  const state = await readState();
  let backedUp = false;
  if (!newest || now.getTime() - new Date(newest.at).getTime() >= DAY_MS - 60_000) {
    // A failed attempt is retried at the next tick (hourly), not in a tight loop.
    backedUp = (await runBackup({ ...deps, now })).ok;
  }
  let cleaned = false;
  if (!state.retentionAt || now.getTime() - new Date(state.retentionAt).getTime() >= DAY_MS - 60_000) {
    const months = (await readSettings()).retentionMonths;
    const removed = await runRetention(months, now);
    await patchState({ retentionAt: now.toISOString(), retentionRemoved: removed });
    cleaned = true;
  }
  return { backedUp, cleaned };
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startBackups(): void {
  if (timer || process.env.NODE_ENV === "test" || !backupsEnabled()) return;
  const run = () => void backupTick().catch((err) => console.error("[backup]", err.message));
  setTimeout(run, 2 * 60_000).unref?.();
  timer = setInterval(run, 3_600_000);
  timer.unref?.();
}

// ---- The dashboard's side (Settings, "Backups") ------------------------------------------------

export async function backupStatus() {
  const [settings, state, mb] = await Promise.all([readSettings(), readState(), databaseMb().catch(() => null)]);
  const files = listBackups();
  return {
    enabled: backupsEnabled(),
    volume: volumeState(),
    keep: KEEP_BACKUPS,
    backups: files,
    last: files[0] ?? null,
    lastError: state.lastError || "",
    offsite: { configured: Boolean(settings.s3), at: state.offsiteAt ?? null, error: state.offsiteError || "" },
    settings: {
      retentionMonths: settings.retentionMonths,
      s3: settings.s3 ? { endpoint: settings.s3.endpoint, bucket: settings.s3.bucket, region: settings.s3.region, accessKeyId: settings.s3.accessKeyId, secretSet: true } : null,
    },
    cleanup: { at: state.retentionAt ?? null, removed: state.retentionRemoved ?? null },
    databaseMb: mb === null ? null : Math.round(mb * 10) / 10,
    databaseLimitMb: databaseLimitMb(),
  };
}
export type BackupStatus = Awaited<ReturnType<typeof backupStatus>>;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Validates the off-site form. An empty secret keeps the saved one. */
export function normaliseS3(input: any, was: S3Settings | null): S3Settings {
  const endpoint = text(input?.endpoint, 300);
  const bucket = text(input?.bucket, 120);
  const accessKeyId = text(input?.accessKeyId, 200);
  const region = text(input?.region, 60) || "auto";
  const secret = text(input?.secret, 300);
  if (!/^https:\/\/[^\s/]+/.test(endpoint)) throw new AuthError("The endpoint should start with https://, like https://<account>.r2.cloudflarestorage.com.", 400);
  if (!bucket || !accessKeyId) throw new AuthError("Enter the bucket and the access key.", 400);
  if (!secret && !was?.secret) throw new AuthError("Enter the secret key.", 400);
  return { endpoint, bucket, region, accessKeyId, secret: secret ? seal(secret) : was!.secret };
}

export async function backupsRoute(req: Request, method: string, path: string, ctx: Ctx, deps: JobDeps = {}): Promise<Response> {
  if (ctx.viewing) throw new AuthError("You're viewing as someone else. Backups are the owner's.", 403);
  requireRole(ctx, "admin");
  if (path === "/api/backups/download" && method === "GET") {
    const name = new URL(req.url).searchParams.get("name") || listBackups()[0]?.name || "";
    if (!isBackupName(name) || !existsSync(join(backupDir(), name))) return json({ error: "There's no backup to download yet. Press \"Back up now\"." }, 404);
    await audit(ctx, "backup.download", { summary: `Downloaded ${name}` });
    return new Response(Bun.file(join(backupDir(), name)), { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  }
  if (path === "/api/backups/run" && method === "POST") {
    const r = await runBackup(deps);
    if (r.ok) await audit(ctx, "backup.run", { summary: "Backed up now" });
    return json({ ok: r.ok, error: r.error, status: await backupStatus() }, r.ok ? 200 : 500);
  }
  if (path === "/api/backups" && method === "GET") return json(await backupStatus());
  if (path === "/api/backups/settings" && method === "PUT") {
    const input = await readBody(req);
    const was = await readSettings();
    const next: BackupSettings = { ...was };
    if (input?.retentionMonths !== undefined) {
      if (!(RETENTION_CHOICES as readonly number[]).includes(Number(input.retentionMonths))) throw new AuthError("Choose 3, 6, 12 or 24 months, or forever.", 400);
      next.retentionMonths = Number(input.retentionMonths);
    }
    if (input?.s3 === null) next.s3 = null;
    else if (input?.s3) next.s3 = normaliseS3(input.s3, was.s3);
    await putSetting(SETTINGS_KEY, next);
    await audit(ctx, "backup.settings", { summary: `Backup settings changed (keep transcripts ${next.retentionMonths ? `${next.retentionMonths} months` : "forever"}; off-site ${next.s3 ? "on" : "off"})` });
    return json(await backupStatus());
  }
  return json({ error: "Not found" }, 404);
}
