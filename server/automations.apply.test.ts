// applyAutomations end to end with the phone provider and the database stubbed: what
// exactly is sent to Telnyx when automations are saved.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/automations.apply.test.ts
import { afterAll, expect, mock, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";

// bun's mock.module is process-wide: without putting the real modules back, the stand-ins below
// would be what every later test file gets (a fake database, a fake phone service).
const real = { telnyx: { ...(await import("./telnyx")) }, db: { ...(await import("./db")) }, booking: { ...(await import("./booking")) } };
afterAll(() => {
  mock.module("./telnyx", () => real.telnyx);
  mock.module("./db", () => real.db);
  mock.module("./booking", () => real.booking);
});

const calls: { method: string; path: string; body?: any }[] = [];
let stored: any = {};

mock.module("./telnyx", () => ({
  telnyx: async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (method === "GET") return { data: { telephony_settings: { default_texml_app_id: "texml-9", supports_unauthenticated_web_calls: true } } };
    return { data: {} };
  },
  // Every export of server/telnyx.ts: a missing one breaks the modules automations.ts pulls in
  // (sms.ts, twilio.ts, voice/*) with "Export named ... not found".
  runAsOrg: (_o: unknown, fn: () => unknown) => fn(),
  enterOrg: () => {},
  currentOrg: () => null,
  forgetKey: () => {},
  TelnyxError: class extends Error {},
  hasKey: () => true,
}));

const sql: any = async (strings: TemplateStringsArray) => {
  const q = strings.join("?");
  if (q.includes("from client_automations")) return [{ settings: stored, applied_at: null, apply_error: null, text_back_since: null, updated_at: new Date() }];
  return [];
};
mock.module("./db", () => ({ sql, iso: (d: any) => (d ? new Date(d).toISOString() : ""), migrate: async () => {} }));
// The real booking module with only the public address pinned.
mock.module("./booking", () => ({ ...real.booking, publicUrl: () => "https://answered.example" }));

const { applyAutomations, normaliseAutomations, withAutomations } = await import("./automations");

const now = new Date().toISOString();
const client: Business = {
  id: "11111111-2222-3333-4444-555555555555",
  assistantId: "assistant-123",
  settings: { ...blankSettings(), businessName: "Alpha Plumbing", greeting: "Hi, Alpha Plumbing." },
  instructions: "base",
  phoneNumbers: ["+61412000999"],
  createdAt: now,
  updatedAt: now,
};

test("saving sends the script + tools, then greeting, telephony settings and transcription", async () => {
  stored = {
    ...normaliseAutomations({
      transfer: { enabled: true, number: "0733334444" },
      recording: { enabled: true, notice: "This call is recorded." },
      callLimits: { maxMinutes: 10, idleSeconds: 20 },
      language: { code: "multi" },
      hoursMode: { enabled: true },
    }),
    _token: "tok_abcdefghijklmnop",
  };
  calls.length = 0;
  // Stands in for server/index.ts syncAssistant: it posts the script and tools through withAutomations.
  const syncAssistant = async (c: Business) => {
    const { telnyx } = await import("./telnyx");
    await telnyx("POST", `/ai/assistants/${c.assistantId}`, await withAutomations(c, { instructions: "SCRIPT", tools: [{ type: "hangup" }] }));
    return c;
  };
  const err = await applyAutomations(client, { syncAssistant });
  expect(err).toBeNull();
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
    "POST /ai/assistants/assistant-123",
    "GET /ai/assistants/assistant-123",
    "POST /ai/assistants/assistant-123",
  ]);
  const [script, , rest] = calls;
  expect(script.body.instructions).toStartWith("SCRIPT\n\nAutomations");
  expect(script.body.tools[1]).toMatchObject({ type: "transfer", transfer: { targets: [{ to: "+61733334444" }], from: "+61412000999" } });
  expect(rest.body).toEqual({
    greeting: "{{twin_greeting}}",
    dynamic_variables: { twin_greeting: "Hi, Alpha Plumbing. This call is recorded.", twin_open_now: "unknown" },
    dynamic_variables_webhook_url: `https://answered.example/hooks/automations/${client.id}/tok_abcdefghijklmnop`,
    telephony_settings: {
      default_texml_app_id: "texml-9",
      supports_unauthenticated_web_calls: true,
      time_limit_secs: 600,
      user_idle_timeout_secs: 20,
      recording_settings: { enabled: true, channels: "dual", format: "mp3" },
    },
    transcription: { model: "deepgram/flux", language: "multi" },
  });
});

test("a demo receptionist never calls the provider", async () => {
  calls.length = 0;
  const err = await applyAutomations({ ...client, assistantId: "demo-1" }, { syncAssistant: async (c) => c });
  expect(err).toBeNull();
  expect(calls).toEqual([]);
});

test("a provider failure is reported, not thrown", async () => {
  const err = await applyAutomations(client, {
    syncAssistant: async () => {
      throw new Error("The phone service said: Unauthorized");
    },
  });
  expect(err).toBe("The phone service said: Unauthorized");
});

test("spam filtering sends the block-list script lines, the webhook and the safe defaults to Telnyx", async () => {
  stored = { ...normaliseAutomations({ spam: { blockList: ["0412 345 678"], anonymous: "reject", endRobocalls: true } }), _token: "tok_abcdefghijklmnop" };
  calls.length = 0;
  const syncAssistant = async (c: Business) => {
    const { telnyx } = await import("./telnyx");
    await telnyx("POST", `/ai/assistants/${c.assistantId}`, await withAutomations(c, { instructions: "SCRIPT", tools: [{ type: "hangup" }] }));
    return c;
  };
  expect(await applyAutomations(client, { syncAssistant })).toBeNull();
  const [script, , rest] = calls;
  expect(script.body.instructions).toContain('"{{twin_blocked}}" is "yes"');
  expect(script.body.instructions).toContain("hangup tool");
  expect(rest.body.greeting).toBe("{{twin_greeting}}");
  expect(rest.body.dynamic_variables).toMatchObject({ twin_blocked: "no", twin_anonymous: "no" });
  expect(rest.body.dynamic_variables_webhook_url).toContain(`/hooks/automations/${client.id}/`);
  expect(JSON.stringify(calls)).not.toContain("+61412345678"); // the list stays on our side for Telnyx
});
