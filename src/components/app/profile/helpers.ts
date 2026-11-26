import { alwaysOpen, defaultGreeting, defaultHours, type DayHours, type Hours, type IndustryKey, type Settings } from "@/lib/shared";
import {
  BOOKING_MODES,
  BOOKING_NOTICE,
  CALLER_FIELDS,
  EMERGENCIES,
  NEW_CUSTOMERS,
  PRICE_ANSWERS,
  TONES,
  type NicheTemplate,
  type ReceptionProfile,
} from "@/lib/profile";

// Settings with the detailed profile. Once `profile` is on Settings in shared.ts this is
// the same type; until then it lets the wizard and Settings carry it.
export type WithProfile = Settings & { profile?: ReceptionProfile };

export const profileOf = (s: { profile?: ReceptionProfile } | null | undefined): ReceptionProfile => (s?.profile ? { ...s.profile } : {});

const day = (from: string, to: string): DayHours => ({ open: true, from, to });
const closed = (): DayHours => ({ open: false, from: "09:00", to: "12:00" });

/** The hours a template asks for: office hours, long days, open weekends, or 24/7. */
export function hoursFor(kind: NonNullable<NicheTemplate["hours"]>): Hours {
  if (kind === "always") return alwaysOpen();
  if (kind === "extended") {
    const w = day("07:30", "18:30");
    return { mon: { ...w }, tue: { ...w }, wed: { ...w }, thu: { ...w }, fri: { ...w }, sat: day("08:00", "14:00"), sun: closed() };
  }
  if (kind === "weekends") {
    const w = day("09:00", "17:00");
    return { mon: { ...w }, tue: { ...w }, wed: { ...w }, thu: { ...w }, fri: { ...w }, sat: day("09:00", "16:00"), sun: day("10:00", "16:00") };
  }
  const w = day("08:30", "17:00");
  return { mon: { ...w }, tue: { ...w }, wed: { ...w }, thu: { ...w }, fri: { ...w }, sat: closed(), sun: closed() };
}

