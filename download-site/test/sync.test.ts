// bun test download-site/test/sync.test.ts
// The heartbeat and "View as" on the setup site: token auth and rate limits, the payload whitelist,
// calling the buyer's app, and the admin pages. The checks live in sync.inner.ts and run in their own bun
// process (the site reads DATA_DIR once, and the admin checks start the real server).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("sync: token auth, whitelist, rate limit, Sync now, View as, admin pages", async () => {
  const p = Bun.spawn(["bun", "test", "./test/sync.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, SYNC_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-5000));
  expect(out + err).toContain(" 15 pass");
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 120_000);
