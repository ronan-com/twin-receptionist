// bun test download-site/test/broker.test.ts
// The shared Google / Microsoft sign-in on the setup site (broker.ts): off by default, token auth, the connect trip
// (PKCE + one-time ticket), sealed refresh tokens and refreshing, failure handling. The checks live in broker.inner.ts and
// run in their own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("broker: off by default, auth, connect, ticket, refresh, failures", async () => {
  const p = Bun.spawn(["bun", "test", "./test/broker.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, BROKER_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-5000));
  expect(out + err).toContain(" 16 pass");
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 120_000);
