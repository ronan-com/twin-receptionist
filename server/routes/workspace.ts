import type { BookingRequest, Business, DayKey } from "../../src/lib/shared";
import { calendarLink } from "../calendars";
import { callDetail } from "../calls";
import { iso, sql } from "../db";
import { ValidationError } from "../prompt";
import { isDemo } from "../sandbox";
import { audit } from "../audit";
import { json, readBody, type ClientRouteArgs } from "./http";

// Area W (workspace, read): calls, bookings, follow-ups and reports for one business,
// in Answered's row shapes (src/lib/app/types.ts). Paths: /api/workspace/<clientId>/...
// The dispatcher in server/index.ts has already checked access (a business user only
// reaches receptionists shared with them, agency staff only their own org's, the
// platform admin any) and refused every write from a viewer or while viewing as.
//
//   GET   /calls?from&to           -> { calls }        (call_log)
//   GET   /calls/<callId>          -> { call }         (call_log + transcript from the provider)
//   GET   /texts/count?from&to     -> { count }        (text conversations)
//   GET   /bookings                -> { appointments } (booking_requests kind=booking + calendar_events)
//   PATCH /bookings/<id>           -> { appointment }  (status, notes)          managers, staff, platform
//   GET   /follow-ups              -> { leads }        (booking_requests kind=callback)
//   PATCH /follow-ups/<id>         -> { lead }         (stage and follow-up fields) managers, staff, platform

const MINUTE = 60_000;
const MAX_CALLS = 5000;
const MAX_REQUESTS = 1000;

/* ------------------------------------------------------------------ */
/* Shared pieces                                                        */
/* ------------------------------------------------------------------ */

type Biz = { id: string; name: string; is_demo: boolean; timezone: string };

async function bizOf(client: Business, orgId: string): Promise<Biz> {
  const [o] = await sql`select sandbox from orgs where id = ${orgId}`;
  return { id: client.id, name: client.settings.businessName, is_demo: Boolean(o?.sandbox), timezone: client.settings.timezone };
}

type StoredRequest = BookingRequest & {
  // Our own keys, written by the PATCH endpoints below.
  apptStatus?: string;
  bizNotes?: string;
  notes?: string;
  followUpAt?: string | null;
  followUpStatus?: string;
  assignedTo?: string | null;
  valueCents?: number | null;
  changedAt?: string;
  stage?: string;
};

/**
 * A booking the caller tried for a slot that was already taken. It's kept (it shows up in the call's
 * events), but it isn't an appointment: it must not be listed next to the real booking.
 */
export function isRefusedBooking(r: { kind?: string; status?: string }): boolean {
  return r.kind === "booking" && r.status === "failed";
}

async function requestsOf(clientId: string): Promise<StoredRequest[]> {
  const rows = await sql`select data from booking_requests where client_id = ${clientId} order by id desc limit ${MAX_REQUESTS}`;
  return rows.map((r: any) => r.data as StoredRequest);
}

/** Phone numbers compared by digits, with +61 folded into a leading 0. */
export function phoneKey(p: string | null | undefined): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.startsWith("61") && d.length >= 11 ? `0${d.slice(2)}` : d;
}

type CallRow = {
  id: string;
  client_id: string;
  provider_call_id: string;
  channel: string;
  from_number: string | null;
  to_number: string | null;
  started_at: Date | string;
  ended_at: Date | string | null;
  duration_seconds: number | null;
  status: string;
  outcome: string | null;
  summary: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const ms = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : NaN);

/**
 * The booking requests a call produced: same caller number, logged during the call
 * (or up to 5 minutes after it ended). docs: api-contract.md §7 "Call matching rule".
 */
function matchesCall(call: CallRow, r: StoredRequest): boolean {
  const from = phoneKey(call.from_number);
  if (!from || phoneKey(r.phone) !== from) return false;
  const at = Date.parse(r.at);
  const start = ms(call.started_at);
  const end = Number.isFinite(ms(call.ended_at)) ? ms(call.ended_at) : start + 30 * MINUTE;
  return Number.isFinite(at) && at >= start && at <= end + 5 * MINUTE;
}

function requestsForCall(call: CallRow, requests: StoredRequest[]): StoredRequest[] {
  return requests.filter((r) => matchesCall(call, r)).sort((a, b) => b.at.localeCompare(a.at));
}

