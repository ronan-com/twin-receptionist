// Using numbers an agency already owns on its Telnyx account, with Telnyx's API stood in
// for by a fake fetch: what's listed, what attach and detach send, and who may do any of it.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/ownNumbers.test.ts
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { numberFailed, numberIsLive, numberWaiting } from "../src/lib/ownNumbers";

// server/telnyx.ts as it behaves with a plain key (same fetch, same error shape), so another test
// file's stand-in for it can't change what this one checks. The only thing mocked is the network.
// It carries every export of server/telnyx.ts: bun's mock.module is process-wide, so later test
// files get it too (putting the real module back in afterAll breaks voice/telnyx.test.ts's imports).
class TelnyxError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
mock.module("./telnyx", () => ({
  TelnyxError,
  forgetKey: () => {},
  hasKey: () => true,
  enterOrg: () => {},
  currentOrg: () => null,
  runAsOrg: (_org: unknown, fn: () => unknown) => fn(),
  telnyx: async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`https://api.telnyx.com/v2${path}`, { method, headers: { Authorization: "Bearer test" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) throw new TelnyxError(res.status, `The phone service said: ${json?.errors?.[0]?.detail ?? res.statusText}`);
    return json;
  },
}));
const { attachNumber, detachNumber, ownedUnassigned, sampleOwned } = await import("./ownNumbers");
const { ownNumbersAllowed } = await import("./phoneAccount");

const realFetch = globalThis.fetch;
const realKey = process.env.TELNYX_API_KEY;
process.env.TELNYX_API_KEY = "KEYTEST-own-numbers-0000000000";
afterAll(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.TELNYX_API_KEY;
  else process.env.TELNYX_API_KEY = realKey;
});

type Num = { id: string; phone_number: string; phone_number_type?: string; status: string; connection_id: string | null; connection_name?: string | null };
let numbers: Num[] = [];
let calls: { method: string; path: string; body?: any }[] = [];
// Whether Telnyx accepts "" for clearing a connection (when not, only null clears it; "never": neither does).
let clears: "empty" | "null" | "never" = "empty";

const ASSISTANTS: Record<string, string> = { "assistant-a": "app-a", "assistant-b": "app-b" };

function fakeTelnyx() {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v2/, "") + url.search;
    const method = String(init.method ?? "GET");
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: decodeURIComponent(path), body });
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const assistant = path.match(/^\/ai\/assistants\/([^/?]+)/);
    if (assistant) return ASSISTANTS[assistant[1]] ? reply({ data: { telephony_settings: { default_texml_app_id: ASSISTANTS[assistant[1]] } } }) : reply({ errors: [{ detail: "not found" }] }, 404);
    if (method === "GET" && url.pathname === "/v2/phone_numbers") return reply({ data: numbers, meta: { total_pages: 1 } });
    const one = url.pathname.match(/^\/v2\/phone_numbers\/([^/]+)$/);
    if (one) {
      const n = numbers.find((x) => x.id === one[1]);
      if (!n) return reply({ errors: [{ detail: "Resource not found" }] }, 404);
      if (method === "GET") return reply({ data: n });
      if (method === "PATCH") {
        const next = body.connection_id;
        if (next === "" || next === null) {
          if (clears !== (next === "" ? "empty" : "null")) return reply({ errors: [{ detail: "connection_id invalid" }] }, 422);
          n.connection_id = null;
        } else n.connection_id = next;
        return reply({ data: n });
      }
    }
    return reply({ errors: [{ detail: `unexpected ${method} ${path}` }] }, 500);
  }) as typeof fetch;
}

const client = (id: string, assistantId: string, name: string): Business => ({
  id,
  assistantId,
  settings: { ...blankSettings(), businessName: `${name} Plumbing`, receptionistName: name },
  instructions: "",
  phoneNumbers: [],
  createdAt: "",
  updatedAt: "",
});
const alpha = client("11111111-1111-1111-1111-111111111111", "assistant-a", "Alpha");
const beta = client("22222222-2222-2222-2222-222222222222", "assistant-b", "Beta");
const demo = client("33333333-3333-3333-3333-333333333333", "demo-1", "Demo");

