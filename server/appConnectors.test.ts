// Request shapes for ServiceM8, Cliniko and Xero, with HTTP mocked (nothing real is called), plus the
// opt-in flow against the scratch database (switch off = nothing sent, a failing app never throws).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { blankSettings, type BookingRequest, type Business } from "../src/lib/shared";
import { migrate, sql } from "./db";
import { appsKey, cliniko, packKey, phoneVariants, servicem8, syncBooking, syncSummary, xero, type Doer, type Stored } from "./appConnectors";
import { getSetting, putSetting } from "./store";

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
/** A fake vendor: answers by "METHOD path-prefix"; records every call. */
function fake(routes: Record<string, { status?: number; body?: unknown; headers?: Record<string, string> } | (() => never)>) {
  const calls: Call[] = [];
  const f: Doer = async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, headers: (init?.headers ?? {}) as any, body: typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body });
    const hit = Object.keys(routes).find((k) => `${method} ${url}`.includes(k));
    if (!hit) return new Response("{}", { status: 404 });
    const r = routes[hit];
    if (typeof r === "function") r();
    const x = r as { status?: number; body?: unknown; headers?: Record<string, string> };
    return new Response(JSON.stringify(x.body ?? {}), { status: x.status ?? 200, headers: x.headers });
  };
  return { f, calls };
}
const person = { name: "Sam Taylor", phone: "+61412345678", email: "sam@example.com" };
const booking = { kind: "booking" as const, person, service: "Consult", start: "2026-12-01T10:00", minutes: 30, timezone: "Australia/Sydney", note: "Sore knee", business: "Alpha" };

describe("phone forms", () => {
  test("variants", () => expect(phoneVariants("+61 412 345 678")).toEqual(["0412345678", "+61412345678", "61412345678"]));
});

describe("ServiceM8", () => {
  test("find by phone, create client + contact, job + note + schedule", async () => {
    const { f, calls } = fake({
      "GET https://api.servicem8.com/api_1.0/companycontact.json": { body: [] },
      "POST https://api.servicem8.com/api_1.0/company.json": { headers: { "x-record-uuid": "co-1" } },
      "POST https://api.servicem8.com/api_1.0/companycontact.json": {},
      "POST https://api.servicem8.com/api_1.0/job.json": { headers: { "x-record-uuid": "job-1" } },
      "POST https://api.servicem8.com/api_1.0/note.json": {},
      "POST https://api.servicem8.com/api_1.0/jobactivity.json": {},
    });
    const c = servicem8("k-123456789", { staffUuid: "st-1" }, f);
    expect(await c.findContact({ phone: person.phone })).toBeNull();
    expect(calls[0].headers["X-Api-Key"]).toBe("k-123456789");
    expect(decodeURIComponent(calls[0].url)).toContain("$filter=mobile eq '0412345678'");
    const co = await c.createContact(person);
    expect(co).toBe("co-1");
    const cc = calls.find((x) => x.method === "POST" && x.url.endsWith("companycontact.json"))!;
    expect(cc.body).toMatchObject({ company_uuid: "co-1", first: "Sam", last: "Taylor", mobile: person.phone });
    expect(await c.createBooking(co, booking)).toBe("job-1");
    const job = calls.find((x) => x.url.endsWith("job.json"))!;
    expect(job.body).toMatchObject({ status: "Work Order", company_uuid: "co-1", work_order_date: "2026-12-01 10:00:00" });
    expect(job.body.job_description).toContain("Sore knee");
    expect(calls.find((x) => x.url.endsWith("note.json"))!.body).toMatchObject({ related_object: "job", related_object_uuid: "job-1" });
    expect(calls.find((x) => x.url.endsWith("jobactivity.json"))!.body).toMatchObject({ job_uuid: "job-1", staff_uuid: "st-1", end_date: "2026-12-01 10:30:00" });
  });
  test("a callback is a Quote and an API error is reported", async () => {
    const { f, calls } = fake({ "POST https://api.servicem8.com/api_1.0/job.json": { headers: { "x-record-uuid": "j2" } }, "POST https://api.servicem8.com/api_1.0/note.json": {} });
    await servicem8("k-123456789", {}, f).createBooking("co", { ...booking, kind: "callback", start: "" });
    expect(calls[0].body.status).toBe("Quote");
    expect(calls.some((x) => x.url.endsWith("jobactivity.json"))).toBe(false);
    const bad = fake({ "POST": { status: 401 } });
    await expect(servicem8("k-123456789", {}, bad.f).createBooking("co", booking)).rejects.toThrow("401");
  });
});

