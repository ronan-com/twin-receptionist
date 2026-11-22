import type { ResolvedRange } from "../app/date-range";
import type { AuditRow, CallListRow, CallOutcome, CallStatus } from "../app/types";
import type { AdminNumberRequest, Agency, AvailableNumber, Brand, Settings, TeamState, TestLogin, Voice as TwinVoice } from "../shared";
import { api, qs } from "./base";

// The console (/admin) data layer (area C). Server side: server/routes/console.ts
// under /api/console/..., plus the existing platform routes (/api/admin/*), branding
// (/api/org/brand*), team (/api/team*) and receptionist creation (/api/clients).
// The server scopes everything: agency staff only ever get their own agency's rows.

const rangeQs = (r: ResolvedRange) => qs({ from: r.prevFrom.toISOString(), to: r.to.toISOString() });

/** A business (receptionist) reference on console rows. */
export type BizRef = { id: string; name: string; is_demo: boolean; timezone: string; org_id: string; org_name: string };

export type ConsoleBusiness = {
  id: string;
  name: string;
  slug: string;
  industry: string;
  timezone: string;
  city: string | null;
  address_line1: string | null;
  phone: string | null;
  email: string | null;
  is_demo: boolean;
  status: "active" | "paused";
  paused_at: string | null;
  agency_paused: boolean;
  org_direct: boolean;
  business_hours: Record<string, { open: string; close: string; closed: boolean }>;
  created_at: string;
  updated_at: string;
  org_id: string;
  org_name: string;
  receptionist_name: string;
  phone_numbers: string[];
};

export type AdminBusinessRow = ConsoleBusiness & {
  memberships: { id: string; user_id: string; role: string; access_role: "manager" | "viewer" }[];
  agents: { id: string; name: string; status: string; provider: string }[];
  numbers: { id: string; e164: string; status: string }[];
  subscription: null;
  pending_invites: number;
  pending_number_requests: number;
  calls_30d: number;
  last_call_at: string | null;
};

export type AdminAgentRow = {
  id: string;
  business_id: string;
  name: string;
  status: "active" | "paused";
  greeting: string;
  tone: string;
  voice_id: string;
  voice: { id: string; display_name: string; provider: string } | null;
  language: string;
  provider: "telnyx";
  provider_agent_id: string;
  demo_assistant: boolean;
  llm_model: string;
  routing_status: "routed" | "not_connected";
  booking: { provider: string; enabled: boolean; minutes: number } | null;
  services: string[];
  last_published_at: string;
  created_at: string;
  updated_at: string;
  business: BizRef;
};

export type AdminNumberRow = {
  id: string;
  e164: string;
  friendly_name: string;
  business_id: string;
  agent: { id: string; name: string };
  status: string;
  routing_mode: string;
  capabilities: { voice: boolean; sms: boolean };
  provider: string;
  health: string;
  business: BizRef;
};

export type ConsoleCall = CallListRow & { channel: string; business: BizRef | null };

export type ConsoleCallDetail = ConsoleCall & {
  transcript_error: string | null;
  transcript_segments: { id: string; seq: number; speaker: string; text: string; started_ms: number | null }[];
};

export type ConsoleIncident = {
  id: string;
  business_id: string | null;
  org_id: string | null;
  org_name: string | null;
  title: string;
  details: string | null;
  severity: string;
  source: string;
  status: "open" | "resolved";
  started_at: string;
  resolved_at: string | null;
  business: BizRef | null;
};

export type ConsoleAudit = AuditRow & { org_id: string; org_name: string | null };

export type ConsoleAppointment = { id: string; business_id: string; created_at: string; starts_at: string | null; customer_name: string | null; customer_phone: string | null; service: string | null; status: string; business: { id: string; name: string; is_demo: boolean } | null };
export type ConsoleLead = { id: string; business_id: string; created_at: string; name: string | null; phone: string | null; intent: string; stage: string; business: { id: string; name: string; is_demo: boolean } | null };

export type ConsolePerson = {
  id: string;
  user_id: string;
  role: string;
  access_role: "manager" | "viewer";
  created_at: string;
  profile: { id: string; email: string; full_name: string | null };
};
export type ConsoleInvite = { id: string; email: string; access_role: "manager" | "viewer"; expires_at: string; created_at: string };

