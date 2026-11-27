// bun test download-site/test/pretrial.test.ts
// A Telnyx key on a pretrial account: detected on the Phones step with an upgrade message (pretrial vs paid, mocked).
// The checks live in pretrial.inner.ts and run in their own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("telnyx pretrial detection", async () => {
  const p = Bun.spawn(["bun", "test", "./test/pretrial.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, PRETRIAL_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-5000));
  expect(out + err).toContain(" 4 pass");
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 60_000);
