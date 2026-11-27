// bun test download-site/test/wizhelp.test.ts
// "I need a person" on the setup wizard: the form on every step, CSRF and origin, the ticket with its context and no
// secrets, the rate limit, the alert, the admin's list / badge / pill / reply / close, the live alert endpoint, and the
// neutral style. The checks live in wizhelp.inner.ts and run in their own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("wizard help: I need a person, end to end", async () => {
  const p = Bun.spawn(["bun", "test", "./test/wizhelp.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, WIZHELP_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-6000));
  expect(out + err).toContain(" 11 pass");
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 120_000);
