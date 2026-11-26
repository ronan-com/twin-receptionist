// bun test download-site/test/tickets.test.ts
// Help tickets on the setup site: the app's POST /api/tickets (token, size limits, no secrets), our replies coming
// back through /api/tickets/updates, the admin's list / reply / close pages, the alert, and the agencies list
// hiding test runs. The checks live in tickets.inner.ts and run in their own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("tickets: create, limits, secrets, admin reply/close, updates back to the app, alerts, agencies list", async () => {
  const p = Bun.spawn(["bun", "test", "./test/tickets.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, TICKETS_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-5000));
  expect(out + err).toContain(" 12 pass");
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 120_000);
