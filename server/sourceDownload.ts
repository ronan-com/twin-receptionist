import { AuthError, requireRole, type Ctx } from "./accounts";
import { currentVersion } from "./autoUpdate";
import { ValidationError } from "./prompt";

// Settings, "Your source code": the owner downloads the full source of the exact version this agency runs.
//   GET /api/source-download   owner or admin  { version, url }  the page then opens `url`
// SOURCE_DOWNLOAD_URL (a template with {version}, e.g. a GitHub release) wins when set. Otherwise the setup site
// is asked, with this agency's own sync token, for a short-lived signed link to that version (the same kind of
// address the app's updates use). The site only offers a bundle that holds no keys or settings files.

/** Where to download `version`, or why it can't be done. `doFetch` is for tests. */
export async function sourceDownloadUrl(env: Record<string, string | undefined> = process.env, doFetch: typeof fetch = fetch): Promise<{ version: string; url: string }> {
  const version = currentVersion(env);
  const template = (env.SOURCE_DOWNLOAD_URL ?? "").trim();
  if (template) {
    const url = template.replaceAll("{version}", encodeURIComponent(version));
    if (!/^https:\/\//i.test(url)) throw new ValidationError("SOURCE_DOWNLOAD_URL must be an https address.");
    return { version, url };
  }
  const token = (env.SUPPORT_SYNC_TOKEN ?? "").trim();
  let base = "";
  try {
    const u = new URL((env.SUPPORT_SYNC_URL ?? "").trim());
    if (u.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) base = u.origin;
  } catch {}
  if (!version || !token || !base) throw new ValidationError("This copy isn't connected to its setup site, so it can't offer the download. Ask your provider for the source.");
  let res: Response;
  try {
    res = await doFetch(`${base}/api/releases/source-link?version=${encodeURIComponent(version)}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ValidationError("Couldn't reach the setup site. Try again in a moment.");
  }
  if (res.status === 404) throw new ValidationError(`The source for version ${version} isn't available. Ask your provider for it.`);
  const body: any = await res.json().catch(() => null);
  if (!res.ok || typeof body?.url !== "string" || !/^https?:\/\//.test(body.url)) throw new ValidationError("The setup site couldn't give a download link right now. Try again in a moment.");
  return { version, url: body.url };
}

export async function sourceDownloadRoute(method: string, ctx: Ctx): Promise<Response> {
  if (method !== "GET") return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  if (ctx.viewing) throw new AuthError("You're viewing as someone else. The source is the owner's to download.", 403);
  requireRole(ctx, "admin");
  return new Response(JSON.stringify(await sourceDownloadUrl()), { headers: { "Content-Type": "application/json" } });
}
