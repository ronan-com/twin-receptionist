import type { Business, TextNumber, TextsStatus } from "../src/lib/shared";
import { numberIsLive, numberWaiting } from "../src/lib/ownNumbers";
import { connectNumberForTexts, enableTexting, migrateTexting, numbersOnProfile, putOnTextProfile, removeTextingProfile, sortTextable, textingState, toE164 } from "./texting";
import { telnyx, currentOrg, runAsOrg } from "./telnyx";
import { getClient, saveClient } from "./store";
import { sql } from "./db";
import { moveTextHooks, ownedTwilioNumbers, pointTextsAtUs, releaseTexts, textHookProblem, twilioCredsFor } from "./twilio";
import { providerOfClient } from "./voice/config";
import { isDemo } from "./sandbox";
import { ValidationError } from "./prompt";
import { lastTextProblem } from "./sms";
import { AU_MOBILE, agencyClients, notPickedElsewhere, receptionistName, textHolder, wantsTexts } from "./textOwners";

// A receptionist's texts: the Texts switch, and which number they come to.
// Telnyx numbers: our messaging profile answers the texts, so "off" disables the profile and "on" enables it
// and puts the mobile on it. Twilio numbers: texts follow the number's SmsUrl, so "off" clears it and "on"
// points it at us. Only that text webhook is ever set: a number's calls are never touched here.
// Any receptionist (Telnyx or Vapi voice) can pick any number that can text (Business.textNumber). Without a
// pick it uses its own numbers: Australian mobiles on Telnyx, its Twilio numbers on Vapi.
// Preference lives on the receptionist (textsPref): missing means on for what's already set up.

/** The numbers a receptionist has, from its voice engine: live ones answer, pending ones are still being approved. */
export type Numbers = { active: string[]; pending: string[] };

/** The Twilio side, swappable so tests don't need an account. */
export type TwilioTexts = {
  /** Live numbers of the receptionist that can text. */
  canText: (numbers: string[]) => Promise<string[]>;
  point: (clientId: string, number: string) => Promise<boolean>;
  release: (clientId: string, number: string) => Promise<void>;
  /** Why the number's texts wouldn't arrive, or null when they will. */
  check: (clientId: string, number: string) => Promise<{ detail: string; retry: boolean } | null>;
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
  async check(clientId, number) {
    const creds = await twilioCredsFor(currentOrg());
    if (!creds) return { detail: "Twilio isn't connected. Connect it under Connections.", retry: false };
    return textHookProblem(creds, clientId, number);
  },
};

/** Splits what the engine reports into live and still-pending numbers (Telnyx also lists numbers in open orders). */
export function splitNumbers(state: { numbers: { phoneNumber: string; status: string }[]; pending: { phoneNumbers: string[] }[] }): Numbers {
  const active = state.numbers.filter((n) => numberIsLive(n.status)).map((n) => n.phoneNumber);
  const pending = [...state.numbers.filter((n) => numberWaiting(n.status)).map((n) => n.phoneNumber), ...state.pending.flatMap((o) => o.phoneNumbers)];
  return { active, pending: [...new Set(pending)].filter((n) => !active.includes(n)) };
}

async function savePref(client: Business, pref: "on" | "off"): Promise<Business> {
  const fresh = (await getClient(client.id)) ?? client;
  const next: Business = { ...fresh, textsPref: pref, updatedAt: new Date().toISOString() };
  await saveClient(next);
  return next;
}

const base = () => ({ enabled: false, numbers: [] as string[], waiting: [] as string[] });

/** What the Texts switch shows. */
export async function textsStatus(client: Business, nums: Numbers, tw: TwilioTexts = liveTwilioTexts): Promise<TextsStatus> {
  const status = await statusOf(client, nums, tw);
  const failed = status.status === "on" ? lastTextProblem(client.id) : "";
  return failed ? { ...status, warning: `The last text didn't send. ${failed}` } : status;
}

