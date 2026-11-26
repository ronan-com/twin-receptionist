// Every call we make to a buyer's provider account. Each check answers in plain
// English and never echoes the key it was given. In test mode (MOCK_*=1) each base
// URL points at the local fakes in mock/serve.ts instead; nothing real is called.
import { Resolver } from "node:dns/promises";
import nodemailer from "nodemailer";
import { CONFIG } from "./lib";
import type { DnsRecord } from "./store";

const MB = Number(process.env.MOCK_PORT_BASE || 4520); // the fakes in mock/serve.ts listen on MB+1..MB+5
const M = (offset: number) => `${CONFIG.mockBase}:${MB + offset}`;
export const DO_API = (process.env.DO_API_BASE || (CONFIG.mockDO ? M(1) : "https://api.digitalocean.com")).replace(/\/$/, "");
export const CF_API = (process.env.CF_API_BASE || (CONFIG.mockCF ? M(3) + "/client/v4" : "https://api.cloudflare.com/client/v4")).replace(/\/$/, "");
export const RESEND_API = (process.env.RESEND_API_BASE || (CONFIG.mockResend ? M(4) : "https://api.resend.com")).replace(/\/$/, "");
export const RAILWAY_API = (process.env.RAILWAY_API_BASE || (CONFIG.mockRailway ? M(6) : "https://backboard.railway.com")).replace(/\/$/, "");
const TELNYX_API = "https://api.telnyx.com";
const VAPI_API = "https://api.vapi.ai";
const UA = "receptionist-setup/1.0";

export type Check<T = {}> = ({ ok: true; message: string } & T) | { ok: false; message: string };

export class ProviderError extends Error {
  constructor(message: string, public status = 0, public code = "") {
    super(message);
  }
}

async function call(provider: string, url: string, init: RequestInit = {}, ms = 25000): Promise<{ status: number; json: any }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(ms) });
  } catch (e: any) {
    throw new ProviderError(e?.name === "TimeoutError" ? `${provider} didn't answer in time. Try again in a minute.` : `We couldn't reach ${provider} just now. Try again in a minute.`);
  }
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { status: res.status, json };
}

const hasSpace = (s: string) => /\s/.test(s);

// ======================= DigitalOcean =======================
export async function doApi<T = any>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const { status, json } = await call("DigitalOcean", DO_API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": UA },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (status >= 200 && status < 300) return json as T;
  const said = String(json?.message || "").slice(0, 200);
  if (status === 401) throw new ProviderError("DigitalOcean didn't accept that token: copy it again, or make a new one.", 401);
  if (status === 403) throw new ProviderError("That token can only read: make a new one with Full Access.", 403);
  if (status === 404) throw new ProviderError("DigitalOcean couldn't find that (it may have been deleted already).", 404);
  if (status === 429) throw new ProviderError("DigitalOcean is busy: wait a minute and try again.", 429);
  if (status >= 500) throw new ProviderError("DigitalOcean is having a problem: try again in a few minutes.", status);
  if (/droplet limit/i.test(said)) throw new ProviderError("Your DigitalOcean account is at its server limit: delete one, or ask DigitalOcean to raise it.", status);
  throw new ProviderError(`DigitalOcean said: ${said || "error " + status}`, status);
}

export const DEFAULT_REGION = "syd1";
export const DEFAULT_SIZE = "s-2vcpu-2gb";

export async function checkDigitalOcean(token: string) {
  if (!token) return { ok: false as const, message: "Paste your DigitalOcean token." };
  if (hasSpace(token)) return { ok: false as const, message: "That token has spaces in it: copy just the token." };
  try {
    const a = (await doApi(token, "GET", "/v2/account")).account || {};
    if (a.status && a.status !== "active") return { ok: false as const, message: `Your DigitalOcean account is "${a.status}". ${a.status_message || "Add a payment method and finish sign-up in DigitalOcean, then try again."}` };
    if (a.email_verified === false) return { ok: false as const, message: "Confirm your email with DigitalOcean first, then try again." };
    if (typeof a.droplet_limit === "number" && a.droplet_limit < 1) return { ok: false as const, message: "Add a payment method in DigitalOcean (Billing), then try again." };
    // A read-only token passes every GET, so prove write access with a harmless write:
    // the "receptionist" tag, which the server is tagged with anyway.
    try {
      await doApi(token, "POST", "/v2/tags", { name: "receptionist" });
    } catch (e: any) {
      if (!(e instanceof ProviderError && e.status === 422)) throw e; // 422 = tag already exists, which is fine
    }
    const [rr, sr] = await Promise.all([doApi(token, "GET", "/v2/regions?per_page=200"), doApi(token, "GET", "/v2/sizes?per_page=200")]);
    const regions = (rr.regions || []).filter((r: any) => r.available).map((r: any) => ({ slug: String(r.slug), name: String(r.name) })).sort((x: any, y: any) => x.name.localeCompare(y.name));
    const sizes = (sr.sizes || [])
      .filter((s: any) => s.available && /^s-/.test(s.slug) && s.memory >= 2048 && s.memory <= 8192)
      .map((s: any) => ({ slug: String(s.slug), price: Number(s.price_monthly), regions: (s.regions || []).map(String), label: `${s.vcpus} CPU, ${s.memory / 1024} GB memory, ${s.disk} GB disk` }))
      .sort((x: any, y: any) => x.price - y.price);
    if (!regions.length || !sizes.length) return { ok: false as const, message: "DigitalOcean didn't offer any server sizes we can use. Try again later." };
    return { ok: true as const, message: `Connected to DigitalOcean${a.email ? ` (${a.email})` : ""}.`, accountEmail: String(a.email || ""), regions, sizes };
  } catch (e: any) {
    return { ok: false as const, message: e instanceof ProviderError ? e.message : "Something went wrong checking DigitalOcean. Try again." };
  }
}

