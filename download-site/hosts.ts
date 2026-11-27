// A buyer's setup link on THEIR OWN domain, set up ahead of time by us (admin: "Use their domain for the setup link").
//   https://setup.theirdomain.com/      their wizard at the root: no code in the address
//   https://setup.chloeeai.co/setup/<code>   still works, always
// The DNS record is a CNAME from their name to our site. Caddy (on the server) gets the https certificate on demand,
// but only after asking us here: GET /api/tls-allowed?domain=X answers 200 for a host registered to a buyer whose link is
// still on, and 404 for everything else, so nobody can make our server request certificates for names we don't serve.
// Pages served on such a host show the buyer's brand and never ours (ctx.ts onOwnHost), and nothing of ours is reachable
// there: no /admin, no /api/sync, no other buyer's /setup/<code>.
import { CODE_RE, CONFIG, db, now, type Buyer } from "./lib";
import { lookup, normalizeDomain } from "./providers";
import { onOwnHost } from "./ctx";
import type { DnsRecord } from "./store";

let made = false;
function table() {
  if (made) return;
  db().exec(`CREATE TABLE IF NOT EXISTS custom_hosts (host TEXT PRIMARY KEY, buyer_id INTEGER NOT NULL UNIQUE, created_at TEXT NOT NULL, dns_ok_at TEXT, dns_by TEXT)`);
  made = true;
}

/** Our own address (where the CNAME points): setup.chloeeai.co. */
export const siteHost = () => new URL(CONFIG.siteUrl).hostname.toLowerCase();

export type HostResult = { ok: true; host: string } | { ok: false; message: string };
/** A name like setup.theirdomain.com. Needs a real domain with a subdomain label, and can't be ours or someone else's. */
export function setHostCheck(buyerId: number, raw: string): HostResult {
  table();
  const host = normalizeDomain(raw);
  if (!host) return { ok: false, message: "Type the full address, like setup.theirbusiness.com." };
  if (host.split(".").length < 3) return { ok: false, message: "Use a name under their domain, like setup.theirbusiness.com (not the bare domain: that's their website)." };
  const mine = siteHost();
  if (host === mine || host.endsWith("." + mine) || mine.endsWith("." + host)) return { ok: false, message: `That's our own address (${mine}). Use their domain.` };
  const taken = db().query("SELECT buyer_id FROM custom_hosts WHERE host = ?").get(host) as { buyer_id: number } | null;
  if (taken && taken.buyer_id !== buyerId) return { ok: false, message: "Another buyer already uses that address." };
  return { ok: true, host };
}
export function setHost(buyerId: number, raw: string): HostResult {
  const r = setHostCheck(buyerId, raw);
  if (!r.ok) return r;
  db().query("INSERT INTO custom_hosts (host, buyer_id, created_at) VALUES (?, ?, ?) ON CONFLICT (buyer_id) DO UPDATE SET host = excluded.host, created_at = excluded.created_at, dns_ok_at = NULL, dns_by = NULL").run(r.host, buyerId, now());
  return r;
}
export const hostOfBuyer = (buyerId: number) => (table(), db().query("SELECT host, created_at, dns_ok_at, dns_by FROM custom_hosts WHERE buyer_id = ?").get(buyerId) as { host: string; created_at: string; dns_ok_at: string | null; dns_by: string | null } | null);
export const removeHost = (buyerId: number) => (table(), db().query("DELETE FROM custom_hosts WHERE buyer_id = ?").run(buyerId).changes);
export function markHostDns(buyerId: number, ok: boolean, by?: string) {
  table();
  db().query("UPDATE custom_hosts SET dns_ok_at = ?, dns_by = COALESCE(?, dns_by) WHERE buyer_id = ?").run(ok ? now() : null, by ?? null, buyerId);
}
export function buyerOfHost(host: string): Buyer | null {
  table();
  return (db().query("SELECT b.* FROM custom_hosts h JOIN buyers b ON b.id = h.buyer_id WHERE h.host = ?").get(host.toLowerCase()) as Buyer | null) || null;
}
/** The record to add: setup.theirdomain.com CNAME setup.chloeeai.co. */
export const hostRecord = (host: string): DnsRecord => ({ key: "setup-host", purpose: "Their private setup link", type: "CNAME", name: host, value: siteHost(), ttl: "Auto" });
/** Does public DNS point the name at us yet? */
export async function hostDnsOk(host: string): Promise<{ ok: boolean; seen: string }> {
  const got = await lookup("CNAME", host, host.split(".").slice(1).join("."));
  return { ok: got.includes(siteHost()), seen: got.join(", ").slice(0, 200) };
}

