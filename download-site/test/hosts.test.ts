// bun test download-site/test/hosts.test.ts
// A buyer's setup link on their own domain: /api/tls-allowed for Caddy, host-based routing against the real server,
// their brand and never ours, and "admin does some steps, the buyer finishes the rest" on that domain.
import { expect, test } from "bun:test";
import { join } from "node:path";

test("hosts: tls-allowed, host routing, branding on their domain, partial onboarding", async () => {
  const p = Bun.spawn(["bun", "test", "./test/hosts.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, HOSTS_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-6000));
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(out + err).toMatch(/\b\d+ pass/);
  expect(code).toBe(0);
}, 120_000);
