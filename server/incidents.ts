import { sql } from "./db";

// Incidents: things that went wrong in the background (tool hooks, the call sync,
// provider calls). The same open problem is counted on one row rather than a new
// row every minute. Never throws.

export type IncidentInput = {
  kind: string;
  message: string;
  orgId?: string | null;
  clientId?: string | null;
  detail?: Record<string, unknown>;
};

export async function recordIncident(i: IncidentInput): Promise<void> {
  const message = i.message.slice(0, 500);
  const detail = i.detail ?? {};
  try {
    const [open] = await sql`
      select id from incidents
      where status = 'open' and kind = ${i.kind} and message = ${message}
        and client_id is not distinct from ${i.clientId ?? null} and org_id is not distinct from ${i.orgId ?? null}
      order by created_at desc limit 1`;
    if (open) {
      await sql`
        update incidents set detail = detail || ${{ ...detail, lastAt: new Date().toISOString() } as any}::jsonb
          || jsonb_build_object('count', coalesce((detail->>'count')::int, 1) + 1)
        where id = ${open.id}`;
      return;
    }
    await sql`
      insert into incidents (org_id, client_id, kind, message, detail)
      values (${i.orgId ?? null}, ${i.clientId ?? null}, ${i.kind}, ${message}, ${{ ...detail, count: 1 } as any})`;
  } catch (err) {
    console.error(`[incident ${i.kind}]`, (err as Error).message);
  }
}

// Marks open incidents of this kind (for one receptionist, or platform-wide) as resolved.
export async function resolveIncidents(kind: string, clientId: string | null = null): Promise<void> {
  try {
    await sql`
      update incidents set status = 'resolved', resolved_at = now()
      where status = 'open' and kind = ${kind} and client_id is not distinct from ${clientId}`;
  } catch (err) {
    console.error(`[incident ${kind}] resolve`, (err as Error).message);
  }
}
