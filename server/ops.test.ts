// Automatic updates, problems, support changes, default-on Support access, and the logs route. The checks are in
// ops.inner.ts. They run in their own bun process against a fresh database made here (every migration applied) and
// dropped afterwards, so the dev database is left alone.
//   bun test --env-file=../.env server/ops.test.ts
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";

test("ops: auto-update flows, problems feed, support changes, default-on access, logs", async () => {
  const base = process.env.DATABASE_URL ?? "";
  expect(base).not.toBe("");
  const name = `ops_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new SQL(base, { max: 1 });
  await admin.unsafe(`create database ${name}`);
  try {
    const u = new URL(base);
    u.pathname = `/${name}`;
    const p = Bun.spawn(["bun", "test", "./server/ops.inner.ts"], {
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
}, 180_000);
