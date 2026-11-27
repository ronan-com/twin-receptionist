import type { Business, TextsStatus } from "../src/lib/shared";
import { numberIsLive, numberWaiting } from "../src/lib/ownNumbers";
import { connectNumberForTexts, enableTexting, sortTextable, textingState } from "./texting";
import { telnyx, currentOrg } from "./telnyx";
import { getClient, saveClient } from "./store";
import { ownedTwilioNumbers, pointTextsAtUs, releaseTexts, twilioCredsFor } from "./twilio";
import { providerOfClient } from "./voice/config";
import { isDemo } from "./sandbox";

// The owner's Texts switch for one receptionist. Telnyx: our messaging profile answers the texts, so
// "off" disables the profile and "on" enables it and puts each live Australian mobile on it.
// Vapi: texts are a Twilio number's SmsUrl, so "off" clears it and "on" points it at us again.
// Preference lives on the receptionist (textsPref): missing means on for what's already set up.

/** The numbers a receptionist has, from its voice engine: live ones answer, pending ones are still being approved. */
export type Numbers = { active: string[]; pending: string[] };

/** The Twilio side, swappable so tests don't need an account. */
export type TwilioTexts = {
  /** Live numbers of the receptionist that can text. */
  canText: (numbers: string[]) => Promise<string[]>;
  point: (clientId: string, number: string) => Promise<boolean>;
  release: (clientId: string, number: string) => Promise<void>;
};

export const liveTwilioTexts: TwilioTexts = {
  async canText(numbers) {
    const creds = await twilioCredsFor(currentOrg());
    if (!creds || !numbers.length) return [];
    return (await ownedTwilioNumbers(creds)).filter((n) => n.sms && numbers.includes(n.phoneNumber)).map((n) => n.phoneNumber);
  },
  async point(clientId, number) {
    const creds = await twilioCredsFor(currentOrg());
    return creds ? pointTextsAtUs(creds, clientId, number) : false;
  },
  async release(clientId, number) {
    const creds = await twilioCredsFor(currentOrg());
    if (creds) await releaseTexts(creds, clientId, number);
  },
};

const AU_MOBILE = /^\+614\d{8}$/;

/** Splits what the engine reports into live and still-pending numbers (Telnyx also lists numbers in open orders). */
export function splitNumbers(state: { numbers: { phoneNumber: string; status: string }[]; pending: { phoneNumbers: string[] }[] }): Numbers {
  const active = state.numbers.filter((n) => numberIsLive(n.status)).map((n) => n.phoneNumber);
  const pending = [...state.numbers.filter((n) => numberWaiting(n.status)).map((n) => n.phoneNumber), ...state.pending.flatMap((o) => o.phoneNumbers)];
  return { active, pending: [...new Set(pending)].filter((n) => !active.includes(n)) };
}

const wantsTexts = (client: Business) => client.textsPref !== "off";

async function savePref(client: Business, pref: "on" | "off"): Promise<Business> {
  const fresh = (await getClient(client.id)) ?? client;
  const next = { ...fresh, textsPref: pref, updatedAt: new Date().toISOString() };
  await saveClient(next);
  return next;
}

/** What the Texts switch shows. */
export async function textsStatus(client: Business, nums: Numbers, tw: TwilioTexts = liveTwilioTexts): Promise<TextsStatus> {
  const base = { enabled: false, numbers: [] as string[], waiting: [] as string[] };
  // A demo receptionist (test lab): nothing is connected anywhere, the switch just remembers its setting.
  if (isDemo(client.assistantId)) return { ...base, ...sortTextable(nums.active), on: wantsTexts(client), status: wantsTexts(client) ? "on" : "off", detail: wantsTexts(client) ? "Answering texts." : "Texts are off." };
  if (providerOfClient(client) === "vapi") {
    const numbers = await tw.canText(nums.active).catch((): string[] => []);
    const waiting = nums.active.filter((n) => !numbers.includes(n));
    if (!wantsTexts(client)) return { ...base, waiting: nums.active, on: false, status: "off", detail: "Texts are off." };
    if (!numbers.length) return { ...base, waiting, on: true, status: "cant", detail: "Texts need a Twilio number that can text." };
    return { enabled: true, numbers, waiting, on: true, status: "on", detail: "Answering texts." };
  }
  const t0 = await textingState(client).catch(() => ({ ...base, ...sortTextable(nums.active) }));
  // Numbers without texts yet: pending ones that will text are waiting; landlines and other numbers can't text.
  const t = { ...t0, ...sortTextable([...t0.waiting, ...(t0.cantText ?? []), ...nums.active, ...nums.pending].filter((n) => !t0.numbers.includes(n))) };
  if (!wantsTexts(client)) return { ...t, on: false, status: "off", detail: "Texts are off." };
  if (t.numbers.length) return { ...t, on: true, status: "on", detail: "Answering texts." };
  if (nums.active.some((n) => AU_MOBILE.test(n))) return { ...t, on: true, status: "failed", detail: "Texts aren't connected yet. Try again." };
  if (nums.pending.some((n) => AU_MOBILE.test(n))) return { ...t, on: true, status: "waiting", detail: "Waiting for the number to be approved. Texts switch on by themselves." };
  return { ...t, on: true, status: "cant", detail: "Texts need an Australian mobile number." };
}

