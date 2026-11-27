// The bell's light call feed: only calls after `since`, only this agency's, capped. Uses the scratch database.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";

const { migrate, sql } = await import("./db");
const { insertClient } = await import("./store");
const { recentCalls } = await import("./routes/console");

const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();
const now = new Date().toISOString();
const mk = (name: string): Business => ({ id: crypto.randomUUID(), assistantId: "demo-" + crypto.randomUUID().slice(0, 8), settings: { ...blankSettings(), businessName: name }, instructions: "", createdAt: now, updatedAt: now });
const a = mk("Alpha Dental");
const b = mk("Beta Plumbing");
let ready = true;
const ctxOf = (org: string) => ({ user: { platformAdmin: false }, org: { id: org }, viewing: null }) as any;
const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000);
const add = (org: string, client: string, minAgo: number, channel = "call") =>
  sql`insert into call_log (org_id, client_id, provider_call_id, channel, from_number, started_at) values (${org}, ${client}, ${crypto.randomUUID()}, ${channel}, '+61400000000', ${at(minAgo)})`;

beforeAll(async () => {
  try {
    await migrate();
    await sql`insert into orgs (id, name) values (${orgA}, 'recent A'), (${orgB}, 'recent B')`;
    await insertClient(orgA, a);
    await insertClient(orgB, b);
    await add(orgA, a.id, 1);
    await add(orgA, a.id, 30, "sms");
    await add(orgB, b.id, 1);
    for (let i = 0; i < 25; i++) await add(orgA, a.id, 2);
  } catch (err) {
    ready = false;
    console.warn("[recentCalls.db.test] no database, skipping:", (err as Error).message);
  }
}, 60000);
afterAll(async () => {
  if (ready) {
    await sql`delete from clients where org_id in (${orgA}, ${orgB})`;
    await sql`delete from orgs where id in (${orgA}, ${orgB})`;
  }
});

describe("recent calls feed", () => {
  test("only newer than since, only this agency, capped at 20, with the client name", async () => {
    if (!ready) return;
    const r = await recentCalls(ctxOf(orgA), new URL(`http://x/api/console/calls/recent?since=${encodeURIComponent(at(10).toISOString())}`));
    expect(r.calls.length).toBe(20);
    expect(r.calls.every((c: { business_name: string }) => c.business_name === "Alpha Dental")).toBe(true);
    expect(r.calls.some((c: { channel: string }) => c.channel === "sms")).toBe(false);
    expect(Date.parse(r.now)).toBeGreaterThan(Date.now() - 5000);
  });
  test("nothing newer than the last answer's clock", async () => {
    if (!ready) return;
    const r = await recentCalls(ctxOf(orgA), new URL(`http://x/api/console/calls/recent?since=${encodeURIComponent(new Date().toISOString())}`));
    expect(r.calls).toEqual([]);
  });
  test("a very old since is held to the last day", async () => {
    if (!ready) return;
    const r = await recentCalls(ctxOf(orgB), new URL("http://x/api/console/calls/recent?since=2000-01-01T00:00:00Z"));
    expect(r.calls.length).toBe(1);
  });
});