// ---------------- Caddy's "may I get a certificate for this name?" ----------------
/** Registered to a buyer whose link is still on. */
export function tlsAllowed(raw: string): boolean {
  const host = normalizeDomain(raw);
  if (!host) return false;
  const b = buyerOfHost(host);
  return !!b && !b.revoked_at;
}
/** GET /api/tls-allowed?domain=X. Internal only: a request through the public proxy carries X-Forwarded-For and gets a plain 404. */
export function tlsAllowedResponse(req: Request, url: URL): Response {
  const plain = (status: number, body: string) => new Response(body, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  if (req.method !== "GET") return plain(405, "no\n");
  if (req.headers.get("x-forwarded-for") || req.headers.get("x-forwarded-host") || req.headers.get("cf-connecting-ip")) return plain(404, "no\n");
  return tlsAllowed(url.searchParams.get("domain") || "") ? plain(200, "ok\n") : plain(404, "no\n");
}

// ---------------- serving the wizard on their host ----------------
const hostHeader = (req: Request) => (req.headers.get("host") || "").toLowerCase().replace(/:\d{1,5}$/, "");
/** The buyer whose own domain this request came in on (null for our own address, and for every unknown name). */
export function ownHostBuyer(req: Request): Buyer | null {
  const h = hostHeader(req);
  if (!h || h === siteHost()) return null;
  return buyerOfHost(h);
}
const STATIC = /^\/(?:styles\.css|wizard\.css|wizard\.js|dashboard-preview\.js|chat\.css|chat\.js|favicon\.svg|robots\.txt|healthz|fonts\/inter-latin-[0-9]{3}-normal\.woff2)$/;
/** The path the normal site serves for this path on a buyer's own host; null = not served there at all. */
export function mapOwnPath(method: string, path: string, code: string): string | null {
  if (STATIC.test(path)) return path;
  const get = method === "GET" || method === "HEAD";
  const trimmed = path.replace(/\/+$/, "") || "/";
  if (trimmed === "/") return get ? `/setup/${code}` : null;
  if (get && (trimmed === "/status" || trimmed === "/open")) return `/setup/${code}${trimmed}`;
  if (method === "POST" && trimmed === "/chat") return `/setup/${code}/chat`;
  const a = trimmed.match(/^\/a\/([a-z-]{2,40})$/);
  if (a && method === "POST") return `/setup/${code}/a/${a[1]}`;
  // Absolute links from before (their own code only).
  const s = trimmed.match(/^\/setup\/([^/]*)(\/.*)?$/);
  if (s && s[1] === code) return trimmed;
  return null;
}

/** The page as they should see it: no code in links, no way back to our guide (it carries our name). */
export function ownHostHtml(html: string, code: string): string {
  return html
    .replaceAll(`/setup/${code}?`, "/?")
    .replaceAll(`/setup/${code}"`, `/"`)
    .replaceAll(`/setup/${code}/`, "/")
    .replace(/<a href="\/guide"[^>]*>Full guide<\/a>/g, "")
    .replace(/<p><a class="more-link" href="\/guide#[^"]*"[^>]*>[\s\S]*?<\/a><\/p>/g, "");
}

/**
 * Call first in the server's request handler. Returns null for requests on our own address (carry on as normal), or the
 * response for a request on a buyer's own domain: their wizard, rewritten so it never shows our address or name.
 */
export async function serveOwnHost(req: Request, handle: (r: Request) => Promise<Response>): Promise<Response | null> {
  if (onOwnHost.getStore()) return null; // already rewritten: this is the inner call
  const b = ownHostBuyer(req);
  if (!b) return null;
  const url = new URL(req.url);
  const to = CODE_RE.test(b.code) ? mapOwnPath(req.method, url.pathname, b.code) : null;
  if (!to) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" } });
  const next = new URL(req.url);
  next.pathname = to;
  const inner = await onOwnHost.run(true, () => handle(new Request(next.toString(), req)));
  const type = inner.headers.get("content-type") || "";
  const headers = new Headers(inner.headers);
  // The session cookie is scoped to /setup/ on our address; on their host the wizard lives at the root.
  const cookies = inner.headers.getSetCookie().map((c) => c.replace(/;\s*Path=\/setup\/?/i, "; Path=/"));
  if (cookies.length) { headers.delete("set-cookie"); for (const c of cookies) headers.append("set-cookie", c); }
  const loc = headers.get("location");
  if (loc) headers.set("location", loc.replace(`/setup/${b.code}?`, "/?").replace(new RegExp(`^/setup/${b.code}/?$`), "/"));
  if (!/^text\/html/i.test(type)) return new Response(inner.body, { status: inner.status, headers });
  headers.delete("content-length");
  return new Response(ownHostHtml(await inner.text(), b.code), { status: inner.status, headers });
}