/** Local weekday and HH:MM of an instant in a timezone. */
function localParts(at: number, tz: string): { day: DayKey; hm: string } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = get("weekday").toLowerCase().slice(0, 3) as DayKey;
    return { day, hm: `${get("hour").padStart(2, "0")}:${get("minute")}` };
  } catch {
    return null;
  }
}

/** Whether a call started outside the business's opening hours. */
export function isAfterHours(client: Business, startedAt: Date | string): boolean {
  const p = localParts(ms(startedAt), client.settings.timezone);
  const h = p ? client.settings.hours?.[p.day] : null;
  if (!p || !h) return false;
  if (!h.open) return true;
  return p.hm < h.from || p.hm >= h.to;
}

function outcomeOf(call: CallRow, matched: StoredRequest[]): string | null {
  if (call.outcome) return call.outcome;
  const r = matched[0];
  if (!r) return null;
  if (r.kind === "callback") return "callback_requested";
  if (r.status === "booked") return "booked";
  if (r.status === "failed") return "unresolved";
  return null;
}

const KNOWN_STATUSES = new Set(["queued", "ringing", "in_progress", "completed", "missed", "failed", "voicemail", "cancelled"]);

/** A call_log row in Answered's CallListRow shape (contract A5). */
export function answeredCall(call: CallRow, client: Business, biz: Biz, requests: StoredRequest[]) {
  const matched = requestsForCall(call, requests);
  const duration = call.duration_seconds ?? 0;
  const status = KNOWN_STATUSES.has(call.status) ? call.status : "completed";
  return {
    id: call.id,
    business_id: call.client_id,
    agent_id: call.client_id,
    contact_id: null,
    phone_number_id: null,
    provider: "telnyx",
    provider_call_id: call.provider_call_id,
    direction: "inbound",
    from_number: call.from_number,
    to_number: call.to_number,
    started_at: iso(call.started_at),
    answered_at: iso(call.started_at),
    ended_at: call.ended_at ? iso(call.ended_at) : null,
    duration_seconds: duration,
    talk_time_seconds: duration,
    status,
    outcome: outcomeOf(call, matched),
    summary: call.summary,
    ai_handled: true,
    transferred: false,
    transfer_target: null,
    after_hours: isAfterHours(client, call.started_at),
    sentiment: null,
    confidence: null,
    intent: matched[0]?.service || null,
    error_code: null,
    error_message: null,
    cost_cents: null,
    qa_status: "unreviewed",
    qa_notes: null,
    qa_reviewed_at: null,
    qa_reviewed_by: null,
    metadata: { channel: call.channel },
    created_at: iso(call.created_at),
    updated_at: iso(call.updated_at),
    contact: { id: null, full_name: matched.find((r) => r.name)?.name || (call.channel === "web" ? "Browser test call" : null), phone: call.from_number },
    agent: { id: call.client_id, name: client.settings.receptionistName || "Receptionist" },
    phone_number: call.to_number ? { id: call.to_number, e164: call.to_number, friendly_name: call.to_number } : null,
    business: biz,
  };
}

/* ------------------------------------------------------------------ */
/* Bookings and follow-ups (contract A7 / A8)                           */
/* ------------------------------------------------------------------ */

const APPT_STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"];
export const LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"];
const FOLLOW_UP_STATUSES = ["pending", "scheduled", "done", "not_required"];

type CalendarInfo = { integration: { id: string; provider: string; display_name: string; status: string } | null; minutes: number };

async function calendarInfo(client: Business): Promise<CalendarInfo> {
  const minutes = client.booking?.minutes ?? 30;
  const p = client.booking?.provider;
  if (p !== "google" && p !== "microsoft") return { integration: null, minutes };
  const link = await calendarLink(client.id).catch(() => null);
  const provider = p === "google" ? "google_calendar" : "microsoft_calendar";
  return {
    minutes,
    integration: {
      id: provider,
      provider,
      display_name: p === "google" ? "Google Calendar" : "Microsoft Outlook Calendar",
      status: link ? (link.lastError ? "error" : "connected") : "not_connected",
    },
  };
}

function callIdFor(r: StoredRequest, calls: CallRow[]): string | null {
  return calls.find((c) => matchesCall(c, r))?.id ?? null;
}

