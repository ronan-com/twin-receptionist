// bun test download-site/test/update.test.ts
// "Update your agency": the checks live in update.inner.ts and run in their own bun process
// (the site reads DATA_DIR and the Railway address once, so they need their own).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("update: token again, same project and service, variables kept, version recorded, token deleted, nothing lost on failure", async () => {
  const p = Bun.spawn(["bun", "test", "./test/update.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, UPDATE_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log(out + err);
  expect(out + err).toContain("6 pass");
  expect(code).toBe(0);
}, 120_000);
