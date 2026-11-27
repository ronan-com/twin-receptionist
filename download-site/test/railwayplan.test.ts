// bun test download-site/test/railwayplan.test.ts
// The Hosting step and the Railway plan (free trial, Free plan, unreadable plan, Hobby). The checks live in railwayplan.inner.ts and run in
// their own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("Hosting step: Railway plan warnings up front", async () => {
  const p = Bun.spawn(["bun", "test", "./test/railwayplan.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log(out + err);
  expect(out + err).toContain("8 pass");
  expect(code).toBe(0);
}, 60_000);
