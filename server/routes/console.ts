import type { Business as Receptionist, CallMessage } from "../../src/lib/shared";
import { formatNumber, industry, INDUSTRIES, type IndustryKey } from "../../src/lib/shared";
import { AuthError, createInvite, emailOf, requireRole, type Ctx } from "../accounts";
import { changeBrand, ownBrand, uploadAsset } from "../brand";
import { answeredBusiness } from "../answered";
import { audit } from "../audit";
import { iso, sql } from "../db";
import { createRequest } from "../numberRequests";
import { callSummary } from "../numbers";
import { ValidationError } from "../prompt";
import { demoCallDetail, isDemo } from "../sandbox";
import { runAsOrg, telnyx } from "../telnyx";
import { json, readBody, type RouteArgs } from "./http";
import { manageDeps } from "./manage";

// Area C (console): the /admin screens. Paths: /api/console/...
//  - The platform admin (not viewing as anyone) sees every agency and business.
//  - Agency staff, and the platform admin viewing as an agency, see only the
//    businesses of the org they work in (ctx.org).
// Business users never reach this module (server/index.ts refuses them). Viewing
// as someone is read-only: index.ts refuses every non-GET while ctx.viewing is set.
// Rows come back in Answered's snake_case shapes (src/lib/app/types.ts), with a few
// fields of our own (org_id, org_name, paused_at...).

const MODEL = "zai-org/GLM-5.3-Flash";
const UUID = /^[a-f0-9-]{36}$/;

/** The platform admin working as themselves: sees everything. */
export const isPlatformScope = (ctx: Ctx) => ctx.user.platformAdmin && !ctx.viewing;

/** null = every org (platform admin), otherwise the one org this person works in. */
const scopeOf = (ctx: Ctx): string | null => (isPlatformScope(ctx) ? null : ctx.org!.id);

function onlyPlatform(ctx: Ctx): void {
  if (!isPlatformScope(ctx)) throw new AuthError("Only the platform team can do that.", 403);
}

// Changes to a business: agency owners and admins, or the platform admin.
function canManage(ctx: Ctx): void {
  if (ctx.user.platformAdmin) return;
  requireRole(ctx, "admin");
}

/** Whether a business is paused on its own (server/index.ts hook() checks this). */
export async function isClientPaused(clientId: string): Promise<boolean> {
  const [r] = await sql`select paused_at from clients where id = ${clientId}`;
  return Boolean(r?.paused_at);
}

// ---------------------------------------------------------------- rows

type ClientRow = {
  id: string;
  data: Receptionist;
  org_id: string;
  org_name: string;
  sandbox: boolean;
  direct: boolean;
  suspended_at: Date | null;
  paused_at: Date | null;
  created_at: Date;
  company_id: string | null;
  company_name: string | null;
};

async function clientsInScope(scope: string | null, id: string | null = null, companyId: string | null = null): Promise<ClientRow[]> {
  return (await sql`
    select c.id, c.data, c.org_id, c.paused_at, c.created_at, c.company_id, m.name as company_name,
      o.name as org_name, o.sandbox, o.direct, o.suspended_at
    from clients c join orgs o on o.id = c.org_id left join companies m on m.id = c.company_id
    where (${scope}::uuid is null or c.org_id = ${scope}::uuid)
      and (${id}::uuid is null or c.id = ${id}::uuid)
      and (${companyId}::uuid is null or c.company_id = ${companyId}::uuid)
    order by c.created_at desc`) as ClientRow[];
}

// Receptionists made outside the console (business sign-up, the API) get a company of
// their own the first time the console looks: same id as the receptionist.
async function ensureCompanies(scope: string | null): Promise<void> {
  const loose = await sql`select 1 from clients where company_id is null and (${scope}::uuid is null or org_id = ${scope}::uuid) limit 1`;
  if (!loose.length) return;
  await sql`
    insert into companies (id, org_id, name, industry, created_at)
    select c.id, c.org_id, coalesce(nullif(c.data->'settings'->>'businessName', ''), 'Client'), coalesce(c.data->'settings'->>'industry', ''), c.created_at
    from clients c where c.company_id is null and (${scope}::uuid is null or c.org_id = ${scope}::uuid)
    on conflict (id) do nothing`;
  await sql`
    update clients c set company_id = c.id where c.company_id is null and (${scope}::uuid is null or c.org_id = ${scope}::uuid)
      and exists (select 1 from companies m where m.id = c.id and m.org_id = c.org_id)`;
}

async function oneClient(ctx: Ctx, id: string): Promise<ClientRow> {
  if (!UUID.test(id)) throw new ValidationError("Unknown business.");
  const [c] = await clientsInScope(scopeOf(ctx), id);
  // Another agency's business looks exactly like one that doesn't exist.
  if (!c) throw new AuthError("That business isn't in your console.", 404);
  return c;
}

const statusOf = (c: ClientRow) => (c.paused_at || c.suspended_at ? "paused" : "active");

const bizRef = (c: ClientRow) => ({
  id: c.id,
  name: c.data.settings?.businessName ?? "",
  is_demo: Boolean(c.sandbox),
  timezone: c.data.settings?.timezone ?? "Australia/Brisbane",
  org_id: c.org_id,
  org_name: c.org_name,
  company_id: c.company_id,
  company_name: c.company_name,
});

function businessRow(c: ClientRow) {
  const b = answeredBusiness({ ...c.data, id: c.id }, { orgId: c.org_id, orgName: c.org_name, sandbox: Boolean(c.sandbox), suspended: Boolean(c.suspended_at) });
  return {
    ...b,
    status: statusOf(c),
    paused_at: c.paused_at ? iso(c.paused_at) : null,
    agency_paused: Boolean(c.suspended_at),
    org_direct: Boolean(c.direct),
    company_id: c.company_id,
    company_name: c.company_name,
  };
}

function agentRow(c: ClientRow) {
  const s = c.data.settings ?? ({} as Receptionist["settings"]);
  const numbers = c.data.phoneNumbers ?? [];
  return {
    id: c.id,
    business_id: c.id,
    name: s.receptionistName || "Receptionist",
    status: statusOf(c),
    greeting: s.greeting ?? "",
    tone: s.tone ?? "friendly",
    voice_id: s.voiceId ?? "",
    voice: s.voiceName ? { id: s.voiceId ?? "", display_name: s.voiceName, provider: "telnyx" } : null,
    language: "en-AU",
    provider: "telnyx",
    provider_agent_id: c.data.assistantId,
    demo_assistant: isDemo(c.data.assistantId ?? ""),
    llm_model: MODEL,
    routing_status: numbers.length ? "routed" : "not_connected",
    booking: c.data.booking ? { provider: c.data.booking.provider ?? "builtin", enabled: c.data.booking.enabled, minutes: c.data.booking.minutes } : null,
    services: s.services ?? [],
    last_published_at: iso(c.data.updatedAt),
    created_at: iso(c.data.createdAt),
    updated_at: iso(c.data.updatedAt),
    business: bizRef(c),
  };
}

function numberRows(c: ClientRow) {
  return (c.data.phoneNumbers ?? []).map((e164) => ({
    id: e164,
    e164,
    friendly_name: formatNumber(e164),
    business_id: c.id,
    agent_id: c.id,
    agent: { id: c.id, name: c.data.settings?.receptionistName || "Receptionist" },
    status: "active",
    routing_mode: "ai_receptionist",
    capabilities: { voice: true, sms: e164.startsWith("+614") },
    country: "AU",
    provider: "telnyx",
    health: "healthy",
    last_health_check_at: iso(c.data.updatedAt),
    monthly_usage_minutes: null,
    business: bizRef(c),
  }));
}

function callRow(r: any, c: ClientRow | undefined) {
  return {
    id: r.id,
    business_id: r.client_id,
    agent_id: r.client_id,
    provider_call_id: r.provider_call_id,
    provider: "telnyx",
    direction: "inbound",
    channel: r.channel,
    metadata: { channel: r.channel },
    from_number: r.from_number,
    to_number: r.to_number,
    started_at: iso(r.started_at),
    answered_at: iso(r.started_at),
    ended_at: r.ended_at ? iso(r.ended_at) : null,
    duration_seconds: r.duration_seconds,
    talk_time_seconds: r.duration_seconds ?? 0,
    status: r.status,
    outcome: r.outcome,
    summary: r.summary,
    ai_handled: true,
    transferred: false,
    transfer_target: null,
    after_hours: false,
    sentiment: null,
    confidence: null,
    intent: r.channel && r.channel !== "call" ? "Text conversation" : null,
    error_code: null,
    error_message: r.status === "failed" ? (r.summary ?? "The call failed.") : null,
    qa_status: "unreviewed",
    contact: r.from_number ? { id: null, full_name: null, phone: r.from_number } : null,
    agent: c ? { id: c.id, name: c.data.settings?.receptionistName || "Receptionist" } : null,
    phone_number: r.to_number ? { id: r.to_number, e164: r.to_number, friendly_name: formatNumber(r.to_number) } : null,
    business: c ? bizRef(c) : null,
  };
}

