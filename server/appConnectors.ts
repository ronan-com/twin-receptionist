import type { Business, BookingRequest } from "../src/lib/shared";
import { localToEpoch } from "./booking";
import { seal, unseal } from "./secrets";
import { getSetting, putSetting } from "./store";

// Direct connectors for the business's own apps: ServiceM8, Cliniko, Xero (Tradify has no
// public API). Each saved key can do three things, all opt-in per business (the "Send to ..."
// switch on its card, off until the business turns it on):
//   - find a contact by phone/email, or create one
//   - create a job (ServiceM8) or appointment (Cliniko) for a booking, with the call's notes
//   - add the call summary as a note once it is ready
// A failure here is only logged and shown on the card ("last sync"); it never touches the booking.
//
// Vendor docs this was written from (the exact shapes are checked in server/appConnectors.test.ts
// against mocked HTTP; none has been called with a real account):
//   ServiceM8  https://developer.servicem8.com/reference/createjobs      POST /api_1.0/job.json (status required; X-Api-Key)
//              https://developer.servicem8.com/reference/createnotes     POST /api_1.0/note.json (related_object, related_object_uuid, note)
//              https://developer.servicem8.com/reference/createcompanycontacts  POST /api_1.0/companycontact.json
//              https://developer.servicem8.com/reference/createjobactivities    POST /api_1.0/jobactivity.json (job_uuid, staff_uuid, start_date, end_date)
//              https://developer.servicem8.com/docs/filtering            $filter=field eq 'value'
//   Cliniko    https://docs.api.cliniko.com/                             au1/au2... shard, Basic auth, User-Agent with an email
//              https://docs.api.cliniko.com/openapi/patient              POST /patients, GET /patients?q[]=email:=...
//              https://docs.api.cliniko.com/openapi/individual-appointment  POST /individual_appointments
//              https://docs.api.cliniko.com/openapi/business | practitioner | appointment-type   the lists the card picks from
//   Xero       https://developer.xero.com/documentation/api/accounting/contacts   POST /Contacts, ?searchTerm=, PUT /Contacts/{id}/History
//              https://developer.xero.com/documentation/guides/oauth2/custom-connections  client_credentials token, /connections
//   Tradify    publishes no public API (checked: no developer portal, keys or docs). Use Pipedream, MCP or the webhook.

export type AppProvider = "servicem8" | "cliniko" | "tradify" | "xero";
export const SYNCABLE: AppProvider[] = ["servicem8", "cliniko", "xero"];

export type SyncState = { at: string; ok: boolean; error: string | null; what: string };
export type AppEntry = {
  key: string; // sealed (v1.) when MAILBOX_KEY is set
  savedAt: string;
  /** "Send bookings to ..." switch. Off until the business turns it on. */
  enabled?: boolean;
  /** Cliniko: practitionerId, appointmentTypeId, businessId. ServiceM8: staffUuid (optional, schedules the job). */
  config?: Record<string, string>;
  last?: SyncState;
};
export type Stored = Partial<Record<AppProvider, AppEntry>> & { links?: Record<string, { contact: string; record?: string }> };
export const appsKey = (clientId: string) => `apps:${clientId}`;

export const packKey = (key: string): string => {
  try {
    return seal(key);
  } catch {
    return key; // no MAILBOX_KEY on this install: kept as before
  }
};
export const openKey = (stored: string): string => (stored.startsWith("v1.") ? unseal(stored) : stored);

export type Doer = (url: string, init?: RequestInit) => Promise<Response>;
const realFetch: Doer = (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(10_000), redirect: "manual" });

export type Person = { name: string; phone: string; email?: string };
export type BookingPush = {
  kind: "booking" | "callback";
  person: Person;
  service: string;
  /** Local time "YYYY-MM-DDTHH:mm(:ss)" for a booking. */
  start: string;
  minutes: number;
  timezone: string;
  note: string;
  business: string;
};
export type SummaryPush = { phone: string; summary: string; outcome: string | null; at: string };
type Linked = { contact: string; record?: string };

export class AppError extends Error {}

