// The import routes with the database stubbed: drafts are only suggestions, and accepting only adds.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/knowledgeImport.test.ts
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";

const real = { db: { ...(await import("./db")) } };
afterAll(() => mock.module("./db", () => real.db));

let existing: { question: string }[] = [];
const writes: string[] = [];
const sql: any = async (strings: TemplateStringsArray, ...vals: unknown[]) => {
  const q = strings.join("?");
  if (q.includes("select question from knowledge_items")) return existing;
  if (q.includes("insert into knowledge_items")) {
    writes.push(`${vals[2]}|${vals[3]}|${vals[1]}`);
    return [];
  }
  if (q.includes("audit")) return [];
  return [];
};
mock.module("./db", () => ({ sql, iso: (d: any) => (d ? new Date(d).toISOString() : ""), migrate: async () => {} }));

const { knowledgeImportRoutes } = await import("./routes/knowledgeImport");

const now = new Date().toISOString();
const client: Business = { id: "11111111-2222-3333-4444-555555555555", assistantId: "a", settings: blankSettings(), instructions: "", phoneNumbers: [], createdAt: now, updatedAt: now };
const ctx: any = { user: { id: "u" }, org: { id: "o" } };
const where = { orgId: "o", clientId: client.id };
let resyncs = 0;
const call = (rest: string, body: unknown, extra: Record<string, unknown> = {}) =>
  knowledgeImportRoutes({ client, ctx, method: "POST", rest, req: new Request("https://x", { method: "POST", body: JSON.stringify(body) }), where, resync: async () => (resyncs++, { synced: true }), ...extra });

beforeEach(() => {
  existing = [];
  writes.length = 0;
  resyncs = 0;
});

test("a draft saves nothing and marks the questions the business already has", async () => {
  existing = [{ question: "Opening Hours" }];
  const res = await call("/knowledge/import/draft", { url: "alpha.com.au" }, {
    draft: async () => ({ pages: ["https://alpha.com.au/"], drafts: [{ type: "fact", question: "opening hours", answer: "9-5" }, { type: "faq", question: "Do you do weekends?", answer: "No" }] }),
  });
  const body: any = await res!.json();
  expect(body.drafts.map((d: any) => d.exists)).toEqual([true, false]);
  expect(writes).toEqual([]);
  expect(resyncs).toBe(0);
});

test("accepting adds the chosen items as published and never replaces an existing question", async () => {
  existing = [{ question: "Opening hours" }];
  const res = await call("/knowledge/import/accept", {
    items: [
      { type: "fact", question: "opening  HOURS", answer: "overwrite attempt" },
      { type: "location", question: "Address", answer: "1 High St" },
      { type: "bogus", question: "Parking", answer: "Out the back" },
      { question: "", answer: "no question" },
    ],
  });
  expect(await res!.json()).toEqual({ added: 2, skipped: 1, synced: true });
  expect(writes).toEqual(["1 High St|location|Address", "Out the back|faq|Parking"]);
  expect(resyncs).toBe(1);
});

test("nothing chosen is an error, and an all-duplicate accept writes and pushes nothing", async () => {
  await expect(call("/knowledge/import/accept", { items: [] })).rejects.toThrow(/at least one/);
  existing = [{ question: "Dup" }];
  const res = await call("/knowledge/import/accept", { items: [{ type: "fact", question: "Dup", answer: "y" }] });
  expect(await res!.json()).toMatchObject({ added: 0, skipped: 1 });
  expect(writes).toEqual([]);
  expect(resyncs).toBe(0);
});

test("only POSTs to its own paths are handled", async () => {
  expect(await knowledgeImportRoutes({ client, ctx, method: "GET", rest: "/knowledge/import/draft", req: new Request("https://x"), where, resync: async () => ({ synced: true }) })).toBeNull();
  expect(await call("/knowledge/import/other", {})).toBeNull();
});
