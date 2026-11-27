import { industry, type Business } from "../src/lib/shared";
import { SAMPLE_VARS, SHORT_CALL_SECONDS, auMobile, customerKey, followupPlan, isQuietHour, REVIEW_REPEAT_DAYS, reminderPlan, reviewAllowed, reviewPlan, sentRecently, whenVars, type FollowupSettings, type Plan } from "../src/lib/followups";
import { loadAutomations, smsNumberOf } from "./automations";
import { deliver, renderMessage, type FollowupKind } from "./followups";
import { sql } from "./db";
import { mailerReady, sendAccountEmail } from "./mailer";
import { ValidationError } from "./prompt";
import { isDemo } from "./sandbox";
import { getClient } from "./store";
import { runAsOrg } from "./telnyx";
import { sendSms } from "./sms";

// Finds what is due each minute (called from the loop in server/automations.ts that
// already drives text-back) and sends it: appointment reminders, missed-call follow-ups
// and review requests. Rules (when, quiet hours, once per period) are in
// src/lib/followups.ts; "never twice" is the claim row in followup_messages (see
// migration 018), made before anything is sent.

const FOLLOWUP_KEYS = ["reminders", "missedFollowup", "reviews"] as const;

// ---- Keeping track of when each one was switched on -----------------------------------------

async function syncSince(): Promise<void> {
  const rows = await sql`
    select client_id, settings, followups_since from client_automations
    where settings->'reminders'->>'enabled' = 'true' or settings->'missedFollowup'->>'enabled' = 'true'
      or settings->'reviews'->>'enabled' = 'true' or followups_since <> '{}'::jsonb`;
  const now = new Date().toISOString();
  for (const r of rows as any[]) {
    const had: Record<string, string> = r.followups_since ?? {};
    const next: Record<string, string> = {};
    for (const k of FOLLOWUP_KEYS) if (r.settings?.[k]?.enabled === true) next[k] = had[k] ?? now;
    if (JSON.stringify(had) !== JSON.stringify(next)) await sql`update client_automations set followups_since = ${next as any} where client_id = ${r.client_id}`;
  }
}

const sinceOf = (v: unknown): number | null => {
  const t = v ? Date.parse(String(v)) : NaN;
  return Number.isFinite(t) ? t : null;
};

// ---- Sending one -------------------------------------------------------------------------------

type Out = {
  kind: FollowupKind;
  channel: "sms" | "email";
  /** reminder:<booking>, missed:<call>, callback:<request>, review:<booking> */
  key: string;
  to: string | null;
  customer: string | null;
  subject: string;
  text: string;
  /** A reason not to send after all, or null. Runs after the claim and the usual checks. */
  veto?: () => Promise<string | null>;
  /** Already decided not to send (no number, quiet hours too close...). */
  skip?: string;
};

async function dispatch(client: Business, o: Out): Promise<string> {
  let from: string | null = null;
  return deliver({
    claim: async () => {
      const r = await sql`
        insert into followup_messages (client_id, kind, channel, dedupe_key, to_address, customer_key, status, detail)
        values (${client.id}, ${o.kind}, ${o.channel}, ${o.key}, ${o.to}, ${o.customer}, 'sending', '')
        on conflict (client_id, dedupe_key, channel) do nothing returning id`;
      return r[0]?.id ?? null;
    },
    finish: async (id, status, detail) => {
      await sql`update followup_messages set status = ${status}, detail = ${detail.slice(0, 200)} where id = ${id}`;
    },
    veto: async () => {
      if (o.skip) return o.skip;
      if (isDemo(client.assistantId)) return "Demo receptionist: nothing sent";
      if (!o.to) return o.channel === "sms" ? "No mobile number" : "No email address";
      if (o.channel === "sms") {
        from = (await smsNumberOf(client)) ?? null;
        if (!from) return "No mobile number for texts";
        // Last check, in case the server was down through the morning.
        if (isQuietHour(Date.now(), client.settings.timezone)) return "Quiet hours";
      } else if (!mailerReady()) return "Email isn't set up";
      return o.veto ? o.veto() : null;
    },
    send: async () => {
      if (o.channel === "sms") {
        await sendSms(client, { from: from!, to: o.to!, text: o.text, meta: { twin_followup: o.kind } });
      } else if (!(await sendAccountEmail(o.to!, o.subject, o.text, { queue: false }))) throw new Error("Email isn't set up");
    },
  });
}

const firstName = (name: unknown) => String(name ?? "").trim().split(/\s+/)[0] || "there";
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function varsFor(client: Business, f: FollowupSettings, o: { name?: unknown; service?: unknown; start?: string | number }): Record<string, string> {
  const s = client.settings;
  const when = o.start !== undefined ? whenVars(o.start, s.timezone) : { date: "", time: "" };
  return {
    name: firstName(o.name),
    business: s.businessName,
    service: String(o.service ?? "").trim() || industry(s.industry).booking,
    date: when.date,
    time: when.time,
    link: f.reviews.link,
  };
}