export type ConsoleNumberRequest = {
  id: string;
  type: "local" | "mobile";
  note: string;
  status: "pending" | "done" | "declined";
  phone_number: string;
  reason: string;
  requested_by: string;
  created_at: string;
};

export type AdminBusinessDetail = {
  business: ConsoleBusiness;
  agents: AdminAgentRow[];
  numbers: AdminNumberRow[];
  number_requests: ConsoleNumberRequest[];
  members: ConsolePerson[];
  invitations: ConsoleInvite[];
  settings: {
    industry: string;
    suburb: string;
    timezone: string;
    hours: Settings["hours"];
    services: string[];
    greeting: string;
    tone: string;
    voice: string;
    receptionist_name: string;
    booking: { provider: string; enabled: boolean; minutes: number; notify_email: string } | null;
  };
  usage: { kind: string; quantity: number; unit: string; period_start: string }[];
  counts: { knowledge: number; appointments: number; leads: number; calls: number };
  calls: ConsoleCall[];
  appointments: ConsoleAppointment[];
  leads: ConsoleLead[];
  incidents: ConsoleIncident[];
  audit: ConsoleAudit[];
};

export type AdminSystem = {
  incidents: ConsoleIncident[];
  failedCalls: ConsoleCall[];
  errorEvents: never[];
  integrationErrors: { id: string; business_id: string | null; type: string; severity: string; message: string; occurred_at: string; integration: { provider: string; display_name: string } | null; business: BizRef | null }[];
  unanswered: never[];
  qaQueue: never[];
  providers: { id: string; name: string; provider: string; status: string; credentials_set: boolean; mode: "own" | "platform" | "none" }[];
};

export type AdminOverviewCounts = {
  businesses: number;
  activeBusinesses: number;
  agents: number;
  numbers: number;
  openIncidents: number;
  providerErrors: number;
  pendingNumberRequests: number;
  calls30d: number;
  /** Platform view only. */
  agencies?: number;
};

export type AdminRecentActivity = { audit: ConsoleAudit[]; appointments: ConsoleAppointment[]; leads: ConsoleLead[]; incidents: ConsoleIncident[] };
export type AdminAppointmentsLeads = {
  appointments: { id: string; business_id: string; created_at: string; status: string }[];
  leads: { id: string; business_id: string; created_at: string; stage: string }[];
};

export type AdminVoiceRow = {
  id: string;
  display_name: string;
  description: string;
  gender: string;
  accent: string;
  language: string;
  provider: string;
  recommended: boolean;
  agents: { id: string; name: string; business: BizRef }[];
};

export type ConsoleUsage = {
  from: string;
  to: string;
  businesses: (BizRef & { calls: number; texts: number; minutes: number; seconds: number; failed: number; status: string })[];
  agencies: { org_id: string; org_name: string; is_demo: boolean; businesses: number; calls: number; texts: number; minutes: number; failed: number }[];
  daily: { day: string; calls: number; texts: number; minutes: number }[];
};

export type InternalAdminRow = { id: string; user_id: string; role: "super_admin"; created_at: string; profile: { id: string; email: string; full_name: string | null } };

export type ConsoleNumberRequestRow = AdminNumberRequest & { resolvedAt?: string | null };

// ---- Console reads ----

