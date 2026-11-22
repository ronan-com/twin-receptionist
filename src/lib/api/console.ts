import type { ResolvedRange } from "../app/date-range";
import type {
  Agent,
  Appointment,
  AuditRow,
  Business,
  CallEvent,
  CallListRow,
  InternalAdmin,
  Integration,
  IntegrationEvent,
  Invoice,
  Lead,
  Membership,
  PhoneNumber,
  Plan,
  Profile,
  ProviderConfig,
  Subscription,
  SystemIncident,
  UnansweredQuestion,
  UsageRecord,
  Voice,
  VoiceConfig,
} from "../app/types";
import type { Agency, Session } from "../shared";
import { api } from "./base";

// The console (/admin) data layer (area C). Server side: server/routes/console.ts
// under /api/console/... Stubs return empty data in Answered's shapes, except the
// overview counts, which the foundation reads from existing endpoints.

type BizRef = Pick<Business, "id" | "name" | "is_demo" | "timezone">;

export type AdminBusinessRow = Business & {
  memberships: Pick<Membership, "id" | "role" | "user_id">[];
  agents: Pick<Agent, "id" | "name" | "status" | "provider">[];
  numbers: Pick<PhoneNumber, "id" | "e164" | "status">[];
  subscription: (Pick<Subscription, "id" | "status"> & { plan: Pick<Plan, "name" | "code"> | null })[];
};

export type AdminBusinessDetail = {
  business: Business;
  members: (Membership & { profile: Pick<Profile, "id" | "email" | "full_name"> | null })[];
  agents: (Agent & { voice: Pick<Voice, "display_name" | "provider"> | null })[];
  numbers: PhoneNumber[];
  providers: ProviderConfig[];
  integrations: Integration[];
  subscription: (Subscription & { plan: Plan | null }) | null;
  usage: UsageRecord[];
  counts: { knowledge: number; appointments: number; leads: number; calls: number };
  incidents: SystemIncident[];
};

export type AdminAgentRow = Agent & {
  business: BizRef | null;
  voice: Pick<Voice, "id" | "display_name" | "provider" | "provider_voice_id"> | null;
  voice_config: VoiceConfig | null;
  provider_config: Pick<ProviderConfig, "id" | "name" | "provider" | "status" | "credentials_set"> | null;
};

export type AdminVoiceRow = Voice & { agents: (Pick<Agent, "id" | "name"> & { business: BizRef | null })[] };
export type AdminNumberRow = PhoneNumber & { business: BizRef | null; agent: Pick<Agent, "id" | "name"> | null };
export type AdminProviderConfigRow = ProviderConfig & { business: BizRef | null };

export type AdminIntegrations = {
  integrations: (Integration & { business: BizRef | null })[];
  events: (IntegrationEvent & {
    integration: Pick<Integration, "id" | "provider" | "display_name"> | null;
    business: Pick<Business, "id" | "name"> | null;
  })[];
};

export type AdminBilling = {
  plans: Plan[];
  subscriptions: (Subscription & { plan: Plan | null; business: BizRef | null })[];
  invoices: (Invoice & { business: BizRef | null })[];
  usage: (UsageRecord & { business: BizRef | null })[];
};

export type AdminSystem = {
  incidents: (SystemIncident & { business: BizRef | null })[];
  failedCalls: (Pick<CallListRow, "id" | "business_id" | "started_at" | "status" | "error_code" | "error_message" | "provider" | "direction" | "from_number" | "to_number"> & {
    business: BizRef | null;
  })[];
  errorEvents: (CallEvent & { business: BizRef | null })[];
  integrationErrors: (IntegrationEvent & { integration: Pick<Integration, "provider" | "display_name"> | null; business: BizRef | null })[];
  unanswered: (UnansweredQuestion & { business: BizRef | null })[];
  qaQueue: (Pick<CallListRow, "id" | "business_id" | "started_at" | "status" | "outcome" | "qa_status" | "qa_notes" | "confidence" | "summary" | "intent"> & {
    business: BizRef | null;
    contact: { full_name: string | null } | null;
  })[];
  providers: AdminProviderConfigRow[];
};

export type InternalAdminRow = InternalAdmin & { profile: Pick<Profile, "id" | "email" | "full_name"> | null };

