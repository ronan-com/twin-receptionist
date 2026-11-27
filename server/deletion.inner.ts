// The checks for deletion.test.ts: deleting a client business, an agency and an account. They run in their own
// bun process against a database of their own (made and dropped by that file). The phone providers are a
// stubbed fetch: nothing here calls Telnyx or Vapi.
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { AuthError, removeMember, type Ctx } from "./accounts";
import { migrate, sql } from "./db";
import { deleteAccountAsPlatform, deleteAgency, deleteCompany, deleteOwnAccount, listAccounts, platformHomeOrg, previewAgencyDelete, previewCompanyDelete } from "./deletion";
import { listAgencies } from "./agencies";
import { blankSettings } from "../src/lib/shared";

// Seeding a full agency is a hundred small inserts; the database may be a tunnel away.
setDefaultTimeout(120_000);

const id = () => crypto.randomUUID();
const KEYS = ["TELNYX_API_KEY", "VAPI_API_KEY", "VAPI_PUBLIC_KEY", "SINGLE_AGENCY"];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
const realFetch = globalThis.fetch;

// ---- the stubbed phone providers ----
let providerCalls: { method: string; url: string }[] = [];
let failing = new Set<string>();
const stub = (async (url: any, init: any) => {
  const u = String(url);
  const method = String(init?.method ?? "GET");
  providerCalls.push({ method, url: u });
  if (method === "DELETE" && [...failing].some((f) => u.endsWith(f))) return new Response(JSON.stringify({ errors: [{ detail: "provider is down" }], message: "provider is down" }), { status: 500 });
  return new Response("{}", { status: 200 });
}) as unknown as typeof fetch;

