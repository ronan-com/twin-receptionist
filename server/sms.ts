import type { Business } from "../src/lib/shared";
import { requireTwilio, sendTwilioSms } from "./twilio";
import { currentOrg, telnyx } from "./telnyx";
import { providerOfClient } from "./voice/config";

// Where a receptionist's follow-up texts (text-back, reminders, missed-call, reviews) go out.
// A Telnyx receptionist texts through its Telnyx assistant, from its own mobile number.
// A Vapi receptionist texts through Twilio's Messages API, from a Twilio number of the agency's
// that it answers (server/twilio.ts). Everything that decides whether to text (quiet hours, once
// only, opt-outs) lives with the callers and is the same for both.

/** Sends one text. `from` is the number smsNumberOf gave. `meta` is kept with the Telnyx conversation. */
export async function sendSms(client: Business, o: { from: string; to: string; text: string; meta: Record<string, string> }): Promise<void> {
  if (providerOfClient(client) === "vapi") {
    await sendTwilioSms(await requireTwilio(currentOrg()), o.from, o.to, o.text);
    return;
  }
  await telnyx("POST", `/ai/assistants/${client.assistantId}/chat/sms`, {
    from: o.from,
    to: o.to,
    text: o.text,
    should_create_conversation: true,
    conversation_metadata: o.meta,
  });
}
