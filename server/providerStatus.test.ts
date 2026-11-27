// Which services are running low, and the once-a-day email. Readers are pretend (no provider is called).
// Uses the scratch database:  DATABASE_URL=... bun test server/providerStatus.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { migrate, sql } from "./db";
import { seal } from "./secrets";
import { alertIfLow, liveAlertDeps, liveReaders, providerStatus, type AlertDeps, type ProviderItem, type Readers } from "./providerStatus";

const orgId = crypto.randomUUID();
const owner = `owner-${orgId.slice(0, 8)}@example.com`;
const env = ["OPENROUTER_API_KEY", "DATABASE_LIMIT_MB", "LOW_BALANCE_TELNYX", "LOW_BALANCE_OPENROUTER", "LOW_BALANCE_TWILIO", "SINGLE_AGENCY"] as const;
const savedEnv = Object.fromEntries(env.map((k) => [k, process.env[k]]));
let ready = true;
beforeAll(async () => {
  try {
    await migrate();
    await sql`insert into orgs (id, name, telnyx_key, voice_provider) values (${orgId}, 'status test', ${seal("KEYTEST")}, 'telnyx')`;
    const uid = crypto.randomUUID();
    await sql`insert into users (id, email, name, password_hash) values (${uid}, ${owner}, 'O', 'x')`;
    await sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${uid}, 'owner')`;
  } catch (err) {
    ready = false;
    console.warn("[providerStatus.test] no database, skipping:", (err as Error).message);
  }
}, 60000);
afterAll(async () => {
  if (ready) {
    await sql`delete from orgs where id = ${orgId}`;
    await sql`delete from users where email = ${owner}`;
  }
  for (const k of env) savedEnv[k] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[k]);
});
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "env-key";
  for (const k of ["DATABASE_LIMIT_MB", "LOW_BALANCE_TELNYX", "LOW_BALANCE_OPENROUTER", "LOW_BALANCE_TWILIO", "SINGLE_AGENCY"]) delete process.env[k];
});

const readers = (over: Partial<Readers> = {}): Readers => ({
  telnyx: async () => ({ amount: 42.5, currency: "USD" }),
  openrouter: async () => ({ amount: 12, currency: "USD" }),
  twilio: async () => ({ amount: 30, currency: "USD" }),
  databaseMb: async () => 120,
  ...over,
});
const by = (items: ProviderItem[], p: string) => items.find((i) => i.provider === p)!;

describe("providerStatus", () => {
  test("Telnyx (own key), OpenRouter and the database, each with a billing page; nothing low when funded", async () => {
    if (!ready) return;
    const items = await providerStatus(orgId, readers());
    expect(items.map((i) => i.provider)).toEqual(["telnyx", "openrouter", "database"]);
    expect(by(items, "telnyx")).toMatchObject({ balance: 42.5, currency: "USD", low: false, url: "https://portal.telnyx.com/#/billing/payment-methods" });
    expect(by(items, "openrouter")).toMatchObject({ balance: 12, low: false, url: "https://openrouter.ai/settings/credits" });
    expect(by(items, "database")).toMatchObject({ balance: 120, currency: "MB", low: false });
    expect(items.every((i) => typeof i.message === "string" && i.message.length > 0)).toBe(true);
  });

  test("low balances are flagged, with the amount in the message; thresholds are configurable", async () => {
    if (!ready) return;
    let items = await providerStatus(orgId, readers({ telnyx: async () => ({ amount: 3.2, currency: "USD" }), openrouter: async () => ({ amount: 1, currency: "USD" }) }));
    expect(by(items, "telnyx")).toMatchObject({ low: true });
    expect(by(items, "telnyx").message).toContain("US$3.20");
    expect(by(items, "openrouter").low).toBe(true);
    process.env.LOW_BALANCE_TELNYX = "2";
    process.env.LOW_BALANCE_OPENROUTER = "0.5";
    items = await providerStatus(orgId, readers({ telnyx: async () => ({ amount: 3.2, currency: "USD" }), openrouter: async () => ({ amount: 1, currency: "USD" }) }));
    expect(items.some((i) => i.low)).toBe(false);
  });

  test("a balance that can't be read is not 'low' (and says so)", async () => {
    if (!ready) return;
    const items = await providerStatus(orgId, readers({ openrouter: async () => null, telnyx: async () => { throw new Error("down"); } }));
    expect(by(items, "openrouter")).toMatchObject({ low: false });
    expect(by(items, "openrouter").balance).toBeUndefined();
    expect(by(items, "openrouter").message).toContain("couldn't be read");
    expect(by(items, "telnyx").low).toBe(false);
  });

  test("no AI key at all is flagged", async () => {
    if (!ready) return;
    delete process.env.OPENROUTER_API_KEY;
    const items = await providerStatus(orgId, readers());
    expect(by(items, "openrouter")).toMatchObject({ low: true });
    expect(by(items, "openrouter").message).toContain("no key");
  });

  test("the database is flagged against the configured limit only", async () => {
    if (!ready) return;
    expect(by(await providerStatus(orgId, readers({ databaseMb: async () => 480 })), "database").low).toBe(false);
    process.env.DATABASE_LIMIT_MB = "500";
    const near = by(await providerStatus(orgId, readers({ databaseMb: async () => 480 })), "database");
    expect(near.low).toBe(true);
    expect(near.message).toContain("480 MB of 500 MB");
    expect(by(await providerStatus(orgId, readers({ databaseMb: async () => 100 })), "database").low).toBe(false);
  });

  test("Twilio shows when the agency has it connected; Vapi shows without a balance", async () => {
    if (!ready) return;
    await sql`update orgs set twilio_creds = ${seal(JSON.stringify({ accountSid: "AC" + "1".repeat(32), user: "AC" + "1".repeat(32), secret: "s", kind: "token" }))}, voice_provider = 'vapi', vapi_key = ${seal("vapikey")} where id = ${orgId}`;
    const items = await providerStatus(orgId, readers({ twilio: async () => ({ amount: 4, currency: "USD" }) }));
    expect(by(items, "twilio")).toMatchObject({ balance: 4, low: true, url: "https://console.twilio.com/us1/billing/manage-billing/billing-overview" });
    expect(by(items, "vapi")).toMatchObject({ low: false, url: "https://dashboard.vapi.ai/billing" });
    expect(by(items, "vapi").balance).toBeUndefined();
    await sql`update orgs set twilio_creds = null, voice_provider = 'telnyx', vapi_key = null where id = ${orgId}`;
  });
});

describe("the daily email", () => {
  const low: ProviderItem = { provider: "telnyx", balance: 2, currency: "USD", low: true, url: "https://portal.telnyx.com/x", message: "Telnyx is running low: US$2.00 left." };
  const fine: ProviderItem = { provider: "openrouter", balance: 50, currency: "USD", low: false, message: "ok" };

  function mail(over: Partial<AlertDeps> = {}) {
    const sent: { to: string; subject: string; text: string }[] = [];
    let at = Date.now();
    const deps: AlertDeps = { ...liveAlertDeps, send: async (to, subject, text) => (sent.push({ to, subject, text }), true), now: () => at, ...over };
    return { sent, deps, later: (ms: number) => (at += ms) };
  }

  test("emails the owners once for a low service, with its top-up link; never for one that's fine", async () => {
    if (!ready) return;
    await sql`delete from provider_alerts where org_id = ${orgId}`;
    const { sent, deps } = mail();
    expect(await alertIfLow(orgId, "Status test", [fine], deps)).toEqual([]);
    expect(sent.length).toBe(0);
    expect(await alertIfLow(orgId, "Status test", [low, fine], deps)).toEqual(["telnyx"]);
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe(owner);
    expect(sent[0].text).toContain("US$2.00");
    expect(sent[0].text).toContain("https://portal.telnyx.com/x");
  });

  test("at most once a day per service: checking again sends nothing, the next day sends again, another service still goes", async () => {
    if (!ready) return;
    await sql`delete from provider_alerts where org_id = ${orgId}`;
    const { sent, deps, later } = mail();
    await alertIfLow(orgId, "S", [low], deps);
    later(3_600_000);
    expect(await alertIfLow(orgId, "S", [low], deps)).toEqual([]);
    expect(await alertIfLow(orgId, "S", [{ ...low, provider: "openrouter" }], deps)).toEqual(["openrouter"]);
    expect(sent.length).toBe(2);
    later(24 * 3_600_000);
    expect(await alertIfLow(orgId, "S", [low], deps)).toEqual(["telnyx"]);
    expect(sent.length).toBe(3);
  });

  test("two checks at once still send one email", async () => {
    if (!ready) return;
    await sql`delete from provider_alerts where org_id = ${orgId}`;
    const { sent, deps } = mail();
    await Promise.all([alertIfLow(orgId, "S", [low], deps), alertIfLow(orgId, "S", [low], deps)]);
    expect(sent.length).toBe(1);
  });
});

describe("the live readers", () => {
  const realFetch = globalThis.fetch;
  afterAll(() => {
    globalThis.fetch = realFetch;
  });
  const answer = (map: Record<string, { status?: number; body: unknown }>) => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      seen.push(u);
      const hit = Object.entries(map).find(([k]) => u.includes(k));
      return new Response(JSON.stringify(hit?.[1].body ?? {}), { status: hit?.[1].status ?? (hit ? 200 : 404) });
    }) as any;
    return seen;
  };
  

  test("OpenRouter: credits minus usage; falls back to the key's own limit when credits are refused", async () => {
    answer({ "/credits": { body: { data: { total_credits: 20, total_usage: 7.5 } } } });
    expect(await liveReaders.openrouter("k")).toEqual({ amount: 12.5, currency: "USD" });
    answer({ "/credits": { status: 403, body: {} }, "/key": { body: { data: { limit_remaining: 3 } } } });
    expect(await liveReaders.openrouter("k")).toEqual({ amount: 3, currency: "USD" });
    answer({ "/credits": { status: 403, body: {} }, "/key": { body: { data: { limit_remaining: null } } } });
    expect(await liveReaders.openrouter("k")).toBeNull();
  });

  test("Twilio: the account balance", async () => {
    if (!ready) return;
    process.env.SINGLE_AGENCY = "1";
    process.env.TWILIO_ACCOUNT_SID = "AC" + "2".repeat(32);
    process.env.TWILIO_AUTH_TOKEN = "t".repeat(32);
    const seen = answer({ "/Balance.json": { body: { balance: "18.25", currency: "AUD" } } });
    expect(await liveReaders.twilio(orgId)).toEqual({ amount: 18.25, currency: "AUD" });
    expect(seen[0]).toContain(`/Accounts/AC${"2".repeat(32)}/Balance.json`);
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
  });
});
