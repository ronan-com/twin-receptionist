// Real checks against each provider. Each returns { ok, message, ... } in
// plain English; none of them ever prints the key it was given.
import nodemailer from "nodemailer";
import { Resolver } from "node:dns/promises";

export const MOCK = process.env.MOCK_DO === "1";
export const DO_API = (process.env.DO_API_BASE || (MOCK ? "http://127.0.0.1:4401" : "https://api.digitalocean.com")).replace(/\/$/, "");
const TELNYX_API = "https://api.telnyx.com";

export type Check<T = {}> = ({ ok: true; message: string } & T) | { ok: false; message: string };

async function timed(url: string, init: RequestInit = {}, ms = 20000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

function netError(provider: string, e: any): string {
  if (e?.name === "TimeoutError") return `${provider} didn't answer in time. Check your internet connection and try again.`;
  return `We couldn't reach ${provider}. Check your internet connection and try again.`;
}

// ---------------- DigitalOcean ----------------

export class DOError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function doApi<T = any>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await timed(DO_API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new DOError(netError("DigitalOcean", e), 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}
  if (!res.ok) {
    if (res.status === 401) throw new DOError("DigitalOcean didn't accept that token. Copy it again (it's only shown once, so you may need to make a new one).", 401);
    if (res.status === 403) throw new DOError("That token can only read. Make a new token with Full Access (or tick Write) and paste that one.", 403);
    if (res.status === 429) throw new DOError("DigitalOcean says we're going too fast. Wait a minute and try again.", 429);
    throw new DOError(`DigitalOcean said: ${json.message || res.statusText || "unknown error"}`, res.status);
  }
  return json as T;
}

export interface SizeOption {
  slug: string;
  label: string;
  priceMonthly: number;
  memoryGb: number;
  vcpus: number;
  diskGb: number;
}
export interface RegionOption {
  slug: string;
  name: string;
  sizes: string[];
}

export const DEFAULT_REGION = "syd1";
export const DEFAULT_SIZE = process.env.RECOMMENDED_SIZE || "s-2vcpu-4gb";

export async function checkDigitalOcean(token: string): Promise<Check<{ accountEmail: string; regions: RegionOption[]; sizes: SizeOption[] }>> {
  token = token.trim();
  if (!token) return { ok: false, message: "Paste your DigitalOcean token first." };
  if (/\s/.test(token)) return { ok: false, message: "That doesn't look like a token: it has spaces in it. Copy just the token." };
  try {
    const acct = await doApi(token, "GET", "/v2/account");
    const a = acct.account || {};
    if (a.status && a.status !== "active") {
      return { ok: false, message: `Your DigitalOcean account is "${a.status}". ${a.status_message || "Add a payment method and finish sign-up in DigitalOcean, then try again."}` };
    }
    if (a.email_verified === false) return { ok: false, message: "Confirm your email address with DigitalOcean first (check your inbox), then try again." };
    if (typeof a.droplet_limit === "number" && a.droplet_limit < 1) {
      return { ok: false, message: "Your DigitalOcean account can't create servers yet. Add a payment method in DigitalOcean (Billing), then try again." };
    }
    const [regionsRes, sizesRes] = await Promise.all([doApi(token, "GET", "/v2/regions?per_page=200"), doApi(token, "GET", "/v2/sizes?per_page=200")]);
    const regions: RegionOption[] = (regionsRes.regions || [])
      .filter((r: any) => r.available)
      .map((r: any) => ({ slug: r.slug, name: r.name, sizes: r.sizes || [] }))
      .sort((x: RegionOption, y: RegionOption) => x.name.localeCompare(y.name));
    const sizes: SizeOption[] = (sizesRes.sizes || [])
      .filter((s: any) => s.available && /^s-/.test(s.slug) && s.memory >= 2048 && s.memory <= 16384)
      .map((s: any) => ({
        slug: s.slug,
        priceMonthly: s.price_monthly,
        memoryGb: s.memory / 1024,
        vcpus: s.vcpus,
        diskGb: s.disk,
        label: `${s.vcpus} CPU, ${s.memory / 1024} GB memory, ${s.disk} GB disk`,
        regions: s.regions,
      }))
      .sort((x: SizeOption, y: SizeOption) => x.priceMonthly - y.priceMonthly);
    return { ok: true, message: `Connected to the DigitalOcean account ${a.email || ""}.`.replace(" .", "."), accountEmail: a.email || "", regions, sizes };
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
}

// ---------------- Telnyx ----------------

export async function checkTelnyx(key: string): Promise<Check<{ balance: string }>> {
  key = key.trim();
  if (!key) return { ok: false, message: "Paste your Telnyx API key first." };
  if (/\s/.test(key)) return { ok: false, message: "That doesn't look like a key: it has spaces in it. Copy just the key." };
  // Test mode only: one fixed made-up key is accepted without calling Telnyx, so the rest of the flow can run.
  if (MOCK && key === "KEY_TEST_MODE_ACCEPT") return { ok: true, message: "Telnyx key works (test mode). Available credit: 25.00 USD.", balance: "25.00 USD" };
  let res: Response;
  try {
    res = await timed(`${TELNYX_API}/v2/balance`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  } catch (e) {
    return { ok: false, message: netError("Telnyx", e) };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: "Telnyx didn't accept that key. In Telnyx go to API Keys, create a new key, and copy the whole thing (it starts with KEY)." };
  }
  if (!res.ok) return { ok: false, message: `Telnyx had a problem (error ${res.status}). Wait a minute and try again.` };
  const j: any = await res.json().catch(() => ({}));
  const d = j.data || {};
  const amt = Number(d.available_credit ?? d.balance ?? 0);
  const cur = d.currency || "USD";
  const balance = `${amt.toFixed(2)} ${cur}`;
  return { ok: true, message: `Telnyx key works. Available credit: ${balance}.`, balance };
}

// ---------------- Email (SMTP) ----------------

export function parseMailFrom(v: string): string | null {
  const m = v.trim().match(/<([^>]+)>$/);
  const addr = (m ? m[1] : v).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? addr : null;
}

function smtpProblem(e: any): string {
  const code = e?.code || "";
  const resp = String(e?.response || e?.message || "");
  if (code === "EAUTH" || /535|authentication/i.test(resp)) return "The email server rejected the username or password. Check them (some providers need an \"app password\" rather than your normal one).";
  if (code === "EDNS" || /ENOTFOUND|EAI_AGAIN/.test(resp)) return "We couldn't find that email server. Check the server name in the address.";
  if (code === "ETIMEDOUT" || /timed? ?out/i.test(resp)) return "The email server didn't answer. Check the server name and port (usually 587 or 465).";
  if (code === "ECONNREFUSED" || code === "ESOCKET" || code === "ECONNECTION") return "The email server refused the connection. Check the port: use 587 with smtp://, or 465 with smtps://.";
  return "The email server said: " + resp.slice(0, 200);
}

export async function checkSmtp(smtpUrl: string, mailFrom: string): Promise<Check> {
  smtpUrl = smtpUrl.trim();
  let u: URL;
  try {
    u = new URL(smtpUrl);
  } catch {
    return { ok: false, message: "That address isn't in the right shape. It should look like smtp://username:password@smtp.example.com:587" };
  }
  if (u.protocol !== "smtp:" && u.protocol !== "smtps:") return { ok: false, message: "The address must start with smtp:// or smtps://" };
  if (!u.hostname) return { ok: false, message: "The address is missing the server name (the part after @)." };
  if (!parseMailFrom(mailFrom)) return { ok: false, message: "Enter the \"from\" email address, for example Acme Reception <hello@acme.com>." };
  const t = nodemailer.createTransport(smtpUrl, { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 } as any);
  try {
    await t.verify();
    return { ok: true, message: `Signed in to the email server ${u.hostname}.` };
  } catch (e) {
    return { ok: false, message: smtpProblem(e) };
  } finally {
    t.close();
  }
}

export async function sendTestEmail(smtpUrl: string, mailFrom: string, to: string, productName: string): Promise<Check> {
  const t = nodemailer.createTransport(smtpUrl, { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 } as any);
  try {
    await t.sendMail({
      from: mailFrom,
      to,
      subject: `${productName}: test email from your setup`,
      text: `This is a test email from the ${productName} setup.\n\nIf you can read this, your email sender works. Your receptionist will use it to send sign-in links and notices.`,
    });
    return { ok: true, message: `Test email sent to ${to}. Check your inbox (and spam folder).` };
  } catch (e) {
    return { ok: false, message: smtpProblem(e) };
  } finally {
    t.close();
  }
}

// ---------------- Calendars ----------------
// Neither provider has a "check my client id" endpoint. We ask each one's
// token endpoint to swap a made-up sign-in code: a wrong id/secret is
// rejected as "invalid_client"; right ones get past that and fail on the
// made-up code instead ("invalid_grant"). Nothing is created either way.

export async function checkGoogle(clientId: string, clientSecret: string, redirectUri: string): Promise<Check> {
  clientId = clientId.trim();
  clientSecret = clientSecret.trim();
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) return { ok: false, message: "The Client ID should end in .apps.googleusercontent.com" };
  if (!clientSecret) return { ok: false, message: "Paste the Client secret too." };
  if (MOCK && process.env.MOCK_OAUTH === "1") return { ok: true, message: "Google accepted these keys (test mode)." };
  try {
    const res = await timed("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "installer-check", client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (j.error === "invalid_client" || j.error === "unauthorized_client") return { ok: false, message: "Google didn't recognise that Client ID and secret together. Copy both again from the same OAuth client." };
    if (j.error === "invalid_grant" || j.error === "redirect_uri_mismatch") return { ok: true, message: "Google accepted these keys." };
    return { ok: true, message: "These keys look right, but Google gave an unusual answer, so we couldn't fully check them." };
  } catch (e) {
    return { ok: false, message: netError("Google", e) };
  }
}

export async function checkMicrosoft(clientId: string, clientSecret: string, redirectUri: string): Promise<Check> {
  clientId = clientId.trim();
  clientSecret = clientSecret.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) return { ok: false, message: "The Application (client) ID should look like 1234abcd-12ab-34cd-56ef-1234567890ab." };
  if (!clientSecret) return { ok: false, message: "Paste the client secret Value too." };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(clientSecret)) return { ok: false, message: "That looks like the secret's ID. Copy the secret's Value column instead." };
  if (MOCK && process.env.MOCK_OAUTH === "1") return { ok: true, message: "Microsoft accepted these keys (test mode)." };
  try {
    const res = await timed("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "installer-check", client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, scope: "offline_access" }),
    });
    const j: any = await res.json().catch(() => ({}));
    const desc = String(j.error_description || "");
    if (/AADSTS700016/.test(desc)) return { ok: false, message: "Microsoft can't find an app with that Application (client) ID. Check it, and that the app allows personal and work accounts." };
    if (/AADSTS7000215|AADSTS7000222/.test(desc)) return { ok: false, message: "Microsoft says the client secret is wrong or expired. Make a new one under Certificates & secrets and copy its Value." };
    if (j.error === "invalid_client") return { ok: false, message: "Microsoft didn't accept that ID and secret together." };
    return { ok: true, message: "Microsoft found your app and accepted the secret." };
  } catch (e) {
    return { ok: false, message: netError("Microsoft", e) };
  }
}

