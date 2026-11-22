import { DAYS, TIMEZONES, formatNumber, type Business, type DayKey, type Hours, type Settings, type Voice } from "../../src/lib/shared";
import { createInvite, emailOf, type Ctx } from "../accounts";
import { answeredBusiness, industryKeyOf, membershipRole } from "../answered";
import { audit } from "../audit";
import { availability, bookingLive } from "../booking";
import { CalendarError, calendarLink, providerOf } from "../calendars";
import { dashboardSignInStart } from "../connect";
import { iso, sql } from "../db";
import { checkEmail, connectEmail, disconnectEmail, emailStatus } from "../email";
import { recordIncident } from "../incidents";
import { webhookSecret } from "../notify";
import { createRequest, requestsForClient } from "../numberRequests";
import { ValidationError } from "../prompt";
import { isDemo } from "../sandbox";
import { getClient, orgOfClient, saveClient } from "../store";
import { json, readBody, type ClientAccess, type ClientRouteArgs } from "./http";

// Area S (workspace, manage): receptionist settings, knowledge, call handling,
// integrations, team and the business profile, for one business.
// Paths: /api/manage/<clientId>/... The dispatcher in server/index.ts has already
// resolved args.client and args.access, refused viewers anything but GET/HEAD and
// refused every write while the platform team is viewing as someone. Each write here
// checks again (canWrite) so a change in the dispatcher can't open it up.
//
// Responses use Answered's row shapes (src/lib/app/types.ts), wrapped in a named key.

// ---- Plumbing from server/index.ts (registered once at start-up) ----

export type ManageDeps = {
  /** Saves new settings and pushes them to the phone provider (demo receptionists only save). */
  updateClient: (existing: Business, settings: unknown) => Promise<Business>;
  /** Rebuilds the instructions (with knowledge) and pushes them and the tools. */
  syncAssistant: (client: Business) => Promise<Business>;
  setUpBooking: (client: Business, input: unknown) => Promise<Business>;
  changeBooking: (client: Business, input: unknown) => Promise<Business>;
  removeBooking: (client: Business) => Promise<Business>;
  loadVoices: () => Promise<Voice[]>;
  nextOpenDate: (client: Business) => string;
};

let deps: ManageDeps | null = null;
export function setManageDeps(d: ManageDeps): void {
  deps = d;
}
function need(): ManageDeps {
  if (!deps) throw new Error("manage routes used before setManageDeps");
  return deps;
}

const canWrite = (a: ClientAccess | null) => a === "manager" || a === "staff" || a === "platform";
const forbidden = () => json({ error: "Your access to this business is view-only. Ask a manager to change it." }, 403);

// ---- Shapes (contract §7) ----

async function orgInfo(orgId: string) {
  const [o] = await sql`select id, name, sandbox, suspended_at, direct from orgs where id = ${orgId}`;
  return { id: orgId, name: (o?.name as string) ?? "", sandbox: Boolean(o?.sandbox), suspended: Boolean(o?.suspended_at), direct: Boolean(o?.direct) };
}

// A3
function answeredVoice(v: Voice) {
  return {
    id: v.id,
    provider_voice_id: v.id,
    display_name: v.name,
    description: v.label || null,
    style: v.label || null,
    gender: v.gender || null,
    accent: "Australian",
    language: "en-AU",
    provider: "telnyx" as const,
    status: "active",
    client_visible: true,
    preview_url: null,
    recommended: v.recommended,
    created_at: "",
    updated_at: "",
  };
}

async function voicesSafe(): Promise<Voice[]> {
  try {
    return await need().loadVoices();
  } catch (err) {
    console.error("[manage voices]", (err as Error).message);
    return [];
  }
}

// A2: one receptionist is one Answered agent.
async function answeredAgent(c: Business, paused: boolean, voices?: Voice[]) {
  const s = c.settings;
  const list = voices ?? (await voicesSafe());
  const v = list.find((x) => x.id === s.voiceId);
  const live = bookingLive(c);
  const now = iso(c.updatedAt);
  return {
    id: c.id,
    business_id: c.id,
    name: s.receptionistName || "Receptionist",
    status: paused ? "paused" : "active",
    greeting: s.greeting,
    tone: s.tone,
    business_context: s.notes || null,
    voice_id: s.voiceId || null,
    voice: v ? answeredVoice(v) : s.voiceName ? { ...answeredVoice({ id: s.voiceId, name: s.voiceName, label: "", gender: "", recommended: false }) } : null,
    voice_config: null,
    language: "en-AU",
    accent: "Australian",
    speaking_speed: 1,
    provider: "telnyx",
    provider_agent_id: isDemo(c.assistantId) ? null : c.assistantId,
    provider_config_id: null,
    llm_model: null,
    fallback_model: null,
    temperature: null,
    latency_settings: {},
    routing_status: (c.phoneNumbers ?? []).length > 0 ? "live" : "not_connected",
    last_published_at: now,
    system_prompt: null,
    booking_rules: {
      enabled: c.booking?.enabled ?? false,
      configured: Boolean(c.booking),
      services: s.services,
      default_duration_minutes: c.booking?.minutes ?? 30,
      buffer_minutes: 0,
      max_days_ahead: 14,
      allow_new_patients: true,
    },
    escalation_rules: { transfer_on_request: false, escalate_on_negative_sentiment: false, notify_email: c.booking?.notifyEmail ?? "", notify_sms: "" },
    tool_permissions: ["end_call", ...(live ? ["lookup_availability", "book_appointment", "take_message"] : [])],
    transfer_rules: [],
    qualification_questions: [],
    restricted_topics: [],
    transfer_number: null,
    after_hours_message: null,
    personality: null,
    business_hours_behaviour: { mode: "always_on" },
    voicemail_behaviour: { mode: "take_message" },
    interruption_settings: { allow_barge_in: true },
    max_duration_seconds: null,
    created_at: iso(c.createdAt),
    updated_at: now,
    // Ours: a demo receptionist never reaches the phone provider.
    demo: isDemo(c.assistantId),
  };
}

