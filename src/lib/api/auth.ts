import type { Account, InviteInfo } from "../shared";
import { api } from "./base";

// Signing in and out, sign-up, invites and password reset (all existing endpoints
// in server/index.ts and server/routes/signup.ts).

export type SignedIn = { signedIn: true } & Account;
// singleAgency (SINGLE_AGENCY=1): one agency per server, so only its first account signs itself up.
export type SignedOut = { signedIn: false; signupOpen: boolean; firstRun: boolean; singleAgency?: boolean };
export type Session = SignedIn | SignedOut;

export type AgencySignup = { name: string; email: string; password: string; agencyName: string };
export type BusinessSignup = {
  name: string;
  email: string;
  password: string;
  businessName: string;
  industry: string;
  suburb: string;
  timezone: string;
};

export const authApi = {
  session: () => api.get<Session>("/api/session", { allow401: true }),
  signIn: (email: string, password: string) => api.post<{ ok: true }>("/api/login", { email, password }, { allow401: true }),
  signOut: () => api.post<{ ok: true }>("/api/logout", {}, { allow401: true }),
  signupAgency: (input: AgencySignup) => api.post<{ ok: true; home: "/admin" | "/app" }>("/api/signup/agency", input, { allow401: true }),
  signupBusiness: (input: BusinessSignup) => api.post<{ ok: true; home: "/admin" | "/app" }>("/api/signup/business", input, { allow401: true }),
  requestReset: (email: string) => api.post<{ ok: true; emailsSetUp?: boolean }>("/api/password-reset", { email }, { allow401: true }),
  resetPassword: (token: string, password: string) =>
    api.post<{ ok: true }>(`/api/password-reset/${encodeURIComponent(token)}`, { password }, { allow401: true }),
  inviteInfo: (token: string) => api.get<InviteInfo>(`/api/invites/${encodeURIComponent(token)}`, { allow401: true }),
  acceptInvite: (token: string, input: { name?: string; password: string }) =>
    api.post<{ ok: true }>(`/api/invites/${encodeURIComponent(token)}`, input, { allow401: true }),
  switchOrg: (orgId: string) => api.post<Account>("/api/orgs/switch", { orgId }),
  exitView: () => api.del<{ ok: true }>("/api/admin/view-as"),
};

/** Where a signed-in person belongs, or the safe redirect they asked for. */
export function homeOf(session: Session | null | undefined): "/admin" | "/app" | "/login" {
  if (!session || !session.signedIn) return "/login";
  return session.home ?? (session.console ? "/admin" : "/app");
}

export function safeRedirect(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/login") || value.startsWith("/signup")) return null;
  return value;
}
