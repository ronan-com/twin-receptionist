import {
  DAYS,
  INDUSTRIES,
  TIMEZONES,
  article,
  businessNoun,
  defaultGreeting,
  withoutRecordingLine,
  defaultHours,
  describeHours,
  industry,
  type CollectField,
  type Dialect,
  type Hours,
  type IndustryKey,
  type Settings,
  type Tone,
} from "../src/lib/shared";
import {
  APPOINTMENT_LENGTHS,
  BOOKING_MODES,
  BOOKING_NOTICE,
  BOOKING_WINDOWS,
  BUFFERS,
  CALLER_FIELDS,
  EMERGENCIES,
  NEW_CUSTOMERS,
  PRICE_ANSWERS,
  TONES as PROFILE_TONES,
  type CallerField,
  type Option,
  type ReceptionProfile,
} from "../src/lib/profile";
import { sql } from "./db";

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

// ---- The detailed receptionist profile (src/lib/profile.ts) ----

const oneLine = (v: unknown, max: number) => clean(String(v ?? "").replace(/\r?\n+/g, " "), max);
const pickOption = <V extends string>(options: Option<V>[], v: unknown): V | undefined => (options.some((o) => o.value === v) ? (v as V) : undefined);
// A number snapped to the nearest allowed one; anything that isn't a number is dropped.
function snap(list: number[], v: unknown): number | undefined {
  if (v === null || v === "" || typeof v === "boolean") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return list.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
}
function textList(v: unknown, max: number, each: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    const t = oneLine(x, each);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The receptionist profile from untrusted input: enum values checked against the option
 * lists, numbers snapped to the allowed lists, text trimmed and capped, empties dropped.
 * An empty result means "no profile" and changes nothing in the script.
 */
export function cleanProfile(input: unknown): ReceptionProfile {
  const src = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const out: ReceptionProfile = {};
  const template = String(src.template ?? "").trim();
  if (/^[a-z0-9][a-z0-9-]{0,59}$/.test(template)) out.template = template;
  const tone = pickOption(PROFILE_TONES, src.tone);
  if (tone) out.tone = tone;
  const bookingMode = pickOption(BOOKING_MODES, src.bookingMode);
  if (bookingMode) out.bookingMode = bookingMode;
  const minutes = snap(APPOINTMENT_LENGTHS, src.appointmentMinutes);
  if (minutes) out.appointmentMinutes = minutes;
  const buffer = snap(BUFFERS, src.bufferMinutes);
  if (buffer !== undefined) out.bufferMinutes = buffer;
  const notice = pickOption(BOOKING_NOTICE, src.bookingNotice);
  if (notice) out.bookingNotice = notice;
  const windowDays = snap(BOOKING_WINDOWS, src.bookingWindowDays);
  if (windowDays) out.bookingWindowDays = windowDays;

  const details: NonNullable<ReceptionProfile["serviceDetails"]> = [];
  for (const d of Array.isArray(src.serviceDetails) ? src.serviceDetails : []) {
    const r = (d ?? {}) as Record<string, unknown>;
    const name = oneLine(r.name, 60);
    if (!name || details.length >= 30) continue;
    const one: (typeof details)[number] = { name };
    const mins = Number(r.minutes);
    if (r.minutes !== "" && r.minutes !== null && Number.isFinite(mins) && mins >= 5) one.minutes = Math.min(480, Math.round(mins));
    const price = oneLine(r.price, 40);
    if (price) one.price = price;
    const notes = oneLine(r.notes, 160);
    if (notes) one.notes = notes;
    details.push(one);
  }
  if (details.length) out.serviceDetails = details;
  const priceAnswers = pickOption(PRICE_ANSWERS, src.priceAnswers);
  if (priceAnswers) out.priceAnswers = priceAnswers;

  const valid = new Set<unknown>(CALLER_FIELDS.map((o) => o.value));
  const callerFields = [...new Set((Array.isArray(src.callerFields) ? src.callerFields : []).filter((f) => valid.has(f)))] as CallerField[];
  if (callerFields.length) out.callerFields = callerFields;
  const newCustomers = pickOption(NEW_CUSTOMERS, src.newCustomers);
  if (newCustomers) out.newCustomers = newCustomers;
  const emergencies = pickOption(EMERGENCIES, src.emergencies);
  if (emergencies) out.emergencies = emergencies;
  const text = (k: "emergencyNote" | "cancellationPolicy" | "parking" | "accessibility" | "serviceArea", max: number) => {
    const t = oneLine(src[k], max);
    if (t) out[k] = t;
  };
  text("emergencyNote", 300);
  text("cancellationPolicy", 400);
  text("parking", 200);
  text("accessibility", 200);
  text("serviceArea", 200);
  const lists = (k: "paymentMethods" | "languages" | "alwaysDo" | "neverDo", max: number, each: number) => {
    const l = textList(src[k], max, each);
    if (l.length) out[k] = l;
  };
  lists("paymentMethods", 12, 40);
  lists("languages", 8, 30);
  lists("alwaysDo", 10, 160);
  lists("neverDo", 10, 160);

  const faqs: NonNullable<ReceptionProfile["faqs"]> = [];
  for (const f of Array.isArray(src.faqs) ? src.faqs : []) {
    const r = (f ?? {}) as Record<string, unknown>;
    const q = oneLine(r.q, 200);
    const a = oneLine(r.a, 600);
    if (q && a && faqs.length < 30) faqs.push({ q, a });
  }
  if (faqs.length) out.faqs = faqs;
  return out;
}

// ---- Receptionist depth (area R): persona, conversation, what to collect, pause ----

export const TONES: Tone[] = ["friendly", "professional", "calm", "upbeat", "direct"];
export const DIALECTS: Dialect[] = ["en-AU", "en-GB", "en-NZ", "en-US"];
export const COLLECT_FIELDS: CollectField[] = ["email", "address", "reason", "new_customer", "preferred_time"];
const DIALECT_NAME: Record<Dialect, string> = {
  "en-AU": "Australian English",
  "en-GB": "British English",
  "en-NZ": "New Zealand English",
  "en-US": "American English",
};
const TONE_LINE: Record<Tone, string> = {
  friendly: "Warm, relaxed and friendly, the way a good local receptionist sounds.",
  professional: "Polite, clear and professional. Efficient without sounding cold.",
  calm: "Calm, patient and reassuring. Speak at an unhurried pace, especially when the caller is stressed.",
  upbeat: "Upbeat and positive, with genuine energy, without being over the top.",
  direct: "Direct and to the point. Friendly, but skip small talk and get the caller what they need quickly.",
};
const COLLECT_ASK: Record<CollectField, string> = {
  email: "their email address (spell it back to check)",
  address: "the street address where the work or visit is",
  reason: "a short description of what it's about",
  new_customer: "whether they have been to us before",
  preferred_time: "what days and times usually suit them",
};
export const DEFAULT_PAUSE_MESSAGE = "Thanks for calling. We're not taking bookings over the phone right now, but I can take a message and the team will get back to you.";

const cleanList = (v: unknown, max: number, each: number) =>
  (Array.isArray(v) ? v : [])
    .map((x) => clean(x, each))
    .filter(Boolean)
    .slice(0, max);

/**
 * The optional depth fields. `src` is the incoming settings; anything it leaves out
 * keeps its `current` value, so an older client (or the legacy full-replace form)
 * that doesn't know these fields never wipes them.
 */
function depthFields(src: Record<string, unknown>, current: Partial<Settings>): Partial<Settings> {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(src, k);
  const out: Partial<Settings> = {};
  const personality = has("personality") ? clean(String(src.personality ?? "").replace(/\r?\n+/g, " "), 400) : (current.personality ?? "");
  if (personality) out.personality = personality;
  const dialect = has("dialect") ? src.dialect : current.dialect;
  if (DIALECTS.includes(dialect as Dialect) && dialect !== "en-AU") out.dialect = dialect as Dialect;
  const closing = has("closing") ? clean(src.closing, 200) : (current.closing ?? "");
  if (closing) out.closing = closing;
  const avoid = has("avoid") ? cleanList(src.avoid, 12, 80) : (current.avoid ?? []);
  if (avoid.length) out.avoid = avoid;
  const faqStyle = has("faqStyle") ? src.faqStyle : current.faqStyle;
  if (faqStyle === "detailed") out.faqStyle = "detailed";
  const collect = has("collect") ? (Array.isArray(src.collect) ? src.collect : []) : (current.collect ?? []);
  const fields = COLLECT_FIELDS.filter((f) => collect.includes(f));
  if (fields.length) out.collect = fields;
  const questions = has("questions") ? cleanList(src.questions, 6, 160) : (current.questions ?? []);
  if (questions.length) out.questions = questions;
  const paused = has("paused") ? src.paused : current.paused;
  if (paused && typeof paused === "object") {
    const p = paused as Record<string, unknown>;
    const at = typeof p.at === "string" && !Number.isNaN(Date.parse(p.at)) ? p.at : new Date().toISOString();
    out.paused = { at, message: clean(p.message, 300) || DEFAULT_PAUSE_MESSAGE };
  }
  return out;
}

/**
 * The setup wizard's optional business details (what it does, how to say its name,
 * closures, and what it is when none of the types fit). Left out: kept as they are.
 */
function aboutFields(src: Record<string, unknown>, current: Partial<Settings>, industryKey: IndustryKey): Partial<Settings> {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(src, k);
  const oneLine = (v: unknown, max: number) => clean(String(v ?? "").replace(/\r?\n+/g, " "), max);
  const out: Partial<Settings> = {};
  // Only "Something else" has its own label; picking a type replaces it.
  const label = industryKey !== "other" ? "" : has("industryLabel") ? oneLine(src.industryLabel, 60).replace(/[.!?]+$/, "") : (current.industryLabel ?? "");
  if (label) out.industryLabel = label;
  const about = has("about") ? oneLine(src.about, 400) : (current.about ?? "");
  if (about) out.about = about;
  const sayName = has("sayName") ? oneLine(src.sayName, 80) : (current.sayName ?? "");
  if (sayName) out.sayName = sayName;
  const closures = has("closures") ? cleanClosures(src.closures) : (current.closures ?? "");
  if (closures) out.closures = closures;
  return out;
}

/** Closures and public holidays: one per line or separated by semicolons, stored as "a; b". */
export function cleanClosures(value: unknown): string {
  return clean(
    String(value ?? "")
      .split(/\r?\n|;/)
      .map((x) => x.trim())
      .filter(Boolean)
      .join("; "),
    600,
  );
}

/** What callers hear first: the greeting, or the pause message while paused. */
export function greetingOf(s: Settings): string {
  return s.paused ? s.paused.message : withoutRecordingLine(s.greeting);
}

export function normaliseSettings(input: unknown, voiceNames: Map<string, string>, current: Partial<Settings> = {}): Settings {
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
    tone: TONES.includes(src.tone as Tone) ? (src.tone as Tone) : "friendly",
    notes: clean(String(src.notes ?? "").replace(/\r/g, ""), 1500),
    ...aboutFields(src, current, industryKey),
    ...depthFields(src, current),
    ...profileField(src, current),
  };
}

