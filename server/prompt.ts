import {
  DAYS,
  INDUSTRIES,
  TIMEZONES,
  defaultGreeting,
  defaultHours,
  describeHours,
  industry,
  type Hours,
  type IndustryKey,
  type Settings,
} from "../src/lib/shared";

// Business owners type this text and it goes into the agent's script, so strip
// the characters Telnyx treats as template syntax and keep lengths sane.
function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[{}]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanHours(input: unknown, key: IndustryKey): Hours {
  const fallback = defaultHours(key);
  const src = (input ?? {}) as Record<string, { open?: unknown; from?: unknown; to?: unknown }>;
  const out = {} as Hours;
  for (const day of DAYS) {
    const d = src[day.key] ?? {};
    const from = typeof d.from === "string" && TIME.test(d.from) ? d.from : fallback[day.key].from;
    const to = typeof d.to === "string" && TIME.test(d.to) ? d.to : fallback[day.key].to;
    out[day.key] = { open: Boolean(d.open) && from < to, from, to };
  }
  return out;
}

export class ValidationError extends Error {}

export function normaliseSettings(input: unknown, voiceNames: Map<string, string>): Settings {
  const src = (input ?? {}) as Record<string, unknown>;

  const businessName = clean(src.businessName, 80);
  if (businessName.length < 2) throw new ValidationError("Enter your business name.");

  const industryKey = INDUSTRIES.some((i) => i.key === src.industry) ? (src.industry as IndustryKey) : "other";
  const timezone = TIMEZONES.some((t) => t.value === src.timezone) ? String(src.timezone) : "Australia/Brisbane";

  const services = (Array.isArray(src.services) ? src.services : [])
    .map((s) => clean(s, 60))
    .filter(Boolean)
    .slice(0, 12);
  if (services.length === 0) throw new ValidationError("Add at least one service callers can ask for.");

  const voiceId = String(src.voiceId ?? "");
  const voiceName = voiceNames.get(voiceId);
  if (!voiceName) throw new ValidationError("Choose a voice for your receptionist.");

  const receptionistName = clean(src.receptionistName, 30);
  const greeting = clean(src.greeting, 300) || defaultGreeting(businessName, receptionistName);

  return {
    businessName,
    industry: industryKey,
    suburb: clean(src.suburb, 60),
    timezone,
    address: clean(src.address, 140),
    hours: cleanHours(src.hours, industryKey),
    services,
    receptionistName,
    voiceId,
    voiceName,
    greeting,
    tone: src.tone === "professional" ? "professional" : "friendly",
    notes: clean(String(src.notes ?? "").replace(/\r/g, ""), 1500),
  };
}

export function buildInstructions(s: Settings, booking: { minutes: number } | null = null): string {
  const preset = industry(s.industry);
  const where = s.suburb ? ` in ${s.suburb}, Australia` : " in Australia";
  const who = s.receptionistName ? `Your name is ${s.receptionistName}. ` : "";
  const tone =
    s.tone === "professional"
      ? "Polite, clear and professional. Efficient without sounding cold."
      : "Warm, relaxed and friendly, the way a good local receptionist sounds.";

  const info: string[] = describeHours(s.hours).map((line) => `- ${line}`);
  if (s.address) info.push(`- Address: ${s.address}`);

  const notes = s.notes
    ? `\nMore about the business (use this to answer questions)\n${s.notes}\n`
    : "";

  return `You are the receptionist for ${s.businessName}, a ${preset.noun}${where}. ${who}It is {{telnyx_current_time_${s.timezone}}} local time.

You answer both phone calls and text messages. This conversation's channel is "{{telnyx_conversation_channel}}": "sms_chat" or "web_chat" means you are texting, anything else means a voice call.

How you speak on a call
- Australian English. ${tone}
- One or two short sentences per turn. Ask one question at a time and wait for the answer.
- If the caller interrupts, stop talking and listen.
- Say times the natural way ("two fifteen in the afternoon"), never in 24-hour format.

How you write by text
- Australian English. ${tone}
- Keep each reply under 300 characters. Plain text only: no markdown, lists or emoji.
- Ask one question per message.
- Write times as "2:15pm" and dates as "Tue 3 Dec".
- You already have their number ({{telnyx_end_user_target}}). Don't ask for it unless they want to be contacted on a different one.
- If they reply STOP or ask not to be texted, reply once to confirm they won't get more texts, then don't reply again.

Opening hours and location
${info.join("\n")}

What callers can ask for
${s.services.map((x) => `- ${x}`).join("\n")}
${notes}
Taking a ${preset.booking} request
1. Ask what they need, and match it to the list above.
${
    booking
      ? `2. Ask which day suits. Call check_availability for that date (YYYY-MM-DD) before offering anything, then offer two or three of the times it returns. Never offer a time it didn't return. If the day is closed or full, say so and check the next day. Appointments are ${booking.minutes} minutes. On a call, say "one moment while I check" before looking.`
      : `2. Ask which day suits. Offer two times on that day inside opening hours. If they ask for a time when the business is closed, say so and offer the nearest open time.`
  }
3. Ask for their full name. If it is unusual, ask them to spell it.
4. On a call, ask for the best mobile number. Read it back in groups (for example "oh four one two, three four five, six seven eight") and ask them to confirm. If they correct it, read the corrected number back before continuing. By text, skip this unless they give a different number.
${
    booking
      ? `5. Repeat it back once: what they need, day, time, name and number.
6. Call book_appointment with the slot's exact start value. If it says booked, tell them it's confirmed for that day and time. If it says the time is gone, check availability again and offer other times. If it fails for any other reason, say you couldn't lock it in, call request_callback, and tell them the team will call to confirm.`
      : `5. Repeat the request back once: what they need, day, time, name and number.
6. Tell them the request has been passed to the team, who will confirm it. Do not say it is confirmed or booked, because you cannot see the calendar.`
  }

Rules
- You are an AI assistant. If asked, say so plainly.
- ${preset.guardrail}
- Do not quote prices unless they are written above. Say the team can go through pricing when they confirm.
- If you do not know something, say you will pass the question to the team. Never make up an answer.
- If they ask for a person, take their name, number and a short message${booking ? ", call request_callback with them," : ""} and say the team will get back to them.
- Only talk about ${s.businessName}. Politely decline anything unrelated.
- On a call, when the ${preset.customer} has nothing else, say goodbye and end the call. By text, just sign off; there is nothing to end.`;
}
