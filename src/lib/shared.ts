// Types and presets shared by the browser app and the local API server.

import type { ReceptionProfile } from "./profile";

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const DAYS: { key: DayKey; label: string; short: string }[] = [
  { key: "mon", label: "Monday", short: "Mon" },
  { key: "tue", label: "Tuesday", short: "Tue" },
  { key: "wed", label: "Wednesday", short: "Wed" },
  { key: "thu", label: "Thursday", short: "Thu" },
  { key: "fri", label: "Friday", short: "Fri" },
  { key: "sat", label: "Saturday", short: "Sat" },
  { key: "sun", label: "Sunday", short: "Sun" },
];

export type DayHours = { open: boolean; from: string; to: string };
export type Hours = Record<DayKey, DayHours>;

export type IndustryKey =
  | "dental"
  | "health"
  | "trades"
  | "beauty"
  | "property"
  | "auto"
  | "professional"
  | "childcare"
  | "cafe"
  | "vet"
  | "gym"
  | "physio"
  | "legal"
  | "accounting"
  | "cleaning"
  | "plumbing"
  | "hotel"
  | "retail"
  | "tutoring"
  | "grooming"
  | "removalist"
  | "other";

export type Tone = "friendly" | "professional" | "calm" | "upbeat" | "direct";

/** The English the receptionist writes and speaks in (wording and spelling; the voice sets the accent). */
export type Dialect = "en-AU" | "en-GB" | "en-NZ" | "en-US";
/** Extra details the receptionist collects on a booking or message, beyond name and number. */
export type CollectField = "email" | "address" | "reason" | "new_customer" | "preferred_time";

export type Settings = {
  businessName: string;
  industry: IndustryKey;
  suburb: string;
  timezone: string;
  address: string;
  hours: Hours;
  services: string[];
  receptionistName: string;
  voiceId: string;
  voiceName: string;
  greeting: string;
  tone: Tone;
  notes: string;
  /** What the business is, in its own words, when the industry is "other" ("florist"). */
  industryLabel?: string;
  /** "What does the business do?", in a sentence or two. */
  about?: string;
  /** How to say the business name, when it isn't obvious ("Kia-ora", "Bow-Jay"). */
  sayName?: string;
  /** Public holidays and temporary closures, as the business writes them. */
  closures?: string;
  // Receptionist depth (all optional: older records don't have them). See server/prompt.ts.
  personality?: string;
  dialect?: Dialect;
  closing?: string;
  avoid?: string[];
  faqStyle?: "brief" | "detailed";
  collect?: CollectField[];
  questions?: string[];
  /** Paused by the business: callers hear `message`, a message is taken, nothing is booked. */
  paused?: { at: string; message: string } | null;
  /** The detailed receptionist setup (tone, booking rules, services, policies...). Cleaned by cleanProfile in server/prompt.ts. */
  profile?: ReceptionProfile;
};

export type BookingProvider = "builtin" | "google" | "microsoft";

// How a receptionist books appointments and who hears about them.
export type BookingSetup = {
  provider: BookingProvider;
  // Sent by the receptionist's tools so only it can use this client's endpoints.
  token: string;
  minutes: number;
  enabled: boolean;
  // Each booking and callback is emailed here.
  notifyEmail?: string;
  // ...and POSTed here as JSON, for a CRM.
  leadWebhook?: string;
  createdAt: string;
};

// A Google or Microsoft calendar signed in to for a receptionist.
export type CalendarLink = { provider: "google" | "microsoft"; account: string; lastError: string; connectedAt: string };

export type CalendarEvent = { id: string; start: string; end: string; title: string; details: string };

export type BookingRequest = {
  id: string;
  kind: "booking" | "callback";
  at: string;
  channel: string;
  name: string;
  phone: string;
  // The service for a booking, or the reason for a callback.
  service: string;
  // The booked time, or the preferred callback time.
  start: string;
  status: "booked" | "failed" | "saved";
  note: string;
  // The caller's email, when they gave one (their booking confirmation goes there).
  email?: string;
  // The calendar event this booking made (Google/Outlook event id, or the built-in event's id), so it can be moved or cancelled.
  eventId?: string;
  // Set when the caller moved the booking by phone: the time it was moved from.
  rescheduledFrom?: string;
  // Set when the caller cancelled the booking by phone (the booking's apptStatus is then "cancelled").
  cancelledAt?: string;
  // Where a callback stands, set by the business.
  stage?: "new" | "contacted" | "won" | "lost";
};

export type BookingState = {
  setup: Omit<BookingSetup, "token"> | null;
  // The connected Google/Microsoft calendar, if any.
  calendar: CalendarLink | null;
  // Which calendar sign-ins this server offers.
  signIn: { google: boolean; microsoft: boolean };
  // Whether booking emails can be sent from this server.
  emailReady: boolean;
  // For checking X-Twin-Signature on the CRM webhook.
  webhookSecret: string;
  publicUrl: string;
  live: boolean;
  requests: BookingRequest[];
  // Coming appointments in the built-in calendar.
  upcoming: CalendarEvent[];
};

export type VoiceProviderId = "telnyx" | "vapi";