function incidentRow(r: any, c: ClientRow | undefined, orgName: string | null) {
  const d = r.detail ?? {};
  const extra = Object.entries(d)
    .filter(([k]) => !["severity", "details"].includes(k))
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
  return {
    id: r.id,
    business_id: r.client_id,
    org_id: r.org_id,
    org_name: orgName,
    title: r.message,
    details: (d.details as string) ?? (extra || null),
    severity: (d.severity as string) ?? "error",
    source: r.kind,
    status: r.status,
    started_at: iso(r.created_at),
    created_at: iso(r.created_at),
    updated_at: iso(r.resolved_at ?? r.created_at),
    resolved_at: r.resolved_at ? iso(r.resolved_at) : null,
    business: c ? bizRef(c) : null,
  };
}

const humanAction = (a: string) => a.replace(/[._]/g, " ").replace(/^\w/, (m) => m.toUpperCase());

function auditRow(r: any, c: ClientRow | undefined) {
  const d = r.detail ?? {};
  return {
    id: r.id,
    business_id: r.client_id,
    org_id: r.org_id,
    org_name: r.org_name ?? null,
    actor_id: r.actor,
    actor_email: r.actor_email ?? null,
    action: r.action,
    entity_type: String(r.action).split(".")[0] || "other",
    entity_id: (d.id as string) ?? null,
    summary: (d.summary as string) ?? summarise(r.action, d, c),
    metadata: d,
    created_at: iso(r.created_at),
    business: c ? { id: c.id, name: c.data.settings?.businessName ?? "", is_demo: Boolean(c.sandbox) } : null,
  };
}

function summarise(action: string, d: Record<string, unknown>, c: ClientRow | undefined): string {
  const biz = (d.business as string) || c?.data.settings?.businessName || "";
  const base = humanAction(action);
  return biz ? `${base}: ${biz}` : base;
}

/** Answered appointment / lead rows from booking_requests (the light fields the console reads). */
function requestRows(rows: any[], byId: Map<string, ClientRow>) {
  const appointments: any[] = [];
  const leads: any[] = [];
  for (const r of rows) {
    const d = r.data ?? {};
    const c = byId.get(r.client_id);
    const business = c ? { id: c.id, name: c.data.settings?.businessName ?? "", is_demo: Boolean(c.sandbox) } : null;
    const at = d.at || iso(r.created_at);
    if (d.kind === "booking") {
      appointments.push({
        id: String(d.id ?? r.id),
        business_id: r.client_id,
        created_at: at,
        starts_at: d.start || null,
        customer_name: d.name || null,
        customer_phone: d.phone || null,
        service: d.service || null,
        status: d.apptStatus ?? (d.status === "booked" ? "confirmed" : d.status === "failed" ? "cancelled" : "pending"),
        business,
      });
    } else {
      leads.push({
        id: String(d.id ?? r.id),
        business_id: r.client_id,
        created_at: at,
        name: d.name || null,
        phone: d.phone || null,
        intent: d.service || "Callback request",
        stage: d.stage ?? "new",
        business,
      });
    }
  }
  return { appointments, leads };
}

function rangeOf(url: URL): { from: Date; to: Date } {
  const to = new Date(url.searchParams.get("to") ?? "");
  const from = new Date(url.searchParams.get("from") ?? "");
  const end = Number.isNaN(to.getTime()) ? new Date() : to;
  const start = Number.isNaN(from.getTime()) ? new Date(end.getTime() - 30 * 86_400_000) : from;
  // At most a year at a time.
  return { from: start.getTime() < end.getTime() - 366 * 86_400_000 ? new Date(end.getTime() - 366 * 86_400_000) : start, to: end };
}

const indexed = (rows: ClientRow[]) => new Map(rows.map((c) => [c.id, c]));

// ---------------------------------------------------------------- reads

async function overview(ctx: Ctx) {
  const scope = scopeOf(ctx);
  await ensureCompanies(scope);
  const [co] = await sql`select count(*)::int as n from companies where (${scope}::uuid is null or org_id = ${scope}::uuid)`;
  const [c] = await sql`
    select count(*)::int as businesses,
      (count(*) filter (where c.paused_at is null and o.suspended_at is null))::int as active,
      coalesce(sum(jsonb_array_length(coalesce(c.data->'phoneNumbers', '[]'::jsonb))), 0)::int as numbers
    from clients c join orgs o on o.id = c.org_id
    where (${scope}::uuid is null or c.org_id = ${scope}::uuid)`;
  const [i] = await sql`
    select count(*)::int as n from incidents where status = 'open' and (${scope}::uuid is null or org_id = ${scope}::uuid)`;
  const [r] = await sql`
    select count(*)::int as n from number_requests where status = 'pending' and (${scope}::uuid is null or org_id = ${scope}::uuid)`;
  const [calls] = await sql`
    select count(*)::int as n from call_log
    where channel <> 'web' and started_at > now() - interval '30 days' and (${scope}::uuid is null or org_id = ${scope}::uuid)`;
  let agencies: number | undefined;
  let providerErrors = 0;
  if (scope === null) {
    const [a] = await sql`select count(*)::int as n from orgs where not sandbox and not direct and id <> ${ctx.org?.id ?? null}::uuid`;
    agencies = a.n;
    const [p] = await sql`select count(*)::int as n from orgs where telnyx_key is null and not platform_telnyx`;
    providerErrors = p.n;
  }
  return {
    // Clients are companies; each can have several receptionists.
    businesses: co.n,
    activeBusinesses: c.active,
    agents: c.businesses,
    numbers: c.numbers,
    openIncidents: i.n,
    providerErrors,
    pendingNumberRequests: r.n,
    calls30d: calls.n,
    ...(agencies !== undefined ? { agencies } : {}),
  };
}

async function calls(ctx: Ctx, url: URL) {
  const scope = scopeOf(ctx);
  const { from, to } = rangeOf(url);
  const clients = indexed(await clientsInScope(scope));
  const rows = await sql`
    select * from call_log
    where channel <> 'web' and started_at >= ${from} and started_at <= ${to}
      and (${scope}::uuid is null or org_id = ${scope}::uuid)
    order by started_at desc limit 10000`;
  return rows.map((r: any) => callRow(r, clients.get(r.client_id)));
}

async function transcript(c: ClientRow, providerId: string): Promise<{ summary: string; messages: CallMessage[] }> {
  if (isDemo(c.data.assistantId)) return demoCallDetail(providerId.replace(`-${c.id}`, ""));
  if (!/^[A-Za-z0-9-]{8,80}$/.test(providerId)) return { summary: "", messages: [] };
  return runAsOrg(c.org_id, async () => {
    const convo = await telnyx<{ data?: any }>("GET", `/ai/conversations/${providerId}`);
    // Only transcripts of this receptionist's own calls.
    if ((convo.data?.metadata ?? {}).assistant_id !== c.data.assistantId) return { summary: "", messages: [] };
    const [res, summary] = await Promise.all([
      telnyx<{ data?: any[] }>("GET", `/ai/conversations/${providerId}/messages`),
      callSummary(providerId).catch(() => ""),
    ]);
    const messages = (res.data ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && (m.text || m.content))
      .map((m) => ({ role: m.role, text: String(m.text ?? m.content), at: m.sent_at ?? m.created_at ?? "" }))
      .sort((a, b) => a.at.localeCompare(b.at));
    return { summary, messages };
  });
}

async function callDetail(ctx: Ctx, id: string) {
  if (!UUID.test(id)) throw new ValidationError("Unknown call.");
  const scope = scopeOf(ctx);
  const [r] = await sql`select * from call_log where id = ${id} and (${scope}::uuid is null or org_id = ${scope}::uuid)`;
  if (!r) throw new AuthError("That call isn't in your console.", 404);
  const [c] = await clientsInScope(scope, r.client_id);
  const row = callRow(r, c);
  let detail: { summary: string; messages: CallMessage[] } = { summary: "", messages: [] };
  let transcriptError: string | null = null;
  if (c) {
    try {
      detail = await transcript(c, r.provider_call_id);
    } catch (err) {
      transcriptError = `The transcript couldn't be loaded: ${(err as Error).message}`;
    }
  }
  const started = Date.parse(row.started_at);
  return {
    ...row,
    summary: detail.summary || row.summary,
    transcript_error: transcriptError,
    transcript_segments: detail.messages.map((m, i) => ({
      id: `${id}-${i}`,
      call_id: id,
      seq: i,
      speaker: m.role === "assistant" ? "agent" : "caller",
      text: m.text,
      started_ms: m.at && !Number.isNaN(started) ? Math.max(0, Date.parse(m.at) - started) : null,
    })),
    recordings: [],
    call_events: [],
    appointments: [],
    leads: [],
  };
}