// The profile: left out keeps the current one; an explicit empty one (or null) clears it.
function profileField(src: Record<string, unknown>, current: Partial<Settings>): Partial<Settings> {
  const raw = Object.prototype.hasOwnProperty.call(src, "profile") ? src.profile : current.profile;
  const profile = cleanProfile(raw);
  return Object.keys(profile).length ? { profile } : {};
}

// ---- Knowledge (the business's own questions and answers, from the workspace) ----

export type KnowledgeEntry = { kind: string; question: string; answer: string };

const QA_KINDS = new Set(["faq", "custom_qa"]);
const KNOWLEDGE_MAX_ITEMS = 60;
const KNOWLEDGE_MAX_CHARS = 8000;

// The published knowledge items of one receptionist, oldest first.
export async function knowledgeFor(clientId: string): Promise<KnowledgeEntry[]> {
  const rows = await sql`
    select kind, question, answer from knowledge_items
    where client_id = ${clientId} and enabled order by created_at, id limit ${KNOWLEDGE_MAX_ITEMS}`;
  return rows.map((r: any) => ({ kind: r.kind ?? "faq", question: r.question, answer: r.answer }));
}

// The knowledge block of the instructions. Typed by the business, so cleaned like the
// other settings, and capped so a long list can't crowd out the script.
export function knowledgeSection(items: KnowledgeEntry[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const k of items) {
    const q = clean(k.question, 200);
    const a = clean(String(k.answer ?? "").replace(/\r?\n+/g, " "), 1000);
    if (!q || !a) continue;
    const line = QA_KINDS.has(k.kind) ? `- Q: ${q}\n  A: ${a}` : `- ${q}: ${a}`;
    if (used + line.length > KNOWLEDGE_MAX_CHARS) break;
    used += line.length;
    lines.push(line);
  }
  if (lines.length === 0) return "";
  return `\nAnswers the business has written (use them when callers ask; don't read them out unprompted)\n${lines.join("\n")}\n`;
}