/** Where a receptionist's number comes from: bought on Telnyx, on Twilio (Vapi answers it), or Vapi's free US numbers. */
export type NumberSource = "telnyx" | "twilio" | "vapi";

export type Business = {
  id: string;
  assistantId: string;
  settings: Settings;
  instructions: string;
  booking?: BookingSetup;
  // The private link the business uses to connect its own mailbox.
  connect?: { tokenHash: string; expiresAt: string; createdAt: string };
  // Numbers Telnyx reports as connected, refreshed whenever the phone number card loads.
  phoneNumbers?: string[];
  // Where each attached number came from (recorded when it's attached; older numbers have none).
  numberSources?: Record<string, NumberSource>;
  // The voice engine this receptionist's assistant lives on. Missing means Telnyx (every
  // receptionist made before Vapi was added). Set when it is made (the agency's choice, or the
  // wizard's Voice engine pick), and changed by "Move to Telnyx/Vapi".
  voiceProvider?: VoiceProviderId;
  // Made from the console's "send the client an onboarding link": "pending" until the
  // client finishes setting it up in their workspace, then "done".
  onboarding?: "pending" | "done";
  createdAt: string;
  updatedAt: string;
};

export type Voice = {
  id: string;
  name: string;
  label: string;
  gender: string;
  recommended: boolean;
  /** "Australian", "British", "American"... (Telnyx's are all Australian, so it's left out there). */
  accent?: string;
  /** Who makes the voice: "ElevenLabs", "Vapi", "Azure" (Vapi engine only). */
  maker?: string;
  /** A short clip of the voice, served from /voice-previews/ (Vapi engine voices). */
  previewUrl?: string;
};

export type CallSummary = {
  id: string;
  startedAt: string;
  channel: string;
  from: string;
  // A conversation from the dashboard's text simulator, not a real customer.
  simulated: boolean;
};

// What the receptionist would do with an email: draft a reply or leave it.
export type EmailPreview = { reply: boolean; reason: string; body: string };

export type CallMessage = { role: string; text: string; at: string };

// "draft": replies wait in the business's Drafts folder. "send": replies go out automatically.
export type EmailMode = "draft" | "send";

// What the business sees on its connect page.
export type ConnectInfo = {
  businessName: string;
  receptionistName: string;
  expiresAt: string;
  email: { connected: boolean; address: string; mode: EmailMode };
  // The calendar the receptionist books into, when it's the business's own.
  calendar: { wanted: "google" | "microsoft" | null; connected: boolean; account: string };
  // Which "Sign in with…" buttons are set up on this server: for the calendar,
  // and for the mailbox (the platform can turn Google mailbox sign-in off).
  signIn: { google: boolean; microsoft: boolean };
  mailSignIn: { google: boolean; microsoft: boolean };
};

export type EmailActivity = {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  action: "drafted" | "sent" | "skipped" | "failed";
  note: string;
  draft: string;
};

export type EmailStatus = {
  connected: boolean;
  address: string;
  mode: EmailMode;
  connectedAt: string;
  lastCheckedAt: string;
  lastError: string;
  activity: EmailActivity[];
};

// Australia: mobile (calls and texts) or local. The US has no "mobile" numbers to
// buy: local or toll-free, and texting from them needs 10DLC registration first.
export type NumberType = "local" | "mobile" | "toll_free";
export type NumberCountry = "AU" | "US";

export const NUMBER_COUNTRIES: { value: NumberCountry; label: string; types: { value: NumberType; label: string }[] }[] = [
  {
    value: "AU",
    label: "Australia",
    types: [
      { value: "mobile", label: "Mobile (calls and texts)" },
      { value: "local", label: "Local (calls only)" },
    ],
  },
  {
    value: "US",
    label: "United States",
    types: [
      { value: "local", label: "Local" },
      { value: "toll_free", label: "Toll-free" },
    ],
  },
];

// +61 and 9 digits; +1 and 10 digits (a US area code never starts with 0 or 1).
const NUMBER_PATTERN: Record<NumberCountry, RegExp> = { AU: /^\+61\d{9}$/, US: /^\+1[2-9]\d{9}$/ };

/** The country to buy numbers in for a receptionist in this time zone. */
export function countryForTimezone(tz: string | null | undefined): NumberCountry {
  const z = String(tz ?? "");
  return z.startsWith("America/") || z === "Pacific/Honolulu" ? "US" : "AU";
}

/** Which of our countries a number (E.164) belongs to, or null. */
export function countryOfNumber(e164: string): NumberCountry | null {
  if (NUMBER_PATTERN.AU.test(e164)) return "AU";
  if (NUMBER_PATTERN.US.test(e164)) return "US";
  return null;
}

const US_TOLL_FREE = /^\+18(00|33|44|55|66|77|88)\d{7}$/;

/** What kind of number it is, worked out from the number itself. */
export function typeOfNumber(e164: string): NumberType {
  if (/^\+614\d{8}$/.test(e164)) return "mobile";
  if (US_TOLL_FREE.test(e164)) return "toll_free";
  return "local";
}

export type AvailableNumber = {
  phoneNumber: string;
  country: NumberCountry;
  type: NumberType;
  monthly: number;
  upfront: number;
  currency: string;
  sms: boolean;
  /** Twilio only: Australian numbers need an approved regulatory bundle and an address to buy. */
  needsBundle?: boolean;
};

