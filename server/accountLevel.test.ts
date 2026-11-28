// Telnyx's "not permitted at this account level" becomes a message that says what to do. Nothing real is called.
import { afterAll, expect, test } from "bun:test";
process.env.DATABASE_URL ||= "postgres://unused@127.0.0.1:1/unused";
const { ACCOUNT_LEVEL_MSG, telnyx } = await import("./telnyx");

const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

test("an account that isn't verified or upgraded enough is said plainly, whatever was being done", async () => {
  const answer = (detail: string) => (globalThis.fetch = (async () => new Response(JSON.stringify({ errors: [{ detail }] }), { status: 403 })) as any);
  answer("This feature is not permitted at this account level.");
  await expect(telnyx("POST", "/number_orders", {}, "KEY-test")).rejects.toThrow(ACCOUNT_LEVEL_MSG);
  expect(ACCOUNT_LEVEL_MSG).toMatch(/verification or an upgrade.*Account Level/);
  answer("Something else.");
  await expect(telnyx("GET", "/balance", undefined, "KEY-test")).rejects.toThrow("The phone service said: Something else.");
});