async function bookingsLeads(ctx: Ctx, url: URL) {
  const scope = scopeOf(ctx);
  const { from, to } = rangeOf(url);
  const clients = indexed(await clientsInScope(scope));
  const rows = await sql`
    select r.id, r.client_id, r.data, r.created_at from booking_requests r join clients c on c.id = r.client_id
    where r.created_at >= ${from} and r.created_at <= ${to} and (${scope}::uuid is null or c.org_id = ${scope}::uuid)
    order by r.id desc limit 5000`;
  const { appointments, leads } = requestRows(rows, clients);
  return {
    appointments: appointments.map(({ id, business_id, created_at, status }) => ({ id, business_id, created_at, status })),
    leads: leads.map(({ id, business_id, created_at, stage }) => ({ id, business_id, created_at, stage })),
  };
}

async function auditRows(ctx: Ctx, limit: number, clientId: string | null = null) {
  const scope = scopeOf(ctx);
  const clients = indexed(await clientsInScope(scope));
  const rows = await sql`
    select a.*, u.email as actor_email, o.name as org_name from audit_log a
    left join users u on u.id = a.actor join orgs o on o.id = a.org_id
    where (${scope}::uuid is null or a.org_id = ${scope}::uuid) and (${clientId}::uuid is null or a.client_id = ${clientId}::uuid)
    order by a.created_at desc limit ${limit}`;
  return rows.map((r: any) => auditRow(r, r.client_id ? clients.get(r.client_id) : undefined));
}

async function activity(ctx: Ctx) {
  const scope = scopeOf(ctx);
  const clients = indexed(await clientsInScope(scope));
  const rows = await sql`
    select r.id, r.client_id, r.data, r.created_at from booking_requests r join clients c on c.id = r.client_id
    where (${scope}::uuid is null or c.org_id = ${scope}::uuid) order by r.id desc limit 40`;
  const { appointments, leads } = requestRows(rows, clients);
  const scopeIncidents = await sql`
    select * from incidents where (${scope}::uuid is null or org_id = ${scope}::uuid) order by created_at desc limit 10`;
  return {
    audit: await auditRows(ctx, 15),
    appointments: appointments.slice(0, 10),
    leads: leads.slice(0, 10),
    incidents: scopeIncidents.map((r: any) => incidentRow(r, r.client_id ? clients.get(r.client_id) : undefined, null)),
  };
}

async function system(ctx: Ctx) {
  const scope = scopeOf(ctx);
  const clients = indexed(await clientsInScope(scope));
  const orgNames = new Map<string, string>(
    (await sql`select id, name from orgs where (${scope}::uuid is null or id = ${scope}::uuid)`).map((o: any) => [o.id, o.name]),
  );
  const incidents = await sql`
    select * from incidents where (${scope}::uuid is null or org_id = ${scope}::uuid)
    order by (status = 'open') desc, created_at desc limit 100`;
  const failed = await sql`
    select * from call_log where status = 'failed' and started_at > now() - interval '30 days'
      and (${scope}::uuid is null or org_id = ${scope}::uuid) order by started_at desc limit 200`;
  const calendarErrors = await sql`
    select l.client_id, l.provider, l.last_error, l.connected_at from calendar_links l join clients c on c.id = l.client_id
    where l.last_error <> '' and (${scope}::uuid is null or c.org_id = ${scope}::uuid)`;
  const integrationErrors = [
    ...incidents
      .filter((r: any) => /^(calendar|email|hook)/.test(r.kind) && r.status === "open")
      .map((r: any) => ({
        id: r.id,
        business_id: r.client_id,
        type: `integration.${r.kind}`,
        severity: "error",
        message: r.message,
        occurred_at: iso(r.created_at),
        integration: null,
        business: r.client_id && clients.get(r.client_id) ? bizRef(clients.get(r.client_id)!) : null,
      })),
    ...calendarErrors.map((l: any) => ({
      id: `cal-${l.client_id}`,
      business_id: l.client_id,
      type: "integration.calendar",
      severity: "error",
      message: l.last_error,
      occurred_at: iso(l.connected_at),
      integration: { provider: `${l.provider}_calendar`, display_name: l.provider === "google" ? "Google Calendar" : "Outlook Calendar" },
      business: clients.get(l.client_id) ? bizRef(clients.get(l.client_id)!) : null,
    })),
  ];
  let providers: any[] = [];
  if (scope === null) {
    const orgs = await sql`select id, name, telnyx_key is not null as own, platform_telnyx, sandbox, direct from orgs order by name`;
    providers = orgs.map((o: any) => ({
      id: o.id,
      name: `${o.name} phone account`,
      provider: "telnyx",
      status: o.own || o.platform_telnyx ? "active" : "not_connected",
      credentials_set: Boolean(o.own || o.platform_telnyx),
      mode: o.own ? "own" : o.platform_telnyx ? "platform" : "none",
      last_checked_at: null,
      last_error: null,
      business: null,
    }));
  }
  return {
    incidents: incidents.map((r: any) => incidentRow(r, r.client_id ? clients.get(r.client_id) : undefined, r.org_id ? (orgNames.get(r.org_id) ?? null) : null)),
    failedCalls: failed.map((r: any) => callRow(r, clients.get(r.client_id))),
    errorEvents: [],
    integrationErrors,
    unanswered: [],
    qaQueue: [],
    providers,
  };
}

async function businesses(ctx: Ctx) {
  const scope = scopeOf(ctx);
  const rows = await clientsInScope(scope);
  const access = await sql`
    select a.user_id, a.client_id, a.role from client_access a join clients c on c.id = a.client_id
    where (${scope}::uuid is null or c.org_id = ${scope}::uuid)`;
  const invites = await sql`
    select i.client_id, count(*)::int as n from invites i
    where i.role = 'customer' and i.expires_at > now() and i.client_id is not null and (${scope}::uuid is null or i.org_id = ${scope}::uuid)
    group by i.client_id`;
  const pending = await sql`
    select client_id, count(*)::int as n from number_requests
    where status = 'pending' and (${scope}::uuid is null or org_id = ${scope}::uuid) group by client_id`;
  const calls = await sql`
    select client_id, count(*)::int as n, max(started_at) as last_at from call_log
    where channel <> 'web' and started_at > now() - interval '30 days' and (${scope}::uuid is null or org_id = ${scope}::uuid)
    group by client_id`;
  const inv = new Map(invites.map((r: any) => [r.client_id, r.n]));
  const pen = new Map(pending.map((r: any) => [r.client_id, r.n]));
  const cl = new Map(calls.map((r: any) => [r.client_id, r]));
  return rows.map((c) => ({
    ...businessRow(c),
    memberships: access
      .filter((a: any) => a.client_id === c.id)
      .map((a: any) => ({ id: `${a.user_id}:${c.id}`, user_id: a.user_id, role: a.role === "manager" ? "admin" : "read_only", access_role: a.role })),
    agents: [{ id: c.id, name: c.data.settings?.receptionistName || "Receptionist", status: statusOf(c), provider: "telnyx" }],
    numbers: (c.data.phoneNumbers ?? []).map((e164) => ({ id: e164, e164, status: "active" })),
    subscription: null,
    pending_invites: inv.get(c.id) ?? 0,
    pending_number_requests: pen.get(c.id) ?? 0,
    calls_30d: (cl.get(c.id) as any)?.n ?? 0,
    last_call_at: (cl.get(c.id) as any)?.last_at ? iso((cl.get(c.id) as any).last_at) : null,
  }));
}

async function people(clientId: string) {
  const members = await sql`
    select u.id, u.email, u.name, a.role, a.created_at from client_access a join users u on u.id = a.user_id
    where a.client_id = ${clientId} order by a.created_at`;
  const invites = await sql`
    select token_hash, email, access_role, expires_at, created_at from invites
    where client_id = ${clientId} and role = 'customer' and expires_at > now() order by created_at desc`;
  return {
    members: members.map((m: any) => ({
      id: `${m.id}:${clientId}`,
      user_id: m.id,
      business_id: clientId,
      role: m.role === "manager" ? "admin" : "read_only",
      access_role: m.role,
      created_at: iso(m.created_at),
      profile: { id: m.id, email: m.email, full_name: m.name || null },
    })),
    invitations: invites.map((i: any) => ({
      id: i.token_hash.slice(0, 16),
      business_id: clientId,
      email: i.email,
      access_role: i.access_role ?? "viewer",
      role: i.access_role === "manager" ? "admin" : "read_only",
      status: "pending",
      expires_at: iso(i.expires_at),
      created_at: iso(i.created_at),
    })),
  };
}

