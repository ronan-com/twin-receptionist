// Helper (the dashboard's AI helper): who may use it, the page allow-list, confirm-before-write,
// org scoping and the missing-key message. OpenRouter is mocked; no database, no providers.
//   bun test server/helper.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HELPER_NO_KEY, HELPER_PAGES, allowedPath, forgetPending, helperRoute, hoursOf, planCreate, planUpdate, type CreateArgs, type HelperDeps, type UpdateArgs } from "./helper";
import { createLimiter, type AgencySnapshot, type AssistantCtx } from "./assistant";
import { ValidationError } from "./prompt";
import type { Business } from "../src/lib/shared";
import { defaultHours } from "../src/lib/shared";

const CLIENT = "11111111-1111-1111-1111-111111111111";
const REC = "22222222-2222-2222-2222-222222222222";
const snap: AgencySnapshot = {
  agency: "Bright Calls", role: "owner", phone: "own", singleAgency: false, brandSet: true, testCallMade: false,
  receptionists: 1, numbers: 1, pendingNumberRequests: 0, openIncidents: 0, clientTotal: 1,
  clients: [{ id: CLIENT, name: "Sunny Days", receptionists: 1, numbers: 1, customers: 0, pendingInvites: 0, onboardingPending: false, paused: false, calls30d: 3 }],
};
const rec = { id: REC, settings: { businessName: "Sunny Days", industry: "dental", greeting: "Hi", services: ["Check-up"], hours: defaultHours("dental") }, phoneNumbers: ["+61412000111"], pendingNumbers: [] } as unknown as Business;

const owner: AssistantCtx = { user: { id: "u1", platformAdmin: false }, org: { id: "o1" }, role: "owner" };
const otherUser: AssistantCtx = { user: { id: "u2", platformAdmin: false }, org: { id: "o1" }, role: "admin" };
const otherOrg: AssistantCtx = { user: { id: "u1", platformAdmin: false }, org: { id: "o2" }, role: "owner" };

