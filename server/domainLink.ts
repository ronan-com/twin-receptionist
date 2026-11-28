import { AuthError, requireRole, singleAgency, type Ctx } from "./accounts";
import { ValidationError } from "./prompt";

// Settings, "Web address": "Change domain". The domain form lives on the agency's private setup link, which this app
// doesn't know. It asks the setup site, with its own sync token, for a short-lived signed address that opens the form.
//   GET /api/domain-link   the owner of a single-agency copy  { url }  the page then opens `url`

const HOW = "Open your private setup link and press \"Change domain\".";

export async function domainFormUrl(env: Record<string, string | undefined> = process.env, doFetch: typeof fetch = fetch): Promise<string> {
  const token = (env.SUPPORT_SYNC_TOKEN ?? "").trim();
  let base = "";
  try {
    const u = new URL((env.SUPPORT_SYNC_URL ?? "").trim());
    if (u.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) base = u.origin;
  } catch {}
  if (!token || !base) throw new ValidationError(`This copy isn't connected to its setup site. ${HOW}`);
  let res: Response;
  try {
    res = await doFetch(`${base}/api/domain-link`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ValidationError("Couldn't reach the setup site. Try again in a moment.");
  }
  const body: any = await res.json().catch(() => null);
  if (!res.ok || typeof body?.url !== "string" || !/^https?:\/\//.test(body.url)) throw new ValidationError(`Couldn't open the domain form right now. ${HOW}`);
  return body.url;
}

export async function domainLinkRoute(method: string, ctx: Ctx, single: boolean = singleAgency()): Promise<Response> {
  if (method !== "GET") return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  // The address opens the owner's setup link: never for anyone else, or someone looking on their behalf.
  if (ctx.viewing) throw new AuthError("You're viewing as someone else. Only the owner can change the web address.", 403);
  if (!single) throw new AuthError("Changing the web address here is only for agencies running their own copy.", 403);
  requireRole(ctx, "owner");
  return new Response(JSON.stringify({ url: await domainFormUrl() }), { headers: { "Content-Type": "application/json" } });
}