describe("Cliniko", () => {
  const cfg = { practitionerId: "p1", appointmentTypeId: "t1", businessId: "b1" };
  test("find by email, create patient, appointment in UTC with notes", async () => {
    const { f, calls } = fake({
      "GET https://api.au2.cliniko.com/v1/patients?": { body: { patients: [] } },
      "POST https://api.au2.cliniko.com/v1/patients": { body: { id: 77 } },
      "POST https://api.au2.cliniko.com/v1/individual_appointments": { body: { id: 5 } },
    });
    const c = cliniko("abc123-au2", cfg, f);
    expect(await c.findContact(person)).toBeNull();
    expect(decodeURIComponent(calls[0].url)).toContain("q[]=email:=sam@example.com");
    expect(calls[0].headers["User-Agent"]).toContain("@");
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from("abc123-au2:").toString("base64")}`);
    expect(await c.createContact(person)).toBe("77");
    expect(calls.find((x) => x.method === "POST" && x.url.endsWith("/patients"))!.body).toMatchObject({ first_name: "Sam", last_name: "Taylor", email: "sam@example.com", patient_phone_numbers: [{ number: person.phone }] });
    expect(await c.createBooking("77", booking)).toBe("5");
    const a = calls.find((x) => x.url.endsWith("individual_appointments"))!.body;
    expect(a).toMatchObject({ patient_id: "77", practitioner_id: "p1", appointment_type_id: "t1", business_id: "b1", starts_at: "2026-12-01T23:00:00Z", ends_at: "2026-12-01T23:30:00Z" });
    expect(a.notes).toContain("Sore knee");
  });
  test("a callback makes no appointment; missing choices and a bad key say so", async () => {
    const { f, calls } = fake({});
    expect(await cliniko("abc123-au2", {}, f).createBooking("1", { ...booking, kind: "callback" })).toBeUndefined();
    expect(calls.length).toBe(0);
    await expect(cliniko("abc123-au2", {}, f).createBooking("1", booking)).rejects.toThrow("Choose a practitioner");
    expect(() => cliniko("no-region", {}, f)).toThrow("region");
  });
  test("a name match needs the phone to match too", async () => {
    const pt = (num: string) => ({ patients: [{ id: 9, patient_phone_numbers: [{ number: num }] }] });
    const yes = fake({ "GET": { body: pt("0412 345 678") } });
    expect(await cliniko("abc123-au2", {}, yes.f).findContact({ name: "Sam Taylor", phone: "+61412345678" })).toBe("9");
    const no = fake({ "GET": { body: pt("0499 999 999") } });
    expect(await cliniko("abc123-au2", {}, no.f).findContact({ name: "Sam Taylor", phone: "+61412345678" })).toBeNull();
  });
});

describe("Xero", () => {
  test("custom connection token, find by email, create contact, history note", async () => {
    const { f, calls } = fake({
      "POST https://identity.xero.com/connect/token": { body: { access_token: "tok" } },
      "GET https://api.xero.com/connections": { body: [{ tenantId: "ten-1" }] },
      "GET https://api.xero.com/api.xro/2.0/Contacts?searchTerm": { body: { Contacts: [] } },
      "POST https://api.xero.com/api.xro/2.0/Contacts": { body: { Contacts: [{ ContactID: "c-1" }] } },
      "PUT https://api.xero.com/api.xro/2.0/Contacts/c-1/History": {},
    });
    const c = xero("clientid-12345:secret-12345-abc", {}, f);
    expect(await c.findContact(person)).toBeNull();
    expect(calls[0].body).toBe("grant_type=client_credentials&scope=accounting.contacts");
    expect(calls.find((x) => x.url.includes("searchTerm"))!.headers).toMatchObject({ Authorization: "Bearer tok", "Xero-tenant-id": "ten-1" });
    expect(await c.createContact(person)).toBe("c-1");
    expect(calls.find((x) => x.method === "POST" && x.url.endsWith("/Contacts"))!.body.Contacts[0]).toMatchObject({ Name: "Sam Taylor", EmailAddress: "sam@example.com" });
    await c.createBooking("c-1", booking);
    expect(calls.find((x) => x.method === "PUT")!.body.HistoryRecords[0].Details).toContain("Sore knee");
  });
  test("errors surface", async () => {
    const { f } = fake({ "POST https://identity.xero.com": { status: 400 } });
    await expect(xero("clientid-99999:secret-99999-abc", {}, f).findContact(person)).rejects.toThrow("400");
  });
});

/* -------------------------- opt-in flow (database) -------------------------- */

const now = new Date().toISOString();
const client: Business = {
  id: crypto.randomUUID(),
  assistantId: "demo-assistant",
  settings: { ...blankSettings(), businessName: "Alpha Physio", timezone: "Australia/Sydney" },
  instructions: "",
  phoneNumbers: [],
  createdAt: now,
  updatedAt: now,
};
const req = (over: Partial<BookingRequest> = {}): BookingRequest => ({ id: "r1", kind: "booking", at: now, channel: "phone", name: "Sam Taylor", phone: "+61412345678", service: "Consult", start: "2026-12-01T10:00", status: "booked", note: "Sore knee", email: "sam@example.com", ...over });
const sm8Routes = {
  "GET https://api.servicem8.com": { body: [] },
  "POST https://api.servicem8.com/api_1.0/company.json": { headers: { "x-record-uuid": "co-1" } },
  "POST https://api.servicem8.com/api_1.0/companycontact.json": {},
  "POST https://api.servicem8.com/api_1.0/job.json": { headers: { "x-record-uuid": "job-1" } },
  "POST https://api.servicem8.com/api_1.0/note.json": {},
};
let ready = true;
beforeAll(async () => {
  try {
    await migrate();
  } catch (err) {
    ready = false;
    console.warn("[appConnectors.test] no database, skipping the flow tests:", (err as Error).message);
  }
}, 60000);
afterAll(async () => {
  if (ready) await sql`delete from app_settings where key = ${appsKey(client.id)}`;
});
const setApps = (v: Stored) => putSetting(appsKey(client.id), v);

describe("opt-in flow", () => {
  test("switched off sends nothing", async () => {
    if (!ready) return;
    await setApps({ servicem8: { key: packKey("k-123456789"), savedAt: now } });
    const { f, calls } = fake(sm8Routes);
    await syncBooking(client, req(), f);
    await syncSummary(client, { phone: "+61412345678", summary: "Booked a consult", outcome: null, at: now }, f);
    expect(calls.length).toBe(0);
  });
  test("switched on: contact, job and note; then the summary goes to the same job; last sync recorded", async () => {
    if (!ready) return;
    await setApps({ servicem8: { key: packKey("k-123456789"), savedAt: now, enabled: true } });
    const { f, calls } = fake(sm8Routes);
    await syncBooking(client, req(), f);
    expect(calls.some((c) => c.url.endsWith("job.json"))).toBe(true);
    expect((await getSetting<Stored>(appsKey(client.id)))!.servicem8!.last).toMatchObject({ ok: true, what: "booking" });
    const again = fake(sm8Routes);
    await syncSummary(client, { phone: "0412 345 678", summary: "Booked a consult", outcome: "booked", at: now }, again.f);
    const note = again.calls.find((c) => c.url.endsWith("note.json"))!;
    expect(note.body).toMatchObject({ related_object: "job", related_object_uuid: "job-1" });
    expect(note.body.note).toContain("Booked a consult");
  });
  test("pending and failed bookings are not sent", async () => {
    if (!ready) return;
    const { f, calls } = fake(sm8Routes);
    await syncBooking(client, req({ status: "pending" }), f);
    await syncBooking(client, req({ status: "failed" }), f);
    expect(calls.length).toBe(0);
  });
  test("a down or rejecting app never throws and the error shows on the card", async () => {
    if (!ready) return;
    await setApps({ servicem8: { key: packKey("k-123456789"), savedAt: now, enabled: true }, cliniko: { key: packKey("abc123-au2"), savedAt: now, enabled: true } });
    const f: Doer = async (url) => {
      if (url.includes("cliniko")) throw new Error("socket hang up");
      return new Response("{}", { status: 401 });
    };
    await syncBooking(client, req(), f); // resolves
    const s = (await getSetting<Stored>(appsKey(client.id)))!;
    expect(s.servicem8!.last).toMatchObject({ ok: false });
    expect(s.servicem8!.last!.error).toContain("401");
    expect(s.cliniko!.last).toMatchObject({ ok: false, error: "Couldn't reach Cliniko." });
  });
  test("Tradify is never sent to", async () => {
    if (!ready) return;
    await setApps({ tradify: { key: packKey("tradify-key-1"), savedAt: now, enabled: true } });
    const { f, calls } = fake({});
    await syncBooking(client, req(), f);
    expect(calls.length).toBe(0);
  });
});
