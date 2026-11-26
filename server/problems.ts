import { AsyncLocalStorage } from "node:async_hooks";
import { format } from "node:util";
import { sql } from "./db";

// What went wrong lately, for the support heartbeat and "Fetch recent logs" (server/supportSync.ts). Everything
// that leaves this copy goes through scrub() first: numbers, email addresses, links, keys and anything in quotes
// (where a name or a message would be) are masked, and text is cut short. Only a KIND (a short fixed word), a
// scrubbed one-line message, a count and a time are ever sent. Never names, transcripts or what a caller said.

const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

/** Masks anything that could identify a person or unlock something, then cuts the text short. Never throws. */
export function scrub(input: unknown, max = 200): string {
  let t = String(input ?? "");
  // Only the first line: the rest of an error is a stack or a body.
  t = t.split(/\r?\n/)[0] ?? "";
  t = t.replace(/\b(authorization|bearer|api[_-]?key|token|secret|password|passwd|cookie)\b\s*[:=]?\s*\S+/gi, "$1 [hidden]");
  t = t.replace(/https?:\/\/\S+/gi, "[url]");
  t = t.replace(/[^\s@"'<>()[\]]+@[^\s@"'<>()[\]]+\.[A-Za-z]{2,}/g, "[email]");
  t = t.replace(/"[^"]*"/g, '"…"');
  t = t.replace(/(^|[\s(:=,[])'[^'\n]{1,200}'(?=$|[\s),.:\]])/g, "$1'…'");
  t = t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]");
  t = t.replace(IPV4, "[ip]");
  t = t.replace(/\b[a-z]{2,6}_[A-Za-z0-9_-]{10,}\b/g, "[secret]");
  t = t.replace(/[A-Za-z0-9_\-+/=]{24,}/g, "[secret]");
  t = t.replace(/\+?\d[\d\s().-]{4,}\d/g, "[number]");
  t = t.replace(/\d{5,}/g, "[number]");
  t = t.replace(/\s+/g, " ").trim();
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(t) || /(?:\+|\b)\d[\d\s().-]{7,}\d/.test(t)) t = "[removed]";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// ---------------------------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------------------------

const KINDS: [RegExp, string][] = [
  [/^booking|^startup$/, "booking_sync"],
  [/^texting|^text|^followups|^sms/, "text_failed"],
  [/^mail|^email|^notify/, "email_failed"],
  [/^telnyx|^vapi|^twilio|^assistant|^webchat|^manage|^own|^oauth|^calendar|^rename/, "provider_api"],
  [/^automation/, "automation_apply"],
  [/^update|^autoupdate|^auto/, "update_failed"],
  [/^call$|^callsync/, "call_sync"],
];
/** Tags we never turn into a problem: our own plumbing, and the incident writer (those are in the feed already). */
const SKIP = /^(support|incident|audit|problems|heartbeat|platform|install|legacy)$/;

/** "[booking abc] couldn't log: x" -> { kind: "booking_sync", msg }. Null for lines that aren't problems. */
export function classifyError(line: string): { kind: string; msg: string } | null {
  const m = line.match(/^\[([^\]]{1,80})\]\s*(.*)$/s);
  if (!m) return { kind: "server_error", msg: scrub(line) };
  const word = m[1].split(/[\s:]/)[0].toLowerCase();
  if (SKIP.test(word)) return null;
  const kind = KINDS.find(([re]) => re.test(word))?.[1] ?? "server_error";
  return { kind, msg: scrub(m[2] || m[1]) };
}

// ---------------------------------------------------------------------------------------------
// Storing and collecting
// ---------------------------------------------------------------------------------------------

let stamps: number[] = [];
// Set only inside recordProblem's own work, so an error logged while storing a problem isn't stored again (a loop).
// Other problems recorded at the same time are still kept (a plain flag dropped them while an insert was waiting).
const storing = new AsyncLocalStorage<true>();
const nativeError = console.error.bind(console);

/** Records one problem (best effort; never throws, never logs again). At most 60 a minute. */
export async function recordProblem(kind: string, message: unknown): Promise<void> {
  if (storing.getStore()) return;
  const cut = Date.now() - 60_000;
  stamps = stamps.filter((t) => t > cut);
  if (stamps.length >= 60) return;
  stamps.push(Date.now());
  await storing.run(true, async () => {
    try {
      const k = kind.toLowerCase().replace(/[^a-z0-9_.:-]/g, "_").slice(0, 40) || "server_error";
      await sql`insert into problem_log (kind, msg) values (${k}, ${scrub(message)})`;
      if (Math.random() < 0.02) await sql`delete from problem_log where at < now() - interval '2 days'`;
    } catch (err) {
      nativeError("[problems]", (err as Error).message);
    }
  });
}

export type Problem = { kind: string; msg: string; count: number; last: string };
export const MAX_PROBLEMS = 50;

/** Merges rows of the same kind and message: counts add, the latest time wins, newest first, at most 50. Pure. */
export function mergeProblems(rows: { kind: string; msg: string; count: number; last: Date | string }[]): Problem[] {
  const by = new Map<string, Problem>();
  for (const r of rows) {
    const kind = String(r.kind).toLowerCase().replace(/[^a-z0-9_.:-]/g, "_").slice(0, 40) || "server_error";
    const msg = scrub(r.msg);
    const last = new Date(r.last).toISOString();
    const key = `${kind}\u0000${msg}`;
    const have = by.get(key);
    if (have) {
      have.count += Math.max(1, r.count);
      if (last > have.last) have.last = last;
    } else by.set(key, { kind, msg, count: Math.max(1, r.count), last });
  }
  return [...by.values()].sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0)).slice(0, MAX_PROBLEMS);
}

/** The last 24 hours: incidents and logged problems, scrubbed. */
export async function collectProblems(): Promise<Problem[]> {
  try {
    const logged = await sql`select kind, msg, count(*)::int as count, max(at) as last from problem_log where at > now() - interval '24 hours' group by kind, msg`;
    const incidents = await sql`
      select kind, message as msg, coalesce((detail->>'count')::int, 1) as count,
             greatest(created_at, coalesce((detail->>'lastAt')::timestamptz, created_at)) as last
      from incidents
      where greatest(created_at, coalesce((detail->>'lastAt')::timestamptz, created_at)) > now() - interval '24 hours'
      order by last desc limit 100`;
    return mergeProblems([...logged, ...incidents] as any);
  } catch (err) {
    nativeError("[problems] collect", (err as Error).message);
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// The in-memory log ring ("Fetch recent logs")
// ---------------------------------------------------------------------------------------------

export type LogLine = { at: string; level: "log" | "warn" | "error"; line: string };
export const RING_SIZE = 200;
const ring: LogLine[] = [];
export function pushLog(level: LogLine["level"], line: string, at = new Date()): void {
  ring.push({ at: at.toISOString(), level, line: scrub(line, 300) });
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
}
/** The last 200 lines, already scrubbed. */
export const recentLogs = (): LogLine[] => ring.slice();
export const clearLogRing = () => void (ring.length = 0);

let installed = false;
/** Keeps the last 200 console lines (scrubbed as they come in) and turns console.error lines into problems. */
export function installLogCapture(): void {
  if (installed) return;
  installed = true;
  for (const level of ["log", "info", "warn", "error"] as const) {
    const native = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      native(...args);
      try {
        const line = format(...args);
        const lvl = level === "info" ? "log" : level;
        pushLog(lvl, line);
        if (level === "error") {
          const c = classifyError(line.split("\n")[0]);
          if (c) void recordProblem(c.kind, c.msg);
        }
      } catch {}
    };
  }
}
