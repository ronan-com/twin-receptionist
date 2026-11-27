import type { Business } from "../src/lib/shared";
import { sql } from "./db";
import { requireTwilio, sendTwilioSms } from "./twilio";
import { currentOrg } from "./telnyx";
import { sendTelnyxText } from "./texting";
import { providerOfClient } from "./voice/config";

// Where a receptionist's texts go out (the text bot's replies, text-back, reminders, missed-call, reviews).
// A Telnyx receptionist texts through Telnyx's messaging API from its own mobile number (server/texting.ts).
// A Vapi receptionist texts through Twilio's Messages API, from a Twilio number of the agency's that it
// answers (server/twilio.ts). Everything that decides whether to text (quiet hours, once only) lives
// with the callers and is the same for both; people who texted STOP are refused here, for both.

export class SmsOptedOut extends Error {
  constructor() {
    super("This person texted STOP, so no more texts are sent to them.");
  }
}

/** Digits only, +61 folded to 0: the same person however the number was written. */
export const contactKey = (n: string) => {
  const d = String(n ?? "").replace(/\D/g, "");
  return d.startsWith("61") && d.length >= 11 ? `0${d.slice(2)}` : d;
};

export async function isOptedOut(clientId: string, contact: string): Promise<boolean> {
  const [r] = await sql`select 1 from sms_optouts where client_id = ${clientId} and contact = ${contactKey(contact)}`;
  return Boolean(r);
}

export async function setOptOut(clientId: string, contact: string, out: boolean): Promise<void> {
  if (out) await sql`insert into sms_optouts (client_id, contact) values (${clientId}, ${contactKey(contact)}) on conflict do nothing`;
  else await sql`delete from sms_optouts where client_id = ${clientId} and contact = ${contactKey(contact)}`;
}

/** Sends one text. `from` is the number smsNumberOf gave. `meta` is for the caller's own records. */
export async function sendSms(client: Business, o: { from: string; to: string; text: string; meta?: Record<string, string> }): Promise<void> {
  if (await isOptedOut(client.id, o.to)) throw new SmsOptedOut();
  if (providerOfClient(client) === "vapi") {
    await sendTwilioSms(await requireTwilio(currentOrg()), o.from, o.to, o.text);
    return;
  }
  await sendTelnyxText(o);
}
