// The practice chat for Vapi receptionists: answered by our own text AI (a pretend OpenRouter here), kept in
// memory, never booking anything. Uses the scratch database only through the shared modules' imports.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { sendOwnSimText, startOwnTextSim } from "./simulator";

const now = new Date().toISOString();
const client: Business = { id: crypto.randomUUID(), assistantId: "vapi-asst", settings: { ...blankSettings(), businessName: "Alpha Plumbing", receptionistName: "Mia", services: ["Blocked drain"] }, instructions: "", createdAt: now, updatedAt: now };
const saved = process.env.OPENROUTER_API_KEY;
beforeEach(() => void (process.env.OPENROUTER_API_KEY = "test-key"));
afterEach(() => void (saved === undefined ? delete process.env.OPENROUTER_API_KEY : (process.env.OPENROUTER_API_KEY = saved)));

const model = (calls: any[]) =>
  (async (_url: unknown, init: any) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "Hi, it's Mia. How can I help?" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
const deps = (calls: any[]) => ({ fetch: model(calls), knowledge: async () => [] });

describe("text practice chat for Vapi receptionists", () => {
  test("starts, answers through the text AI and remembers the conversation", async () => {
    const calls: any[] = [];
    const { conversationId } = await startOwnTextSim(client);
    expect(conversationId.startsWith("own-")).toBe(true);
    expect((await sendOwnSimText(client, "org-1", { conversationId, text: "Hello" }, deps(calls))).reply).toContain("Mia");
    await sendOwnSimText(client, "org-1", { conversationId, text: "Do you do drains?" }, deps(calls));
    const roles = calls[1].messages.map((m: any) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(JSON.stringify(calls[1].messages[0].content)).toContain("Alpha Plumbing");
  });
  test("refuses another receptionist's conversation, an unknown one and an empty message", async () => {
    const calls: any[] = [];
    const { conversationId } = await startOwnTextSim(client);
    const other = { ...client, id: crypto.randomUUID() };
    await expect(sendOwnSimText(other, "org-1", { conversationId, text: "hi" }, deps(calls))).rejects.toThrow("Start a new test conversation");
    await expect(sendOwnSimText(client, "org-1", { conversationId: "own-nope", text: "hi" }, deps(calls))).rejects.toThrow("Start a new test conversation");
    await expect(sendOwnSimText(client, "org-1", { conversationId, text: "  " }, deps(calls))).rejects.toThrow("Type a message");
    expect(calls.length).toBe(0);
  });
});