// ---- The profile's part of the instructions ----

const PROFILE_TONE_LINE: Record<NonNullable<ReceptionProfile["tone"]>, string> = {
  warm: "Warm and friendly, like a good local receptionist who knows the regulars.",
  professional: "Professional, polite and efficient. Courteous without sounding stiff.",
  upbeat: "Upbeat and positive, with real energy, without being over the top.",
  calm: "Calm, patient and reassuring. Unhurried, especially when the caller is worried.",
  casual: "Relaxed and casual, like a chat with a friendly neighbour. Plain, everyday words.",
};
const NOTICE_LINE: Record<NonNullable<ReceptionProfile["bookingNotice"]>, string> = {
  none: "Callers can book any time, even for right now, as long as the calendar has a free time.",
  "1h": "Bookings need at least 1 hour's notice.",
  "2h": "Bookings need at least 2 hours' notice.",
  same_day: "Same-day bookings are fine, but not within the next hour.",
  "24h": "Bookings need at least 24 hours' notice. Don't offer anything sooner.",
  "48h": "Bookings need at least 2 days' notice. Don't offer anything sooner.",
};
const FIELD_ASK = new Map<string, string>(CALLER_FIELDS.map((o) => [o.value, o.label.toLowerCase()]));

export type BookingFlow = "book" | "request" | "message" | "none";