export type ConnectedNumber = { id: string; phoneNumber: string; status: string; type: string };

export type NumberOrder = {
  id: string;
  status: string;
  requirementsMet: boolean;
  phoneNumbers: string[];
  createdAt: string;
};

// numbers: take texts. waiting: answer calls but don't take texts yet.
export type TextingState = { enabled: boolean; numbers: string[]; waiting: string[] };

// What the voice engine can do about phone numbers, so the screens say it honestly.
// Telnyx: search, buy and attach. Vapi: it only sells free US numbers, so for an
// Australian receptionist a number is brought over from Twilio or Telnyx ("import").
export type NumberSupport = {
  provider: VoiceProviderId;
  buy: boolean;
  import: boolean;
  // Whether a Twilio number can answer this receptionist (Vapi only).
  twilio?: boolean;
  note: string;
  /** Which numbers fit this receptionist's engine, and why (shown in the Add-a-number dialog). */
  rule?: string;
};

export type NumberState = {
  provider?: VoiceProviderId;
  support?: NumberSupport;
  numbers: ConnectedNumber[];
  pending: NumberOrder[];
  // The platform's balance; only shown to the platform team.
  balance: { amount: number; currency: string } | null;
  // Only the platform team buys numbers. Everyone else asks for one.
  canBuy: boolean;
  // An agency on its own phone account can also connect numbers it already owns.
  canUseOwn?: boolean;
  requests: NumberRequest[];
};

export type NumberRequest = {
  id: string;
  type: NumberType;
  note: string;
  status: "pending" | "done" | "declined";
  phoneNumber: string;
  reason: string;
  createdAt: string;
};

// country: where the receptionist is (from its time zone), so the number is bought there.
export type AdminNumberRequest = NumberRequest & { agency: string; business: string; requestedBy: string; clientId: string; country: NumberCountry };

// One way of writing numbers per country, everywhere they're shown:
// "+61731234567" -> "(07) 3123 4567", "+61412345678" -> "0412 345 678",
// "+12125550123" -> "(212) 555-0123". Anything else is shown as it is.
export function formatNumber(e164: string): string {
  const us = e164.match(/^\+1([2-9]\d{2})(\d{3})(\d{4})$/);
  if (us) return `(${us[1]}) ${us[2]}-${us[3]}`;
  const m = e164.match(/^\+61(\d{9})$/);
  if (!m) return e164;
  const d = m[1];
  if (d.startsWith("4")) return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return `(0${d[0]}) ${d.slice(1, 5)} ${d.slice(5)}`;
}

