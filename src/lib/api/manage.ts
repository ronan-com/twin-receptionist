import type {
  Agent,
  AuditRow,
  Business,
  Integration,
  IntegrationEventRow,
  Invitation,
  KnowledgeItem,
  MemberRow,
  PhoneNumber,
  SubscriptionRow,
  UsageRecord,
  Voice,
  VoiceConfig,
} from "../app/types";
import { api } from "./base";

// The workspace's settings data layer (area S). Server side: server/routes/manage.ts
// under /api/manage/<businessId>/... Every write is checked again on the server
// (managers, agency staff and the platform team; viewers are read-only).

export type AgentRow = Agent & { voice: Voice | null; voice_config: VoiceConfig | null; demo?: boolean; setup_fresh?: boolean; onboarding?: "pending" | "done"; onboarding_step?: number };
export type PhoneNumberRow = PhoneNumber & { agent: Pick<Agent, "id" | "name"> | null };
export type TeamMember = MemberRow & { access_role: "manager" | "viewer" };
export type TeamInvitation = Invitation & { access_role: "manager" | "viewer" };
export type TeamData = { members: TeamMember[]; invitations: TeamInvitation[] };

const base = (businessId: string) => `/api/manage/${encodeURIComponent(businessId)}`;

/* ---------------- Receptionist ---------------- */

export async function getAgents(businessId: string): Promise<AgentRow[]> {
  return (await api.get<{ agents: AgentRow[] }>(`${base(businessId)}/receptionist`)).agents;
}

export type BusinessDetails = {
  name?: string;
  industry?: string;
  city?: string;
  address_line1?: string;
  timezone?: string;
};

export type ReceptionistUpdate = {
  name?: string;
  greeting?: string | null;
  tone?: string;
  business_context?: string | null;
  voice_id?: string | null;
  booking_rules?: { enabled?: boolean; services?: string[]; default_duration_minutes?: number };
  escalation_rules?: { notify_email?: string };
  business_hours?: Business["business_hours"];
  business?: BusinessDetails;
};

export type ReceptionistSaved = { agent: AgentRow; applied: boolean; demo: boolean; changed: string[] };

export const updateReceptionist = (businessId: string, body: ReceptionistUpdate) =>
  api.put<ReceptionistSaved>(`${base(businessId)}/receptionist`, body);

/** First-run onboarding: "pending" shows the wizard; step is where to resume. Agency staff set "pending" to send it. */
export const saveOnboarding = (businessId: string, body: { status?: "pending" | "done"; step?: number }) =>
  api.put<{ onboarding: "pending" | "done"; onboarding_step: number }>(`${base(businessId)}/onboarding`, body);

/** The phone provider's voices. Scoped under a business so business users can read them. */
export async function getVoices(_clientVisibleOnly: boolean, businessId?: string | null): Promise<Voice[]> {
  if (!businessId) return [];
  return (await api.get<{ voices: Voice[] }>(`${base(businessId)}/voices`)).voices;
}

/* ---------------- Call handling ---------------- */

export async function getPhoneNumbers(businessId: string): Promise<PhoneNumberRow[]> {
  return (await api.get<{ numbers: PhoneNumberRow[] }>(`${base(businessId)}/phone-numbers`)).numbers;
}

export const requestNumber = (businessId: string, body: { type: "local" | "mobile"; note: string }) =>
  api.post<{ request: { id: string }; numbers: PhoneNumberRow[] }>(`${base(businessId)}/number-requests`, body);

/* ---------------- Knowledge ---------------- */

export async function getKnowledge(businessId: string): Promise<KnowledgeItem[]> {
  return (await api.get<{ items: KnowledgeItem[] }>(`${base(businessId)}/knowledge`)).items;
}

export type KnowledgeInput = { title: string; type: string; question: string | null; answer: string | null; content: string | null; status: string };
export type KnowledgeSaved = { item?: KnowledgeItem; synced: boolean; warning?: string };

export const createKnowledge = (businessId: string, body: KnowledgeInput) => api.post<KnowledgeSaved>(`${base(businessId)}/knowledge`, body);
export const updateKnowledge = (businessId: string, id: string, body: KnowledgeInput) =>
  api.patch<KnowledgeSaved>(`${base(businessId)}/knowledge/${encodeURIComponent(id)}`, body);
export const deleteKnowledge = (businessId: string, id: string) => api.del<KnowledgeSaved>(`${base(businessId)}/knowledge/${encodeURIComponent(id)}`);

/* ---------------- Integrations ---------------- */

export async function getIntegrations(businessId: string): Promise<Integration[]> {
  return (await api.get<{ integrations: Integration[] }>(`${base(businessId)}/integrations`)).integrations;
}

export async function getIntegrationEvents(businessId: string): Promise<IntegrationEventRow[]> {
  return (await api.get<{ events: IntegrationEventRow[] }>(`${base(businessId)}/integration-events`)).events;
}

export type CalendarState = {
  calendar: {
    provider: "builtin" | "google" | "microsoft";
    minutes: number;
    enabled: boolean;
    notifyEmail: string;
    leadWebhook: string;
    live: boolean;
    link: { provider: string; account: string; lastError: string; connectedAt: string } | null;
  } | null;
};