// ---------------- DNS ----------------

let mockDnsChecks = 0;
export async function resolveA(domain: string, expectIp?: string): Promise<string[]> {
  if (MOCK) {
    // Pretend the record "propagates" after a few checks.
    mockDnsChecks++;
    return mockDnsChecks >= 3 && expectIp ? [expectIp] : [];
  }
  const r = new Resolver({ timeout: 4000, tries: 1 });
  r.setServers(["1.1.1.1", "8.8.8.8"]);
  try {
    return await r.resolve4(domain);
  } catch {
    return [];
  }
}

export function normalizeDomain(v: string): string | null {
  let d = v.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return null;
  return d;
}

/** "reception.acme.com" -> { name: "reception", zone: "acme.com" } (best guess; good enough for instructions). */
export function splitDomain(d: string): { name: string; zone: string } {
  const parts = d.split(".");
  const twoPartTlds = /^(com|net|org|co|gov|edu|ac|id)\.(au|nz|uk|za|jp|in|sg|br|mx)$/;
  const zoneLen = parts.length >= 3 && twoPartTlds.test(parts.slice(-2).join(".")) ? 3 : 2;
  const zone = parts.slice(-zoneLen).join(".");
  const name = parts.slice(0, -zoneLen).join(".") || "@";
  return { name, zone };
}