// ---- The same answer for lists and chips ------------------------------------------------

const SUMMARY_MS = 30_000;
const SUMMARY_WAIT_MS = 6_000;
const summaries = new Map<string, { key: string; at: number; status: TextsStatus }>();
export const forgetTextsSummary = (clientId?: string) => void (clientId ? summaries.delete(clientId) : summaries.clear());

/**
 * What the lists and chips say about a receptionist's texts: textsStatus (what the Messages tab shows), from the
 * numbers saved on it, remembered for half a minute. A demo receptionist with nothing that can text says so.
 */
export async function textsSummary(orgId: string, client: Business, tw: TwilioTexts = liveTwilioTexts): Promise<TextsStatus> {
  const pending = client.pendingNumbers ?? [];
  const nums: Numbers = { active: (client.phoneNumbers ?? []).filter((n) => !pending.includes(n)), pending };
  const demo = isDemo(client.assistantId);
  const mobile = nums.active.find((n) => AU_MOBILE.test(n));
  const on = wantsTexts(client);
  // Nothing to ask anyone about.
  if (!client.textNumber && (demo ? !mobile : !nums.active.length && !pending.length)) {
    return { ...base(), current: null, on, status: on ? "cant" : "off", detail: on ? "No text number yet." : "Texts are off." };
  }
  const key = JSON.stringify([orgId, client.textsPref, client.textNumber, client.phoneNumbers, pending, client.textingProfileId, client.voiceProvider]);
  const hit = summaries.get(client.id);
  if (hit && hit.key === key && Date.now() - hit.at < SUMMARY_MS) return hit.status;
  const unknown: TextsStatus = { ...base(), current: client.textNumber ?? null, on, status: on ? "failed" : "off", detail: on ? "Couldn't check texts just now." : "Texts are off." };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<TextsStatus>((done) => (timer = setTimeout(() => done(unknown), SUMMARY_WAIT_MS)));
  try {
    const status = await Promise.race([runAsOrg(orgId, () => textsStatus(client, nums, tw)), slow]);
    const shown = demo && !status.current && mobile ? { ...status, current: { number: mobile, via: "telnyx" as const } } : status;
    if (status !== unknown) summaries.set(client.id, { key, at: Date.now(), status: shown });
    return shown;
  } catch (err) {
    console.error(`[texting ${client.id}] couldn't check texts:`, (err as Error).message);
    return unknown;
  } finally {
    clearTimeout(timer);
  }
}

