// Call summaries: the pure pieces, the decision for one call, and the sync pass against the dev
// database with a pretend phone provider and model (nothing leaves the machine).
//   bun test --env-file=../.env server/callSummary.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { blankSettings, type BookingRequest, type Business, type CallMessage } from "../src/lib/shared";
import { migrate, sql } from "./db";
import { insertClient } from "./store";
import { askModel, MAX_TRIES, MIN_SECONDS, outcomeFromRequests, parseModelReply, QUIET_MS, SKIPPED, summariseCall, summariseEnded, transcriptText, OUTCOMES, type SummaryDeps } from "./callSummary";

const msgs = (...t: [CallMessage["role"], string][]): CallMessage[] => t.map(([role, text], i) => ({ role, text, at: `2026-11-01T10:00:0${i}Z` }));
const talk = msgs(["assistant", "Hi, Alpha Plumbing, how can I help?"], ["user", "My kitchen drain is blocked, can someone come Tuesday?"], ["assistant", "Sure, I can take your details."]);
const call = { id: "c1", providerCallId: "conv-1", from: "+61412345678", startedAt: new Date("2026-11-01T10:00:00Z"), endedAt: new Date("2026-11-01T10:03:00Z"), seconds: 180 };
const req = (over: Partial<BookingRequest>): BookingRequest => ({ id: "r", kind: "booking", at: "2026-11-01T10:02:00Z", channel: "phone", name: "Sam", phone: "0412 345 678", service: "Blocked drain", start: "2026-11-03T14:00:00Z", status: "booked", note: "", ...over });
const deps = (over: Partial<SummaryDeps> = {}): SummaryDeps => ({ detail: async () => ({ summary: "", messages: talk }), model: null, requests: async () => [], ...over });

describe("pure helpers", () => {
  test("outcomes are the values the UI filters on", () => {
    for (const o of ["booked", "callback_requested", "lead_captured", "voicemail", "no_answer", "resolved"]) expect(OUTCOMES).toContain(o as any);
  });
  test("transcript is capped and keeps both ends", () => {
    const long = msgs(["user", "START " + "x".repeat(6000)], ["assistant", "y".repeat(6000) + " END"]);
    const t = transcriptText(long, 1000);
    expect(t.length).toBeLessThan(1020);
    expect(t.startsWith("Caller: START")).toBe(true);
    expect(t.endsWith("END")).toBe(true);
  });
  test("model reply: fenced JSON ok, unknown outcome dropped, junk rejected", () => {
    expect(parseModelReply('```json\n{"summary":"Sam asked about a drain.","outcome":"booked"}\n```')).toEqual({ summary: "Sam asked about a drain.", outcome: "booked" });
    expect(parseModelReply('{"summary":"x","outcome":"mystery"}')?.outcome).toBeNull();
    expect(parseModelReply("sorry, no")).toBeNull();
    expect(parseModelReply('{"summary": ')).toBeNull();
  });
  test("a booking or callback made during the call decides the outcome", () => {
    expect(outcomeFromRequests(call, [req({})])).toBe("booked");
    expect(outcomeFromRequests(call, [req({ kind: "callback", status: "saved" })])).toBe("callback_requested");
    expect(outcomeFromRequests(call, [req({ phone: "0499 000 111" })])).toBeNull();
    expect(outcomeFromRequests(call, [req({ at: "2026-11-01T11:00:00Z" })])).toBeNull();
    expect(outcomeFromRequests({ ...call, from: null }, [req({})])).toBeNull();
  });
});

