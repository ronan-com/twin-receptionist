import { createHash } from "node:crypto";
import type { Business, ConnectInfo } from "../src/lib/shared";
import { publicUrl } from "./booking";
import { connectEmail, connectOAuth, disconnectEmail, emailStatus } from "./email";
import { calendarLink, connectCalendar, providerOf } from "./calendars";
import { claimSignIn, finishSignIn, oauthAvailable, startSignIn, type OAuthProvider, type OAuthPurpose } from "./oauth";
import type { EmailMode } from "../src/lib/shared";
import { ValidationError } from "./prompt";
import { clientByConnectHash, getOrgClient, saveClient } from "./store";

// A private link the seller sends a client business so the owner can connect
// their own mailbox without seeing the dashboard. Only a hash of the link's
// token is stored, so the data file alone can't be used to open it.

const LINK_DAYS = 7;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createConnectLink(client: Business): Promise<{ url: string; expiresAt: string }> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
  await saveClient({ ...client, connect: { tokenHash: hash(token), expiresAt, createdAt: new Date().toISOString() } });
  // Through the tunnel (or real hosting) when there is one; otherwise this computer only.
  const base = publicUrl() || "http://localhost:5173";
  return { url: `${base}/connect/${token}`, expiresAt };
}

export async function revokeConnectLink(client: Business): Promise<void> {
  const { connect: _c, ...rest } = client;
  await saveClient(rest as Business);
}

// Slows down anyone guessing links or mailbox passwords through this page.
const failures: number[] = [];
const attempts = new Map<string, number[]>();

function tooMany(list: number[], limit: number, windowMs: number): boolean {
  const cutoff = Date.now() - windowMs;
  while (list.length && list[0] < cutoff) list.shift();
  return list.length >= limit;
}

async function clientFor(token: string): Promise<Business> {
  if (tooMany(failures, 30, 15 * 60_000)) throw new ValidationError("Too many attempts. Try again in 15 minutes.");
  // Looked up by hash, so the lookup reveals nothing about tokens that don't match.
  const found = await clientByConnectHash(hash(token));
  if (!found?.connect || Date.parse(found.connect.expiresAt) <= Date.now()) {
    failures.push(Date.now());
    throw new ValidationError("This link has expired or isn't valid. Ask your provider for a new one.");
  }
  return found;
}

async function info(client: Business): Promise<ConnectInfo> {
  const status = await emailStatus(client.id);
  const wanted = client.booking ? providerOf(client) : "builtin";
  const link = wanted === "builtin" ? null : await calendarLink(client.id);
  return {
    businessName: client.settings.businessName,
    receptionistName: client.settings.receptionistName,
    expiresAt: client.connect!.expiresAt,
    // Only the connection itself: never the business's mail or activity.
    email: { connected: status.connected, address: status.address, mode: status.mode },
    calendar: {
      wanted: wanted === "builtin" ? null : wanted,
      connected: Boolean(link && link.provider === wanted),
      account: link?.account ?? "",
    },
    signIn: oauthAvailable(),
  };
}

export async function connectInfo(token: string): Promise<ConnectInfo> {
  return info(await clientFor(token));
}

export async function connectFromLink(token: string, input: unknown): Promise<ConnectInfo> {
  const client = await clientFor(token);
  const tries = attempts.get(client.id) ?? [];
  attempts.set(client.id, tries);
  if (tooMany(tries, 10, 60 * 60_000)) throw new ValidationError("Too many tries. Wait an hour, or contact your provider.");
  tries.push(Date.now());
  await connectEmail(client.id, input, true);
  return info(client);
}

export async function disconnectFromLink(token: string): Promise<ConnectInfo> {
  const client = await clientFor(token);
  await disconnectEmail(client.id);
  return info(client);
}

// "Sign in with Google/Microsoft" from the business's connect page, for its
// mailbox or its calendar. Returns where to send the browser.
export async function signInStart(provider: OAuthProvider, token: string, mode: unknown, purpose: unknown): Promise<string> {
  await clientFor(token);
  const m: EmailMode = mode === "send" ? "send" : "draft";
  return startSignIn(provider, purpose === "calendar" ? "calendar" : "mail", { linkToken: token }, m);
}

// The same, started by a team member from the dashboard (calendar only: a
// mailbox is the business's to connect).
// returnTo: where to send the browser afterwards (the workspace's integrations page,
// or the console); only paths under /app/ or /admin/ are kept.
export async function dashboardSignInStart(provider: OAuthProvider, orgId: string, client: Business, returnTo?: string): Promise<string> {
  if (!client.booking || providerOf(client) !== provider) {
    throw new ValidationError(`Choose ${provider === "google" ? "Google Calendar" : "Outlook"} in the calendar card first.`);
  }
  const back = returnTo && /^\/(app|admin)\/[A-Za-z0-9/_-]*$/.test(returnTo) ? returnTo : undefined;
  return startSignIn(provider, "calendar", { clientId: client.id, orgId, ...(back ? { returnTo: back } : {}) });
}

const back = (purpose: OAuthPurpose) => (purpose === "calendar" ? "calendar" : "connected");

// The provider sends the browser back here. Always returns a path, on the
// connect page or the receptionist's dashboard page, with the outcome to show.
export async function signInFinish(provider: OAuthProvider, params: URLSearchParams): Promise<string> {
  const pending = await claimSignIn(provider, params.get("state") ?? "");
  if (!pending) {
    return `/connect/expired?error=${encodeURIComponent("That sign-in took too long or was already used. Please try again.")}`;
  }
  const where = pending.linkToken ? `/connect/${pending.linkToken}` : (pending.returnTo ?? `/clients/${pending.clientId}`);
  try {
    if (params.get("error")) throw new ValidationError("Sign-in was cancelled.");
    const result = await finishSignIn(pending, params.get("code") ?? "");
    // Check the link, or the person's access, is still good before saving anything.
    const client = pending.linkToken
      ? await clientFor(pending.linkToken)
      : await getOrgClient(pending.orgId ?? "", pending.clientId ?? "");
    if (!client) throw new ValidationError("That receptionist no longer exists.");
    if (result.purpose === "calendar") {
      if (!client.booking || providerOf(client) !== provider) throw new ValidationError("This receptionist isn't set up to use that calendar any more.");
      await connectCalendar(client.id, result);
    } else {
      if (!pending.linkToken) throw new ValidationError("Mailboxes are connected from the business's connect link.");
      await connectOAuth(client.id, result);
    }
    return `${where}?${back(result.purpose)}=1`;
  } catch (err) {
    return `${where}?error=${encodeURIComponent((err as Error).message.slice(0, 300))}`;
  }
}