// ======================= Cloudflare =======================
async function cf(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const { status, json } = await call("Cloudflare", CF_API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": UA },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (json?.success && status < 300) return json;
  const err = (json?.errors || [])[0] || {};
  const said = String(err.message || "").slice(0, 200);
  if (status === 401 || err.code === 1000 || err.code === 6003 || err.code === 6111) throw new ProviderError("Cloudflare didn't accept that token: copy it again, or make a new one.", 401, String(err.code || ""));
  if (status === 403 || err.code === 10000 || err.code === 9109) throw new ProviderError("That token needs Zone: Read and DNS: Edit for your domain.", 403, String(err.code || ""));
  if (status === 429) throw new ProviderError("Cloudflare is busy: wait a minute and try again.", 429);
  if (status >= 500) throw new ProviderError("Cloudflare is having a problem: try again in a few minutes.", status);
  throw new ProviderError(`Cloudflare said: ${said || "error " + status}`, status, String(err.code || ""));
}

export interface CfZone { id: string; name: string; status: string; nameServers: string[] }
const zoneOf = (z: any): CfZone => ({ id: String(z.id), name: String(z.name), status: String(z.status), nameServers: (z.name_servers || []).map(String) });

export async function checkCloudflare(token: string): Promise<Check<{ zones: CfZone[] }>> {
  if (!token) return { ok: false, message: "Paste your Cloudflare API token first." };
  if (hasSpace(token)) return { ok: false, message: "That token has spaces in it: copy just the token." };
  try {
    try {
      const v = await cf(token, "GET", "/user/tokens/verify");
      if (v.result?.status && v.result.status !== "active") return { ok: false, message: `That Cloudflare token is ${v.result.status}. Create a new one.` };
    } catch (e: any) {
      // Account-owned tokens can't use the user verify endpoint; listing zones below is the real test.
      if (!(e instanceof ProviderError) || e.status >= 500 || e.status === 429) throw e;
    }
    const z = await cf(token, "GET", "/zones?per_page=5");
    const zones = (z.result || []).map(zoneOf);
    if (!zones.length) return { ok: false, message: "That token can't see any domains: add your domain to Cloudflare first." };
    return { ok: true, message: `Connected to Cloudflare. Found ${zones.length === 1 ? "your domain" : `${zones.length} domains`}.`, zones };
  } catch (e: any) {
    return { ok: false, message: e instanceof ProviderError ? e.message : "Something went wrong checking Cloudflare. Try again." };
  }
}

export async function cfZone(token: string, zoneId: string): Promise<CfZone> {
  return zoneOf((await cf(token, "GET", `/zones/${encodeURIComponent(zoneId)}`)).result);
}

export async function cfRecords(token: string, zoneId: string, name: string, type?: string): Promise<any[]> {
  const q = new URLSearchParams({ "name.exact": name, per_page: "100" });
  if (type) q.set("type", type);
  return (await cf(token, "GET", `/zones/${encodeURIComponent(zoneId)}/dns_records?${q}`)).result || [];
}

/**
 * The Cloudflare zone for `domain` (or a parent of it), looked up by name so accounts with
 * many domains work. null when this token can't see it.
 */
export async function cfFindZone(token: string, domain: string): Promise<CfZone | null> {
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join(".");
    const z = await cf(token, "GET", `/zones?${new URLSearchParams({ name, per_page: "5" })}`);
    const hit = (z.result || []).map(zoneOf).find((x: CfZone) => x.name === name);
    if (hit) return hit;
  }
  return null;
}

