// "Change domain" from inside an agency's own dashboard (Settings, "Web address").
//
//   GET /api/domain-link          the agency's app (Bearer sync token) asks for a way to its own domain form
//                                 -> { url }: a signed address that works for 5 minutes
//   GET /api/domain-link/open     the owner's browser opens it: the form is opened on their setup link and they're sent there
//
// The app never learns the setup code: only the person who opens the signed address is sent to /setup/<code>.
// The form itself is the Done screen's own (setup.ts "domain-add-open"), with its Railway token and checks.
import { createHmac, timingSafeEqual } from "node:crypto";
import { CONFIG, db, type Buyer } from "./lib";
import { siteKey } from "./store";
import { bearerOf, buyerBySyncToken } from "./sync";
import { actions } from "./setup";

export const DOMAIN_LINK_SECONDS = 5 * 60;
const sign = (buyerId: number, exp: number) => createHmac("sha256", createHmac("sha256", siteKey()).update("domain-link").digest()).update(`${buyerId}:${exp}`).digest("base64url");

export function domainLink(buyerId: number, at = Date.now()): string {
  const exp = Math.floor(at / 1000) + DOMAIN_LINK_SECONDS;
  return `${CONFIG.siteUrl}/api/domain-link/open?${new URLSearchParams({ b: String(buyerId), exp: String(exp), sig: sign(buyerId, exp) })}`;
}

function signatureOk(buyerId: number, expRaw: string, sig: string, at = Date.now()): boolean {
  const exp = Number(expRaw);
  if (!Number.isInteger(buyerId) || !Number.isInteger(exp) || exp * 1000 < at || exp * 1000 > at + (DOMAIN_LINK_SECONDS + 60) * 1000) return false;
  return /^[A-Za-z0-9_-]{43}$/.test(sig) && timingSafeEqual(Buffer.from(sign(buyerId, exp)), Buffer.from(sig));
}

const buyer = (id: number) => db().query("SELECT * FROM buyers WHERE id = ? AND revoked_at IS NULL").get(id) as Buyer | null;
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const json = (o: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { ...HEADERS, "Content-Type": "application/json", ...h } });
const text = (t: string, status: number) => new Response(t, { status, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });

type Allow = (key: string, max: number, windowMs: number) => number;

export async function domainLinkApi(req: Request, url: URL, ip: string, allow: Allow): Promise<Response> {
  if (req.method !== "GET") return json({ error: "GET only" }, 405, { Allow: "GET" });
  if (url.pathname === "/api/domain-link") {
    const id = buyerBySyncToken(bearerOf(req));
    if (id == null || !buyer(id)) {
      const wait = allow(`domainbad:${ip}`, 30, 10 * 60_000);
      return wait ? json({ error: "too many tries" }, 429, { "Retry-After": String(wait) }) : json({ error: "unauthorised" }, 401);
    }
    const wait = allow(`domainlink:${id}`, 30, 60 * 60_000);
    return wait ? json({ error: "too many requests" }, 429, { "Retry-After": String(wait) }) : json({ url: domainLink(id) });
  }
  if (url.pathname !== "/api/domain-link/open") return json({ error: "Not found" }, 404);
  const wait = allow(`domainopen:${ip}`, 30, 10 * 60_000);
  if (wait) return text("Too many tries. Wait a few minutes.", 429);
  const id = Number(url.searchParams.get("b"));
  const b = signatureOk(id, url.searchParams.get("exp") || "", url.searchParams.get("sig") || "") ? buyer(id) : null;
  if (!b) return text("This link has run out. Go back to your dashboard and press Change domain again.", 403);
  await actions["domain-add-open"](b, {});
  return new Response(null, { status: 302, headers: { ...HEADERS, Location: `/setup/${b.code}` } });
}
