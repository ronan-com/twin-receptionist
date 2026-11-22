import { queryOptions } from "@tanstack/react-query";
import * as consoleApi from "@/lib/api/console";
import * as manageApi from "@/lib/api/manage";
import * as workspaceApi from "@/lib/api/workspace";
import { normaliseDemoCallDetail, normaliseDemoCallListRow } from "./business-logic";
import type { ResolvedRange } from "./date-range";

// The same query names and return shapes as Answered's original, but every query
// calls our server through src/lib/api/{workspace,manage,console}.ts instead of
// Supabase. Pages keep using these names unchanged.

export const rangeKey = (r: ResolvedRange) => `${r.preset}:${r.timezone}:${r.from.toISOString()}:${r.to.toISOString()}`;

/* ---------------- Workspace ---------------- */

// One request (/api/session/businesses) answers both; they share the cache entry.
export const businessesQuery = () =>
  queryOptions({
    queryKey: ["businesses"],
    queryFn: workspaceApi.getSessionBusinesses,
    select: (d: workspaceApi.SessionBusinesses) => d.businesses,
  });

export const membershipsQuery = (userId: string | null) =>
  queryOptions({
    queryKey: ["businesses"],
    enabled: !!userId,
    queryFn: workspaceApi.getSessionBusinesses,
    select: (d: workspaceApi.SessionBusinesses) => d.memberships,
  });

/* ---------------- Calls ---------------- */

/** Calls for the selected range AND the previous range (for comparisons). */
export const callsForRangeQuery = (businessId: string | null, range: ResolvedRange) =>
  queryOptions({
    queryKey: ["calls", businessId, rangeKey(range)],
    enabled: !!businessId,
    queryFn: async () => (await workspaceApi.getCallsForRange(businessId!, range)).map(normaliseDemoCallListRow),
  });

export const adminCallsForRangeQuery = (range: ResolvedRange) =>
  queryOptions({
    queryKey: ["admin", "calls", rangeKey(range)],
    queryFn: async () => (await workspaceApi.getAdminCallsForRange(range)).map(normaliseDemoCallListRow),
  });

export const callDetailQuery = (callId: string | null) =>
  queryOptions({
    queryKey: ["call", callId],
    enabled: !!callId,
    queryFn: async () => {
      const row = await workspaceApi.getCallDetail(callId!);
      row.transcript_segments.sort((a, b) => a.seq - b.seq);
      row.call_events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
      return normaliseDemoCallDetail(row);
    },
  });

export const smsCountQuery = (businessId: string | null, range: ResolvedRange) =>
  queryOptions({
    queryKey: ["sms-count", businessId, rangeKey(range)],
    enabled: !!businessId,
    queryFn: () => workspaceApi.getSmsCount(businessId!, range),
  });

/* ---------------- Business-scoped resources ---------------- */

export const agentsQuery = (businessId: string | null) =>
  queryOptions({ queryKey: ["agents", businessId], enabled: !!businessId, queryFn: () => manageApi.getAgents(businessId!) });

export const voicesQuery = (clientVisibleOnly = false) =>
  queryOptions({ queryKey: ["voices", clientVisibleOnly], queryFn: () => manageApi.getVoices(clientVisibleOnly) });

export const phoneNumbersQuery = (businessId: string | null) =>
  queryOptions({ queryKey: ["phone-numbers", businessId], enabled: !!businessId, queryFn: () => manageApi.getPhoneNumbers(businessId!) });

export const appointmentsQuery = (businessId: string | null) =>
  queryOptions({ queryKey: ["appointments", businessId], enabled: !!businessId, queryFn: () => workspaceApi.getAppointments(businessId!) });

export const leadsQuery = (businessId: string | null) =>
  queryOptions({ queryKey: ["leads", businessId], enabled: !!businessId, queryFn: () => workspaceApi.getLeads(businessId!) });

