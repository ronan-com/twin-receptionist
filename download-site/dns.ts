// DNS writers: one small interface over Cloudflare and GoDaddy, so the install (setup.ts) and our admin's
// "Set up for them" panel (assist.ts) write records the same way. Nothing here stores a credential.
//   Cloudflare  existing cfEnsure() in providers.ts (records created or updated, DNS only, never proxied)
//   GoDaddy     GET /v1/domains/{domain} to check the key, PATCH /v1/domains/{domain}/records to add records
//               (API key + secret from developer.godaddy.com; it works for single-domain accounts)
// remove() takes back a record ensure() made (Delete the project / Delete the server). It never removes a record
// that was already there before we wrote ours.
import { ANY_MOCK, CONFIG } from "./lib";
import { CF_API, ProviderError, cfEnsure, cfHasDmarc, cfFindZone, cfRecords, normalizeDomain, type Check } from "./providers";
import type { DnsRecord, SetupData } from "./store";
import { getSecret } from "./store";

export interface DnsWriter {
  kind: "cloudflare" | "godaddy";
  /** Make `rec` exist; returns an id we can show or delete later (Cloudflare's record id; GoDaddy has none, so "name/type"). */
  ensure(rec: DnsRecord): Promise<string>;
  /** Take back a record ensure() wrote (rec.cfId is the id it returned). A record that was already there is left alone. */
  remove(rec: DnsRecord): Promise<void>;
  hasDmarc(zone: string): Promise<boolean>;
}

// ---------------- GoDaddy ----------------
// A test site (any MOCK_* on) never calls the real GoDaddy: it gets the fake in mock/serve.ts (MOCK_PORT_BASE + 7).
export const GODADDY_API = () => (process.env.GODADDY_API_BASE || (ANY_MOCK ? `${CONFIG.mockBase}:${Number(process.env.MOCK_PORT_BASE || 4520) + 7}` : "https://api.godaddy.com")).trim().replace(/\/$/, "");
/** The id ensure() gives a GoDaddy record that was already there (so remove() leaves it). */
const GD_EXISTING = "/existing";
const GD_UA = "receptionist-setup/1.0";

