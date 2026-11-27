// The daily backup, the off-site copy, the transcript clean-up and the restore guard.
// Uses the scratch database:  DATABASE_URL=... bun test server/backup.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { backupTick, cutoffFor, createBackup, KEEP_BACKUPS, listBackups, normaliseMonths, normaliseS3, readSettings, readState, runBackup, runRetention, SETTINGS_KEY, uploadOffsite, type Uploader } from "./backup";
import { restoreBackup, RestoreError, tablesWithData } from "./backupRestore";
import { migrate, sql } from "./db";
import { databaseLimitMb } from "./providerStatus";
import { putSetting } from "./store";

const dir = mkdtempSync(join(tmpdir(), "bk-test-"));
const orgId = crypto.randomUUID();
const clientId = crypto.randomUUID();
const convId = crypto.randomUUID();
const monthsAgo = (n: number) => new Date(Date.now() - n * 31 * 86_400_000);
let ready = true;
const envKeys = ["DATABASE_LIMIT_MB", "SINGLE_AGENCY", "RAILWAY_ENVIRONMENT_ID"] as const;
const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));

beforeAll(async () => {
  try {
    await migrate();
    await sql`insert into orgs (id, name) values (${orgId}, 'backup test')`;
    await sql`insert into clients (id, org_id, data, created_at, updated_at) values (${clientId}, ${orgId}, ${{ id: clientId, name: "x" } as any}, now(), now())`;
    await sql`insert into brand_assets (id, org_id, kind, content_type, data) values (${crypto.randomUUID()}, ${orgId}, 'logo', 'image/png', ${Buffer.from([0, 1, 2, 250, 255])})`;
    const transcript = [{ role: "user", text: "hello" }];
    await sql`insert into call_log (org_id, client_id, provider_call_id, started_at, outcome, summary, transcript) values
      (${orgId}, ${clientId}, ${`old-${orgId}`}, ${monthsAgo(14)}, 'booked', 'Old call summary', ${transcript as any}),
      (${orgId}, ${clientId}, ${`new-${orgId}`}, ${monthsAgo(1)}, 'message', 'New call summary', ${transcript as any})`;
    await sql`insert into webchat_conversations (id, client_id) values (${convId}, ${clientId})`;
    await sql`insert into webchat_messages (conversation_id, role, content, created_at) values
      (${convId}, 'user', 'old hello', ${monthsAgo(14)}), (${convId}, 'assistant', 'new hello', ${monthsAgo(1)})`;
  } catch (err) {
    ready = false;
    console.warn("[backup.test] no database, skipping:", (err as Error).message);
  }
}, 60000);
afterAll(async () => {
  if (ready) {
    await sql`delete from webchat_conversations where id = ${convId}`;
    await sql`delete from clients where id = ${clientId}`;
    await sql`delete from orgs where id = ${orgId}`;
    await sql`delete from app_settings where key in ('backup_settings', 'backup_state')`;
  }
  rmSync(dir, { recursive: true, force: true });
  for (const k of envKeys) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
});

const lines = (path: string) => gunzipSync(require("node:fs").readFileSync(path)).toString().trim().split("\n").map((l) => JSON.parse(l));

