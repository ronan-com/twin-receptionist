// Help tickets in the app: routing (agency staff to the setup provider, business users to their agency), limits,
// no secrets, the push to the setup site, our replies coming back with an unread dot, and agency inbox access. The checks
// are in tickets.inner.ts. They run in their own bun process, against a fresh database made here (every migration applied)
// and dropped afterwards, so the dev database is left alone.
//   bun test --env-file=../.env server/tickets.test.ts
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";

test("tickets: routing, limits, secrets, push and pull, unread, agency inbox", async () => {
  const base = process.env.DATABASE_URL ?? "";
  expect(base).not.toBe("");
  const name = `tickets_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new SQL(base, { max: 1 });
  await admin.unsafe(`create database ${name}`);
  try {
    const u = new URL(base);
    u.pathname = `/${name}`;
    const p = Bun.spawn(["bun", "test", "./server/tickets.inner.ts"], {
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, DATABASE_URL: u.toString() },
    });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code !== 0) console.log((out + err).slice(-5000));
    expect(out + err).toContain(" 12 pass");
    expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
    expect(code).toBe(0);
  } finally {
    await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => {});
    await admin.close();
  }
}, 120_000);