export const getAdminOverviewCounts = () => api.get<AdminOverviewCounts>("/api/console/overview");
export const getConsoleCalls = async (range: ResolvedRange) => (await api.get<{ calls: ConsoleCall[] }>(`/api/console/calls${rangeQs(range)}`)).calls;
export const getConsoleCallDetail = async (id: string) => (await api.get<{ call: ConsoleCallDetail }>(`/api/console/calls/${id}`)).call;
export const getAdminAppointmentsLeads = (range: ResolvedRange) => api.get<AdminAppointmentsLeads>(`/api/console/bookings-leads${rangeQs(range)}`);
export const getAdminRecentActivity = () => api.get<AdminRecentActivity>("/api/console/activity");
export const getAdminSystem = () => api.get<AdminSystem>("/api/console/system");
export const getAdminBusinesses = async () => (await api.get<{ businesses: AdminBusinessRow[] }>("/api/console/businesses")).businesses;
export const getAdminBusinessDetail = (id: string) => api.get<AdminBusinessDetail>(`/api/console/businesses/${id}`);
export const getAdminAgents = async () => (await api.get<{ agents: AdminAgentRow[] }>("/api/console/receptionists")).agents;
export const getAdminNumbers = async () => (await api.get<{ numbers: AdminNumberRow[] }>("/api/console/numbers")).numbers;
export const getConsoleNumberRequests = async () => (await api.get<{ requests: ConsoleNumberRequestRow[] }>("/api/console/number-requests")).requests;
export const getConsoleUsage = (range: ResolvedRange) => api.get<ConsoleUsage>(`/api/console/usage${qs({ from: range.from.toISOString(), to: range.to.toISOString() })}`);
export const getInternalAdmins = async () => (await api.get<{ admins: InternalAdminRow[] }>("/api/console/platform-admins")).admins;

/** The audit trail: one business (the workspace's settings page) or the whole console scope. */
export async function getAudit(businessId: string | null): Promise<AuditRow[]> {
  // A business's own trail lives under the workspace (/api/manage/<id>/audit, area S),
  // which business managers can read; console staff can also use the console's.
  if (businessId) {
    try {
      return (await api.get<{ audit: AuditRow[] }>(`/api/manage/${businessId}/audit`)).audit;
    } catch {
      /* fall back to the console's view below */
    }
  }
  return (await api.get<{ audit: ConsoleAudit[] }>(`/api/console/audit${qs({ business: businessId })}`)).audit;
}

/** The phone provider's Australian voices, with the receptionists (in scope) using each. */
export async function getAdminVoices(): Promise<AdminVoiceRow[]> {
  const [{ voices }, agents] = await Promise.all([api.get<{ voices: TwinVoice[] }>("/api/voices"), getAdminAgents()]);
  return voices.map((v) => ({
    id: v.id,
    display_name: v.name,
    description: v.label,
    gender: v.gender,
    accent: "Australian",
    language: "en-AU",
    provider: "telnyx",
    recommended: v.recommended,
    agents: agents.filter((a) => a.voice_id === v.id || (!a.voice_id && a.voice?.display_name === v.name)).map((a) => ({ id: a.id, name: a.name, business: a.business })),
  }));
}

// Answered pages that have no Twin backing (contract §6): empty, never invented.
export const getAdminProviderConfigs = async () => [] as never[];
export const getAdminIntegrations = async () => ({ integrations: [] as never[], events: [] as never[] });
export const getAdminBilling = async () => ({ plans: [] as never[], subscriptions: [] as never[], invoices: [] as never[], usage: [] as never[] });

// ---- Companies (an agency's clients) ----

export type AutomationKey = "voice" | "sms" | "email" | "booking" | "crm";
export type AutomationStatus = "live" | "off" | "paused" | "attention";
export type Automation = { key: AutomationKey; label: string; status: AutomationStatus; detail: string };

export type CompanyRef = { id: string; name: string; industry: string; org_id: string; org_name: string; is_demo: boolean; created_at: string };

export type CompanyRow = CompanyRef & {
  status: "active" | "paused";
  receptionists: { id: string; name: string; business_name: string; status: "active" | "paused"; numbers: string[]; onboarding_pending: boolean }[];
  /** Made with an onboarding link and the client hasn't finished setting up yet. */
  onboarding_pending: boolean;
  automations: { key: AutomationKey; label: string; status: AutomationStatus }[];
  numbers: number;
  customers: number;
  pending_invites: number;
  calls_30d: number;
  last_call_at: string | null;
  branded: boolean;
};

export type CompanyReceptionist = AdminAgentRow & {
  business_name: string;
  paused_at: string | null;
  onboarding_pending: boolean;
  numbers: AdminNumberRow[];
  automations: Automation[];
  number_requests: ConsoleNumberRequest[];
  settings: { industry: string; suburb: string; timezone: string; hours: Settings["hours"]; services: string[]; greeting: string; tone: string; voice: string };
};

