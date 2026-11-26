// bun test download-site/test/ownerreset.test.ts
// "Locked out? Reset your owner password" on the Done screen: the setup site asks the buyer's app (a fake one here)
// for a one-time owner reset link with the call token, and shows it once. Runs in its own bun process (the site
// reads DATA_DIR once and the checks start the real server).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("owner reset: Done screen, call token, outdated apps, link shown once and never stored, rate limit", async () => {
  const p = Bun.spawn(["bun", "test", "./test/ownerreset.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, SYNC_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-5000));
  expect(out + err).toContain(" 8 pass");
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 120_000);