const run = <T>(fn: () => Promise<T>) => fn();

beforeEach(() => {
  calls = [];
  clears = "empty";
  numbers = [
    { id: "1001", phone_number: "+61480011201", phone_number_type: "mobile", status: "active", connection_id: "app-a" },
    { id: "1002", phone_number: "+61480011202", phone_number_type: "mobile", status: "active", connection_id: null },
    { id: "1003", phone_number: "+61255501203", phone_number_type: "local", status: "active", connection_id: "sip-9", connection_name: "Old office phones" },
    { id: "1004", phone_number: "+61255501204", phone_number_type: "local", status: "purchase-pending", connection_id: null },
    { id: "1005", phone_number: "+61255501205", phone_number_type: "local", status: "deleted", connection_id: null },
    { id: "1006", phone_number: "+61480011206", phone_number_type: "mobile", status: "active", connection_id: "app-b" },
  ];
  fakeTelnyx();
});

describe("numbers already on the account", () => {
  test("lists the ones none of our receptionists answers, with their connection", async () => {
    const list = await run(() => ownedUnassigned([alpha, beta, demo]));
    expect(list.map((n) => n.phoneNumber)).toEqual(["+61255501203", "+61255501204", "+61480011202"]);
    const moved = list.find((n) => n.id === "1003")!;
    expect(moved).toMatchObject({ type: "local", status: "active", connectionId: "sip-9", connectionName: "Old office phones" });
    expect(list.find((n) => n.id === "1002")).toMatchObject({ connectionId: "", connectionName: "" });
    // Deleted numbers and the ones on our own receptionists' voice apps aren't offered.
    expect(list.some((n) => ["1001", "1005", "1006"].includes(n.id))).toBe(false);
  });

  test("a receptionist Telnyx can't find doesn't hide its number from the list", async () => {
    const lost = client("44444444-4444-4444-4444-444444444444", "assistant-gone", "Lost");
    const list = await run(() => ownedUnassigned([alpha, lost]));
    // Beta isn't in this list, so its number (app-b) shows as free to use; Alpha's stays hidden.
    expect(list.some((n) => n.id === "1001")).toBe(false);
    expect(list.some((n) => n.id === "1006")).toBe(true);
  });

  test("status helpers", () => {
    expect(numberIsLive("active")).toBe(true);
    expect(numberWaiting("purchase-pending")).toBe(true);
    expect(numberWaiting("port-pending")).toBe(true);
    expect(numberWaiting("active")).toBe(false);
    expect(numberFailed("purchase-failed")).toBe(true);
    expect(numberWaiting("purchase-failed")).toBe(false);
  });

  test("local test servers get stand-ins that leave out numbers a receptionist already has", () => {
    expect(sampleOwned([]).length).toBeGreaterThan(0);
    const taken = { ...alpha, phoneNumbers: [sampleOwned([])[0].phoneNumber] };
    expect(sampleOwned([taken]).some((n) => n.phoneNumber === taken.phoneNumbers[0])).toBe(false);
  });
});