export type CompanyPerson = ConsolePerson & { receptionists: string[] };

export type CompanyDetail = {
  company: CompanyRef & { status: "active" | "paused"; agency_paused: boolean; onboarding_pending: boolean };
  receptionists: CompanyReceptionist[];
  members: CompanyPerson[];
  invitations: ConsoleInvite[];
  counts: { knowledge: number; appointments: number; leads: number; calls: number };
  calls: ConsoleCall[];
  appointments: ConsoleAppointment[];
  leads: ConsoleLead[];
  incidents: ConsoleIncident[];
  audit: ConsoleAudit[];
  brand: Brand;
};

type People = { members: CompanyPerson[]; invitations: ConsoleInvite[] };

export const companyApi = {
  list: async () => (await api.get<{ companies: CompanyRow[] }>("/api/console/companies")).companies,
  get: (id: string) => api.get<CompanyDetail>(`/api/console/companies/${id}`),
  create: async (input: { name: string; industry?: string; orgId?: string }) => (await api.post<{ id: string }>("/api/console/companies", input)).id,
  update: (id: string, input: { name?: string; industry?: string }) => api.put<CompanyDetail>(`/api/console/companies/${id}`, input),
  setStatus: (id: string, status: "active" | "paused") => api.put<CompanyDetail>(`/api/console/companies/${id}/status`, { status }),
  attach: (id: string, clientId: string) => api.post<CompanyDetail>(`/api/console/companies/${id}/receptionists`, { clientId }),
  share: (id: string, email: string, role: "manager" | "viewer") =>
    api.post<{ url: string; emailed: boolean; added: boolean } & People>(`/api/console/companies/${id}/members`, { email, role }),
  unshare: (id: string, userId: string) => api.del<People>(`/api/console/companies/${id}/members/${userId}`),
  revokeInvite: (id: string, inviteId: string) => api.del<People>(`/api/console/companies/${id}/invites/${inviteId}`),
  /** "Send the client an onboarding link": a new company (name, industry) or an existing one (id). */
  sendOnboarding: (input: { id?: string; name?: string; industry?: string; email: string }) =>
    api.post<{ id: string; url: string; emailed: boolean; added: boolean }>(input.id ? `/api/console/companies/${input.id}/onboarding` : "/api/console/onboarding", input),
  brand: (id: string) => api.get<Brand>(`/api/console/companies/${id}/brand`),
  setBrand: (id: string, change: BrandChange) => api.put<Brand>(`/api/console/companies/${id}/brand`, change),
  upload: (id: string, kind: "logo" | "background", file: File) => uploadBrand(`/api/console/companies/${id}/brand/${kind}`, file),
};

export type BrandChange = { bgColor?: string; primaryColor?: string; accentColor?: string; sidebarColor?: string; removeLogo?: boolean; removeBackground?: boolean };

