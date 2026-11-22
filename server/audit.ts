import type { Ctx } from "./accounts";
import { sql } from "./db";

// The audit trail: one row per key action (sign-ups, settings changes, invites...).
// Never throws: a failed audit write is logged and the action goes ahead.

export type AuditActor = Pick<Ctx, "user" | "org"> | { user: { id: string } | null; org: { id: string } | null };

export async function audit(
  ctx: AuditActor | null,
  action: string,
  detail: Record<string, unknown> = {},
  where: { orgId?: string | null; clientId?: string | null } = {},
): Promise<void> {
  const orgId = where.orgId ?? ctx?.org?.id ?? null;
  if (!orgId) return;
  try {
    await sql`
      insert into audit_log (org_id, client_id, actor, action, detail)
      values (${orgId}, ${where.clientId ?? null}, ${ctx?.user?.id ?? null}, ${action.slice(0, 80)}, ${detail as any})`;
  } catch (err) {
    console.error(`[audit ${action}]`, (err as Error).message);
  }
}
