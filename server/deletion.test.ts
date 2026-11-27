// Deleting a client business, an agency and an account. The checks are in deletion.inner.ts. They run in their own
// bun process against a fresh database made here (every migration applied) and dropped afterwards, so the dev
// database is left alone.
//   bun test --env-file=../.env server/deletion.test.ts
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";

test("deletion: client, agency and account deletes (cascade, permissions, last owner, provider failures)", async () => {
  const base = process.env.DATABASE_URL ?? "";
  expect(base).not.toBe("");
  const name = `deletion_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new SQL(base, { max: 1 });
  await admin.unsafe(`create database ${name}`);
  // A throwaway database: no need to wait for the disk on every commit.
  await admin.unsafe(`alter database ${name} set synchronous_commit = off`);
  try {
    const u = new URL(base);
    u.pathname = `/${name}`;
    const p = Bun.spawn(["bun", "test", "./server/deletion.inner.ts"], {
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, DATABASE_URL: u.toString() },
    });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code !== 0) console.log((out + err).slice(-6000));
    expect(out + err).toMatch(/ \d+ pass/);
    expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
    expect(code).toBe(0);
  } finally {
    await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => {});
    await admin.close();
  }
}, 480_000);
