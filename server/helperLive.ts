import type { Business, Settings } from "../src/lib/shared";
import type { Ctx } from "./accounts";
import { agencySnapshot, attachReceptionist, createCompany, oneCompany } from "./routes/console";
import { audit } from "./audit";
import { sql } from "./db";
import { ValidationError } from "./prompt";
import { listClients, getOrgClient } from "./store";
import type { HelperDeps } from "./helper";
import { telnyx } from "./telnyx";
import type { Voice } from "../src/lib/shared";

// The live wiring of server/helper.ts: its confirmed changes go through the same functions the
// screens use (the wizard's createClient, the receptionist editor's updateClient, the console's
// company and knowledge code), always as the signed-in person in their own org.

type Fns = {
  createClient: (orgId: string, input: unknown, opts?: { quick?: boolean }) => Promise<Business>;
  updateClient: (existing: Business, input: unknown) => Promise<Business>;
  snapshot: () => ReturnType<typeof agencySnapshot>;
  product: string;
  speak?: HelperDeps["speak"];
};

const KNOWLEDGE_MAX = 200;

/** FAQs become published knowledge items, as the wizard does; the receptionist is then re-saved so its script includes them. */
async function addFaqs(clientId: string, faqs: { q: string; a: string }[]): Promise<void> {
  const [{ n }] = await sql`select count(*)::int as n from knowledge_items where client_id = ${clientId}`;
  if (n + faqs.length > KNOWLEDGE_MAX) throw new ValidationError("That would be more knowledge items than one receptionist can hold. Remove some first.");
  for (const f of faqs) {
    await sql`
      insert into knowledge_items (client_id, question, answer, enabled, kind, status)
      values (${clientId}, ${f.q}, ${f.a}, true, 'faq', 'published')`;
  }
}

export function helperDeps(ctx: Ctx, f: Fns): HelperDeps {
  const orgId = ctx.org!.id;
  return {
    product: f.product,
    snapshot: f.snapshot,
    speak: f.speak,
    receptionists: () => listClients(orgId),
    async create(a) {
      let companyId = a.clientId ?? "";
      let madeCompany = false;
      if (companyId) await oneCompany(ctx, companyId); // one of this agency's own clients
      else {
        companyId = await createCompany(ctx, { name: a.businessName, industry: a.industry });
        madeCompany = true;
      }
      try {
        const input: Partial<Settings> & Record<string, unknown> = { businessName: a.businessName, industry: a.industry, services: a.services };
        if (a.industryLabel) input.industryLabel = a.industryLabel;
        if (a.greeting) input.greeting = a.greeting;
        if (a.about) input.about = a.about;
        if (a.hours) input.hours = a.hours;
        let created = await f.createClient(orgId, input, { quick: true });
        await attachReceptionist(ctx, companyId, { clientId: created.id });
        if (a.faqs.length) {
          await addFaqs(created.id, a.faqs);
          created = await f.updateClient(created, created.settings);
        }
        await audit(ctx, "receptionist.create", { business: a.businessName, summary: `Helper made a receptionist for ${a.businessName}` }, { clientId: created.id });
        return { id: created.id, businessName: created.settings.businessName, clientPage: `/admin/receptionists/${created.id}` };
      } catch (err) {
        if (madeCompany) await sql`delete from companies where id = ${companyId} and not exists (select 1 from clients where company_id = ${companyId})`.catch(() => {});
        throw err;
      }
    },
    async update(a) {
      const existing = await getOrgClient(orgId, a.receptionistId);
      if (!existing) throw new ValidationError("That receptionist no longer exists.");
      const next: Record<string, unknown> = { ...existing.settings };
      if (a.businessName !== undefined) next.businessName = a.businessName;
      if (a.industry !== undefined) {
        next.industry = a.industry;
        next.industryLabel = a.industryLabel ?? "";
      }
      if (a.greeting !== undefined) next.greeting = a.greeting;
      if (a.about !== undefined) next.about = a.about;
      if (a.services !== undefined) next.services = a.services;
      if (a.hours !== undefined) next.hours = a.hours;
      if (a.addFaqs.length) await addFaqs(existing.id, a.addFaqs);
      const saved = await f.updateClient(existing, next);
      await audit(ctx, "receptionist.update", { business: saved.settings.businessName, summary: `Helper updated ${saved.settings.businessName}` }, { clientId: saved.id });
      return { businessName: saved.settings.businessName };
    },
  };
}

/**
 * Helper's replies read aloud in the agency's own phone voice: the same Telnyx text-to-speech call as
 * the voice Play button (server/voice/telnyx.ts telnyxVoicePreview), with the reply as the text.
 * null (so the browser's own voice reads it) when there is no Telnyx voice or the call fails; a
 * failure is remembered per agency for ten minutes so a missing key isn't retried on every reply.
 */
const failedAt = new Map<string, number>();
export function telnyxSpeaker(orgId: string, voices: () => Promise<Voice[]>): (text: string) => Promise<Uint8Array | null> {
  return async (text) => {
    if (Date.now() - (failedAt.get(orgId) ?? 0) < 10 * 60_000) return null;
    try {
      const list = await voices();
      const voice = (list.find((v) => v.recommended) ?? list[0])?.id;
      if (!voice || !/^Telnyx\.[A-Za-z0-9_.-]{2,100}$/.test(voice)) return null;
      const res = await telnyx<{ base64_audio?: string }>("POST", "/text-to-speech/speech", { text: text.slice(0, 500), voice, language: "en-AU", output_type: "base64_output" });
      if (!res?.base64_audio) throw new Error("no audio");
      return new Uint8Array(Buffer.from(res.base64_audio, "base64"));
    } catch {
      failedAt.set(orgId, Date.now());
      return null;
    }
  };
}