/** How this receptionist takes bookings: with the calendar tools, as requests, or as messages only. */
export function bookingFlow(s: Settings, booking: { minutes: number } | null): BookingFlow {
  const mode = s.profile?.bookingMode;
  if (mode === "message_only") return "message";
  if (!booking) return "none";
  return mode === "request" ? "request" : "book";
}

const sentence = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

// The profile's sections: concise, only the ones the business filled in. FAQs are not
// here: the wizard and Settings save them as knowledge items (knowledgeSection).
function profileSections(s: Settings, booking: { minutes: number } | null, callback: boolean): string {
  const p = s.profile;
  if (!p) return "";
  const sections: string[] = [];
  const add = (title: string, lines: string[]) => {
    if (lines.length) sections.push(`${title}\n${lines.map((l) => `- ${l}`).join("\n")}`);
  };

  if (p.tone) add("Tone for this business", [`${PROFILE_TONE_LINE[p.tone]} This is how you should sound; it comes before the general style above.`]);

  const flow = bookingFlow(s, booking);
  const how: string[] = [];
  if (p.bookingMode === "message_only") how.push("You do not make bookings or offer times. Take a message and the team will arrange it.");
  else if (p.bookingMode === "request") how.push("Bookings are requests only. Never say a booking is confirmed: the team confirms each one, usually by call or text.");
  else if (p.bookingMode === "book") how.push(flow === "book" ? "Bookings go straight into the calendar, so you can confirm them on the call." : "The team confirms bookings; don't promise a time.");
  if (flow !== "message") {
    const minutes = booking?.minutes ?? p.appointmentMinutes;
    if (minutes) how.push(`Appointments are ${minutes} minutes unless a service below says otherwise.`);
    if (p.bufferMinutes) how.push(`The calendar leaves ${p.bufferMinutes} minutes between bookings. You don't need to mention it.`);
    if (p.bookingNotice) how.push(NOTICE_LINE[p.bookingNotice]);
    if (p.bookingWindowDays) how.push(`Callers can book up to ${p.bookingWindowDays} days ahead. If they want something further out, take a message for the team.`);
  }
  add("How bookings work", how);

  const details = p.serviceDetails ?? [];
  if (details.length) {
    const showPrice = p.priceAnswers !== "no_quote";
    const lines = details.map((d) => {
      const bits = [d.minutes ? `about ${d.minutes} minutes` : "", showPrice && d.price ? d.price : ""].filter(Boolean);
      return `${d.name}${bits.length ? ` (${bits.join(", ")})` : ""}${d.notes ? `: ${d.notes}` : ""}`;
    });
    add("Services, lengths and prices", lines);
  }
  const priced = (p.serviceDetails ?? []).some((d) => d.price);
  const ask = callback ? "offer to have the team call them back (request_callback)" : "say the team can go through it and offer to pass on a message";
  const priceLines: Partial<Record<NonNullable<ReceptionProfile["priceAnswers"]>, string>> = {
    quote: priced ? "If asked about price, give the exact price listed above. If a service has no price listed, say the team will confirm it." : "",
    from_price: priced ? `If asked about price, say "from" and the listed price, and that the final price depends on the job and the team confirms it.` : "",
    range: priced ? "If asked about price, give a rough range around the listed price and say clearly it is an estimate, not a quote. The team confirms the final price." : "",
    no_quote: `Never give or guess a price, even if asked twice. Say it depends on the job and ${ask}.`,
  };
  // Prices listed with no stated preference are quoted as written.
  const priceMode = p.priceAnswers ?? (priced ? "quote" : undefined);
  if (priceMode && priceLines[priceMode]) add("Price questions", [priceLines[priceMode]!]);

  const fields = (p.callerFields ?? []).filter((f) => f !== "name" && f !== "phone").map((f) => FIELD_ASK.get(f)).filter(Boolean);
  if (fields.length) add("Details to collect on every call", [`As well as their name and number, ask for: ${fields.join("; ")}. One question at a time, and include the answers in the request.`]);

  if (p.newCustomers === "welcome") add("New customers", ["New customers are welcome. Treat them like anyone else."]);
  if (p.newCustomers === "waitlist") add("New customers", ["Not taking new customers straight away. If they are new, say there is a waitlist, take their name, number and what they need, and the team will be in touch when a spot opens. Don't book new customers."]);
  if (p.newCustomers === "existing_only") add("New customers", ["Only existing customers can book. Ask early whether they've been before. If they're new, politely say you're not taking new customers right now, and offer to take a message."]);

  const mode = p.emergencies ?? (p.emergencyNote ? "take_urgent_message" : undefined);
  if (mode && mode !== "not_applicable") {
    const urgent = callback ? "take their name and number, call request_callback with the reason starting URGENT, and tell them the team will get back to them straight away" : "take their name and number and an urgent message, and tell them the team will get back to them straight away";
    const lines: string[] = [];
    if (mode === "advise_000") {
      lines.push("If anything sounds life-threatening or someone is in immediate danger, tell them to hang up and call 000 now. Don't keep them on the line.");
      lines.push(`For urgent but not life-threatening problems, ${urgent}.`);
    } else if (mode === "transfer") {
      lines.push(`You can't put calls through. For an urgent problem, ${urgent}, and say you're getting someone to them right away.`);
    } else {
      lines.push(`For an urgent problem, ${urgent}.`);
    }
    if (p.emergencyNote) lines.push(`What counts as urgent here: ${sentence(p.emergencyNote)}`);
    add("Emergencies", lines);
  }

  const policies: string[] = [];
  if (p.cancellationPolicy) policies.push(`Cancellations: ${sentence(p.cancellationPolicy)}`);
  if (p.paymentMethods?.length) policies.push(`Payment: ${p.paymentMethods.join(", ")}.`);
  if (p.parking) policies.push(`Parking: ${sentence(p.parking)}`);
  if (p.accessibility) policies.push(`Accessibility: ${sentence(p.accessibility)}`);
  if (p.serviceArea) policies.push(`Service area: ${sentence(p.serviceArea)} If they're outside it, say so politely and offer to take a message.`);
  const others = (p.languages ?? []).filter((l) => !/^english$/i.test(l));
  if (others.length) policies.push(`Languages the team speaks: ${(p.languages ?? []).join(", ")}. If the caller speaks one of these and would rather use it, you may continue in that language.`);
  add("Policies and practical details", policies);

  if (p.alwaysDo?.length) add("Always", p.alwaysDo);
  if (p.neverDo?.length) add("Never", p.neverDo);
  return sections.length ? `\n${sections.join("\n\n")}\n` : "";
}