async function uploadBrand(path: string, file: File): Promise<Brand> {
  const res = await fetch(path, { method: "POST", credentials: "same-origin", body: file });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Upload failed (${res.status}).`);
  return data as Brand;
}

// ---- Console writes (each is audited on the server) ----

export const setBusinessStatus = (id: string, status: "active" | "paused") => api.put<AdminBusinessDetail>(`/api/console/businesses/${id}`, { status });
export const shareBusiness = (id: string, email: string, role: "manager" | "viewer") =>
  api.post<{ url: string; emailed: boolean; added: boolean; members: ConsolePerson[]; invitations: ConsoleInvite[] }>(`/api/console/businesses/${id}/members`, { email, role });
export const unshareBusiness = (id: string, userId: string) => api.del<{ members: ConsolePerson[]; invitations: ConsoleInvite[] }>(`/api/console/businesses/${id}/members/${userId}`);
export const revokeBusinessInvite = (id: string, inviteId: string) => api.del<{ members: ConsolePerson[]; invitations: ConsoleInvite[] }>(`/api/console/businesses/${id}/invites/${inviteId}`);
export const requestNumberFor = (id: string, type: "local" | "mobile", note: string) => api.post(`/api/console/businesses/${id}/number-requests`, { type, note });
export const resolveIncident = (id: string) => api.post<AdminSystem>(`/api/console/incidents/${id}/resolve`);
export const logIncident = (input: { title: string; details?: string; severity?: string; client_id?: string }) => api.post<AdminSystem>("/api/console/incidents", input);
export const grantPlatformAdmin = (email: string) => api.post<{ admins: InternalAdminRow[] }>("/api/console/platform-admins", { email });
export const revokePlatformAdmin = (userId: string) => api.del<{ admins: InternalAdminRow[] }>(`/api/console/platform-admins/${userId}`);

/** New receptionist (the setup wizard): the existing POST /api/clients. */
export const createReceptionist = async (settings: Settings & { defaultVoice?: boolean }) => (await api.post<{ client: { id: string } }>("/api/clients", settings)).client;
export const getVoices = async () => (await api.get<{ voices: TwinVoice[] }>("/api/voices")).voices;

// ---- The platform team's existing routes (/api/admin/*) ----

export const platformApi = {
  agencies: async () => (await api.get<{ agencies: Agency[] }>("/api/admin/agencies")).agencies,
  createAgency: (name: string, ownerEmail: string) => api.post<{ url: string; emailed: boolean }>("/api/admin/agencies", { name, ownerEmail }),
  inviteOwner: (id: string, email: string) => api.post<{ url: string; emailed: boolean }>(`/api/admin/agencies/${id}/invites`, { email }),
  updateAgency: async (id: string, change: { name?: string; platformTelnyx?: boolean; suspended?: boolean }) =>
    (await api.put<{ agencies: Agency[] }>(`/api/admin/agencies/${id}`, change)).agencies,
  numberRequests: () => api.get<{ requests: AdminNumberRequest[]; pending: number }>("/api/admin/number-requests"),
  fulfilRequest: (id: string, phoneNumber: string) => api.post<{ requests: AdminNumberRequest[]; pending: number }>(`/api/admin/number-requests/${id}/fulfil`, { phoneNumber, confirm: true }),
  declineRequest: (id: string, reason: string) => api.post<{ requests: AdminNumberRequest[]; pending: number }>(`/api/admin/number-requests/${id}/decline`, { reason }),
  availableNumbers: async (type: "local" | "mobile") => (await api.get<{ numbers: AvailableNumber[] }>(`/api/numbers/available${qs({ type })}`)).numbers,
  viewAs: (orgId: string, clientId?: string) => api.post("/api/admin/view-as", { orgId, clientId }),
  exitView: () => api.del("/api/admin/view-as"),
  sandbox: async () => (await api.get<{ orgId: string | null }>("/api/admin/sandbox")).orgId,
  createSandbox: async () => (await api.post<{ orgId: string }>("/api/admin/sandbox")).orgId,
  resetSandbox: () => api.del("/api/admin/sandbox"),
  testLogins: async () => (await api.post<{ logins: TestLogin[] }>("/api/admin/sandbox/logins")).logins,
  switchOrg: (orgId: string) => api.post("/api/orgs/switch", { orgId }),
};

// ---- The agency's own team, branding and name (existing routes) ----

export const teamApi = {
  get: () => api.get<TeamState>("/api/team"),
  invite: (email: string, role: "admin" | "member") => api.post<{ url: string; emailed: boolean }>("/api/team/invites", { email, role }),
  revoke: (id: string) => api.del<TeamState>(`/api/team/invites/${id}`),
  changeRole: (userId: string, role: string) => api.put<TeamState>(`/api/team/members/${userId}`, { role }),
  remove: (userId: string) => api.del<TeamState>(`/api/team/members/${userId}`),
  renameOrg: (name: string) => api.put("/api/org", { name }),
  updateAccount: (input: { name?: string; currentPassword?: string; newPassword?: string }) => api.put("/api/account", input),
};

export const brandApi = {
  get: () => api.get<Brand>("/api/org/brand"),
  set: (change: BrandChange) => api.put<Brand>("/api/org/brand", change),
  upload: (kind: "logo" | "background", file: File) => uploadBrand(`/api/org/brand/${kind}`, file),
};

/** Answered's pages wrote audit rows from the browser; our server writes them itself. */
export async function logAudit(_input: {
  business_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {}

export type { CallOutcome, CallStatus };