describe("attach", () => {
  test("points an unconnected number at the receptionist's voice app", async () => {
    const res = await run(() => attachNumber([alpha, beta], alpha, { numberId: "1002" }));
    expect(res.movedFrom).toBe("");
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.path).toBe("/phone_numbers/1002");
    expect(patch.body).toEqual({ connection_id: "app-a" });
    expect(numbers.find((n) => n.id === "1002")!.connection_id).toBe("app-a");
  });

  test("a number connected elsewhere needs confirm, then says what it moved off", async () => {
    await expect(run(() => attachNumber([alpha], alpha, { numberId: "1003" }))).rejects.toThrow("Old office phones");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    const res = await run(() => attachNumber([alpha], alpha, { numberId: "1003", confirm: true }));
    expect(res.movedFrom).toBe("Old office phones");
    expect(numbers.find((n) => n.id === "1003")!.connection_id).toBe("app-a");
  });

  test("won't take a number from another of our receptionists, or one already here", async () => {
    await expect(run(() => attachNumber([alpha, beta], alpha, { numberId: "1006", confirm: true }))).rejects.toThrow("Beta");
    await expect(run(() => attachNumber([alpha, beta], alpha, { numberId: "1001" }))).rejects.toThrow("already answers");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  test("refuses numbers that aren't on the account, are deleted, or have a bad id", async () => {
    await expect(run(() => attachNumber([alpha], alpha, { numberId: "9999" }))).rejects.toThrow("isn't on your Telnyx account");
    await expect(run(() => attachNumber([alpha], alpha, { numberId: "1005" }))).rejects.toThrow("isn't active");
    await expect(run(() => attachNumber([alpha], alpha, { numberId: "../ai/assistants" }))).rejects.toThrow("Choose one of your numbers");
    await expect(run(() => attachNumber([alpha], alpha, {}))).rejects.toThrow("Choose one of your numbers");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  test("a number still waiting for approval can be connected ahead of time", async () => {
    await run(() => attachNumber([alpha], alpha, { numberId: "1004" }));
    expect(numbers.find((n) => n.id === "1004")!.connection_id).toBe("app-a");
  });
});

describe("detach", () => {
  test("clears the connection and checks it took", async () => {
    const res = await run(() => detachNumber(alpha, { numberId: "1001" }));
    expect(res.connectionId).toBe("");
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ connection_id: "" }]);
    expect(numbers.find((n) => n.id === "1001")!.connection_id).toBeNull();
  });

  test("falls back to null when Telnyx only clears that way", async () => {
    clears = "null";
    await run(() => detachNumber(alpha, { numberId: "1001" }));
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ connection_id: "" }, { connection_id: null }]);
    expect(numbers.find((n) => n.id === "1001")!.connection_id).toBeNull();
  });

  test("says so when Telnyx won't clear it, and leaves the number alone", async () => {
    clears = "never";
    await expect(run(() => detachNumber(alpha, { numberId: "1001" }))).rejects.toThrow("remove its connection there");
    expect(numbers.find((n) => n.id === "1001")!.connection_id).toBe("app-a");
  });

  test("only a number connected to this receptionist", async () => {
    await expect(run(() => detachNumber(alpha, { numberId: "1006" }))).rejects.toThrow("isn't connected to this receptionist");
    await expect(run(() => detachNumber(alpha, { numberId: "1002" }))).rejects.toThrow("isn't connected to this receptionist");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

describe("who may use their own numbers", () => {
  const org = { id: "org-1", name: "Agency" };
  test("an owner or admin on the agency's own account", () => {
    expect(ownNumbersAllowed({ org, role: "owner" }, "own", false)).toBe(true);
    expect(ownNumbersAllowed({ org, role: "admin" }, "own", false)).toBe(true);
  });
  test("never on the platform's key: it sees every agency's numbers", () => {
    expect(ownNumbersAllowed({ org, role: "owner" }, "platform", false)).toBe(false);
    expect(ownNumbersAllowed({ org, role: "admin" }, "none", false)).toBe(false);
  });
  test("not a client login, a member, or someone viewing as another account", () => {
    expect(ownNumbersAllowed({ org, role: "customer" }, "own", false)).toBe(false);
    expect(ownNumbersAllowed({ org, role: "member" }, "own", false)).toBe(false);
    expect(ownNumbersAllowed({ org, role: null }, "own", false)).toBe(false);
    expect(ownNumbersAllowed({ org, role: "owner", viewing: { org: "org-2", client: null, business: "b" } }, "own", false)).toBe(false);
    expect(ownNumbersAllowed({ org: null, role: "owner" }, "own", false)).toBe(false);
  });
  test("a SINGLE_AGENCY install uses the server's key, whatever it's called", () => {
    expect(ownNumbersAllowed({ org, role: "owner" }, "platform", true)).toBe(true);
    expect(ownNumbersAllowed({ org, role: "owner" }, "none", true)).toBe(false);
    expect(ownNumbersAllowed({ org, role: "customer" }, "platform", true)).toBe(false);
  });
});