type Calls = { created: CreateArgs[]; updated: UpdateArgs[]; llm: any[] };
function setup(replies: any[]): { deps: HelperDeps; calls: Calls } {
  const calls: Calls = { created: [], updated: [], llm: [] };
  const queue = [...replies];
  const fetchMock = (async (_u: string, init: any) => {
    calls.llm.push(JSON.parse(init.body));
    const message = queue.shift() ?? { content: "ok" };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const deps: HelperDeps = {
    fetch: fetchMock,
    limiter: createLimiter(100, 60_000),
    speakLimiter: createLimiter(100, 60_000),
    product: "Chloe",
    snapshot: async () => snap,
    receptionists: async () => [rec],
    create: async (a) => (calls.created.push(a), { id: "new", businessName: a.businessName, clientPage: `/admin/clients/${CLIENT}` }),
    update: async (a) => (calls.updated.push(a), { businessName: "Sunny Days" }),
  };
  return { deps, calls };
}
const toolCall = (name: string, args: unknown, id = "c1") => ({ content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const post = (path: string, body: unknown) => new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const chat = (text = "hi") => post("/api/helper/chat", { messages: [{ role: "user", content: text }], route: "/admin" });

const ENV = process.env.OPENROUTER_API_KEY;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key-not-real";
  forgetPending();
});
afterEach(() => {
  if (ENV === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = ENV;
});

describe("who may use it", () => {
  test("signed out is 401, a client user or platform admin or read-only view is 403, a GET is 404", async () => {
    const { deps } = setup([]);
    expect((await helperRoute(chat(), "/api/helper/chat", null, deps)).status).toBe(401);
    expect((await helperRoute(chat(), "/api/helper/chat", { ...owner, role: "customer" }, deps)).status).toBe(403);
    expect((await helperRoute(chat(), "/api/helper/chat", { ...owner, user: { id: "p", platformAdmin: true } }, deps)).status).toBe(403);
    expect((await helperRoute(chat(), "/api/helper/chat", { ...owner, viewing: { org: "x" } } as AssistantCtx, deps)).status).toBe(403);
    expect((await helperRoute(new Request("http://x/api/helper/chat"), "/api/helper/chat", owner, deps)).status).toBe(404);
    expect((await helperRoute(post("/api/helper/confirm", { id: "x" }), "/api/helper/confirm", null, deps)).status).toBe(401);
    expect((await helperRoute(post("/api/helper/speak", { text: "x" }), "/api/helper/speak", null, deps)).status).toBe(401);
  });
});

describe("no AI key", () => {
  test("says so in the chat, with a button to Connections, and never calls the AI", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { deps, calls } = setup([]);
    const res = await helperRoute(chat(), "/api/helper/chat", owner, deps);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.reply).toBe(HELPER_NO_KEY);
    expect(j.reply).toContain("Settings → Connections");
    expect(j.actions[0]).toEqual({ type: "offer", path: "/admin/connections", label: "Open Connections" });
    expect(calls.llm.length).toBe(0);
  });
});

describe("answers and tools", () => {
  test("a plain question gets a reply; the model is given the tools and the agency summary", async () => {
    const { deps, calls } = setup([{ content: "Open **Clients**." }]);
    const j = await (await helperRoute(chat("where are clients?"), "/api/helper/chat", owner, deps)).json();
    expect(j.reply).toBe("Open **Clients**.");
    expect(j.actions).toEqual([]);
    const sent = calls.llm[0];
    expect(sent.tools.map((t: any) => t.function.name).sort()).toEqual(["create_receptionist", "list_clients", "list_numbers", "list_receptionists", "open_page", "update_receptionist"]);
    expect(JSON.stringify(sent.messages)).toContain("Sunny Days");
    expect(JSON.stringify(sent)).not.toContain("test-key-not-real");
  });

  test("open_page: an allow-listed page navigates, anything else is refused to the model", async () => {
    const ok = setup([toolCall("open_page", { path: "/admin/calls" }), { content: "Here are your calls." }]);
    const j = await (await helperRoute(chat(), "/api/helper/chat", owner, ok.deps)).json();
    expect(j.actions).toEqual([{ type: "navigate", path: "/admin/calls", label: "Calls" }]);

    for (const bad of ["/admin/agencies", "https://evil.example", "//evil.example", "/admin/clients/99999999-9999-9999-9999-999999999999", "/api/session", "javascript:alert(1)", "/admin/../api"]) {
      const t = setup([toolCall("open_page", { path: bad }), { content: "Sorry." }]);
      const r = await (await helperRoute(chat(), "/api/helper/chat", owner, t.deps)).json();
      expect(r.actions).toEqual([]);
      expect(JSON.stringify(t.calls.llm[1].messages.at(-1))).toContain("isn't available");
    }
    const own = setup([toolCall("open_page", { path: `/admin/clients/${CLIENT}` }), { content: "Done." }]);
    expect((await (await helperRoute(chat(), "/api/helper/chat", owner, own.deps)).json()).actions[0].path).toBe(`/admin/clients/${CLIENT}`);
  });

  test("the allow-list is real routes: every page exists in the route tree", () => {
    const tree = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
    const full = tree.slice(tree.indexOf("fullPaths:"), tree.indexOf("fileRoutesByTo: FileRoutesByTo"));
    for (const p of HELPER_PAGES) {
      const base = p.path.split("?")[0];
      // (index routes are listed with a trailing slash)
      expect(full.includes(`'${base}'`) || full.includes(`'${base}/'`)).toBe(true);
    }
    expect(allowedPath("/admin/agencies", snap)).toBeNull(); // platform-only
  });

  test("list tools read this agency's data", async () => {
    const t = setup([toolCall("list_receptionists", {}), toolCall("list_numbers", {}), toolCall("list_clients", {}), { content: "You have one." }]);
    await helperRoute(chat(), "/api/helper/chat", owner, t.deps);
    const results = t.calls.llm.flatMap((c) => c.messages).filter((m: any) => m.role === "tool").map((m: any) => m.content).join("\n");
    expect(results).toContain(REC);
    expect(results).toContain("+61412000111");
    expect(results).toContain("Sunny Days");
  });

  test("a model that never stops calling tools is cut off", async () => {
    const t = setup(Array.from({ length: 12 }, () => toolCall("list_clients", {})));
    const j = await (await helperRoute(chat(), "/api/helper/chat", owner, t.deps)).json();
    expect(t.calls.llm.length).toBe(5);
    expect(typeof j.reply).toBe("string");
  });

  test("an AI outage is a plain message, not a crash", async () => {
    const { deps } = setup([]);
    deps.fetch = (async () => new Response("x", { status: 503 })) as unknown as typeof fetch;
    const res = await helperRoute(chat(), "/api/helper/chat", owner, deps);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("busy");
  });

  test("rate limited", async () => {
    const { deps } = setup([]);
    deps.limiter = createLimiter(1, 60_000);
    expect((await helperRoute(chat(), "/api/helper/chat", owner, deps)).status).toBe(200);
    const res = await helperRoute(chat(), "/api/helper/chat", owner, deps);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("confirm before any write", () => {
  const create = { business_name: "Bondi Physio", business_type: "physio", greeting: "G'day, Bondi Physio.", services: ["Initial consult"], hours: [{ days: ["mon", "tue"], from: "09:00", to: "17:00" }], faqs: [{ q: "Parking?", a: "Out the front." }] };

  test("create_receptionist only makes a card; nothing is written until Do it", async () => {
    const t = setup([toolCall("create_receptionist", create), { content: "I've set that up for you to check." }]);
    const j = await (await helperRoute(chat("make a physio"), "/api/helper/chat", owner, t.deps)).json();
    expect(t.calls.created.length).toBe(0);
    const card = j.actions[0];
    expect(card.type).toBe("confirm");
    expect(card.title).toBe('Create receptionist "Bondi Physio"?');
    expect(card.lines.join("\n")).toContain("Mon-Tue 09:00-17:00");
    expect(card.lines.join("\n")).toContain("Parking?");

    const done = await helperRoute(post("/api/helper/confirm", { id: card.id }), "/api/helper/confirm", owner, t.deps);
    expect(done.status).toBe(200);
    expect(t.calls.created.length).toBe(1);
    expect(t.calls.created[0]).toMatchObject({ businessName: "Bondi Physio", industry: "physio", services: ["Initial consult"], faqs: [{ q: "Parking?", a: "Out the front." }] });
    expect((await done.json()).navigate).toBe(`/admin/clients/${CLIENT}`);

    // One use only.
    expect((await helperRoute(post("/api/helper/confirm", { id: card.id }), "/api/helper/confirm", owner, t.deps)).status).toBe(404);
    expect(t.calls.created.length).toBe(1);
  });

  test("Cancel writes nothing and uses up the card", async () => {
    const t = setup([toolCall("create_receptionist", create), { content: "ok" }]);
    const j = await (await helperRoute(chat(), "/api/helper/chat", owner, t.deps)).json();
    const id = j.actions[0].id;
    expect((await (await helperRoute(post("/api/helper/confirm", { id, cancel: true }), "/api/helper/confirm", owner, t.deps)).json()).cancelled).toBe(true);
    expect((await helperRoute(post("/api/helper/confirm", { id }), "/api/helper/confirm", owner, t.deps)).status).toBe(404);
    expect(t.calls.created.length + t.calls.updated.length).toBe(0);
  });

  test("a card belongs to one person in one agency: others can't confirm it", async () => {
    const t = setup([toolCall("update_receptionist", { receptionist_id: REC, greeting: "Hello there" }), { content: "ok" }]);
    const j = await (await helperRoute(chat(), "/api/helper/chat", owner, t.deps)).json();
    const id = j.actions[0].id;
    expect((await helperRoute(post("/api/helper/confirm", { id }), "/api/helper/confirm", otherUser, t.deps)).status).toBe(404);
    expect((await helperRoute(post("/api/helper/confirm", { id }), "/api/helper/confirm", otherOrg, t.deps)).status).toBe(404);
    expect(t.calls.updated.length).toBe(0);
    expect((await helperRoute(post("/api/helper/confirm", { id }), "/api/helper/confirm", owner, t.deps)).status).toBe(200);
    expect(t.calls.updated).toEqual([{ receptionistId: REC, greeting: "Hello there", addFaqs: [] }]);
  });

  test("a made-up id or a missing id confirms nothing", async () => {
    const { deps, calls } = setup([]);
    for (const id of ["", "nope", crypto.randomUUID()]) expect((await helperRoute(post("/api/helper/confirm", { id }), "/api/helper/confirm", owner, deps)).status).toBe(404);
    expect(calls.created.length + calls.updated.length).toBe(0);
  });

  test("update_receptionist for a receptionist outside this agency is refused to the model", async () => {
    const other = "33333333-3333-3333-3333-333333333333";
    const t = setup([toolCall("update_receptionist", { receptionist_id: other, greeting: "x" }), { content: "Can't find it." }]);
    const j = await (await helperRoute(chat(), "/api/helper/chat", owner, t.deps)).json();
    expect(j.actions).toEqual([]);
    expect(JSON.stringify(t.calls.llm[1].messages.at(-1))).toContain("isn't one of this agency's receptionists");
  });

  test("create_receptionist with another agency's client id is refused", () => {
    expect(() => planCreate({ business_name: "Bondi Physio", client_id: "44444444-4444-4444-4444-444444444444" }, snap)).toThrow(ValidationError);
    expect(planCreate({ business_name: "Bondi Physio", client_id: CLIENT }, snap).lines[0]).toContain("Sunny Days");
  });

  test("a failing write comes back as an error, not a success", async () => {
    const t = setup([toolCall("create_receptionist", create), { content: "ok" }]);
    t.deps.create = async () => {
      throw new ValidationError("Connect your phone account first.");
    };
    const j = await (await helperRoute(chat(), "/api/helper/chat", owner, t.deps)).json();
    await expect(helperRoute(post("/api/helper/confirm", { id: j.actions[0].id }), "/api/helper/confirm", owner, t.deps)).rejects.toThrow("Connect your phone account first.");
  });
});

describe("checking what the model asked for", () => {
  test("hours", () => {
    expect(hoursOf("always").sun).toEqual({ open: true, from: "00:00", to: "23:59" });
    const h = hoursOf([{ days: ["Monday", "fri"], from: "08:30", to: "16:00" }]);
    expect(h.mon.open && h.fri.open && !h.tue.open).toBe(true);
    for (const bad of [[{ days: ["mon"], from: "17:00", to: "09:00" }], [{ days: ["mon"], from: "9am", to: "5pm" }], [{ days: [], from: "09:00", to: "17:00" }], "weekdays", []]) expect(() => hoursOf(bad)).toThrow(ValidationError);
  });
  test("create needs a business name; services default from the type; unknown types become 'other' with the words kept", () => {
    expect(() => planCreate({}, snap)).toThrow(ValidationError);
    const p = planCreate({ business_name: "Kai's Kayaks", business_type: "kayak hire" }, snap).pending;
    expect(p.tool === "create_receptionist" && p.args.industry).toBe("other");
    expect(p.tool === "create_receptionist" && p.args.industryLabel).toBe("kayak hire");
    expect(p.tool === "create_receptionist" && p.args.services.length).toBeGreaterThan(0);
  });
  test("update needs at least one change; text is cleaned", () => {
    expect(() => planUpdate({ receptionist_id: REC }, [rec])).toThrow("Nothing to change");
    const p = planUpdate({ receptionist_id: REC, greeting: "Hi\n\u0000 there  " }, [rec]).pending;
    expect(p.tool === "update_receptionist" && p.args.greeting).toBe("Hi there");
  });
});

describe("speaking", () => {
  test("no server voice: 204 so the browser's voice takes over; a voice: audio; a failure: 204", async () => {
    const { deps } = setup([]);
    expect((await helperRoute(post("/api/helper/speak", { text: "Hello" }), "/api/helper/speak", owner, deps)).status).toBe(204);
    deps.speak = async () => new Uint8Array([1, 2, 3]);
    const ok = await helperRoute(post("/api/helper/speak", { text: "Hello" }), "/api/helper/speak", owner, deps);
    expect(ok.headers.get("Content-Type")).toBe("audio/mpeg");
    deps.speak = async () => {
      throw new Error("boom");
    };
    expect((await helperRoute(post("/api/helper/speak", { text: "Hello" }), "/api/helper/speak", owner, deps)).status).toBe(204);
  });
});