// A4
async function answeredNumbers(c: Business) {
  const [degraded] = await sql`select 1 from incidents where client_id = ${c.id} and kind = 'call_sync' and status = 'open' limit 1`;
  const agent = { id: c.id, name: c.settings.receptionistName || "Receptionist" };
  const rows: any[] = (c.phoneNumbers ?? []).map((e164) => ({
    id: e164,
    provider_number_id: e164,
    e164,
    friendly_name: formatNumber(e164),
    business_id: c.id,
    agent_id: c.id,
    agent,
    status: "active",
    routing_mode: "ai_receptionist",
    capabilities: { voice: true, sms: e164.startsWith("+614") },
    country: "AU",
    provider: "telnyx",
    health: degraded ? "degraded" : "healthy",
    last_health_check_at: iso(c.updatedAt),
    forward_to: null,
    fallback_number: null,
    monthly_usage_minutes: 0,
    is_outbound_caller_id: false,
    business_hours: {},
    notes: null,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  }));
  for (const r of await requestsForClient(c.id)) {
    if (r.status !== "pending") continue;
    rows.push({
      id: r.id,
      provider_number_id: null,
      e164: "",
      friendly_name: `Requested ${r.type === "mobile" ? "mobile" : "local"} number`,
      business_id: c.id,
      agent_id: c.id,
      agent,
      status: "pending",
      routing_mode: "ai_receptionist",
      capabilities: { voice: true, sms: r.type === "mobile" },
      country: "AU",
      provider: "telnyx",
      health: "unknown",
      last_health_check_at: null,
      forward_to: null,
      fallback_number: null,
      monthly_usage_minutes: 0,
      is_outbound_caller_id: false,
      business_hours: {},
      notes: r.note || null,
      created_at: r.createdAt,
      updated_at: r.createdAt,
    });
  }
  return rows;
}

