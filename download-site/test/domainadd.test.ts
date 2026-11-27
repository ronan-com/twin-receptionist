// Add or change the own domain after the install. The checks live in domainadd.inner.ts (own bun process: the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("own domain after the install: add, change, retry, live once it answers", async () => {
  const p = Bun.spawn(["bun", "test", "./test/domainadd.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-6000));
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 120_000);