async function businessDetail(ctx: Ctx, id: string) {
  const c = await oneClient(ctx, id);
  const [counts] = await sql`
    select
      (select count(*)::int from knowledge_items where client_id = ${id}) as knowledge,
      (select count(*)::int from booking_requests where client_id = ${id} and data->>'kind' = 'booking') as appointments,
      (select count(*)::int from booking_requests where client_id = ${id} and data->>'kind' = 'callback') as leads,
      (select count(*)::int from call_log where client_id = ${id} and channel <> 'web') as calls`;
  const recentCalls = await sql`select * from call_log where client_id = ${id} and channel <> 'web' order by started_at desc limit 15`;
  const requests = await sql`select id, client_id, data, created_at from booking_requests where client_id = ${id} order by id desc limit 15`;
  const incidents = await sql`select * from incidents where client_id = ${id} order by created_at desc limit 20`;
  const numberRequests = await sql`
    select r.*, u.email as by_email from number_requests r left join users u on u.id = r.requested_by
    where r.client_id = ${id} order by r.created_at desc limit 10`;
  const usage = await sql`
    select date_trunc('day', started_at) as day, count(*)::int as n,
      coalesce(sum(duration_seconds), 0)::int as seconds, count(*) filter (where channel like 'sms%')::int as texts
    from call_log where client_id = ${id} and channel <> 'web' and started_at > now() - interval '90 days'
    group by 1 order by 1 desc`;
  const byId = new Map([[c.id, c]]);
  const { appointments, leads } = requestRows(requests, byId);
  const booking = c.data.booking;
  return {
    business: businessRow(c),
    agents: [agentRow(c)],
    numbers: numberRows(c),
    number_requests: numberRequests.map((r: any) => ({
      id: r.id,
      type: r.kind,
      note: r.note,
      status: r.status,
      phone_number: r.phone_number ?? "",
      reason: r.reason,
      requested_by: r.by_email ?? "",
      created_at: iso(r.created_at),
    })),
    ...(await people(id)),
    settings: {
      industry: c.data.settings?.industry,
      suburb: c.data.settings?.suburb,
      timezone: c.data.settings?.timezone,
      hours: c.data.settings?.hours,
      services: c.data.settings?.services ?? [],
      greeting: c.data.settings?.greeting ?? "",
      tone: c.data.settings?.tone,
      voice: c.data.settings?.voiceName ?? "",
      receptionist_name: c.data.settings?.receptionistName ?? "",
      booking: booking ? { provider: booking.provider ?? "builtin", enabled: booking.enabled, minutes: booking.minutes, notify_email: booking.notifyEmail ?? "" } : null,
    },
    providers: [],
    integrations: [],
    subscription: null,
    usage: usage.flatMap((u: any) => [
      { kind: "call_minutes", quantity: Math.ceil(u.seconds / 60), unit: "minute", period_start: iso(u.day) },
      { kind: "calls", quantity: u.n - u.texts, unit: "call", period_start: iso(u.day) },
      { kind: "sms", quantity: u.texts, unit: "conversation", period_start: iso(u.day) },
    ]),
    counts,
    calls: recentCalls.map((r: any) => callRow(r, c)),
    appointments,
    leads,
    incidents: incidents.map((r: any) => incidentRow(r, c, c.org_name)),
    audit: await auditRows(ctx, 20, id),
  };
}

async function numbers(ctx: Ctx) {
  const scope = scopeOf(ctx);
  const rows = await clientsInScope(scope);
  return rows.flatMap(numberRows);
}

async function numberRequests(ctx: Ctx) {
  const scope = scopeOf(ctx);
  const rows = await sql`
    select r.*, o.name as org_name, c.data->'settings'->>'businessName' as business, u.email as by_email
    from number_requests r join orgs o on o.id = r.org_id join clients c on c.id = r.client_id
    left join users u on u.id = r.requested_by
    where (${scope}::uuid is null or r.org_id = ${scope}::uuid)
    order by (r.status = 'pending') desc, r.created_at desc limit 200`;
  return rows.map((r: any) => ({
    id: r.id,
    type: r.kind,
    note: r.note,
    status: r.status,
    phoneNumber: r.phone_number ?? "",
    reason: r.reason,
    createdAt: iso(r.created_at),
    resolvedAt: r.resolved_at ? iso(r.resolved_at) : null,
    agency: r.org_name,
    business: r.business ?? "",
    requestedBy: r.by_email ?? "",
    clientId: r.client_id,
  }));
}

async function usage(ctx: Ctx, url: URL) {
  const scope = scopeOf(ctx);
  const { from, to } = rangeOf(url);
  const clients = await clientsInScope(scope);
  const rows = await sql`
    select client_id, count(*) filter (where channel not like 'sms%')::int as calls,
      count(*) filter (where channel like 'sms%')::int as texts,
      coalesce(sum(duration_seconds) filter (where channel not like 'sms%'), 0)::int as seconds,
      count(*) filter (where status = 'failed')::int as failed
    from call_log where channel <> 'web' and started_at >= ${from} and started_at <= ${to}
      and (${scope}::uuid is null or org_id = ${scope}::uuid)
    group by client_id`;
  const daily = await sql`
    select date_trunc('day', started_at) as day, count(*) filter (where channel not like 'sms%')::int as calls,
      count(*) filter (where channel like 'sms%')::int as texts,
      coalesce(sum(duration_seconds) filter (where channel not like 'sms%'), 0)::int as seconds
    from call_log where channel <> 'web' and started_at >= ${from} and started_at <= ${to}
      and (${scope}::uuid is null or org_id = ${scope}::uuid)
    group by 1 order by 1`;
  const by = new Map(rows.map((r: any) => [r.client_id, r]));
  const businessesOut = clients.map((c) => {
    const r: any = by.get(c.id) ?? { calls: 0, texts: 0, seconds: 0, failed: 0 };
    return { ...bizRef(c), calls: r.calls, texts: r.texts, minutes: Math.ceil(r.seconds / 60), seconds: r.seconds, failed: r.failed, status: statusOf(c) };
  });
  const agencies = new Map<string, { org_id: string; org_name: string; is_demo: boolean; businesses: number; calls: number; texts: number; seconds: number; failed: number }>();
  for (const b of businessesOut) {
    const a = agencies.get(b.org_id) ?? { org_id: b.org_id, org_name: b.org_name, is_demo: b.is_demo, businesses: 0, calls: 0, texts: 0, seconds: 0, failed: 0 };
    a.businesses++;
    a.calls += b.calls;
    a.texts += b.texts;
    a.seconds += b.seconds;
    a.failed += b.failed;
    agencies.set(b.org_id, a);
  }
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    businesses: businessesOut,
    agencies: [...agencies.values()].map((a) => ({ ...a, minutes: Math.ceil(a.seconds / 60) })),
    daily: daily.map((d: any) => ({ day: iso(d.day), calls: d.calls, texts: d.texts, minutes: Math.ceil(d.seconds / 60) })),
  };
}

async function platformAdmins() {
  const rows = await sql`select id, email, name, created_at from users where platform_admin order by created_at`;
  return rows.map((u: any) => ({
    id: u.id,
    user_id: u.id,
    role: "super_admin",
    created_at: iso(u.created_at),
    profile: { id: u.id, email: u.email, full_name: u.name || null },
  }));
}

// ---------------------------------------------------------------- writes

async function setPaused(ctx: Ctx, id: string, input: any) {
  canManage(ctx);
  const c = await oneClient(ctx, id);
  const status = input?.status;
  if (status !== "paused" && status !== "active") throw new ValidationError("Choose active or paused.");
  await sql`update clients set paused_at = ${status === "paused" ? new Date() : null} where id = ${id}`;
  const name = c.data.settings?.businessName ?? "";
  await audit(ctx, status === "paused" ? "business.paused" : "business.resumed", { business: name, summary: `${status === "paused" ? "Paused" : "Resumed"} ${name}` }, { orgId: c.org_id, clientId: id });
}

// Shares a business with a customer (its owner or staff): an invite link, or straight
// access if they already sign in to this agency as a customer.
async function share(ctx: Ctx, id: string, input: any, base: string) {
  canManage(ctx);
  const c = await oneClient(ctx, id);
  const email = emailOf(input?.email);
  const accessRole = input?.role === "viewer" || input?.role === "read_only" ? "viewer" : "manager";
  const businessName = c.data.settings?.businessName ?? "";
  const [existing] = await sql`
    select m.role, u.id from memberships m join users u on u.id = m.user_id where m.org_id = ${c.org_id} and u.email = ${email}`;
  let result: { url: string; emailed: boolean; added: boolean };
  if (existing) {
    if (existing.role !== "customer") throw new ValidationError(`${email} is on the agency's team already. Customers are separate people.`);
    await sql`
      insert into client_access (user_id, client_id, role) values (${existing.id}, ${id}, ${accessRole})
      on conflict (user_id, client_id) do update set role = excluded.role`;
    result = { url: "", emailed: false, added: true };
  } else {
    const invite = await createInvite(c.org_id, c.org_name, email, "customer", ctx.user, base, id, businessName);
    await sql`update invites set access_role = ${accessRole} where org_id = ${c.org_id} and email = ${email} and client_id = ${id}`;
    result = { ...invite, added: false };
  }
  await audit(ctx, "business.shared", { business: businessName, email, role: accessRole, summary: `Shared ${businessName} with ${email} (${accessRole})` }, { orgId: c.org_id, clientId: id });
  return { ...result, ...(await people(id)) };
}

