import type { Business as Receptionist, CallMessage } from "../../src/lib/shared";
import { formatNumber } from "../../src/lib/shared";
import { AuthError, createInvite, emailOf, requireRole, type Ctx } from "../accounts";
import { answeredBusiness } from "../answered";
import { audit } from "../audit";
import { iso, sql } from "../db";
import { createRequest } from "../numberRequests";
import { callSummary } from "../numbers";
import { ValidationError } from "../prompt";
import { demoCallDetail, isDemo } from "../sandbox";
import { runAsOrg, telnyx } from "../telnyx";
import { json, readBody, type RouteArgs } from "./http";

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
};

async function clientsInScope(scope: string | null, id: string | null = null): Promise<ClientRow[]> {
  return (await sql`
    select c.id, c.data, c.org_id, c.paused_at, c.created_at, o.name as org_name, o.sandbox, o.direct, o.suspended_at
    from clients c join orgs o on o.id = c.org_id
    where (${scope}::uuid is null or c.org_id = ${scope}::uuid)
      and (${id}::uuid is null or c.id = ${id}::uuid)
    order by c.created_at desc`) as ClientRow[];
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
});

function businessRow(c: ClientRow) {
  const b = answeredBusiness({ ...c.data, id: c.id }, { orgId: c.org_id, orgName: c.org_name, sandbox: Boolean(c.sandbox), suspended: Boolean(c.suspended_at) });
  return {
    ...b,
    status: statusOf(c),
    paused_at: c.paused_at ? iso(c.paused_at) : null,
    agency_paused: Boolean(c.suspended_at),
    org_direct: Boolean(c.direct),
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
    businesses: c.businesses,
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

// ---------------------------------------------------------------- dispatch

export async function consoleRoutes({ req, url, path, method, ctx, appUrl }: RouteArgs): Promise<Response | null> {
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