async function statusOf(client: Business, nums: Numbers, tw: TwilioTexts): Promise<TextsStatus> {
  const off = (s: Partial<TextsStatus>): TextsStatus => ({ ...base(), ...s, on: false, status: "off", detail: "Texts are off." });
  // A demo receptionist (test lab): nothing is connected anywhere, the switch just remembers its setting.
  if (isDemo(client.assistantId)) {
    const current = client.textNumber ?? null;
    if (!wantsTexts(client)) return off({ ...sortTextable(nums.active), current });
    return { ...base(), ...sortTextable(nums.active), current, on: true, status: "on", detail: "Answering texts." };
  }
  if (client.textNumber) return pickedStatus(client, client.textNumber, tw);

  // No number picked: the receptionist's own, except any another receptionist has picked.
  const mine = await notPickedElsewhere(client.id, nums.active);
  const taken = async (): Promise<string> => {
    const number = nums.active.find((n) => !mine.includes(n));
    if (!number) return "";
    const holder = textHolder(await agencyClients(client.id), number, client.id);
    return holder ? `${number} answers texts for ${receptionistName(holder)}. Choose another text number.` : "";
  };

  if (providerOfClient(client) === "vapi") {
    const numbers = await tw.canText(mine).catch((): string[] => []);
    const waiting = nums.active.filter((n) => !numbers.includes(n));
    const current: TextNumber | null = numbers[0] ? { number: numbers[0], via: "twilio" } : null;
    if (!wantsTexts(client)) return off({ waiting: nums.active, current });
    if (!numbers.length) return { ...base(), waiting, current, on: true, status: "cant", detail: (await taken()) || "Texts need a Twilio number that can text. Choose a text number." };
    const problem = await tw.check(client.id, numbers[0]);
    if (problem) return { ...base(), waiting, current, on: true, status: problem.retry ? "failed" : "cant", detail: problem.detail };
    return { enabled: true, numbers, waiting, current, on: true, status: "on", detail: "Answering texts." };
  }

  const t0 = await textingState(client).catch(() => ({ ...base(), ...sortTextable(nums.active) }));
  const onProfile = await notPickedElsewhere(client.id, t0.numbers);
  // Numbers without texts yet: pending ones that will text are waiting; landlines and other numbers can't text.
  const t = { ...t0, numbers: onProfile, ...sortTextable([...t0.waiting, ...(t0.cantText ?? []), ...nums.active, ...nums.pending].filter((n) => !t0.numbers.includes(n))) };
  const mobile = onProfile.find((n) => AU_MOBILE.test(n)) ?? mine.find((n) => AU_MOBILE.test(n));
  const current: TextNumber | null = mobile ? { number: mobile, via: "telnyx" } : null;
  if (!wantsTexts(client)) return { ...t, current, on: false, status: "off", detail: "Texts are off." };
  if (t.numbers.length) return { ...t, current, on: true, status: "on", detail: "Answering texts." };
  if (mine.some((n) => AU_MOBILE.test(n))) return { ...t, current, on: true, status: "failed", detail: "Texts aren't connected yet. Try again." };
  if (nums.pending.some((n) => AU_MOBILE.test(n))) return { ...t, current, on: true, status: "waiting", detail: "Waiting for the number to be approved. Texts switch on by themselves." };
  return { ...t, current, on: true, status: "cant", detail: (await taken()) || "None of this receptionist's numbers can text here. Choose a text number." };
}

async function pickedStatus(client: Business, pick: TextNumber, tw: TwilioTexts): Promise<TextsStatus> {
  const shown = { ...base(), current: pick };
  if (!wantsTexts(client)) return { ...shown, on: false, status: "off", detail: "Texts are off." };
  const answering: TextsStatus = { ...shown, enabled: true, numbers: [pick.number], on: true, status: "on", detail: "Answering texts." };
  if (pick.via === "twilio") {
    const problem = await tw.check(client.id, pick.number);
    return problem ? { ...shown, on: true, status: problem.retry ? "failed" : "cant", detail: problem.detail } : answering;
  }
  try {
    if (client.textingProfileId && (await numbersOnProfile(client.textingProfileId)).includes(pick.number)) return answering;
  } catch (err) {
    return { ...shown, on: true, status: "failed", detail: `Couldn't check with Telnyx. ${(err as Error).message}` };
  }
  return { ...shown, on: true, status: "failed", detail: "Telnyx isn't passing this number's texts here yet. Try again." };
}

/** Points the picked number's texts at this receptionist. A Twilio failure shows in the status. */
async function connectPicked(client: Business, pick: TextNumber, tw: TwilioTexts): Promise<void> {
  if (pick.via === "twilio") {
    await tw.point(client.id, pick.number);
    return;
  }
  if (client.textingProfileId) await enableTexting(client);
  await putOnTextProfile(client, pick.number);
}

