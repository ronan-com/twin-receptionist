// bun test download-site/test/ops.test.ts
// Releases and signed bundle addresses, "Push update now", the heartbeat's new arrays, alerts (and their de-duping),
// fetching recent logs, the project token at install and update, and the admin pages for all of it. The checks live in
// ops.inner.ts and run in their own bun process (the site reads DATA_DIR and the Railway address once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("ops: releases, push, problems, alerts, logs, project token, admin pages", async () => {
  const p = Bun.spawn(["bun", "test", "./test/ops.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, OPS_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-2500));
  expect(out + err).toMatch(/ \d+ pass/);
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 180_000);
