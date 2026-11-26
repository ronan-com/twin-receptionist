// bun test download-site/test/assist.test.ts
// "Set up for them": the checks live in assist.inner.ts and run in their own bun process (the site reads DATA_DIR and the
// provider addresses once, so they need their own). hosts.test.ts does the same for their-own-domain links.
import { expect, test } from "bun:test";
import { join } from "node:path";

test("assist: admin fills steps, buyer sees them done, validation errors, GoDaddy + Cloudflare writers, install for them, keys deleted, audit", async () => {
  const p = Bun.spawn(["bun", "test", "./test/assist.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, ASSIST_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-6000));
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(out + err).toMatch(/\b\d+ pass/);
  expect(code).toBe(0);
}, 180_000);
