import type { AutomationStatus } from "./automations";
import { ValidationError } from "./prompt";

// Spam and robocall filtering, per receptionist (an automation, see server/automations.ts).
//
// What the phone providers allow (checked Nov 2026): Telnyx AI assistants have no setting
// that rejects an inbound call before the assistant answers (the assistant's dynamic-variables
// webhook is told who is calling, but can only return variables, not refuse the call). So the
// cheapest mechanism that works on both engines is to let the assistant answer and hang up at
// once:
//  - Telnyx: our dynamic-variables webhook (server/automations.ts dynamicVariables) checks the
//    caller against the block list and answers {{twin_blocked}} / {{twin_anonymous}}, plus a
//    one-line greeting for those callers; the script says to hang up straight away.
//  - Vapi: no webhook at call start, so the block list is written into the script next to
//    {{customer.number}} and the model compares them.
// Either way a blocked call is a few seconds of call time, not zero.

export type AnonymousMode = "allow" | "reject" | "message";

export type SpamSettings = {
  spam: {
    /** Callers who are hung up on, as +E.164 numbers. */
    blockList: string[];
    /** Calls that hide their number: let them through, hang up, or only take a message. */
    anonymous: AnonymousMode;
    /** Hang up quickly on obvious robocalls, telemarketers and silent calls. */
    endRobocalls: boolean;
  };
};

export const BLOCK_LIST_MAX = 200;
export const BLOCKED_GREETING = "Sorry, we can't take your call. Goodbye.";

export const defaultSpam = (): SpamSettings => ({ spam: { blockList: [], anonymous: "allow", endRobocalls: false } });

/** A caller number in one form for comparing: +61412345678, +14155550123. "" when it isn't a number. */
export function canonNumber(input: unknown): string {
  const raw = String(input ?? "").trim().replace(/[\s().-]/g, "");
  if (!raw) return "";
  let n = raw;
  if (/^0[2-478]\d{8}$/.test(n)) n = `+61${n.slice(1)}`;
  else if (/^61\d{9}$/.test(n)) n = `+${n}`;
  else if (/^00\d{8,15}$/.test(n)) n = `+${n.slice(2)}`;
  return /^\+[1-9]\d{6,14}$/.test(n) ? n : "";
}

/** True when the caller hid their number (or the provider has none to give). */
export function isAnonymousCaller(caller: unknown): boolean {
  const s = String(caller ?? "").trim().toLowerCase();
  if (!s) return true;
  if (/^(anonymous|restricted|unknown|private|unavailable|withheld|blocked|null|undefined)$/.test(s)) return true;
  // The standard "anonymous" number (it spells ANONYMOUS on a keypad).
  return s.replace(/\D/g, "") === "266696687";
}

export function normaliseBlockList(input: unknown): string[] {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\n,;]+/) : [];
  const out: string[] = [];
  for (const item of list) {
    if (item === null || item === undefined || String(item).trim() === "") continue;
    const n = canonNumber(item);
    if (!n) throw new ValidationError(`"${String(item).slice(0, 30)}" isn't a phone number. Use a full number like 0412 345 678 or +1 415 555 0123.`);
    if (!out.includes(n)) out.push(n);
  }
  if (out.length > BLOCK_LIST_MAX) throw new ValidationError(`The block list holds up to ${BLOCK_LIST_MAX} numbers.`);
  return out;
}

/** Merges a partial update onto the current settings and checks every field. */
export function normaliseSpam(input: unknown, current: Partial<SpamSettings> = defaultSpam()): SpamSettings {
  const src = (input && typeof input === "object" ? (input as Record<string, any>).spam : undefined) ?? {};
  const d = defaultSpam().spam;
  const merged = { ...d, ...(current.spam ?? {}), ...(src && typeof src === "object" ? src : {}) } as Record<string, any>;
  return {
    spam: {
      blockList: normaliseBlockList(merged.blockList),
      anonymous: (["allow", "reject", "message"] as const).includes(merged.anonymous) ? merged.anonymous : "allow",
      endRobocalls: typeof merged.endRobocalls === "boolean" ? merged.endRobocalls : false,
    },
  };
}

/** Whether Telnyx needs our webhook to tell the script who is calling. */
export const spamUsesHook = (s: SpamSettings): boolean => s.spam.blockList.length > 0 || s.spam.anonymous !== "allow";

export const spamActive = (s: SpamSettings): boolean => spamUsesHook(s) || s.spam.endRobocalls;

