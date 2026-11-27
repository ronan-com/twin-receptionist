import { expect, test } from "bun:test";
import { join } from "node:path";
test("neutral owner setup and plain installs keep branding separate for each buyer", async () => {
  const p = Bun.spawn([process.execPath, "test", "./test/neutral-owner.inner.ts"], {
    cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env },
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log(out + err);
  expect(code).toBe(0);
}, 60_000);
