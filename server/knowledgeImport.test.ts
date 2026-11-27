// The import routes: drafts are only suggestions, and accepting only adds. Runs on the real test
// database (no mock.module: it is process-wide and leaked a fake database into later test files).
//   bun test --env-file=../.env server/knowledgeImport.test.ts
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { migrate, sql } from "./db";
import { insertClient } from "./store";
import { knowledgeImportRoutes } from "./routes/knowledgeImport";

const orgId = crypto.randomUUID();
let ready = true;
const existingRows = async (): Promise<string[]> => (await sql`select question from knowledge_items where client_id = ${client.id} order by created_at, question`).map((r: any) => String(r.question));
const seed = async (q: string) => { await sql`insert into knowledge_items (client_id, question, answer, enabled, kind, status) values (${client.id}, ${q}, 'a', true, 'faq', 'published')`; };

const now = new Date().toISOString();
const client: Business = { id: crypto.randomUUID(), assistantId: "a-" + crypto.randomUUID().slice(0, 8), settings: blankSettings(), instructions: "", phoneNumbers: [], createdAt: now, updatedAt: now };
const ctx: any = { user: null, org: { id: orgId } };
const where = { orgId, clientId: client.id };
let resyncs = 0;
const call = (rest: string, body: unknown, extra: Record<string, unknown> = {}) =>
  knowledgeImportRoutes({ client, ctx, method: "POST", rest, req: new Request("https://x", { method: "POST", body: JSON.stringify(body) }), where, resync: async () => (resyncs++, { synced: true }), ...extra });

beforeAll(async () => {
  try {
    await migrate();
    await sql`insert into orgs (id, name) values (${orgId}, 'knowledge import test')`;
    await insertClient(orgId, client);
  } catch (err) {
    ready = false;
    console.error("knowledge import tests need the dev database:", (err as Error).message);
  }
}, 120_000);
afterAll(async () => {
  await sql`delete from knowledge_items where client_id = ${client.id}`.catch(() => {});
  await sql`delete from audit_log where org_id = ${orgId}`.catch(() => {});
  await sql`delete from clients where org_id = ${orgId}`.catch(() => {});
  await sql`delete from orgs where id = ${orgId}`.catch(() => {});
}, 30_000);

beforeEach(async () => {
  resyncs = 0;
  if (ready) await sql`delete from knowledge_items where client_id = ${client.id}`;
});

test("a draft saves nothing and marks the questions the business already has", async () => {
  expect(ready).toBe(true);
  await seed("Opening Hours");
  const res = await call("/knowledge/import/draft", { url: "alpha.com.au" }, {
    draft: async () => ({ pages: ["https://alpha.com.au/"], drafts: [{ type: "fact", question: "opening hours", answer: "9-5" }, { type: "faq", question: "Do you do weekends?", answer: "No" }] }),
  });
  const body: any = await res!.json();
  expect(body.drafts.map((d: any) => d.exists)).toEqual([true, false]);
  expect(await existingRows()).toEqual(["Opening Hours"]);
  expect(resyncs).toBe(0);
});

test("accepting adds the chosen items as published and never replaces an existing question", async () => {
  expect(ready).toBe(true);
  await seed("Opening hours");
  const res = await call("/knowledge/import/accept", {
    items: [
      { type: "fact", question: "opening  HOURS", answer: "overwrite attempt" },
      { type: "location", question: "Address", answer: "1 High St" },
      { type: "bogus", question: "Parking", answer: "Out the back" },
      { question: "", answer: "no question" },
    ],
  });
  expect(await res!.json()).toEqual({ added: 2, skipped: 1, synced: true });
  expect(await existingRows()).toEqual(["Opening hours", "Address", "Parking"]);
  const rows = await sql`select question, answer, kind, status from knowledge_items where client_id = ${client.id} and question in ('Address', 'Parking') order by question`;
  expect(rows.map((r: any) => `${r.answer}|${r.kind}|${r.question}|${r.status}`)).toEqual(["1 High St|location|Address|published", "Out the back|faq|Parking|published"]);
  expect(resyncs).toBe(1);
});

test("nothing chosen is an error, and an all-duplicate accept writes and pushes nothing", async () => {
  await expect(call("/knowledge/import/accept", { items: [] })).rejects.toThrow(/at least one/);
  await seed("Dup");
  const res = await call("/knowledge/import/accept", { items: [{ type: "fact", question: "Dup", answer: "y" }] });
  expect(await res!.json()).toMatchObject({ added: 0, skipped: 1 });
  expect(await existingRows()).toEqual(["Dup"]);
  expect(resyncs).toBe(0);
});

test("only POSTs to its own paths are handled", async () => {
  expect(await knowledgeImportRoutes({ client, ctx, method: "GET", rest: "/knowledge/import/draft", req: new Request("https://x"), where, resync: async () => ({ synced: true }) })).toBeNull();
  expect(await call("/knowledge/import/other", {})).toBeNull();
});
