// The dynamic-variables webhook with a caller: answers fast with the caller's context, and with an
// empty default when anything is missing or wrong.
//   bun test --env-file=../.env server/callerHook.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { dynamicVariables, ensureAutomationRow } from "./automations";
import { migrate, sql } from "./db";
import { insertClient } from "./store";

const orgId = crypto.randomUUID();
const now = new Date().toISOString();
const mk = (): Business => ({ id: crypto.randomUUID(), assistantId: "assistant-" + crypto.randomUUID().slice(0, 8), settings: { ...blankSettings(), businessName: "Alpha" }, instructions: "x", phoneNumbers: [], createdAt: now, updatedAt: now }) as Business;
const a = mk();
const b = mk();
let token = "";
const initEvent = (from: string) => new Request("https://x.test/hook", { method: "POST", body: JSON.stringify({ data: { event_type: "assistant.initialization", payload: { telnyx_end_user_target: from, telnyx_agent_target: "+61400000001" } } }) });
const vars = async (r: Response) => ((await r.json()) as any).dynamic_variables;

beforeAll(async () => {
  await migrate();
  await sql`insert into orgs (id, name) values (${orgId}, 'caller hook test')`;
  await insertClient(orgId, a);
  await insertClient(orgId, b);
  token = (await ensureAutomationRow(a.id)).token;
  const at = new Date(Date.now() - 2 * 86_400_000);
  await sql`insert into call_log (org_id, client_id, provider_call_id, provider, from_number, started_at, ended_at, summary) values (${orgId}, ${a.id}, 'hook-a', 'telnyx', '+61412345678', ${at}, ${at}, 'Sam asked about a leaking tap.')`;
}, 120_000);
afterAll(async () => {
  await sql`delete from clients where org_id = ${orgId}`.catch(() => {});
  await sql`delete from orgs where id = ${orgId}`.catch(() => {});
}, 30_000);

describe("dynamic variables webhook", () => {
  test("a receptionist that never saved automations gets a key, once", async () => {
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect((await ensureAutomationRow(a.id)).token).toBe(token);
  });
  test("returns the caller's context for the right receptionist", async () => {
    const v = await vars(await dynamicVariables(a.id, token, initEvent("+61412345678")));
    expect(v.twin_caller_context).toContain("leaking tap");
    expect(v.twin_open_now).toBeDefined();
  });
  test("a stranger, a missing body or a GET gets an empty context", async () => {
    expect((await vars(await dynamicVariables(a.id, token, initEvent("+61499999999")))).twin_caller_context).toBe("");
    expect((await vars(await dynamicVariables(a.id, token, new Request("https://x.test/hook", { method: "POST", body: "not json" })))).twin_caller_context).toBe("");
    expect((await vars(await dynamicVariables(a.id, token, new Request("https://x.test/hook")))).twin_caller_context).toBe("");
    expect((await vars(await dynamicVariables(a.id, token))).twin_caller_context).toBe("");
  });
  test("the same caller on another business's hook sees nothing of the first", async () => {
    const tb = (await ensureAutomationRow(b.id)).token;
    expect((await vars(await dynamicVariables(b.id, tb, initEvent("+61412345678")))).twin_caller_context).toBe("");
  });
  test("a wrong key, or another business's key, is refused", async () => {
    expect((await dynamicVariables(a.id, "wrongwrongwrongwrong", initEvent("+61412345678"))).status).toBeGreaterThanOrEqual(400);
    const tb = (await ensureAutomationRow(b.id)).token;
    expect((await dynamicVariables(a.id, tb, initEvent("+61412345678"))).status).toBeGreaterThanOrEqual(400);
  });
});
