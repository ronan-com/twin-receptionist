// bun test download-site/test/onboarding.test.ts
// The simple onboarding: OAuth state + PKCE, old setups migrating to the short wizard, the app's phone/AI settings
// in every combination, test runs gone from Add agency, admin forgot-password, the "agency offline" email (once).
// Runs in its own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("onboarding: OAuth state/PKCE, step migration, env combinations, test runs, forgot password, offline email once", async () => {
  const p = Bun.spawn(["bun", "test", "./test/onboarding.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, ONBOARDING_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-6000));
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 120_000);
