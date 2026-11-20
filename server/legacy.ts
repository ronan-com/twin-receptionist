import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { sql } from "./db";

// Before accounts existed, everything lived in JSON files in data/. The first
// account to sign up takes those receptionists over; the files are then renamed
// so this never runs twice.

const DIR = process.env.LEGACY_DATA_DIR ?? join(import.meta.dir, "..", "data");
const file = (name: string) => join(DIR, name);

function readJson(name: string): any {
  try {
    return JSON.parse(readFileSync(file(name), "utf8"));
  } catch {
    return null;
  }
}

export async function importLegacyData(orgId: string): Promise<void> {
  const businesses = readJson("businesses.json");
  const clients: any[] = Array.isArray(businesses?.clients) ? businesses.clients : [];
  if (!clients.length) return;
  const mailboxes = readJson("mailboxes.json") ?? {};
  const requests = readJson("requests.json") ?? {};
  const publicUrl = readJson("public-url.json");

  // Calendars set up on n8n: the demo one becomes the built-in calendar.
  for (const c of clients) {
    if (!c.booking) continue;
    if (c.booking.provider === "demo") c.booking.provider = "builtin";
    delete c.booking.workflowId;
    delete c.booking.tableId;
  }

  await sql.begin(async (tx) => {
    for (const c of clients) {
      await tx`
        insert into clients (id, org_id, data, connect_token_hash, created_at, updated_at)
        values (${c.id}, ${orgId}, ${c}, ${c.connect?.tokenHash ?? null}, ${c.createdAt}, ${c.updatedAt})
        on conflict (id) do nothing`;
      if (mailboxes[c.id]) {
        await tx`insert into mailboxes (client_id, data) values (${c.id}, ${mailboxes[c.id]}) on conflict do nothing`;
      }
      // Stored newest first; insert oldest first so ids keep the order.
      for (const r of [...(requests[c.id] ?? [])].reverse()) {
        await tx`insert into booking_requests (client_id, data, created_at) values (${c.id}, ${r}, ${r.at ?? new Date().toISOString()})`;
      }
    }
    if (publicUrl?.url) {
      await tx`insert into app_settings (key, value) values ('public_url', ${publicUrl}) on conflict do nothing`;
    }
  });

  for (const name of ["businesses.json", "mailboxes.json", "requests.json", "public-url.json"]) {
    if (existsSync(file(name))) renameSync(file(name), file(`${name}.imported`));
  }
  console.log(`[legacy import] moved ${clients.length} receptionist(s) into the first account`);
}
