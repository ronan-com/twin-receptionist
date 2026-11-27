import { sql } from "./db";
import { FORMAT } from "./backup";

// Restore a backup made by server/backup.ts. Only into an EMPTY database: one where the app has made its tables
// (the migrations ran) but nobody has signed up yet. A database with data in it is refused, so a restore can never
// overwrite or mix into a live agency. Run it with `bun server/restoreCli.ts <file>` (see handoff-content/restore-a-backup.md).

export class RestoreError extends Error {}

/**
 * The tables whose rows mean "this agency is in use": people, businesses, calls, chats, bookings. The app also writes
 * its own bookkeeping rows at start-up (settings, health, incidents), so a database that has only those still counts
 * as empty, and a restore replaces them.
 */
export const CORE_TABLES = ["orgs", "users", "memberships", "sessions", "clients", "client_access", "companies", "call_log", "webchat_conversations", "webchat_messages", "booking_requests", "contact_notes", "knowledge_items", "sms_threads", "calendar_events", "mailboxes", "number_requests", "followup_messages"];

/** The core tables that hold rows. Empty list = the database is empty. */
export async function tablesWithData(db: typeof sql = sql): Promise<string[]> {
  const tables: string[] = (await db`select relname from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relname <> 'schema_migrations'`).map((r: any) => r.relname).filter((t: string) => CORE_TABLES.includes(t));
  const full: string[] = [];
  for (const t of tables) {
    const [r] = await db.unsafe(`select exists (select 1 from "${t}") as has`);
    if (r.has) full.push(t);
  }
  return full.sort();
}

/** Lines of a .gz file, one at a time (the file can be bigger than memory). */
async function* lines(path: string): AsyncGenerator<string> {
  const reader = Bun.file(path).stream().pipeThrough(new DecompressionStream("gzip")).pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line) yield line;
    }
    if (done) break;
  }
  if (buf) yield buf;
}

export type RestoreResult = { tables: number; rows: number };

export async function restoreBackup(path: string, db: typeof sql = sql): Promise<RestoreResult> {
  const it = lines(path);
  const first = await it.next().catch(() => { throw new RestoreError("That file isn't a backup made by this app (it can't be read as a .gz)."); });
  let head: any;
  try { head = JSON.parse(first.value ?? ""); } catch { head = null; }
  if (!head || head.format !== FORMAT || !Array.isArray(head.tables)) throw new RestoreError("That file isn't a backup made by this app.");

  const have = new Set<string>((await db`select name from schema_migrations`.catch(() => [])).map((r: any) => r.name));
  const missing = (head.migrations as string[]).filter((m) => !have.has(m));
  if (missing.length) throw new RestoreError(`This backup is from a newer version of the app (it has ${missing[0]}). Update the app first, then restore.`);
  const known = new Set<string>((await db`select relname from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace`).map((r: any) => r.relname));
  const unknown = (head.tables as string[]).filter((t) => !known.has(t));
  if (unknown.length) throw new RestoreError(`This database has no table "${unknown[0]}". Start the app once on a version that matches the backup, then restore.`);

  const full = await tablesWithData(db);
  if (full.length) throw new RestoreError(`Refusing to restore: this database already has data (${full.slice(0, 4).join(", ")}${full.length > 4 ? ", ..." : ""}). Restore only into a new, empty database.`);

  let rows = 0;
  await db.begin(async (tx: any) => {
    // Start-up leftovers (the empty database's own bookkeeping) make way for the backup's rows.
    await tx.unsafe(`truncate ${(head.tables as string[]).map((t) => `"${t}"`).join(", ")} restart identity cascade`);
    let table = "";
    let batch: unknown[] = [];
    const flush = async () => {
      if (!batch.length) return;
      await tx.unsafe(`insert into "${table}" select * from jsonb_populate_recordset(null::"${table}", $1::jsonb)`, [JSON.stringify(batch)]);
      rows += batch.length;
      batch = [];
    };
    for await (const line of it) {
      const o = JSON.parse(line);
      if (!known.has(o.t) || !head.tables.includes(o.t)) throw new RestoreError(`The backup has a row for an unknown table "${o.t}".`);
      if (o.t !== table) { await flush(); table = o.t; }
      batch.push(o.r);
      if (batch.length >= 500) await flush();
    }
    await flush();
    // Serial ids carry on after the highest restored one.
    const seqs = await tx`
      select c.relname as t, a.attname as col, pg_get_serial_sequence(quote_ident(c.relname), a.attname) as seq
      from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace`;
    for (const s of seqs) {
      if (!s.seq) continue;
      await tx.unsafe(`select setval('${s.seq}', coalesce((select max("${s.col}") from "${s.t}"), 1), (select count(*) > 0 from "${s.t}"))`);
    }
  });
  return { tables: head.tables.length, rows };
}
