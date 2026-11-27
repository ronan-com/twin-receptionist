// bun test download-site/test/invite.test.ts
// No Chloe branding by default, and "Invite them" at the end: the checks live in invite.inner.ts and run in their own bun
// process (the site reads DATA_DIR, PRODUCT_NAME and the mail settings once, so they need their own).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("invite: Generic style by default, neutral pages say no Chloe, Add agency emails nobody, Invite them picks setup link vs dashboard login, invited-at, no-email copy path", async () => {
  const p = Bun.spawn(["bun", "test", "./test/invite.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, INVITE_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-6000));
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(out + err).toMatch(/\b\d+ pass/);
  expect(code).toBe(0);
}, 120_000);
