// The one text-AI call (OpenRouter): which key, the request, errors that don't leak, the saved key.
// The key tests use the scratch database:  DATABASE_URL=... bun test server/llm.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { migrate, sql } from "./db";
import { DEFAULT_CHAT_MODEL, LlmError, chatCompletion, chatText, checkOpenRouterKey, clearLlmKey, llmConfigured, llmKey, llmKeyState, parseOpenRouterKey, saveLlmKey, withCacheControl } from "./llm";

const orgId = crypto.randomUUID();
let ready = true;
const saved = { key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL };
beforeAll(async () => {
  try {
    await migrate();
    await sql`insert into orgs (id, name) values (${orgId}, 'llm test')`;
  } catch (err) {
    ready = false;
    console.warn("[llm.test] no database, skipping the key tests:", (err as Error).message);
  }
}, 60000);
afterAll(async () => {
  if (ready) await sql`delete from orgs where id = ${orgId}`;
  for (const [k, v] of [["OPENROUTER_API_KEY", saved.key], ["OPENROUTER_MODEL", saved.model]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
});
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "env-key";
  delete process.env.OPENROUTER_MODEL;
});

function pretend(reply: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fn = (async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const ok = (content: string) => ({ choices: [{ message: { role: "assistant", content } }] });

describe("the request", () => {
  test("goes to OpenRouter with the server's key and the default model", async () => {
    const m = pretend(ok("hi"));
    const msg = await chatCompletion({ messages: [{ role: "system", content: "S" }, { role: "user", content: "hello" }], fetch: m.fn, orgId: null, title: "Email agent" });
    expect(msg.content).toBe("hi");
    const c = m.calls[0];
    expect(c.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(c.headers.Authorization).toBe("Bearer env-key");
    expect(c.headers["X-Title"]).toBe("Email agent");
    expect(c.body.model).toBe(DEFAULT_CHAT_MODEL);
    expect(c.body.tools).toBeUndefined();
  });

  test("OPENROUTER_MODEL and a per-call model override the default; tools turn tool_choice on", async () => {
    process.env.OPENROUTER_MODEL = "openai/gpt-x";
    const m = pretend(ok("a"));
    await chatCompletion({ messages: [{ role: "user", content: "x" }], fetch: m.fn, orgId: null, tools: [{ type: "function" }] });
    await chatCompletion({ messages: [{ role: "user", content: "x" }], fetch: m.fn, orgId: null, model: "other/model" });
    expect(m.calls[0].body.model).toBe("openai/gpt-x");
    expect(m.calls[0].body.tool_choice).toBe("auto");
    expect(m.calls[1].body.model).toBe("other/model");
  });

  test("an Anthropic model gets cache_control on the system script; others don't", () => {
    const msgs = [{ role: "system", content: "SCRIPT" }, { role: "user", content: "hi" }];
    const a = withCacheControl("anthropic/claude-sonnet-5.5", msgs);
    expect(a[0].content[0]).toEqual({ type: "text", text: "SCRIPT", cache_control: { type: "ephemeral" } });
    expect(a[1]).toEqual(msgs[1]);
    expect(withCacheControl("openai/gpt-x", msgs)).toEqual(msgs);
  });

  test("no key anywhere: no_key, and nothing is sent", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const m = pretend(ok("x"));
    const err = (await chatCompletion({ messages: [], fetch: m.fn, orgId: null }).catch((e) => e)) as LlmError;
    expect(err).toBeInstanceOf(LlmError);
    expect(err.reason).toBe("no_key");
    expect(m.calls.length).toBe(0);
    expect(await llmConfigured(null)).toBe(false);
  });

  test("errors say the status only: never the provider's body or the key", async () => {
    const m = pretend("secret words env-key", 429);
    const err = (await chatText({ messages: [], fetch: m.fn, orgId: null }).catch((e) => e)) as LlmError;
    expect(err.reason).toBe("status");
    expect(err.status).toBe(429);
    expect(err.message).not.toContain("secret");
    expect(err.message).not.toContain("env-key");
    const empty = (await chatText({ messages: [], fetch: pretend({ choices: [] }).fn, orgId: null }).catch((e) => e)) as LlmError;
    expect(empty.reason).toBe("empty");
    const down = (await chatText({ messages: [], fetch: (async () => { throw new Error("boom env-key"); }) as any, orgId: null }).catch((e) => e)) as LlmError;
    expect(down.reason).toBe("unreachable");
    expect(down.message).not.toContain("boom");
  });
});

describe("the agency's saved key", () => {
  test("is used before the server's, is stored sealed, and goes when removed", async () => {
    if (!ready) return;
    expect(await llmKeyState(orgId)).toMatchObject({ configured: true, source: "server" });
    await saveLlmKey(orgId, "sk-or-v1-agency-key-1234");
    const [row] = await sql`select openrouter_key, openrouter_key_last4 from orgs where id = ${orgId}`;
    expect(row.openrouter_key).not.toContain("agency-key");
    expect(row.openrouter_key_last4).toBe("1234");
    expect(await llmKey(orgId)).toBe("sk-or-v1-agency-key-1234");
    const m = pretend(ok("yo"));
    await chatCompletion({ messages: [{ role: "user", content: "x" }], fetch: m.fn, orgId });
    expect(m.calls[0].headers.Authorization).toBe("Bearer sk-or-v1-agency-key-1234");
    expect(await llmKeyState(orgId)).toMatchObject({ configured: true, source: "own", last4: "1234" });
    await clearLlmKey(orgId);
    expect(await llmKey(orgId)).toBe("env-key");
    expect(await llmKeyState(orgId)).toMatchObject({ source: "server" });
    delete process.env.OPENROUTER_API_KEY;
    expect(await llmKeyState(orgId)).toMatchObject({ configured: false, source: "none" });
  });
});

describe("a key typed into Connections", () => {
  test("is cleaned up and shape-checked", () => {
    expect(parseOpenRouterKey({ key: '  "Bearer sk-or-v1-0123456789abcdef0123"  ' })).toBe("sk-or-v1-0123456789abcdef0123");
    expect(() => parseOpenRouterKey({ key: "sk-ant-nope" })).toThrow(/OpenRouter key/);
    expect(() => parseOpenRouterKey(null)).toThrow();
  });
  test("is checked with OpenRouter before it is saved", async () => {
    const good = pretend({ data: { label: "my key", limit_remaining: 4.2 } });
    expect(await checkOpenRouterKey("sk-or-x", good.fn)).toEqual({ label: "my key", limitRemaining: 4.2 });
    expect(good.calls[0].url).toBe("https://openrouter.ai/api/v1/key");
    const bad = (await checkOpenRouterKey("sk-or-x", pretend("", 401).fn).catch((e) => e)) as LlmError;
    expect(bad.message).toMatch(/didn't accept/);
  });
});