export function buildInstructions(s: Settings, booking: { minutes: number } | null = null, knowledge: KnowledgeEntry[] = []): string {
  const preset = industry(s.industry);
  const noun = businessNoun(s);
  const where = s.suburb ? ` in ${s.suburb}, Australia` : " in Australia";
  const who = s.receptionistName ? `Your name is ${s.receptionistName}. ` : "";
  const tone = TONE_LINE[s.tone] ?? TONE_LINE.friendly;
  const english = DIALECT_NAME[s.dialect ?? "en-AU"] ?? DIALECT_NAME["en-AU"];
  const personality = s.personality ? `\n- Personality: ${s.personality}` : "";

  const info: string[] = describeHours(s.hours).map((line) => `- ${line}`);
  if (s.closures) info.push(`- Closures and public holidays: ${s.closures}. On these days the business is closed, whatever the usual hours say.`);
  if (s.address) info.push(`- Address: ${s.address}`);

  if (s.paused) return pausedInstructions(s, noun, where, who, english, tone, info, booking !== null);

  // booking !== null means the booking tools are on the assistant, so request_callback is too.
  const callback = booking !== null;
  const flow = bookingFlow(s, booking);

  const notes = s.notes
    ? `\nMore about the business (use this to answer questions)\n${s.notes}\n`
    : "";
  const about = s.about ? `\n\nWhat the business does: ${s.about}` : "";
  const sayName = s.sayName ? `\n- Say the business name like this: "${s.sayName}".` : "";
  const answers =
    s.faqStyle === "detailed"
      ? "- When answering a question, give the full answer from what's written here, then check it covered what they needed."
      : "- When answering a question, keep it to a sentence or two and offer more detail if they want it.";
  const avoid = s.avoid?.length
    ? `\n- Never discuss or give opinions on: ${s.avoid.join("; ")}. If asked, say it's not something you can help with on the phone and offer to pass a message to the team.`
    : "";
  const closing = s.closing ? `\n- To finish the conversation, say something close to: "${s.closing}"` : "";
  // A childcare centre's tour confirmation goes to the parent's email, so it always asks for one.
  const collect = s.industry === "childcare" && !(s.collect ?? []).includes("email") ? ["email" as const, ...(s.collect ?? [])] : (s.collect ?? []);
  const extras = collect.map((f) => COLLECT_ASK[f]);
  const collectStep = extras.length ? `\n   Also ask for ${extras.join(", ")}, one at a time.` : "";
  const questions = s.questions?.length
    ? `\n   Then ask these questions, one at a time, and include the answers in the request:\n${s.questions.map((q) => `   - ${q}`).join("\n")}`
    : "";

  const checks = booking && (flow === "book" || flow === "request");
  const step2 = checks
    ? `2. Ask which day suits. Call check_availability for that date (YYYY-MM-DD) before offering anything, then offer two or three of the times it returns. Never offer a time it didn't return. If the day is closed or full, say so and check the next day. ${s.industry === "childcare" ? "Tours" : "Appointments"} are ${booking.minutes} minutes. On a call, say "one moment while I check" before looking.`
    : flow === "message"
      ? `2. Ask which days and times would suit them, just to pass on. Do not offer or promise a time.`
      : `2. Ask which day suits. Offer two times on that day inside opening hours. If they ask for a time when the business is closed, say so and offer the nearest open time.`;
  const finish =
    flow === "book"
      ? `5. Repeat it back once: what they need, day, time, name and number.
6. Call book_appointment with the slot's exact start value${collect.includes("email") ? ", and their email if they gave one" : ""}. If it says booked, tell them it's confirmed for that day and time. If it says the time is gone, check availability again and offer other times. If it fails for any other reason, say you couldn't lock it in, call request_callback, and tell them the team will call to confirm.`
      : flow === "request"
        ? `5. Repeat it back once: what they need, day, time, name and number.
6. Call request_callback with their name, number, what they need, and the time they chose as the preferred time. You cannot book it yourself. Tell them it's a booking request and the team will confirm it. Do not say it is confirmed or booked.`
        : flow === "message"
          ? `5. Repeat the message back once: what they need, when suits, name and number.
6. ${callback ? "Call request_callback with it, then tell" : "Tell"} them the team will get back to them to sort it out. Do not say anything is booked.`
          : `5. Repeat the request back once: what they need, day, time, name and number.
6. Tell them the request has been passed to the team, who will confirm it. Do not say it is confirmed or booked, because you cannot see the calendar.`;

  return `You are the receptionist for ${s.businessName}, ${article(noun)} ${noun}${where}. ${who}It is {{telnyx_current_time_${s.timezone}}} local time.${about}

You answer both phone calls and text messages. This conversation's channel is "{{telnyx_conversation_channel}}": "sms_chat" or "web_chat" means you are texting, anything else means a voice call.

How you speak on a call
- ${english}. ${tone}${personality}${sayName}
- One or two short sentences per turn. Ask one question at a time and wait for the answer.
- If the caller interrupts, stop talking and listen.
- Say times the natural way ("two fifteen in the afternoon"), never in 24-hour format.
${answers}

How you write by text
- ${english}. ${tone}
- Keep each reply under 300 characters. Plain text only: no markdown, lists or emoji.
- Ask one question per message.
- Write times as "2:15pm" and dates as "Tue 3 Dec".
- You already have their number ({{telnyx_end_user_target}}). Don't ask for it unless they want to be contacted on a different one.
- If they reply STOP or ask not to be texted, reply once to confirm they won't get more texts, then don't reply again.

Opening hours and location
${info.join("\n")}

What callers can ask for
${s.services.map((x) => `- ${x}`).join("\n")}
${notes}${knowledgeSection(knowledge)}${profileSections(s, booking, callback)}
Taking a ${preset.booking} request
1. Ask what they need, and match it to the list above.
${step2}
3. Ask for their full name. If it is unusual, ask them to spell it.
4. On a call, ask for the best mobile number. Read it back in groups (for example "oh four one two, three four five, six seven eight") and ask them to confirm. If they correct it, read the corrected number back before continuing. By text, skip this unless they give a different number.${collectStep}${questions}
${finish}

Rules
- You are an AI assistant. If asked, say so plainly.
- ${preset.guardrail}
- Do not quote prices unless they are written above. Say the team can go through pricing when they confirm.
- If you do not know something, say you will pass the question to the team. Never make up an answer.
- If they ask for a person, take their name, number and a short message${callback ? ", call request_callback with them," : ""} and say the team will get back to them.
- Only talk about ${s.businessName}. Politely decline anything unrelated.${avoid}
- On a call, when the ${preset.customer} has nothing else, say goodbye and end the call. By text, just sign off; there is nothing to end.${closing}`;
}

// While the business has paused its receptionist: greet with the pause message (the
// greeting itself, see greetingOf), take a message, never book. Only request_callback
// stays on the assistant (server/index.ts syncAssistant); the hooks refuse the rest.
function pausedInstructions(s: Settings, noun: string, where: string, who: string, english: string, tone: string, info: string[], callback: boolean): string {
  return `You are the receptionist for ${s.businessName}, ${article(noun)} ${noun}${where}. ${who}It is {{telnyx_current_time_${s.timezone}}} local time.

The business has paused its receptionist for now. You have already told the caller: "${s.paused!.message}"

What to do
- ${english}. ${tone}
- Do not book, check availability, quote prices or answer detailed questions. Say the team will help when they get back to them.
- Offer to take a message: their full name, the best number to reach them (read it back in groups to confirm) and a short note of what it's about. Then repeat it back once${callback ? " and call request_callback with it" : ""}.
- If they only want the opening hours or address, you can give them:
${info.join("\n")}
- You are an AI assistant. If asked, say so plainly.
- When they have nothing else, say goodbye and end the call. By text, keep replies under 300 characters, plain text, and just sign off.`;
}
