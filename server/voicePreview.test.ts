// The voice Play button and the browser test call, for both engines. Pure: the phone services are stood in for.
//   DATABASE_URL=postgres://unused@localhost/unused TELNYX_API_KEY=k VAPI_API_KEY=v bun test server/voicePreview.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { telnyxProvider, telnyxVoicePreview, sniffAudio, wavOfPcm } from "./voice/telnyx";
import { vapiProvider } from "./voice/vapi";
import { withinSeconds } from "./timeout";
import { ValidationError } from "./prompt";

const realFetch = globalThis.fetch;
const realEnv = { t: process.env.TELNYX_API_KEY, v: process.env.VAPI_API_KEY, e: process.env.E2E_FAKE_PROVIDER, p: process.env.VAPI_PUBLIC_KEY };
let calls: { method: string; url: string; body: any }[] = [];
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const stub = (handler: (method: string, url: string, body: any) => Response | Promise<Response>) => {
  calls = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init?.method ?? "GET", url: String(url), body });
    return handler(init?.method ?? "GET", String(url), body);
  }) as any;
};
beforeEach(() => {
  process.env.TELNYX_API_KEY = "KEY-live-0123456789";
  process.env.VAPI_API_KEY = "vapi-live-0123456789";
  delete process.env.E2E_FAKE_PROVIDER;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [["TELNYX_API_KEY", realEnv.t], ["VAPI_API_KEY", realEnv.v], ["E2E_FAKE_PROVIDER", realEnv.e], ["VAPI_PUBLIC_KEY", realEnv.p]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
});

const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(400, 1)]);
const ID = "Telnyx.Ultra.043cfc81-d69f-4bee-ae1e-7862cb358650";

