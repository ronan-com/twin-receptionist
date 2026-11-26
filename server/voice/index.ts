import type { Business, VoiceProviderId } from "../../src/lib/shared";
import { currentOrg } from "../telnyx";
import { providerOfClient, providerOfOrg } from "./config";
import type { VoiceProvider } from "./provider";
import { telnyxProvider } from "./telnyx";
import { vapiProvider } from "./vapi";

// The one way into the voice engines. A receptionist runs on the engine it was made on
// (Business.voiceProvider, Telnyx when missing); what has no receptionist yet (the voice
// list, number search, a new receptionist) uses the agency's choice.

// Looked up when used, not when this file loads: the engines import files that import this one.
export const providerById = (id: VoiceProviderId): VoiceProvider => (id === "vapi" ? vapiProvider : telnyxProvider);

/** The engine a receptionist's assistant lives on. */
export const voiceFor = (client: Pick<Business, "voiceProvider"> | null | undefined): VoiceProvider => providerById(providerOfClient(client));

/** The engine an agency (default: the org this work runs for) makes new receptionists on. */
export async function voiceForOrg(orgId: string | null = currentOrg()): Promise<VoiceProvider> {
  return providerById(await providerOfOrg(orgId));
}
