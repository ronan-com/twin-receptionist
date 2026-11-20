import { SQL } from "bun";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Postgres: a local Docker container in development, Supabase or AWS RDS in the
// cloud. Set DATABASE_URL in ~/aibiz/.env (or the host's environment).

const URL = process.env.DATABASE_URL ?? "";
if (!URL) {
  console.error("DATABASE_URL is not set. Add it to ~/aibiz/.env (see .env.example) and restart.");
  process.exit(1);
}

// For RDS or Supabase with sslmode=verify-full, DATABASE_CA_FILE can point at the
// provider's CA bundle (e.g. /etc/ssl/rds-ca.pem) so the server's certificate is checked.
const CA = process.env.DATABASE_CA_FILE ?? "";

export const sql = new SQL(URL, {
  max: Number(process.env.DATABASE_POOL ?? 10),
  ...(CA ? { tls: { ca: readFileSync(CA, "utf8"), rejectUnauthorized: true } } : {}),
  // Supabase's transaction pooler (port 6543) can't use prepared statements.
  prepare: !/:6543\//.test(URL),
});

const DIR = join(import.meta.dir, "migrations");

// Applies each file in server/migrations once, in name order. Safe when several
// servers start at the same time: they queue on an advisory lock.
export async function migrate(): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(727274001)`;
    await tx`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await tx`select name from schema_migrations`).map((r: any) => r.name));
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      await tx.unsafe(readFileSync(join(DIR, file), "utf8"));
      await tx`insert into schema_migrations (name) values (${file})`;
      console.log(`[db] applied ${file}`);
    }
  });
}

export const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : "");