// Reports a problem as an incident the way text-back does, without stopping the loop.
const guard = (label: string, clientId: string, fn: () => Promise<unknown>) =>
  fn().catch((err) => console.error(`[followups ${label} ${clientId}]`, (err as Error).message));

const onWait = (p: Plan) => p.action === "wait";

// ---- Reminders ---------------------------------------------------------------------------------------

async function runReminders(now: number): Promise<void> {
  const due = await sql`
    select r.client_id, c.org_id, r.data, a.followups_since->>'reminders' as since
    from booking_requests r
    join clients c on c.id = r.client_id
    join client_automations a on a.client_id = r.client_id
    join orgs o on o.id = c.org_id
    where (a.settings->'reminders'->>'enabled')::boolean is true
      and o.suspended_at is null
      and r.data->>'kind' = 'booking' and r.data->>'status' = 'booked'
      and coalesce(r.data->>'apptStatus', '') not in ('cancelled', 'no_show')
      and case when r.data->>'start' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (r.data->>'start')::timestamptz end between now() and now() + interval '50 hours'
      and (select count(*) from followup_messages f where f.client_id = r.client_id and f.dedupe_key = 'reminder:' || (r.data->>'id'))
          < coalesce((a.settings->'reminders'->>'sms')::boolean, true)::int + coalesce((a.settings->'reminders'->>'email')::boolean, false)::int
    order by r.id limit 100`;
  for (const row of due as any[]) {
    await runAsOrg(row.org_id, () => guard("reminder", row.client_id, () => reminderOne(row, now)));
  }
}

async function reminderOne(row: any, now: number): Promise<void> {
  const client = await getClient(row.client_id);
  if (!client || client.settings.paused) return;
  const f = (await loadAutomations(client.id)).settings;
  if (!f.reminders.enabled) return;
  const d = row.data;
  const start = Date.parse(d.start);
  const tz = client.settings.timezone;
  const vars = varsFor(client, f, { name: d.name, service: d.service, start });
  const since = sinceOf(row.since);
  const bookedAt = Date.parse(d.at);
  for (const channel of ["sms", "email"] as const) {
    if (!f.reminders[channel]) continue;
    const plan = reminderPlan({ start, bookedAt: Number.isFinite(bookedAt) ? bookedAt : 0, hoursBefore: f.reminders.hoursBefore, now, tz, channel, since });
    if (onWait(plan)) continue;
    const to = channel === "sms" ? auMobile(d.phone) : EMAIL.test(String(d.email ?? "")) ? String(d.email).toLowerCase() : null;
    const msg = renderMessage("reminder", channel, f, vars);
    await dispatch(client, { kind: "reminder", channel, key: `reminder:${d.id}`, to, customer: customerKey(d.phone, d.email), ...msg, skip: plan.action === "skip" ? plan.reason : undefined });
  }
}

// ---- Missed calls and unreturned callbacks ----------------------------------------------------------------

const DAY_MS = 24 * 3_600_000;

async function textedToday(client: Business, to: string): Promise<boolean> {
  const [a] = await sql`select max(created_at) as at from followup_messages where client_id = ${client.id} and kind = 'missed' and to_address = ${to} and status in ('sent', 'sending')`;
  const [b] = await sql`select max(created_at) as at from automation_texts where client_id = ${client.id} and to_number = ${to} and status = 'sent'`;
  const latest = Math.max(a?.at ? new Date(a.at).getTime() : 0, b?.at ? new Date(b.at).getTime() : 0);
  return sentRecently(latest || null, Date.now(), 24);
}

async function runMissedCalls(now: number): Promise<void> {
  const due = await sql`
    select c.provider_call_id, c.client_id, c.org_id, c.from_number, c.started_at, c.ended_at, a.followups_since->>'missedFollowup' as since
    from call_log c
    join client_automations a on a.client_id = c.client_id
    join orgs o on o.id = c.org_id
    where (a.settings->'missedFollowup'->>'enabled')::boolean is true
      and (a.settings->'missedFollowup'->>'shortCall')::boolean is true
      and o.suspended_at is null
      and c.duration_seconds is not null and c.duration_seconds < ${SHORT_CALL_SECONDS}
      and coalesce(c.ended_at, c.started_at) < now() - interval '5 minutes'
      and c.started_at > now() - interval '30 hours'
      and c.channel <> 'web' and c.channel not ilike '%sms%' and c.channel not ilike '%chat%'
      and not exists (select 1 from followup_messages f where f.client_id = c.client_id and f.dedupe_key = 'missed:' || c.provider_call_id)
    order by c.started_at limit 50`;
  for (const call of due as any[]) {
    await runAsOrg(call.org_id, () => guard("missed", call.client_id, () => missedCallOne(call, now)));
  }
}

