// Scrubbing, kinds, the log ring, and the heartbeat's list shape (arrays). No database.
//   bun test --env-file=../.env server/problems.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { RING_SIZE, classifyError, clearLogRing, mergeProblems, pushLog, recentLogs, scrub } from "./problems";
import { SHAPE, assertWhitelisted, cleanSnapshot } from "./supportSync";

describe("scrub: numbers, emails, links, keys and anything quoted are masked", () => {
  const cases: [string, string[]][] = [
    ["Couldn't text +61 412 345 678 about the booking", ["61 412", "345 678", "412345678"]],
    ["Text-back failed for 0412345678", ["0412345678"]],
    ["Failed to email jane.citizen@example.com: mailbox full", ["jane", "example.com"]],
    ["Fetch https://api.example.com/v1/x?token=abcdef failed", ["api.example.com", "abcdef"]],
    ['Couldn\'t apply automation "Jane\'s Plumbing follow-up"', ["Jane", "Plumbing"]],
    ["Couldn't update 'Smith & Sons' hours", ["Smith", "Sons"]],
    ["Telnyx said invalid key KEY0123456789012345678901_abcdefghijk", ["KEY01234", "abcdefghijk"]],
    ["Authorization: Bearer sk_live_abcdef1234567890 rejected", ["sk_live", "abcdef"]],
    ["password=hunter2hunter2 was wrong", ["hunter2"]],
    ["call 0a1b2c3d-1111-2222-3333-444455556666 failed", ["0a1b2c3d", "4444555"]],
    ["connect ECONNREFUSED 10.1.2.3:5432", ["10.1.2.3"]],
    ["Caller said: I need my tax records", []],
  ];
  for (const [input, gone] of cases) {
    test(input.slice(0, 50), () => {
      const out = scrub(input);
      for (const g of gone) expect(out).not.toContain(g);
      expect(out).not.toMatch(/\d{5,}/);
      expect(out).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    });
  }
  test("what is useful stays, and long text is cut", () => {
    expect(scrub("Telnyx answered 502 for the texting profile")).toBe("Telnyx answered 502 for the texting profile");
    expect(scrub("x".repeat(500)).length).toBeLessThanOrEqual(200);
    expect(scrub("first line\nsecond line has a stack at /srv/app.ts:12")).toBe("first line");
    expect(scrub(null)).toBe("");
    expect(scrub({ a: 1 })).not.toContain("{");
  });
});

describe("classifying console.error lines", () => {
  test("tags map to the kinds the admin shows", () => {
    expect(classifyError("[booking abc] couldn't log x")?.kind).toBe("booking_sync");
    expect(classifyError("[startup sync] boom")?.kind).toBe("booking_sync");
    expect(classifyError("[text-back c1] failed")?.kind).toBe("text_failed");
    expect(classifyError("[texting a1] failed")?.kind).toBe("text_failed");
    expect(classifyError("[mail] invite smtp down")?.kind).toBe("email_failed");
    expect(classifyError("[email 12] nope")?.kind).toBe("email_failed");
    expect(classifyError("[telnyx 502] bad gateway")?.kind).toBe("provider_api");
    expect(classifyError("[vapi 401] no")?.kind).toBe("provider_api");
    expect(classifyError("[assistant] provider answered 500")?.kind).toBe("provider_api");
    expect(classifyError("[automations x] apply failed")?.kind).toBe("automation_apply");
    expect(classifyError("[call sync] failed")?.kind).toBe("call_sync");
    expect(classifyError("[update] failed")?.kind).toBe("update_failed");
    expect(classifyError("Error: kaboom")?.kind).toBe("server_error");
    expect(classifyError("[something odd] failed")?.kind).toBe("server_error");
  });
  test("our own plumbing is never a problem", () => {
    for (const l of ["[support sync] heartbeat failed: TimeoutError", "[incident x] insert failed", "[audit y] nope", "[problems] collect"]) expect(classifyError(l)).toBeNull();
  });
  test("the message is scrubbed", () => {
    expect(classifyError("[texting a1] to +61412345678 failed")!.msg).not.toContain("61412345678");
  });
});

describe("merging into the list the heartbeat carries", () => {
  const t = (m: number) => new Date(Date.UTC(2026, 10, 27, 10, m)).toISOString();
  test("same kind and message add up; newest first; at most 50", () => {
    const rows = [
      { kind: "text_failed", msg: "Text-back failed", count: 2, last: t(5) },
      { kind: "text_failed", msg: "Text-back failed", count: 3, last: t(9) },
      { kind: "booking_sync", msg: "sync failed", count: 1, last: t(7) },
    ];
    const out = mergeProblems(rows);
    expect(out).toEqual([
      { kind: "text_failed", msg: "Text-back failed", count: 5, last: t(9) },
      { kind: "booking_sync", msg: "sync failed", count: 1, last: t(7) },
    ]);
    const many = Array.from({ length: 80 }, (_, i) => ({ kind: "server_error", msg: `error ${i}x`, count: 1, last: t(i % 60) }));
    expect(mergeProblems(many)).toHaveLength(50);
  });
  test("messages are scrubbed again on the way out, odd kinds are cleaned", () => {
    const [p] = mergeProblems([{ kind: "Weird Kind!", msg: "failed for jane@example.com on 0412345678", count: 1, last: t(1) }]);
    expect(p.kind).toBe("weird_kind_");
    expect(p.msg).not.toContain("jane");
    expect(p.msg).not.toContain("0412345678");
  });
});