export type AdminOverviewCounts = {
  businesses: number;
  activeBusinesses: number;
  agents: number;
  numbers: number;
  openIncidents: number;
  providerErrors: number;
  /** Ours: agencies (platform view) and pending number requests. */
  agencies?: number;
  pendingNumberRequests?: number;
};

export type AdminRecentActivity = {
  audit: AuditRow[];
  appointments: (Pick<Appointment, "id" | "business_id" | "created_at" | "customer_name" | "service" | "status"> & { business: Pick<Business, "name" | "is_demo"> | null })[];
  leads: (Pick<Lead, "id" | "business_id" | "created_at" | "name" | "intent" | "stage"> & { business: Pick<Business, "name" | "is_demo"> | null })[];
};

export type AdminAppointmentsLeads = {
  appointments: Pick<Appointment, "id" | "business_id" | "created_at" | "status">[];
  leads: Pick<Lead, "id" | "business_id" | "created_at" | "stage">[];
};

// ---- Foundation (implemented from existing endpoints; area C may replace) ----

export async function getAdminOverviewCounts(): Promise<AdminOverviewCounts> {
  const session = await api.get<Session>("/api/session", { allow401: true });
  if (!session.signedIn) throw new Error("Please sign in.");
  if (session.console === "platform") {
    const [{ agencies }, requests] = await Promise.all([
      api.get<{ agencies: Agency[] }>("/api/admin/agencies"),
      api.get<{ pending: number }>("/api/admin/number-requests").catch(() => ({ pending: 0 })),
    ]);
    const real = agencies.filter((a) => !a.sandbox);
    const businesses = agencies.reduce((n, a) => n + a.clients, 0);
    return {
      businesses,
      activeBusinesses: agencies.filter((a) => !a.suspended).reduce((n, a) => n + a.clients, 0),
      agents: businesses,
      numbers: agencies.reduce((n, a) => n + a.withNumbers, 0),
      openIncidents: 0,
      providerErrors: 0,
      agencies: real.length,
      pendingNumberRequests: requests.pending,
    };
  }
  const { clients } = await api.get<{ clients: { id: string; phoneNumbers?: string[] }[] }>("/api/clients");
  return {
    businesses: clients.length,
    activeBusinesses: clients.length,
    agents: clients.length,
    numbers: clients.filter((c) => (c.phoneNumbers ?? []).length > 0).length,
    openIncidents: 0,
    providerErrors: 0,
  };
}

// ---- Area C fills these (stubs return empty data in the right shapes) ----

export async function getAudit(_businessId: string | null): Promise<AuditRow[]> {
  return [];
}

export async function getAdminBusinesses(): Promise<AdminBusinessRow[]> {
  return [];
}

export async function getAdminBusinessDetail(_businessId: string): Promise<AdminBusinessDetail> {
  throw new Error("Client details aren't available yet.");
}

export async function getAdminAgents(): Promise<AdminAgentRow[]> {
  return [];
}

export async function getAdminVoices(): Promise<AdminVoiceRow[]> {
  return [];
}

export async function getAdminNumbers(): Promise<AdminNumberRow[]> {
  return [];
}

export async function getAdminProviderConfigs(): Promise<AdminProviderConfigRow[]> {
  return [];
}

export async function getAdminIntegrations(): Promise<AdminIntegrations> {
  return { integrations: [], events: [] };
}

export async function getAdminBilling(): Promise<AdminBilling> {
  return { plans: [], subscriptions: [], invoices: [], usage: [] };
}

export async function getAdminSystem(): Promise<AdminSystem> {
  return { incidents: [], failedCalls: [], errorEvents: [], integrationErrors: [], unanswered: [], qaQueue: [], providers: [] };
}

export async function getInternalAdmins(): Promise<InternalAdminRow[]> {
  return [];
}

export async function getAdminRecentActivity(): Promise<AdminRecentActivity> {
  return { audit: [], appointments: [], leads: [] };
}

export async function getAdminAppointmentsLeads(_range: ResolvedRange): Promise<AdminAppointmentsLeads> {
  return { appointments: [], leads: [] };
}

/** Answered's pages wrote audit rows from the browser; our server writes them itself. */
export async function logAudit(_input: {
  business_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {}