async function missedCallOne(call: any, now: number): Promise<void> {
  const client = await getClient(call.client_id);
  if (!client || client.settings.paused) return;
  const f = (await loadAutomations(client.id)).settings;
  if (!f.missedFollowup.enabled || !f.missedFollowup.shortCall) return;
  const ended = new Date(call.ended_at ?? call.started_at).getTime();
  const plan = followupPlan({ dueAt: ended + 5 * 60_000, now, tz: client.settings.timezone, since: sinceOf(call.since), maxAgeMs: DAY_MS });
  if (onWait(plan)) return;
  const to = auMobile(call.from_number);
  const msg = renderMessage("missed", "sms", f, varsFor(client, f, {}));
  await dispatch(client, {
    kind: "missed",
    channel: "sms",
    key: `missed:${call.provider_call_id}`,
    to,
    customer: to,
    ...msg,
    skip: plan.action === "skip" ? plan.reason : !to ? "Withheld or not a mobile number" : undefined,
    veto: async () => {
      if (await textedToday(client, to!)) return "Texted this caller in the last day";
      const [back] = await sql`
        select 1 from call_log where client_id = ${client.id} and from_number = ${call.from_number} and started_at > ${new Date(call.started_at)} and duration_seconds >= ${SHORT_CALL_SECONDS} limit 1`;
      return back ? "They called back and got through" : null;
    },
  });
}

async function runCallbacks(now: number): Promise<void> {
  const due = await sql`
    select r.client_id, c.org_id, r.data, a.followups_since->>'missedFollowup' as since
    from booking_requests r
    join clients c on c.id = r.client_id
    join client_automations a on a.client_id = r.client_id
    join orgs o on o.id = c.org_id
    where (a.settings->'missedFollowup'->>'enabled')::boolean is true
      and (a.settings->'missedFollowup'->>'callbackOverdue')::boolean is true
      and o.suspended_at is null
      and r.data->>'kind' = 'callback' and coalesce(r.data->>'stage', 'new') = 'new'
      and r.created_at > now() - interval '5 days' and r.created_at < now() - interval '1 hour'
      and not exists (select 1 from followup_messages f where f.client_id = r.client_id and f.dedupe_key = 'callback:' || (r.data->>'id'))
    order by r.id limit 200`;
  for (const row of due as any[]) {
    await runAsOrg(row.org_id, () => guard("callback", row.client_id, () => callbackOne(row, now)));
  }
}

async function callbackOne(row: any, now: number): Promise<void> {
  const client = await getClient(row.client_id);
  if (!client || client.settings.paused) return;
  const f = (await loadAutomations(client.id)).settings;
  const m = f.missedFollowup;
  if (!m.enabled || !m.callbackOverdue) return;
  const d = row.data;
  const asked = Date.parse(d.at);
  if (!Number.isFinite(asked)) return;
  const plan = followupPlan({ dueAt: asked + m.overdueHours * 3_600_000, now, tz: client.settings.timezone, since: sinceOf(row.since), maxAgeMs: 3 * DAY_MS });
  if (onWait(plan)) return;
  const to = auMobile(d.phone);
  const msg = renderMessage("missed", "sms", f, varsFor(client, f, { name: d.name }));
  await dispatch(client, {
    kind: "missed",
    channel: "sms",
    key: `callback:${d.id}`,
    to,
    customer: to,
    ...msg,
    skip: plan.action === "skip" ? plan.reason : !to ? "Withheld or not a mobile number" : undefined,
    veto: async () => ((await textedToday(client, to!)) ? "Texted this caller in the last day" : null),
  });
}

// ---- Review requests ---------------------------------------------------------------------------------------

async function runReviews(now: number): Promise<void> {
  const due = await sql`
    select r.client_id, c.org_id, r.data, a.followups_since->>'reviews' as since
    from booking_requests r
    join clients c on c.id = r.client_id
    join client_automations a on a.client_id = r.client_id
    join orgs o on o.id = c.org_id
    where (a.settings->'reviews'->>'enabled')::boolean is true
      and coalesce(a.settings->'reviews'->>'link', '') <> ''
      and o.suspended_at is null
      and r.data->>'kind' = 'booking' and r.data->>'status' = 'booked'
      and coalesce(r.data->>'apptStatus', '') not in ('cancelled', 'no_show')
      and case when r.data->>'start' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (r.data->>'start')::timestamptz end between now() - interval '4 days' and now()
      and (select count(*) from followup_messages f where f.client_id = r.client_id and f.dedupe_key = 'review:' || (r.data->>'id'))
          < coalesce((a.settings->'reviews'->>'sms')::boolean, true)::int + coalesce((a.settings->'reviews'->>'email')::boolean, false)::int
    order by r.id limit 100`;
  for (const row of due as any[]) {
    await runAsOrg(row.org_id, () => guard("review", row.client_id, () => reviewOne(row, now)));
  }
}

