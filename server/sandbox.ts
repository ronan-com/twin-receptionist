import { blankSettings, type Business } from "../src/lib/shared";
import { AuthError, type Ctx } from "./accounts";
import { sql } from "./db";

// The test lab: a sandbox agency with a demo receptionist. Demo receptionists have an
// assistant id starting "demo-", and every place that would call the phone provider
// answers from sample data instead, so testing is free and safe.

export const isDemo = (assistantId: string) => assistantId.startsWith("demo-");

const SANDBOX_DOMAIN = "sandbox.test";

function onlyPlatform(ctx: Ctx): void {
  if (!ctx.user.platformAdmin) throw new AuthError("Only the platform team can do that.", 403);
}

export async function sandboxOrgId(): Promise<string | null> {
  const [o] = await sql`select id from orgs where sandbox limit 1`;
  return o?.id ?? null;
}

export async function ensureSandbox(ctx: Ctx): Promise<string> {
  onlyPlatform(ctx);
  const existing = await sandboxOrgId();
  if (existing) return existing;

  const orgId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const now = new Date().toISOString();
  const settings = {
    ...blankSettings(),
    businessName: "Harbourside Dental (Demo)",
    suburb: "Brisbane",
    receptionistName: "Mia",
    voiceName: "Arlo - Service Specialist",
    greeting: "Thanks for calling Harbourside Dental, you're speaking with Mia. How can I help?",
  };
  const client: Business = {
    id: clientId,
    assistantId: `demo-${clientId}`,
    settings,
    instructions: "Demo receptionist. Calls, phone numbers and texting are switched off in the test lab.",
    createdAt: now,
    updatedAt: now,
  };
  await sql.begin(async (tx) => {
    await tx`insert into orgs (id, name, platform_telnyx, created_by, sandbox) values (${orgId}, 'Test Agency (sandbox)', true, ${ctx.user.id}, true)`;
    await tx`insert into memberships (org_id, user_id, role) values (${orgId}, ${ctx.user.id}, 'owner')`;
    await tx`insert into clients (id, org_id, data, connect_token_hash, created_at, updated_at) values (${clientId}, ${orgId}, ${client as any}, null, ${now}, ${now})`;
    const at = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
    const rows = [
      { id: "demo1", kind: "callback", at: at(95), channel: "call", name: "Isabella Rossi", phone: "+61412000111", service: "Whitening enquiry", start: "", status: "saved", note: "Prefers mornings" },
      { id: "demo2", kind: "booking", at: at(300), channel: "call", name: "Marcus Bell", phone: "+61412000104", service: "New patient check-up", start: new Date(Date.now() + 2 * 86_400_000).toISOString(), status: "booked", note: "" },
      { id: "demo3", kind: "callback", at: at(1500), channel: "call", name: "Tom Reilly", phone: "+61412000106", service: "Invoice query", start: "", status: "saved", note: "" },
    ];
    for (const r of rows) await tx`insert into booking_requests (client_id, data) values (${clientId}, ${r as any})`;
    await tx`insert into calendar_events (id, client_id, starts_at, ends_at, title, details) values (gen_random_uuid(), ${clientId}, now() + interval '2 days', now() + interval '2 days 30 minutes', 'New patient check-up - Marcus Bell', '0412 000 104')`;
  });
  return orgId;
}

export async function resetSandbox(ctx: Ctx): Promise<void> {
  onlyPlatform(ctx);
  const orgId = await sandboxOrgId();
  if (orgId) {
    await sql.begin(async (tx) => {
      // clients are protected from org deletion, so remove them first (their data cascades).
      await tx`delete from clients where org_id = ${orgId}`;
      await tx`delete from orgs where id = ${orgId}`;
    });
  }
  await sql`delete from users where email like ${"%@" + SANDBOX_DOMAIN}`;
}

const word = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

export type TestLogins = { email: string; password: string; role: string }[];

// Two ready-made logins (an agency owner and a customer) so you can sign in on another
// device and be them. They only exist inside the sandbox.
export async function createTestLogins(ctx: Ctx): Promise<TestLogins> {
  onlyPlatform(ctx);
  const orgId = await ensureSandbox(ctx);
  const [client] = await sql`select id from clients where org_id = ${orgId} limit 1`;
  const make = async (prefix: string, role: "owner" | "customer", name: string) => {
    const email = `${prefix}-${word().slice(0, 5)}@${SANDBOX_DOMAIN}`;
    const password = `${word()}-${word().slice(0, 4)}`;
    const id = crypto.randomUUID();
    const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
    await sql.begin(async (tx) => {
      await tx`insert into users (id, email, name, password_hash) values (${id}, ${email}, ${name}, ${hash})`;
      await tx`insert into memberships (org_id, user_id, role) values (${orgId}, ${id}, ${role})`;
      if (role === "customer") await tx`insert into client_access (user_id, client_id) values (${id}, ${client.id})`;
    });
    return { email, password, role: role === "owner" ? "Agency owner" : "Customer" };
  };
  return [await make("agency", "owner", "Test Agency Owner"), await make("customer", "customer", "Test Customer")];
}

// ---- Sample data for the demo receptionist ----

export function demoCalls() {
  const now = Date.now();
  const call = (id: string, mins: number, channel: string, from: string) => ({ id, startedAt: new Date(now - mins * 60_000).toISOString(), channel, from, simulated: false });
  return [
    call("demo-call-1", 25, "call", "+61412000111"),
    call("demo-call-2", 130, "sms_chat", "+61412000104"),
    call("demo-call-3", 600, "call", "+61412000106"),
    call("demo-call-4", 2900, "call", "+61412000102"),
    call("demo-call-5", 6000, "call", "+61412000109"),
  ];
}

export function demoCallDetail(id: string) {
  const at = new Date().toISOString();
  const talk = (lines: [string, string][]) => lines.map(([role, text]) => ({ role, text, at }));
  if (id === "demo-call-2") {
    return { summary: "Marcus confirmed his check-up on Thursday.", messages: talk([["user", "Hi, can I confirm my appointment on Thursday?"], ["assistant", "Hi Marcus! Yes, you're booked in for Thursday. See you then."]]) };
  }
  return {
    summary: "Caller asked about teeth whitening prices and asked for a call back in the morning.",
    messages: talk([
      ["assistant", "Thanks for calling Harbourside Dental, you're speaking with Mia. How can I help?"],
      ["user", "Hi, I'd like to know how much teeth whitening is."],
      ["assistant", "Happy to help. Whitening consults are with our dentist, so I'll get the team to call you. What's the best time?"],
      ["user", "Mornings are best."],
      ["assistant", "Perfect, I've passed that on. Is there anything else I can help with?"],
    ]),
  };
}

// Local and end-to-end tests run with a fake phone-provider key (scripts/e2e/setup.sh).
// Then new receptionists are made as demo ones, so sign-up and "create receptionist"
// work without the provider. Production always has a real key, so never takes this path.
export const fakeProvider = () => (process.env.TELNYX_API_KEY ?? "").startsWith("platform-fake") || (process.env.VAPI_API_KEY ?? "").startsWith("platform-fake") || process.env.E2E_FAKE_PROVIDER === "1";