// A9
const QA = new Set(["faq", "custom_qa"]);
const KINDS = ["faq", "service", "pricing", "policy", "location", "fact", "custom_qa"];
function answeredKnowledge(r: any) {
  const qa = QA.has(r.kind);
  return {
    id: r.id,
    business_id: r.client_id,
    title: r.question,
    type: r.kind,
    question: qa ? r.question : null,
    answer: qa ? r.answer : null,
    content: qa ? null : r.answer,
    url: null,
    tags: [] as string[],
    status: r.status,
    source: "manual",
    metadata: {},
    created_by: null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

// A11: the integrations this receptionist has.
async function answeredIntegrations(c: Business, access: ClientAccess | null) {
  const out: any[] = [];
  const base = (provider: string, display_name: string, extra: Record<string, unknown>) => ({
    id: provider,
    business_id: c.id,
    provider,
    display_name,
    connected_by: null,
    created_at: c.booking?.createdAt ?? iso(c.createdAt),
    last_sync_at: null,
    last_error: null,
    ...extra,
  });
  const b = c.booking;
  if (b) {
    const provider = providerOf(c);
    if (provider === "builtin") {
      out.push(
        base("builtin_calendar", "Answered calendar", {
          status: b.enabled ? "connected" : "not_connected",
          config: { default_duration: b.minutes, account_email: b.notifyEmail ?? "", enabled: b.enabled },
          connected_at: b.createdAt,
          updated_at: b.createdAt,
        }),
      );
    } else {
      const link = await calendarLink(c.id);
      const id = provider === "google" ? "google_calendar" : "microsoft_calendar";
      out.push(
        base(id, provider === "google" ? "Google Calendar" : "Microsoft Outlook Calendar", {
          status: link && link.provider === provider ? (link.lastError ? "error" : "connected") : "not_connected",
          config: { account_email: link?.account ?? "", default_duration: b.minutes, notify_email: b.notifyEmail ?? "", enabled: b.enabled },
          connected_at: link?.connectedAt || null,
          last_error: link?.lastError || null,
          updated_at: link?.connectedAt || b.createdAt,
        }),
      );
    }
    if (b.leadWebhook) {
      out.push(
        base("webhook", "Webhook / custom CRM", {
          status: "connected",
          // The signing secret is for people who can change the integration.
          config: { endpoint_url: b.leadWebhook, ...(canWrite(access) ? { signing_secret: webhookSecret(b.token) } : {}) },
          connected_at: b.createdAt,
          updated_at: b.createdAt,
        }),
      );
    }
  }
  const mail = await emailStatus(c.id);
  if (mail.connected) {
    out.push(
      base("email_mailbox", "Email inbox", {
        status: mail.lastError ? "error" : "connected",
        config: { account_email: mail.address, mode: mail.mode },
        connected_at: mail.connectedAt || null,
        last_sync_at: mail.lastCheckedAt || null,
        last_error: mail.lastError || null,
        updated_at: mail.lastCheckedAt || mail.connectedAt || iso(c.updatedAt),
      }),
    );
  }
  return out;
}

const calendarIntegrationId = (c: Business) =>
  !c.booking ? null : providerOf(c) === "builtin" ? "builtin_calendar" : providerOf(c) === "google" ? "google_calendar" : "microsoft_calendar";

// A11b
async function answeredIntegrationEvents(c: Business) {
  const events: any[] = [];
  const cal = calendarIntegrationId(c);
  const integrationFor = (kind: string) =>
    kind.startsWith("email") ? { id: "email_mailbox", provider: "email_mailbox", display_name: "Email inbox" }
    : kind.startsWith("hook") ? { id: "webhook", provider: "webhook", display_name: "Webhook / custom CRM" }
    : cal ? { id: cal, provider: cal, display_name: cal === "builtin_calendar" ? "Answered calendar" : cal === "google_calendar" ? "Google Calendar" : "Microsoft Outlook Calendar" }
    : null;
  const incidents = await sql`
    select id, kind, message, status, created_at from incidents
    where client_id = ${c.id} and (kind like 'calendar%' or kind like 'email%' or kind like 'hook%')
    order by created_at desc limit 50`;
  for (const i of incidents as any[]) {
    const integration = integrationFor(i.kind);
    events.push({
      id: i.id,
      business_id: c.id,
      integration_id: integration?.id ?? "",
      integration,
      type: `integration.${i.kind}`,
      severity: i.status === "open" ? "error" : "info",
      message: i.message,
      payload: {},
      occurred_at: iso(i.created_at),
      created_at: iso(i.created_at),
    });
  }
  const mail = await emailStatus(c.id);
  for (const a of mail.activity ?? []) {
    events.push({
      id: `mail-${a.id}`,
      business_id: c.id,
      integration_id: "email_mailbox",
      integration: { id: "email_mailbox", provider: "email_mailbox", display_name: "Email inbox" },
      type: `integration.email_${a.action}`,
      severity: a.action === "failed" ? "error" : "info",
      message: `${a.subject || "(no subject)"} from ${a.from}${a.note ? ` (${a.note})` : ""}`,
      payload: {},
      occurred_at: a.receivedAt,
      created_at: a.receivedAt,
    });
  }
  const failed = await sql`
    select data from booking_requests where client_id = ${c.id} and data->>'status' = 'failed' order by id desc limit 30`;
  for (const r of failed as any[]) {
    const d = r.data;
    const integration = integrationFor("calendar");
    events.push({
      id: `booking-${d.id}`,
      business_id: c.id,
      integration_id: integration?.id ?? "",
      integration,
      type: "calendar.booking_failed",
      severity: "error",
      message: d.note || "A booking couldn't be made.",
      payload: {},
      occurred_at: d.at,
      created_at: d.at,
    });
  }
  events.sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  return events.slice(0, 100);
}

// A10
async function answeredTeam(clientId: string) {
  const people = await sql`
    select a.user_id, a.role, a.created_at, u.email, u.name from client_access a join users u on u.id = a.user_id
    where a.client_id = ${clientId} order by a.created_at`;
  const invites = await sql`
    select token_hash, email, access_role, invited_by, expires_at, created_at from invites
    where client_id = ${clientId} and role = 'customer' and expires_at > now() order by created_at desc`;
  return {
    members: people.map((p: any) => ({
      id: `${p.user_id}:${clientId}`,
      business_id: clientId,
      user_id: p.user_id,
      role: membershipRole(p.role),
      access_role: p.role,
      invited_by: null,
      created_at: iso(p.created_at),
      updated_at: iso(p.created_at),
      profile: { id: p.user_id, email: p.email, full_name: p.name || null, avatar_url: null },
    })),
    invitations: invites.map((i: any) => ({
      id: i.token_hash.slice(0, 16),
      business_id: clientId,
      email: i.email,
      role: membershipRole(i.access_role ?? "viewer"),
      access_role: i.access_role ?? "viewer",
      status: "pending",
      expires_at: iso(i.expires_at),
      created_at: iso(i.created_at),
      updated_at: iso(i.created_at),
      token: "",
      invited_by: i.invited_by,
      accepted_at: null,
    })),
  };
}

// A12
const humanize = (s: string) => s.replace(/[._]+/g, " ").replace(/^\w/, (m) => m.toUpperCase());
async function answeredAudit(clientId: string) {
  const rows = await sql`
    select l.id, l.client_id, l.actor, l.action, l.detail, l.created_at, u.email
    from audit_log l left join users u on u.id = l.actor
    where l.client_id = ${clientId} order by l.created_at desc limit 500`;
  return rows.map((r: any) => ({
    id: r.id,
    business_id: r.client_id,
    actor_id: r.actor,
    actor_email: r.email ?? null,
    action: r.action,
    entity_type: String(r.action).split(".")[0],
    entity_id: r.detail?.id ?? null,
    summary: r.detail?.summary ?? humanize(r.action),
    metadata: r.detail ?? {},
    created_at: iso(r.created_at),
    business: null,
  }));
}

// S13: one record per day per kind from call_log, last 90 days.
async function answeredUsage(clientId: string) {
  const rows = await sql`
    select date_trunc('day', started_at) as day,
      ceil(coalesce(sum(duration_seconds) filter (where channel not like 'sms%'), 0) / 60.0)::int as minutes,
      count(*) filter (where channel like 'sms%')::int as texts
    from call_log where client_id = ${clientId} and channel <> 'web' and started_at > now() - interval '90 days'
    group by 1 order by 1`;
  const out: any[] = [];
  for (const r of rows as any[]) {
    const start = new Date(r.day);
    const end = new Date(start.getTime() + 86_400_000);
    const rec = (kind: string, quantity: number, unit: string) => ({
      id: `${kind}-${start.toISOString().slice(0, 10)}`,
      business_id: clientId,
      call_id: null,
      kind,
      quantity,
      unit,
      metadata: {},
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      created_at: end.toISOString(),
    });
    if (r.minutes > 0) out.push(rec("call_minutes", r.minutes, "minute"));
    if (r.texts > 0) out.push(rec("sms", r.texts, "conversation"));
  }
  return out;
}

// ---- Reverse adapters (A15, A16) ----

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function hoursFrom(input: unknown, current: Hours): Hours {
  const src = (input ?? {}) as Record<string, { open?: unknown; close?: unknown; closed?: unknown }>;
  const out = { ...current };
  for (const d of DAYS) {
    const v = src[d.key];
    if (!v || typeof v !== "object") continue;
    const from = typeof v.open === "string" && TIME.test(v.open) ? v.open : current[d.key as DayKey].from;
    const to = typeof v.close === "string" && TIME.test(v.close) ? v.close : current[d.key as DayKey].to;
    if (!v.closed && from >= to) throw new ValidationError(`${d.label}: the closing time must be after the opening time.`);
    out[d.key as DayKey] = { open: !v.closed, from, to };
  }
  return out;
}

function timezoneOf(value: unknown): string {
  const tz = String(value ?? "");
  if (!TIMEZONES.some((t) => t.value === tz)) throw new ValidationError("Choose an Australian time zone from the list.");
  return tz;
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

// Business details shared by the receptionist editor and Settings.
function applyBusiness(s: Settings, b: any): Settings {
  const next = { ...s };
  if (!b || typeof b !== "object") return next;
  if (b.name !== undefined) next.businessName = str(b.name, 80);
  if (b.industry !== undefined) next.industry = industryKeyOf(b.industry);
  if (b.city !== undefined) next.suburb = str(b.city, 60);
  if (b.address_line1 !== undefined) next.address = str(b.address_line1, 140);
  if (b.timezone !== undefined) next.timezone = timezoneOf(b.timezone);
  if (b.business_hours !== undefined) next.hours = hoursFrom(b.business_hours, s.hours);
  return next;
}

const MINUTES = [15, 20, 30, 45, 60, 90];

// ---- Handler ----

export async function manageRoutes(args: ClientRouteArgs): Promise<Response | null> {
  const { client, clientOrgId, access, method, rest, req, ctx } = args;
  // "Create a business" from the workspace (POST /api/manage) is hidden in v1 (contract S17).
  if (!client || !clientOrgId) return null;
  const write = method !== "GET" && method !== "HEAD";
  if (write && !canWrite(access)) return forbidden();
  const where = { orgId: clientOrgId, clientId: client.id };
  const org = await orgInfo(clientOrgId);
  const paused = org.suspended;
  const d = need();

  // ---- Receptionist (S1, S2) and voices (S18) ----
  if (rest === "/receptionist") {
    if (method === "GET") return json({ agents: [await answeredAgent(client, paused)] });
    if (method === "PUT") {
      const body = await readBody(req);
      const current = await answeredAgent(client, paused);
      if (body.status !== undefined && body.status !== current.status) {
        throw new ValidationError("Pausing a receptionist is done by your agency or the platform team.");
      }
      let s: Settings = { ...client.settings };
      if (body.name !== undefined) s.receptionistName = str(body.name, 30);
      if (body.greeting !== undefined) s.greeting = str(body.greeting, 300);
      if (body.tone !== undefined) s.tone = ["professional", "direct", "calm"].includes(body.tone) ? "professional" : "friendly";
      if (body.business_context !== undefined) s.notes = String(body.business_context ?? "").slice(0, 1500);
      if (body.voice_id !== undefined && body.voice_id !== null) s.voiceId = String(body.voice_id);
      const rules = body.booking_rules && typeof body.booking_rules === "object" ? body.booking_rules : null;
      if (rules && Array.isArray(rules.services)) s.services = rules.services.map((x: unknown) => str(x, 60)).filter(Boolean);
      s = applyBusiness(s, { ...(body.business ?? {}), ...(body.business_hours !== undefined ? { business_hours: body.business_hours } : {}) });

      const changed = JSON.stringify(s) !== JSON.stringify(client.settings);
      let next = changed ? await d.updateClient(client, s) : client;
      const fields: string[] = changed ? Object.keys(s).filter((k) => JSON.stringify((s as any)[k]) !== JSON.stringify((client.settings as any)[k])) : [];

      // Booking length, on/off and the notice email live on the calendar setup.
      if (next.booking) {
        const change: Record<string, unknown> = {};
        if (rules?.default_duration_minutes !== undefined && Number(rules.default_duration_minutes) !== next.booking.minutes) {
          if (!MINUTES.includes(Number(rules.default_duration_minutes))) throw new ValidationError("Choose an appointment length from the list.");
          change.minutes = Number(rules.default_duration_minutes);
        }
        if (typeof rules?.enabled === "boolean" && rules.enabled !== next.booking.enabled) change.enabled = rules.enabled;
        const notify = body.escalation_rules?.notify_email;
        if (typeof notify === "string" && notify.trim() !== (next.booking.notifyEmail ?? "")) change.notifyEmail = notify;
        if (Object.keys(change).length > 0) {
          next = await d.changeBooking(next, change);
          fields.push(...Object.keys(change).map((k) => `booking.${k}`));
        }
      }
      if (fields.length > 0) await audit(ctx, "receptionist.updated", { summary: `Receptionist settings changed (${fields.join(", ")})`, fields }, where);
      return json({ agent: await answeredAgent(next, paused), applied: !isDemo(next.assistantId), demo: isDemo(next.assistantId), changed: fields });
    }
  }
  if (rest === "/voices" && method === "GET") return json({ voices: (await voicesSafe()).map(answeredVoice) });

  // ---- Call handling (S4, S4c) ----
  if (rest === "/phone-numbers" && method === "GET") return json({ numbers: await answeredNumbers(client) });
  if (rest === "/number-requests" && method === "POST") {
    const body = await readBody(req);
    // Filed in the business's own org, also when the platform team acts from another.
    const asOrg: Ctx = { ...ctx, org: { id: clientOrgId, name: org.name } };
    const r = await createRequest(asOrg, client.id, client.settings.businessName, body, args.appUrl);
    await audit(ctx, "number.requested", { summary: `Requested a ${r.type} number`, id: r.id, type: r.type }, where);
    return json({ request: r, numbers: await answeredNumbers(client) }, 201);
  }

  // ---- Knowledge (S5) ----
  if (rest === "/knowledge") {
    if (method === "GET") {
      const rows = await sql`select * from knowledge_items where client_id = ${client.id} order by updated_at desc`;
      return json({ items: rows.map(answeredKnowledge) });
    }
    if (method === "POST") {
      const item = knowledgeInput(await readBody(req), null);
      const [{ n }] = await sql`select count(*)::int as n from knowledge_items where client_id = ${client.id}`;
      if (n >= 200) throw new ValidationError("That's the most knowledge items one receptionist can hold. Remove some first.");
      const [row] = await sql`
        insert into knowledge_items (client_id, question, answer, enabled, kind, status)
        values (${client.id}, ${item.question}, ${item.answer}, ${item.status === "published"}, ${item.kind}, ${item.status}) returning *`;
      const synced = await resync(client, d);
      await audit(ctx, "knowledge.created", { summary: `Added knowledge: ${item.question.slice(0, 80)}`, id: row.id }, where);
      return json({ item: answeredKnowledge(row), ...synced }, 201);
    }
  }
  const one = rest.match(/^\/knowledge\/([a-f0-9-]{36})$/);
  if (one) {
    const [existing] = await sql`select * from knowledge_items where id = ${one[1]} and client_id = ${client.id}`;
    if (!existing) return json({ error: "That knowledge item no longer exists." }, 404);
    if (method === "PATCH" || method === "PUT") {
      const item = knowledgeInput(await readBody(req), existing);
      const [row] = await sql`
        update knowledge_items set question = ${item.question}, answer = ${item.answer}, enabled = ${item.status === "published"},
          kind = ${item.kind}, status = ${item.status}, updated_at = now()
        where id = ${existing.id} and client_id = ${client.id} returning *`;
      const synced = await resync(client, d);
      await audit(ctx, "knowledge.updated", { summary: `Updated knowledge: ${item.question.slice(0, 80)}`, id: row.id }, where);
      return json({ item: answeredKnowledge(row), ...synced });
    }
    if (method === "DELETE") {
      await sql`delete from knowledge_items where id = ${existing.id} and client_id = ${client.id}`;
      const synced = await resync(client, d);
      await audit(ctx, "knowledge.deleted", { summary: `Removed knowledge: ${String(existing.question).slice(0, 80)}`, id: existing.id }, where);
      return json({ ok: true, ...synced });
    }
  }

  // ---- Integrations (S7, S8, S9) ----
  if (rest === "/integrations" && method === "GET") return json({ integrations: await answeredIntegrations(client, access) });
  if (rest === "/integration-events" && method === "GET") return json({ events: await answeredIntegrationEvents(client) });
  if (rest === "/calendar") {
    if (method === "GET") {
      const b = client.booking;
      return json({
        calendar: b
          ? {
              provider: providerOf(client),
              minutes: b.minutes,
              enabled: b.enabled,
              notifyEmail: b.notifyEmail ?? "",
              leadWebhook: b.leadWebhook ?? "",
              live: bookingLive(client),
              link: providerOf(client) === "builtin" ? null : await calendarLink(client.id),
            }
          : null,
        integrations: await answeredIntegrations(client, access),
      });
    }
    let next: Business;
    let action: string;
    if (method === "POST") {
      const body = await readBody(req);
      next = await d.setUpBooking(client, body);
      action = `integration.${calendarIntegrationId(next)}.connected`;
      await audit(ctx, action, { summary: `Set up bookings with ${providerOf(next) === "builtin" ? "the built-in calendar" : providerOf(next) === "google" ? "Google Calendar" : "Outlook"}` }, where);
    } else if (method === "PUT") {
      const body = await readBody(req);
      const input: Record<string, unknown> = {};
      for (const k of ["minutes", "enabled", "notifyEmail", "leadWebhook"]) if (body[k] !== undefined) input[k] = body[k];
      if (!client.booking) throw new ValidationError(input.leadWebhook !== undefined ? "Set up bookings first: the webhook sends each booking and callback." : "Set up a calendar first.");
      next = await d.changeBooking(client, input);
      const hook = input.leadWebhook !== undefined;
      action = hook ? (String(input.leadWebhook ?? "") ? "integration.webhook.saved" : "integration.webhook.removed") : `integration.${calendarIntegrationId(next)}.updated`;
      await audit(ctx, action, { summary: hook ? (String(input.leadWebhook ?? "") ? "Lead webhook saved" : "Lead webhook removed") : `Booking settings changed (${Object.keys(input).join(", ")})` }, where);
    } else if (method === "DELETE") {
      if (!client.booking) throw new ValidationError("There's no calendar to remove.");
      const was = calendarIntegrationId(client);
      next = await d.removeBooking(client);
      await audit(ctx, `integration.${was}.removed`, { summary: "Calendar removed; the receptionist takes messages instead" }, where);
    } else {
      return null;
    }
    return json({ integrations: await answeredIntegrations(next, access) }, method === "POST" ? 201 : 200);
  }
  if (rest === "/calendar/test" && method === "POST") {
    if (!client.booking) throw new ValidationError("Set up a calendar first.");
    const date = d.nextOpenDate(client);
    try {
      return json({ date, result: await availability(client, { date }) });
    } catch (err) {
      if (err instanceof CalendarError) throw new ValidationError(err.message);
      throw err;
    }
  }
  const signin = rest.match(/^\/calendar\/signin\/(google|microsoft)$/);
  if (signin && method === "GET") {
    // A link the browser follows, so errors go back to the page rather than as JSON.
    // GET, so check the write permission here too.
    const back = args.url.searchParams.get("return") === "admin" ? `/admin/clients/${client.id}` : "/app/integrations";
    const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } });
    if (!canWrite(access) || ctx.viewing) return redirect(`${back}?error=${encodeURIComponent("Your access to this business is view-only.")}`);
    try {
      return redirect(await dashboardSignInStart(signin[1] as "google" | "microsoft", clientOrgId, client, back));
    } catch (err) {
      return redirect(`${back}?error=${encodeURIComponent((err as Error).message)}`);
    }
  }
  if (rest === "/email") {
    if (method === "GET") {
      const s = await emailStatus(client.id);
      // Only people who can change it see the mail itself.
      return json(canWrite(access) ? s : { ...s, activity: [] });
    }
    if (method === "PUT") {
      const s = await connectEmail(client.id, await readBody(req));
      await audit(ctx, "integration.email_mailbox.connected", { summary: `Email inbox ${s.address} connected` }, where);
      return json(s);
    }
    if (method === "DELETE") {
      await disconnectEmail(client.id);
      await audit(ctx, "integration.email_mailbox.removed", { summary: "Email inbox disconnected" }, where);
      return json(await emailStatus(client.id));
    }
  }
  if (rest === "/email/check" && method === "POST") return json(await checkEmail(client));

  // ---- Team (S10, S11) ----
  if (rest === "/team" && method === "GET") return json(await answeredTeam(client.id));
  if (rest === "/team/invites" && method === "POST") {
    const body = await readBody(req);
    const result = await inviteToBusiness(args, org, body?.email, accessRoleOf(body?.role));
    await audit(ctx, "team.invited", { summary: `Invited ${result.email} as ${result.accessRole}`, email: result.email, role: result.accessRole }, where);
    return json({ ...result, team: await answeredTeam(client.id) }, 201);
  }
  const inv = rest.match(/^\/team\/invites\/([a-f0-9]{16})(\/resend)?$/);
  if (inv) {
    const [i] = await sql`
      select email, access_role from invites where client_id = ${client.id} and role = 'customer' and left(token_hash, 16) = ${inv[1]}`;
    if (!i) return json({ error: "That invite has already been used or cancelled." }, 404);
    if (inv[2] && method === "POST") {
      const result = await inviteToBusiness(args, org, i.email, i.access_role === "manager" ? "manager" : "viewer");
      await audit(ctx, "team.invite_resent", { summary: `Invite to ${i.email} sent again` }, where);
      return json({ ...result, team: await answeredTeam(client.id) });
    }
    if (!inv[2] && method === "DELETE") {
      await sql`delete from invites where client_id = ${client.id} and role = 'customer' and left(token_hash, 16) = ${inv[1]}`;
      await audit(ctx, "team.invite_cancelled", { summary: `Invite to ${i.email} cancelled` }, where);
      return json(await answeredTeam(client.id));
    }
  }
  const member = rest.match(/^\/team\/members\/([a-f0-9-]{36})$/);
  if (member) {
    const userId = member[1];
    const [m] = await sql`
      select a.role, u.email from client_access a join users u on u.id = a.user_id where a.client_id = ${client.id} and a.user_id = ${userId}`;
    if (!m) return json({ error: "They don't have access to this business." }, 404);
    const lastManager = async () => {
      const [{ n }] = await sql`select count(*)::int as n from client_access where client_id = ${client.id} and role = 'manager'`;
      return m.role === "manager" && n <= 1;
    };
    if (method === "PUT") {
      const role = accessRoleOf((await readBody(req))?.role);
      if (role !== m.role) {
        // A manager can't leave the business without one; the agency always can.
        if (access === "manager" && role === "viewer" && (await lastManager())) {
          throw new ValidationError("A business needs at least one manager. Make someone else a manager first.");
        }
        await sql`update client_access set role = ${role} where client_id = ${client.id} and user_id = ${userId}`;
        await audit(ctx, "team.role_changed", { summary: `${m.email} is now a ${role}`, email: m.email, role }, where);
      }
      return json(await answeredTeam(client.id));
    }
    if (method === "DELETE") {
      if (access === "manager" && (await lastManager())) {
        throw new ValidationError("A business needs at least one manager. Make someone else a manager first.");
      }
      await sql.begin(async (tx) => {
        await tx`delete from client_access where client_id = ${client.id} and user_id = ${userId}`;
        // No businesses left to see in this org: remove the login from it.
        const [left] = await tx`
          select 1 from client_access a join clients c on c.id = a.client_id where a.user_id = ${userId} and c.org_id = ${clientOrgId} limit 1`;
        if (!left) {
          await tx`delete from memberships where org_id = ${clientOrgId} and user_id = ${userId} and role = 'customer'`;
          await tx`delete from sessions where user_id = ${userId} and org_id = ${clientOrgId}`;
        }
      });
      await audit(ctx, "team.removed", { summary: `${m.email} removed`, email: m.email }, where);
      return json(await answeredTeam(client.id));
    }
  }

  // ---- Business profile (S15), billing (S12, S13) and activity (S14) ----
  if (rest === "/business" && method === "PUT") {
    const body = await readBody(req);
    const s = applyBusiness(client.settings, body);
    const profile = profileFrom(body, (client as any).profile ?? {});
    const withProfile = { ...client, profile } as Business;
    const changed = JSON.stringify(s) !== JSON.stringify(client.settings);
    let next: Business;
    if (changed) next = await d.updateClient(withProfile, s);
    else {
      next = { ...withProfile, updatedAt: new Date().toISOString() };
      await saveClient(next);
    }
    await audit(ctx, "business.updated", { summary: "Business details changed" }, where);
    return json({
      business: answeredBusiness(next, { orgId: clientOrgId, orgName: org.name, sandbox: org.sandbox, suspended: org.suspended }),
      applied: changed && !isDemo(next.assistantId),
    });
  }
  if (rest === "/subscription" && method === "GET") {
    return json({
      subscription: null,
      billing: org.direct
        ? "Billing isn't set up yet. You won't be charged while we're in early access."
        : `Billing is handled by ${org.name}.`,
    });
  }
  if (rest === "/usage" && method === "GET") return json({ usage: await answeredUsage(client.id) });
  if (rest === "/audit" && method === "GET") {
    if (!canWrite(access)) return forbidden();
    return json({ audit: await answeredAudit(client.id) });
  }

  return null;
}

