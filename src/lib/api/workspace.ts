import type { ResolvedRange } from "../app/date-range";
import type { AppointmentRow, Business, CallDetail, CallListRow, Lead, Membership, UnansweredQuestion } from "../app/types";
import { api } from "./base";

// The workspace (/app) data layer. Server side: server/routes/workspace.ts under
// /api/workspace/<businessId>/... (area W), plus the foundation's /api/session/businesses.

/** A business (one receptionist) in Answered's shape, plus a few of our fields. */
export type WorkspaceBusiness = Business & {
  org_id: string;
  org_name: string;
  receptionist_name: string;
  phone_numbers: string[];
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

// ---- Area W fills these (stubs return empty data in the right shapes) ----

/** Calls for the selected range AND the previous range (for comparisons), newest first. */
export async function getCallsForRange(_businessId: string, _range: ResolvedRange): Promise<CallListRow[]> {
  return [];
}

/** Every call in the range across the console's businesses (admin / agency). */
export async function getAdminCallsForRange(_range: ResolvedRange): Promise<CallListRow[]> {
  return [];
}

export async function getCallDetail(_callId: string): Promise<CallDetail> {
  throw new Error("Call details aren't available yet.");
}

export async function getSmsCount(_businessId: string, _range: ResolvedRange): Promise<number> {
  return 0;
}

export async function getAppointments(_businessId: string): Promise<AppointmentRow[]> {
  return [];
}

export async function getLeads(_businessId: string): Promise<Lead[]> {
  return [];
}

export async function getUnanswered(_businessId: string): Promise<UnansweredQuestion[]> {
  return [];
}