/** Fills {business} and {name} in a template greeting; tidies it up when there is no name yet. */
export function fillGreeting(tpl: string, businessName: string, receptionistName: string): string {
  const biz = businessName.trim() || "our office";
  const who = receptionistName.trim();
  let out = tpl.replace(/\{business\}/gi, biz);
  if (who) out = out.replace(/\{name\}/gi, who);
  // No name yet: "I'm {name}, the AI receptionist" becomes "I'm the AI receptionist".
  else out = out.replace(/(i'm|i am|this is|my name is)\s+\{name\}\s*,?\s*(?=(?:the|an?)\s)/gi, "$1 ").replace(/\{name\}/gi, "");
  return out.replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim() || defaultGreeting(businessName, receptionistName);
}

const toSettingsTone = (t: ReceptionProfile["tone"]): Settings["tone"] => (t === "professional" || t === "calm" ? "professional" : "friendly");
export const settingsToneFor = toSettingsTone;

/** Everything a template sets on the wizard's settings (the greeting is filled separately). */
export function templatePatch(t: NicheTemplate): Partial<WithProfile> {
  const profile: ReceptionProfile = JSON.parse(JSON.stringify({ ...t.profile, template: t.id })) as ReceptionProfile;
  return {
    industry: t.industry as IndustryKey,
    industryLabel: t.industry === "other" ? t.label : "",
    about: t.about,
    services: [...t.services],
    hours: t.hours ? hoursFor(t.hours) : defaultHours(t.industry),
    ...(profile.tone ? { tone: toSettingsTone(profile.tone) } : {}),
    profile,
  };
}

/* ---------------- "x of y set" ---------------- */

export type SectionId = "handling" | "services" | "collect" | "urgent" | "policies" | "faqs" | "rules";

const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null);

export function sectionProgress(p: ReceptionProfile): Record<SectionId, { set: number; total: number }> {
  const count = (vals: unknown[]) => ({ set: vals.filter(filled).length, total: vals.length });
  return {
    handling: count([p.tone, p.bookingMode, p.appointmentMinutes, p.bufferMinutes, p.bookingNotice, p.bookingWindowDays]),
    services: count([p.serviceDetails, p.priceAnswers]),
    collect: count([p.callerFields, p.newCustomers]),
    urgent: count([p.emergencies, p.emergencyNote]),
    policies: count([p.cancellationPolicy, p.paymentMethods, p.parking, p.accessibility, p.serviceArea, p.languages]),
    faqs: count([p.faqs]),
    rules: count([p.alwaysDo, p.neverDo]),
  };
}

export function totalProgress(p: ReceptionProfile, showFaqs = true) {
  const s = sectionProgress(p);
  const ids = (Object.keys(s) as SectionId[]).filter((k) => showFaqs || k !== "faqs");
  return { set: ids.reduce((n, k) => n + s[k].set, 0), total: ids.reduce((n, k) => n + s[k].total, 0) };
}

/* ---------------- Plain-language summary (Review step) ---------------- */

const label = <V extends string>(list: { value: V; label: string }[], v: V | undefined) => list.find((o) => o.value === v)?.label;
const minutes = (n: number) => (n >= 60 && n % 60 === 0 ? `${n / 60} hour${n === 60 ? "" : "s"}` : `${n} min`);

export function summarizeProfile(p: ReceptionProfile): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const add = (l: string, v: string | undefined | false) => v && rows.push({ label: l, value: v });
  add("Tone", label(TONES, p.tone));
  add("Bookings", label(BOOKING_MODES, p.bookingMode));
  const timing = [
    p.appointmentMinutes ? `${minutes(p.appointmentMinutes)} appointments` : "",
    p.bufferMinutes ? `${p.bufferMinutes} min gap between` : "",
    p.bookingNotice && p.bookingNotice !== "none" ? label(BOOKING_NOTICE, p.bookingNotice)?.toLowerCase() ?? "" : "",
    p.bookingWindowDays ? `up to ${p.bookingWindowDays} days ahead` : "",
  ].filter(Boolean);
  add("Booking rules", timing.join(" · "));
  const sd = (p.serviceDetails ?? []).filter((s) => s.name.trim());
  add("Services", sd.length ? sd.map((s) => [s.name, s.minutes ? minutes(s.minutes) : "", s.price].filter(Boolean).join(" ")).join(", ") : undefined);
  add("Price questions", label(PRICE_ANSWERS, p.priceAnswers));
  const fields = (p.callerFields ?? []).map((f) => label(CALLER_FIELDS, f) ?? f);
  add("Asks every caller for", fields.length ? fields.join(", ") : undefined);
  add("New customers", label(NEW_CUSTOMERS, p.newCustomers));
  add("Emergencies", [label(EMERGENCIES, p.emergencies), p.emergencyNote?.trim()].filter(Boolean).join(". "));
  add("Cancellations", p.cancellationPolicy?.trim());
  add("Payment", p.paymentMethods?.length ? p.paymentMethods.join(", ") : undefined);
  add("Parking", p.parking?.trim());
  add("Accessibility", p.accessibility?.trim());
  add("Service area", p.serviceArea?.trim());
  add("Languages", p.languages?.length ? p.languages.join(", ") : undefined);
  add("Always", p.alwaysDo?.length ? p.alwaysDo.join("; ") : undefined);
  add("Never", p.neverDo?.length ? p.neverDo.join("; ") : undefined);
  return rows;
}

/** The profile as it is sent: blank rows dropped, every list trimmed. */
export function cleanProfile(p: ReceptionProfile): ReceptionProfile {
  const out: ReceptionProfile = { ...p };
  const strs = (a?: string[]) => (a ?? []).map((x) => x.trim()).filter(Boolean);
  if (out.serviceDetails) out.serviceDetails = out.serviceDetails.filter((s) => s.name.trim()).map((s) => ({ ...s, name: s.name.trim() }));
  if (out.faqs) out.faqs = out.faqs.filter((f) => f.q.trim() && f.a.trim()).map((f) => ({ q: f.q.trim(), a: f.a.trim() }));
  if (out.alwaysDo) out.alwaysDo = strs(out.alwaysDo);
  if (out.neverDo) out.neverDo = strs(out.neverDo);
  for (const k of ["cancellationPolicy", "parking", "accessibility", "serviceArea", "emergencyNote"] as const) {
    const v = out[k]?.trim();
    if (v) out[k] = v;
    else delete out[k];
  }
  return out;
}
