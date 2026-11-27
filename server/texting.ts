import type { Business, TextingState } from "../src/lib/shared";
import { ValidationError } from "./prompt";
import { TelnyxError, telnyx } from "./telnyx";
import { smsHookUrl } from "./smsWebhook";
import { getClient, saveClient } from "./store";

// Texting on Telnyx: Telnyx carries the texts, our server answers them. Each receptionist has a
// Telnyx messaging profile of our own (no Telnyx AI assistant linked to it) whose webhook_url is
// our /hooks/sms/telnyx address (server/smsWebhook.ts, answered by server/smsBot.ts). The reply
// is written by the same text AI as the website chat (OpenRouter, server/llm.ts) and sent with
// POST /messages. Any number attached to the profile is answered this way.
//
// Receptionists made before this had a profile linked to their Telnyx assistant, which answered
// texts itself. migrateTexting() moves their numbers onto a profile of ours and removes that one.

// A cap on what one receptionist can spend on texts per day, so a reply loop
// with another automated sender can't drain the Telnyx balance.
const DAILY_SPEND_LIMIT_USD = "5.00";

async function assistant(assistantId: string): Promise<any> {
  const res = await telnyx<any>("GET", `/ai/assistants/${assistantId}`);
  return res.data ?? res;
}

/** The profile Telnyx made when texting was linked to the assistant (receptionists from before our own texting). */
async function legacyProfileFor(assistantId: string): Promise<string | null> {
  const a = await assistant(assistantId);
  if (!(a.enabled_features ?? []).includes("messaging")) return null;
  return a.messaging_settings?.default_messaging_profile_id ?? null;
}

const profileBody = (client: Business) => {
  const webhook = smsHookUrl("telnyx", client.id);
  return {
    enabled: true,
    webhook_url: webhook,
    webhook_failover_url: "",
    webhook_api_version: "2",
    // New profiles only allow texts to the US and Canada.
    whitelisted_destinations: ["AU"],
    daily_spend_limit: DAILY_SPEND_LIMIT_USD,
    daily_spend_limit_enabled: true,
  };
};

// Safe to run more than once: it only ever sets the same values. Returns the profile id.
export async function enableTexting(client: Business): Promise<string> {
  if (!smsHookUrl("telnyx", client.id)) throw new ValidationError("Texting needs this server to have a public address, so Telnyx can pass texts to it.");
  let profileId = client.textingProfileId ?? "";
  if (profileId) {
    await telnyx("PATCH", `/messaging_profiles/${profileId}`, profileBody(client));
  } else {
    const made = await telnyx<{ data?: { id?: string } }>("POST", "/messaging_profiles", { name: `Texts: ${client.settings.businessName}`.slice(0, 80), ...profileBody(client) });
    profileId = made.data?.id ?? "";
    if (!profileId) throw new TelnyxError(502, "Texting couldn't be set up for this receptionist. Try again.");
    client.textingProfileId = profileId;
    const saved = (await getClient(client.id)) ?? client;
    await saveClient({ ...saved, textingProfileId: profileId });
  }
  return profileId;
}

// Removes a messaging profile. Checks the link first so a profile belonging to anything else
// on the account is never touched: one of ours (named for this receptionist's webhook) or one
// that was linked to this assistant.
export async function removeTextingProfile(profileId: string, client: Pick<Business, "id" | "assistantId">): Promise<void> {
  const res = await telnyx<any>("GET", `/messaging_profiles/${profileId}`).catch(() => null);
  const d = res?.data;
  const ours = typeof d?.webhook_url === "string" && d.webhook_url.includes(`/hooks/sms/telnyx/${client.id}/`);
  if (!ours && d?.ai_assistant_id !== client.assistantId) return;
  await telnyx("DELETE", `/messaging_profiles/${profileId}`).catch((err) => {
    if (!(err instanceof TelnyxError && err.status === 404)) throw err;
  });
}

/** The profile this receptionist's texts use: ours, else a legacy assistant-linked one. */
export async function textingProfileId(client: Business): Promise<string | null> {
  if (client.textingProfileId) return client.textingProfileId;
  if (client.assistantId.startsWith("demo-")) return null;
  return legacyProfileFor(client.assistantId);
}

async function numbersOnProfile(profileId: string): Promise<string[]> {
  const res = await telnyx<{ data?: any[] }>("GET", `/messaging_profiles/${profileId}/phone_numbers?page[size]=20`);
  return (res.data ?? []).map((n) => n.phone_number).filter(Boolean);
}

/**
 * Moves a receptionist whose texts were answered by its Telnyx assistant onto our own profile:
 * every number on the old profile is pointed at ours, then the old profile is removed.
 * Does nothing for one already on ours.
 */
export async function migrateTexting(client: Business): Promise<void> {
  if (client.textingProfileId || client.assistantId.startsWith("demo-")) return;
  const legacy = await legacyProfileFor(client.assistantId);
  if (!legacy) return;
  const numbers = await numbersOnProfile(legacy);
  const profileId = await enableTexting(client);
  for (const n of numbers) await telnyx("PATCH", `/messaging_phone_numbers/${encodeURIComponent(n)}`, { messaging_profile_id: profileId });
  await removeTextingProfile(legacy, client).catch((err) => console.error(`[texting ${client.id}] couldn't remove the old messaging profile`, err.message));
}

export async function textingState(client: Business): Promise<TextingState> {
  if (client.assistantId.startsWith("demo-")) return { enabled: false, numbers: [], waiting: client.phoneNumbers ?? [] };
  const profileId = await textingProfileId(client);
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
  await migrateTexting(client);
  const profileId = (await getClient(client.id))?.textingProfileId ?? client.textingProfileId ?? (await enableTexting(client));
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
  await sendTelnyxText({ from, to, text: `Hi, it's ${who}. Text back here any time with a question or to request a booking. Reply STOP to opt out.` });
  return { conversationId: "" };
}

/** One text through Telnyx's messaging API, from a number on one of our profiles. */
export async function sendTelnyxText(o: { from: string; to: string; text: string }): Promise<void> {
  await telnyx("POST", "/messages", { from: o.from, to: o.to, text: o.text, type: "SMS" });
}
