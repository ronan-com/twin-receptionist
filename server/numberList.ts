import type { AgencyNumber, Business, TextChoice } from "../src/lib/shared";
import { numberIsLive } from "../src/lib/ownNumbers";
import { ownedUnassigned, sampleOwned } from "./ownNumbers";
import { isDemo } from "./sandbox";
import { AU_MOBILE, providerNeedsTwilio, receptionistName, textHolder } from "./textOwners";
import { numberCanText, twilioTextCaps } from "./numberCaps";
import { ownedTwilioNumbers, requireTwilio } from "./twilio";
import { providerOfClient } from "./voice/config";

// Every number an agency has, in one list: the ones its receptionists answer, the unassigned ones on its own
// Telnyx account and all of its Twilio account's, each with who answers its calls and its texts. The Numbers
// page shows it; the "Text number" dropdown is the ones in it that can text.

export type NumberAccess = {
  /** May list the agency's Twilio account (phoneAccount.canUseTwilio). */
  twilio: boolean;
  /** May list the agency's own Telnyx account (phoneAccount.canUseOwnNumbers). */
  telnyx: boolean;
  /** Local test servers: the Telnyx account is a pretend one. */
  pretendTelnyx?: boolean;
};

export async function agencyNumbers(orgId: string, clients: Business[], access: NumberAccess): Promise<{ numbers: AgencyNumber[]; problems: string[] }> {
  const problems: string[] = [];
  const tried = async <T>(what: string, run: () => Promise<T[]>): Promise<T[]> =>
    run().catch((err) => {
      problems.push(`Couldn't read your ${what} numbers. ${(err as Error).message}`);
      return [];
    });
  const [twilio, owned] = await Promise.all([
    access.twilio ? tried("Twilio", async () => ownedTwilioNumbers(await requireTwilio(orgId))) : [],
    access.telnyx ? tried("Telnyx", async () => (access.pretendTelnyx ? sampleOwned(clients) : ownedUnassigned(clients))) : [],
  ]);
  // A number left on a deleted assistant rings nobody, whatever an old receptionist still has saved.
  const dead = new Set(owned.filter((n) => n.orphaned).map((n) => n.phoneNumber));
  const answering = dead.size ? clients.map((c) => (providerOfClient(c) === "telnyx" ? { ...c, phoneNumbers: (c.phoneNumbers ?? []).filter((n) => !dead.has(n)) } : c)) : clients;
  const user = (c: Business | null | undefined) => (c ? { id: c.id, name: receptionistName(c) } : null);
  const rows = new Map<string, AgencyNumber>();
  const row = (number: string, more: Pick<AgencyNumber, "provider" | "calls" | "sms"> & Partial<AgencyNumber>) =>
    rows.set(number, { number, callsBy: null, pending: false, ownedId: "", connectedTo: "", ...more, textsBy: user(textHolder(answering, number)) });

  // What Twilio says its numbers can do, also for someone who may not list the account.
  const caps = twilio.length ? new Map(twilio.map((n) => [n.phoneNumber, n.sms])) : clients.some(providerNeedsTwilio) ? await twilioTextCaps(orgId) : new Map<string, boolean>();
  // Numbers that ring a receptionist.
  for (const c of answering) {
    for (const number of c.phoneNumbers ?? []) {
      const onTwilio = twilio.find((n) => n.phoneNumber === number);
      const source = c.numberSources?.[number];
      const provider = onTwilio || source === "twilio" ? "twilio" : providerOfClient(c) === "telnyx" || source === "telnyx" ? "telnyx" : "vapi";
      row(number, { provider, calls: true, sms: numberCanText(number, caps), callsBy: user(c), pending: (c.pendingNumbers ?? []).includes(number) });
    }
  }
  // The rest of the Twilio account.
  for (const n of twilio) {
    if (!rows.has(n.phoneNumber)) row(n.phoneNumber, { provider: "twilio", calls: n.voice, sms: n.sms });
  }
  // Numbers on the Telnyx account that ring no receptionist.
  for (const n of owned) {
    if (rows.has(n.phoneNumber)) continue;
    const live = numberIsLive(n.status);
    row(n.phoneNumber, { provider: "telnyx", calls: true, sms: AU_MOBILE.test(n.phoneNumber), pending: !live, ownedId: n.id, connectedTo: n.connectionName || (n.connectionId ? "another service" : "") });
  }
  return { numbers: [...rows.values()].sort((a, b) => a.number.localeCompare(b.number)), problems };
}

/** The numbers a receptionist can pick for texts: every live Twilio number that can text, and Telnyx Australian mobiles. */
export function textChoicesFrom(client: Business, numbers: AgencyNumber[]): TextChoice[] {
  // A demo receptionist's pick is only recorded, so anything in the list is fine.
  return numbers
    .filter((n) => n.sms && !n.pending && (n.provider === "twilio" || (n.provider === "telnyx" && (AU_MOBILE.test(n.number) || isDemo(client.assistantId)))))
    .map((n) => ({ number: n.number, via: n.provider === "twilio" ? "twilio" : "telnyx", usedBy: n.textsBy && n.textsBy.id !== client.id ? n.textsBy.name : "" }));
}
