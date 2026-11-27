import { sql } from "./db";
import { llmKey } from "./llm";
import { sendAccountEmail } from "./mailer";
import { UI_PRODUCT as PRODUCT } from "./product";
import { enterOrg, telnyx } from "./telnyx";
import { twilio, twilioCredsFor } from "./twilio";
import { accountMode, providerOfOrg } from "./voice/config";
import { singleAgency } from "./accounts";

// How the services behind the receptionist are doing: "is anything about to run out?" for the
// agency owner. GET /api/provider-status, and a daily email when something is low (at most one a
// day per service). Each item is one service the agency actually uses; money is the agency's own
// (an agency on the platform's phone key never sees Telnyx's balance).

export type ProviderId = "telnyx" | "openrouter" | "twilio" | "vapi" | "database";
export type ProviderItem = {
  provider: ProviderId;
  balance?: number;
  currency?: string;
  /** Running low (or can't be read when that matters): worth the owner's attention. */
  low: boolean;
  /** This service's own billing / top-up page. */
  url?: string;
  /** One plain sentence for the owner. */
  message: string;
};

export const BILLING_URL: Record<ProviderId, string> = {
  telnyx: "https://portal.telnyx.com/#/billing/payment-methods",
  openrouter: "https://openrouter.ai/settings/credits",
  twilio: "https://console.twilio.com/us1/billing/manage-billing/billing-overview",
  vapi: "https://dashboard.vapi.ai/billing",
  database: "",
};

const NAME: Record<ProviderId, string> = { telnyx: "Telnyx (phone calls and texts)", openrouter: "OpenRouter (the AI)", twilio: "Twilio (numbers and texts)", vapi: "Vapi (voice)", database: "Database storage" };

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 && process.env[name] !== "" && process.env[name] !== undefined ? v : fallback;
};
/** What counts as low, per service, in the service's own currency (US dollars). Override with LOW_BALANCE_<SERVICE>. */
export const lowAt = (p: "telnyx" | "openrouter" | "twilio") => num(`LOW_BALANCE_${p.toUpperCase()}`, p === "openrouter" ? 5 : 10);
/** What a Railway Hobby volume holds (its database lives on one). Pro raises it: set DATABASE_LIMIT_MB then. */
export const RAILWAY_HOBBY_DB_MB = 5000;
/**
 * The storage the database plan allows, in MB (DATABASE_LIMIT_MB). Unset: a single agency's copy on Railway assumes
 * the Hobby volume size; anywhere else 0 = not set, so the size is shown and never flagged.
 */
export const databaseLimitMb = () => num("DATABASE_LIMIT_MB", singleAgency() && process.env.RAILWAY_ENVIRONMENT_ID ? RAILWAY_HOBBY_DB_MB : 0);
/** The share of that limit at which the database counts as nearly full. */
export const DB_FULL_SHARE = 0.85;

export const money = (n: number, c = "USD") => `${c === "USD" ? "US$" : `${c} `}${n.toFixed(2)}`;

export type Readers = {
  telnyx(): Promise<{ amount: number; currency: string } | null>;
  openrouter(key: string): Promise<{ amount: number; currency: string } | null>;
  twilio(orgId: string): Promise<{ amount: number; currency: string } | null>;
  databaseMb(): Promise<number>;
};