/** Switches texts on or off. Safe to repeat: switching on again is the retry. */
export async function setTexts(client: Business, on: boolean, nums: Numbers, tw: TwilioTexts = liveTwilioTexts): Promise<Business> {
  const pick = client.textNumber;
  if (on && pick) {
    const holder = textHolder(await agencyClients(client.id), pick.number, client.id);
    if (holder) throw new ValidationError(`${pick.number} now answers texts for ${receptionistName(holder)}. Choose another number.`);
  }
  const saved = await savePref(client, on ? "on" : "off");
  // Who holds which number may have changed for others too.
  forgetTextsSummary();
  if (isDemo(saved.assistantId)) return saved;
  if (pick) {
    if (on) await connectPicked(saved, pick, tw);
    else if (pick.via === "twilio") await tw.release(saved.id, pick.number);
    else if (saved.textingProfileId) await telnyx("PATCH", `/messaging_profiles/${saved.textingProfileId}`, { enabled: false });
    return (await getClient(saved.id)) ?? saved;
  }
  const mine = await notPickedElsewhere(saved.id, nums.active);
  if (providerOfClient(saved) === "vapi") {
    const numbers = await tw.canText(mine);
    for (const n of on ? numbers : mine) {
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
  const mobiles = mine.filter((n) => AU_MOBILE.test(n));
  if (!mobiles.length) return saved;
  // Turns the profile back on (when there is one) and puts each live mobile on it.
  if (saved.textingProfileId) await enableTexting(saved);
  for (const n of mobiles) await connectNumberForTexts((await getClient(saved.id)) ?? saved, { phoneNumber: n });
  return (await getClient(saved.id)) ?? saved;
}

/** Stops the numbers a receptionist answered texts on before, other than the one it's moving to. */
async function releaseOld(client: Business, nums: Numbers, next: TextNumber, tw: TwilioTexts): Promise<void> {
  const old = client.textNumber;
  const vapi = providerOfClient(client) === "vapi";
  const twilioOld = old ? (old.via === "twilio" ? [old.number] : []) : vapi ? await notPickedElsewhere(client.id, nums.active) : [];
  for (const n of twilioOld) if (next.via !== "twilio" || n !== next.number) await tw.release(client.id, n);

  // Moving onto a Telnyx number also clears anything left on the profile from before.
  const usedTelnyx = old ? old.via === "telnyx" : !vapi;
  if (!usedTelnyx && next.via !== "telnyx") return;
  // A receptionist still on the older assistant-linked texting moves to ours first, so it can be switched off.
  await migrateTexting(client);
  const profileId = (await getClient(client.id))?.textingProfileId ?? client.textingProfileId;
  if (!profileId) return;
  if (next.via !== "telnyx") {
    await telnyx("PATCH", `/messaging_profiles/${profileId}`, { enabled: false });
    return;
  }
  for (const n of await numbersOnProfile(profileId)) {
    if (n !== next.number) await telnyx("PATCH", `/messaging_phone_numbers/${encodeURIComponent(n)}`, { messaging_profile_id: "" });
  }
}

/**
 * Picks the number a receptionist answers texts on, from `choices` (the agency's numbers that can text).
 * The number it used before is released, and Texts switches on.
 */
export async function chooseTextNumber(
  client: Business,
  input: unknown,
  choices: (TextNumber & { usedBy: string })[],
  nums: Numbers,
  tw: TwilioTexts = liveTwilioTexts,
): Promise<Business> {
  const number = toE164((input as { number?: unknown } | null)?.number);
  const found = choices.find((c) => c.number === number);
  if (!found) throw new ValidationError("Choose one of your numbers from the list.");
  if (found.usedBy) throw new ValidationError(`${number} already answers texts for ${found.usedBy}. Switch texts off there, or choose another number there, first.`);
  const pick: TextNumber = { number, via: found.via };
  const before = (await getClient(client.id)) ?? client;
  const demo = isDemo(before.assistantId);
  if (!demo) await releaseOld(before, nums, pick, tw);
  const fresh = (await getClient(client.id)) ?? before;
  const saved: Business = { ...fresh, textNumber: pick, textsPref: "on", updatedAt: new Date().toISOString() };
  await saveClient(saved);
  if (!demo) await connectPicked(saved, pick, tw);
  forgetTextsSummary();
  return (await getClient(client.id)) ?? saved;
}

/** A receptionist is being deleted: its picked number stops pointing here. Best effort. */
export async function releaseTextNumber(client: Business, tw: TwilioTexts = liveTwilioTexts): Promise<void> {
  const pick = client.textNumber;
  if (!pick || isDemo(client.assistantId)) return;
  try {
    if (pick.via === "twilio") await tw.release(client.id, pick.number);
    // A Telnyx receptionist's profile goes with its assistant (server/voice/telnyx.ts); a Vapi one's goes here.
    else if (providerOfClient(client) === "vapi" && client.textingProfileId) await removeTextingProfile(client.textingProfileId, client);
  } catch (err) {
    console.error(`[texting ${client.id}] couldn't release ${pick.number}:`, (err as Error).message);
  }
}

/** The public address changed: Twilio numbers that send their texts here are moved to the new one. */
export async function repointTwilioTexts(): Promise<void> {
  const rows = await sql`
    select c.id, c.org_id, c.data from clients c join orgs o on o.id = c.org_id
    where o.suspended_at is null and coalesce(c.data->>'assistantId', '') not like 'demo-%'`;
  const byOrg = new Map<string, { clientId: string; number: string; picked: boolean }[]>();
  for (const r of rows as any[]) {
    const c = { ...r.data, id: r.id } as Business;
    if (!wantsTexts(c)) continue;
    const numbers = c.textNumber ? (c.textNumber.via === "twilio" ? [c.textNumber.number] : []) : providerOfClient(c) === "vapi" ? (c.phoneNumbers ?? []) : [];
    if (!numbers.length) continue;
    byOrg.set(r.org_id, [...(byOrg.get(r.org_id) ?? []), ...numbers.map((number) => ({ clientId: c.id, number, picked: Boolean(c.textNumber) }))]);
  }
  for (const [orgId, wanted] of byOrg) {
    try {
      await runAsOrg(orgId, async () => {
        const creds = await twilioCredsFor(orgId);
        if (creds) await moveTextHooks(creds, wanted);
      });
    } catch (err) {
      console.error(`[texting ${orgId}] couldn't move Twilio text addresses:`, (err as Error).message);
    }
  }
}

/**
 * After a number is bought for a Telnyx receptionist: an Australian mobile switches texts on, unless the
 * owner turned them off or picked another text number. Live straight away: connected now. Still being
 * approved: it connects when it goes live.
 */
export async function textsAfterBuy(client: Business, order: { status: string; phoneNumbers: string[] }): Promise<void> {
  if (providerOfClient(client) !== "telnyx") return;
  // Australian mobiles only: US numbers need 10DLC registration in Telnyx before they can text.
  const mobiles = order.phoneNumbers.filter((p) => AU_MOBILE.test(p));
  if (!mobiles.length) return;
  const fresh = (await getClient(client.id)) ?? client;
  if (!wantsTexts(fresh) || fresh.textNumber) return;
  const withPref = fresh.textsPref === "on" ? fresh : await savePref(fresh, "on");
  if (order.status !== "success") return;
  for (const n of await notPickedElsewhere(client.id, mobiles)) {
    await connectNumberForTexts(withPref, { phoneNumber: n }).catch((err) => console.error(`[texting ${client.id}] ${n}`, err.message));
  }
}

/**
 * Numbers that have just gone live (a number approved after it was added): texts switch on by themselves
 * when the Texts switch is on and no other text number was picked. Best effort; the switch's "Try again"
 * does the same by hand.
 */
export async function textsWhenLive(client: Business, becameLive: string[]): Promise<void> {
  // The switch shows "on" until the owner turns it off, so a number approved while it was never touched counts too.
  if (providerOfClient(client) !== "telnyx" || !wantsTexts(client) || client.textNumber) return;
  for (const n of await notPickedElsewhere(client.id, becameLive.filter((p) => AU_MOBILE.test(p)))) {
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