export const TIMEZONES: { value: string; label: string }[] = [
  { value: "Australia/Brisbane", label: "Brisbane (QLD)" },
  { value: "Australia/Sydney", label: "Sydney, Canberra (NSW, ACT)" },
  { value: "Australia/Melbourne", label: "Melbourne (VIC)" },
  { value: "Australia/Hobart", label: "Hobart (TAS)" },
  { value: "Australia/Adelaide", label: "Adelaide (SA)" },
  { value: "Australia/Darwin", label: "Darwin (NT)" },
  { value: "Australia/Perth", label: "Perth (WA)" },
  { value: "America/New_York", label: "US Eastern (New York)" },
  { value: "America/Chicago", label: "US Central (Chicago)" },
  { value: "America/Denver", label: "US Mountain (Denver)" },
  { value: "America/Phoenix", label: "US Mountain, no daylight saving (Phoenix)" },
  { value: "America/Los_Angeles", label: "US Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];

type IndustryPreset = {
  key: IndustryKey;
  label: string;
  // How the script refers to the business and its customers.
  noun: string;
  customer: string;
  booking: string;
  services: string[];
  // Weekday hours when they aren't 8am to 5pm; "always" is open 24/7.
  weekdays?: [string, string] | "always";
  // "every-day": Saturday and Sunday open the same hours as weekdays.
  weekend: "closed" | "sat-morning" | "sat-full" | "every-day";
  // Advice the receptionist must never give for this industry.
  guardrail: string;
};

export const INDUSTRIES: IndustryPreset[] = [
  {
    key: "dental",
    label: "Dental clinic",
    noun: "dental clinic",
    customer: "patient",
    booking: "appointment",
    services: ["Check-up and clean", "Toothache or emergency", "Whitening consult", "Child's first visit"],
    weekend: "sat-morning",
    guardrail:
      "Never give dental or medical advice. For severe pain, swelling, bleeding or an injury, say the team will call back as a priority, and that in an emergency they should call triple zero.",
  },
  {
    key: "health",
    label: "Clinic or allied health",
    noun: "clinic",
    customer: "patient",
    booking: "appointment",
    services: ["Initial consultation", "Follow-up appointment", "Remedial massage", "Telehealth consult"],
    weekend: "sat-morning",
    guardrail:
      "Never give medical advice or comment on symptoms, medication or results. In an emergency, tell the caller to call triple zero.",
  },
  {
    key: "trades",
    label: "Trades and home services",
    noun: "trade business",
    customer: "customer",
    booking: "job booking",
    services: ["Quote request", "Repair or call-out", "Installation", "Emergency job"],
    weekend: "sat-morning",
    guardrail:
      "Do not diagnose faults or tell the caller how to fix something themselves. For gas leaks, electrical danger or flooding, tell them to call triple zero or their utility's emergency line first.",
  },
  {
    key: "beauty",
    label: "Salon, barber or beauty",
    noun: "salon",
    customer: "client",
    booking: "appointment",
    services: ["Cut and style", "Colour", "Barber cut", "Facial or skin treatment"],
    weekend: "sat-full",
    guardrail: "Do not give advice on skin conditions, allergies or reactions. Offer to have the team call back.",
  },
  {
    key: "property",
    label: "Real estate",
    noun: "real estate agency",
    customer: "client",
    booking: "inspection or appraisal",
    services: ["Book an inspection", "Request an appraisal", "Rental enquiry", "Maintenance request"],
    weekend: "sat-full",
    guardrail:
      "Do not give price estimates, legal advice or details about tenants or owners. Take the enquiry for an agent to follow up.",
  },
  {
    key: "auto",
    label: "Mechanic or automotive",
    noun: "workshop",
    customer: "customer",
    booking: "booking",
    services: ["Logbook service", "Repair or diagnosis", "Roadworthy inspection", "Tyres and brakes"],
    weekend: "sat-morning",
    guardrail: "Do not diagnose a vehicle or say whether it is safe to drive. Offer to have a mechanic call back.",
  },
  {
    key: "professional",
    label: "Professional services",
    noun: "office",
    customer: "client",
    booking: "meeting",
    services: ["New client enquiry", "Book a meeting", "Existing client question"],
    weekend: "closed",
    guardrail: "Do not give legal, financial or tax advice. Take the enquiry for the right person to follow up.",
  },
  {
    key: "childcare",
    label: "Childcare or early learning centre",
    noun: "childcare centre",
    customer: "parent",
    booking: "centre tour",
    services: ["Book a centre tour", "Enrolment or waitlist enquiry", "Fees and subsidy question", "Message for the director"],
    weekdays: ["06:30", "18:30"],
    weekend: "closed",
    guardrail:
      "Never discuss an individual child, who may collect a child, custody or family arrangements, or health and medical matters: offer a call back from the director instead. A tour is a visit only: never promise a place, an enrolment, a start date or a fee unless the centre's approved answers say so. If a child may be in danger right now, tell the caller to call triple zero.",
  },
  {
    key: "cafe",
    label: "Café or restaurant",
    noun: "café",
    customer: "customer",
    booking: "table booking",
    services: ["Book a table", "Takeaway or order enquiry", "Functions and catering", "Dietary or menu question"],
    weekdays: ["07:00", "15:00"],
    weekend: "every-day",
    guardrail:
      "Never say a dish is safe for an allergy or intolerance: say the team can talk them through the ingredients. Do not take card details over the phone.",
  },
  {
    key: "vet",
    label: "Vet clinic",
    noun: "vet clinic",
    customer: "pet owner",
    booking: "appointment",
    services: ["Check-up or vaccination", "Sick or injured pet", "Desexing or surgery enquiry", "Repeat medication or food"],
    weekdays: ["08:00", "18:00"],
    weekend: "sat-morning",
    guardrail:
      "Never give veterinary advice or say whether a pet needs to be seen. If a pet can't breathe, is bleeding heavily, has collapsed, has been hit by a car or has eaten something poisonous, tell them to come in straight away or go to the nearest emergency vet, and that the team will call back as a priority.",
  },
  {
    key: "gym",
    label: "Gym or fitness studio",
    noun: "gym",
    customer: "member",
    booking: "class or session",
    services: ["Membership enquiry", "Book a class", "Personal training", "Pause or cancel a membership"],
    weekdays: ["05:30", "21:00"],
    weekend: "every-day",
    guardrail:
      "Do not give medical, injury or diet advice. Do not change, pause or cancel a membership on the call: take the request for the team.",
  },
  {
    key: "physio",
    label: "Physio or chiropractor",
    noun: "clinic",
    customer: "patient",
    booking: "appointment",
    services: ["Initial assessment", "Follow-up treatment", "Sports injury", "Workers' comp or insurance enquiry"],
    weekdays: ["07:30", "18:30"],
    weekend: "sat-morning",
    guardrail:
      "Never give medical advice or comment on pain, injuries or treatment. In an emergency, tell the caller to call triple zero.",
  },
  {
    key: "legal",
    label: "Law firm",
    noun: "law firm",
    customer: "client",
    booking: "consultation",
    services: ["New matter enquiry", "Book a consultation", "Update on an existing matter", "Documents or signing"],
    weekend: "closed",
    guardrail:
      "Never give legal advice or comment on the caller's matter, deadlines or chances. Take the details for a lawyer to follow up, and keep what they say private.",
  },
  {
    key: "accounting",
    label: "Accountant or bookkeeper",
    noun: "accounting practice",
    customer: "client",
    booking: "appointment",
    services: ["Tax return appointment", "New client enquiry", "BAS or bookkeeping", "Question for my accountant"],
    weekend: "closed",
    guardrail:
      "Do not give tax, financial or accounting advice, or say what someone owes or will get back. Take the question for an accountant to follow up.",
  },
  {
    key: "cleaning",
    label: "Cleaning service",
    noun: "cleaning business",
    customer: "customer",
    booking: "clean",
    services: ["Quote for a clean", "Regular home or office clean", "End-of-lease or bond clean", "Carpet or window cleaning"],
    weekend: "sat-morning",
    guardrail:
      "Do not quote a firm price or promise a bond-back result. Take the details (the size of the place and what's needed) for the team to quote.",
  },
  {
    key: "plumbing",
    label: "Plumber or electrician",
    noun: "plumbing and electrical business",
    customer: "customer",
    booking: "job booking",
    services: ["Emergency call-out", "Blocked drain or leak", "Power or wiring fault", "Hot water", "Quote request"],
    weekdays: ["07:00", "17:00"],
    weekend: "sat-morning",
    guardrail:
      "Do not diagnose faults or tell the caller how to fix something themselves. For a gas leak, sparking, a fire or an electric shock, tell them to get to safety and call triple zero first. Treat flooding or no power as an urgent job.",
  },
  {
    key: "hotel",
    label: "Hotel or accommodation",
    noun: "hotel",
    customer: "guest",
    booking: "booking",
    services: ["Room booking or availability", "Change or cancel a booking", "Check-in and check-out times", "Message for reception"],
    weekdays: "always",
    weekend: "every-day",
    guardrail:
      "Do not take card details over the phone, confirm a room or rate that isn't written above, or say whether someone is staying. Take the request for reception.",
  },
  {
    key: "retail",
    label: "Shop or retail store",
    noun: "shop",
    customer: "customer",
    booking: "enquiry",
    services: ["Is it in stock?", "Order or delivery enquiry", "Returns or exchanges", "Opening hours and location"],
    weekdays: ["09:00", "17:30"],
    weekend: "sat-full",
    guardrail: "Do not promise stock, prices or refunds unless they are written above. Take the details for the team to check.",
  },
  {
    key: "tutoring",
    label: "Tutoring or coaching",
    noun: "tutoring centre",
    customer: "caller",
    booking: "lesson",
    services: ["Book a trial lesson", "Subjects and year levels", "Change or cancel a lesson", "Fees enquiry"],
    weekdays: ["09:00", "18:00"],
    weekend: "sat-morning",
    guardrail:
      "Do not discuss an individual student's progress or results, or promise results. Offer a call back from the tutor.",
  },
  {
    key: "grooming",
    label: "Pet grooming",
    noun: "pet grooming salon",
    customer: "customer",
    booking: "grooming appointment",
    services: ["Wash and groom", "Clip or full groom", "Nail trim", "Puppy's first groom"],
    weekend: "sat-full",
    guardrail:
      "Do not give advice about a pet's skin, ears or health: suggest they check with their vet, and offer to have the groomer call back.",
  },
  {
    key: "removalist",
    label: "Removalist",
    noun: "removalist",
    customer: "customer",
    booking: "move",
    services: ["Quote for a move", "Book a moving date", "Packing and boxes", "Storage enquiry"],
    weekdays: ["07:00", "17:00"],
    weekend: "sat-full",
    guardrail:
      "Do not quote a firm price or promise a date before the team confirms it. Take the moving date, both addresses and what's being moved.",
  },
  {
    key: "other",
    label: "Something else",
    noun: "business",
    customer: "customer",
    booking: "booking",
    services: ["General enquiry", "Booking request", "Request a call back"],
    weekend: "closed",
    guardrail: "Do not give professional advice. Take the enquiry for the team to follow up.",
  },
];

export function industry(key: IndustryKey): IndustryPreset {
  return INDUSTRIES.find((i) => i.key === key) ?? INDUSTRIES[INDUSTRIES.length - 1];
}

export const ALWAYS_FROM = "00:00";
export const ALWAYS_TO = "23:59";

/** Open every day, all day ("Always on (24/7)"). */
export function alwaysOpen(): Hours {
  const day = (): DayHours => ({ open: true, from: ALWAYS_FROM, to: ALWAYS_TO });
  return { mon: day(), tue: day(), wed: day(), thu: day(), fri: day(), sat: day(), sun: day() };
}

const allDay = (h: DayHours | undefined) => Boolean(h?.open && h.from === ALWAYS_FROM && h.to === ALWAYS_TO);

/** True when every day is open 00:00 to 23:59. */
export const isAlwaysOpen = (hours: Hours) => DAYS.every((d) => allDay(hours[d.key]));

export function defaultHours(key: IndustryKey): Hours {
  const preset = industry(key);
  if (preset.weekdays === "always") return alwaysOpen();
  const [from, to] = preset.weekdays ?? ["08:00", "17:00"];
  const weekday: DayHours = { open: true, from, to };
  const sat: DayHours =
    preset.weekend === "every-day"
      ? { ...weekday }
      : preset.weekend === "sat-full"
        ? { open: true, from: "09:00", to: "16:00" }
        : preset.weekend === "sat-morning"
          ? { open: true, from: "09:00", to: "12:00" }
          : { open: false, from: "09:00", to: "12:00" };
  return {
    mon: { ...weekday },
    tue: { ...weekday },
    wed: { ...weekday },
    thu: { ...weekday },
    fri: { ...weekday },
    sat,
    sun: preset.weekend === "every-day" ? { ...weekday } : { open: false, from: "09:00", to: "12:00" },
  };
}

export function defaultGreeting(businessName: string, receptionistName: string): string {
  const biz = businessName.trim() || "our office";
  const who = receptionistName.trim();
  const intro = who ? `I'm ${who}, the AI assistant here` : "I'm the AI assistant here";
  return `Hi, you've reached ${biz}. ${intro}. How can I help?`;
}

/**
 * Greetings never promise a recording: whether calls are recorded is the Call recording
 * setting, and the server adds its notice to the spoken greeting only when it's on
 * (server/automations.ts greetingFor). This drops a "this call is recorded" clause
 * from greetings written before that, so a receptionist that isn't recording doesn't say it.
 */
export function withoutRecordingLine(greeting: string): string {
  return greeting
    .replace(/,?\s+and this call is (?:being )?recorded(?=\s*[.,!?]|$)/gi, "")
    .replace(/\s*\b(?:just so you know, )?this call (?:is|may be|will be) (?:being )?recorded[^.!?]*[.!?]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "a" or "an" before a word. */
export const article = (word: string) => (/^[aeiou]/i.test(word.trim()) ? "an" : "a");

/** What the business is called in the script: its preset's noun, or its own words for "Something else". */
export function businessNoun(s: Pick<Settings, "industry" | "industryLabel">): string {
  const label = s.industry === "other" ? (s.industryLabel ?? "").trim() : "";
  if (!label) return industry(s.industry).noun;
  // "Florist" -> "florist", but "NDIS provider" stays as it is.
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

const EMERGENCY_LINE: Partial<Record<IndustryKey, string>> = {
  dental: "If you're in pain or it's urgent, tell me straight away.",
  health: "If this is a medical emergency, please hang up and call triple zero.",
  physio: "If this is a medical emergency, please hang up and call triple zero.",
  vet: "If your pet needs urgent care, tell me straight away.",
  trades: "If it's an emergency, tell me straight away.",
  plumbing: "If it's an emergency, like a burst pipe or no power, tell me straight away.",
};

/**
 * Ready-made greetings for the setup wizard. Each one says it's an AI, like
 * defaultGreeting. None says the call is recorded: that's added only when recording is on.
 */
export function greetingsFor(key: IndustryKey, businessName: string, receptionistName: string): { label: string; text: string }[] {
  const biz = businessName.trim() || "our office";
  const who = receptionistName.trim();
  const intro = who ? `I'm ${who}, the AI assistant here` : "I'm the AI assistant here";
  const preset = industry(key);
  const out = [{ label: "Standard", text: defaultGreeting(businessName, receptionistName) }];
  if (key === "childcare") {
    const me = who ? `I'm ${who}, the centre's AI receptionist` : "I'm the centre's AI receptionist";
    out.unshift({
      label: "Childcare centre",
      text: `Thanks for calling ${biz}. ${me}. I can help with enrolments, tours and general questions. If you'd prefer to speak with the team, just let me know.`,
    });
  }
  const emergency = EMERGENCY_LINE[key];
  if (emergency) out.push({ label: "Urgent calls first", text: `Hi, you've reached ${biz}. ${intro}. ${emergency} Otherwise, how can I help?` });
  out.push({
    label: "Bookings first",
    text: `Hi, you've reached ${biz}. ${intro}. I can help with ${article(preset.booking)} ${preset.booking} or answer any questions. What can I do for you?`,
  });
  return out;
}

/**
 * Starter answers for a childcare centre, from the approved-answers sheet in the
 * centre onboarding pack. Added to a new childcare receptionist's knowledge for the
 * director to check and replace with their approved wording.
 */
export const CHILDCARE_STARTER_ANSWERS: { topic: string; question: string; answer: string }[] = [
  { topic: "Tours", question: "Can I visit?", answer: "Offer available tours from the designated calendar. Confirm only after booking succeeds." },
  { topic: "Availability", question: "Is there a place for my child?", answer: "Ask the enrolments team to call back. A tour does not reserve a place." },
  { topic: "Fees", question: "What will it cost?", answer: "Use the current fee sheet approved by the director or offer a callback." },
  { topic: "Hours and parking", question: "When are you open and where do I go?", answer: "Use verified opening times, closures, address and arrival instructions for this centre." },
  { topic: "Family matters", question: "Can I change collection arrangements?", answer: "Refer to authorised staff. Avoid collecting private child or family details in the call summary." },
  { topic: "Urgent", question: "I need somebody urgently.", answer: "Use the director-approved urgent call instructions and fixed staff fallback." },
  { topic: "Booking changes", question: "Can I cancel or move my visit?", answer: "Take the minimum callback details and pass the change to the centre team." },
];

/** How a starter answer is titled, so the director knows to check it. */
export const starterTitle = (question: string) => `${question} (starter answer: director to check)`;

// "17:00" -> "5pm", "08:30" -> "8:30am"
export function sayTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(h)) return hhmm;
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
}

// Groups consecutive days with the same hours: "Monday to Friday 8am to 5pm".
export function describeHours(hours: Hours): string[] {
  if (isAlwaysOpen(hours)) return ["Open 24 hours, 7 days (24/7)"];
  const lines: string[] = [];
  let i = 0;
  while (i < DAYS.length) {
    const start = DAYS[i];
    const a = hours[start.key];
    let j = i;
    while (j + 1 < DAYS.length) {
      const b = hours[DAYS[j + 1].key];
      const same = a.open === b.open && (!a.open || (a.from === b.from && a.to === b.to));
      if (!same) break;
      j++;
    }
    const range = j === i ? start.label : `${start.label} to ${DAYS[j].label}`;
    lines.push(!a.open ? `${range}: closed` : allDay(a) ? `${range}: open 24 hours` : `${range}: ${sayTime(a.from)} to ${sayTime(a.to)}`);
    i = j + 1;
  }
  return lines;
}

export function blankSettings(): Settings {
  return {
    businessName: "",
    industry: "dental",
    suburb: "",
    timezone: "Australia/Brisbane",
    address: "",
    hours: defaultHours("dental"),
    services: [...industry("dental").services],
    receptionistName: "",
    voiceId: "",
    voiceName: "",
    greeting: "",
    tone: "friendly",
    notes: "",
  };
}

// ---- Accounts ----

// "customer" is the end business: read-only, sees only their own receptionist.
export type OrgRole = "owner" | "admin" | "member" | "customer";

export type Brand = {
  logo: string;
  bgColor: string;
  bgImage: string;
  /** Brand colours (#rrggbb, "" = the default). */
  primaryColor?: string;
  accentColor?: string;
  sidebarColor?: string;
};

// `support` is set for a sign-in by the setup provider's support person (Settings, "Support"); `by` is who.
export type Viewing = { org: string; client: string | null; business: string; support?: boolean; by?: string; /** support session that may make changes (the owner allows it by default) */ canEdit?: boolean };

// Settings, "Support" (server/supportSync.ts).
export type SupportSettings = {
  configured: boolean;
  seller: string;
  sync: { enabled: boolean; lastSentAt: string | null; lastOk: boolean | null; lastError: string };
  access: { enabled: boolean; until: string | null; grantedAt: string | null; isDefault?: boolean };
  /** Support can make changes (never keys, billing, the owner or exports) while access is on. */
  edit: { enabled: boolean };
  sends: string[];
  neverSent: string;
  recent: { action: string; summary: string; at: string }[];
};

// Settings, "Updates" (server/autoUpdate.ts).
export type UpdatesStatus = {
  /** this copy has its own Railway project token, so it can update itself */
  available: boolean;
  /** why it isn't available: "no-token", or what Railway said when it refused the project token */
  unavailableReason?: string;
  enabled: boolean;
  mode: "overnight" | "asap";
  version: string;
  latest: string;
  deploying: boolean;
  lastResult: "ok" | "failed" | "";
  lastError: string;
  lastAt: string | null;
};

export type Account = {
  user: { id: string; email: string; name: string; platformAdmin: boolean };
  org: { id: string; name: string } | null;
  role: OrgRole | null;
  orgs: { id: string; name: string; role: OrgRole }[];
  // Whose Telnyx account this team's receptionists run on: its own key, the
  // platform's (if the platform allowed it), or none yet (it must add one).
  telnyx: "own" | "platform" | "none";
  // Set while the platform team is looking at an agency or a customer's view (read-only).
  viewing?: Viewing;
  // Logo and background for this team's screens (a business's own, in its customer view).
  brand?: Brand;
  // Which screens: "platform"/"agency" use the console (/admin), business users (null) the workspace (/app).
  console: "platform" | "agency" | null;
  home: "/admin" | "/app";
  // A business user's access to each receptionist shared with them in this org.
  access: { clientId: string; role: "manager" | "viewer" }[];
  // SINGLE_AGENCY=1: the whole server is this one agency (no platform team above it).
  singleAgency?: boolean;
  // May change the server's own settings (Settings, "Email and calendars").
  serverSettings?: boolean;
  // The "Ask for help" AI assistant is on for this person (server has an OPENROUTER_API_KEY and they are an agency owner or admin).
  assistant?: boolean;
};

// An agency's phone account as the Setup and Connections screens see it
// (server/phoneAccount.ts).
/** The agency's Twilio account (Connections): an optional extra phone-number source. Server side: server/twilio.ts. */
export type TwilioAccount = {
  connected: boolean;
  // own: the agency's own account. platform: the install's (set when it was installed). none: not connected.
  mode: "own" | "platform" | "none";
  accountSid: string;
  authKind: "token" | "key";
  last4: string;
  name: string;
  connectedAt: string;
  // Why the last check of the credentials failed ("" when fine).
  problem: string;
  // SINGLE_AGENCY or platform account: nothing to connect or replace here.
  installed?: boolean;
  // Local test servers only: pretend credentials that pass the check.
  testSid?: string;
  testToken?: string;
};

/** A number on the agency's Twilio account. assignedTo is the receptionist that answers it, or "". */
export type TwilioNumber = { id: string; phoneNumber: string; friendlyName: string; type: NumberType; sms: boolean; voice: boolean; assignedTo: string };

/** Twilio's rules for Australian numbers: an approved regulatory bundle is needed to buy one. */
export type TwilioRegulatory = { approved: boolean; inReview: number; consoleUrl: string };

export type PhoneAccount = {
  // The voice engine this agency's new receptionists are made on. Telnyx unless Vapi is chosen.
  provider: VoiceProviderId;
  // Vapi only: the public key browsers use for the test call, once saved.
  vapiPublicKey?: string;
  // The engine the install itself defaults to (VOICE_PROVIDER), for the Connections wording.
  installProvider: VoiceProviderId;
  // own: the agency's own Telnyx key. platform: runs on the platform's account. none: not connected yet.
  mode: "own" | "platform" | "none";
  last4: string;
  connectedAt: string;
  // The agency's own credit. Null when it isn't theirs to see or the check failed.
  balance: { amount: number; currency: string } | null;
  // Why the last check of their key failed ("" when it's fine).
  problem: string;
  lowCredit: boolean;
  // New agencies here must bring their own phone account.
  required: boolean;
  // SINGLE_AGENCY: the account is the server's own key, set at install (nothing to connect or replace).
  installed?: boolean;
  counts: { clients: number; numbers: number; calendars: number };
  // Local test servers only: a pretend key that passes the check.
  testKey?: string;
};

// The platform's email sender and Google/Microsoft sign-in apps, as the platform
// admin's Settings tab sees them (server/platformSettingsApi.ts). Never holds a
// whole secret: only its last 4 characters.
export type PlatformServiceState = {
  // saved: set in the dashboard. server: nothing saved, the server's environment
  // has it. none: neither.
  state: "saved" | "server" | "none";
  // The environment also has a complete setting (what clearing the saved one falls back to).
  serverHas: boolean;
  last4: string;
  savedAt: string;
  savedBy: string;
  // Why the saved setting can't be used ("" when it's fine).
  problem: string;
};

export type PlatformSettings = {
  mail: PlatformServiceState & { host: string; from: string };
  // scopes: exactly what the app is asked for on this server. mailboxSignIn: whether
  // it is also offered for mailboxes (MAILBOX_SIGNIN), not just calendars.
  google: PlatformServiceState & { clientId: string; redirectUri: string; scopes: string[]; mailboxSignIn: boolean };
  microsoft: PlatformServiceState & { clientId: string; redirectUri: string; scopes: string[]; mailboxSignIn: boolean };
  // The public address the redirect URIs are built from, and a warning when it
  // won't work with the providers (not https, or a local address).
  publicBase: string;
  publicWarning: string;
  // Where test emails go: the signed-in admin.
  testTo: string;
};

export type PlatformTestResult = { ok: true; message: string; redirectUri?: string };

// Settings, "Email" (server/emailSettings.ts): how account emails are sent, with an optional backup.
export type EmailProviderId = "resend" | "gmail" | "microsoft" | "zoho_au" | "zoho" | "smtp";
export type EmailSenderView = { provider: EmailProviderId; label: string; host: string; port: number; username: string; from: string; last4: string };
export type RecentEmail = { id: string; to: string; subject: string; status: "pending" | "sent" | "failed"; via: string; attempts: number; error: string; at: string; nextAt: string };
export type EmailSettings = {
  // saved: set in the dashboard. server: from the server's own settings file. none: not set (links are shown to copy).
  source: "saved" | "server" | "none";
  primary: EmailSenderView | null;
  backup: EmailSenderView | null;
  savedAt: string;
  savedBy: string;
  problem: string;
  recent: RecentEmail[];
  testTo: string;
};

export type TelnyxSettings = {
  provider?: VoiceProviderId;
  mode: "own" | "platform" | "none";
  last4: string;
  balance: { amount: number; currency: string } | null;
};

export type Agency = {
  id: string;
  name: string;
  /** The platform's own team: it can't be deleted. */
  home?: boolean;
  createdAt: string;
  members: number;
  clients: number;
  owners: string[];
  pendingInvites: string[];
  telnyx: "own" | "platform" | "none";
  // The voice engine this agency makes new receptionists on.
  provider?: VoiceProviderId;
  platformTelnyx: boolean;
  suspended: boolean;
  // Onboarding progress, for the platform team's flow view.
  customers: number;
  withNumbers: number;
  sandbox: boolean;
};

export type TestLogin = { email: string; password: string; role: string };

export type Session =
  | ({ signedIn: true } & Account)
  | { signedIn: false; signupOpen: boolean; firstRun: boolean; singleAgency?: boolean };

export type TeamState = {
  members: { id: string; email: string; name: string; role: OrgRole; joinedAt: string }[];
  invites: { id: string; email: string; role: OrgRole; expiresAt: string }[];
  // Whether invites are emailed, or have to be sent by hand.
  emailsSent: boolean;
};

export type CustomerAccess = {
  people: { id: string; email: string; name: string; since: string }[];
  invites: { id: string; email: string; expiresAt: string }[];
};

export type PortalReceptionist = {
  businessName: string;
  receptionistName: string;
  industry: IndustryKey;
  suburb: string;
  timezone: string;
  hours: Hours;
  services: string[];
  greeting: string;
  tone: string;
  voice: string;
  phoneNumbers: string[];
  agency: string;
};

export type PortalClient = { id: string; businessName: string; receptionistName: string; brand: Brand };

export type InviteInfo = { orgName: string; email: string; role: OrgRole; hasAccount: boolean; businessName?: string };