// ---- Helpers ----

function knowledgeInput(body: any, existing: any) {
  const kind = body?.type !== undefined ? String(body.type) : (existing?.kind ?? "faq");
  if (kind === "url" || kind === "document") throw new ValidationError("Links and documents aren't supported yet. Paste the details as text instead.");
  if (!KINDS.includes(kind)) throw new ValidationError("Choose a knowledge type from the list.");
  const qa = QA.has(kind);
  const pick = (...vals: unknown[]) => {
    for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
    return "";
  };
  const question = (qa ? pick(body?.question, body?.title) : pick(body?.title, body?.question)) || (existing && !hasAny(body, ["question", "title"]) ? existing.question : "");
  const answer = (qa ? pick(body?.answer, body?.content) : pick(body?.content, body?.answer)) || (existing && !hasAny(body, ["answer", "content"]) ? existing.answer : "");
  const fallbackTitle = !qa && !question && answer ? answer.slice(0, 80) : question;
  if (!fallbackTitle) throw new ValidationError(qa ? "Add the question callers ask." : "Give it a short title.");
  if (!answer) throw new ValidationError(qa ? "Add the answer." : "Add the details.");
  const status = body?.status !== undefined ? String(body.status) : (existing?.status ?? "published");
  if (!["published", "draft", "archived"].includes(status)) throw new ValidationError("Choose published, draft or archived.");
  return { kind, question: fallbackTitle.slice(0, 300), answer: answer.slice(0, 2000), status };
}
const hasAny = (body: any, keys: string[]) => keys.some((k) => body?.[k] !== undefined);