// ---- people and teams ----
type U = { id: string; email: string; name: string; platformAdmin: boolean };
const person = async (label: string, over: { platformAdmin?: boolean; hash?: string } = {}): Promise<U> => {
  const uid = id();
  const email = `${label}-${uid.slice(0, 6)}@example.com`;
  await sql`insert into users (id, email, name, password_hash, platform_admin) values (${uid}, ${email}, ${label}, ${over.hash ?? "x"}, ${over.platformAdmin === true})`;
  return { id: uid, email, name: label, platformAdmin: over.platformAdmin === true };
};
const team = async (name: string, created = new Date().toISOString(), sandbox = false) => {
  const oid = id();
  await sql`insert into orgs (id, name, platform_telnyx, created_at, sandbox) values (${oid}, ${name}, true, ${created}, ${sandbox})`;
  return oid;
};
const join = (orgId: string, u: U, role: string) => sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${u.id}, ${role})`;
const ctxOf = (u: U, org: { id: string; name: string } | null, role: Ctx["role"], extra: Partial<Ctx> = {}): Ctx => ({ tokenHash: `t-${u.id}`, user: u, org, role, ...extra });
const session = (u: U, orgId: string | null) => sql`insert into sessions (token_hash, user_id, org_id, expires_at) values (${id()}, ${u.id}, ${orgId}, now() + interval '1 day')`;

// ---- a receptionist with a row in every table that points at a client ----
const NUMBER = "+61412000999";
async function seedClient(orgId: string, companyId: string, provider: "telnyx" | "vapi", opts: { customer?: U; number?: string } = {}) {
  const cid = id();
  const assistantId = `asst-${cid.slice(0, 8)}`;
  const now = new Date().toISOString();
  const data = {
    id: cid,
    assistantId,
    settings: { ...blankSettings(), businessName: "Acme", receptionistName: `Rec ${cid.slice(0, 4)}` },
    instructions: "x",
    phoneNumbers: opts.number ? [opts.number] : [],
    voiceProvider: provider,
    createdAt: now,
    updatedAt: now,
  };
  await sql`insert into clients (id, org_id, data, connect_token_hash, created_at, updated_at, company_id) values (${cid}, ${orgId}, ${data as any}, null, ${now}, ${now}, ${companyId})`;
  const conv = id();
  const ticket = id();
  // Concurrent: the database's disk is slow to commit one row at a time.
  await Promise.all([
    sql`insert into mailboxes (client_id, data) values (${cid}, ${{} as any})`,
    sql`insert into booking_requests (client_id, data) values (${cid}, ${{ kind: "booking" } as any})`,
    sql`insert into calendar_links (client_id, provider, account, secret) values (${cid}, 'google', 'a@b.c', 's')`,
    sql`insert into calendar_events (id, client_id, starts_at, ends_at, title) values (${id()}, ${cid}, now(), now(), 'x')`,
    sql`insert into number_requests (id, org_id, client_id, kind) values (${id()}, ${orgId}, ${cid}, 'local')`,
    sql`insert into brand_assets (id, org_id, client_id, kind, content_type, data) values (${id()}, ${orgId}, ${cid}, 'logo', 'image/png', ${new Uint8Array([1, 2, 3])})`,
    sql`insert into call_log (org_id, client_id, provider_call_id, started_at) values (${orgId}, ${cid}, ${`call-${cid}`}, now())`,
    sql`insert into audit_log (org_id, client_id, action) values (${orgId}, ${cid}, 'receptionist.create')`,
    sql`insert into incidents (org_id, client_id, kind, message) values (${orgId}, ${cid}, 'test', 'x')`,
    sql`insert into knowledge_items (client_id, question, answer) values (${cid}, 'q', 'a')`,
    sql`insert into client_automations (client_id) values (${cid})`,
    sql`insert into contact_notes (client_id, key) values (${cid}, '0400000000')`,
    sql`insert into automation_texts (client_id, provider_call_id, kind, status) values (${cid}, ${`txt-${cid}`}, 'after_call', 'sent')`,
    sql`insert into webchat_settings (client_id, public_id) values (${cid}, ${`pub-${cid}`})`,
    sql`insert into followup_messages (client_id, kind, channel, dedupe_key, status) values (${cid}, 'reminder', 'sms', 'k', 'sent')`,
    sql`insert into invites (token_hash, org_id, email, role, expires_at, client_id) values (${id()}, ${orgId}, ${`inv-${cid}@example.com`}, 'customer', now() + interval '1 day', ${cid})`,
    (async () => {
      await sql`insert into webchat_conversations (id, client_id) values (${conv}, ${cid})`;
      await sql`insert into webchat_messages (conversation_id, role, content) values (${conv}, 'user', 'hi')`;
      await sql`insert into sms_threads (client_id, contact, conversation_id) values (${cid}, '0412345678', ${conv})`;
      await sql`insert into sms_optouts (client_id, contact) values (${cid}, '0412345678')`;
      await sql`insert into telegram_threads (client_id, chat_id, conversation_id) values (${cid}, 777001, ${conv})`;
      await sql`insert into telegram_bots (client_id, token_sealed, bot_id, secret_hash) values (${cid}, 'v1.x.y.z', ${Math.floor(Math.random() * 1e9)}, 'h')`;
    })(),
    (async () => {
      await sql`insert into support_tickets (id, org_id, client_id, subject, route) values (${ticket}, ${orgId}, ${cid}, 's', 'agency')`;
      await sql`insert into support_ticket_messages (ticket_id, author, body) values (${ticket}, 'requester', 'b')`;
    })(),
  ]);
  if (opts.customer) await sql`insert into client_access (user_id, client_id) values (${opts.customer.id}, ${cid})`;
  return { id: cid, assistantId };
}

async function seedCompany(orgId: string, name: string) {
  const cid = id();
  await sql`insert into companies (id, org_id, name) values (${cid}, ${orgId}, ${name})`;
  await sql`insert into brand_assets (id, org_id, company_id, kind, content_type, data) values (${id()}, ${orgId}, ${cid}, 'logo', 'image/png', ${new Uint8Array([1])})`;
  await sql`insert into invites (token_hash, org_id, email, role, expires_at, company_id) values (${id()}, ${orgId}, ${`co-${cid}@example.com`}, 'customer', now() + interval '1 day', ${cid})`;
  return cid;
}

// ---- foreign keys, read from the database itself ----
type Fk = { table: string; column: string; parent: string; rule: string };
let fkCache: Fk[] | null = null;
async function foreignKeys(): Promise<Fk[]> {
  if (fkCache) return fkCache;
  const rows = await sql`
    select tc.table_name as t, kcu.column_name as c, ccu.table_name as p, rc.delete_rule as r
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.constraint_schema = tc.constraint_schema
    join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.constraint_schema
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    order by 1, 2`;
  return (fkCache = rows.map((r: any) => ({ table: r.t, column: r.c, parent: r.p, rule: r.r })));
}

/** Rows anywhere that still point at one of these ids, by every foreign key into `parent`. */
async function leftovers(parent: string, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const fk of (await foreignKeys()).filter((f) => f.parent === parent)) {
    const [{ n }] = await sql.unsafe(`select count(*)::int as n from "${fk.table}" where "${fk.column}" = any($1::uuid[])`, [`{${ids.join(",")}}`]);
    if (n > 0) out.push(`${fk.table}.${fk.column}=${n}`);
  }
  return out;
}

/** Tables with a foreign key into `parent` that hold at least one of these ids. */
async function populated(parent: string, ids: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const fk of (await foreignKeys()).filter((f) => f.parent === parent)) {
    const [{ n }] = await sql.unsafe(`select count(*)::int as n from "${fk.table}" where "${fk.column}" = any($1::uuid[])`, [`{${ids.join(",")}}`]);
    if (n > 0) seen.add(`${fk.table}.${fk.column}`);
  }
  return seen;
}

const count = async (table: string, where: string, ...args: any[]) => (await sql.unsafe(`select count(*)::int as n from ${table} where ${where}`, args))[0].n as number;
const userExists = async (u: U) => (await count("users", "id = $1", u.id)) === 1;
const isRefused = async (p: Promise<unknown>) => p.then(() => false, (e) => e instanceof Error);
const refusedWith = async (p: Promise<unknown>, re: RegExp) => p.then(() => "no error", (e: Error) => (re.test(e.message) ? "ok" : `wrong error: ${e.message}`));

// ---- the world ----
let home: string;
let platform: U;
let HOME_CTX: Ctx;

beforeAll(async () => {
  process.env.TELNYX_API_KEY = "telnyx-test-key";
  process.env.VAPI_API_KEY = "vapi-test-key";
  process.env.VAPI_PUBLIC_KEY = "vapi-public";
  delete process.env.SINGLE_AGENCY;
  await migrate();
  // The platform's own team: the oldest one with a platform admin in it.
  platform = await person("platform", { platformAdmin: true });
  home = await team("Platform HQ", "1970-01-01");
  await join(home, platform, "owner");
  HOME_CTX = ctxOf(platform, { id: home, name: "Platform HQ" }, "owner");
}, 120_000);

beforeEach(() => {
  globalThis.fetch = stub;
  providerCalls = [];
  failing = new Set();
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// An agency with an owner, an admin, a member, two clients, customers and a full set of rows.
async function agency(name = `Agency ${id().slice(0, 5)}`) {
  const org = await team(name);
  const owner = await person("owner");
  const admin = await person("admin");
  const member = await person("member");
  await join(org, owner, "owner");
  await join(org, admin, "admin");
  await join(org, member, "member");
  const onlyHere = await person("customer-only");
  const both = await person("customer-both");
  await join(org, onlyHere, "customer");
  await join(org, both, "customer");
  const c1 = await seedCompany(org, "Bluebird Plumbing");
  const c2 = await seedCompany(org, "Corner Cafe");
  const r1 = await seedClient(org, c1, "telnyx", { customer: onlyHere, number: NUMBER });
  const r2 = await seedClient(org, c1, "vapi", { customer: both });
  const r3 = await seedClient(org, c2, "telnyx", { customer: both });
  await sql`insert into client_access (user_id, client_id) values (${both.id}, ${r1.id}) on conflict do nothing`;
  for (const u of [owner, admin, member, onlyHere, both]) await session(u, org);
  const ctx = (u: U, role: Ctx["role"], extra: Partial<Ctx> = {}) => ctxOf(u, { id: org, name }, role, extra);
  return { org, name, owner, admin, member, onlyHere, both, c1, c2, r1, r2, r3, ctx };
}

// A team with just an owner, for the cases that only need something to delete.
async function lightAgency(name: string) {
  const org = await team(name);
  const owner = await person("owner");
  await join(org, owner, "owner");
  return { org, owner };
}

describe("deleting a client business", () => {
  test("every row of its receptionists goes, and nothing of the client next door", async () => {
    const A = await agency();
    const mine = [A.r1.id, A.r2.id];
    // The seed really does touch every table that points at a client, so the check below can't pass by doing nothing.
    const clientFks = (await foreignKeys()).filter((f) => f.parent === "clients");
    const before = await populated("clients", mine);
    const missing = clientFks.map((f) => `${f.table}.${f.column}`).filter((k) => !before.has(k) && !k.startsWith("sessions.") && !k.startsWith("client_access."));
    expect(missing).toEqual([]);
    expect(await count("client_access", "client_id = any($1::uuid[])", `{${mine.join(",")}}`)).toBe(3);
    const nextDoor = await populated("clients", [A.r3.id]);

    const preview = await previewCompanyDelete(A.ctx(A.owner, "owner"), A.c1);
    expect(preview.receptionists.length).toBe(2);
    expect(preview.numbers).toEqual([NUMBER]);
    expect(preview.calls).toBe(2);
    expect(preview.logins).toBe(1); // only the login that reaches nothing else

    const done = await deleteCompany(A.ctx(A.owner, "owner"), A.c1, { confirm: "Bluebird Plumbing" });
    expect(done.warnings).toEqual([]);
    expect(done.numbers).toEqual([NUMBER]); // reported as kept, never touched
    expect(done.receptionists.map((r) => r.provider).sort()).toEqual(["telnyx", "vapi"]);

    // The provider assistants were asked to go: one on Telnyx, one on Vapi, and never a phone number.
    const deletes = providerCalls.filter((c) => c.method === "DELETE").map((c) => c.url);
    expect(deletes).toContain(`https://api.telnyx.com/v2/ai/assistants/${A.r1.assistantId}`);
    expect(deletes.some((u) => u.includes("api.vapi.ai") && u.endsWith(`/assistant/${A.r2.assistantId}`))).toBe(true);
    expect(providerCalls.some((c) => /phone[-_]numbers?\//.test(c.url) && c.method === "DELETE")).toBe(false);

    expect(await leftovers("clients", mine)).toEqual([]);
    expect(await leftovers("companies", [A.c1])).toEqual([]);
    expect(await count("clients", "id = any($1::uuid[])", `{${mine.join(",")}}`)).toBe(0);
    // The other client in the same agency is whole.
    expect(await count("clients", "id = $1", A.r3.id)).toBe(1);
    expect(await populated("clients", [A.r3.id])).toEqual(nextDoor);
    expect(await count("companies", "id = $1", A.c2)).toBe(1);
    // Business logins: the one with only this client is gone entirely, the one with another client keeps that one.
    expect(await userExists(A.onlyHere)).toBe(false);
    expect(await userExists(A.both)).toBe(true);
    expect(await count("memberships", "org_id = $1 and user_id = $2", A.org, A.both.id)).toBe(1);
    expect(await count("client_access", "user_id = $1", A.both.id)).toBe(1);
    // The agency's team is untouched, and the audit log says who did it.
    expect(await count("memberships", "org_id = $1 and role <> 'customer'", A.org)).toBe(3);
    const [row] = await sql`select actor, detail from audit_log where org_id = ${A.org} and action = 'company.deleted'`;
    expect(row.actor).toBe(A.owner.id);
    expect(row.detail.summary).toContain("Bluebird Plumbing");
    expect(row.detail.keptNumbers).toEqual([NUMBER]);
  }, 60_000);

  test("the name has to be typed exactly", async () => {
    const A = await agency();
    for (const confirm of ["", "bluebird plumbing", "Bluebird", undefined]) {
      expect(await refusedWith(deleteCompany(A.ctx(A.owner, "owner"), A.c1, { confirm }), /Type "Bluebird Plumbing" exactly/)).toBe("ok");
    }
    expect(await count("companies", "id = $1", A.c1)).toBe(1);
    expect(providerCalls.length).toBe(0);
    // Spaces at the ends are forgiven.
    await deleteCompany(A.ctx(A.owner, "owner"), A.c1, { confirm: "  Bluebird Plumbing " });
    expect(await count("companies", "id = $1", A.c1)).toBe(0);
  });

  test("a provider that fails never blocks the delete: incident, warning, rows gone", async () => {
    const A = await agency();
    failing = new Set([A.r1.assistantId, A.r2.assistantId]);
    const done = await deleteCompany(A.ctx(A.admin, "admin"), A.c1, { confirm: "Bluebird Plumbing" });
    expect(done.warnings.map((w) => w.assistantId).sort()).toEqual([A.r1.assistantId, A.r2.assistantId].sort());
    expect(done.warnings.find((w) => w.assistantId === A.r2.assistantId)?.provider).toBe("vapi");
    expect(done.warnings[0].error).toContain("provider is down");
    expect(await count("clients", "company_id = $1", A.c1)).toBe(0);
    expect(await count("companies", "id = $1", A.c1)).toBe(0);
    const incidents = await sql`select message, detail from incidents where org_id = ${A.org} and kind = 'assistant_delete_failed'`;
    expect(incidents.length).toBe(2);
    expect(incidents.map((i: any) => i.detail.assistantId).sort()).toEqual([A.r1.assistantId, A.r2.assistantId].sort());
    expect(incidents[0].message).toContain("Remove it by hand");
    const [audited] = await sql`select detail from audit_log where org_id = ${A.org} and action = 'company.deleted'`;
    expect(audited.detail.assistantWarnings.length).toBe(2);
    // The healthy one went through: only the failing ones warn.
    failing = new Set();
  });

  test("one failing assistant doesn't stop the others being deleted", async () => {
    const A = await agency();
    failing = new Set([A.r1.assistantId]);
    const done = await deleteCompany(A.ctx(A.owner, "owner"), A.c1, { confirm: "Bluebird Plumbing" });
    expect(done.warnings.map((w) => w.assistantId)).toEqual([A.r1.assistantId]);
    expect(providerCalls.some((c) => c.method === "DELETE" && c.url.endsWith(A.r2.assistantId))).toBe(true);
  });

  test("an assistant that is already gone (404) is not a warning", async () => {
    const A = await agency();
    globalThis.fetch = (async (url: any, init: any) => {
      providerCalls.push({ method: String(init?.method ?? "GET"), url: String(url) });
      return String(init?.method) === "DELETE" ? new Response("{}", { status: 404 }) : new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const done = await deleteCompany(A.ctx(A.owner, "owner"), A.c1, { confirm: "Bluebird Plumbing" });
    expect(done.warnings).toEqual([]);
  });

  test("a demo receptionist is never sent to the provider", async () => {
    const A = await agency();
    await sql`update clients set data = jsonb_set(data, '{assistantId}', '"demo-abc"') where id = ${A.r1.id}`;
    await deleteCompany(A.ctx(A.owner, "owner"), A.c1, { confirm: "Bluebird Plumbing" });
    expect(providerCalls.some((c) => c.url.endsWith("demo-abc"))).toBe(false);
  });
});

