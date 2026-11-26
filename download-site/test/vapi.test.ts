// bun test download-site/test/vapi.test.ts
// The checks live in vapi.inner.ts and run in their own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("Telnyx is the main path; Vapi and Twilio are backup options that are validated and installed when added", async () => {
  const p = Bun.spawn(["bun", "test", "./test/vapi.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, VAPI_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log(out + err);
  expect(out + err).toContain("11 pass");
  expect(code).toBe(0);
}, 60_000);
