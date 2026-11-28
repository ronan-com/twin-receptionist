import type { Business } from "../src/lib/shared";
import { AU_MOBILE, providerNeedsTwilio } from "./textOwners";
import { ownedTwilioNumbers, twilioCredsFor } from "./twilio";

// Whether a receptionist's number can really text, for the Calls / Texts badges. A Twilio number: what Twilio
// says about it (any country). Anything else: an Australian mobile, the only numbers our Telnyx texting serves.

const TTL_MS = 60_000;
const WAIT_MS = 5_000;
const cache = new Map<string, { at: number; sms: Map<string, boolean> }>();
export const forgetNumberCaps = () => cache.clear();

/** Number -> can it text, for every number on the agency's Twilio account. Empty without one; the last answer if Twilio is slow or down. */
export async function twilioTextCaps(orgId: string): Promise<Map<string, boolean>> {
  let last = new Map<string, boolean>();
  try {
    const creds = await twilioCredsFor(orgId);
    if (!creds) return last;
    const key = `${orgId}|${creds.accountSid}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.sms;
    last = hit?.sms ?? last;
    const ask = ownedTwilioNumbers(creds).then((owned) => {
      const sms = new Map(owned.map((n) => [n.phoneNumber, n.sms]));
      cache.set(key, { at: Date.now(), sms });
      return sms;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<Map<string, boolean>>((done) => (timer = setTimeout(() => done(last), WAIT_MS)));
    return await Promise.race([ask, slow]).finally(() => clearTimeout(timer));
  } catch (err) {
    console.error(`[numbers ${orgId}] couldn't ask Twilio what its numbers can do:`, (err as Error).message);
    return last;
  }
}

export const numberCanText = (number: string, twilio: Map<string, boolean>): boolean => twilio.get(number) ?? AU_MOBILE.test(number);

/** For a list of receptionists (any agencies): can this agency's number text? Twilio is only asked where one of its numbers may be in the list. */
export async function textCapability(list: { orgId: string; client: Business }[]): Promise<(orgId: string, number: string) => boolean> {
  const orgs = [...new Set(list.filter((x) => providerNeedsTwilio(x.client)).map((x) => x.orgId))];
  const byOrg = new Map(await Promise.all(orgs.map(async (o) => [o, await twilioTextCaps(o)] as const)));
  return (orgId, number) => numberCanText(number, byOrg.get(orgId) ?? new Map());
}
