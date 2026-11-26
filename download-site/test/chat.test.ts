// bun test download-site/test/chat.test.ts
// The "Need help?" chat: auth by setup code and CSRF, rate limits, hidden without a key, nothing secret in
// the prompt. The checks live in chat.inner.ts and run in their own bun process (the site reads DATA_DIR once).
import { expect, test } from "bun:test";
import { join } from "node:path";

test("chat: code + CSRF, rate limit, off without a key, no secrets in the prompt", async () => {
  const p = Bun.spawn(["bun", "test", "./test/chat.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, CHAT_INNER: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) console.log((out + err).slice(-5000));
  expect(out + err).toMatch(/ \d+ pass/);
  expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
  expect(code).toBe(0);
}, 120_000);
