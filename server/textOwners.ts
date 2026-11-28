import type { Business } from "../src/lib/shared";
import { listClients, orgOfClient } from "./store";
import { providerOfClient } from "./voice/config";

// Which receptionist answers texts on which number. A number serves one receptionist's texts only.
// A picked number (Business.textNumber) wins; without one a receptionist uses its own numbers that can text
// (Telnyx: Australian mobiles; Vapi: its Twilio numbers), except any another receptionist has picked.
// Only receptionists with Texts on hold a number.

export const AU_MOBILE = /^\+614\d{8}$/;

export const wantsTexts = (client: Pick<Business, "textsPref">) => client.textsPref !== "off";

export const receptionistName = (c: Business) => c.settings.receptionistName || c.settings.businessName || "another receptionist";

/** Whether any of a receptionist's numbers may be a Twilio one (Vapi answers those). */
export const providerNeedsTwilio = (c: Business) =>
  Boolean(c.phoneNumbers?.length) && (providerOfClient(c) === "vapi" || Object.values(c.numberSources ?? {}).includes("twilio"));

/** The agency's receptionists (this one included); empty if it can't be looked up. */
export async function agencyClients(clientId: string): Promise<Business[]> {
  try {
    const orgId = await orgOfClient(clientId);
    return orgId ? await listClients(orgId) : [];
  } catch (err) {
    console.error(`[texting ${clientId}] couldn't read the other receptionists:`, (err as Error).message);
    return [];
  }
}

/** The other receptionist (Texts on) that picked this number. */
const pickedBy = (clients: Business[], number: string, exceptId: string) =>
  clients.find((c) => c.id !== exceptId && wantsTexts(c) && c.textNumber?.number === number) ?? null;

/** The receptionist, other than `exceptId`, that answers texts on this number; null when it's free. */
export function textHolder(clients: Business[], number: string, exceptId = ""): Business | null {
  const picked = pickedBy(clients, number, exceptId);
  if (picked) return picked;
  return (
    clients.find(
      (c) =>
        c.id !== exceptId && wantsTexts(c) && !c.textNumber && (c.phoneNumbers ?? []).includes(number) && !(c.pendingNumbers ?? []).includes(number) &&
        (providerOfClient(c) === "vapi" || AU_MOBILE.test(number)) && !pickedBy(clients, number, c.id),
    ) ?? null
  );
}

/** Of these numbers (a receptionist's own), the ones no other receptionist has picked for its texts. */
export async function notPickedElsewhere(clientId: string, numbers: string[]): Promise<string[]> {
  if (!numbers.length) return numbers;
  const clients = await agencyClients(clientId);
  return numbers.filter((n) => !pickedBy(clients, n, clientId));
}

/**
 * Of these numbers, the ones whose Twilio text address should point at this receptionist (Vapi, whose calls
 * numbers come from Twilio): none with Texts off, only the picked one when a number was picked.
 */
export async function twilioTextTargets(client: Business, numbers: string[]): Promise<string[]> {
  if (!wantsTexts(client)) return [];
  if (client.textNumber) return client.textNumber.via === "twilio" && numbers.includes(client.textNumber.number) ? [client.textNumber.number] : [];
  return notPickedElsewhere(client.id, numbers);
}
