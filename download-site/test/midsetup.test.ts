// A buyer partway through setup on the live site (1.0.21 shape) carries on where they are after an update: brand, Railway token kept,
// Voice and AI asked for if missing. Checks live in midsetup.inner.ts (own bun process: the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("live buyers: stored at Voice, AI and Install carry on after the update, nothing re-entered", async () => {
  const p = Bun.spawn(["bun", "test", "./test/midsetup.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-8000));
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 120_000);
