// bun test download-site/test/admintabs.test.ts
// The admin dashboard's tabs: each top tab and each agency tab renders, the old routes still answer, and the forms are still there.
// The checks live in admintabs.inner.ts and run in their own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("admin tabs: every top tab and agency tab renders, old routes still work", async () => {
  const p = Bun.spawn(["bun", "test", "./test/admintabs.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, TABS_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-2500));
  expect(out + err).toMatch(/ \d+ pass/);
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 180_000);