describe("the backup file", () => {
  test("holds every table's rows, in a header-first gzip of JSON lines", async () => {
    if (!ready) return;
    const r = await createBackup({ dir });
    expect(r.name).toMatch(/^backup-\d{8}-\d{6}\.jsonl\.gz$/);
    const all = lines(r.path);
    expect(all[0]).toMatchObject({ format: "twin-backup-1" });
    expect(all[0].tables.indexOf("orgs")).toBeLessThan(all[0].tables.indexOf("clients")); // parents first
    expect(all[0].migrations.length).toBeGreaterThan(20);
    const calls = all.filter((l) => l.t === "call_log" && l.r.org_id === orgId);
    expect(calls).toHaveLength(2);
    expect(all.some((l) => l.t === "webchat_messages" && l.r.content === "old hello")).toBe(true);
    expect(readdirSync(dir).some((f) => f.endsWith(".part"))).toBe(false);
  });

  test("keeps only the newest 7", async () => {
    if (!ready) return;
    const d = mkdtempSync(join(tmpdir(), "bk-keep-"));
    try {
      for (let i = 0; i < KEEP_BACKUPS + 3; i++) await createBackup({ dir: d, now: new Date(Date.UTC(2026, 0, 1 + i, 2, 0, 0)) });
      const files = listBackups(d);
      expect(files).toHaveLength(KEEP_BACKUPS);
      expect(files[0].name).toBe("backup-20260110-020000.jsonl.gz");
      expect(files.at(-1)!.name).toBe("backup-20260104-020000.jsonl.gz");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("the daily job", () => {
  test("backs up when there is none, not again within a day, again when it is a day old", async () => {
    if (!ready) return;
    const d = mkdtempSync(join(tmpdir(), "bk-tick-"));
    try {
      const first = await backupTick({ dir: d });
      expect(first.backedUp).toBe(true);
      expect((await readState()).lastFile).toMatch(/^backup-/);
      expect((await backupTick({ dir: d })).backedUp).toBe(false);
      const later = new Date(Date.now() + 25 * 3_600_000);
      const again = await backupTick({ dir: d, now: later });
      expect(again).toEqual({ backedUp: true, cleaned: true });
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("a failing backup is recorded, not thrown", async () => {
    if (!ready) return;
    const blocked = join(dir, "not-a-folder");
    writeFileSync(blocked, "x");
    const r = await runBackup({ dir: join(blocked, "sub") });
    expect(r.ok).toBe(false);
    expect((await readState()).lastError).toBeTruthy();
    expect((await runBackup({ dir })).ok).toBe(true);
    expect((await readState()).lastError).toBe("");
  });

  test("uploads off-site when S3 is set up, and a failed upload does not fail the backup", async () => {
    if (!ready) return;
    const s3 = normaliseS3({ endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "agency-backups", accessKeyId: "AKIA1", secret: "s3cret" }, null);
    expect(JSON.stringify(s3)).not.toContain("s3cret"); // sealed
    await putSetting(SETTINGS_KEY, { retentionMonths: 12, s3 });
    const calls: any[] = [];
    const ok: Uploader = async (cfg, key, path) => { calls.push({ cfg, key, path }); };
    const r = await runBackup({ dir, upload: ok });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].cfg).toMatchObject({ endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "agency-backups", accessKeyId: "AKIA1", secretAccessKey: "s3cret" });
    expect(calls[0].key).toBe(`backups/${r.result!.name}`);
    expect((await readState()).offsiteError).toBe("");
    const bad: Uploader = async () => { throw new Error("AccessDenied"); };
    const r2 = await runBackup({ dir, upload: bad, now: new Date(Date.now() + 1000) });
    expect(r2.ok).toBe(true);
    expect((await readState()).offsiteError).toContain("AccessDenied");
    await putSetting(SETTINGS_KEY, { retentionMonths: 12, s3: null });
    await uploadOffsite(s3, "/nonexistent", "x", ok);
  });

  test("the off-site form is checked and keeps the saved secret when left blank", () => {
    const was = normaliseS3({ endpoint: "https://e.example.com", bucket: "b", accessKeyId: "k", secret: "one" }, null);
    expect(normaliseS3({ endpoint: "https://e.example.com", bucket: "b2", accessKeyId: "k", secret: "" }, was).secret).toBe(was.secret);
    expect(() => normaliseS3({ endpoint: "http://e.example.com", bucket: "b", accessKeyId: "k", secret: "x" }, null)).toThrow();
    expect(() => normaliseS3({ endpoint: "https://e.example.com", bucket: "", accessKeyId: "k", secret: "x" }, null)).toThrow();
    expect(() => normaliseS3({ endpoint: "https://e.example.com", bucket: "b", accessKeyId: "k", secret: "" }, null)).toThrow();
  });
});

describe("keeping transcripts for N months", () => {
  test("choices default to 12 and ignore nonsense", () => {
    expect([3, 6, 12, 24, 0].map(normaliseMonths)).toEqual([3, 6, 12, 24, 0]);
    expect([5, "x", undefined, -1].map(normaliseMonths)).toEqual([12, 12, 12, 12]);
    const now = new Date("2026-06-15T00:00:00Z");
    expect(cutoffFor(6, now)!.toISOString()).toBe("2025-12-15T00:00:00.000Z");
    expect(cutoffFor(0, now)).toBeNull();
  });

  test("clears old transcript text and messages, keeps the call row, summary and outcome", async () => {
    if (!ready) return;
    const forever = await runRetention(0);
    expect(forever).toEqual({ transcripts: 0, messages: 0 });
    const r = await runRetention(12);
    expect(r.transcripts).toBeGreaterThanOrEqual(1);
    expect(r.messages).toBeGreaterThanOrEqual(1);
    const calls = await sql`select provider_call_id, outcome, summary, transcript from call_log where org_id = ${orgId} order by started_at`;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ outcome: "booked", summary: "Old call summary", transcript: null });
    expect(calls[1].transcript).not.toBeNull(); // 1 month old: kept
    const msgs = await sql`select content from webchat_messages where conversation_id = ${convId}`;
    expect(msgs.map((m: any) => m.content)).toEqual(["new hello"]);
    expect((await sql`select 1 from webchat_conversations where id = ${convId}`).length).toBe(1);
  });

  test("the saved setting is read back", async () => {
    if (!ready) return;
    await putSetting(SETTINGS_KEY, { retentionMonths: 24, s3: null });
    expect((await readSettings()).retentionMonths).toBe(24);
    await putSetting(SETTINGS_KEY, { retentionMonths: 0, s3: null });
    expect((await readSettings()).retentionMonths).toBe(0);
  });
});

describe("restore", () => {
  test("refuses a database that has data in it, and leaves it alone", async () => {
    if (!ready) return;
    const r = await createBackup({ dir });
    expect(await tablesWithData()).toContain("orgs");
    await expect(restoreBackup(r.path)).rejects.toThrow(/already has data/);
    expect((await sql`select 1 from orgs where id = ${orgId}`).length).toBe(1);
  });

  test("refuses files that are not backups", async () => {
    if (!ready) return;
    const junk = join(dir, "junk.jsonl.gz");
    writeFileSync(junk, "not gzip");
    await expect(restoreBackup(junk)).rejects.toBeInstanceOf(RestoreError);
    writeFileSync(junk, Buffer.from(Bun.gzipSync(JSON.stringify({ format: "other" }) + "\n")));
    await expect(restoreBackup(junk)).rejects.toThrow(/isn't a backup/);
  });

  test("the CLI restores a backup into a new empty database, exactly, and refuses a second time", async () => {
    if (!ready) return;
    const name = `bk_restore_${Date.now()}`;
    const url = new URL(process.env.DATABASE_URL!);
    try {
      await sql.unsafe(`create database ${name}`);
    } catch (e) {
      console.warn("[backup.test] can't create a scratch database, skipping the CLI restore:", (e as Error).message);
      return;
    }
    url.pathname = `/${name}`;
    const target = new SQL(url.toString(), { max: 2 });
    try {
      const b = await createBackup({ dir });
      const run = async () => {
        const p = Bun.spawn(["bun", join(import.meta.dir, "restoreCli.ts"), b.path], { env: { ...process.env, DATABASE_URL: url.toString() }, stdout: "pipe", stderr: "pipe" });
        const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
        return { code: await p.exited, out: out + err };
      };
      const first = await run();
      expect(first.out).toContain("Restored");
      expect(first.code).toBe(0);
      const header = lines(b.path)[0];
      for (const t of header.tables as string[]) {
        const [a] = await sql.unsafe(`select count(*)::int n from "${t}"`);
        const [c] = await target.unsafe(`select count(*)::int n from "${t}"`);
        expect(`${t}:${c.n}`).toBe(`${t}:${a.n}`);
      }
      const [logo] = await target`select data from brand_assets where org_id = ${orgId}`;
      expect([...logo.data]).toEqual([0, 1, 2, 250, 255]);
      const [call] = await target`select outcome, transcript from call_log where provider_call_id = ${`new-${orgId}`}`;
      expect(call).toMatchObject({ outcome: "message", transcript: [{ role: "user", text: "hello" }] });
      // bigserial ids carry on after the restored ones
      const [next] = await target`insert into webchat_messages (conversation_id, role, content) values (${convId}, 'user', 'after') returning id`;
      const [top] = await sql`select max(id)::int as m from webchat_messages`;
      expect(Number(next.id)).toBeGreaterThan(Number(top.m) - 1);
      const second = await run();
      expect(second.code).toBe(1);
      expect(second.out).toMatch(/already has data/);
    } finally {
      await target.close();
      await sql.unsafe(`drop database if exists ${name} with (force)`);
    }
  }, 60000);
});

describe("the database size warning limit", () => {
  test("defaults to the Railway Hobby volume for a single agency on Railway, and 0 elsewhere", () => {
    delete process.env.DATABASE_LIMIT_MB;
    delete process.env.SINGLE_AGENCY;
    delete process.env.RAILWAY_ENVIRONMENT_ID;
    expect(databaseLimitMb()).toBe(0);
    process.env.SINGLE_AGENCY = "1";
    expect(databaseLimitMb()).toBe(0);
    process.env.RAILWAY_ENVIRONMENT_ID = "env";
    expect(databaseLimitMb()).toBe(5000);
    process.env.DATABASE_LIMIT_MB = "50000";
    expect(databaseLimitMb()).toBe(50000);
  });
});

