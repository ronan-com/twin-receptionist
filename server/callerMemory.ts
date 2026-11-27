import type { BookingRequest, Business } from "../src/lib/shared";
import { sql } from "./db";
import { isDemo } from "./sandbox";

// Returning callers. At the start of a call Telnyx asks our dynamic-variables webhook
// (server/automations.ts dynamicVariables) for values; one of them, twin_caller_context, is
// built here from THIS receptionist's own records only: its call_log and booking_requests rows,
// matched on the caller's number. Every query is keyed on the receptionist's client id, so
// nothing from another business (or another agency) can appear.
//
// Vapi: its assistants can't be handed per-call values by our server without an assistant-request
// hook. TODO(vapi): answer Vapi's "assistant-request" with variableValues { twin_caller_context }.

const DAY = 86_400_000;
const WINDOW_DAYS = 90;
const MAX_CALLS = 3;
const SUMMARY_CHARS = 140;
const CONTEXT_CHARS = 700;

/** Phone numbers compared by digits, with +61 folded into a leading 0 (same rule as the workspace routes). */
export function callerKey(p: string | null | undefined): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.startsWith("61") && d.length >= 11 ? `0${d.slice(2)}` : d;
}

/** The digit strings a stored number could be written as: 0412..., 61412... */
export function digitVariants(p: string): [string, string] {
  const key = callerKey(p);
  return key.startsWith("0") ? [key, `61${key.slice(1)}`] : [key, key];
}

// Words from a caller or the model end up in the script: no template braces, no control characters, short.
const plain = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\{\{|\}\}|[{}]/g, "")
    .replace(/[\u0000-\u001f"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function ago(then: number, now: number): string {
  const days = Math.floor((now - then) / DAY);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function sayWhen(start: string, tz: string): string {
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) return "";
  try {
    const day = new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "long", day: "numeric", month: "short" }).format(at);
    const time = new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(at).replace(/\s/g, "").toLowerCase();
    return `${day} at ${time}`;
  } catch {
    return "";
  }
}

export type PastCall = { startedAt: Date | string; summary: string | null };

/** The one line the assistant is given. Pure, so it's unit tested. Empty when there is nothing to say. */
export function buildContext(args: { calls: PastCall[]; requests: BookingRequest[]; timezone: string; now?: number }): string {
  const now = args.now ?? Date.now();
  const parts: string[] = [];
  const name = plain(args.requests.find((r) => r.name?.trim())?.name, 40);
  if (args.calls.length || args.requests.length) parts.push(`Returning caller${name ? ` (${name})` : ""}.`);
  else return "";

  const calls = args.calls.slice(0, MAX_CALLS).map((c) => {
    const when = ago(new Date(c.startedAt).getTime(), now);
    const about = plain(c.summary, SUMMARY_CHARS);
    return about ? `${when}: ${about.replace(/[.!?]+$/, "")}` : when;
  });
  if (calls.length) parts.push(`Earlier calls: ${calls.join("; ")}.`);

  const live = args.requests.filter((r) => r.status !== "failed");
  const upcoming = live
    .filter((r) => r.kind === "booking" && r.status === "booked" && (r as any).apptStatus !== "cancelled" && Date.parse(r.start) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  if (upcoming) parts.push(`Has a booking for ${plain(upcoming.service, 60) || "an appointment"} on ${sayWhen(upcoming.start, args.timezone)}.`);
  const callback = live.find((r) => r.kind === "callback" && (!r.stage || r.stage === "new" || r.stage === "contacted") && now - Date.parse(r.at) < 14 * DAY);
  if (callback) parts.push(`Asked for a callback${plain(callback.service, 60) ? ` about ${plain(callback.service, 60)}` : ""} ${ago(Date.parse(callback.at), now)}; the team may not have rung yet.`);
  return parts.join(" ").slice(0, CONTEXT_CHARS);
}

/**
 * What to tell the assistant about this number, from this receptionist's records. "" for a first-time
 * caller, a hidden or web caller, a demo receptionist, or any problem: the call goes ahead as for a stranger.
 */
export async function callerContext(client: Pick<Business, "id" | "assistantId" | "settings">, phone: unknown, now = Date.now()): Promise<string> {
  try {
    if (isDemo(client.assistantId)) return "";
    const raw = String(phone ?? "");
    const key = callerKey(raw);
    if (key.length < 8 || /anonymous|@/i.test(raw)) return "";
    const [a, b] = digitVariants(raw);
    const since = new Date(now - WINDOW_DAYS * DAY);
    const calls = (await sql`
      select started_at, summary from call_log
      where client_id = ${client.id} and started_at > ${since} and started_at < ${new Date(now - 2 * 60_000)}
        and regexp_replace(coalesce(from_number, ''), '\\D', '', 'g') in (${a}, ${b})
      order by started_at desc limit ${MAX_CALLS}`) as { started_at: Date; summary: string | null }[];
    const rows = (await sql`select data from booking_requests where client_id = ${client.id} order by id desc limit 200`) as { data: BookingRequest }[];
    const requests = rows.map((r) => r.data).filter((r) => r && callerKey(r.phone) === key && now - Date.parse(r.at) < WINDOW_DAYS * DAY);
    return buildContext({
      calls: calls.map((c) => ({ startedAt: c.started_at, summary: c.summary })),
      requests,
      timezone: client.settings.timezone,
      now,
    });
  } catch (err) {
    console.error(`[caller memory ${client.id}]`, (err as Error).message);
    return "";
  }
}
