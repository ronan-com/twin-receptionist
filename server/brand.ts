import type { Brand } from "../src/lib/shared";
import { requireRole, type Ctx } from "./accounts";
import { sql } from "./db";
import { ValidationError } from "./prompt";

// Logo, background and colours. An agency brands its own dashboard and its clients'
// customer dashboards; a company (client) can set its own, and a single receptionist
// can override those. Resolution: receptionist, then its company, then the agency.

const LIMITS = { logo: 400_000, background: 1_500_000 } as const;
type Kind = keyof typeof LIMITS;
export type Scope = { orgId: string; clientId: string | null; companyId?: string | null };
// Colour keys shared with the workspace (server/routes/manage.ts): primaryColor, accentColor.
const COLOURS = ["bgColor", "primaryColor", "accentColor", "sidebarColor"] as const;

// Only PNG, JPEG and WebP. Never SVG (it can carry scripts), and the type comes from
// the file's own first bytes, not from what the browser claims.
function sniff(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

const raw = async (s: Scope): Promise<Record<string, string>> => {
  const [r] = s.companyId
    ? await sql`select brand from companies where id = ${s.companyId} and org_id = ${s.orgId}`
    : s.clientId
      ? await sql`select brand from clients where id = ${s.clientId} and org_id = ${s.orgId}`
      : await sql`select brand from orgs where id = ${s.orgId}`;
  return (r?.brand ?? {}) as Record<string, string>;
};

const url = (id?: string) => (id ? `/brand/${id}` : "");
const asBrand = (b: Record<string, string>): Brand => ({
  logo: url(b.logo),
  bgColor: b.bgColor ?? "",
  bgImage: url(b.bgImage),
  primaryColor: b.primaryColor ?? "",
  accentColor: b.accentColor ?? "",
  sidebarColor: b.sidebarColor ?? "",
});

// What is set at exactly this level (no inheritance), for the editor.
export async function ownBrand(s: Scope): Promise<Brand> {
  return asBrand(await raw(s));
}

// What the screen shows: a business's own settings win over its agency's.
export async function resolveBrand(orgId: string, clientId: string | null = null): Promise<Brand> {
  const o = await raw({ orgId, clientId: null });
  const c = clientId ? await raw({ orgId, clientId }) : {};
  const [co] = clientId ? await sql`select company_id from clients where id = ${clientId} and org_id = ${orgId}` : [];
  const m = co?.company_id ? await raw({ orgId, clientId: null, companyId: co.company_id }) : {};
  const pick = (k: string) => c[k] || m[k] || o[k];
  return asBrand(Object.fromEntries(["logo", "bgImage", ...COLOURS].map((k) => [k, pick(k)])) as Record<string, string>);
}

async function patch(s: Scope, change: Record<string, string | null>): Promise<void> {
  const next = { ...(await raw(s)) };
  for (const [k, v] of Object.entries(change)) {
    if (v === null || v === "") delete next[k];
    else next[k] = v;
  }
  if (s.companyId) await sql`update companies set brand = ${next as any} where id = ${s.companyId} and org_id = ${s.orgId}`;
  else if (s.clientId) await sql`update clients set brand = ${next as any} where id = ${s.clientId} and org_id = ${s.orgId}`;
  else await sql`update orgs set brand = ${next as any} where id = ${s.orgId}`;
}

async function dropAsset(s: Scope, kind: Kind): Promise<void> {
  await sql`
    delete from brand_assets where org_id = ${s.orgId} and client_id is not distinct from ${s.clientId}
      and company_id is not distinct from ${s.companyId ?? null} and kind = ${kind}`;
}

export async function uploadAsset(ctx: Ctx, s: Scope, kind: Kind, bytes: Uint8Array): Promise<void> {
  requireRole(ctx, "admin");
  if (bytes.length === 0) throw new ValidationError("Choose an image to upload.");
  if (bytes.length > LIMITS[kind]) {
    throw new ValidationError(`That image is too big. Keep a ${kind} under ${Math.round(LIMITS[kind] / 1000)} KB.`);
  }
  const type = sniff(bytes);
  if (!type) throw new ValidationError("Use a PNG, JPEG or WebP image.");
  const id = crypto.randomUUID();
  await dropAsset(s, kind);
  await sql`insert into brand_assets (id, org_id, client_id, company_id, kind, content_type, data) values (${id}, ${s.orgId}, ${s.clientId}, ${s.companyId ?? null}, ${kind}, ${type}, ${bytes})`;
  await patch(s, { [kind === "logo" ? "logo" : "bgImage"]: id });
}

export async function changeBrand(ctx: Ctx, s: Scope, input: any): Promise<void> {
  requireRole(ctx, "admin");
  for (const k of COLOURS) {
    if (input?.[k] === undefined) continue;
    const c = String(input[k]);
    if (c !== "" && !/^#[0-9a-fA-F]{6}$/.test(c)) throw new ValidationError("Pick a colour.");
    await patch(s, { [k]: c.toLowerCase() });
  }
  if (input?.removeLogo === true) {
    await dropAsset(s, "logo");
    await patch(s, { logo: null });
  }
  if (input?.removeBackground === true) {
    await dropAsset(s, "background");
    await patch(s, { bgImage: null });
  }
}

// Public: the asset id is a random UUID and logos aren't secret.
export async function serveAsset(id: string): Promise<Response> {
  const [a] = await sql`select content_type, data from brand_assets where id = ${id}`;
  if (!a) return new Response("Not found", { status: 404 });
  return new Response(a.data, {
    headers: {
      "Content-Type": a.content_type,
      // A replaced image gets a new id, so the old one can be cached for good.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
