import nodemailer from "nodemailer";
import { fresh, mailConfig, type MailConfig } from "./platformSettings";

// Account emails (invites, password resets, booking notices) sent from the platform itself, not
// from a client's mailbox. The sender is set in Settings, "Email" (or the older "Email and
// calendars" box); until then SMTP_URL (+ optional SMTP_BACKUP_URL, MAIL_BACKUP_FROM) and MAIL_FROM
// from the environment are used. With neither, emails are printed to the server log so local
// development still works, and invite and reset links are shown on screen to copy.
//
// Each email goes to the main sender first, then the backup if there is one. If both fail it's
// kept in mail_outbox and tried again after 1, 5, 30 and 120 minutes; after that it's given up,
// and recorded as a problem and an incident so the admin sees it.

export type Transport = { sendMail(m: Record<string, unknown>): Promise<unknown>; verify?(): Promise<unknown>; close?(): void };
export type Route = { name: "primary" | "backup"; url: string; from: string };
export type RecentMail = { id: string; to: string; subject: string; status: "pending" | "sent" | "failed"; via: string; attempts: number; error: string; at: string; nextAt: string };
export type OutboxRow = { id: string; to: string; subject: string; text: string; attempts: number };
type NewRow = { to: string; subject: string; text: string; status: "pending" | "sent" | "failed"; attempts: number; via: string; error: string; nextAt: Date | null };

export interface OutboxStore {
  insert(row: NewRow): Promise<void>;
  /** Pending emails that are due, held for a few minutes so another server doesn't take them too. */
  claimDue(limit: number): Promise<OutboxRow[]>;
  update(id: string, change: { status: NewRow["status"]; attempts: number; via?: string; error?: string; nextAt: Date | null }): Promise<void>;
  recent(limit: number): Promise<RecentMail[]>;
}

export type MailDeps = {
  transport(url: string): Transport;
  store: OutboxStore;
  problem(kind: string, msg: string): Promise<void>;
  incident(i: { kind: string; message: string; detail?: Record<string, unknown> }): Promise<void>;
  config(): MailConfig;
  now(): number;
};

/** Waits after each failed try: 1 minute, 5 minutes, 30 minutes, 2 hours. Then it's given up. */
export const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 120 * 60_000];
/** How long to wait after `failures` failed tries, or null to give up. Pure. */
export const retryDelay = (failures: number): number | null => (failures >= 1 && failures <= RETRY_MS.length ? RETRY_MS[failures - 1] : null);

// ---- the real pieces (swapped out in tests with setMailDeps) ----

const transports = new Map<string, ReturnType<typeof nodemailer.createTransport>>();
function cachedTransport(url: string): Transport {
  let t = transports.get(url);
  if (!t) {
    // A changed setting gets a new connection; old ones are closed.
    for (const [k, old] of transports) if (k !== url) (old.close(), transports.delete(k));
    t = nodemailer.createTransport({ url, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 } as any);
    transports.set(url, t);
  }
  return t as unknown as Transport;
}

/** A one-off connection for a settings test, which gives up quickly. */
export function testTransport(smtpUrl: string) {
  return nodemailer.createTransport({ url: smtpUrl, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 } as any);
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : "");

export const sqlStore: OutboxStore = {
  async insert(r) {
    const { sql } = await import("./db");
    await sql`
      insert into mail_outbox (to_addr, subject, body, status, attempts, via, last_error, next_at)
      values (${r.to}, ${r.subject.slice(0, 300)}, ${r.status === "pending" ? r.text : ""}, ${r.status}, ${r.attempts}, ${r.via}, ${r.error.slice(0, 300)}, ${r.nextAt})`;
    if (Math.random() < 0.05) await sql`delete from mail_outbox where status <> 'pending' and updated_at < now() - interval '30 days'`;
  },
  async claimDue(limit) {
    const { sql } = await import("./db");
    const rows = await sql`
      update mail_outbox set next_at = now() + interval '10 minutes', updated_at = now()
      where id in (select id from mail_outbox where status = 'pending' and next_at <= now() order by next_at limit ${limit} for update skip locked)
      returning id, to_addr, subject, body, attempts`;
    return rows.map((r: any) => ({ id: r.id, to: r.to_addr, subject: r.subject, text: r.body, attempts: r.attempts }));
  },
  async update(id, c) {
    const { sql } = await import("./db");
    // A sent or given-up email's text (it can hold a sign-in link) isn't kept.
    await sql`
      update mail_outbox set status = ${c.status}, attempts = ${c.attempts}, via = coalesce(${c.via ?? null}, via),
        last_error = ${(c.error ?? "").slice(0, 300)}, next_at = ${c.nextAt}, updated_at = now(),
        body = case when ${c.status} = 'pending' then body else '' end
      where id = ${id}`;
  },
  async recent(limit) {
    const { sql } = await import("./db");
    const rows = await sql`select * from mail_outbox order by created_at desc limit ${limit}`;
    return rows.map((r: any) => ({ id: r.id, to: r.to_addr, subject: r.subject, status: r.status, via: r.via, attempts: r.attempts, error: r.last_error, at: iso(r.updated_at), nextAt: iso(r.next_at) }));
  },
};

