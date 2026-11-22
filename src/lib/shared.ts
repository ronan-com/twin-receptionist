// Types and presets shared by the browser app and the local API server.

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
  | "other";

export type Tone = "friendly" | "professional";

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
  createdAt: string;
  updatedAt: string;
};

export type Voice = {
  id: string;
  name: string;
  label: string;
  gender: string;
  recommended: boolean;
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
  // Which "Sign in with…" buttons are set up on this server.
  signIn: { google: boolean; microsoft: boolean };
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

export type NumberType = "local" | "mobile";

export type AvailableNumber = {
  phoneNumber: string;
  type: NumberType;
  monthly: number;
  upfront: number;
  currency: string;
  sms: boolean;
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

export type NumberState = {
  numbers: ConnectedNumber[];
  pending: NumberOrder[];
  // The platform's balance; only shown to the platform team.
  balance: { amount: number; currency: string } | null;
  // Only the platform team buys numbers. Everyone else asks for one.
  canBuy: boolean;
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

export type AdminNumberRequest = NumberRequest & { agency: string; business: string; requestedBy: string; clientId: string };

// "+61731234567" -> "(07) 3123 4567", "+61412345678" -> "0412 345 678"
export function formatNumber(e164: string): string {
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
];

type IndustryPreset = {
  key: IndustryKey;
  label: string;
  // How the script refers to the business and its customers.
  noun: string;
  customer: string;
  booking: string;
  services: string[];
  weekend: "closed" | "sat-morning" | "sat-full";
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

export function defaultHours(key: IndustryKey): Hours {
  const weekday: DayHours = { open: true, from: "08:00", to: "17:00" };
  const preset = industry(key).weekend;
  const sat: DayHours =
    preset === "sat-full"
      ? { open: true, from: "09:00", to: "16:00" }
      : preset === "sat-morning"
        ? { open: true, from: "09:00", to: "12:00" }
        : { open: false, from: "09:00", to: "12:00" };
  return {
    mon: { ...weekday },
    tue: { ...weekday },
    wed: { ...weekday },
    thu: { ...weekday },
    fri: { ...weekday },
    sat,
    sun: { open: false, from: "09:00", to: "12:00" },
  };
}

export function defaultGreeting(businessName: string, receptionistName: string): string {
  const biz = businessName.trim() || "our office";
  const who = receptionistName.trim();
  const intro = who ? `I'm ${who}, the AI assistant here` : "I'm the AI assistant here";
  return `Hi, you've reached ${biz}. ${intro}, and this call is recorded. How can I help?`;
}

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
    lines.push(a.open ? `${range}: ${sayTime(a.from)} to ${sayTime(a.to)}` : `${range}: closed`);
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

export type OrgRole = "owner" | "admin" | "member";

export type Account = {
  user: { id: string; email: string; name: string; platformAdmin: boolean };
  org: { id: string; name: string } | null;
  role: OrgRole | null;
  orgs: { id: string; name: string; role: OrgRole }[];
  // Whose Telnyx account this team's receptionists run on: its own key, the
  // platform's (if the platform allowed it), or none yet (it must add one).
  telnyx: "own" | "platform" | "none";
};

export type TelnyxSettings = {
  mode: "own" | "platform" | "none";
  last4: string;
  balance: { amount: number; currency: string } | null;
};

export type Agency = {
  id: string;
  name: string;
  createdAt: string;
  members: number;
  clients: number;
  owners: string[];
  pendingInvites: string[];
  telnyx: "own" | "platform" | "none";
  platformTelnyx: boolean;
  suspended: boolean;
};

export type Session =
  | ({ signedIn: true } & Account)
  | { signedIn: false; signupOpen: boolean; firstRun: boolean };

export type TeamState = {
  members: { id: string; email: string; name: string; role: OrgRole; joinedAt: string }[];
  invites: { id: string; email: string; role: OrgRole; expiresAt: string }[];
  // Whether invites are emailed, or have to be sent by hand.
  emailsSent: boolean;
};

export type InviteInfo = { orgName: string; email: string; role: OrgRole; hasAccount: boolean };