describe("the log ring", () => {
  beforeEach(() => clearLogRing());
  test("keeps the last 200 lines, scrubbed", () => {
    for (let i = 0; i < 260; i++) pushLog("log", `line ${i} for +61412345678`);
    const lines = recentLogs();
    expect(lines).toHaveLength(RING_SIZE);
    expect(lines[0].line).toContain("line 60");
    expect(lines[199].line).toContain("line 259");
    expect(JSON.stringify(lines)).not.toContain("61412345678");
  });
  test("levels and times are kept", () => {
    pushLog("error", "[telnyx 500] bad");
    expect(recentLogs()[0]).toMatchObject({ level: "error", line: "[telnyx 500] bad" });
    expect(Date.parse(recentLogs()[0].at)).toBeGreaterThan(0);
  });
});

describe("SHAPE: arrays", () => {
  const base = () => cleanSnapshot({ v: 1 })!;
  const item = (i: number) => ({ kind: "text_failed", msg: `Text failed ${i}`, count: 2, last: "2026-11-27T10:00:00.000Z" });
  test("a list is kept item by item, cut at 50, and unknown fields in items are dropped", () => {
    const snap = cleanSnapshot({ v: 1, problems: Array.from({ length: 70 }, (_, i) => ({ ...item(i), transcript: "hello", callerName: "Jane" })) })!;
    expect(snap.problems).toHaveLength(50);
    expect(Object.keys(snap.problems[0]).sort()).toEqual(["count", "kind", "last", "msg"]);
    expect(JSON.stringify(snap)).not.toContain("hello");
    expect(() => assertWhitelisted(snap)).not.toThrow();
  });
  test("not a list: empty. Not objects: blanked.", () => {
    expect(cleanSnapshot({ v: 1, problems: "nope" })!.problems).toEqual([]);
    expect(cleanSnapshot({ v: 1, problems: { 0: item(1) } })!.problems).toEqual([]);
    expect(cleanSnapshot({ v: 1, problems: [null, 5, "x"] })!.problems).toHaveLength(3);
    expect(cleanSnapshot({ v: 1, problems: [null] })!.problems[0]).toEqual({ kind: "", msg: "", count: 0, last: "" });
  });
  test("personal details in an item are blanked; bad kinds and times too", () => {
    const [p] = cleanSnapshot({ v: 1, problems: [{ kind: "Text Failed!", msg: "to jane@example.com", count: 1, last: "yesterday" }] })!.problems;
    expect(p).toEqual({ kind: "", msg: "", count: 1, last: "" });
  });
  test("the whitelist check catches a leaking item or too many", () => {
    const ok = base();
    expect(() => assertWhitelisted({ ...ok, problems: [{ ...item(1), caller: "x" }] })).toThrow(/whitelist/);
    expect(() => assertWhitelisted({ ...ok, problems: [{ ...item(1), msg: "call +61 412 345 678" }] })).toThrow(/personal/);
    expect(() => assertWhitelisted({ ...ok, problems: Array.from({ length: 51 }, (_, i) => item(i)) })).toThrow(/more than 50/);
    expect(() => assertWhitelisted({ ...ok, problems: "x" })).toThrow(/list/);
  });
  test("the new top-level fields are in SHAPE", () => {
    for (const k of ["updates", "problems"]) expect(Object.keys(SHAPE)).toContain(k);
    expect(Object.keys(base()).sort()).toEqual(Object.keys(SHAPE).sort());
    expect(base().updates).toEqual({ available: false, enabled: false, mode: "", latest: "", lastResult: "", lastError: "", lastAt: null });
  });
  test("the update fields only take their fixed words", () => {
    const u = cleanSnapshot({ v: 1, updates: { available: true, enabled: true, mode: "whenever", latest: "1.2 3", lastResult: "maybe", lastError: "token abc was bad for jane@example.com", lastAt: "x" } })!.updates;
    expect(u).toMatchObject({ available: true, enabled: true, mode: "", latest: "", lastResult: "", lastError: "", lastAt: null });
    expect(cleanSnapshot({ v: 1, updates: { mode: "asap", lastResult: "failed", latest: "2026.11.9" } })!.updates).toMatchObject({ mode: "asap", lastResult: "failed", latest: "2026.11.9" });
  });
});
