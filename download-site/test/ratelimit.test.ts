// bun test download-site/test/ratelimit.test.ts
// The in-memory rate limiter must forget buckets nobody has touched for a day, or every scanner address stays in memory for good.
import { afterAll, expect, setSystemTime, test } from "bun:test";

process.env.SETUP_SECRET_KEY ||= Buffer.alloc(32, 1).toString("base64");
const { allow, bucketCount, sweepBuckets } = await import("../setup");
afterAll(() => setSystemTime());

test("allow() still limits, and old buckets are swept", () => {
  expect(allow("t:limit", 2, 60_000)).toBe(0);
  expect(allow("t:limit", 2, 60_000)).toBe(0);
  expect(allow("t:limit", 2, 60_000)).toBeGreaterThan(0);
  const before = bucketCount();
  for (let i = 0; i < 50; i++) allow(`t:old:${i}`, 5, 60_000);
  expect(bucketCount()).toBe(before + 50);
  setSystemTime(new Date(Date.now() + 25 * 3600_000));
  expect(sweepBuckets()).toBe(before + 50);
  expect(bucketCount()).toBe(0);
  expect(allow("t:limit", 2, 60_000)).toBe(0); // a fresh bucket after the sweep
});