export const getCalendar = (businessId: string) => api.get<CalendarState>(`${base(businessId)}/calendar`);
export const setUpCalendar = (businessId: string, body: { provider: "builtin" | "google" | "microsoft"; minutes: number; notifyEmail?: string }) =>
  api.post<{ integrations: Integration[] }>(`${base(businessId)}/calendar`, body);
export const changeCalendar = (businessId: string, body: { minutes?: number; enabled?: boolean; notifyEmail?: string; leadWebhook?: string }) =>
  api.put<{ integrations: Integration[] }>(`${base(businessId)}/calendar`, body);
export const removeCalendar = (businessId: string) => api.del<{ integrations: Integration[] }>(`${base(businessId)}/calendar`);
export const testCalendar = (businessId: string) => api.post<{ date: string; result: any }>(`${base(businessId)}/calendar/test`);
/** A browser navigation (302 to Google/Microsoft), not a fetch. */
export const calendarSignInUrl = (businessId: string, provider: "google" | "microsoft") => `${base(businessId)}/calendar/signin/${provider}`;

export type EmailState = { connected: boolean; address: string; mode: "draft" | "send"; connectedAt: string; lastCheckedAt: string; lastError: string };
export const getEmail = (businessId: string) => api.get<EmailState>(`${base(businessId)}/email`);
export const connectEmail = (businessId: string, body: { address: string; password: string; mode: "draft" | "send" }) =>
  api.put<EmailState>(`${base(businessId)}/email`, body);
export const disconnectEmail = (businessId: string) => api.del<EmailState>(`${base(businessId)}/email`);
export const checkEmail = (businessId: string) => api.post<EmailState>(`${base(businessId)}/email/check`);

/* ---------------- Team ---------------- */

export async function getTeam(businessId: string): Promise<TeamData> {
  return api.get<TeamData>(`${base(businessId)}/team`);
}

export type InviteResult = { email: string; accessRole: "manager" | "viewer"; url: string; emailed: boolean; added: boolean; team: TeamData };
export const inviteMember = (businessId: string, body: { email: string; role: "manager" | "viewer" }) =>
  api.post<InviteResult>(`${base(businessId)}/team/invites`, body);
export const resendInvite = (businessId: string, inviteId: string) => api.post<InviteResult>(`${base(businessId)}/team/invites/${inviteId}/resend`);
export const cancelInvite = (businessId: string, inviteId: string) => api.del<TeamData>(`${base(businessId)}/team/invites/${inviteId}`);
export const changeMemberRole = (businessId: string, userId: string, role: "manager" | "viewer") =>
  api.put<TeamData>(`${base(businessId)}/team/members/${userId}`, { role });
export const removeMember = (businessId: string, userId: string) => api.del<TeamData>(`${base(businessId)}/team/members/${userId}`);

/* ---------------- Business, billing, activity ---------------- */

export type BusinessUpdateBody = BusinessDetails & {
  phone?: string;
  email?: string;
  website?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  business_hours?: Business["business_hours"];
  /** Closures and public holidays, one per line; empty removes them. */
  closures?: string;
};
export const updateBusiness = (businessId: string, body: BusinessUpdateBody) =>
  api.put<{ business: Business & { closures?: string }; applied: boolean }>(`${base(businessId)}/business`, body);

export async function getSubscription(businessId: string): Promise<SubscriptionRow | null> {
  return (await api.get<{ subscription: SubscriptionRow | null }>(`${base(businessId)}/subscription`)).subscription;
}

export const getBilling = (businessId: string) => api.get<{ subscription: SubscriptionRow | null; billing: string }>(`${base(businessId)}/subscription`);

export async function getUsage(businessId: string): Promise<UsageRecord[]> {
  return (await api.get<{ usage: UsageRecord[] }>(`${base(businessId)}/usage`)).usage;
}

export async function getAudit(businessId: string): Promise<AuditRow[]> {
  return (await api.get<{ audit: AuditRow[] }>(`${base(businessId)}/audit`)).audit;
}

/* ---------------- Your account (existing /api/account) ---------------- */

export const updateAccount = (body: { name?: string; currentPassword?: string; newPassword?: string }) => api.put<unknown>("/api/account", body);

/* ---------------- Branding (the business's own workspace look) ---------------- */

export type BrandLook = { logo: string; bgColor: string; bgImage: string; primaryColor: string; accentColor: string; /** Set per company in the console. */ sidebarColor?: string };
/** own: set on this business; agency: the agency's defaults; effective: what the workspace shows. */
export type BrandState = { own: BrandLook; agency: BrandLook; effective: BrandLook };
export type BrandChange = { bgColor?: string; primaryColor?: string; accentColor?: string; removeLogo?: boolean; removeBackground?: boolean };

export const getBrand = (businessId: string) => api.get<BrandState>(`${base(businessId)}/brand`);
export const saveBrand = (businessId: string, body: BrandChange) => api.put<BrandState>(`${base(businessId)}/brand`, body);

/** Uploads a PNG, JPEG or WebP (the server checks the bytes). */
export async function uploadBrandImage(businessId: string, kind: "logo" | "background", file: File): Promise<BrandState> {
  const res = await fetch(`${base(businessId)}/brand/${kind}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && typeof data.error === "string" && data.error) || `Upload failed (${res.status}).`);
  return data as BrandState;
}
