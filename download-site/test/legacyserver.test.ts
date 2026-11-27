// A setup saved while a server-hosting mode existed still loads (own bun process: the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("old server-mode setups load, drop their old fields and land on a Railway step", async () => {
  const p = Bun.spawn(["bun", "test", "./test/legacyserver.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-6000));
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(out + err).toContain("4 pass");
  expect(code).toBe(0);
}, 60_000);