async function unshare(ctx: Ctx, id: string, userId: string) {
  canManage(ctx);
  const c = await oneClient(ctx, id);
  if (!UUID.test(userId)) throw new ValidationError("Unknown person.");
  await sql.begin(async (tx) => {
    await tx`delete from client_access where client_id = ${id} and user_id = ${userId}`;
    // No businesses left to see in this agency: the customer login leaves it.
    const [left] = await tx`
      select 1 from client_access a join clients c on c.id = a.client_id where a.user_id = ${userId} and c.org_id = ${c.org_id} limit 1`;
    if (!left) {
      await tx`delete from memberships where org_id = ${c.org_id} and user_id = ${userId} and role = 'customer'`;
      await tx`delete from sessions where user_id = ${userId} and org_id = ${c.org_id}`;
    }
  });
  await audit(ctx, "business.unshared", { business: c.data.settings?.businessName ?? "", userId }, { orgId: c.org_id, clientId: id });
  return people(id);
}

async function revokeShare(ctx: Ctx, id: string, prefix: string) {
  canManage(ctx);
  const c = await oneClient(ctx, id);
  if (!/^[a-f0-9]{16}$/.test(prefix)) throw new ValidationError("Unknown invite.");
  await sql`delete from invites where client_id = ${id} and role = 'customer' and left(token_hash, 16) = ${prefix}`;
  await audit(ctx, "business.invite_revoked", { business: c.data.settings?.businessName ?? "" }, { orgId: c.org_id, clientId: id });
  return people(id);
}

async function requestNumber(ctx: Ctx, id: string, input: any, base: string) {
  const c = await oneClient(ctx, id);
  // Filed under the business's own agency, also when the platform admin files it.
  const asOwner: Ctx = { ...ctx, org: { id: c.org_id, name: c.org_name } };
  const r = await createRequest(asOwner, id, c.data.settings?.businessName ?? "", input, base);
  await audit(ctx, "number.requested", { business: c.data.settings?.businessName ?? "", type: r.type, summary: `Requested a ${r.type} number for ${c.data.settings?.businessName ?? ""}` }, { orgId: c.org_id, clientId: id });
  return r;
}

async function resolveIncident(ctx: Ctx, id: string) {
  if (!UUID.test(id)) throw new ValidationError("Unknown incident.");
  const scope = scopeOf(ctx);
  const [r] = await sql`
    update incidents set status = 'resolved', resolved_at = now()
    where id = ${id} and status = 'open' and (${scope}::uuid is null or org_id = ${scope}::uuid) returning *`;
  if (!r) throw new AuthError("That incident isn't open in your console.", 404);
  await audit(ctx, "incident.resolved", { summary: `Resolved: ${r.message}`.slice(0, 200), kind: r.kind }, { orgId: r.org_id ?? ctx.org?.id ?? null, clientId: r.client_id });
}

async function logIncident(ctx: Ctx, input: any) {
  const title = String(input?.title ?? "").trim().slice(0, 300);
  if (!title) throw new ValidationError("Describe the incident.");
  const severity = ["info", "warning", "error", "critical"].includes(input?.severity) ? input.severity : "error";
  let orgId: string | null = scopeOf(ctx);
  let clientId: string | null = null;
  if (input?.client_id) {
    const c = await oneClient(ctx, String(input.client_id));
    orgId = c.org_id;
    clientId = c.id;
  }
  await sql`
    insert into incidents (org_id, client_id, kind, message, detail)
    values (${orgId}, ${clientId}, 'manual', ${title}, ${{ severity, details: String(input?.details ?? "").slice(0, 2000), by: ctx.user.email } as any})`;
  await audit(ctx, "incident.created", { summary: `Logged incident: ${title}`.slice(0, 200) }, { orgId: orgId ?? ctx.org?.id ?? null, clientId });
}

async function grantPlatformAdmin(ctx: Ctx, input: any) {
  onlyPlatform(ctx);
  const email = emailOf(input?.email);
  const [u] = await sql`update users set platform_admin = true where email = ${email} returning id`;
  if (!u) throw new ValidationError("That person needs an account first. Invite them to a team, then grant access.");
  await audit(ctx, "platform_admin.granted", { email, summary: `Gave ${email} platform admin access` });
}

async function revokePlatformAdmin(ctx: Ctx, userId: string) {
  onlyPlatform(ctx);
  if (!UUID.test(userId)) throw new ValidationError("Unknown person.");
  if (userId === ctx.user.id) throw new ValidationError("You can't remove your own access.");
  const [{ n }] = await sql`select count(*)::int as n from users where platform_admin`;
  if (n <= 1) throw new ValidationError("There must be at least one platform admin.");
  const [u] = await sql`update users set platform_admin = false where id = ${userId} returning email`;
  if (u) await audit(ctx, "platform_admin.revoked", { email: u.email, summary: `Removed platform admin access from ${u.email}` });
}

// ---------------------------------------------------------------- companies
// An agency's client is a company. Its receptionists are clients rows (company_id),
// and each receptionist carries the company's other automations (texts, email
// replies, bookings, CRM webhook).

// A Postgres array literal of ids (all UUIDs, checked).
const pgArr = (ids: string[]) => `{${ids.filter((i) => UUID.test(i)).join(",")}}`;

type CompanyRow = { id: string; org_id: string; name: string; industry: string; brand: Record<string, string>; created_at: Date; org_name: string; sandbox: boolean };

async function companiesInScope(scope: string | null, id: string | null = null): Promise<CompanyRow[]> {
  return (await sql`
    select m.*, o.name as org_name, o.sandbox from companies m join orgs o on o.id = m.org_id
    where (${scope}::uuid is null or m.org_id = ${scope}::uuid) and (${id}::uuid is null or m.id = ${id}::uuid)
    order by lower(m.name)`) as CompanyRow[];
}

async function oneCompany(ctx: Ctx, id: string): Promise<CompanyRow> {
  if (!UUID.test(id)) throw new ValidationError("Unknown client.");
  const scope = scopeOf(ctx);
  await ensureCompanies(scope);
  let [m] = await companiesInScope(scope, id);
  if (!m) {
    // Old links name a receptionist: open its company.
    const [c] = await clientsInScope(scope, id);
    if (c?.company_id) [m] = await companiesInScope(scope, c.company_id);
  }
  if (!m) throw new AuthError("That client isn't in your console.", 404);
  return m;
}

type Automation = { key: "voice" | "sms" | "email" | "booking" | "crm"; label: string; status: "live" | "off" | "paused" | "attention"; detail: string };

async function automationsFor(rows: ClientRow[]): Promise<Map<string, Automation[]>> {
  const ids = rows.map((c) => c.id);
  const boxes = ids.length ? await sql`select client_id, data->>'address' as address, data->>'mode' as mode, data->>'lastError' as error from mailboxes where client_id = any(${pgArr(ids)}::uuid[])` : [];
  const cals = ids.length ? await sql`select client_id, provider, account, last_error from calendar_links where client_id = any(${pgArr(ids)}::uuid[])` : [];
  const box = new Map(boxes.map((b: any) => [b.client_id, b]));
  const cal = new Map(cals.map((l: any) => [l.client_id, l]));
  const out = new Map<string, Automation[]>();
  for (const c of rows) {
    const paused = statusOf(c) === "paused";
    const nums = c.data.phoneNumbers ?? [];
    const mobile = nums.find((n) => n.startsWith("+614"));
    const b = c.data.booking;
    const m: any = box.get(c.id);
    const l: any = cal.get(c.id);
    const st = (on: boolean, bad = false): Automation["status"] => (!on ? "off" : paused ? "paused" : bad ? "attention" : "live");
    let host = "";
    try {
      host = b?.leadWebhook ? new URL(b.leadWebhook).host : "";
    } catch {
      host = "set";
    }
    out.set(c.id, [
      { key: "voice", label: "Voice receptionist", status: paused ? "paused" : "live", detail: nums.length ? nums.map(formatNumber).join(", ") : "No number yet (test calls from the browser)" },
      { key: "sms", label: "SMS texting", status: st(Boolean(mobile)), detail: mobile ? `Replies to texts on ${formatNumber(mobile)}` : "Needs a mobile number" },
      { key: "email", label: "Email replies", status: st(Boolean(m), Boolean(m?.error)), detail: m ? `${m.address}${m.mode === "draft" ? " · drafts only" : ""}${m.error ? ` · ${m.error}` : ""}` : "Not connected" },
      {
        key: "booking",
        label: "Bookings and calendar",
        status: st(Boolean(b?.enabled), Boolean(l?.last_error)),
        detail: b ? `${l ? `${l.provider === "google" ? "Google" : "Outlook"} calendar (${l.account})` : b.provider === "builtin" || !b.provider ? "Built-in calendar" : `${b.provider} calendar`}${b.enabled ? "" : " · switched off"}${l?.last_error ? ` · ${l.last_error}` : ""}` : "Takes messages only",
      },
      { key: "crm", label: "CRM webhook", status: st(Boolean(b?.leadWebhook)), detail: host ? `Leads sent to ${host}` : "Not set up" },
    ]);
  }
  return out;
}