// Rebuilds the receptionist's instructions after a knowledge change. The change is
// already saved; a provider failure is reported, recorded and retried on the next save.
async function resync(client: Business, d: ManageDeps): Promise<{ synced: boolean; warning?: string }> {
  try {
    const fresh = (await getClient(client.id)) ?? client;
    await d.syncAssistant(fresh);
    return { synced: true };
  } catch (err) {
    const message = (err as Error).message;
    await recordIncident({ kind: "knowledge_sync", orgId: await orgOfClient(client.id), clientId: client.id, message: `Couldn't update the receptionist: ${message}`.slice(0, 300) }).catch(() => {});
    return { synced: false, warning: "Saved, but the receptionist couldn't be updated just now. It will pick this up on the next change." };
  }
}

// Answered's role names and ours.
function accessRoleOf(value: unknown): "manager" | "viewer" {
  return value === "manager" || value === "admin" || value === "owner" || value === "staff" ? "manager" : "viewer";
}

function profileFrom(body: any, current: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...current };
  const set = (k: string, max: number, check?: (v: string) => string) => {
    if (body?.[k] === undefined) return;
    const v = str(body[k], max);
    out[k] = v && check ? check(v) : v;
  };
  set("phone", 30, (v) => {
    if (!/^[+0-9 ()-]{6,30}$/.test(v)) throw new ValidationError("Enter the main phone number using digits, spaces and +.");
    return v;
  });
  set("email", 254, (v) => emailOf(v));
  set("website", 200, (v) => {
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    try {
      new URL(url);
    } catch {
      throw new ValidationError("The website isn't a valid address.");
    }
    return url;
  });
  set("region", 40);
  set("postal_code", 10);
  set("country", 40);
  return out;
}

