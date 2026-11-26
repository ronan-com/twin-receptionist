// bun test download-site/test/demo.test.ts
// The checks live in demo.inner.ts and run in their own bun process: the site reads DATA_DIR
// once, so they need a data folder (and an "old" database) of their own.
import { expect, test } from "bun:test";
import { join } from "node:path";

test("demo buyers never touch a provider; real buyers still validate keys; old databases migrate", async () => {
  const p = Bun.spawn(["bun", "test", "./test/demo.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, DEMO_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log(out + err);
  expect(out + err).toContain("4 pass");
  expect(code).toBe(0);
}, 60_000);