describe("Telnyx voice preview", () => {
  test("asks Telnyx for the sample line in that voice and hands back an mp3", async () => {
    stub(() => reply(200, { base64_audio: mp3.toString("base64") }));
    const clip = await telnyxVoicePreview(ID);
    expect(clip.type).toBe("audio/mpeg");
    expect(clip.body.equals(mp3)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.telnyx.com/v2/text-to-speech/speech");
    expect(calls[0].body).toMatchObject({ voice: ID, output_type: "base64_output" });
    expect(calls[0].body.text).toMatch(/front desk/);
    // Played again: kept, so no second call to Telnyx.
    await telnyxVoicePreview(ID);
    expect(calls).toHaveLength(1);
  });

  test("a voice that returns raw PCM becomes a playable WAV (a browser can't play bare PCM)", async () => {
    const pcm = Buffer.alloc(4800, 3);
    stub(() => reply(200, { base64_audio: pcm.toString("base64") }));
    const clip = await telnyxVoicePreview("Telnyx.Qwen3TTS.Delta");
    expect(clip.type).toBe("audio/wav");
    expect(sniffAudio(clip.body)).toBe("audio/wav");
    expect(clip.body.length).toBe(44 + pcm.length);
    expect(clip.body.readUInt32LE(24)).toBe(24000);
  });

  test("sniffing", () => {
    expect(sniffAudio(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe("audio/mpeg");
    expect(sniffAudio(Buffer.from("OggS....."))).toBe("audio/ogg");
    expect(sniffAudio(wavOfPcm(Buffer.alloc(10)))).toBe("audio/wav");
    expect(sniffAudio(Buffer.alloc(50, 5))).toBeNull();
  });

  test("a refusal from Telnyx is an error with Telnyx's reason, and an empty answer is an error too", async () => {
    stub(() => reply(422, { errors: [{ detail: "voice not available" }] }));
    await expect(telnyxVoicePreview("Telnyx.Ultra.zzz-1")).rejects.toThrow(/voice not available/);
    stub(() => reply(200, { base64_audio: "" }));
    await expect(telnyxVoicePreview("Telnyx.Ultra.zzz-2")).rejects.toThrow(/didn't return the preview/);
    stub(() => reply(200, { base64_audio: Buffer.alloc(20).toString("base64") }));
    await expect(telnyxVoicePreview("Telnyx.Ultra.zzz-3")).rejects.toThrow(/empty preview/);
  });

  test("only Telnyx voice ids are accepted", async () => {
    stub(() => reply(200, {}));
    for (const bad of ["", "11labs:abc", "../x", "Telnyx.", "Telnyx.a b"]) await expect(telnyxVoicePreview(bad)).rejects.toThrow(/Unknown voice/);
    expect(calls).toHaveLength(0);
  });
});

describe("Vapi voice preview", () => {
  test("every Vapi voice's clip is a static file the page can play (the list is checked against public/voice-previews in vapi.test.ts)", async () => {
    const list = await vapiProvider.voices();
    expect(list.length).toBeGreaterThan(10);
    for (const v of list) expect(v.previewUrl).toMatch(/^\/voice-previews\/[\w.-]+\.mp3$/);
  });
});

describe("browser test call", () => {
  test("Telnyx: checks the receptionist exists on Telnyx and allows browser calls", async () => {
    stub(() => reply(200, { data: { telephony_settings: { supports_unauthenticated_web_calls: true } } }));
    expect(await telnyxProvider.webCall("assistant-1")).toEqual({ provider: "telnyx", assistantId: "assistant-1" });
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.telnyx.com/v2", "")}`)).toEqual(["GET /ai/assistants/assistant-1"]);
  });

  test("Telnyx: browser calls switched off are reported (enabled: false) and the check changes nothing (a GET has no side effects)", async () => {
    stub((m) => (m === "GET" ? reply(200, { data: { telephony_settings: { default_texml_app_id: "app-9", supports_unauthenticated_web_calls: false } } }) : reply(200, {})));
    expect(await telnyxProvider.webCall("assistant-2")).toEqual({ provider: "telnyx", assistantId: "assistant-2", enabled: false });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  test("Telnyx: the explicit enable POST keeps the other telephony settings and switches browser calls on; already on is left alone", async () => {
    stub((m) => (m === "GET" ? reply(200, { data: { telephony_settings: { default_texml_app_id: "app-9", supports_unauthenticated_web_calls: false } } }) : reply(200, {})));
    await telnyxProvider.enableWebCall!("assistant-2");
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(calls[1].body).toEqual({ telephony_settings: { default_texml_app_id: "app-9", supports_unauthenticated_web_calls: true } });
    stub(() => reply(200, { data: { telephony_settings: { supports_unauthenticated_web_calls: true } } }));
    await telnyxProvider.enableWebCall!("assistant-1");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  test("Telnyx: an assistant that isn't there is a clear message, not a call button that never connects", async () => {
    stub(() => reply(404, { errors: [{ detail: "not found" }] }));
    await expect(telnyxProvider.webCall("gone")).rejects.toThrow(/isn't set up on the phone service yet/);
  });

  test("Vapi: a missing assistant is a clear message; a missing public key too; a slow Vapi lets the browser try", async () => {
    process.env.VAPI_PUBLIC_KEY = "pk-test-0000000000";
    stub(() => reply(404, { message: "Not Found" }));
    await expect(vapiProvider.webCall("gone")).rejects.toThrow(/isn't set up on Vapi yet/);
    stub(() => reply(200, { id: "a-1" }));
    expect(await vapiProvider.webCall("a-1")).toEqual({ provider: "vapi", assistantId: "a-1", publicKey: "pk-test-0000000000" });
    expect(calls[0].url).toBe("https://api.vapi.ai/assistant/a-1");
    stub(() => reply(503, { message: "busy" }));
    expect((await vapiProvider.webCall("a-2")).assistantId).toBe("a-2");
    process.env.VAPI_PUBLIC_KEY = "";
    await expect(vapiProvider.webCall("a-3")).rejects.toThrow(/public key/);
  });

  test("a slow phone service is a plain message after the limit, never an endless wait", async () => {
    const started = Date.now();
    await expect(withinSeconds(0.05, "too slow", () => new Promise(() => {}))).rejects.toThrow("too slow");
    expect(Date.now() - started).toBeLessThan(1000);
    await expect(withinSeconds(0.05, "too slow", () => new Promise(() => {}))).rejects.toBeInstanceOf(ValidationError);
    expect(await withinSeconds(1, "too slow", async () => 7)).toBe(7);
  });
});