/** What the webhook answers for one caller. `channel` is Telnyx's conversation channel ("phone_call" for real calls). */
export function spamVariables(s: SpamSettings, caller: unknown, channel?: unknown): { twin_blocked: "yes" | "no"; twin_anonymous: "yes" | "no"; reject: boolean } {
  const number = canonNumber(caller);
  const blocked = Boolean(number) && s.spam.blockList.includes(number);
  // Browser test calls have no caller ID by design: never treat them as anonymous.
  const anonymous = channel === "phone_call" && s.spam.anonymous !== "allow" && isAnonymousCaller(caller);
  return {
    twin_blocked: blocked ? "yes" : "no",
    twin_anonymous: anonymous ? "yes" : "no",
    reject: blocked || (anonymous && s.spam.anonymous === "reject"),
  };
}

/** The script lines for this receptionist (empty when nothing is switched on). */
export function spamLines(s: SpamSettings, engine: "telnyx" | "vapi"): string[] {
  const lines: string[] = [];
  const hang = engine === "vapi" ? "the end call tool" : "the hangup tool";
  const sp = s.spam;
  if (sp.blockList.length) {
    lines.push(
      engine === "vapi"
        ? `- Blocked callers: these numbers are blocked: ${sp.blockList.join(", ")}. If the caller's number ({{customer.number}}) is one of them, say "${BLOCKED_GREETING}" and use ${hang} straight away. Don't help them or take a message.`
        : `- Blocked callers: if "{{twin_blocked}}" is "yes", say "${BLOCKED_GREETING}" (if your greeting hasn't already) and use ${hang} straight away. Don't help them or take a message. If it says anything else, carry on as normal.`,
    );
  }
  if (sp.anonymous === "reject") {
    lines.push(
      engine === "vapi"
        ? `- Callers hiding their number: if the caller's number ({{customer.number}}) is empty, "anonymous" or unknown, say "${BLOCKED_GREETING}" and use ${hang} straight away.`
        : `- Callers hiding their number: if "{{twin_anonymous}}" is "yes", say "${BLOCKED_GREETING}" (if your greeting hasn't already) and use ${hang} straight away.`,
    );
  } else if (sp.anonymous === "message") {
    lines.push(
      engine === "vapi"
        ? `- Callers hiding their number: if the caller's number ({{customer.number}}) is empty, "anonymous" or unknown, only take a message: their name, a number to call back on and what it's about. Don't offer bookings or share business details, then end the call.`
        : `- Callers hiding their number: if "{{twin_anonymous}}" is "yes", only take a message: their name, a number to call back on and what it's about. Don't offer bookings or share business details, then end the call.`,
    );
  }
  if (sp.endRobocalls) {
    lines.push(
      `- Robocalls and sales calls: if the call is clearly a robocall or recording, a telemarketer, a survey or a cold sales call, or the line stays silent (or only noise) after your greeting and one gentle "Hello, are you there?", don't chat. Say one short line ("Sorry, we're not interested. Goodbye.") or nothing for silence, and use ${hang}. Never end a call with a real customer, someone asking a question, or someone who is just slow to reply.`,
    );
  }
  return lines;
}

export function spamStatus(s: SpamSettings, i: { engine?: "telnyx" | "vapi"; publicUrl: string }): AutomationStatus {
  const sp = s.spam;
  if (!spamActive(s)) return { state: "off", label: "Off" };
  const parts = [
    sp.blockList.length ? `${sp.blockList.length} blocked number${sp.blockList.length === 1 ? "" : "s"}` : "",
    sp.anonymous === "reject" ? "no caller ID: hang up" : sp.anonymous === "message" ? "no caller ID: message only" : "",
    sp.endRobocalls ? "robocalls ended" : "",
  ].filter(Boolean);
  const note =
    "The receptionist still answers, then hangs up within a few seconds: the phone service can't refuse a call before the AI picks up. Blocked calls still appear in the call log.";
  if (i.engine !== "vapi" && spamUsesHook(s) && !i.publicUrl) {
    return { state: "needs_setup", label: "Needs a public address", detail: "This server has no public address, so the phone service can't ask who is calling. Only the robocall setting works until it has one." };
  }
  return { state: "on", label: `On · ${parts.join(" · ")}`, detail: i.engine === "vapi" ? `${note} Vapi has no call-start check, so the block list is in the script and the AI compares numbers.` : note };
}