export function answeredAppointment(r: StoredRequest, clientId: string, cal: CalendarInfo, callId: string | null) {
  const startMs = Date.parse(r.start);
  const startsAt = Number.isFinite(startMs) ? new Date(startMs).toISOString() : r.at;
  const syncStatus = r.changedAt && r.apptStatus ? "local_changes_pending" : r.status === "booked" ? "synced" : r.status === "failed" ? "failed" : "pending";
  return {
    id: r.id,
    business_id: clientId,
    created_at: r.at,
    updated_at: r.changedAt ?? r.at,
    starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + cal.minutes * MINUTE).toISOString(),
    customer_name: r.name || null,
    customer_phone: r.phone || null,
    customer_email: r.email || null,
    service: r.service || null,
    reason: null,
    notes: r.bizNotes ?? (r.note || null),
    source: r.channel === "web" ? "website_chat" : r.channel === "sms" ? "ai_receptionist" : "ai_call",
    status: r.apptStatus ?? (r.status === "booked" ? "confirmed" : "pending"),
    staff_name: null,
    location: null,
    contact_id: null,
    call_id: callId,
    integration_id: cal.integration?.id ?? null,
    integration: cal.integration,
    sync_status: syncStatus,
    external_ref: null,
  };
}

type EventRow = { id: string; starts_at: Date | string; ends_at: Date | string; title: string; details: string; created_at: Date | string };

/** A built-in calendar entry with no booking request behind it (e.g. made before requests were logged). */
function answeredEvent(e: EventRow, clientId: string) {
  // bookNow titles events "Service · Name" (older ones "Service - Name").
  const [service, name] = e.title.split(/ [·-] /);
  const phone = e.details.match(/Phone:\s*([+\d ]+)/)?.[1]?.trim() ?? (/^[+\d ]{8,}$/.test(e.details.trim()) ? e.details.trim() : null);
  return {
    id: `cal-${e.id}`,
    business_id: clientId,
    created_at: iso(e.created_at),
    updated_at: iso(e.created_at),
    starts_at: iso(e.starts_at),
    ends_at: iso(e.ends_at),
    customer_name: name?.trim() || null,
    customer_phone: phone,
    customer_email: null,
    service: service?.trim() || e.title,
    reason: null,
    notes: null,
    source: "calendar",
    status: "confirmed",
    staff_name: null,
    location: null,
    contact_id: null,
    call_id: null,
    integration_id: null,
    integration: null,
    sync_status: "synced",
    external_ref: null,
  };
}

export function answeredLead(r: StoredRequest, clientId: string, callId: string | null) {
  const pref = Date.parse(r.start);
  return {
    id: r.id,
    business_id: clientId,
    created_at: r.at,
    updated_at: r.changedAt ?? r.at,
    name: r.name || null,
    phone: r.phone || null,
    email: r.email || null,
    enquiry: r.service || null,
    intent: r.channel === "web" ? "Website chat message" : "Callback request",
    summary: r.notes ?? (r.note || null),
    stage: r.stage && LEAD_STAGES.includes(r.stage) ? r.stage : "new",
    // A call-back is due when the caller asked for it (a vague "mornings" means as soon as possible),
    // so it shows on the dashboard's next steps until someone sets a time or marks it done.
    follow_up_at: r.followUpAt !== undefined ? r.followUpAt : Number.isFinite(pref) ? new Date(pref).toISOString() : r.at,
    follow_up_status: r.followUpStatus ?? "pending",
    assigned_to: r.assignedTo ?? null,
    value_cents: r.valueCents ?? null,
    qualification: r.start && !Number.isFinite(pref) ? { preferred_time: r.start } : {},
    call_id: callId,
    contact_id: null,
  };
}

/** Calls of this client around the requests' times, for linking requests back to their call. */
async function callsNear(clientId: string, requests: StoredRequest[]): Promise<CallRow[]> {
  if (requests.length === 0) return [];
  const times = requests.map((r) => Date.parse(r.at)).filter(Number.isFinite);
  if (times.length === 0) return [];
  const from = new Date(Math.min(...times) - 2 * 60 * MINUTE);
  const to = new Date(Math.max(...times) + MINUTE);
  return (await sql`
    select * from call_log where client_id = ${clientId} and channel <> 'web'
      and started_at between ${from} and ${to} order by started_at desc limit ${MAX_CALLS}`) as CallRow[];
}

