import type { OAuthProvider, OAuthPurpose } from "./oauth";

// The shared Google / Microsoft sign-in, from the app's side. The setup site that installed this copy owns one Google
// app and one Microsoft app (download-site/broker.ts); the agency never registers its own. This copy talks to it with
// the same SUPPORT_SYNC_TOKEN it already uses for updates and tickets.
//
// OFF unless OAUTH_BROKER=1 (the setup site puts it on new installs once it is set up there). Bring-your-own always
// wins: with a Google or Microsoft app saved in Settings (or GOOGLE_*/MICROSOFT_* in the environment), that provider
// signs in through it exactly as before, and nothing here is used for it.
//
// What this copy stores for a shared connection is "brk1.<sealed>" in the place a refresh token goes. Only the setup
// site can open it, and only for this agency's sync token. Access tokens are fetched from the setup site as needed
// and kept in memory for most of their hour (oauth.ts), so a short setup-site outage changes nothing for an hour, and
// a longer one only pauses calendar and mail calls until it is back: nothing is lost, nobody has to reconnect.

export const BROKER_PREFIX = "brk1.";
export const isBrokered = (refreshToken: string) => refreshToken.startsWith(BROKER_PREFIX);

/** The setup site was unreachable or erred: temporary. Anything else (a refusal) means connecting again. */
export class BrokerDown extends Error {}
export class BrokerRefused extends Error {}

export function brokerConfig(): { base: string; token: string } | null {
  if ((process.env.OAUTH_BROKER ?? "").trim() !== "1") return null;
  const token = (process.env.SUPPORT_SYNC_TOKEN ?? "").trim();
  try {
    const u = new URL((process.env.SUPPORT_SYNC_URL ?? "").trim());
    if ((u.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) && token.length >= 20) return { base: u.origin, token };
  } catch {}
  return null;
}

type Offered = Record<OAuthProvider, Record<OAuthPurpose, boolean>>;
const NONE: Offered = { google: { calendar: false, mail: false }, microsoft: { calendar: false, mail: false } };
let status: { at: number; offered: Offered } | null = null;
let pending: Promise<void> | null = null;
const STATUS_MS = 5 * 60_000, RETRY_MS = 60_000;

async function call(path: string, body?: unknown, timeoutMs = 15_000): Promise<{ status: number; data: any }> {
  const c = brokerConfig();
  if (!c) throw new BrokerRefused("The shared Google and Microsoft sign-in isn't switched on for this copy.");
  let res: Response;
  try {
    res = await fetch(`${c.base}/api/broker/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${c.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new BrokerDown("The sign-in service isn't reachable right now.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status >= 500 || res.status === 429) throw new BrokerDown(String(data?.message || "The sign-in service is busy. Try again shortly."));
  return { status: res.status, data };
}

/** Asks the setup site what it offers. Cached; a failure is remembered for a minute so a down site isn't hammered. */
export async function brokerStatus(): Promise<void> {
  if (!brokerConfig()) { status = null; return; }
  if (status && Date.now() - status.at < (status.offered === NONE ? RETRY_MS : STATUS_MS)) return;
  pending ??= (async () => {
    try {
      const r = await call("status", undefined, 5_000);
      status = { at: Date.now(), offered: r.status === 200 && r.data?.enabled ? { ...NONE, ...r.data.offered } : NONE };
    } catch {
      status = { at: Date.now(), offered: NONE };
    }
  })().finally(() => { pending = null; });
  await pending;
}

/** What the shared sign-in offers right now, from the last answer (see brokerStatus). */
export function brokerOffers(provider: OAuthProvider, purpose: OAuthPurpose): boolean {
  if (!brokerConfig()) return false;
  if (!status || Date.now() - status.at > STATUS_MS) void brokerStatus();
  return Boolean(status?.offered[provider]?.[purpose]);
}
export const brokerResetForTests = () => { status = null; pending = null; };

export async function brokerStart(provider: OAuthProvider, purpose: OAuthPurpose, returnUrl: string, state: string, challenge: string): Promise<string> {
  const r = await call("start", { provider, purpose, returnUrl, state, challenge });
  if (r.status !== 200 || !r.data?.url) throw new BrokerRefused(String(r.data?.message || "The shared sign-in isn't available. Try again later."));
  return String(r.data.url);
}

export async function brokerRedeem(ticket: string, verifier: string): Promise<{ refreshToken: string; address: string }> {
  const r = await call("redeem", { ticket, verifier });
  if (r.status !== 200 || !r.data?.refreshToken) throw new BrokerRefused(String(r.data?.message || "That sign-in took too long or was already used. Please try again."));
  return { refreshToken: String(r.data.refreshToken), address: String(r.data.address ?? "") };
}

/** A fresh access token. Retries once (a blip), then throws BrokerDown. A refusal (access revoked) throws BrokerRefused. */
export async function brokerRefresh(provider: OAuthProvider, purpose: OAuthPurpose, refreshToken: string): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string }> {
  let last: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await call("refresh", { provider, purpose, refreshToken });
      if (r.status === 200 && r.data?.accessToken) return { accessToken: String(r.data.accessToken), expiresIn: Number(r.data.expiresIn ?? 3600), ...(r.data.refreshToken ? { refreshToken: String(r.data.refreshToken) } : {}) };
      throw new BrokerRefused(String(r.data?.message || r.data?.error || `The sign-in service returned ${r.status}.`));
    } catch (err) {
      last = err;
      if (!(err instanceof BrokerDown)) throw err;
      if (i === 0) await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw last;
}