/** Can this token write DNS? Writes a throwaway TXT record and removes it again. */
export async function cfCanEdit(token: string, zoneId: string, zone: string): Promise<boolean> {
  try {
    const r = await cf(token, "POST", `/zones/${encodeURIComponent(zoneId)}/dns_records`, { type: "TXT", name: `_setup-check.${zone}`, content: "\"setup permission check\"", ttl: 60, comment: "temporary, removed straight away" });
    await cf(token, "DELETE", `/zones/${encodeURIComponent(zoneId)}/dns_records/${r.result.id}`).catch(() => {});
    return true;
  } catch (e: any) {
    if (e instanceof ProviderError && e.status === 403) return false;
    throw e;
  }
}

const cfBody = (r: DnsRecord) => ({
  type: r.type,
  name: r.name,
  content: r.type === "TXT" ? `"${r.value}"` : r.value,
  ttl: r.ttl === "Auto" ? 1 : r.ttl,
  proxied: r.type === "A" || r.type === "CNAME" ? false : undefined, // DNS only, so the server can get its certificate
  priority: r.type === "MX" ? r.priority ?? 10 : undefined,
  comment: `Added by the ${CONFIG.productName} setup`,
});
const unq = (s: string) => String(s || "").replace(/^"|"$/g, "").replace(/" "/g, "");

/**
 * Makes `rec` exist in the zone. A records replace whatever A/AAAA/CNAME is at that name
 * (only after the buyer agreed); DKIM/SPF TXT records update a record of the same kind.
 * Returns the Cloudflare record id.
 */
export async function cfEnsure(token: string, zoneId: string, rec: DnsRecord): Promise<string> {
  const z = encodeURIComponent(zoneId);
  const here = await cfRecords(token, zoneId, rec.name);
  const same = here.find((x) => x.type === rec.type && unq(x.content).toLowerCase() === rec.value.toLowerCase() && (rec.type !== "MX" || x.priority === (rec.priority ?? 10)));
  if (same) {
    if ((rec.type === "A" || rec.type === "CNAME") && same.proxied) await cf(token, "PATCH", `/zones/${z}/dns_records/${same.id}`, { proxied: false });
    if (rec.type === "A" || rec.type === "CNAME") for (const x of here) if (x.id !== same.id && ["A", "AAAA", "CNAME"].includes(x.type)) await cf(token, "DELETE", `/zones/${z}/dns_records/${x.id}`);
    return same.id;
  }
  let replace: any;
  if (rec.type === "CNAME") {
    // A CNAME can't share its name with anything: clear what's there (the buyer agreed on the Domain step).
    for (const x of here) if (["A", "AAAA", "CNAME"].includes(x.type)) await cf(token, "DELETE", `/zones/${z}/dns_records/${x.id}`);
  } else if (rec.type === "A") {
    replace = here.find((x) => x.type === "A");
    for (const x of here) if (x !== replace && ["A", "AAAA", "CNAME"].includes(x.type)) await cf(token, "DELETE", `/zones/${z}/dns_records/${x.id}`);
  } else if (rec.type === "TXT") {
    const kind = (v: string) => (/^v=spf1/i.test(v) ? "spf" : /^v=DMARC1/i.test(v) ? "dmarc" : /^p=/.test(v) || /_domainkey\./.test(rec.name) ? "dkim" : "other");
    replace = here.find((x) => x.type === "TXT" && kind(unq(x.content)) === kind(rec.value) && kind(rec.value) !== "other");
  }
  if (replace) return (await cf(token, "PATCH", `/zones/${z}/dns_records/${replace.id}`, cfBody(rec))).result.id;
  return (await cf(token, "POST", `/zones/${z}/dns_records`, cfBody(rec))).result.id;
}

/** True when a DMARC record already exists for the zone. */
export async function cfHasDmarc(token: string, zoneId: string, zone: string): Promise<boolean> {
  return (await cfRecords(token, zoneId, `_dmarc.${zone}`, "TXT")).some((x) => /^v=DMARC1/i.test(unq(x.content)));
}

