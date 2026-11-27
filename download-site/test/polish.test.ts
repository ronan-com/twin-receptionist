// bun test download-site/test/polish.test.ts
// The onboarding polish: Continue always moves on (also after Back / a returned sign-in / an error), true connected state, Voice = Telnyx / Vapi / Skip,
// "Connect more", no step descriptions, logos, parked sign-ins, "Talk to a person". Runs in its own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("onboarding polish: Continue, true state, Voice choices, Connect more, look, Talk to a person", async () => {
  const p = Bun.spawn(["bun", "test", "./test/polish.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, POLISH_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-8000));
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 120_000);