/** Switches texts on or off. Safe to repeat: switching on again is the retry. */
export async function setTexts(client: Business, on: boolean, nums: Numbers, tw: TwilioTexts = liveTwilioTexts): Promise<Business> {
  const saved = await savePref(client, on ? "on" : "off");
  if (isDemo(saved.assistantId)) return saved;
  if (providerOfClient(saved) === "vapi") {
    const numbers = await tw.canText(nums.active);
    for (const n of on ? numbers : nums.active) {
      if (on) await tw.point(saved.id, n);
      else await tw.release(saved.id, n);
    }
    return saved;
  }
  if (!on) {
    // Our own profile stops carrying texts; an older assistant-linked one is left alone.
    if (saved.textingProfileId) await telnyx("PATCH", `/messaging_profiles/${saved.textingProfileId}`, { enabled: false });
    return saved;
  }
  const mobiles = nums.active.filter((n) => AU_MOBILE.test(n));
  if (!mobiles.length) return saved;
  // Turns the profile back on (when there is one) and puts each live mobile on it.
  if (saved.textingProfileId) await enableTexting(saved);
  for (const n of mobiles) await connectNumberForTexts((await getClient(saved.id)) ?? saved, { phoneNumber: n });
  return (await getClient(saved.id)) ?? saved;
}

/**
 * After a number is bought for a Telnyx receptionist: an Australian mobile switches texts on, unless the
 * owner turned them off. Live straight away: connected now. Still being approved: it connects when it goes live.
 */
export async function textsAfterBuy(client: Business, order: { status: string; phoneNumbers: string[] }): Promise<void> {
  if (providerOfClient(client) !== "telnyx") return;
  // Australian mobiles only: US numbers need 10DLC registration in Telnyx before they can text.
  const mobiles = order.phoneNumbers.filter((p) => AU_MOBILE.test(p));
  if (!mobiles.length) return;
  const fresh = (await getClient(client.id)) ?? client;
  if (!wantsTexts(fresh)) return;
  const withPref = fresh.textsPref === "on" ? fresh : await savePref(fresh, "on");
  if (order.status !== "success") return;
  for (const n of mobiles) {
    await connectNumberForTexts(withPref, { phoneNumber: n }).catch((err) => console.error(`[texting ${client.id}] ${n}`, err.message));
  }
}

/**
 * Numbers that have just gone live (a number approved after it was added): texts switch on by themselves
 * when the Texts switch is on. Best effort; the switch's "Try again" does the same by hand.
 */
export async function textsWhenLive(client: Business, becameLive: string[]): Promise<void> {
  // The switch shows "on" until the owner turns it off, so a number approved while it was never touched counts too.
  if (providerOfClient(client) !== "telnyx" || !wantsTexts(client)) return;
  for (const n of becameLive.filter((p) => AU_MOBILE.test(p))) {
    await connectNumberForTexts((await getClient(client.id)) ?? client, { phoneNumber: n }).catch((err) => console.error(`[texting ${client.id}] ${n}`, err.message));
  }
}

/**
 * Which numbers just went live, comparing what was saved at the last look with what the carrier reports now:
 * a number that was waiting for approval and is now live, or one that wasn't there before and is live. Only
 * live numbers count, so a number still being approved is never tried early.
 */
export function numbersBecameLive(saved: Pick<Business, "phoneNumbers" | "pendingNumbers">, now: Numbers): string[] {
  const known = saved.phoneNumbers ?? [];
  const waiting = saved.pendingNumbers ?? [];
  return now.active.filter((n) => !known.includes(n) || waiting.includes(n));
}
