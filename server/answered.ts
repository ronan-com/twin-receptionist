import { resolveBrand } from "./brand";
import type { Business as Receptionist, IndustryKey } from "../src/lib/shared";
import type { Ctx } from "./accounts";
import { iso, sql } from "./db";

// The Answered UI's view of our data. Its screens expect Answered's row shapes
// (src/lib/app/types.ts, snake_case). A "business" there is one receptionist here
// (a row of `clients`), and a business membership is a `client_access` row.

// Answered's industry list (src/lib/app/constants.ts INDUSTRIES) to ours and back.
const FROM_ANSWERED: Record<string, IndustryKey> = {
  Dental: "dental",
  Healthcare: "health",
  Trades: "trades",
  Legal: "professional",
  Accounting: "professional",
  "Real estate": "property",
  "Salon & beauty": "beauty",
  Fitness: "other",
  Hospitality: "other",
  Automotive: "auto",
  "Property management": "property",
  "Professional services": "professional",
  Other: "other",
};
const TO_ANSWERED: Record<IndustryKey, string> = {
  dental: "Dental",
  health: "Healthcare",
  trades: "Trades",
  beauty: "Salon & beauty",
  property: "Real estate",
  auto: "Automotive",
  professional: "Professional services",
  other: "Other",
};

export const industryKeyOf = (label: unknown): IndustryKey =>
  FROM_ANSWERED[String(label ?? "")] ?? ((Object.keys(TO_ANSWERED) as IndustryKey[]).includes(label as IndustryKey) ? (label as IndustryKey) : "other");
export const industryLabelOf = (key: IndustryKey | string | undefined) => TO_ANSWERED[(key as IndustryKey) ?? "other"] ?? "Other";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "business";

// Answered's Business row (businesses table) for one receptionist, plus a few of our own fields.
export function answeredBusiness(
  r: Receptionist,
  extra: { orgId: string; orgName: string; sandbox: boolean; suspended: boolean },
) {
  const s = r.settings;
  const hours: Record<string, { open: string; close: string; closed: boolean }> = {};
  for (const [day, h] of Object.entries(s.hours ?? {})) hours[day] = { open: h.from, close: h.to, closed: !h.open };
  return {
    id: r.id,
    name: s.businessName,
    slug: `${slug(s.businessName)}-${r.id.slice(0, 6)}`,
    industry: industryLabelOf(s.industry),
    timezone: s.timezone,
    city: s.suburb || null,
    region: null,
    country: "AU",
    address_line1: s.address || null,
    postal_code: null,
    phone: r.phoneNumbers?.[0] ?? null,
    email: r.booking?.notifyEmail || null,
    website: null,
    is_demo: extra.sandbox,
    status: extra.suspended ? "paused" : "active",
    business_hours: hours,
    notification_prefs: {},
    recording_policy: {},
    default_transfer_number: null,
    created_by: null,
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
    // Ours (not in Answered's row):
    org_id: extra.orgId,
    org_name: extra.orgName,
    receptionist_name: s.receptionistName,
    phone_numbers: r.phoneNumbers ?? [],
  };
}
export type AnsweredBusiness = ReturnType<typeof answeredBusiness>;

// manager ≈ Answered's admin, viewer ≈ read_only (docs/ANSWERED_UI_PORT.md).
export const membershipRole = (role: string) => (role === "manager" ? "admin" : "read_only");

/**
 * The businesses this person works with in the Answered workspace (/app), with their
 * memberships in Answered's shape:
 *  - a business user: every receptionist shared with them, in any org
 *  - the platform team viewing as a business: that one (no membership: read-only staff view)
 *  - agency staff and the platform team: their current org's receptionists (no membership)
 */
export async function workspaceBusinesses(ctx: Ctx) {
  const pick = (where: "access" | "viewing" | "org") =>
    where === "access"
      ? sql`
          select c.id, c.data, c.org_id, o.name as org_name, o.sandbox, o.suspended_at, a.role as access_role, a.created_at as access_at
          from client_access a join clients c on c.id = a.client_id join orgs o on o.id = c.org_id
          join memberships m on m.org_id = c.org_id and m.user_id = a.user_id
          where a.user_id = ${ctx.user.id} order by c.data->'settings'->>'businessName'`
      : where === "viewing"
        ? sql`
          select c.id, c.data, c.org_id, o.name as org_name, o.sandbox, o.suspended_at, null as access_role, null as access_at
          from clients c join orgs o on o.id = c.org_id where c.id = ${ctx.viewing!.client}`
        : sql`
          select c.id, c.data, c.org_id, o.name as org_name, o.sandbox, o.suspended_at, null as access_role, null as access_at
          from clients c join orgs o on o.id = c.org_id where c.org_id = ${ctx.org!.id}
          order by c.data->'settings'->>'businessName'`;
  const rows: any[] = ctx.viewing?.client ? await pick("viewing") : ctx.role === "customer" ? await pick("access") : ctx.org ? await pick("org") : [];
  const businesses = await Promise.all(
    rows.map(async (r) => ({
      ...answeredBusiness({ ...r.data, id: r.id }, { orgId: r.org_id, orgName: r.org_name, sandbox: Boolean(r.sandbox), suspended: Boolean(r.suspended_at) }),
      // The company's branding (console), falling back to the agency's: themes /app.
      brand: await resolveBrand(r.org_id, r.id),
    })),
  );
  const memberships = rows
    .filter((r) => r.access_role)
    .map((r) => ({
      id: `${ctx.user.id}:${r.id}`,
      business_id: r.id,
      user_id: ctx.user.id,
      role: membershipRole(r.access_role),
      access_role: r.access_role as "manager" | "viewer",
      invited_by: null,
      created_at: iso(r.access_at),
      updated_at: iso(r.access_at),
    }));
  return { businesses, memberships };
}

// The client_access rows (with role) a business user has in their current org.
export async function clientAccessOf(ctx: Ctx): Promise<{ clientId: string; role: "manager" | "viewer" }[]> {
  if (ctx.viewing?.client) return [{ clientId: ctx.viewing.client, role: "viewer" }];
  if (ctx.role !== "customer" || !ctx.org) return [];
  const rows = await sql`
    select a.client_id, a.role from client_access a join clients c on c.id = a.client_id
    where a.user_id = ${ctx.user.id} and c.org_id = ${ctx.org.id}`;
  return rows.map((r: any) => ({ clientId: r.client_id, role: r.role }));
}

// Where this person's screens are: the console (/admin) for the platform team and
// agency staff, the workspace (/app) for business users.
export function consoleOf(ctx: Ctx): "platform" | "agency" | null {
  if (ctx.viewing) return ctx.viewing.client ? null : "agency";
  if (ctx.role === "customer") return null;
  if (ctx.user.platformAdmin) return "platform";
  return ctx.org ? "agency" : null;
}
