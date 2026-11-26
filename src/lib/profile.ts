// Detailed receptionist setup ("profile") and the niche templates that prefill it.
// Shared by the new-receptionist wizard, Settings, and the server's instruction builder.
// Every field is optional: an empty profile changes nothing.

import type { IndustryKey } from "./shared";

export type Option<V extends string = string> = { value: V; label: string };

export type Tone = "warm" | "professional" | "upbeat" | "calm" | "casual";
export type PriceAnswers = "quote" | "from_price" | "range" | "no_quote";
export type BookingNotice = "none" | "1h" | "2h" | "same_day" | "24h" | "48h";
export type NewCustomers = "welcome" | "waitlist" | "existing_only";
export type Emergencies = "transfer" | "advise_000" | "take_urgent_message" | "not_applicable";
export type BookingMode = "book" | "request" | "message_only";
export type CallerField =
  | "name" | "phone" | "email" | "address" | "suburb" | "reason" | "preferred_time"
  | "new_or_existing" | "dob" | "health_fund" | "medicare" | "vehicle" | "rego" | "pet_name"
  | "pet_type" | "child_name" | "child_age" | "start_date" | "budget" | "property_address"
  | "job_photos" | "company" | "party_size" | "dietary" | "referral_source";

export type ServiceDetail = { name: string; minutes?: number; price?: string; notes?: string };
export type Faq = { q: string; a: string };

export type ReceptionProfile = {
  template?: string;              // id of the template it started from
  tone?: Tone;
  bookingMode?: BookingMode;
  appointmentMinutes?: number;    // default length when a service has none
  bufferMinutes?: number;         // gap between bookings
  bookingNotice?: BookingNotice;  // shortest notice for a new booking
  bookingWindowDays?: number;     // how far ahead callers can book
  serviceDetails?: ServiceDetail[];
  priceAnswers?: PriceAnswers;
  callerFields?: CallerField[];   // what to collect on every call
  newCustomers?: NewCustomers;
  emergencies?: Emergencies;
  emergencyNote?: string;         // what counts as urgent here
  cancellationPolicy?: string;
  paymentMethods?: string[];
  parking?: string;
  accessibility?: string;
  languages?: string[];
  serviceArea?: string;           // suburbs / radius for mobile businesses
  faqs?: Faq[];                   // become published knowledge items on create
  alwaysDo?: string[];
  neverDo?: string[];
};

export type NicheTemplate = {
  id: string;                     // e.g. "dental-general"
  label: string;                  // "Dental clinic"
  group: string;                  // "Health", "Trades", "Beauty", "Hospitality", "Professional", "Property", "Auto", "Pets", "Education", "Fitness", "Retail", "Other"
  industry: IndustryKey;          // nearest existing business type
  about: string;                  // "What does the business do?" prefill
  services: string[];             // "What can callers ask it for?" chips
  greeting: string;               // uses {business} and {name}
  hours?: "weekdays" | "extended" | "weekends" | "always";
  profile: ReceptionProfile;
};

export const TONES: Option<Tone>[] = [
  { value: "warm", label: "Warm and friendly" },
  { value: "professional", label: "Professional" },
  { value: "upbeat", label: "Upbeat" },
  { value: "calm", label: "Calm and reassuring" },
  { value: "casual", label: "Relaxed and casual" },
];
export const BOOKING_MODES: Option<BookingMode>[] = [
  { value: "book", label: "Book straight into the calendar" },
  { value: "request", label: "Take a booking request for staff to confirm" },
  { value: "message_only", label: "No bookings, just take messages" },
];
export const APPOINTMENT_LENGTHS = [10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
export const BUFFERS = [0, 5, 10, 15, 30];
export const BOOKING_NOTICE: Option<BookingNotice>[] = [
  { value: "none", label: "Any time, even straight away" },
  { value: "1h", label: "At least 1 hour ahead" },
  { value: "2h", label: "At least 2 hours ahead" },
  { value: "same_day", label: "Same day is fine, not within the hour" },
  { value: "24h", label: "At least 24 hours ahead" },
  { value: "48h", label: "At least 2 days ahead" },
];
export const BOOKING_WINDOWS = [7, 14, 30, 60, 90, 180];
export const PRICE_ANSWERS: Option<PriceAnswers>[] = [
  { value: "quote", label: "Give exact prices" },
  { value: "from_price", label: "Give 'from' prices" },
  { value: "range", label: "Give a rough range" },
  { value: "no_quote", label: "Don't discuss prices, offer a call back" },
];
export const NEW_CUSTOMERS: Option<NewCustomers>[] = [
  { value: "welcome", label: "Taking new customers" },
  { value: "waitlist", label: "Waitlist only" },
  { value: "existing_only", label: "Existing customers only" },
];
export const EMERGENCIES: Option<Emergencies>[] = [
  { value: "transfer", label: "Put them straight through to staff" },
  { value: "advise_000", label: "Tell them to call 000, then take a message" },
  { value: "take_urgent_message", label: "Take an urgent message for staff" },
  { value: "not_applicable", label: "Not relevant for this business" },
];
export const CALLER_FIELDS: Option<CallerField>[] = [
  { value: "name", label: "Name" }, { value: "phone", label: "Phone" }, { value: "email", label: "Email" },
  { value: "reason", label: "Reason for calling" }, { value: "preferred_time", label: "Preferred time" },
  { value: "new_or_existing", label: "New or existing customer" }, { value: "address", label: "Street address" },
  { value: "suburb", label: "Suburb" }, { value: "dob", label: "Date of birth" },
  { value: "health_fund", label: "Health fund" }, { value: "medicare", label: "Medicare card" },
  { value: "vehicle", label: "Vehicle make and model" }, { value: "rego", label: "Rego" },
  { value: "pet_name", label: "Pet's name" }, { value: "pet_type", label: "Type of pet" },
  { value: "child_name", label: "Child's name" }, { value: "child_age", label: "Child's age" },
  { value: "start_date", label: "Start date" }, { value: "budget", label: "Budget" },
  { value: "property_address", label: "Property address" }, { value: "job_photos", label: "Happy to send photos" },
  { value: "company", label: "Company name" }, { value: "party_size", label: "Number of people" },
  { value: "dietary", label: "Dietary needs" }, { value: "referral_source", label: "How they heard about us" },
];
export const PAYMENT_METHODS = [
  "Card", "Cash", "EFTPOS", "Apple Pay / Google Pay", "Bank transfer", "Afterpay", "Zip",
  "HICAPS", "Medicare rebate", "NDIS", "Invoice / account", "CCS (Child Care Subsidy)",
];
export const LANGUAGES = [
  "English", "Mandarin", "Cantonese", "Vietnamese", "Arabic", "Italian", "Greek", "Hindi",
  "Punjabi", "Spanish", "Korean", "Japanese", "Filipino (Tagalog)",
];

export const emptyProfile = (): ReceptionProfile => ({});