// ======================= Railway =======================
// Public GraphQL API (https://docs.railway.com/integrations/api) with the buyer's account
// token. The app's code goes up the same way `railway up` sends it: a .tar.gz posted to
// backboard's /project/<id>/environment/<id>/up, so it never has to be public anywhere.
export const RAILWAY_TOKEN_MSG = "Railway didn't accept that token. Make it under Account Settings > Tokens with Workspace set to No workspace, then paste it again.";
export const RAILWAY_PLAN_MSG = "Your Railway account needs the Hobby plan (US$5 a month, with a card) to run your agency. Upgrade in Railway, then press Check again.";
const railwayErr = (status: number, said: string): ProviderError => {
  if (status === 401 || status === 403 || /not authori[sz]ed|unauthori[sz]ed|invalid (api )?token|authentication/i.test(said)) return new ProviderError(RAILWAY_TOKEN_MSG, 401);
  if (status === 429 || /rate limit/i.test(said)) return new ProviderError("Railway is busy: wait a minute and try again.", 429);
  if (/upgrade|trial|plan limit|free plan|payment|credit card|add a card|limited/i.test(said)) return new ProviderError(RAILWAY_PLAN_MSG, 402, "plan");
  if (status >= 500) return new ProviderError("Railway is having a problem: try again in a few minutes.", status);
  return new ProviderError(`Railway said: ${said.slice(0, 200) || "error " + status}`, status || 400);
};
export async function railway<T = any>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const { status, json } = await call("Railway", `${RAILWAY_API}/graphql/v2`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ query, variables }),
  });
  const said = String(json?.errors?.[0]?.message || json?.message || "");
  if (status >= 300 || json?.errors?.length) throw railwayErr(status >= 300 ? status : 0, said);
  return json.data as T;
}

export interface RailwayWorkspace { id: string; name: string; plan?: string; hasCard?: boolean; trialing?: boolean }
export async function checkRailway(token: string): Promise<Check<{ email: string; workspace: RailwayWorkspace }>> {
  if (!token) return { ok: false, message: "Paste your Railway token." };
  if (hasSpace(token)) return { ok: false, message: "That token has spaces in it: copy just the token." };
  try {
    const me = (await railway(token, "query { me { email workspaces { id name } } }")).me;
    const all: RailwayWorkspace[] = (me.workspaces || []).map((w: any) => ({ id: String(w.id), name: String(w.name) }));
    if (!all.length) return { ok: false, message: "That Railway account has no workspace yet. Open Railway once to finish signing up, then try again." };
    // Plan and card, best effort: the check above is the one that must work.
    try {
      const pl = (await railway(token, "query { me { workspaces { id plan customer { isTrialing defaultPaymentMethodId } } } }")).me.workspaces || [];
      for (const w of all) {
        const x = pl.find((p: any) => String(p.id) === w.id);
        if (x) { w.plan = String(x.plan || ""); w.hasCard = !!x.customer?.defaultPaymentMethodId; w.trialing = !!x.customer?.isTrialing; }
      }
    } catch (e) { if (e instanceof ProviderError && e.status === 401) throw e; }
    const paid = all.find((w) => (w.plan === "HOBBY" || w.plan === "PRO") && w.hasCard !== false);
    // Railway's free trial (US$5 of credit) is enough to set up and try the agency.
    const trial = paid ? undefined : all.find((w) => w.trialing);
    const known = all.some((w) => w.plan);
    if (!paid && !trial && known) return { ok: false, message: RAILWAY_PLAN_MSG };
    const ws = paid || trial || all[0];
    const note = trial ? " You're on Railway's free trial (US$5 of credit). Add a card in Railway before it runs out, or your agency stops." : "";
    return { ok: true, message: `Connected to Railway${me.email ? ` (${me.email})` : ""}.${note}`, email: String(me.email || ""), workspace: ws };
  } catch (e: any) {
    return { ok: false, message: e instanceof ProviderError ? e.message : "Something went wrong checking Railway. Try again." };
  }
}

