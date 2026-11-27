import type { Business } from "../../src/lib/shared";
import type { Ctx } from "../accounts";
import { createLimiter } from "../assistant";
import { audit } from "../audit";
import { sql } from "../db";
import { ValidationError } from "../prompt";
import { cleanDraft, draftFromWebsite, IMPORT_LIMITS, type Draft } from "../siteImport";
import { json, readBody } from "./http";

// Import knowledge from the business's website (the Knowledge page's "Import from website").
//   POST /api/manage/<id>/knowledge/import/draft   { url }    reads the site, returns drafts. Saves nothing.
//   POST /api/manage/<id>/knowledge/import/accept  { items }  saves the drafts the owner kept, as new items.
// Accepting only ever adds: an item whose question already exists is skipped, never replaced.

const KNOWLEDGE_MAX = 200; // same ceiling as adding items by hand (server/routes/manage.ts)
const limiter = createLimiter(5, 10 * 60_000);

export type ImportArgs = {
  client: Business;
  ctx: Ctx;
  method: string;
  rest: string;
  req: Request;
  where: { orgId: string; clientId: string };
  /** Pushes the new knowledge to the receptionist (manage.ts resync). */
  resync: () => Promise<{ synced: boolean; warning?: string }>;
  /** Tests swap the website reader and the AI. */
  draft?: typeof draftFromWebsite;
};

const norm = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim();

export async function knowledgeImportRoutes(a: ImportArgs): Promise<Response | null> {
  if (a.method !== "POST") return null;

  if (a.rest === "/knowledge/import/draft") {
    const body = await readBody(a.req);
    const hit = limiter.take(a.client.id);
    if (!hit.ok) return json({ error: `That's a lot of imports. Try again in ${Math.ceil(hit.retryAfter / 60)} minute(s).` }, 429);
    const { pages, drafts } = await (a.draft ?? draftFromWebsite)(body?.url);
    const existing = new Set((await sql`select question from knowledge_items where client_id = ${a.client.id}`).map((r: any) => norm(String(r.question))));
    return json({ pages, drafts: drafts.map((d) => ({ ...d, exists: existing.has(norm(d.question)) })) });
  }

  if (a.rest === "/knowledge/import/accept") {
    const body = await readBody(a.req);
    const items: Draft[] = [];
    for (const raw of Array.isArray(body?.items) ? body.items.slice(0, IMPORT_LIMITS.drafts) : []) {
      const d = cleanDraft(raw);
      if (d && !items.some((x) => norm(x.question) === norm(d.question))) items.push(d);
    }
    if (!items.length) throw new ValidationError("Choose at least one item to add.");
    const rows = await sql`select question from knowledge_items where client_id = ${a.client.id}`;
    const existing = new Set(rows.map((r: any) => norm(String(r.question))));
    const fresh = items.filter((d) => !existing.has(norm(d.question)));
    if (rows.length + fresh.length > KNOWLEDGE_MAX) throw new ValidationError("That would go over the most knowledge items one receptionist can hold. Remove some first.");
    for (const d of fresh) {
      await sql`
        insert into knowledge_items (client_id, question, answer, enabled, kind, status)
        values (${a.client.id}, ${d.question}, ${d.answer}, true, ${d.type}, 'published')`;
    }
    const synced = fresh.length ? await a.resync() : { synced: true };
    if (fresh.length) await audit(a.ctx, "knowledge.imported", { summary: `Imported ${fresh.length} knowledge item${fresh.length === 1 ? "" : "s"} from the website` }, a.where);
    return json({ added: fresh.length, skipped: items.length - fresh.length, ...synced });
  }
  return null;
}