async function reviewOne(row: any, now: number): Promise<void> {
  const client = await getClient(row.client_id);
  if (!client || client.settings.paused) return;
  const f = (await loadAutomations(client.id)).settings;
  if (!f.reviews.enabled || !f.reviews.link) return;
  const d = row.data;
  const key = `review:${d.id}`;
  const customer = customerKey(d.phone, d.email);
  const start = Date.parse(d.start);
  const vars = varsFor(client, f, { name: d.name, service: d.service, start });
  for (const channel of ["sms", "email"] as const) {
    if (!f.reviews[channel]) continue;
    const plan = reviewPlan({ start, minutes: client.booking?.minutes ?? 30, delay: f.reviews.delay, now, tz: client.settings.timezone, channel, since: sinceOf(row.since) });
    if (onWait(plan)) continue;
    const to = channel === "sms" ? auMobile(d.phone) : EMAIL.test(String(d.email ?? "")) ? String(d.email).toLowerCase() : null;
    const msg = renderMessage("review", channel, f, vars);
    await dispatch(client, {
      kind: "review",
      channel,
      key,
      to,
      customer,
      ...msg,
      skip: plan.action === "skip" ? plan.reason : !customer ? "No contact details" : undefined,
      veto: async () => {
        // Once per customer in 90 days, across texts and email (not counting this booking's own).
        const [last] = await sql`
          select max(created_at) as at from followup_messages
          where client_id = ${client.id} and kind = 'review' and customer_key = ${customer} and status in ('sent', 'sending') and dedupe_key <> ${key}`;
        return reviewAllowed(last?.at ? new Date(last.at).getTime() : null, Date.now()) ? null : `Already asked in the last ${REVIEW_REPEAT_DAYS} days`;
      },
    });
  }
}

// ---- The minute job -----------------------------------------------------------------------------------------------

export async function runFollowups(): Promise<void> {
  const now = Date.now();
  await syncSince();
  for (const job of [runReminders, runMissedCalls, runCallbacks, runReviews]) {
    await job(now).catch((err) => console.error(`[followups ${job.name}]`, (err as Error).message));
  }
}

// ---- What the screen shows ----------------------------------------------------------------------------------------

export async function followupsState(client: Business) {
  const recent = await sql`
    select created_at, kind, channel, to_address, status, detail from followup_messages
    where client_id = ${client.id} order by created_at desc limit 12`;
  return {
    emailReady: mailerReady(),
    businessName: client.settings.businessName,
    recent: recent.map((t: any) => ({ at: new Date(t.created_at).toISOString(), kind: t.kind, channel: t.channel, to: t.to_address ?? "", status: t.status, detail: t.detail })),
  };
}

// ---- "Send me a test" ----------------------------------------------------------------------------------------------

/** Sends one example (filled with sample details) to the person asking. Nothing is recorded. */
export async function sendTest(
  client: Business,
  f: FollowupSettings,
  o: { kind: FollowupKind; channel: "sms" | "email"; phone?: unknown; email: string },
): Promise<{ sentTo: string }> {
  const vars = { ...SAMPLE_VARS, business: client.settings.businessName || SAMPLE_VARS.business, link: f.reviews.link || SAMPLE_VARS.link };
  const msg = renderMessage(o.kind, o.channel, f, vars);
  if (o.channel === "email") {
    if (!mailerReady()) throw new ValidationError("Email isn't set up on this server yet.");
    if (!(await sendAccountEmail(o.email, `[Test] ${msg.subject}`, msg.text, { queue: false }))) throw new ValidationError("Email isn't set up on this server yet.");
    return { sentTo: o.email };
  }
  const to = auMobile(o.phone);
  if (!to) throw new ValidationError("Enter your own Australian mobile number, like 0412 345 678.");
  if (isDemo(client.assistantId)) throw new ValidationError("Demo receptionists don't send texts. Try the email test, or use a connected receptionist.");
  const from = await smsNumberOf(client);
  if (!from) throw new ValidationError("This receptionist needs a mobile number that can send texts first. Request one under Call handling.");
  await sendSms(client, { from, to, text: `[Test] ${msg.text}`, meta: { twin_followup: "test" } });
  return { sentTo: to };
}