function companyRef(m: CompanyRow) {
  return { id: m.id, name: m.name, industry: m.industry, org_id: m.org_id, org_name: m.org_name, is_demo: Boolean(m.sandbox), created_at: iso(m.created_at) };
}

async function companies(ctx: Ctx) {
  const scope = scopeOf(ctx);
  await ensureCompanies(scope);
  const list = await companiesInScope(scope);
  const rows = await clientsInScope(scope);
  const autos = await automationsFor(rows);
  const access = await sql`
    select distinct a.user_id, c.company_id from client_access a join clients c on c.id = a.client_id
    where (${scope}::uuid is null or c.org_id = ${scope}::uuid)`;
  const invites = await sql`
    select coalesce(i.company_id, c.company_id) as company_id, count(*)::int as n from invites i left join clients c on c.id = i.client_id
    where i.role = 'customer' and i.expires_at > now() and (${scope}::uuid is null or i.org_id = ${scope}::uuid) group by 1`;
  const calls = await sql`
    select c.company_id, count(*)::int as n, max(l.started_at) as last_at from call_log l join clients c on c.id = l.client_id
    where l.channel <> 'web' and l.started_at > now() - interval '30 days' and (${scope}::uuid is null or l.org_id = ${scope}::uuid)
    group by 1`;
  const inv = new Map(invites.map((r: any) => [r.company_id, r.n]));
  const cl = new Map(calls.map((r: any) => [r.company_id, r]));
  return list.map((m) => {
    const mine = rows.filter((c) => c.company_id === m.id);
    const all = mine.flatMap((c) => autos.get(c.id) ?? []);
    const summary = (["voice", "sms", "email", "booking", "crm"] as const).map((key) => {
      const of = all.filter((a) => a.key === key);
      const status = of.some((a) => a.status === "attention") ? "attention" : of.some((a) => a.status === "live") ? "live" : of.some((a) => a.status === "paused") ? "paused" : "off";
      return { key, label: of[0]?.label ?? key, status };
    });
    const k: any = cl.get(m.id);
    return {
      ...companyRef(m),
      status: mine.length && mine.every((c) => statusOf(c) === "paused") ? "paused" : "active",
      receptionists: mine.map((c) => ({ id: c.id, name: c.data.settings?.receptionistName || "Receptionist", business_name: c.data.settings?.businessName ?? "", status: statusOf(c), numbers: c.data.phoneNumbers ?? [], onboarding_pending: onboardingPending(c.data) })),
      onboarding_pending: mine.some((c) => onboardingPending(c.data)),
      automations: summary,
      numbers: mine.reduce((n, c) => n + (c.data.phoneNumbers ?? []).length, 0),
      customers: new Set(access.filter((a: any) => a.company_id === m.id).map((a: any) => a.user_id)).size,
      pending_invites: inv.get(m.id) ?? 0,
      calls_30d: k?.n ?? 0,
      last_call_at: k?.last_at ? iso(k.last_at) : null,
      branded: Object.keys(m.brand ?? {}).length > 0,
    };
  });
}

async function companyPeople(m: CompanyRow, rows: ClientRow[]) {
  const ids = rows.map((c) => c.id);
  const members = ids.length
    ? await sql`
        select u.id, u.email, u.name, min(a.created_at) as created_at, array_agg(a.client_id) as clients,
          bool_or(a.role = 'manager') as manager
        from client_access a join users u on u.id = a.user_id where a.client_id = any(${pgArr(ids)}::uuid[])
        group by u.id, u.email, u.name order by min(a.created_at)`
    : [];
  const invites = await sql`
    select i.token_hash, i.email, i.access_role, i.expires_at, i.created_at from invites i left join clients c on c.id = i.client_id
    where i.role = 'customer' and i.expires_at > now() and i.org_id = ${m.org_id} and (i.company_id = ${m.id} or c.company_id = ${m.id})
    order by i.created_at desc`;
  return {
    members: members.map((u: any) => ({
      id: `${u.id}:${m.id}`,
      user_id: u.id,
      role: u.manager ? "admin" : "read_only",
      access_role: u.manager ? "manager" : "viewer",
      receptionists: u.clients as string[],
      created_at: iso(u.created_at),
      profile: { id: u.id, email: u.email, full_name: u.name || null },
    })),
    invitations: invites.map((i: any) => ({
      id: i.token_hash.slice(0, 16),
      email: i.email,
      access_role: i.access_role ?? "viewer",
      expires_at: iso(i.expires_at),
      created_at: iso(i.created_at),
    })),
  };
}

async function companyDetail(ctx: Ctx, id: string) {
  const m = await oneCompany(ctx, id);
  const rows = await clientsInScope(m.org_id, null, m.id);
  const ids = rows.map((c) => c.id);
  const byId = indexed(rows);
  const autos = await automationsFor(rows);
  const none = ids.length === 0;
  const calls = none ? [] : await sql`select * from call_log where client_id = any(${pgArr(ids)}::uuid[]) and channel <> 'web' order by started_at desc limit 25`;
  const requests = none ? [] : await sql`select id, client_id, data, created_at from booking_requests where client_id = any(${pgArr(ids)}::uuid[]) order by id desc limit 25`;
  const incidents = none ? [] : await sql`select * from incidents where client_id = any(${pgArr(ids)}::uuid[]) order by created_at desc limit 20`;
  const numberRequests = none
    ? []
    : await sql`
        select r.*, u.email as by_email from number_requests r left join users u on u.id = r.requested_by
        where r.client_id = any(${pgArr(ids)}::uuid[]) order by r.created_at desc limit 20`;
  const [counts] = none
    ? [{ knowledge: 0, appointments: 0, leads: 0, calls: 0 }]
    : await sql`
        select
          (select count(*)::int from knowledge_items where client_id = any(${pgArr(ids)}::uuid[])) as knowledge,
          (select count(*)::int from booking_requests where client_id = any(${pgArr(ids)}::uuid[]) and data->>'kind' = 'booking') as appointments,
          (select count(*)::int from booking_requests where client_id = any(${pgArr(ids)}::uuid[]) and data->>'kind' = 'callback') as leads,
          (select count(*)::int from call_log where client_id = any(${pgArr(ids)}::uuid[]) and channel <> 'web') as calls`;
  const { appointments, leads } = requestRows(requests, byId);
  const audit = await sql`
    select a.*, u.email as actor_email, o.name as org_name from audit_log a
    left join users u on u.id = a.actor join orgs o on o.id = a.org_id
    where a.org_id = ${m.org_id} and (a.client_id = any(${pgArr(ids.length ? ids : [m.id])}::uuid[]) or a.detail->>'companyId' = ${m.id})
    order by a.created_at desc limit 20`;
  return {
    company: {
      ...companyRef(m),
      status: rows.length && rows.every((c) => statusOf(c) === "paused") ? "paused" : "active",
      agency_paused: rows.some((c) => c.suspended_at),
      onboarding_pending: rows.some((c) => onboardingPending(c.data)),
    },
    receptionists: rows.map((c) => {
      const s = c.data.settings ?? ({} as Receptionist["settings"]);
      return {
        ...agentRow(c),
        business_name: s.businessName ?? "",
        paused_at: c.paused_at ? iso(c.paused_at) : null,
        onboarding_pending: onboardingPending(c.data),
        numbers: numberRows(c),
        automations: autos.get(c.id) ?? [],
        number_requests: numberRequests
          .filter((r: any) => r.client_id === c.id)
          .map((r: any) => ({ id: r.id, type: r.kind, note: r.note, status: r.status, phone_number: r.phone_number ?? "", reason: r.reason, requested_by: r.by_email ?? "", created_at: iso(r.created_at) })),
        settings: {
          industry: s.industry,
          suburb: s.suburb,
          timezone: s.timezone,
          hours: s.hours,
          services: s.services ?? [],
          greeting: s.greeting ?? "",
          tone: s.tone,
          voice: s.voiceName ?? "",
        },
      };
    }),
    ...(await companyPeople(m, rows)),
    counts,
    calls: calls.map((r: any) => callRow(r, byId.get(r.client_id))),
    appointments,
    leads,
    incidents: incidents.map((r: any) => incidentRow(r, byId.get(r.client_id), m.org_name)),
    audit: audit.map((r: any) => auditRow(r, r.client_id ? byId.get(r.client_id) : undefined)),
    brand: await ownBrand({ orgId: m.org_id, clientId: null, companyId: m.id }),
  };
}