const digits = (p: string) => p.replace(/\D/g, "");
/** An Australian number in the forms apps store it: +61412345678 and 0412345678. */
export function phoneVariants(p: string): string[] {
  const d = digits(p);
  if (!d) return [];
  const local = d.startsWith("61") ? `0${d.slice(2)}` : d.startsWith("0") ? d : d;
  const intl = local.startsWith("0") ? `+61${local.slice(1)}` : `+${d}`;
  return [...new Set([local, intl, d])];
}
const samePhone = (a: string, b: string) => {
  const x = phoneVariants(a)[0];
  return Boolean(x) && x === phoneVariants(b)[0];
};
const splitName = (n: string) => {
  const parts = n.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "Caller", last: parts.slice(1).join(" ") };
};
const sqlStr = (v: string) => v.replace(/'/g, "");
const sm8Time = (ms: number, tz: string) => {
  // ServiceM8 shows times as "YYYY-MM-DD HH:MM:SS"; sent in the business's own local time.
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short", timeStyle: "medium" }).format(new Date(ms));
  return f.replace("T", " ");
};
const startMs = (p: BookingPush) => localToEpoch(p.start.slice(0, 10), p.start.slice(11, 16), p.timezone);
const jobText = (p: BookingPush) =>
  [`${p.kind === "booking" ? "Booked" : "Call back"} by the AI receptionist (${p.business}).`, p.service && `For: ${p.service}`, p.start && `When: ${p.start.replace("T", " ").slice(0, 16)}`, p.note && `Notes: ${p.note}`, `Phone: ${p.person.phone}`].filter(Boolean).join("\n");
const summaryText = (s: SummaryPush) => `Call summary (${s.at.slice(0, 16).replace("T", " ")})${s.outcome ? `, outcome: ${s.outcome}` : ""}\n${s.summary}`;

async function jsonOf(r: Response): Promise<any> {
  return r.json().catch(() => null);
}
function must(r: Response, what: string): Response {
  if (!r.ok) throw new AppError(`${what} failed (${r.status})`);
  return r;
}

/* ------------------------------- ServiceM8 ------------------------------- */

const SM8 = "https://api.servicem8.com/api_1.0";
export function servicem8(key: string, config: Record<string, string>, f: Doer) {
  const h = { "X-Api-Key": key, Accept: "application/json", "Content-Type": "application/json" };
  const get = async (path: string) => must(await f(`${SM8}/${path}`, { headers: h }), `ServiceM8 ${path.split("?")[0]}`);
  const post = async (path: string, body: unknown) => {
    const r = must(await f(`${SM8}/${path}`, { method: "POST", headers: h, body: JSON.stringify(body) }), `ServiceM8 ${path}`);
    return r.headers.get("x-record-uuid") ?? "";
  };
  const filter = (field: string, value: string) => `$filter=${encodeURIComponent(`${field} eq '${sqlStr(value)}'`)}`;
  return {
    async findContact(p: { phone?: string; email?: string }): Promise<string | null> {
      const tries: [string, string][] = [...(p.phone ? phoneVariants(p.phone).flatMap((v): [string, string][] => [["mobile", v], ["phone", v]]) : []), ...(p.email ? [["email", p.email] as [string, string]] : [])];
      for (const [field, value] of tries) {
        const rows = await jsonOf(await get(`companycontact.json?${filter(field, value)}`));
        const hit = Array.isArray(rows) ? rows.find((c) => c?.company_uuid) : null;
        if (hit) return String(hit.company_uuid);
      }
      return null;
    },
    async createContact(p: Person): Promise<string> {
      const company = await post("company.json", { name: p.name || p.phone, is_individual: "1" });
      if (!company) throw new AppError("ServiceM8 gave no company id");
      const n = splitName(p.name);
      await post("companycontact.json", { company_uuid: company, first: n.first, last: n.last, mobile: p.phone, ...(p.email ? { email: p.email } : {}), type: "JOB", is_primary_contact: "1" });
      return company;
    },
    /** A booking becomes a Work Order, a callback a Quote (a lead to follow up). The notes go on the job. */
    async createBooking(company: string, p: BookingPush): Promise<string> {
      const isBooking = p.kind === "booking" && p.start;
      const when = isBooking ? sm8Time(startMs(p), p.timezone) : "";
      const job = await post("job.json", { status: isBooking ? "Work Order" : "Quote", company_uuid: company, job_description: jobText(p), ...(when ? { work_order_date: when } : {}) });
      if (!job) throw new AppError("ServiceM8 gave no job id");
      await post("note.json", { related_object: "job", related_object_uuid: job, note: jobText(p) });
      if (isBooking && config.staffUuid) {
        await post("jobactivity.json", { job_uuid: job, staff_uuid: config.staffUuid, start_date: when, end_date: sm8Time(startMs(p) + p.minutes * 60_000, p.timezone) });
      }
      return job;
    },
    async addSummary(link: Linked, s: SummaryPush) {
      await post("note.json", { related_object: link.record ? "job" : "company", related_object_uuid: link.record ?? link.contact, note: summaryText(s) });
    },
    /** For the card: who a job can be scheduled with. */
    async options() {
      const rows = (await jsonOf(await get("staff.json"))) ?? [];
      return { staff: (Array.isArray(rows) ? rows : []).filter((s) => s?.uuid && s.active !== 0 && s.active !== "0").map((s) => ({ id: String(s.uuid), name: `${s.first ?? ""} ${s.last ?? ""}`.trim() || String(s.uuid) })) };
    },
  };
}

/* -------------------------------- Cliniko -------------------------------- */

const vendor = () => `AI Receptionist (${(process.env.MAIL_FROM ?? "").match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? "support@example.com"})`;
export const clinikoShard = (key: string) => key.match(/-([a-z]{2}\d)$/)?.[1] ?? null;
export function cliniko(key: string, config: Record<string, string>, f: Doer) {
  const shard = clinikoShard(key);
  if (!shard) throw new AppError("The Cliniko key should end in its region, like -au2.");
  const base = `https://api.${shard}.cliniko.com/v1`;
  const h = { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "User-Agent": vendor(), Accept: "application/json", "Content-Type": "application/json" };
  const get = async (path: string) => jsonOf(must(await f(`${base}/${path}`, { headers: h }), `Cliniko ${path.split("?")[0]}`));
  const send = async (method: string, path: string, body: unknown) => jsonOf(must(await f(`${base}/${path}`, { method, headers: h, body: JSON.stringify(body) }), `Cliniko ${path}`));
  const q = (...filters: string[]) => filters.map((x) => `q[]=${encodeURIComponent(x)}`).join("&");
  const phonesOf = (pt: any): string[] => (Array.isArray(pt?.patient_phone_numbers) ? pt.patient_phone_numbers.map((n: any) => String(n?.number ?? "")) : []);
  return {
    /** Cliniko can't filter patients by phone, so: by email, else by exact name then a phone check (a name alone never matches). */
    async findContact(p: Partial<Person>): Promise<string | null> {
      if (p.email) {
        const r = await get(`patients?${q(`email:=${p.email}`)}`);
        if (r?.patients?.[0]?.id) return String(r.patients[0].id);
      }
      if (p.name && p.phone) {
        const n = splitName(p.name);
        const r = await get(`patients?${q(`first_name:=${n.first}`, ...(n.last ? [`last_name:=${n.last}`] : []))}`);
        const hit = (r?.patients ?? []).find((pt: any) => phonesOf(pt).some((x) => samePhone(x, p.phone!)));
        if (hit?.id) return String(hit.id);
      }
      return null;
    },
    async createContact(p: Person, note = ""): Promise<string> {
      const n = splitName(p.name);
      const r = await send("POST", "patients", {
        first_name: n.first,
        last_name: n.last || "Unknown",
        ...(p.email ? { email: p.email } : {}),
        patient_phone_numbers: [{ number: p.phone, phone_type: "Mobile" }],
        receives_confirmation_emails: false,
        ...(note ? { notes: note } : {}),
      });
      if (!r?.id) throw new AppError("Cliniko gave no patient id");
      return String(r.id);
    },
    async createBooking(patient: string, p: BookingPush): Promise<string | undefined> {
      if (p.kind !== "booking" || !p.start) return undefined; // a callback is only a patient with a note
      const { practitionerId, appointmentTypeId, businessId } = config;
      if (!practitionerId || !appointmentTypeId || !businessId) throw new AppError("Choose a practitioner, appointment type and location on the Cliniko card first.");
      const at = startMs(p);
      const r = await send("POST", "individual_appointments", {
        patient_id: patient,
        practitioner_id: practitionerId,
        appointment_type_id: appointmentTypeId,
        business_id: businessId,
        starts_at: new Date(at).toISOString().slice(0, 19) + "Z",
        ends_at: new Date(at + p.minutes * 60_000).toISOString().slice(0, 19) + "Z",
        notes: jobText(p),
      });
      return r?.id ? String(r.id) : undefined;
    },
    async addSummary(link: Linked, s: SummaryPush) {
      const cur = await get(`patients/${link.contact}`);
      const notes = [String(cur?.notes ?? "").trim(), summaryText(s)].filter(Boolean).join("\n\n");
      await send("PATCH", `patients/${link.contact}`, { notes });
    },
    async options() {
      const [b, p, t] = await Promise.all([get("businesses?per_page=100"), get("practitioners?per_page=100"), get("appointment_types?per_page=100")]);
      return {
        businesses: (b?.businesses ?? []).map((x: any) => ({ id: String(x.id), name: x.display_name || x.business_name || String(x.id) })),
        practitioners: (p?.practitioners ?? []).filter((x: any) => x.active !== false).map((x: any) => ({ id: String(x.id), name: x.label || `${x.first_name ?? ""} ${x.last_name ?? ""}`.trim() || String(x.id) })),
        appointmentTypes: (t?.appointment_types ?? []).map((x: any) => ({ id: String(x.id), name: x.name || String(x.id) })),
      };
    },
  };
}

/* ---------------------------------- Xero --------------------------------- */

const XERO = "https://api.xero.com";
const tokens = new Map<string, { token: string; tenant: string; until: number }>();
/** The key is either "clientId:clientSecret" of a Xero custom connection (exchanged for a 30 minute token) or an access token. */
export async function xeroAuth(key: string, f: Doer): Promise<{ token: string; tenant: string }> {
  const hit = tokens.get(key);
  if (hit && hit.until > Date.now()) return hit;
  let token = key;
  if (/^[^:\s]{8,}:[^\s]{8,}$/.test(key)) {
    const r = must(
      await f("https://identity.xero.com/connect/token", {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(key).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials&scope=accounting.contacts",
      }),
      "Xero sign-in",
    );
    token = String((await jsonOf(r))?.access_token ?? "");
    if (!token) throw new AppError("Xero gave no access token");
  }
  const conns = await jsonOf(must(await f(`${XERO}/connections`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }), "Xero connections"));
  const tenant = String(conns?.[0]?.tenantId ?? "");
  if (!tenant) throw new AppError("Xero has no organisation connected to that key.");
  const out = { token, tenant, until: Date.now() + 25 * 60_000 };
  tokens.set(key, out);
  return out;
}
export function xero(key: string, _config: Record<string, string>, f: Doer) {
  const call = async (method: string, path: string, body?: unknown) => {
    const a = await xeroAuth(key, f);
    const r = must(await f(`${XERO}/api.xro/2.0/${path}`, { method, headers: { Authorization: `Bearer ${a.token}`, "Xero-tenant-id": a.tenant, Accept: "application/json", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), `Xero ${path.split("?")[0]}`);
    return jsonOf(r);
  };
  return {
    /** Xero's searchTerm covers name, email and account number (not phone), so: by email, else by exact name. */
    async findContact(p: Partial<Person>): Promise<string | null> {
      for (const term of [p.email, p.name].filter(Boolean) as string[]) {
        const r = await call("GET", `Contacts?searchTerm=${encodeURIComponent(term)}`);
        const hit = (r?.Contacts ?? []).find((c: any) => (p.email && String(c.EmailAddress ?? "").toLowerCase() === p.email.toLowerCase()) || (p.name && String(c.Name ?? "").toLowerCase() === p.name.toLowerCase()));
        if (hit?.ContactID) return String(hit.ContactID);
      }
      return null;
    },
    async createContact(p: Person): Promise<string> {
      const n = splitName(p.name);
      const r = await call("POST", "Contacts", { Contacts: [{ Name: p.name || p.phone, FirstName: n.first, ...(n.last ? { LastName: n.last } : {}), ...(p.email ? { EmailAddress: p.email } : {}), Phones: [{ PhoneType: "MOBILE", PhoneNumber: p.phone }] }] });
      const id = r?.Contacts?.[0]?.ContactID;
      if (!id) throw new AppError("Xero gave no contact id");
      return String(id);
    },
    /** Accounting, not scheduling: a booking is a note on the contact's history. */
    async createBooking(contact: string, p: BookingPush): Promise<undefined> {
      await call("PUT", `Contacts/${contact}/History`, { HistoryRecords: [{ Details: jobText(p).slice(0, 2500) }] });
      return undefined;
    },
    async addSummary(link: Linked, s: SummaryPush) {
      await call("PUT", `Contacts/${link.contact}/History`, { HistoryRecords: [{ Details: summaryText(s).slice(0, 2500) }] });
    },
    async options() {
      return {};
    },
  };
}

export function connector(provider: AppProvider, key: string, config: Record<string, string>, f: Doer) {
  if (provider === "servicem8") return servicem8(key, config, f);
  if (provider === "cliniko") return cliniko(key, config, f);
  if (provider === "xero") return xero(key, config, f);
  throw new AppError("Tradify has no public API, so nothing can be sent to it. Use Pipedream, MCP or the webhook.");
}

/* ----------------------------- the opt-in flow ---------------------------- */

const NAMES: Record<AppProvider, string> = { servicem8: "ServiceM8", cliniko: "Cliniko", tradify: "Tradify", xero: "Xero" };
const linkKey = (provider: string, phone: string) => `${provider}:${digits(phoneVariants(phone)[0] ?? phone)}`;

async function record(clientId: string, provider: AppProvider, last: SyncState, links?: Record<string, Linked>) {
  // Re-read just before writing so a key saved meanwhile isn't lost.
  const cur = ((await getSetting<Stored>(appsKey(clientId))) ?? {}) as Stored;
  if (!cur[provider]) return;
  const merged = { ...(cur.links ?? {}), ...(links ?? {}) };
  const keep = Object.fromEntries(Object.entries(merged).slice(-300));
  await putSetting(appsKey(clientId), { ...cur, [provider]: { ...cur[provider], last }, links: keep });
}

/** Which of the business's apps are switched on, with their opened keys. */
async function active(clientId: string): Promise<{ stored: Stored; list: { provider: AppProvider; key: string; config: Record<string, string> }[] }> {
  const stored = ((await getSetting<Stored>(appsKey(clientId))) ?? {}) as Stored;
  const list: { provider: AppProvider; key: string; config: Record<string, string> }[] = [];
  for (const p of SYNCABLE) {
    const e = stored[p];
    if (!e?.key || !e.enabled) continue;
    try {
      list.push({ provider: p, key: openKey(e.key), config: e.config ?? {} });
    } catch {
      await record(clientId, p, { at: new Date().toISOString(), ok: false, error: "The saved key can't be read. Paste it again.", what: "key" }).catch(() => {});
    }
  }
  return { stored, list };
}

/**
 * After a booking or callback is taken: find or create the contact in each switched-on app, then
 * create the job or appointment. Never throws; each app's result is shown on its card.
 */
export async function syncBooking(client: Business, r: BookingRequest, f: Doer = realFetch): Promise<void> {
  if (r.status !== "booked" && r.status !== "saved") return; // pending, declined and failed bookings aren't sent
  let on;
  try {
    on = await active(client.id);
  } catch (err) {
    console.error(`[apps ${client.id}]`, (err as Error).message);
    return;
  }
  const person: Person = { name: r.name, phone: r.phone, ...(r.email ? { email: r.email } : {}) };
  const push: BookingPush = { kind: r.kind, person, service: r.service, start: r.kind === "booking" ? r.start : "", minutes: client.booking?.minutes ?? 30, timezone: client.settings.timezone, note: r.note, business: client.settings.businessName };
  await Promise.all(
    on.list.map(async ({ provider, key, config }) => {
      const what = r.kind === "booking" ? "booking" : "callback";
      try {
        const c: any = connector(provider, key, config, f);
        let contact = await c.findContact(person);
        if (!contact) contact = await c.createContact(person, r.kind === "callback" ? jobText(push) : "");
        const record_ = await c.createBooking(contact, push);
        await record(client.id, provider, { at: new Date().toISOString(), ok: true, error: null, what }, { [linkKey(provider, r.phone)]: { contact, ...(record_ ? { record: record_ } : {}) } });
      } catch (err) {
        const message = err instanceof AppError ? err.message : `Couldn't reach ${NAMES[provider]}.`;
        console.error(`[apps ${client.id}] ${provider} ${what}:`, (err as Error).message);
        await record(client.id, provider, { at: new Date().toISOString(), ok: false, error: message, what }).catch(() => {});
      }
    }),
  );
}

/** After a call summary is ready: add it to the contact this caller already has in each switched-on app. */
export async function syncSummary(client: Business, s: SummaryPush, f: Doer = realFetch): Promise<void> {
  if (!s.phone || !s.summary) return;
  let on;
  try {
    on = await active(client.id);
  } catch {
    return;
  }
  await Promise.all(
    on.list.map(async ({ provider, key, config }) => {
      try {
        const c: any = connector(provider, key, config, f);
        let link: Linked | null = on.stored.links?.[linkKey(provider, s.phone)] ?? null;
        if (!link) {
          const found = await c.findContact({ phone: s.phone });
          if (found) link = { contact: found };
        }
        if (!link) return; // a caller this app doesn't know: nothing to attach to
        await c.addSummary(link, s);
        await record(client.id, provider, { at: new Date().toISOString(), ok: true, error: null, what: "call summary" });
      } catch (err) {
        const message = err instanceof AppError ? err.message : `Couldn't reach ${NAMES[provider]}.`;
        console.error(`[apps ${client.id}] ${provider} summary:`, (err as Error).message);
        await record(client.id, provider, { at: new Date().toISOString(), ok: false, error: message, what: "call summary" }).catch(() => {});
      }
    }),
  );
}
