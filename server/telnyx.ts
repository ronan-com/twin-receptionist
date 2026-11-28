import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "./db";
import { unseal } from "./secrets";
import { telnyxProblem } from "./telnyxProblem";

const BASE = "https://api.telnyx.com/v2";

// Each agency brings its own Telnyx account. Whoever is working (a signed-in
// request, a Telnyx tool call for one receptionist, the mail checker) runs inside
// an org scope, and every Telnyx call picks that org's key. Orgs the platform has
// allowed to use its own key (platform_telnyx) fall back to TELNYX_API_KEY.
const scope = new AsyncLocalStorage<{ orgId: string | null }>();

export const runAsOrg = <T>(orgId: string | null, fn: () => T): T => scope.run({ orgId }, fn);
export const enterOrg = (orgId: string | null): void => scope.enterWith({ orgId });
/** The org the current work runs for (null: the install itself). Used by every voice engine. */
export const currentOrg = (): string | null => scope.getStore()?.orgId ?? null;

const keyCache = new Map<string, { key: string; at: number }>();
export const forgetKey = (orgId: string) => keyCache.delete(orgId);

async function keyFor(orgId: string | null): Promise<string> {
  const platform = process.env.TELNYX_API_KEY ?? "";
  if (!orgId) {
    if (!platform) throw new TelnyxError(500, "TELNYX_API_KEY is not set.");
    return platform;
  }
  const hit = keyCache.get(orgId);
  if (hit && Date.now() - hit.at < 30_000) return hit.key;
  const [o] = await sql`select telnyx_key, platform_telnyx from orgs where id = ${orgId}`;
  const key = o?.telnyx_key ? unseal(o.telnyx_key) : o?.platform_telnyx ? platform : "";
  if (!key) {
    throw new TelnyxError(400, "This account has no phone account connected yet. Connect one in Setup (or Connections), or contact the platform team.");
  }
  keyCache.set(orgId, { key, at: Date.now() });
  return key;
}

export class TelnyxError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function hasKey(): boolean {
  return Boolean(process.env.TELNYX_API_KEY);
}

// With `withKey`, uses that key directly (to check a key before saving it).
export async function telnyx<T = any>(method: string, path: string, body?: unknown, withKey?: string): Promise<T> {
  const key = withKey ?? (await keyFor(scope.getStore()?.orgId ?? null));

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new TelnyxError(502, `Could not reach the phone service: ${(err as Error).message}`);
  }

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error bodies fall through to the generic message below.
  }

  if (!res.ok) {
    const first = json?.errors?.[0];
    const detail = first?.detail || first?.title || text.slice(0, 200) || res.statusText;
    throw new TelnyxError(res.status, telnyxProblem(detail));
  }
  return json as T;
}