// A business invite (manager or viewer), sent in the business's own org with the
// existing invite email/link. Someone already in that org as a business user is
// given access straight away.
async function inviteToBusiness(
  args: ClientRouteArgs,
  org: { id: string; name: string },
  rawEmail: unknown,
  accessRole: "manager" | "viewer",
): Promise<{ email: string; accessRole: "manager" | "viewer"; url: string; emailed: boolean; added: boolean }> {
  const client = args.client!;
  const email = emailOf(rawEmail);
  const [existing] = await sql`
    select m.role, u.id from memberships m join users u on u.id = m.user_id where m.org_id = ${org.id} and u.email = ${email}`;
  if (existing) {
    if (existing.role !== "customer") throw new ValidationError(`${email} is on the agency's team already, so they can see this business.`);
    const [has] = await sql`select role from client_access where user_id = ${existing.id} and client_id = ${client.id}`;
    if (has) throw new ValidationError(`${email} already has access to this business.`);
    await sql`insert into client_access (user_id, client_id, role) values (${existing.id}, ${client.id}, ${accessRole})`;
    return { email, accessRole, url: "", emailed: false, added: true };
  }
  const result = await createInvite(org.id, org.name, email, "customer", args.ctx.user, args.appUrl, client.id, client.settings.businessName, accessRole);
  return { email, accessRole, ...result, added: false };
}
