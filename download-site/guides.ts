// Which step-by-step guides belong to which wizard step, and how the AI helper is given the same words.
// The guides themselves are Markdown in handoff-content/providers/<id>.md: numbered steps, then a
// "## Common problems" list. One source: the wizard's "Step-by-step guide" panel, the /guide page and the
// helper's prompt all read those same files, so what the helper says always matches what the page shows.
import { allHowTos, howTo, type ProviderId } from "./content";
import type { StepId } from "./store";

/** Steps that ask the buyer to do something at another company: each has at least one guide. */
export const STEP_GUIDES: Partial<Record<StepId, ProviderId[]>> = {
  railway: ["railway-token"],
  phones: ["telnyx-account", "telnyx-api-key", "vapi-account", "twilio-account"],
  vapi: ["vapi-account", "twilio-account"],
  twilio: ["twilio-account"],
  ai: ["openrouter-key"],
  email: ["resend"],
  domain: ["cloudflare-domain", "registrar-nameservers", "cloudflare-token", "registrar-dns-records"],
  calendars: ["google-oauth", "microsoft-oauth"],
  install: ["install"],
};
/** Steps with nothing to do at another company (a name and colours, a "Connect more" menu, the finish line). */
export const STEPS_WITHOUT_GUIDE: StepId[] = ["welcome", "brand", "extras", "done"];

const stripLinks = (md: string) => md.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)");

/** One guide as compact plain text for the helper: title, time and cost, then the steps and the common problems. */
export function guideForHelper(id: string): string {
  const h = howTo(id);
  const head = [h.time, h.cost].filter(Boolean).join("; ");
  return `### ${h.title}${head ? ` (${head})` : ""}${h.checked ? ` [checked ${h.checked}]` : ""}\n${stripLinks(h.md).replace(/\*\*/g, "").trim()}`;
}

/** Every guide, for the helper's prompt. */
export function allGuidesForHelper(): string {
  return allHowTos().map((h) => guideForHelper(h.id)).join("\n\n");
}

/** The titles of the guides for the page the buyer has open, so the helper starts from them (the full text is already in its prompt). */
export function guideTitlesForStep(step: string): string[] {
  return (STEP_GUIDES[step as StepId] || []).map((id) => howTo(id).title);
}