export const liveReaders: Readers = {
  async telnyx() {
    const res = await telnyx<{ data?: any }>("GET", "/balance").catch(() => null);
    return res ? { amount: Number(res.data?.available_credit ?? res.data?.balance ?? 0), currency: res.data?.currency ?? "USD" } : null;
  },
  async openrouter(key) {
    const get = async (path: string) => {
      const r = await fetch(`https://openrouter.ai/api/v1${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
      return r?.ok ? ((await r.json().catch(() => null)) as any) : null;
    };
    const credits = (await get("/credits"))?.data;
    if (credits && typeof credits.total_credits === "number") return { amount: credits.total_credits - Number(credits.total_usage ?? 0), currency: "USD" };
    // A key with a spending limit knows what's left of it even where /credits is refused.
    const limit = (await get("/key"))?.data?.limit_remaining;
    return typeof limit === "number" ? { amount: limit, currency: "USD" } : null;
  },
  async twilio(orgId) {
    const creds = await twilioCredsFor(orgId).catch(() => null);
    if (!creds) return null;
    const r = await twilio<{ balance?: string; currency?: string }>(creds, "GET", "/Balance.json").catch(() => null);
    return r && Number.isFinite(Number(r.balance)) ? { amount: Number(r.balance), currency: r.currency ?? "USD" } : null;
  },
  async databaseMb() {
    const [r] = await sql`select pg_database_size(current_database())::float8 as bytes`;
    return Number(r?.bytes ?? 0) / 1_048_576;
  },
};

function moneyItem(provider: "telnyx" | "openrouter" | "twilio", got: { amount: number; currency: string } | null): ProviderItem {
  const url = BILLING_URL[provider];
  if (!got) return { provider, low: false, url, message: `${NAME[provider]}: the balance couldn't be read right now. Check it on their site.` };
  const low = got.amount < lowAt(provider);
  return {
    provider,
    balance: Math.round(got.amount * 100) / 100,
    currency: got.currency,
    low,
    url,
    message: low ? `${NAME[provider]} is running low: ${money(got.amount, got.currency)} left. Top it up so nothing stops working.` : `${NAME[provider]}: ${money(got.amount, got.currency)} left.`,
  };
}

/** The services this agency uses and how each is doing. Call inside the agency's org scope (it asks Telnyx and Twilio as that agency). */
export async function providerStatus(orgId: string, r: Readers = liveReaders): Promise<ProviderItem[]> {
  enterOrg(orgId);
  const items: ProviderItem[] = [];
  const [o] = await sql`select telnyx_key is not null as own_telnyx, twilio_creds is not null as own_twilio from orgs where id = ${orgId}`;
  const engines = [await accountMode(orgId, "telnyx"), await accountMode(orgId, "vapi")];
  const provider = await providerOfOrg(orgId);

  // The agency's own money only: an agency running on the platform's phone key doesn't see (or pay) it.
  if (o?.own_telnyx || (singleAgency() && engines[0] !== "none" && provider === "telnyx")) items.push(moneyItem("telnyx", await r.telnyx().catch(() => null)));
  if (engines[1] === "own" || provider === "vapi")
    items.push({ provider: "vapi", low: false, url: BILLING_URL.vapi, message: `${NAME.vapi}: Vapi doesn't share its balance with other apps. Check your credit on their dashboard.` });
  if (o?.own_twilio || (await twilioCredsFor(orgId).catch(() => null))) items.push(moneyItem("twilio", await r.twilio(orgId).catch(() => null)));
  const key = await llmKey(orgId);
  items.push(key ? moneyItem("openrouter", await r.openrouter(key).catch(() => null)) : { provider: "openrouter", low: true, url: BILLING_URL.openrouter, message: `${NAME.openrouter}: no key is set, so the website chat, texts, email replies and call summaries are off. Add one under Connections.` });

  const mb = await r.databaseMb().catch(() => null);
  if (mb !== null) {
    const limit = databaseLimitMb();
    const share = limit ? mb / limit : 0;
    const low = limit > 0 && share >= DB_FULL_SHARE;
    items.push({
      provider: "database",
      balance: Math.round(mb),
      currency: "MB",
      low,
      message: !limit ? `${NAME.database}: ${Math.round(mb)} MB used.` : low ? `${NAME.database} is nearly full: ${Math.round(mb)} MB of ${limit} MB used. Upgrade the database plan before it fills.` : `${NAME.database}: ${Math.round(mb)} MB of ${limit} MB used.`,
    });
  }
  return items;
}

// ---- The daily "running low" email ---------------------------------------------------------

const DAY_MS = 24 * 3_600_000;

export type AlertDeps = {
  owners(orgId: string): Promise<string[]>;
  /** True when this service was emailed about less than a day ago; otherwise claims today's email. */
  claim(orgId: string, provider: ProviderId, now: number): Promise<boolean>;
  send(to: string, subject: string, text: string): Promise<boolean>;
  now(): number;
};

export const liveAlertDeps: AlertDeps = {
  owners: async (orgId) => (await sql`select u.email from memberships m join users u on u.id = m.user_id where m.org_id = ${orgId} and m.role = 'owner' order by u.email`).map((r: any) => r.email),
  async claim(orgId, provider, now) {
    // One statement, so two servers (or two timers) can't both send.
    const r = await sql`
      insert into provider_alerts (org_id, provider, emailed_at) values (${orgId}, ${provider}, ${new Date(now)})
      on conflict (org_id, provider) do update set emailed_at = excluded.emailed_at where provider_alerts.emailed_at <= ${new Date(now - DAY_MS)}
      returning org_id`;
    return r.length > 0;
  },
  send: (to, subject, text) => sendAccountEmail(to, subject, text),
  now: Date.now,
};

/** Emails the agency's owners about each low service, at most once a day per service. Returns the services emailed about. */
export async function alertIfLow(orgId: string, orgName: string, items: ProviderItem[], d: AlertDeps = liveAlertDeps): Promise<ProviderId[]> {
  const low = items.filter((i) => i.low);
  if (!low.length) return [];
  const to = await d.owners(orgId);
  if (!to.length) return [];
  const sent: ProviderId[] = [];
  for (const item of low) {
    if (!(await d.claim(orgId, item.provider, d.now()))) continue;
    const text = `${item.message}\n\n${item.url ? `Top up here: ${item.url}\n\n` : ""}This is the ${PRODUCT} check for ${orgName}. We email you about each service at most once a day.`;
    for (const addr of to) await d.send(addr, `${NAME[item.provider].split(" (")[0]} is running low`, text).catch(() => false);
    sent.push(item.provider);
  }
  return sent;
}

/** One pass over every active agency. Failures for one agency don't stop the rest. */
export async function checkAllAgencies(readers: Readers = liveReaders, d: AlertDeps = liveAlertDeps): Promise<number> {
  const orgs = await sql`select id, name from orgs where suspended_at is null and coalesce(sandbox, false) = false`;
  let emailed = 0;
  for (const o of orgs as any[]) {
    try {
      emailed += (await alertIfLow(o.id, o.name, await providerStatus(o.id, readers), d)).length;
    } catch (err) {
      console.error(`[provider status ${o.id}]`, (err as Error).message);
    }
  }
  return emailed;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Checks every few hours (the once-a-day limit is kept in the database, so restarts don't re-send). */
export function startProviderAlerts(): void {
  if (timer || process.env.NODE_ENV === "test" || process.env.PROVIDER_ALERTS === "off") return;
  const run = () => void checkAllAgencies().catch((err) => console.error("[provider alerts]", err.message));
  setTimeout(run, 5 * 60_000).unref?.();
  timer = setInterval(run, 6 * 3_600_000);
  timer.unref?.();
}
