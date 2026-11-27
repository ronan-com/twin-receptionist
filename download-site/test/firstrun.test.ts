// bun test download-site/test/firstrun.test.ts
// The checks live in firstrun.inner.ts and run in their own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("first run: the install hands the app the owner's details and a one-time sign-in token; the done screen's button uses it", async () => {
  const p = Bun.spawn(["bun", "test", "./test/firstrun.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log(out + err);
  expect(out + err).toContain("6 pass");
  expect(code).toBe(0);
}, 60_000);