describe("summariseCall", () => {
  test("short calls are skipped without asking the provider", async () => {
    let asked = false;
    const out = await summariseCall({ ...call, seconds: MIN_SECONDS - 1 }, deps({ detail: async () => { asked = true; return { summary: "", messages: talk }; } }));
    expect(out).toBe("skip");
    expect(asked).toBe(false);
  });
  test("a call where the caller said nothing is skipped", async () => {
    expect(await summariseCall(call, deps({ detail: async () => ({ summary: "", messages: msgs(["assistant", "Hello? Anyone there? Please say something."]) }) }))).toBe("skip");
  });
  test("Telnyx's own insight is used and the model is not called", async () => {
    let modelCalls = 0;
    const out = await summariseCall(call, deps({ detail: async () => ({ summary: "  Sam booked a drain job. ", messages: talk }), requests: async () => [req({})], model: async () => { modelCalls++; return "{}"; } }));
    expect(out).toEqual({ summary: "Sam booked a drain job.", outcome: "booked" });
    expect(modelCalls).toBe(0);
  });
  test("with no insight the model writes the summary and picks the outcome", async () => {
    let seen = "";
    const out = await summariseCall(call, deps({ model: async (t) => { seen = t; return '{"summary":"Sam rang about a blocked drain.","outcome":"lead_captured"}'; } }));
    expect(out).toEqual({ summary: "Sam rang about a blocked drain.", outcome: "lead_captured" });
    expect(seen).toContain("Caller: My kitchen drain");
  });
  test("our own records beat the model on outcome", async () => {
    const out = await summariseCall(call, deps({ requests: async () => [req({})], model: async () => '{"summary":"s","outcome":"resolved"}' }));
    expect(out).not.toBe("skip");
    expect((out as any).outcome).toBe("booked");
  });
  test("no model configured: still returns what we know", async () => {
    expect(await summariseCall(call, deps({ requests: async () => [req({})] }))).toEqual({ summary: null, outcome: "booked" });
  });
});

