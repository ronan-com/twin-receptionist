import type { ResolvedRange } from "../app/date-range";
import type { AppointmentRow, AppointmentStatus, Business, CallDetail, CallListRow, Lead, LeadStage, Membership, UnansweredQuestion } from "../app/types";
import { api, ApiError, qs } from "./base";

// The workspace (/app) data layer. Server side: server/routes/workspace.ts under
// /api/workspace/<businessId>/... (area W), plus the foundation's /api/session/businesses.

/** A business (one receptionist) in Answered's shape, plus a few of our fields. */
export type WorkspaceBusiness = Business & {
  org_id: string;
  org_name: string;
  receptionist_name: string;
  phone_numbers: string[];
  /** Closures and public holidays, "a; b" (empty when none). */
  closures?: string;
};

/** A business membership in Answered's shape; access_role is ours (manager / viewer). */
export type WorkspaceMembership = Membership & { access_role: "manager" | "viewer" };

export type SessionBusinesses = { businesses: WorkspaceBusiness[]; memberships: WorkspaceMembership[] };

// ---- Foundation (implemented) ----

export const getSessionBusinesses = () => api.get<SessionBusinesses>("/api/session/businesses");

/**
 * "Create a business" from the workspace switcher. Agency staff create a receptionist
 * in their agency (the same path as the console). Returns the new business id.
 */
export async function createBusiness(input: { name: string; industry?: string; timezone?: string; phone?: string; website?: string }): Promise<string> {
  const res = await api.post<{ client: { id: string } }>("/api/clients", {
    businessName: input.name,
    industry: input.industry,
    timezone: input.timezone,
    services: ["General enquiries"],
    receptionistName: "Mia",
    defaultVoice: true,
  });
  return res.client.id;
}

// ---- Area W: /api/workspace/<businessId>/... (server/routes/workspace.ts) ----

const base = (businessId: string) => `/api/workspace/${encodeURIComponent(businessId)}`;

/** Calls for the selected range AND the previous range (for comparisons), newest first. */
export async function getCallsForRange(businessId: string, range: ResolvedRange): Promise<CallListRow[]> {
  const res = await api.get<{ calls: CallListRow[] }>(`${base(businessId)}/calls${qs({ from: range.prevFrom.toISOString(), to: range.to.toISOString() })}`);
  return res.calls;
}

/** Every call in the range across the console's businesses (admin / agency): area C's /api/console/calls. */
export async function getAdminCallsForRange(range: ResolvedRange): Promise<CallListRow[]> {
  try {
    const res = await api.get<{ calls: CallListRow[] }>(`/api/console/calls${qs({ from: range.prevFrom.toISOString(), to: range.to.toISOString() })}`);
    return res.calls;
  } catch (err) {
    // Until the console serves its call list, show no calls rather than an error.
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

/**
 * One call with its transcript, timeline and linked records. In the workspace pass the
 * business id; without one (the console) it asks /api/console/calls/<id> (area C).
 */
export async function getCallDetail(callId: string, businessId: string | null): Promise<CallDetail> {
  const path = businessId ? `${base(businessId)}/calls/${encodeURIComponent(callId)}` : `/api/console/calls/${encodeURIComponent(callId)}`;
  return (await api.get<{ call: CallDetail }>(path)).call;
}

/** Text conversations in the range (we count conversations, not single messages). */
export async function getSmsCount(businessId: string, range: ResolvedRange): Promise<number> {
  return (await api.get<{ count: number }>(`${base(businessId)}/texts/count${qs({ from: range.from.toISOString(), to: range.to.toISOString() })}`)).count;
}

export async function getAppointments(businessId: string): Promise<AppointmentRow[]> {
  return (await api.get<{ appointments: AppointmentRow[] }>(`${base(businessId)}/bookings`)).appointments;
}

export type AppointmentPatch = { status?: AppointmentStatus; notes?: string };

/** Managers, agency staff and the platform team (the server refuses viewers). Changes our record only. */
export async function updateAppointment(businessId: string, id: string, patch: AppointmentPatch): Promise<AppointmentRow> {
  return (await api.patch<{ appointment: AppointmentRow }>(`${base(businessId)}/bookings/${encodeURIComponent(id)}`, patch)).appointment;
}

export async function getLeads(businessId: string): Promise<Lead[]> {
  return (await api.get<{ leads: Lead[] }>(`${base(businessId)}/follow-ups`)).leads;
}

export type LeadPatch = {
  stage?: LeadStage;
  summary?: string;
  value_cents?: number | null;
  follow_up_status?: string;
  follow_up_at?: string | null;
  assigned_to?: string | null;
};

/** Managers, agency staff and the platform team (the server refuses viewers). */
export async function updateLead(businessId: string, id: string, patch: LeadPatch): Promise<Lead> {
  return (await api.patch<{ lead: Lead }>(`${base(businessId)}/follow-ups/${encodeURIComponent(id)}`, patch)).lead;
}

/** We don't detect unanswered questions yet (contract S6), so there are none. */
export async function getUnanswered(_businessId: string): Promise<UnansweredQuestion[]> {
  return [];
}
