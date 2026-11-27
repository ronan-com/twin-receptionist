// bun test download-site/test/dnsdelete.test.ts
// Delete the project takes back the DNS records the install wrote (GoDaddy and Cloudflare).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("dns delete + GoDaddy on Railway", async () => {
  const p = Bun.spawn(["bun", "test", "./test/dnsdelete.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, DNSDELETE_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-6000));
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(out + err).toMatch(/\b\d+ pass/);
  expect(code).toBe(0);
}, 120_000);
