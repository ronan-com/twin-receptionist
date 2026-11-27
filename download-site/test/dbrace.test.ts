// bun test download-site/test/dbrace.test.ts
// First start of a fresh site.db: the server and `admin.ts publish` (and more) open it at the same moment. Each one used to look for a
// missing column, then ALTER TABLE it, so two of them crashed with "duplicate column name". Migrations now run under one write lock and
// treat "duplicate column" as done. Also covers an old database (made before those columns) and running twice.
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const child = join(import.meta.dir, "dbrace.child.ts");
const open = (dir: string) => {
  const p = Bun.spawn(["bun", child], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, DATA_DIR: dir, SETUP_SECRET_KEY: Buffer.alloc(32, 7).toString("base64"), SITE_URL: "http://localhost:4500" } });
  return Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).then(([out, err, code]) => ({ out, err, code }));
};

test("8 processes opening a brand-new site.db at once: none crashes, all see every column", async () => {
  for (let round = 0; round < 3; round++) {
    const dir = mkdtempSync(join(tmpdir(), "dbrace-"));
    const rs = await Promise.all(Array.from({ length: 8 }, () => open(dir)));
    for (const r of rs) {
      if (r.code !== 0) console.log(r.err.slice(-1500));
      expect(r.code).toBe(0);
      expect(r.out).toContain("OPENED true");
    }
  }
}, 120_000);

test("an old database without the newer columns is moved on, concurrently, and again on a second start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dbrace-old-"));
  mkdirSync(join(dir, "packages"), { recursive: true });
  const old = new Database(join(dir, "site.db"), { create: true });
  old.exec("CREATE TABLE buyers (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, code_hash BLOB NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT, downloads INTEGER NOT NULL DEFAULT 0, last_download_at TEXT);");
  old.exec("CREATE TABLE packages (id INTEGER PRIMARY KEY, version TEXT NOT NULL UNIQUE, file TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL DEFAULT '');");
  old.exec("CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, buyer_id INTEGER NOT NULL, app_id TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', context TEXT NOT NULL DEFAULT '{}', from_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (buyer_id, app_id));");
  old.close();
  const rs = await Promise.all(Array.from({ length: 5 }, () => open(dir)));
  for (const r of rs) { if (r.code !== 0) console.log(r.err.slice(-1500)); expect(r.code).toBe(0); expect(r.out).toContain("OPENED true"); }
  const again = await open(dir);
  expect(again.code).toBe(0);
  const d = new Database(join(dir, "site.db"), { readonly: true });
  expect((d.query("PRAGMA table_info(tickets)").all() as { name: string }[]).some((c) => c.name === "source")).toBe(true);
  expect((d.query("PRAGMA table_info(packages)").all() as { name: string }[]).some((c) => c.name === "notes")).toBe(true);
  d.close();
}, 120_000);

test("addColumn: another process adding the column between our look and our ALTER counts as done; other errors still surface", async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "dbrace-unit-"));
  process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
  const { addColumn } = await import("../lib");
  const real = new Database(":memory:");
  real.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  // A stale look: it says "no such column" although the other process has just added it.
  const stale: any = { query: () => ({ all: () => [{ name: "id" }] }), exec: (sql: string) => real.exec(sql) };
  addColumn(stale, "t", "extra", "TEXT"); // really adds
  expect(() => addColumn(stale, "t", "extra", "TEXT")).not.toThrow(); // "duplicate column name" is swallowed
  expect((real.query("PRAGMA table_info(t)").all() as { name: string }[]).filter((c) => c.name === "extra")).toHaveLength(1);
  expect(() => addColumn(stale, "no_such_table", "x", "TEXT")).toThrow(); // anything else is a real failure
});