const nameOf = (v: unknown, what: string) => {
  const s = String(v ?? "").trim().slice(0, 120);
  if (!s) throw new ValidationError(`Give the ${what} a name.`);
  return s;
};

async function createCompany(ctx: Ctx, input: any) {
  // The platform admin may file a company under any agency; staff use their own.
  let orgId = ctx.org!.id;
  if (isPlatformScope(ctx) && input?.orgId) {
    if (!UUID.test(String(input.orgId))) throw new ValidationError("Unknown agency.");
    const [o] = await sql`select id from orgs where id = ${input.orgId}`;
    if (!o) throw new ValidationError("Unknown agency.");
    orgId = o.id;
  }
  const id = crypto.randomUUID();
  const name = nameOf(input?.name, "client");
  await sql`insert into companies (id, org_id, name, industry) values (${id}, ${orgId}, ${name}, ${String(input?.industry ?? "").slice(0, 40)})`;
  await audit(ctx, "company.created", { companyId: id, summary: `Added client ${name}` }, { orgId });
  return id;
}

async function updateCompany(ctx: Ctx, id: string, input: any) {
  const m = await oneCompany(ctx, id);
  const name = input?.name !== undefined ? nameOf(input.name, "client") : m.name;
  const industry = input?.industry !== undefined ? String(input.industry).slice(0, 40) : m.industry;
  await sql`update companies set name = ${name}, industry = ${industry} where id = ${id}`;
  // The client's name is the business name everywhere (calls, dashboards, the receptionist's
  // greeting), so a rename flows into its receptionists: their business name, and the old
  // name inside their greeting. Each one is saved and pushed to the phone provider.
  if (name !== m.name) {
    const d = manageDeps();
    const rows = await sql`select id, data from clients where company_id = ${id}`;
    for (const r of rows) {
      const c = { ...(r.data as Receptionist), id: r.id };
      const s = c.settings ?? ({} as Receptionist["settings"]);
      if (s.businessName && s.businessName !== m.name && rows.length > 1) continue; // a differently named line stays as is
      const greeting = typeof s.greeting === "string" && m.name ? s.greeting.split(m.name).join(name) : s.greeting;
      const next = { ...s, businessName: name, greeting };
      try {
        if (d) await runAsOrg(m.org_id, () => d.updateClient(c, next));
        else await sql`update clients set data = jsonb_set(jsonb_set(data, '{settings,businessName}', to_jsonb(${name}::text)), '{settings,greeting}', to_jsonb(${greeting ?? ""}::text)) where id = ${r.id}`;
      } catch (err) {
        // Keep the rename even if the provider push fails; the receptionist can be re-saved.
        console.error(`[rename ${r.id}]`, (err as Error).message);
        await sql`update clients set data = jsonb_set(jsonb_set(data, '{settings,businessName}', to_jsonb(${name}::text)), '{settings,greeting}', to_jsonb(${greeting ?? ""}::text)) where id = ${r.id}`;
      }
    }
  }
  await audit(ctx, "company.updated", { companyId: id, summary: `Updated client ${name}` }, { orgId: m.org_id });
}

// Puts a receptionist into a company. Customers of the company get access to it too.
async function attachReceptionist(ctx: Ctx, id: string, input: any) {
  const m = await oneCompany(ctx, id);
  const c = await oneClient(ctx, String(input?.clientId ?? ""));
  if (c.org_id !== m.org_id) throw new ValidationError("That receptionist belongs to another agency.");
  const old = c.company_id;
  await sql.begin(async (tx) => {
    await tx`update clients set company_id = ${m.id} where id = ${c.id}`;
    // Set up by the agency (the console wizard): no client onboarding to wait for.
    await tx`update clients set data = jsonb_set(data, '{onboarding}', '"done"') where id = ${c.id} and data->>'onboarding' is null`;
    await tx`
      insert into client_access (user_id, client_id, role)
      select distinct on (a.user_id) a.user_id, ${c.id}::uuid, a.role from client_access a join clients s on s.id = a.client_id
      where s.company_id = ${m.id} and s.id <> ${c.id} order by a.user_id, (a.role = 'manager') desc
      on conflict do nothing`;
    // The company made for it automatically (empty now) goes.
    if (old && old !== m.id) await tx`delete from companies where id = ${old} and not exists (select 1 from clients where company_id = ${old})`;
  });
  await audit(ctx, "company.receptionist_added", { companyId: m.id, summary: `Added ${c.data.settings?.receptionistName || "a receptionist"} to ${m.name}` }, { orgId: m.org_id, clientId: c.id });
}

async function setCompanyPaused(ctx: Ctx, id: string, input: any) {
  canManage(ctx);
  const m = await oneCompany(ctx, id);
  const status = input?.status;
  if (status !== "paused" && status !== "active") throw new ValidationError("Choose active or paused.");
  await sql`update clients set paused_at = ${status === "paused" ? new Date() : null} where company_id = ${id}`;
  await audit(ctx, status === "paused" ? "company.paused" : "company.resumed", { companyId: id, summary: `${status === "paused" ? "Paused" : "Resumed"} ${m.name}` }, { orgId: m.org_id });
}

// Invite a customer to a company: access to every receptionist it has (now and later).
async function shareCompany(ctx: Ctx, id: string, input: any, base: string) {
  canManage(ctx);
  const m = await oneCompany(ctx, id);
  const rows = await clientsInScope(m.org_id, null, m.id);
  if (!rows.length) throw new ValidationError("Add a receptionist to this client first.");
  const email = emailOf(input?.email);
  const accessRole = input?.role === "viewer" || input?.role === "read_only" ? "viewer" : "manager";
  const [existing] = await sql`
    select m.role, u.id from memberships m join users u on u.id = m.user_id where m.org_id = ${m.org_id} and u.email = ${email}`;
  let result: { url: string; emailed: boolean; added: boolean };
  if (existing) {
    if (existing.role !== "customer") throw new ValidationError(`${email} is on the agency's team already. Customers are separate people.`);
    for (const c of rows) {
      await sql`
        insert into client_access (user_id, client_id, role) values (${existing.id}, ${c.id}, ${accessRole})
        on conflict (user_id, client_id) do update set role = excluded.role`;
    }
    result = { url: "", emailed: false, added: true };
  } else {
    const invite = await createInvite(m.org_id, m.org_name, email, "customer", ctx.user, base, rows[0].id, m.name);
    await sql`update invites set access_role = ${accessRole}, company_id = ${m.id} where org_id = ${m.org_id} and email = ${email} and role = 'customer'`;
    result = { ...invite, added: false };
  }
  await audit(ctx, "company.shared", { companyId: m.id, email, role: accessRole, summary: `Invited ${email} to ${m.name} (${accessRole})` }, { orgId: m.org_id });
  return { ...result, ...(await companyPeople(m, rows)) };
}

async function unshareCompany(ctx: Ctx, id: string, userId: string) {
  canManage(ctx);
  const m = await oneCompany(ctx, id);
  if (!UUID.test(userId)) throw new ValidationError("Unknown person.");
  await sql.begin(async (tx) => {
    await tx`delete from client_access a using clients c where c.id = a.client_id and c.company_id = ${m.id} and a.user_id = ${userId}`;
    const [left] = await tx`
      select 1 from client_access a join clients c on c.id = a.client_id where a.user_id = ${userId} and c.org_id = ${m.org_id} limit 1`;
    if (!left) {
      await tx`delete from memberships where org_id = ${m.org_id} and user_id = ${userId} and role = 'customer'`;
      await tx`delete from sessions where user_id = ${userId} and org_id = ${m.org_id}`;
    }
  });
  await audit(ctx, "company.unshared", { companyId: m.id, userId, summary: `Removed a customer from ${m.name}` }, { orgId: m.org_id });
  return companyPeople(m, await clientsInScope(m.org_id, null, m.id));
}

async function revokeCompanyInvite(ctx: Ctx, id: string, prefix: string) {
  canManage(ctx);
  const m = await oneCompany(ctx, id);
  if (!/^[a-f0-9]{16}$/.test(prefix)) throw new ValidationError("Unknown invite.");
  await sql`
    delete from invites i where i.org_id = ${m.org_id} and i.role = 'customer' and left(i.token_hash, 16) = ${prefix}
      and (i.company_id = ${m.id} or i.client_id in (select id from clients where company_id = ${m.id}))`;
  await audit(ctx, "company.invite_revoked", { companyId: m.id, summary: `Revoked an invite to ${m.name}` }, { orgId: m.org_id });
  return companyPeople(m, await clientsInScope(m.org_id, null, m.id));
}