describe("deleting an agency", () => {
  test("everything under it goes, and the other agencies are untouched", async () => {
    const A = await agency("Doomed Agency");
    const B = await agency("Safe Agency");
    // Someone on both teams: the doomed team's membership goes, the account stays.
    const shared = await person("shared");
    await join(A.org, shared, "member");
    await join(B.org, shared, "member");
    await session(shared, A.org);
    const allClients = [A.r1.id, A.r2.id, A.r3.id];
    const companies = [A.c1, A.c2];
    const before = await populated("clients", allClients);
    expect([...before].length).toBeGreaterThan(10);
    const safeBefore = await populated("clients", [B.r1.id, B.r2.id, B.r3.id]);
    const people = [A.owner, A.admin, A.member, A.onlyHere, A.both];

    const preview = await previewAgencyDelete(HOME_CTX, A.org);
    expect(preview.name).toBe("Doomed Agency");
    expect(preview.receptionists.length).toBe(3);
    expect(preview.clients).toBe(2);
    expect(preview.members).toBe(4); // owner, admin, member and the shared one
    expect(preview.blocked).toBeUndefined();

    const done = await deleteAgency(HOME_CTX, A.org, { confirm: "Doomed Agency" });
    expect(done.warnings).toEqual([]);
    expect(done.numbers).toEqual([NUMBER]);
    expect(providerCalls.filter((c) => c.method === "DELETE").length).toBeGreaterThanOrEqual(3);

    expect(await count("orgs", "id = $1", A.org)).toBe(0);
    expect(await leftovers("orgs", [A.org])).toEqual([]);
    expect(await leftovers("clients", allClients)).toEqual([]);
    expect(await leftovers("companies", companies)).toEqual([]);
    for (const u of people) expect(await userExists(u)).toBe(false);
    expect(await count("sessions", "user_id = any($1::uuid[])", `{${people.map((p) => p.id).join(",")}}`)).toBe(0);
    expect(await userExists(shared)).toBe(true);
    expect(await count("memberships", "user_id = $1", shared.id)).toBe(1);
    expect(await userExists(platform)).toBe(true);
    expect(await count("orgs", "id = $1", home)).toBe(1);
    // The other agency, its people and its rows are exactly as they were.
    expect(await count("orgs", "id = $1", B.org)).toBe(1);
    expect(await count("memberships", "org_id = $1", B.org)).toBe(6);
    for (const u of [B.owner, B.admin, B.member, B.onlyHere, B.both]) expect(await userExists(u)).toBe(true);
    expect(await populated("clients", [B.r1.id, B.r2.id, B.r3.id])).toEqual(safeBefore);
    // The record lives in the platform team's own log, as the agency's log went with it.
    const [row] = await sql`select actor, detail from audit_log where org_id = ${home} and action = 'agency.deleted' order by created_at desc limit 1`;
    expect(row.actor).toBe(platform.id);
    expect(row.detail.summary).toContain("Doomed Agency");
  }, 90_000);

  test("provider failures become incidents with no org (the org is gone) and a warning", async () => {
    const A = await agency("Doomed Two");
    failing = new Set([A.r3.assistantId]);
    const done = await deleteAgency(HOME_CTX, A.org, { confirm: "Doomed Two" });
    expect(done.warnings.map((w) => w.assistantId)).toEqual([A.r3.assistantId]);
    expect(await count("orgs", "id = $1", A.org)).toBe(0);
    const [i] = await sql`select org_id, detail from incidents where kind = 'assistant_delete_failed' and detail->>'assistantId' = ${A.r3.assistantId}`;
    expect(i.org_id).toBeNull();
    expect(i.detail.owner).toBe("agency Doomed Two");
  });

  test("refuses the platform's own team, the team you're working in, and a wrong name", async () => {
    const A = await agency("Practice Agency");
    expect(await platformHomeOrg()).toBe(home);
    expect(await refusedWith(deleteAgency(HOME_CTX, home, { confirm: "Platform HQ" }), /platform's own team/)).toBe("ok");
    // Working inside the agency (e.g. as its owner via a second team): its own team can't be deleted from there.
    const inside = ctxOf(platform, { id: A.org, name: "Practice Agency" }, "owner");
    expect(await refusedWith(deleteAgency(inside, A.org, { confirm: "Practice Agency" }), /team you're working in/)).toBe("ok");
    expect(await refusedWith(deleteAgency(HOME_CTX, A.org, { confirm: "practice agency" }), /Type "Practice Agency" exactly/)).toBe("ok");
    expect(await refusedWith(deleteAgency(HOME_CTX, id(), { confirm: "x" }), /Unknown agency/)).toBe("ok");
    expect((await previewAgencyDelete(inside, A.org)).blocked).toMatch(/working in/);
    expect(await count("orgs", "id = $1", A.org)).toBe(1);
    expect(providerCalls.length).toBe(0);
    const list = await listAgencies(HOME_CTX);
    expect(list.find((a) => a.id === home)?.home).toBe(true);
    expect(list.find((a) => a.id === A.org)?.home).toBe(false);
  });

  test("the test lab can be deleted; single-agency installs can't delete agencies at all", async () => {
    const lab = await team("Lab", new Date().toISOString(), true);
    await deleteAgency(HOME_CTX, lab, { confirm: "Lab" });
    expect(await count("orgs", "id = $1", lab)).toBe(0);
    const A = await agency("Buyer Install");
    process.env.SINGLE_AGENCY = "1";
    try {
      expect(await refusedWith(deleteAgency(HOME_CTX, A.org, { confirm: "Buyer Install" }), /Only the platform team/)).toBe("ok");
    } finally {
      delete process.env.SINGLE_AGENCY;
    }
    expect(await count("orgs", "id = $1", A.org)).toBe(1);
  });
});

describe("who may delete what", () => {
  // actor -> [may delete a client, may delete an agency, may list and delete accounts]
  test("the matrix", async () => {
    const A = await agency("Matrix Agency");
    const B = await agency("Other Agency");
    const outsider = await person("outsider");
    const cust = A.onlyHere;
    const actors: [string, Ctx, boolean, boolean][] = [
      ["platform admin", HOME_CTX, true, true],
      ["agency owner", A.ctx(A.owner, "owner"), true, false],
      ["agency admin", A.ctx(A.admin, "admin"), true, false],
      ["agency member", A.ctx(A.member, "member"), false, false],
      ["a business login", A.ctx(cust, "customer"), false, false],
      ["another agency's owner", B.ctx(B.owner, "owner"), false, false],
      ["someone with no team", ctxOf(outsider, null, null), false, false],
      ["platform admin viewing the agency", ctxOf(platform, { id: A.org, name: A.name }, "admin", { viewing: { org: A.name, client: null, business: "" } }), false, false],
      ["support (changes allowed)", ctxOf(A.owner, { id: A.org, name: A.name }, "admin", { viewing: { org: A.name, client: null, business: "", support: true, canEdit: true } }), false, false],
    ];
    for (const [who, ctx, mayClient, mayAgency] of actors) {
      const c = await seedCompany(A.org, `Matrix ${who}`);
      const client = await isRefused(deleteCompany(ctx, c, { confirm: `Matrix ${who}` })).then((r) => !r);
      expect([who, "client", client]).toEqual([who, "client", mayClient]);
      expect(await count("companies", "id = $1", c)).toBe(mayClient ? 0 : 1);
      const victim = await lightAgency(`Victim of ${who}`);
      const agencyDone = await isRefused(deleteAgency(ctx, victim.org, { confirm: `Victim of ${who}` })).then((r) => !r);
      expect([who, "agency", agencyDone]).toEqual([who, "agency", mayAgency]);
      expect(await count("orgs", "id = $1", victim.org)).toBe(mayAgency ? 0 : 1);
      const listed = await isRefused(listAccounts(ctx)).then((r) => !r);
      expect([who, "accounts", listed]).toEqual([who, "accounts", mayAgency]);
      const target = await person("target");
      const accountDone = await isRefused(deleteAccountAsPlatform(ctx, target.id, { confirm: target.email })).then((r) => !r);
      expect([who, "account", accountDone]).toEqual([who, "account", mayAgency]);
    }
    // Another agency's client: the agency owner is told it isn't theirs (as if it didn't exist), and nothing happens.
    expect(await refusedWith(deleteCompany(B.ctx(B.owner, "owner"), A.c2, { confirm: "Corner Cafe" }), /isn't in your console/)).toBe("ok");
    expect(await count("companies", "id = $1", A.c2)).toBe(1);
    expect(await count("clients", "id = $1", A.r3.id)).toBe(1);
    // And the agency owner's own client, with the right role: fine.
    await deleteCompany(A.ctx(A.owner, "owner"), A.c2, { confirm: "Corner Cafe" });
    expect(await count("companies", "id = $1", A.c2)).toBe(0);
  }, 120_000);

  test("an agency owner or admin can't reach the platform's agency or account deletes", async () => {
    const A = await agency();
    const err = await deleteAgency(A.ctx(A.owner, "owner"), A.org, { confirm: A.name }).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).status).toBe(403);
    expect(await count("orgs", "id = $1", A.org)).toBe(1);
  });
});

describe("removing and deleting people", () => {
  test("an admin removes a member fully: membership, sign-ins and the account", async () => {
    const A = await agency();
    await session(A.member, A.org);
    const out = await removeMember(A.ctx(A.admin, "admin"), A.member.id, { confirm: A.member.email });
    expect(out.userDeleted).toBe(true);
    expect(await userExists(A.member)).toBe(false);
    expect(await count("sessions", "user_id = $1", A.member.id)).toBe(0);
    expect(await count("memberships", "user_id = $1", A.member.id)).toBe(0);
    const [row] = await sql`select detail from audit_log where org_id = ${A.org} and action = 'member.removed'`;
    expect(row.detail.userDeleted).toBe(true);
  });

  test("someone who is in another team keeps their account and their other sign-ins", async () => {
    const A = await agency();
    const B = await agency();
    const both = await person("two-teams");
    await join(A.org, both, "member");
    await join(B.org, both, "member");
    await session(both, A.org);
    await session(both, B.org);
    const out = await removeMember(A.ctx(A.owner, "owner"), both.id, { confirm: both.email });
    expect(out.userDeleted).toBe(false);
    expect(await userExists(both)).toBe(true);
    expect(await count("memberships", "user_id = $1", both.id)).toBe(1);
    expect(await count("sessions", "user_id = $1 and org_id = $2", both.id, A.org)).toBe(0);
    expect(await count("sessions", "user_id = $1 and org_id = $2", both.id, B.org)).toBe(1);
  });

  test("the email must be typed; members can't remove people; admins can't remove owners", async () => {
    const A = await agency();
    expect(await refusedWith(removeMember(A.ctx(A.admin, "admin"), A.member.id, { confirm: "nope" }), /exactly/)).toBe("ok");
    expect(await refusedWith(removeMember(A.ctx(A.admin, "admin"), A.member.id, {}), /exactly/)).toBe("ok");
    expect(await refusedWith(removeMember(A.ctx(A.member, "member"), A.admin.id, { confirm: A.admin.email }), /owner or admin/)).toBe("ok");
    expect(await refusedWith(removeMember(A.ctx(A.admin, "admin"), A.owner.id, { confirm: A.owner.email }), /Only an owner/)).toBe("ok");
    expect(await userExists(A.member)).toBe(true);
    expect(await userExists(A.owner)).toBe(true);
  });

  test("the last owner is never removed, by anyone, in any way", async () => {
    const A = await agency();
    // Removed by an owner (themselves), refused.
    expect(await refusedWith(removeMember(A.ctx(A.owner, "owner"), A.owner.id, { confirm: A.owner.email }), /at least one owner/)).toBe("ok");
    expect(await userExists(A.owner)).toBe(true);
    // Deleting their own account: refused, naming the agency and the way out.
    const withPassword = await person("pw", { hash: await Bun.password.hash("correct horse battery", { algorithm: "argon2id" }) });
    const org = await team("Solo Agency");
    await join(org, withPassword, "owner");
    const mine = ctxOf(withPassword, { id: org, name: "Solo Agency" }, "owner");
    const msg = await deleteOwnAccount(mine, { confirm: withPassword.email, password: "correct horse battery" }).then(() => "deleted", (e: Error) => e.message);
    expect(msg).toContain("only owner of Solo Agency");
    expect(msg).toContain("delete the agency");
    expect(await userExists(withPassword)).toBe(true);
    // The platform can't delete them either.
    const platformMsg = await deleteAccountAsPlatform(HOME_CTX, withPassword.id, { confirm: withPassword.email }).then(() => "deleted", (e: Error) => e.message);
    expect(platformMsg).toContain("only owner of Solo Agency");
    expect(await userExists(withPassword)).toBe(true);
    // The listing says so too, and doesn't offer the delete.
    const row = (await listAccounts(HOME_CTX)).find((r) => r.id === withPassword.id)!;
    expect(row.blocked).toContain("Solo Agency");
    // With a second owner they're free to go.
    const second = await person("second-owner");
    await join(org, second, "owner");
    await deleteOwnAccount(mine, { confirm: withPassword.email, password: "correct horse battery" });
    expect(await userExists(withPassword)).toBe(false);
    expect(await count("memberships", "org_id = $1", org)).toBe(1);
  });

  test("deleting your own account needs your email and your password; platform admins can't", async () => {
    const pw = "correct horse battery";
    const me = await person("self", { hash: await Bun.password.hash(pw, { algorithm: "argon2id" }) });
    const org = await team("Two Owner Agency");
    const other = await person("co-owner");
    await join(org, me, "member");
    await join(org, other, "owner");
    await session(me, org);
    const ctx = ctxOf(me, { id: org, name: "Two Owner Agency" }, "member");
    expect(await refusedWith(deleteOwnAccount(ctx, { confirm: "wrong", password: pw }), /exactly/)).toBe("ok");
    expect(await refusedWith(deleteOwnAccount(ctx, { confirm: me.email, password: "bad" }), /password isn't right/)).toBe("ok");
    expect(await userExists(me)).toBe(true);
    // Not while looking at someone else's view.
    expect(await refusedWith(deleteOwnAccount({ ...ctx, viewing: { org: "x", client: null, business: "" } }, { confirm: me.email, password: pw }), /Exit the view/)).toBe("ok");
    await deleteOwnAccount(ctx, { confirm: me.email, password: pw });
    expect(await userExists(me)).toBe(false);
    expect(await count("sessions", "user_id = $1", me.id)).toBe(0);
    expect(await userExists(other)).toBe(true);
    const [row] = await sql`select detail from audit_log where org_id = ${org} and action = 'account.deleted'`;
    expect(row.detail.self).toBe(true);
    // A platform admin: refused, with the way to do it.
    const admin = await person("pa", { platformAdmin: true, hash: await Bun.password.hash(pw, { algorithm: "argon2id" }) });
    expect(await refusedWith(deleteOwnAccount(ctxOf(admin, null, null), { confirm: admin.email, password: pw }), /platform access/)).toBe("ok");
    expect(await userExists(admin)).toBe(true);
  });

  test("the platform deletes any other account, but never a platform admin or itself", async () => {
    const A = await agency();
    const lone = await person("lone"); // in no team at all
    await session(lone, null);
    const out = await deleteAccountAsPlatform(HOME_CTX, lone.id, { confirm: lone.email });
    expect(out.email).toBe(lone.email);
    expect(await userExists(lone)).toBe(false);
    expect(await count("sessions", "user_id = $1", lone.id)).toBe(0);
    // A team member: gone from the team and the platform; the team itself is untouched.
    await deleteAccountAsPlatform(HOME_CTX, A.member.id, { confirm: A.member.email });
    expect(await userExists(A.member)).toBe(false);
    expect(await count("memberships", "org_id = $1 and role <> 'customer'", A.org)).toBe(2);
    // A business login with access to a client: access goes with them, the client stays.
    await deleteAccountAsPlatform(HOME_CTX, A.onlyHere.id, { confirm: A.onlyHere.email });
    expect(await count("client_access", "user_id = $1", A.onlyHere.id)).toBe(0);
    expect(await count("clients", "id = $1", A.r1.id)).toBe(1);
    const other = await person("other-pa", { platformAdmin: true });
    expect(await refusedWith(deleteAccountAsPlatform(HOME_CTX, other.id, { confirm: other.email }), /platform admin/)).toBe("ok");
    expect(await refusedWith(deleteAccountAsPlatform(HOME_CTX, platform.id, { confirm: platform.email }), /your own account/)).toBe("ok");
    expect(await refusedWith(deleteAccountAsPlatform(HOME_CTX, A.admin.id, { confirm: "nope" }), /exactly/)).toBe("ok");
    expect(await userExists(other)).toBe(true);
    expect(await userExists(platform)).toBe(true);
    expect(await userExists(A.admin)).toBe(true);
    const rows = await listAccounts(HOME_CTX);
    expect(rows.find((r) => r.id === platform.id)?.blocked).toBe("You");
    expect(rows.find((r) => r.id === other.id)?.blocked).toBe("Platform admin");
    expect(rows.find((r) => r.id === A.admin.id)?.blocked).toBe("");
  });
});

describe("the schema itself", () => {
  test("every foreign key into orgs, companies, clients and users either cascades or clears, except the one handled in code", async () => {
    const fks = (await foreignKeys()).filter((f) => ["orgs", "companies", "clients", "users", "webchat_conversations", "support_tickets"].includes(f.parent));
    expect(fks.length).toBeGreaterThan(30);
    const blocking = fks.filter((f) => !["CASCADE", "SET NULL"].includes(f.rule)).map((f) => `${f.table}.${f.column} -> ${f.parent} (${f.rule})`);
    // clients.org_id is RESTRICT on purpose: the delete paths remove clients first (server/deletion.ts).
    expect(blocking).toEqual(["clients.org_id -> orgs (RESTRICT)"]);
  });

  test("the database is clean afterwards: nothing points at an org, company or client that no longer exists", async () => {
    for (const fk of await foreignKeys()) {
      const [{ n }] = await sql.unsafe(
        `select count(*)::int as n from "${fk.table}" c where c."${fk.column}" is not null and not exists (select 1 from "${fk.parent}" p where p.id::text = c."${fk.column}"::text)`,
      ).catch(() => [{ n: 0 }]);
      expect([`${fk.table}.${fk.column}`, n]).toEqual([`${fk.table}.${fk.column}`, 0]);
    }
  });
});