async function appointmentsFor(client: Business): Promise<any[]> {
  const requests = (await requestsOf(client.id)).filter((r) => r.kind === "booking" && !isRefusedBooking(r));
  const [cal, calls, events] = await Promise.all([
    calendarInfo(client),
    callsNear(client.id, requests),
    sql`select id, starts_at, ends_at, title, details, created_at from calendar_events where client_id = ${client.id} order by starts_at desc limit ${MAX_REQUESTS}`,
  ]);
  const appts = requests.map((r) => answeredAppointment(r, client.id, cal, callIdFor(r, calls)));
  // Calendar entries that a booking request already accounts for (same start time) aren't shown twice.
  const starts = requests.filter((r) => r.status === "booked").map((r) => Date.parse(r.start));
  for (const e of events as EventRow[]) {
    const t = ms(e.starts_at);
    if (starts.some((s) => Math.abs(s - t) < 5 * MINUTE)) continue;
    appts.push(answeredEvent(e, client.id) as any);
  }
  return appts.sort((a, b) => b.starts_at.localeCompare(a.starts_at));
}

async function leadsFor(client: Business): Promise<any[]> {
  const requests = (await requestsOf(client.id)).filter((r) => r.kind === "callback");
  const calls = await callsNear(client.id, requests);
  return requests.map((r) => answeredLead(r, client.id, callIdFor(r, calls)));
}

async function findRequest(clientId: string, id: string, kind: "booking" | "callback"): Promise<StoredRequest> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new ValidationError(kind === "booking" ? "Unknown booking." : "Unknown follow-up.");
  const [row] = await sql`select data from booking_requests where client_id = ${clientId} and data->>'id' = ${id} and data->>'kind' = ${kind}`;
  if (!row) throw new ValidationError(kind === "booking" ? "Unknown booking." : "Unknown follow-up.");
  return row.data as StoredRequest;
}

async function saveRequest(clientId: string, id: string, patch: Record<string, unknown>): Promise<StoredRequest> {
  const [row] = await sql`
    update booking_requests set data = data || ${{ ...patch, changedAt: new Date().toISOString() } as any}::jsonb
    where client_id = ${clientId} and data->>'id' = ${id} returning data`;
  return row.data as StoredRequest;
}

const clipText = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

async function patchBooking(args: ClientRouteArgs, id: string) {
  const client = args.client!;
  if (id.startsWith("cal-")) throw new ValidationError("This appointment is in your calendar. Change it there.");
  await findRequest(client.id, id, "booking");
  const body = await readBody(args.req);
  if (body.starts_at !== undefined) throw new ValidationError("Change the time in your calendar.");
  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!APPT_STATUSES.includes(body.status)) throw new ValidationError("Choose a booking status from the list.");
    patch.apptStatus = body.status;
  }
  if (body.notes !== undefined) patch.bizNotes = clipText(body.notes, 2000);
  if (Object.keys(patch).length === 0) throw new ValidationError("Nothing to change.");
  const saved = await saveRequest(client.id, id, patch);
  await audit(args.ctx, "booking.updated", { id, fields: Object.keys(patch), summary: `Booking ${body.status ? `marked ${body.status}` : "notes changed"}` }, { orgId: args.clientOrgId, clientId: client.id });
  const [cal, calls] = await Promise.all([calendarInfo(client), callsNear(client.id, [saved])]);
  return json({ appointment: answeredAppointment(saved, client.id, cal, callIdFor(saved, calls)) });
}

/** People who may own a follow-up: this business's team, plus the agency that runs it. */
async function canBeAssigned(clientId: string, orgId: string, userId: string): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/.test(userId)) return false;
  const [hit] = await sql`
    select 1 from client_access where client_id = ${clientId} and user_id = ${userId}
    union all
    select 1 from memberships where org_id = ${orgId} and user_id = ${userId} and role <> 'customer'
    limit 1`;
  return Boolean(hit);
}

