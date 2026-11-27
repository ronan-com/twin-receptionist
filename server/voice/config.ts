import type { Business, VoiceProviderId } from "../../src/lib/shared";
import { sql } from "../db";
import { unseal } from "../secrets";

// Which voice engine an agency's receptionists run on, and the Vapi keys.
//
//  - Install level: VOICE_PROVIDER=telnyx|vapi (default telnyx). With Vapi, VAPI_API_KEY and
//    VAPI_PUBLIC_KEY are the install's own keys (the platform's), like TELNYX_API_KEY.
//  - Per agency: orgs.voice_provider overrides the install default. An agency that brings
//    its own account stores its keys like the Telnyx one (private key sealed, orgs.vapi_key).
//  - Per receptionist: Business.voiceProvider is where its assistant was made. It never
//    changes, so switching an agency's engine leaves its existing receptionists working.

export const PROVIDERS: VoiceProviderId[] = ["telnyx", "vapi"];

export const asProvider = (v: unknown): VoiceProviderId => (v === "vapi" ? "vapi" : "telnyx");

/** The install's default engine (VOICE_PROVIDER). */
export const installProvider = (): VoiceProviderId => asProvider((process.env.VOICE_PROVIDER ?? "").trim().toLowerCase());

/** The install was given a phone key of its own (TELNYX_API_KEY, or VAPI_API_KEY for the Vapi backup). */
export const installHasVoiceKey = (): boolean => Boolean((process.env.TELNYX_API_KEY ?? "").trim() || (process.env.VAPI_API_KEY ?? "").trim());

/**
 * A buyer's own copy (SINGLE_AGENCY) installed with no phone key: the buyer skipped the Phones
 * step in setup (Telnyx approval can take a day or two). Its agency connects its own key later in
 * Connections, which is stored per org like any agency's own key and used straight away.
 * (Same check as accounts.ts singleAgency, read here to keep this module free of accounts.ts.)
 */
export const ownKeyInstall = (): boolean =>
  ["1", "true", "yes", "on"].includes((process.env.SINGLE_AGENCY ?? "").trim().toLowerCase()) && !installHasVoiceKey();

/** The engine a receptionist runs on. */
export const providerOfClient = (c: Pick<Business, "voiceProvider"> | null | undefined): VoiceProviderId => asProvider(c?.voiceProvider);

export class VapiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The engine this agency makes new receptionists on. */
export async function providerOfOrg(orgId: string | null): Promise<VoiceProviderId> {
  if (!orgId) return installProvider();
  const [o] = await sql`select voice_provider from orgs where id = ${orgId}`;
  return o?.voice_provider ? asProvider(o.voice_provider) : installProvider();
}

export type VapiCreds = { key: string; publicKey: string; own: boolean };

const cache = new Map<string, { creds: VapiCreds; at: number }>();
export const forgetVapiKey = (orgId: string) => cache.delete(orgId);

export const platformVapi = (): { key: string; publicKey: string } => ({
  key: process.env.VAPI_API_KEY ?? "",
  publicKey: process.env.VAPI_PUBLIC_KEY ?? "",
});

/** An agency's Vapi keys: its own, or the install's when the platform lets it use them. */
export async function vapiCredsFor(orgId: string | null): Promise<VapiCreds> {
  const platform = platformVapi();
  if (!orgId) {
    if (!platform.key) throw new VapiError(500, "VAPI_API_KEY is not set.");
    return { ...platform, own: false };
  }
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < 30_000) return hit.creds;
  const [o] = await sql`select vapi_key, vapi_public_key, platform_telnyx from orgs where id = ${orgId}`;
  let creds: VapiCreds | null = null;
  if (o?.vapi_key) creds = { key: unseal(o.vapi_key), publicKey: o.vapi_public_key ?? "", own: true };
  else if (o?.platform_telnyx && platform.key) creds = { ...platform, own: false };
  if (!creds) throw new VapiError(400, "This account has no Vapi account connected yet. Connect one in Setup, or contact the platform team.");
  cache.set(orgId, { creds, at: Date.now() });
  return creds;
}

/** Which kind of phone account an agency has for an engine: its own key, the platform's, or none. */
export async function accountMode(orgId: string, provider: VoiceProviderId): Promise<"own" | "platform" | "none"> {
  const [o] = await sql`select telnyx_key, vapi_key, platform_telnyx from orgs where id = ${orgId}`;
  if (provider === "vapi") return o?.vapi_key ? "own" : o?.platform_telnyx && platformVapi().key ? "platform" : "none";
  // An install with no key of its own has no platform account to fall back to.
  return o?.telnyx_key ? "own" : o?.platform_telnyx && !ownKeyInstall() ? "platform" : "none";
}
