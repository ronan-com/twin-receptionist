import { createHash, randomBytes } from "node:crypto";
import type { EmailMode } from "../src/lib/shared";
import { sql } from "./db";
import { ValidationError } from "./prompt";

// "Sign in with Google / Microsoft" for a business's mailbox. The business is sent
// to its provider, approves access, and comes back here with a code that becomes
// a refresh token. IMAP and SMTP then log in with short-lived access tokens
// (XOAUTH2), so no password is ever typed or stored.
//
// Needs, in ~/aibiz/.env:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET      (Google Cloud, OAuth client, type "Web application")
//   MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET (Microsoft Entra, app registration)
//   OAUTH_REDIRECT_BASE                          (optional; default PUBLIC_URL, else http://localhost:8791)
// Each provider must list <OAUTH_REDIRECT_BASE>/api/oauth/<provider>/callback as a redirect URI.

export type OAuthProvider = "google" | "microsoft";
// What the sign-in is for: reading and sending a mailbox, or booking into a calendar.
export type OAuthPurpose = "mail" | "calendar";

const SCOPES: Record<OAuthProvider, Record<OAuthPurpose, string>> = {
  google: {
    // Full mail access is the only Google scope that IMAP and SMTP accept.
    mail: "openid email https://mail.google.com/",
    // See free/busy times and add events. Google rates this "sensitive", not "restricted".
    calendar: "openid email https://www.googleapis.com/auth/calendar.events",
  },
  microsoft: {
    mail: "openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
    calendar: "openid email offline_access https://graph.microsoft.com/Calendars.ReadWrite",
  },
};

type ProviderConfig = {
  authUrl: string;
  tokenUrl: string;
  clientId?: string;
  clientSecret?: string;
  extraAuthParams: Record<string, string>;
  imap: { host: string; port: number };
  smtp: { host: string; port: number };
};

function config(provider: OAuthProvider): ProviderConfig {
  if (provider === "google") {
    return {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // offline + consent: always return a refresh token.
      extraAuthParams: { access_type: "offline", prompt: "consent" },
      imap: { host: "imap.gmail.com", port: 993 },
      smtp: { host: "smtp.gmail.com", port: 465 },
    };
  }
  return {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    extraAuthParams: { prompt: "select_account" },
    imap: { host: "outlook.office365.com", port: 993 },
    smtp: { host: "smtp.office365.com", port: 587 },
  };
}

export function oauthAvailable(): Record<OAuthProvider, boolean> {
  const has = (p: OAuthProvider) => Boolean(config(p).clientId && config(p).clientSecret);
  return { google: has("google"), microsoft: has("microsoft") };
}

export function mailServers(provider: OAuthProvider) {
  return { imap: config(provider).imap, smtp: config(provider).smtp };
}

const redirectBase = () =>
  (process.env.OAUTH_REDIRECT_BASE || process.env.PUBLIC_URL || "http://localhost:8791").replace(/\/$/, "");
const redirectUri = (provider: OAuthProvider) => `${redirectBase()}/api/oauth/${provider}/callback`;

// Sign-ins in progress, keyed by the random state sent to the provider. Kept in
// the database so the provider can send the browser back to any server instance.
// Started either by the business from its connect link (linkToken), or by a
// signed-in team member from the dashboard (clientId + orgId).
// returnTo: the dashboard page to come back to (a path on this server).
export type SignInOrigin = { linkToken?: string; clientId?: string; orgId?: string; returnTo?: string };
type Pending = SignInOrigin & { provider: OAuthProvider; purpose: OAuthPurpose; mode: EmailMode; verifier: string };

const b64url = (buf: Buffer) => buf.toString("base64url");