describe("askModel", () => {
  test("posts to OpenRouter with the chat key, without leaking the key in errors", async () => {
    process.env.OPENROUTER_API_KEY = "sk-secret";
    let sent: any;
    const ok = (async (_u: any, init: any) => { sent = { url: String(_u), body: JSON.parse(init.body), auth: init.headers.Authorization }; return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"s"}' } }] })); }) as any;
    expect(await askModel("Caller: hi", ok)).toBe('{"summary":"s"}');
    expect(sent.url).toContain("openrouter.ai");
    expect(sent.auth).toBe("Bearer sk-secret");
    const bad = (async () => new Response("secret body sk-secret", { status: 500 })) as any;
    await expect(askModel("x", bad)).rejects.toThrow("answered 500");
    await askModel("x", bad).catch((e) => expect(String(e)).not.toContain("sk-secret"));
  });
});

describe("summariseEnded (database)", () => {
  const orgId = crypto.randomUUID();
  const client = (): Business => {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), assistantId: "assistant-" + crypto.randomUUID().slice(0, 8), settings: { ...blankSettings(), businessName: "Alpha Plumbing" }, instructions: "x", phoneNumbers: ["+61400000001"], createdAt: now, updatedAt: now } as Business;
  };
  const a = client();
  const b = client();
  const rec = (c: Business) => ({ id: c.id, org_id: orgId, assistant_id: c.assistantId });
  let ready = true;
  const min = (n: number) => new Date(Date.now() - n * 60_000);
  const add = async (cl: Business, id: string, over: { ended?: Date | null; secs?: number; summary?: string | null; tries?: number } = {}) => {
    const ended = over.ended === undefined ? min(10) : over.ended;
    await sql`insert into call_log (org_id, client_id, provider_call_id, provider, from_number, started_at, ended_at, duration_seconds, summary, summary_tries)
      values (${orgId}, ${cl.id}, ${id}, 'telnyx', '+61412345678', ${min(14)}, ${ended}, ${over.secs ?? 120}, ${over.summary ?? null}, ${over.tries ?? 0})`;
  };
  const row = async (id: string) => (await sql`select summary, outcome, summary_tries from call_log where provider_call_id = ${id}`)[0] as any;

  beforeAll(async () => {
    try {
      await migrate();
      await sql`insert into orgs (id, name) values (${orgId}, 'summary test')`;
      await insertClient(orgId, a);
      await insertClient(orgId, b);
    } catch (err) {
      ready = false;
      console.error("summary db tests need the dev database:", (err as Error).message);
    }
  }, 120_000);
  afterAll(async () => {
    await sql`delete from clients where org_id = ${orgId}`.catch(() => {});
    await sql`delete from orgs where id = ${orgId}`.catch(() => {});
  }, 30_000);

  const model = async () => '{"summary":"Sam rang about a drain.","outcome":"lead_captured"}';

  test("summarises ended calls once, ignores running, recent-quiet, already-done and other receptionists' calls", async () => {
    expect(ready).toBe(true);
    await add(a, "ok-1");
    await add(a, "running-1", { ended: null });
    await add(a, "justended-1", { ended: new Date(Date.now() - QUIET_MS + 60_000) });
    await add(a, "done-1", { summary: "Already written." });
    await add(b, "other-1");
    const asked: string[] = [];
    const detail = async (id: string) => { asked.push(id); return { summary: "", messages: talk }; };
    expect(await summariseEnded(rec(a), { detail, model, requests: async () => [] })).toBe(1);
    expect(asked).toEqual(["ok-1"]);
    expect((await row("ok-1")).summary).toBe("Sam rang about a drain.");
    expect((await row("ok-1")).outcome).toBe("lead_captured");
    expect((await row("running-1")).summary).toBeNull();
    expect((await row("justended-1")).summary).toBeNull();
    expect((await row("done-1")).summary).toBe("Already written.");
    expect((await row("other-1")).summary).toBeNull();
    // A second pass does nothing more for it.
    expect(await summariseEnded(rec(a), { detail, model, requests: async () => [] })).toBe(0);
    expect(asked).toEqual(["ok-1"]);
  });

  test("short calls are marked skipped and never retried", async () => {
    await add(a, "short-1", { secs: 5 });
    let asked = 0;
    await summariseEnded(rec(a), { detail: async () => { asked++; return { summary: "", messages: talk }; }, model, requests: async () => [] });
    expect((await row("short-1")).summary_tries).toBe(SKIPPED);
    expect(asked).toBe(0);
  });

  test("a failing call is counted, the others still done, the error surfaces, and it stops after MAX_TRIES", async () => {
    await add(a, "bad-1");
    await add(a, "good-2");
    const detail = async (id: string) => { if (id === "bad-1") throw new Error("provider down"); return { summary: "", messages: talk }; };
    await expect(summariseEnded(rec(a), { detail, model, requests: async () => [] })).rejects.toThrow("provider down");
    expect((await row("good-2")).summary).toBe("Sam rang about a drain.");
    expect((await row("bad-1")).summary_tries).toBe(1);
    await sql`update call_log set summary_tries = ${MAX_TRIES} where provider_call_id = 'bad-1'`;
    expect(await summariseEnded(rec(a), { detail, model, requests: async () => [] })).toBe(0);
  });

  test("Vapi calls get a summary and an outcome too: Vapi's own summary is kept, the model fills the outcome", async () => {
    const v = { ...rec(a), voice_provider: "vapi" };
    const addV = (id: string, summary: string | null, outcome: string | null) =>
      sql`insert into call_log (org_id, client_id, provider_call_id, provider, from_number, started_at, ended_at, duration_seconds, summary, outcome)
        values (${orgId}, ${a.id}, ${id}, 'vapi', '+61412345678', ${min(14)}, ${min(10)}, 120, ${summary}, ${outcome})`;
    await addV("v-bare", null, null);
    await addV("v-own-summary", "Vapi's own words.", null);
    await addV("v-complete", "Booked it.", "booked");
    const asked: string[] = [];
    const detail = async (id: string) => { asked.push(id); return { summary: "", messages: talk }; };
    expect(await summariseEnded(v, { detail, model, requests: async () => [] })).toBe(2);
    expect(asked.sort()).toEqual(["v-bare", "v-own-summary"]);
    expect(await row("v-bare")).toMatchObject({ summary: "Sam rang about a drain.", outcome: "lead_captured" });
    expect(await row("v-own-summary")).toMatchObject({ summary: "Vapi's own words.", outcome: "lead_captured" });
    expect(await row("v-complete")).toMatchObject({ summary: "Booked it.", outcome: "booked" });
    // A Vapi receptionist never touches Telnyx's calls, nor the reverse.
    await add(a, "t-1");
    expect(await summariseEnded(v, { detail: async () => ({ summary: "", messages: talk }), model, requests: async () => [] })).toBe(0);
    expect((await row("t-1")).summary).toBeNull();
    await sql`delete from call_log where provider_call_id = 't-1'`;
  });

  test("web chats are left alone", async () => {
    await sql`insert into call_log (org_id, client_id, provider_call_id, provider, channel, started_at, ended_at, duration_seconds) values (${orgId}, ${a.id}, 'web-1', 'telnyx', 'web', ${min(14)}, ${min(10)}, 120)`;
    expect(await summariseEnded({ ...rec(a), voice_provider: "vapi" }, { detail: async () => ({ summary: "", messages: talk }), model })).toBe(0);
    expect(await summariseEnded(rec(a), { detail: async () => ({ summary: "", messages: talk }), model })).toBe(0);
    expect((await row("web-1")).summary).toBeNull();
  });
});
