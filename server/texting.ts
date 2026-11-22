import type { Business, TextingState } from "../src/lib/shared";
import { ValidationError } from "./prompt";
import { TelnyxError, telnyx } from "./telnyx";

// Texting is hosted by Telnyx, so nothing here needs a public address.
// Turning "messaging" on for an assistant makes Telnyx create a messaging profile
// linked to it (ai_assistant_id). Any number attached to that profile has its
// texts answered by the assistant, using the same script as calls.

// A cap on what one receptionist can spend on texts per day, so a reply loop
// with another automated sender can't drain the Telnyx balance.
const DAILY_SPEND_LIMIT_USD = "5.00";
// After a day without messages, the next text starts a fresh conversation.
const NEW_CONVERSATION_AFTER_MINUTES = 24 * 60;

async function assistant(assistantId: string): Promise<any> {
  const res = await telnyx<any>("GET", `/ai/assistants/${assistantId}`);
  return res.data ?? res;
}

async function profileFor(assistantId: string): Promise<string | null> {
  const a = await assistant(assistantId);
  if (!(a.enabled_features ?? []).includes("messaging")) return null;
  return a.messaging_settings?.default_messaging_profile_id ?? null;
}

// Safe to run more than once: it only ever sets the same values.
export async function enableTexting(assistantId: string): Promise<string> {
  await telnyx("POST", `/ai/assistants/${assistantId}`, {
    enabled_features: ["telephony", "messaging"],
    messaging_settings: { conversation_inactivity_minutes: NEW_CONVERSATION_AFTER_MINUTES },
  });
  const profileId = await profileFor(assistantId);
  if (!profileId) throw new TelnyxError(502, "Texting couldn't be set up for this receptionist. Try again.");

  // New profiles only allow texts to the US and Canada.
  await telnyx("PATCH", `/messaging_profiles/${profileId}`, {
    enabled: true,
    whitelisted_destinations: ["AU"],
    daily_spend_limit: DAILY_SPEND_LIMIT_USD,
    daily_spend_limit_enabled: true,
  });
  return profileId;
}

// Removes the messaging profile Telnyx made for this assistant. Checks the link
// first so a profile belonging to anything else on the account is never touched.
export async function removeTextingProfile(profileId: string, assistantId: string): Promise<void> {
  const res = await telnyx<any>("GET", `/messaging_profiles/${profileId}`).catch(() => null);
  if (res?.data?.ai_assistant_id !== assistantId) return;
  await telnyx("DELETE", `/messaging_profiles/${profileId}`).catch((err) => {
    if (!(err instanceof TelnyxError && err.status === 404)) throw err;
  });
}

export async function textingProfileId(assistantId: string): Promise<string | null> {
  return profileFor(assistantId);
}

async function numbersOnProfile(profileId: string): Promise<string[]> {
  const res = await telnyx<{ data?: any[] }>("GET", `/messaging_profiles/${profileId}/phone_numbers?page[size]=20`);
  return (res.data ?? []).map((n) => n.phone_number).filter(Boolean);
}

export async function textingState(client: Business): Promise<TextingState> {
  if (client.assistantId.startsWith("demo-")) return { enabled: false, numbers: [], waiting: client.phoneNumbers ?? [] };
  const profileId = await profileFor(client.assistantId);
  if (!profileId) return { enabled: false, numbers: [], waiting: client.phoneNumbers ?? [] };
  const numbers = await numbersOnProfile(profileId);
  // Numbers that answer this receptionist's calls but don't take texts yet.
  const waiting = (client.phoneNumbers ?? []).filter((n) => !numbers.includes(n));
  return { enabled: true, numbers, waiting };
}

const AU_NUMBER = /^\+61\d{9}$/;
const AU_MOBILE = /^\+614\d{8}$/;

// "0412 345 678" or "+61 412 345 678" -> "+61412345678"
export function toE164(input: unknown): string {
  const digits = String(input ?? "").replace(/[\s()-]/g, "");
  if (/^04\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  if (/^614\d{8}$/.test(digits)) return `+${digits}`;
  return digits;
}

export async function connectNumberForTexts(client: Business, input: unknown): Promise<TextingState> {
  const phoneNumber = toE164((input as { phoneNumber?: unknown } | null)?.phoneNumber);
  if (!AU_NUMBER.test(phoneNumber) || !(client.phoneNumbers ?? []).includes(phoneNumber)) {
    throw new ValidationError("Choose one of this receptionist's numbers.");
  }
  const profileId = (await profileFor(client.assistantId)) ?? (await enableTexting(client.assistantId));
  try {
    await telnyx("PATCH", `/messaging_phone_numbers/${encodeURIComponent(phoneNumber)}`, {
      messaging_profile_id: profileId,
    });
  } catch (err) {
    if (err instanceof TelnyxError && err.status < 500) {
      throw new ValidationError(
        `Texts can't be sent from this number. Landline-style numbers can't text, so buy a mobile number for texts. (${err.message})`,
      );
    }
    throw err;
  }
  return textingState(client);
}

// Sends a first text from the receptionist to someone's mobile, to test it or to
// show a client. Their replies are answered by the receptionist like any text.
export async function sendTestText(client: Business, input: unknown): Promise<{ conversationId: string }> {
  const to = toE164((input as { to?: unknown } | null)?.to);
  if (!AU_MOBILE.test(to)) throw new ValidationError("Enter an Australian mobile number, like 0412 345 678.");

  const state = await textingState(client);
  const from = state.numbers[0];
  if (!from) throw new ValidationError("Set up a number for texts first.");

  const s = client.settings;
  const who = s.receptionistName ? `${s.receptionistName}, the AI assistant at ${s.businessName}` : `the AI assistant at ${s.businessName}`;
  const res = await telnyx<{ conversation_id?: string; data?: { conversation_id?: string } }>(
    "POST",
    `/ai/assistants/${client.assistantId}/chat/sms`,
    {
      from,
      to,
      text: `Hi, it's ${who}. Text back here any time with a question or to request a booking. Reply STOP to opt out.`,
      should_create_conversation: true,
      conversation_metadata: { twin_test_text: true },
    },
  );
  return { conversationId: res.conversation_id ?? res.data?.conversation_id ?? "" };
}