export async function startSignIn(
  provider: OAuthProvider,
  purpose: OAuthPurpose,
  origin: SignInOrigin,
  mode: EmailMode = "draft",
): Promise<string> {
  const c = config(provider);
  if (!c.clientId || !c.clientSecret) {
    throw new ValidationError(`Sign in with ${provider === "google" ? "Google" : "Microsoft"} isn't set up yet.`);
  }
  await sql`delete from oauth_states where expires_at < now()`;

  const state = b64url(randomBytes(24));
  // PKCE: proves the code is redeemed by whoever started the sign-in.
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const p: Pending = { ...origin, provider, purpose, mode, verifier };
  await sql`insert into oauth_states (state, data, expires_at) values (${state}, ${p as any}, ${new Date(Date.now() + 10 * 60_000)})`;

  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri(provider),
    response_type: "code",
    scope: SCOPES[provider][purpose],
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...c.extraAuthParams,
  });
  return `${c.authUrl}?${params}`;
}

export type SignInResult = SignInOrigin & {
  provider: OAuthProvider;
  purpose: OAuthPurpose;
  mode: EmailMode;
  address: string;
  refreshToken: string;
};

function emailFromIdToken(idToken: string | undefined): string {
  if (!idToken) return "";
  try {
    // Received straight from the provider's token endpoint over TLS, so the
    // payload can be read without checking the signature.
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return String(payload.email || payload.preferred_username || "").toLowerCase();
  } catch {
    return "";
  }
}

async function tokenRequest(provider: OAuthProvider, body: Record<string, string>): Promise<any> {
  const c = config(provider);
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId!, client_secret: c.clientSecret!, ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `The sign-in service returned ${res.status}.`);
  }
  return data;
}

export type PendingSignIn = Pending;

// Takes the sign-in the provider is returning from. Deleting it as it's read
// makes each sign-in usable once.
export async function claimSignIn(provider: OAuthProvider, state: string): Promise<PendingSignIn | null> {
  if (!state || state.length > 100) return null;
  const [r] = await sql`delete from oauth_states where state = ${state} returning data, expires_at`;
  const p = r?.data as Pending | undefined;
  if (!p || p.provider !== provider || new Date(r.expires_at).getTime() < Date.now()) return null;
  return p;
}

// Swaps the provider's one-time code for a refresh token and the signed-in address.
export async function finishSignIn(p: PendingSignIn, code: string): Promise<SignInResult> {
  const tokens = await tokenRequest(p.provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(p.provider),
    code_verifier: p.verifier,
  });
  if (!tokens.refresh_token) throw new ValidationError("The provider didn't grant ongoing access. Please try again.");
  const address = emailFromIdToken(tokens.id_token);
  if (!address) throw new ValidationError("Couldn't tell which email address you signed in with.");
  const { verifier: _v, ...rest } = p;
  return { ...rest, address, refreshToken: tokens.refresh_token };
}

// Access tokens last about an hour; keep each until shortly before it expires.
const accessCache = new Map<string, { token: string; until: number }>();

// Returns a fresh access token. onRotate is called when the provider replaces the
// refresh token (Microsoft does this), so the new one can be saved.
export async function accessToken(
  provider: OAuthProvider,
  purpose: OAuthPurpose,
  refreshToken: string,
  onRotate: (next: string) => void,
): Promise<string> {
  const key = createHash("sha256").update(`${provider}:${purpose}:${refreshToken}`).digest("hex");
  const cached = accessCache.get(key);
  if (cached && cached.until > Date.now()) return cached.token;
  let data: any;
  try {
    data = await tokenRequest(provider, { grant_type: "refresh_token", refresh_token: refreshToken, scope: SCOPES[provider][purpose] });
  } catch (err) {
    throw new Error(
      `Access to this ${purpose === "mail" ? "mailbox" : "calendar"} has stopped working (${(err as Error).message}). Connect it again.`,
    );
  }
  accessCache.set(key, { token: data.access_token, until: Date.now() + (Number(data.expires_in ?? 3600) - 120) * 1000 });
  if (data.refresh_token && data.refresh_token !== refreshToken) onRotate(data.refresh_token);
  return data.access_token;
}