/** Sends the app's source (.tar.gz) to a service; Railway builds it with deploy/Dockerfile. */
export async function railwayUpload(token: string, projectId: string, environmentId: string, serviceId: string, body: Uint8Array, message: string): Promise<{ deploymentId: string; url?: string; deploymentDomain?: string }> {
  const q = new URLSearchParams({ serviceId, message });
  let res: Response;
  try {
    res = await fetch(`${RAILWAY_API}/project/${encodeURIComponent(projectId)}/environment/${encodeURIComponent(environmentId)}/up?${q}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(300_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/gzip", "User-Agent": UA }, body,
    });
  } catch { throw new ProviderError("We couldn't send the app to Railway just now. Press Try again."); }
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  if (res.status === 413) throw new ProviderError("Railway said the app upload is too large. Contact support.", 413);
  if (!res.ok) throw railwayErr(res.status, String(json?.message || json?.error || ""));
  if (!json.deploymentId) throw new ProviderError("Railway took the upload but didn't start a build. Press Try again.", 500);
  return { deploymentId: String(json.deploymentId), url: json.url, deploymentDomain: json.deploymentDomain };
}

// ======================= Telnyx =======================
export async function checkTelnyx(key: string): Promise<Check<{ balance: string }>> {
  if (!key) return { ok: false, message: "Paste your Telnyx API key first." };
  if (hasSpace(key)) return { ok: false, message: "That key has spaces in it: copy just the key." };
  const bad = "Telnyx didn't accept that key: copy it again from API Keys, or make a new one.";
  if (CONFIG.mockTelnyx) {
    // Test mode: never calls Telnyx. Only pretend keys (platform-fake-...) pass; the installed app treats them as a fake phone provider.
    return key.startsWith("platform-fake-") ? { ok: true, message: "Telnyx key works (test mode). Available credit: 25.00 USD.", balance: "25.00 USD" } : { ok: false, message: bad };
  }
  const { status, json } = await call("Telnyx", `${TELNYX_API}/v2/balance`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "User-Agent": UA } }).catch((e) => ({ status: -1, json: { e } }));
  if (status === -1) return { ok: false, message: (json.e as Error).message };
  if (status === 401 || status === 403) return { ok: false, message: bad };
  if (status !== 200) return { ok: false, message: `Telnyx had a problem (error ${status}). Wait a minute and try again.` };
  const d = json.data || {};
  const balance = `${Number(d.available_credit ?? d.balance ?? 0).toFixed(2)} ${d.currency || "USD"}`;
  return { ok: true, message: `Telnyx key works. Available credit: ${balance}.`, balance };
}

// ======================= Vapi =======================
// Phones can run on Vapi instead of Telnyx. The private key is checked with one cheap read;
// the public key (the browser test call uses it) can only be checked for its shape.
export async function checkVapi(key: string, publicKey: string): Promise<Check<{}>> {
  if (!key) return { ok: false, message: "Paste your Vapi private API key first." };
  if (hasSpace(key) || hasSpace(publicKey)) return { ok: false, message: "That key has spaces in it: copy just the key." };
  if (!publicKey) return { ok: false, message: "Paste your Vapi public key too. It's the other key on the same API Keys page." };
  if (key === publicKey) return { ok: false, message: "Those two are the same key. The private key and the public key are different ones on Vapi's API Keys page." };
  const bad = "Vapi didn't accept that private key: copy it again from API Keys in the Vapi dashboard, or make a new one.";
  if (CONFIG.mockTelnyx) {
    // Test mode: never calls Vapi. Only pretend keys (platform-fake-...) pass.
    return key.startsWith("platform-fake-") ? { ok: true, message: "Vapi key works (test mode)." } : { ok: false, message: bad };
  }
  const { status, json } = await call("Vapi", `${VAPI_API}/assistant?limit=1`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "User-Agent": UA } }).catch((e) => ({ status: -1, json: { e } }));
  if (status === -1) return { ok: false, message: (json.e as Error).message };
  if (status === 401 || status === 403) return { ok: false, message: bad };
  if (status !== 200) return { ok: false, message: `Vapi had a problem (error ${status}). Wait a minute and try again.` };
  return { ok: true, message: "Vapi key works." };
}

// ======================= Twilio (optional, with Vapi) =======================
// Another place phone numbers can come from. Checked with one read of the account.
export async function checkTwilio(accountSid: string, authToken: string): Promise<Check<{ name: string }>> {
  if (!accountSid && !authToken) return { ok: false, message: "Paste your Twilio Account SID and Auth Token." };
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) return { ok: false, message: "That isn't a Twilio Account SID. It starts with AC and is 34 characters; it's on the front page of the Twilio console." };
  if (!authToken || hasSpace(authToken)) return { ok: false, message: "Paste the Twilio Auth Token (one line, no spaces)." };
  const bad = "Twilio didn't accept those: copy the Account SID and Auth Token again from the front page of the Twilio console.";
  if (CONFIG.mockTelnyx) {
    // Test mode: never calls Twilio. Only a pretend account passes.
    return accountSid === "AC" + "0".repeat(32) ? { ok: true, message: "Twilio works (test mode).", name: "Test account" } : { ok: false, message: bad };
  }
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const { status, json } = await call("Twilio", `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json", "User-Agent": UA } }).catch((e) => ({ status: -1, json: { e } }));
  if (status === -1) return { ok: false, message: (json.e as Error).message };
  if (status === 401 || status === 403 || status === 404) return { ok: false, message: bad };
  if (status !== 200) return { ok: false, message: `Twilio had a problem (error ${status}). Wait a minute and try again.` };
  if (json?.status && json.status !== "active") return { ok: false, message: `That Twilio account is ${json.status}. Reactivate it in Twilio first.` };
  return { ok: true, message: "Twilio works.", name: String(json?.friendly_name ?? "") };
}

// ======================= Resend =======================
async function rs(key: string, method: string, path: string, body?: unknown): Promise<any> {
  const { status, json } = await call("Resend", RESEND_API + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": UA },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (status >= 200 && status < 300) return json;
  const name = String(json?.name || "");
  // Only these mean the key itself is wrong. Resend also answers 403 "validation_error" for
  // things like "domain not verified" or "already registered": those show Resend's own words.
  if (name === "restricted_api_key") throw new ProviderError("That Resend key can only send: make one with Full access.", 401, name);
  if (["invalid_api_key", "missing_api_key", "suspended_api_key"].includes(name) || (status === 401 && !name)) throw new ProviderError("Resend didn't accept that key: copy it again, or make a new one.", status, name);
  if (status === 429) throw new ProviderError("Resend is busy: wait a minute and try again.", 429, name);
  if (status >= 500) throw new ProviderError("Resend is having a problem: try again in a few minutes.", status, name);
  throw new ProviderError(`Resend said: ${String(json?.message || "error " + status).slice(0, 200)}`, status, name);
}

export async function checkResend(key: string): Promise<Check> {
  if (!key) return { ok: false, message: "Paste your Resend API key first." };
  if (hasSpace(key)) return { ok: false, message: "That key has spaces in it: copy just the key." };
  try {
    await rs(key, "GET", "/domains");
    return { ok: true, message: "Connected to Resend." };
  } catch (e: any) {
    return { ok: false, message: e instanceof ProviderError ? e.message : "Something went wrong checking Resend. Try again." };
  }
}

/**
 * Resend gives record names relative to the *registered root* domain, not to the sending domain
 * or the wizard's zone: for mail.t1.chloeeai.co it says `resend._domainkey.mail.t1` and `send.mail.t1`
 * (root chloeeai.co); for the apex chloeeai.co it says `resend._domainkey` and `send`.
 * Turn them into full names. No public-suffix list needed: the label path of the sending domain
 * below its root is the tail of the name, so whatever of the domain is left after that tail is the root.
 * `zone` (the wizard's domain, maybe itself a subdomain) is only used to leave names that are already full alone.
 */
export function fqdn(name: string, domain: string, zone: string): string {
  const n = String(name || "").toLowerCase().replace(/\.$/, "");
  if (!n || n === "@") return domain;
  if (n === domain || n === zone || n.endsWith("." + domain) || n.endsWith("." + zone)) return n;
  const nl = n.split("."), dl = domain.split(".");
  for (let k = Math.min(nl.length, dl.length - 1); k >= 1; k--) {
    if (nl.slice(-k).join(".") === dl.slice(0, k).join(".")) return `${n}.${dl.slice(k).join(".")}`;
  }
  return `${n}.${domain}`; // the sending domain is the root itself
}

/** Every domain in the Resend account (it pages). */
async function resendFind(key: string, domain: string): Promise<any | null> {
  let after = "";
  for (let page = 0; page < 20; page++) {
    const list = await rs(key, "GET", `/domains?${new URLSearchParams({ limit: "100", ...(after ? { after } : {}) })}`);
    const data = list.data || [];
    const hit = data.find((x: any) => String(x.name).toLowerCase() === domain);
    if (hit) return hit;
    if (!list.has_more || !data.length) return null;
    after = String(data[data.length - 1].id);
  }
  return null;
}

/** Finds or adds `domain` in Resend. A domain that's already there (an earlier try) is reused. */
export async function resendDomain(key: string, domain: string, zone: string): Promise<{ id: string; status: string; records: DnsRecord[] }> {
  let d = await resendFind(key, domain);
  if (!d) {
    try {
      d = await rs(key, "POST", "/domains", { name: domain, region: "us-east-1", open_tracking: false, click_tracking: false });
    } catch (e) {
      if (!(e instanceof ProviderError && /already/i.test(e.message))) throw e;
      d = await resendFind(key, domain);
      if (!d) throw new ProviderError(`${domain} is already added to another Resend account. Use that account's key, or remove it there first.`, 403);
    }
  }
  if (!d.records) d = await rs(key, "GET", `/domains/${encodeURIComponent(d.id)}`);
  return { id: String(d.id), status: String(d.status), records: resendRecords(d.records || [], domain, zone) };
}

/**
 * A key that can only send, and only from this domain: that's what goes on the buyer's
 * server, never the Full access key they gave us.
 */
export async function resendSendingKey(key: string, name: string, domainId: string): Promise<string> {
  const r = await rs(key, "POST", "/api-keys", { name: name.slice(0, 50), permission: "sending_access", domain_id: domainId });
  if (!r?.token) throw new ProviderError("Resend didn't give us a sending key. Try again in a minute.", 500);
  return String(r.token);
}

/** Resend shows some TXT values wrapped in quote marks; DNS and Cloudflare want them bare. */
export const bareValue = (v: unknown) => String(v ?? "").trim().replace(/^"([\s\S]*)"$/, "$1");

function resendRecords(recs: any[], domain: string, zone: string): DnsRecord[] {
  const purpose = (r: any) => (r.record === "DKIM" ? "Email signing (DKIM)" : r.record === "SPF" ? (r.type === "MX" ? "Bounce handling (MX)" : "Sender check (SPF)") : r.record === "Receiving MX" ? "Receiving email (MX)" : `Email (${r.record || r.type})`);
  return recs
    .filter((r) => ["TXT", "MX", "CNAME"].includes(String(r.type)))
    .map((r, i) => ({
      key: `${String(r.record || r.type).toLowerCase().replace(/\s+/g, "-")}-${String(r.type).toLowerCase()}-${i}`,
      purpose: purpose(r),
      type: r.type,
      name: fqdn(r.name, domain, zone),
      value: bareValue(r.value),
      priority: r.type === "MX" ? Number(r.priority ?? 10) : undefined,
      ttl: "Auto" as const,
    }));
}

export async function resendStatus(key: string, id: string): Promise<{ status: string; recordStatus: Record<string, string> }> {
  const d = await rs(key, "GET", `/domains/${encodeURIComponent(id)}`);
  const recordStatus: Record<string, string> = {};
  for (const r of d.records || []) recordStatus[`${r.type}:${bareValue(r.value).toLowerCase()}`] = String(r.status);
  return { status: String(d.status), recordStatus };
}
export const resendVerify = (key: string, id: string) => rs(key, "POST", `/domains/${encodeURIComponent(id)}/verify`);
export async function resendSend(key: string, from: string, to: string, productName: string): Promise<Check> {
  try {
    await rs(key, "POST", "/emails", {
      from, to: [to],
      subject: `${productName}: your email sender works`,
      text: `This is a test email from the ${productName} setup.\n\nIf you can read this, your email sender works. Your receptionist will use it for sign-in links, invites and call notices.`,
    });
    return { ok: true, message: `Test email sent to ${to}. Check your inbox (and spam folder).` };
  } catch (e: any) {
    return { ok: false, message: e instanceof ProviderError ? e.message : "The test email didn't send. Try again." };
  }
}

// ======================= other SMTP (advanced) =======================
export function smtpUrl(host: string, port: number, user: string, pass: string) {
  return `${port === 465 ? "smtps" : "smtp"}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
}
function smtpProblem(e: any): string {
  const code = e?.code || "";
  const resp = String(e?.response || e?.message || "");
  if (code === "EAUTH" || /535|authentication/i.test(resp)) return "The email server rejected the username or password. Check them (some providers need an app password, not your normal one).";
  if (code === "EDNS" || /ENOTFOUND|EAI_AGAIN/.test(resp)) return "We couldn't find that email server. Check the server name.";
  if (code === "ETIMEDOUT" || /timed? ?out/i.test(resp)) return "The email server didn't answer. Check the server name and port (usually 587 or 465).";
  if (["ECONNREFUSED", "ESOCKET", "ECONNECTION"].includes(code)) return "The email server refused the connection. Check the port: 587 or 465.";
  return "The email server said: " + resp.replace(/[\r\n]+/g, " ").slice(0, 160);
}
const transport = (url: string) => nodemailer.createTransport(url, { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 } as any);
export async function checkSmtp(url: string): Promise<Check> {
  const t = transport(url);
  try { await t.verify(); return { ok: true, message: "Signed in to your email server." }; }
  catch (e) { return { ok: false, message: smtpProblem(e) }; }
  finally { t.close(); }
}
export async function smtpSend(url: string, from: string, to: string, productName: string): Promise<Check> {
  const t = transport(url);
  try {
    await t.sendMail({ from, to, subject: `${productName}: your email sender works`, text: `This is a test email from the ${productName} setup. Your email sender works.` });
    return { ok: true, message: `Test email sent to ${to}. Check your inbox (and spam folder).` };
  } catch (e) { return { ok: false, message: smtpProblem(e) }; }
  finally { t.close(); }
}

// ======================= Google / Microsoft (optional) =======================
// Neither has a "check my client" endpoint: we ask the token endpoint to redeem a made-up
// code. A wrong pair fails with invalid_client; a right one fails later with invalid_grant.
export async function checkGoogle(clientId: string, secret: string, redirectUri: string): Promise<Check> {
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) return { ok: false, message: "The Google Client ID should end in .apps.googleusercontent.com" };
  if (!secret) return { ok: false, message: "Paste the Client secret too." };
  if (CONFIG.mockOAuth) return secret.startsWith("mock-") ? { ok: true, message: "Google accepted these keys (test mode)." } : { ok: false, message: "Google didn't recognise that Client ID and secret together." };
  try {
    const { json } = await call("Google", "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: "setup-check", client_id: clientId, client_secret: secret, redirect_uri: redirectUri }) });
    if (json.error === "invalid_client" || json.error === "unauthorized_client") return { ok: false, message: "Google didn't recognise that Client ID and secret together. Copy both again from the same OAuth client." };
    return { ok: true, message: "Google accepted these keys." };
  } catch (e: any) { return { ok: false, message: e.message }; }
}
export async function checkMicrosoft(clientId: string, secret: string, redirectUri: string): Promise<Check> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) return { ok: false, message: "The Application (client) ID should look like 1234abcd-12ab-34cd-56ef-1234567890ab." };
  if (!secret) return { ok: false, message: "Paste the client secret Value too." };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(secret)) return { ok: false, message: "That looks like the secret's ID. Copy the secret's Value column instead." };
  if (CONFIG.mockOAuth) return secret.startsWith("mock-") ? { ok: true, message: "Microsoft accepted these keys (test mode)." } : { ok: false, message: "Microsoft didn't accept that ID and secret together." };
  try {
    const { json } = await call("Microsoft", "https://login.microsoftonline.com/common/oauth2/v2.0/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: "setup-check", client_id: clientId, client_secret: secret, redirect_uri: redirectUri, scope: "offline_access" }) });
    const desc = String(json.error_description || "");
    if (/AADSTS700016/.test(desc)) return { ok: false, message: "Microsoft can't find an app with that Application (client) ID." };
    if (/AADSTS7000215|AADSTS7000222/.test(desc)) return { ok: false, message: "Microsoft says the client secret is wrong or expired. Make a new one and copy its Value." };
    if (json.error === "invalid_client") return { ok: false, message: "Microsoft didn't accept that ID and secret together." };
    return { ok: true, message: "Microsoft found your app and accepted the secret." };
  } catch (e: any) { return { ok: false, message: e.message }; }
}

// ======================= public DNS =======================
// Never the system resolver. We ask the domain's own nameservers directly when we can find
// them (no cache, so a record shows up the moment it's added), otherwise the public resolvers
// in DNS_SERVERS (1.1.1.1 and 8.8.8.8). Answers are normalised to match DnsRecord.value.
const nsCache = new Map<string, { at: number; ips: string[] }>();
async function authoritative(zone: string): Promise<string[]> {
  const hit = nsCache.get(zone);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.ips;
  const r = new Resolver({ timeout: 3000, tries: 1 });
  r.setServers(CONFIG.dnsServers);
  let ips: string[] = [];
  try {
    const ns = (await r.resolveNs(zone)).slice(0, 4);
    ips = (await Promise.all(ns.map((n) => r.resolve4(n).catch(() => [] as string[])))).flat();
  } catch {}
  nsCache.set(zone, { at: Date.now(), ips });
  return ips;
}
export async function lookup(type: DnsRecord["type"], name: string, zone?: string): Promise<string[]> {
  const servers = (zone && (await authoritative(zone)).length ? await authoritative(zone!) : CONFIG.dnsServers);
  const r = new Resolver({ timeout: 4000, tries: 2 });
  r.setServers(servers);
  try {
    if (type === "A") return await r.resolve4(name);
    if (type === "TXT") return (await r.resolveTxt(name)).map((parts) => parts.join(""));
    if (type === "MX") return (await r.resolveMx(name)).map((m) => `${m.priority} ${m.exchange.toLowerCase().replace(/\.$/, "")}`);
    if (type === "CNAME") return (await r.resolveCname(name)).map((c) => c.toLowerCase().replace(/\.$/, ""));
  } catch {}
  return [];
}
export async function recordLive(rec: DnsRecord, zone?: string): Promise<{ ok: boolean; seen: string }> {
  const got = await lookup(rec.type, rec.name, zone);
  const want = rec.type === "MX" ? `${rec.priority ?? 10} ${rec.value.toLowerCase()}` : rec.type === "TXT" ? rec.value : rec.value.toLowerCase();
  const ok = rec.type === "MX" ? got.some((g) => g === want || g.endsWith(" " + rec.value.toLowerCase())) : got.includes(want);
  return { ok, seen: got.join(", ").slice(0, 200) };
}

export function normalizeDomain(v: string): string | null {
  let d = String(v || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "").replace(/^www\./, "");
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return null;
  return d;
}