async function companyBrand(ctx: Ctx, id: string, req: Request, method: string, kind: string | undefined) {
  const m = await oneCompany(ctx, id);
  const scope = { orgId: m.org_id, clientId: null, companyId: m.id };
  if (!kind && method === "GET") return ownBrand(scope);
  canManage(ctx);
  if (!kind && method === "PUT") {
    // Agency owners/admins (requireRole in brand.ts); the platform admin is an owner of their own org.
    await changeBrand({ ...ctx, role: ctx.user.platformAdmin ? "owner" : ctx.role }, scope, await readBody(req));
  } else if (kind && method === "POST") {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > 2_000_000) throw new ValidationError("That image is too big.");
    const bytes = new Uint8Array(await req.arrayBuffer());
    await uploadAsset({ ...ctx, role: ctx.user.platformAdmin ? "owner" : ctx.role }, scope, kind as "logo" | "background", bytes);
  } else return null;
  await audit(ctx, "company.branded", { companyId: m.id, summary: `Changed the branding of ${m.name}` }, { orgId: m.org_id });
  return ownBrand(scope);
}


// ---------------------------------------------------------------- onboarding links
// "Send the client an onboarding link": the company and a receptionist with sensible
// defaults are made now, and the client's own person is invited as a manager to finish
// setting it up in their workspace. The receptionist carries data.onboarding:
// "pending" until the client finishes ("done", set by the workspace), and the console
// shows "Waiting for client to finish setup" meanwhile.

export type ConsoleDeps = { createClient: (orgId: string, input: unknown, opts?: { quick?: boolean }) => Promise<Receptionist> };

/** Still waiting for the client (clients.data.onboarding, shared with the workspace's /app/onboarding wizard). */
export const onboardingPending = (c: Receptionist) => c.onboarding === "pending";

async function quickReceptionist(ctx: Ctx, deps: ConsoleDeps, m: CompanyRow): Promise<string> {
  const key = (INDUSTRIES.some((i) => i.key === m.industry) ? m.industry : "other") as IndustryKey;
  const created = await deps.createClient(m.org_id, { businessName: m.name, industry: key, services: [...industry(key).services], defaultVoice: true }, { quick: true });
  await sql`
    update clients set company_id = ${m.id}, data = jsonb_set(data, '{onboarding}', '"pending"')
    where id = ${created.id} and org_id = ${m.org_id}`;
  await audit(ctx, "receptionist.create", { business: m.name, companyId: m.id, summary: `Made a receptionist for ${m.name} (client to finish setup)` }, { orgId: m.org_id, clientId: created.id });
  return created.id;
}

async function sendOnboarding(ctx: Ctx, deps: ConsoleDeps, companyId: string | null, input: any, base: string) {
  canManage(ctx);
  const email = emailOf(input?.email);
  const id = companyId ?? (await createCompany(ctx, input));
  const m = await oneCompany(ctx, id);
  const rows = await clientsInScope(m.org_id, null, m.id);
  if (!rows.length) {
    try {
      await quickReceptionist(ctx, deps, m);
    } catch (err) {
      // Don't leave an empty client behind when it was made just now.
      if (!companyId) await sql`delete from companies where id = ${m.id} and not exists (select 1 from clients where company_id = ${m.id})`;
      throw err;
    }
  }
  const shared = await shareCompany(ctx, m.id, { email, role: "manager" }, base);
  await audit(ctx, "company.onboarding_sent", { companyId: m.id, email, summary: `Sent ${email} an onboarding link for ${m.name}` }, { orgId: m.org_id });
  return { id: m.id, url: shared.url, emailed: shared.emailed, added: shared.added };
}

// ---------------------------------------------------------------- dispatch

export async function consoleRoutes({ req, url, path, method, ctx, appUrl }: RouteArgs, deps: ConsoleDeps): Promise<Response | null> {
  const rest = path.slice("/api/console".length) || "/";
  const get = method === "GET" || method === "HEAD";

  if (get) {
    if (rest === "/overview") return json(await overview(ctx));
    if (rest === "/calls") return json({ calls: await calls(ctx, url) });
    const call = rest.match(/^\/calls\/([^/]+)$/);
    if (call) return json({ call: await callDetail(ctx, call[1]) });
    if (rest === "/bookings-leads") return json(await bookingsLeads(ctx, url));
    if (rest === "/activity") return json(await activity(ctx));
    if (rest === "/system") return json(await system(ctx));
    if (rest === "/businesses") return json({ businesses: await businesses(ctx) });
    if (rest === "/companies") return json({ companies: await companies(ctx) });
    const co = rest.match(/^\/companies\/([^/]+)$/);
    if (co) return json(await companyDetail(ctx, co[1]));
    const coBrand = rest.match(/^\/companies\/([^/]+)\/brand$/);
    if (coBrand) return json(await companyBrand(ctx, coBrand[1], req, method, undefined));
    const biz = rest.match(/^\/businesses\/([^/]+)$/);
    if (biz) return json(await businessDetail(ctx, biz[1]));
    if (rest === "/receptionists") return json({ agents: (await clientsInScope(scopeOf(ctx))).map(agentRow) });
    if (rest === "/numbers") return json({ numbers: await numbers(ctx) });
    if (rest === "/number-requests") return json({ requests: await numberRequests(ctx) });
    if (rest === "/usage") return json(await usage(ctx, url));
    if (rest === "/audit") {
      const clientId = url.searchParams.get("business");
      if (clientId) await oneClient(ctx, clientId);
      return json({ audit: await auditRows(ctx, 500, clientId) });
    }
    if (rest === "/platform-admins") {
      onlyPlatform(ctx);
      return json({ admins: await platformAdmins() });
    }
    return null;
  }

  if (rest === "/onboarding" && method === "POST") return json(await sendOnboarding(ctx, deps, null, await readBody(req), appUrl), 201);
  if (rest === "/companies" && method === "POST") {
    const id = await createCompany(ctx, await readBody(req));
    return json({ id }, 201);
  }
  const company = rest.match(/^\/companies\/([^/]+)(\/.*)?$/);
  if (company) {
    const [, id, sub = ""] = company;
    if (sub === "" && method === "PUT") {
      await updateCompany(ctx, id, await readBody(req));
      return json(await companyDetail(ctx, id));
    }
    if (sub === "/status" && method === "PUT") {
      await setCompanyPaused(ctx, id, await readBody(req));
      return json(await companyDetail(ctx, id));
    }
    if (sub === "/receptionists" && method === "POST") {
      await attachReceptionist(ctx, id, await readBody(req));
      return json(await companyDetail(ctx, id));
    }
    if (sub === "/members" && method === "POST") return json(await shareCompany(ctx, id, await readBody(req), appUrl), 201);
    if (sub === "/onboarding" && method === "POST") return json(await sendOnboarding(ctx, deps, id, await readBody(req), appUrl), 201);
    const member = sub.match(/^\/members\/([^/]+)$/);
    if (member && method === "DELETE") return json(await unshareCompany(ctx, id, member[1]));
    const invite = sub.match(/^\/invites\/([^/]+)$/);
    if (invite && method === "DELETE") return json(await revokeCompanyInvite(ctx, id, invite[1]));
    const brand = sub.match(/^\/brand(?:\/(logo|background))?$/);
    if (brand) {
      const out = await companyBrand(ctx, id, req, method, brand[1]);
      return out ? json(out, brand[1] ? 201 : 200) : null;
    }
    return null;
  }
  const biz = rest.match(/^\/businesses\/([^/]+)(\/.*)?$/);
  if (biz) {
    const [, id, sub = ""] = biz;
    if (sub === "" && method === "PUT") {
      await setPaused(ctx, id, await readBody(req));
      return json(await businessDetail(ctx, id));
    }
    if (sub === "/members" && method === "POST") return json(await share(ctx, id, await readBody(req), appUrl), 201);
    const member = sub.match(/^\/members\/([^/]+)$/);
    if (member && method === "DELETE") return json(await unshare(ctx, id, member[1]));
    const invite = sub.match(/^\/invites\/([^/]+)$/);
    if (invite && method === "DELETE") return json(await revokeShare(ctx, id, invite[1]));
    if (sub === "/number-requests" && method === "POST") return json({ request: await requestNumber(ctx, id, await readBody(req), appUrl) }, 201);
    return null;
  }
  if (rest === "/incidents" && method === "POST") {
    await logIncident(ctx, await readBody(req));
    return json(await system(ctx), 201);
  }
  const inc = rest.match(/^\/incidents\/([^/]+)\/resolve$/);
  if (inc && method === "POST") {
    await resolveIncident(ctx, inc[1]);
    return json(await system(ctx));
  }
  if (rest === "/platform-admins" && method === "POST") {
    await grantPlatformAdmin(ctx, await readBody(req));
    return json({ admins: await platformAdmins() }, 201);
  }
  const pa = rest.match(/^\/platform-admins\/([^/]+)$/);
  if (pa && method === "DELETE") {
    await revokePlatformAdmin(ctx, pa[1]);
    return json({ admins: await platformAdmins() });
  }
  return null;
}