export const knowledgeQuery = (businessId: string | null) =>
  queryOptions({ queryKey: ["knowledge", businessId], enabled: !!businessId, queryFn: () => manageApi.getKnowledge(businessId!) });

export const unansweredQuery = (businessId: string | null) =>
  queryOptions({ queryKey: ["unanswered", businessId], enabled: !!businessId, queryFn: () => workspaceApi.getUnanswered(businessId!) });

export const integrationsQuery = (businessId: string | null) =>
  queryOptions({ queryKey: ["integrations", businessId], enabled: !!businessId, queryFn: () => manageApi.getIntegrations(businessId!) });

export const integrationEventsQuery = (businessId: string | null) =>
  queryOptions({
    queryKey: ["integration-events", businessId],
    enabled: !!businessId,
    queryFn: () => manageApi.getIntegrationEvents(businessId!),
  });

export const teamQuery = (businessId: string | null) =>
  queryOptions({ queryKey: ["team", businessId], enabled: !!businessId, queryFn: () => manageApi.getTeam(businessId!) });

export const subscriptionQuery = (businessId: string | null) =>
  queryOptions({ queryKey: ["subscription", businessId], enabled: !!businessId, queryFn: () => manageApi.getSubscription(businessId!) });

export const usageQuery = (businessId: string | null) =>
  queryOptions({ queryKey: ["usage", businessId], enabled: !!businessId, queryFn: () => manageApi.getUsage(businessId!) });

export const auditQuery = (businessId: string | null) =>
  queryOptions({ queryKey: ["audit", businessId ?? "all"], queryFn: () => consoleApi.getAudit(businessId) });

/* ---------------- Admin / global ---------------- */

export const adminBusinessesQuery = () => queryOptions({ queryKey: ["admin", "businesses"], queryFn: consoleApi.getAdminBusinesses });

export const adminBusinessDetailQuery = (businessId: string | null) =>
  queryOptions({
    queryKey: ["admin", "business", businessId],
    enabled: !!businessId,
    queryFn: () => consoleApi.getAdminBusinessDetail(businessId!),
  });

export const adminAgentsQuery = () => queryOptions({ queryKey: ["admin", "agents"], queryFn: consoleApi.getAdminAgents });

export const adminVoicesQuery = () => queryOptions({ queryKey: ["admin", "voices"], queryFn: consoleApi.getAdminVoices });

export const adminNumbersQuery = () => queryOptions({ queryKey: ["admin", "numbers"], queryFn: consoleApi.getAdminNumbers });

export const adminProviderConfigsQuery = () =>
  queryOptions({ queryKey: ["admin", "provider-configs"], queryFn: consoleApi.getAdminProviderConfigs });

export const adminIntegrationsQuery = () => queryOptions({ queryKey: ["admin", "integrations"], queryFn: consoleApi.getAdminIntegrations });

export const adminBillingQuery = () => queryOptions({ queryKey: ["admin", "billing"], queryFn: consoleApi.getAdminBilling });

export const adminSystemQuery = () => queryOptions({ queryKey: ["admin", "system"], queryFn: consoleApi.getAdminSystem });

export const internalAdminsQuery = () => queryOptions({ queryKey: ["admin", "internal-admins"], queryFn: consoleApi.getInternalAdmins });

export const adminOverviewCountsQuery = () =>
  queryOptions({ queryKey: ["admin", "overview-counts"], queryFn: consoleApi.getAdminOverviewCounts });

export const adminRecentActivityQuery = () =>
  queryOptions({ queryKey: ["admin", "recent-activity"], queryFn: consoleApi.getAdminRecentActivity });

export const adminAppointmentsLeadsQuery = (range: ResolvedRange) =>
  queryOptions({
    queryKey: ["admin", "appointments-leads", rangeKey(range)],
    queryFn: () => consoleApi.getAdminAppointmentsLeads(range),
  });

/* ---------------- Mutations helpers ---------------- */

export const logAudit = consoleApi.logAudit;