async function patchLead(args: ClientRouteArgs, id: string) {
  const client = args.client!;
  await findRequest(client.id, id, "callback");
  const body = await readBody(args.req);
  const patch: Record<string, unknown> = {};
  if (body.stage !== undefined) {
    if (!LEAD_STAGES.includes(body.stage)) throw new ValidationError("Choose New, Contacted, Qualified, Proposal, Won or Lost.");
    patch.stage = body.stage;
  }
  if (body.summary !== undefined) patch.notes = clipText(body.summary, 2000);
  if (body.follow_up_status !== undefined) {
    if (!FOLLOW_UP_STATUSES.includes(body.follow_up_status)) throw new ValidationError("Choose a follow-up status from the list.");
    patch.followUpStatus = body.follow_up_status;
  }
  if (body.follow_up_at !== undefined) {
    if (body.follow_up_at === null || body.follow_up_at === "") patch.followUpAt = null;
    else {
      const t = Date.parse(String(body.follow_up_at));
      if (!Number.isFinite(t)) throw new ValidationError("Enter a valid date and time.");
      patch.followUpAt = new Date(t).toISOString();
    }
  }
  if (body.value_cents !== undefined) {
    if (body.value_cents === null) patch.valueCents = null;
    else {
      const v = Number(body.value_cents);
      if (!Number.isInteger(v) || v < 0 || v > 1_000_000_000_00) throw new ValidationError("Enter a valid amount.");
      patch.valueCents = v;
    }
  }
  if (body.assigned_to !== undefined) {
    if (body.assigned_to === null) patch.assignedTo = null;
    else if (await canBeAssigned(client.id, args.clientOrgId!, String(body.assigned_to))) patch.assignedTo = String(body.assigned_to);
    else throw new ValidationError("Choose someone on this business's team.");
  }
  if (Object.keys(patch).length === 0) throw new ValidationError("Nothing to change.");
  const saved = await saveRequest(client.id, id, patch);
  await audit(
    args.ctx,
    "follow_up.updated",
    { id, fields: Object.keys(patch), summary: body.stage ? `Follow-up moved to ${body.stage}` : "Follow-up updated" },
    { orgId: args.clientOrgId, clientId: client.id },
  );
  const calls = await callsNear(client.id, [saved]);
  return json({ lead: answeredLead(saved, client.id, callIdFor(saved, calls)) });
}

/* ------------------------------------------------------------------ */
/* Calls                                                                */
/* ------------------------------------------------------------------ */

function rangeOf(url: URL): { from: Date; to: Date } {
  const to = Date.parse(url.searchParams.get("to") ?? "");
  const from = Date.parse(url.searchParams.get("from") ?? "");
  const end = Number.isFinite(to) ? to : Date.now();
  const start = Number.isFinite(from) ? from : end - 60 * 86_400_000;
  if (start > end) throw new ValidationError("The start of the range is after its end.");
  return { from: new Date(start), to: new Date(end) };
}

async function callList(args: ClientRouteArgs) {
  const client = args.client!;
  const { from, to } = rangeOf(args.url);
  const [rows, requests, biz] = await Promise.all([
    // Includes browser test calls (channel 'web'), so a test call shows under Calls.
    sql`select * from call_log where client_id = ${client.id}
        and started_at between ${from} and ${to} order by started_at desc limit ${MAX_CALLS}`,
    requestsOf(client.id),
    bizOf(client, args.clientOrgId!),
  ]);
  return json({ calls: (rows as CallRow[]).map((c) => answeredCall(c, client, biz, requests)) });
}

async function textCount(args: ClientRouteArgs) {
  const { from, to } = rangeOf(args.url);
  const [r] = await sql`
    select count(*)::int as n from call_log
    where client_id = ${args.client!.id} and channel like 'sms%' and started_at between ${from} and ${to}`;
  return json({ count: r?.n ?? 0 });
}

/** The provider's conversation id for a call_log row (demo rows carry the receptionist id as a suffix). */
function conversationIdOf(call: CallRow, client: Business): string {
  const suffix = `-${client.id}`;
  if (isDemo(client.assistantId) && call.provider_call_id.endsWith(suffix)) return call.provider_call_id.slice(0, -suffix.length);
  return call.provider_call_id;
}

