// The Telnyx engine sends what server/index.ts used to send itself: nothing changed by moving it.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/voice/telnyx.test.ts
import { afterAll, expect, mock, test } from "bun:test";
import { blankSettings, type Business } from "../../src/lib/shared";

// bun's mock.module is process-wide: put the real modules back so later test files don't get these.
const real = { telnyx: { ...(await import("../telnyx")) }, db: { ...(await import("../db")) } };
afterAll(() => {
  mock.module("../telnyx", () => real.telnyx);
  mock.module("../db", () => real.db);
});

const calls: { method: string; path: string; body?: any }[] = [];

class FakeTelnyxError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
mock.module("../telnyx", () => ({
  telnyx: async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (method === "POST" && path === "/ai/assistants") return { data: { id: "assistant-new" } };
    if (method === "GET" && path.startsWith("/ai/assistants/")) return { data: { telephony_settings: { default_texml_app_id: "texml-1", supports_unauthenticated_web_calls: true } } };
    return { data: {} };
  },
  runAsOrg: (_o: unknown, fn: () => unknown) => fn(),
  enterOrg: () => {},
  currentOrg: () => null,
  forgetKey: () => {},
  TelnyxError: FakeTelnyxError,
  hasKey: () => true,
}));
// The database answers nothing: no saved automations, so scripts and greetings go as they are.
const sql: any = async () => [];
mock.module("../db", () => ({ sql, iso: (d: any) => (d ? new Date(d).toISOString() : ""), migrate: async () => {} }));

const { telnyxProvider } = await import("./telnyx");

const now = new Date().toISOString();
const settings = { ...blankSettings(), businessName: "Alpha Plumbing", greeting: "Hi, Alpha Plumbing.", voiceId: "voice-uuid-1", receptionistName: "Mia" };
const client: Business = { id: "11111111-2222-3333-4444-555555555555", assistantId: "assistant-123", settings, instructions: "base", createdAt: now, updatedAt: now };

test("a new assistant is made with Telnyx's fields, hang-up tool and browser calls on, then texting is switched on", async () => {
  calls.length = 0;
  const id = await telnyxProvider.createAssistant(settings, "SCRIPT", client.id);
  expect(id).toBe("assistant-new");
  const create = calls[0];
  expect(create).toMatchObject({ method: "POST", path: "/ai/assistants" });
  expect(create.body).toMatchObject({
    name: expect.stringContaining("Alpha Plumbing"),
    instructions: "SCRIPT",
    greeting: "Hi, Alpha Plumbing.",
    voice_settings: { voice: "voice-uuid-1", voice_speed: 1.0 },
    model: "zai-org/GLM-5.3-Flash",
    transcription: { model: "deepgram/flux", language: "en" },
    tools: [{ type: "hangup", hangup: { description: "End the call once the caller has said goodbye or has nothing else to ask." } }],
    enabled_features: ["telephony"],
    telephony_settings: { supports_unauthenticated_web_calls: true },
    tags: ["twin-receptionist"],
  });
  expect(create.body.widget_settings.start_call_text).toBe("Talk to Mia");
  // enableTexting asks Telnyx about the new assistant.
  expect(calls.slice(1).every((c) => c.path.includes("assistant-new") || c.path.includes("messaging"))).toBe(true);
});

test("syncing sends the script and the hang-up tool to the assistant with POST", async () => {
  calls.length = 0;
  await telnyxProvider.syncAssistant(client, "SCRIPT", ["request_callback"]);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ method: "POST", path: "/ai/assistants/assistant-123" });
  expect(calls[0].body.instructions).toBe("SCRIPT");
  expect(calls[0].body.tools).toEqual([{ type: "hangup", hangup: { description: "End the call once the caller has said goodbye or has nothing else to ask." } }]);
});

test("a profile update sends name, greeting, voice and widget text", async () => {
  calls.length = 0;
  await telnyxProvider.updateAssistant(client, { ...settings, greeting: "Hello there." }, "NEW SCRIPT");
  expect(calls[0]).toMatchObject({ method: "POST", path: "/ai/assistants/assistant-123" });
  expect(calls[0].body).toMatchObject({ instructions: "NEW SCRIPT", greeting: "Hello there.", voice_settings: { voice: "voice-uuid-1", voice_speed: 1.0 } });
});

test("buying is Telnyx's; importing is not offered", async () => {
  expect(telnyxProvider.numbers.support()).toMatchObject({ provider: "telnyx", buy: true, import: false });
  await expect(telnyxProvider.numbers.attach(client, {})).rejects.toThrow("numbers are bought here");
  expect(await telnyxProvider.webCall("assistant-123")).toEqual({ provider: "telnyx", assistantId: "assistant-123" });
});
