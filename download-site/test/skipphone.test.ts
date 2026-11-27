// bun test download-site/test/skipphone.test.ts
// The checks live in skipphone.inner.ts and run in their own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("the Phones step: Telnyx, or Vapi + Twilio, or skip for now (install with no voice key, connect it in the dashboard)", async () => {
  const p = Bun.spawn(["bun", "test", "./test/skipphone.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log(out + err);
  expect(out + err).toContain("8 pass");
  expect(code).toBe(0);
}, 60_000);
