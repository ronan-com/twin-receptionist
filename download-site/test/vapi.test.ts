// bun test download-site/test/vapi.test.ts
// The checks live in vapi.inner.ts and run in their own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("the phones step takes Vapi keys (checked with a cheap GET), and Telnyx still works as before", async () => {
  const p = Bun.spawn(["bun", "test", "./test/vapi.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, VAPI_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log(out + err);
  expect(out + err).toContain("8 pass");
  expect(code).toBe(0);
}, 60_000);