/** One call with transcript, linked records and a simple timeline (contract W3). */
export async function answeredCallDetail(client: Business, orgId: string, callId: string) {
  if (!/^[a-f0-9-]{36}$/.test(callId)) throw new ValidationError("Unknown call.");
  const [row] = (await sql`select * from call_log where id = ${callId} and client_id = ${client.id}`) as CallRow[];
  if (!row) return null;
  const [requests, biz, cal] = await Promise.all([requestsOf(client.id), bizOf(client, orgId), calendarInfo(client)]);
  const base = answeredCall(row, client, biz, requests);
  const matched = requestsForCall(row, requests);

  let transcript: { summary: string; messages: { role: string; text: string; at: string }[] } | null = null;
  let transcriptError: string | null = null;
  try {
    transcript = await callDetail(client, conversationIdOf(row, client));
  } catch (err) {
    transcriptError = (err as Error).message || "The phone provider didn't answer.";
  }

  const start = ms(row.started_at);
  const end = Number.isFinite(ms(row.ended_at)) ? ms(row.ended_at) : start + (row.duration_seconds ?? 0) * 1000;
  const segments = (transcript?.messages ?? []).map((m, i) => {
    const at = Date.parse(m.at);
    // Only show a time into the call when the message's time falls inside the call.
    const inside = Number.isFinite(at) && at >= start - 5000 && at <= Math.max(end, start) + 60_000;
    return {
      id: `${row.id}-${i}`,
      call_id: row.id,
      business_id: client.id,
      seq: i,
      speaker: m.role === "assistant" ? "agent" : "caller",
      text: m.text,
      started_ms: inside ? Math.max(0, at - start) : null,
      ended_ms: null,
      confidence: null,
      created_at: m.at || iso(row.started_at),
    };
  });

  const event = (id: string, type: string, occurred: string, severity: string, message: string | null) => ({
    id: `${row.id}-${id}`,
    call_id: row.id,
    business_id: client.id,
    type,
    severity,
    occurred_at: occurred,
    message,
    payload: {},
    created_at: occurred,
  });
  const events = [event("start", "call.started", iso(row.started_at), "info", null)];
  if (row.ended_at) events.push(event("end", "call.ended", iso(row.ended_at), "info", null));
  for (const r of matched) {
    if (r.kind === "callback") events.push(event(r.id, "crm.callback_requested", r.at, "info", r.service || null));
    else if (r.status === "booked") events.push(event(r.id, "calendar.booking_created", r.at, "info", r.service || null));
    else events.push(event(r.id, "calendar.booking_failed", r.at, "error", r.note || null));
  }
  if (transcriptError) events.push(event("transcript", "transcript.unavailable", new Date().toISOString(), "warning", "The transcript couldn't be loaded from the phone provider."));

  const appointments = matched
    .filter((r) => r.kind === "booking" && !isRefusedBooking(r))
    .map((r) => {
      const a = answeredAppointment(r, client.id, cal, row.id);
      return { id: a.id, starts_at: a.starts_at, ends_at: a.ends_at, service: a.service, status: a.status, customer_name: a.customer_name, staff_name: null, location: null, integration_id: a.integration_id, sync_status: a.sync_status };
    });
  const leads = matched
    .filter((r) => r.kind === "callback")
    .map((r) => {
      const l = answeredLead(r, client.id, row.id);
      return { id: l.id, stage: l.stage, name: l.name, intent: l.intent };
    });

  return {
    ...base,
    summary: transcript?.summary || row.summary || null,
    transcript_segments: segments,
    call_events: events,
    recordings: [],
    appointments,
    leads,
  };
}

/* ------------------------------------------------------------------ */
/* Router                                                               */
/* ------------------------------------------------------------------ */

export async function workspaceRoutes(args: ClientRouteArgs): Promise<Response | null> {
  const { client, method, rest } = args;
  if (!client || !args.clientOrgId) return null;
  const get = method === "GET" || method === "HEAD";
  // The dispatcher already refuses viewers' writes; checked again here so this module stays safe on its own.
  if (!get && args.access === "viewer") return json({ error: "Your access to this business is view-only. Ask a manager to change it." }, 403);

  if (rest === "/calls" && get) return callList(args);
  if (rest === "/texts/count" && get) return textCount(args);
  const oneCall = rest.match(/^\/calls\/([a-f0-9-]{36})$/);
  if (oneCall && get) {
    const call = await answeredCallDetail(client, args.clientOrgId, oneCall[1]);
    return call ? json({ call }) : json({ error: "That call isn't here any more." }, 404);
  }
  if (rest === "/bookings" && get) return json({ appointments: await appointmentsFor(client) });
  const oneBooking = rest.match(/^\/bookings\/([A-Za-z0-9_-]{1,80})$/);
  if (oneBooking && method === "PATCH") return patchBooking(args, oneBooking[1]);
  if (rest === "/follow-ups" && get) return json({ leads: await leadsFor(client) });
  const oneLead = rest.match(/^\/follow-ups\/([A-Za-z0-9_-]{1,80})$/);
  if (oneLead && method === "PATCH") return patchLead(args, oneLead[1]);
  return null;
}