async function gd(key: string, secret: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  let res: Response;
  try {
    res = await fetch(GODADDY_API() + path, {
      method,
      headers: { Authorization: `sso-key ${key}:${secret}`, Accept: "application/json", "Content-Type": "application/json", "User-Agent": GD_UA },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
  } catch (e: any) {
    throw new ProviderError(e?.name === "TimeoutError" ? "GoDaddy didn't answer in time. Try again in a minute." : "We couldn't reach GoDaddy just now. Try again in a minute.");
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json };
}
function gdFail(status: number, json: any): never {
  const said = String(json?.message || json?.code || "").slice(0, 200);
  if (status === 401) throw new ProviderError("GoDaddy didn't accept that key and secret: copy both again, or make a new pair (Production, not Test).", 401);
  if (status === 403) throw new ProviderError("GoDaddy refused that key for this domain. Its DNS API needs a Production key, and the account must own the domain (or have 10+ domains).", 403);
  if (status === 404) throw new ProviderError("That domain isn't in this GoDaddy account.", 404);
  if (status === 429) throw new ProviderError("GoDaddy is busy: wait a minute and try again.", 429);
  if (status >= 500) throw new ProviderError("GoDaddy is having a problem: try again in a few minutes.", status);
  throw new ProviderError(`GoDaddy said: ${said || "error " + status}`, status);
}

export interface GdDomain { domain: string; status: string }
/** GET /v1/domains/{domain}: is the key good, and is the domain here? Tries the parents too (setup.example.com -> example.com). */
export async function checkGoDaddy(key: string, secret: string, host: string): Promise<Check<{ zone: string }>> {
  if (!key || !secret) return { ok: false, message: "Paste the GoDaddy API key and the secret." };
  if (/\s/.test(key) || /\s/.test(secret)) return { ok: false, message: "The key or secret has spaces in it: copy just the key." };
  const d = normalizeDomain(host);
  if (!d) return { ok: false, message: "Type the domain, like yourbusiness.com.au." };
  try {
    const labels = d.split(".");
    let last: { status: number; json: any } = { status: 404, json: null };
    for (let i = 0; i < labels.length - 1; i++) {
      const name = labels.slice(i).join(".");
      last = await gd(key, secret, "GET", `/v1/domains/${encodeURIComponent(name)}`);
      if (last.status === 200) {
        const st = String(last.json?.status || "").toUpperCase();
        if (st && st !== "ACTIVE") return { ok: false, message: `GoDaddy says ${name} is ${st.toLowerCase().replace(/_/g, " ")}, so it can't take DNS changes yet.` };
        return { ok: true, message: `Connected to GoDaddy. ${name} is in this account.`, zone: name };
      }
      if (last.status === 401 || last.status === 403 || last.status === 429 || last.status >= 500) gdFail(last.status, last.json);
    }
    gdFail(last.status, last.json);
  } catch (e: any) {
    return { ok: false, message: e instanceof ProviderError ? e.message : "Something went wrong checking GoDaddy. Try again." };
  }
}

/** A full name (app.example.com) as GoDaddy wants it inside zone example.com: "app", or "@" for the apex. */
export function gdName(name: string, zone: string): string {
  const n = String(name || "").toLowerCase().replace(/\.$/, "");
  if (!n || n === zone) return "@";
  if (n.endsWith("." + zone)) return n.slice(0, -(zone.length + 1));
  throw new ProviderError(`${n} isn't part of ${zone}, so it can't be added there.`);
}
const unq = (s: string) => String(s ?? "").replace(/^"|"$/g, "").replace(/" "/g, "");
/** What GoDaddy takes for one of our records. TTL "Auto" becomes GoDaddy's minimum of 600. */
export function gdBody(rec: DnsRecord, zone: string) {
  return {
    type: rec.type,
    name: gdName(rec.name, zone),
    data: rec.type === "TXT" ? rec.value : rec.value.replace(/\.$/, ""),
    ttl: rec.ttl === "Auto" ? 600 : Math.max(600, Number(rec.ttl) || 600),
    ...(rec.type === "MX" ? { priority: rec.priority ?? 10 } : {}),
  };
}

export function godaddyWriter(key: string, secret: string, zone: string, opts: { replace?: boolean } = {}): DnsWriter {
  const z = encodeURIComponent(zone);
  const all = async (): Promise<any[]> => {
    const r = await gd(key, secret, "GET", `/v1/domains/${z}/records`);
    if (r.status !== 200) gdFail(r.status, r.json);
    return Array.isArray(r.json) ? r.json : [];
  };
  return {
    kind: "godaddy",
    async ensure(rec) {
      const body = gdBody(rec, zone);
      const here = (await all()).filter((x) => String(x.name).toLowerCase() === body.name);
      const same = here.find((x) => x.type === body.type && unq(x.data).toLowerCase() === body.data.toLowerCase() && (body.type !== "MX" || Number(x.priority ?? 10) === body.priority));
      const id = `${body.name}/${body.type}`;
      if (same) return id + GD_EXISTING;
      if (rec.type === "A" || rec.type === "CNAME") {
        const clash = here.filter((x) => ["A", "AAAA", "CNAME"].includes(x.type));
        if (clash.length) {
          if (!opts.replace) throw new ProviderError(`${rec.name} already points somewhere else (${clash.map((x) => `${x.type} ${x.data}`).join(", ")}). Tick "replace what's there" to change it.`, 409);
          // PUT replaces every record of that type at that name. Other types at the name must go first (a CNAME can't share a name).
          for (const t of new Set(clash.map((x) => x.type).filter((t) => t !== rec.type))) {
            const del = await gd(key, secret, "DELETE", `/v1/domains/${z}/records/${t}/${encodeURIComponent(body.name)}`);
            if (del.status >= 300) gdFail(del.status, del.json);
          }
          const put = await gd(key, secret, "PUT", `/v1/domains/${z}/records/${rec.type}/${encodeURIComponent(body.name)}`, [{ data: body.data, ttl: body.ttl }]);
          if (put.status >= 300) gdFail(put.status, put.json);
          return id;
        }
      }
      const r = await gd(key, secret, "PATCH", `/v1/domains/${z}/records`, [body]);
      if (r.status >= 300) gdFail(r.status, r.json);
      return id;
    },
    async remove(rec) {
      if (!rec.cfId || rec.cfId.endsWith(GD_EXISTING)) return;
      const body = gdBody(rec, zone);
      const path = `/v1/domains/${z}/records/${body.type}/${encodeURIComponent(body.name)}`;
      const r = await gd(key, secret, "GET", path);
      if (r.status === 404) return;
      if (r.status !== 200) gdFail(r.status, r.json);
      const here: any[] = Array.isArray(r.json) ? r.json : [];
      const ours = (x: any) => unq(x.data).toLowerCase() === body.data.toLowerCase() && (body.type !== "MX" || Number(x.priority ?? 10) === body.priority);
      if (!here.some(ours)) return; // already gone, or changed since: not ours to touch
      const rest = here.filter((x) => !ours(x));
      // DELETE takes every record of that type at that name; when others share it, PUT back just those.
      const res = rest.length
        ? await gd(key, secret, "PUT", path, rest.map((x) => ({ data: x.data, ttl: x.ttl, ...(x.priority != null ? { priority: x.priority } : {}) })))
        : await gd(key, secret, "DELETE", path);
      if (res.status >= 300 && res.status !== 404) gdFail(res.status, res.json);
    },
    async hasDmarc(zone2) {
      const name = gdName(`_dmarc.${zone2}`, zone);
      return (await all()).some((x) => x.type === "TXT" && String(x.name).toLowerCase() === name && /^v=DMARC1/i.test(unq(x.data)));
    },
  };
}

// ---------------- Cloudflare (the same code the wizard has always used) ----------------
export function cloudflareWriter(token: string, zoneId: string): DnsWriter {
  return { kind: "cloudflare", ensure: (rec) => cfEnsure(token, zoneId, rec), remove: (rec) => cfDelete(token, zoneId, rec.cfId), hasDmarc: (zone) => cfHasDmarc(token, zoneId, zone) };
}
/** DELETE one Cloudflare record by the id cfEnsure() gave it. Gone already is fine. */
export async function cfDelete(token: string, zoneId: string, id?: string): Promise<void> {
  if (!id) return;
  let res: Response;
  try {
    res = await fetch(`${CF_API}/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "User-Agent": GD_UA }, redirect: "error", signal: AbortSignal.timeout(15000) });
  } catch { throw new ProviderError("We couldn't reach Cloudflare just now. Try again in a minute."); }
  if (!res.ok && res.status !== 404) throw new ProviderError(`Cloudflare didn't delete the record (error ${res.status}).`, res.status);
}

/** The writer for this buyer's chosen DNS (Cloudflare or GoDaddy), from the keys we hold. null for "I add the records myself". */
export function writerFor(id: number, s: SetupData, opts: { replace?: boolean } = {}): DnsWriter | null {
  const d = s.domain;
  if (!d) return null;
  if (d.mode === "cloudflare") {
    const t = getSecret(id, "cf_token");
    return t && d.cf?.zoneId ? cloudflareWriter(t, d.cf.zoneId) : null;
  }
  if (d.mode === "godaddy") {
    const k = getSecret(id, "godaddy_key"), sec = getSecret(id, "godaddy_secret");
    return k && sec && d.zone ? godaddyWriter(k, sec, d.zone, { replace: opts.replace ?? !!d.replace }) : null;
  }
  return null;
}
export const dnsKeyMissing = (s: SetupData) => (s.domain?.mode === "godaddy" ? "Your GoDaddy key is missing. Check it again on the Domain step." : "Your Cloudflare token is missing. Check it again on the Domain step.");

/** A Cloudflare link that opens "create token" already filled in: Zone Read + DNS Edit, for all zones. */
export const cloudflareTokenLink = (label = `${CONFIG.productName} setup`) =>
  `https://dash.cloudflare.com/profile/api-tokens?${new URLSearchParams({ permissionGroupKeys: JSON.stringify([{ key: "zone", type: "read" }, { key: "dns", type: "edit" }]), name: label, accountId: "*", zoneId: "all" })}`;

export { cfFindZone, cfRecords };

/** What's already at `host` (A, AAAA or CNAME) in a GoDaddy zone, as "CNAME x.example.com", or undefined. */
export async function godaddyExisting(key: string, secret: string, zone: string, host: string): Promise<string | undefined> {
  const name = gdName(host, zone);
  const r = await gd(key, secret, "GET", `/v1/domains/${encodeURIComponent(zone)}/records`);
  if (r.status !== 200) gdFail(r.status, r.json);
  const here = (Array.isArray(r.json) ? r.json : []).filter((x: any) => String(x.name).toLowerCase() === name && ["A", "AAAA", "CNAME"].includes(x.type));
  return here.length ? here.map((x: any) => `${x.type} ${x.data}`).join(", ") : undefined;
}