const realDeps: MailDeps = {
  transport: cachedTransport,
  store: sqlStore,
  problem: async (kind, msg) => (await import("./problems")).recordProblem(kind, msg),
  incident: async (i) => (await import("./incidents")).recordIncident(i),
  config: mailConfig,
  now: Date.now,
};
let deps: MailDeps = realDeps;
/** Tests: replace any of the pieces. Call with no argument to put the real ones back. */
export function setMailDeps(d?: Partial<MailDeps>): void {
  deps = d ? { ...realDeps, ...d } : realDeps;
}

// ---- sending ----

/** The senders in the order they're tried. */
export function routesOf(c: MailConfig): Route[] {
  const out: Route[] = [];
  if (c.smtpUrl && c.from) out.push({ name: "primary", url: c.smtpUrl, from: c.from });
  if (c.backupUrl && (c.backupFrom || c.from)) out.push({ name: "backup", url: c.backupUrl, from: c.backupFrom || c.from });
  return out;
}

export const mailerReady = () => routesOf(deps.config()).length > 0;

const errText = (e: unknown) => String((e as Error)?.message ?? e ?? "unknown error").split("\n")[0].slice(0, 300);

/** Tries the main sender, then the backup. Never throws. */
export async function deliver(to: string, subject: string, text: string, only?: Route["name"], html?: string): Promise<{ ok: true; via: Route["name"] } | { ok: false; error: string; tried: number }> {
  const routes = routesOf(deps.config()).filter((r) => !only || r.name === only);
  let error = "No email sender is set up.";
  for (const [i, r] of routes.entries()) {
    try {
      await deps.transport(r.url).sendMail({ from: r.from, to, subject, text, ...(html ? { html } : {}) });
      if (i > 0) await deps.problem("email_failover", `The main email sender failed, so the backup sent it: ${error}`);
      return { ok: true, via: r.name };
    } catch (err) {
      error = errText(err);
    }
  }
  return { ok: false, error, tried: routes.length };
}

/**
 * Sends one email. true = sent now. false = not sent now: either no sender is set up (it's printed
 * to the log, and callers show the link instead), or every sender failed and it's queued to try again.
 * With queue: false (follow-ups and tests, which keep their own record) a failure throws instead.
 */
export async function sendAccountEmail(to: string, subject: string, text: string, opts: { queue?: boolean; html?: string } = {}): Promise<boolean> {
  if (deps === realDeps) await fresh();
  if (!mailerReady()) {
    console.log(`[mail not configured] To: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return false;
  }
  const r = await deliver(to, subject, text, undefined, opts.html);
  if (r.ok) {
    await deps.store.insert({ to, subject, text: "", status: "sent", attempts: 1, via: r.via, error: "", nextAt: null }).catch(() => {});
    return true;
  }
  if (opts.queue === false) {
    await deps.store.insert({ to, subject, text: "", status: "failed", attempts: 1, via: "", error: r.error, nextAt: null }).catch(() => {});
    throw new Error(r.error);
  }
  await deps.store.insert({ to, subject, text, status: "pending", attempts: 1, via: "", error: r.error, nextAt: new Date(deps.now() + retryDelay(1)!) });
  await deps.problem("email_failed", `An email couldn't be sent and will be tried again: ${r.error}`);
  return false;
}

let running = false;
/** Tries every queued email that's due. Safe to call often, and from several servers. */
export async function runOutbox(): Promise<{ sent: number; retrying: number; gaveUp: number }> {
  const out = { sent: 0, retrying: 0, gaveUp: 0 };
  if (running) return out;
  running = true;
  try {
    if (deps === realDeps) await fresh();
    for (const row of await deps.store.claimDue(20)) {
      const r = await deliver(row.to, row.subject, row.text);
      const attempts = row.attempts + 1;
      if (r.ok) {
        await deps.store.update(row.id, { status: "sent", attempts, via: r.via, nextAt: null });
        out.sent++;
        continue;
      }
      const wait = retryDelay(attempts);
      if (wait !== null) {
        await deps.store.update(row.id, { status: "pending", attempts, error: r.error, nextAt: new Date(deps.now() + wait) });
        out.retrying++;
      } else {
        await deps.store.update(row.id, { status: "failed", attempts, error: r.error, nextAt: null });
        await deps.problem("email_failed", `Gave up on an email after ${attempts} tries: ${r.error}`);
        await deps.incident({ kind: "email_failed", message: `An account email couldn't be sent after ${attempts} tries. Check Settings, Email.`, detail: { error: r.error.slice(0, 200) } });
        out.gaveUp++;
      }
    }
  } catch (err) {
    console.error("[mail outbox]", errText(err));
  } finally {
    running = false;
  }
  return out;
}

export const recentMail = (limit = 10) => deps.store.recent(limit);

let timer: ReturnType<typeof setInterval> | null = null;
export function startOutbox(): void {
  if (timer) return;
  timer = setInterval(() => void runOutbox(), 30_000);
}
