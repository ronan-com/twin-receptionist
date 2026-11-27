import { createHmac } from "node:crypto";
import { formatNumber, industry, type BookingRequest, type Business } from "../src/lib/shared";
import { sendAccountEmail } from "./mailer";
import { resolveBrand } from "./brand";
import { orgOfClient } from "./store";
import { isPublicHost } from "./net";
import { publicUrl } from "./booking";
import { ValidationError } from "./prompt";
import { syncBooking, syncSummary, type SummaryPush } from "./appConnectors";

// Tells the business about each booking and callback the receptionist takes:
//   - an email to the address they chose (needs SMTP_URL and MAIL_FROM)
//   - optionally a JSON POST to a webhook, which is how any CRM gets them
//     (HubSpot, GoHighLevel, Zapier, Make, a Google Sheet via Apps Script...)
// Neither can undo or delay a booking: failures are only logged.

// The key a CRM uses to check X-Twin-Signature. Derived from the receptionist's
// tool key, so it never reveals that key.
export function webhookSecret(toolKey: string): string {
  return createHmac("sha256", toolKey).update("lead-webhook").digest("base64url");
}

export async function checkWebhookUrl(value: unknown): Promise<string> {
  const url = String(value ?? "").trim();
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError("The webhook address isn't a valid URL.");
  }
  if (parsed.protocol !== "https:") throw new ValidationError("The webhook address must start with https://");
  if (url.length > 500) throw new ValidationError("The webhook address is too long.");
  if (!(await isPublicHost(parsed.hostname))) throw new ValidationError("The webhook address must be a public website.");
  return url;
}

export function checkEmailAddress(value: unknown): string {
  const email = String(value ?? "").trim();
  if (!email) return "";
  if (email.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) {
    throw new ValidationError("Enter one valid email address for booking notices.");
  }
  return email;
}


const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The caller's email in the business's own look: its logo and colour, else its agency's. Plain text stays the fallback. */
export async function brandedEmail(client: Business, to: string, subject: string, lines: string[]): Promise<boolean> {
  const text = lines.join("\n");
  let html: string | undefined;
  try {
    const orgId = await orgOfClient(client.id);
    if (orgId) {
      const b = await resolveBrand(orgId, client.id);
      const base = process.env.PUBLIC_URL ? publicUrl() || process.env.PUBLIC_URL.replace(/\/$/, "") : "";
      const colour = /^#[0-9a-f]{6}$/i.test(b.primaryColor ?? "") ? b.primaryColor! : "#111111";
      const logo = b.logo && base ? `<img src="${esc(base + b.logo)}" alt="" style="max-height:40px;max-width:200px;display:block;margin:0 0 10px">` : "";
      html = `<div style="font:15px/1.55 -apple-system,Segoe UI,Arial,sans-serif;color:#111;max-width:520px;margin:0 auto;padding:24px"><div style="border-top:4px solid ${colour};padding-top:16px">${logo}<div style="font-weight:600;color:${colour};margin-bottom:12px">${esc(client.settings.businessName)}</div>${lines.map((l) => (l ? `<p style="margin:0 0 8px;white-space:pre-wrap">${esc(l)}</p>` : "")).join("")}</div></div>`;
    }
  } catch {
    html = undefined;
  }
  return sendAccountEmail(to, subject, text, html ? { html } : {});
}

// "an appointment", "a centre tour": what this kind of business calls a booking.
function aBooking(client: Business): string {
  const what = industry(client.settings.industry).booking;
  return `${/^[aeiou]/i.test(what) ? "an" : "a"} ${what}`;
}

/** A booking the caller moved or cancelled by phone. `was` is the time it used to be at. */
export type BookingChange = { kind: "rescheduled" | "cancelled"; was: string };

const whenText = (client: Business, r: { start: string }) =>
  new Date(r.start).toLocaleString("en-AU", { timeZone: client.settings.timezone, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });

/**
 * The caller's own confirmation of a booking, sent to the email they gave on the
 * call. Plain facts only: when, where, and who to ring to change it.
 */
export async function confirmToCaller(client: Business, r: BookingRequest, change?: BookingChange): Promise<boolean> {
  if (r.kind !== "booking" || r.status !== "booked" || !r.email) return false;
  const s = client.settings;
  const what = industry(s.industry).booking;
  const number = client.phoneNumbers?.[0];
  if (change) {
    const first = r.name.split(" ")[0] || "there";
    const was = whenText(client, { start: change.was });
    const body =
      change.kind === "cancelled"
        ? [`Hi ${first},`, "", `Your ${what} at ${s.businessName} on ${was} has been cancelled.`, "", number ? `To book again, call us on ${formatNumber(number)}.` : "To book again, please call us.", "", s.businessName]
        : [
            `Hi ${first},`,
            "",
            `Your ${what} at ${s.businessName} has been moved.`,
            "",
            `Now:    ${whenText(client, r)}`,
            `Was:    ${was}`,
            ...(s.address ? [`Where:  ${s.address}`] : []),
            ...(r.service ? [`For:    ${r.service}`] : []),
            "",
            number ? `To change or cancel, call us on ${formatNumber(number)}.` : "To change or cancel, please call us.",
            "",
            s.businessName,
          ];
    const subject = change.kind === "cancelled" ? `Your ${what} at ${s.businessName} is cancelled` : `Your ${what} at ${s.businessName} has moved: ${whenText(client, r)}`;
    return brandedEmail(client, r.email, subject, body);
  }
  const lines = [
    `Hi ${r.name.split(" ")[0] || "there"},`,
    "",
    `Your ${what} at ${s.businessName} is booked.`,
    "",
    `When:   ${whenText(client, r)}`,
    ...(s.address ? [`Where:  ${s.address}`] : []),
    ...(r.service ? [`For:    ${r.service}`] : []),
    "",
    number ? `To change or cancel, call us on ${formatNumber(number)}.` : "To change or cancel, please call us.",
    "",
    s.businessName,
  ];
  return brandedEmail(client, r.email, `Your ${what} at ${s.businessName}: ${whenText(client, r)}`, lines);
}

/** The caller's note that the business couldn't take the time they asked for. */
export async function declineToCaller(client: Business, r: BookingRequest): Promise<boolean> {
  if (r.kind !== "booking" || !r.email) return false;
  const s = client.settings;
  const what = industry(s.industry).booking;
  const number = client.phoneNumbers?.[0];
  const lines = [
    `Hi ${r.name.split(" ")[0] || "there"},`,
    "",
    `Sorry, we can't do the ${what} you asked for on ${whenText(client, r)}.`,
    "",
    number ? `Please call us on ${formatNumber(number)} and we'll find another time.` : "Please get in touch and we'll find another time.",
    "",
    s.businessName,
  ];
  return brandedEmail(client, r.email, `Your ${what} request at ${s.businessName}`, lines);
}

function emailText(client: Business, r: BookingRequest, change?: BookingChange): { subject: string; text: string } {
  const who = r.name || "Someone";
  const how = r.channel === "sms" ? "by text" : r.channel === "email" ? "by email" : r.channel === "web" ? "in the website chat" : "on a call";
  if (change) {
    const moved = change.kind === "rescheduled";
    const lines = [
      `${client.settings.receptionistName || "Your AI receptionist"} ${moved ? "moved" : "cancelled"} ${aBooking(client)} on a call, at the caller's request.`,
      "",
      ...(moved ? [`Now:      ${whenText(client, r)}`, `Was:      ${whenText(client, { start: change.was })}`] : [`Was:      ${whenText(client, { start: change.was })}`]),
      `Name:     ${who}`,
      `Phone:    ${formatNumber(r.phone)}`,
      ...(r.email ? [`Email:    ${r.email}`] : []),
      `Service:  ${r.service || "not given"}`,
    ];
    return { subject: `${moved ? "Booking moved" : "Booking cancelled"}: ${who}, ${r.service || "appointment"}`, text: lines.join("\n") };
  }
  const lines =
    r.kind === "booking" && r.status === "pending"
      ? [
          `${client.settings.receptionistName || "Your AI receptionist"} took a booking request ${how}. It needs your approval.`,
          "",
          `When:     ${whenText(client, r)}`,
          `Name:     ${who}`,
          `Phone:    ${formatNumber(r.phone)}`,
          ...(r.email ? [`Email:    ${r.email}`] : []),
          `Service:  ${r.service || "not given"}`,
          ...(r.note ? [`Notes:    ${r.note}`] : []),
          "",
          "Approve or decline it in your Calendar. The time is held for them until you do.",
        ]
      : r.kind === "booking"
      ? [
          `${client.settings.receptionistName || "Your AI receptionist"} booked ${aBooking(client)} ${how}.`,
          "",
          `When:     ${whenText(client, r)}`,
          `Name:     ${who}`,
          `Phone:    ${formatNumber(r.phone)}`,
          ...(r.email ? [`Email:    ${r.email}`] : []),
          `Service:  ${r.service || "not given"}`,
          ...(r.note ? [`Notes:    ${r.note}`] : []),
        ]
      : [
          `${who} would like a call back. ${client.settings.receptionistName || "Your AI receptionist"} took the request ${how}.`,
          "",
          `Phone:      ${formatNumber(r.phone)}`,
          `About:      ${r.service || "not given"}`,
          ...(r.start ? [`Best time:  ${r.start}`] : []),
          ...(r.note ? [`Message:    ${r.note}`] : []),
        ];
  const subject = r.kind === "booking" && r.status === "pending" ? `Approve booking: ${who}, ${r.service || "appointment"}` : r.kind === "booking" ? `New booking: ${who}, ${r.service || "appointment"}` : `Call back: ${who}`;
  return { subject, text: lines.join("\n") };
}

/** The webhook POST (signed). Checked again at send time: a name can be repointed after it was saved. */
async function postWebhook(setup: NonNullable<Business["booking"]>, payload: Record<string, unknown>): Promise<void> {
  if (!(await isPublicHost(new URL(setup.leadWebhook!).hostname))) throw new Error("webhook host is not public");
  const body = JSON.stringify(payload);
  // Lets the receiver check it really came from here (HMAC-SHA256 of the body).
  const signature = createHmac("sha256", webhookSecret(setup.token)).update(body).digest("hex");
  const res = await fetch(setup.leadWebhook!, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Twin-Signature": `sha256=${signature}` },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`webhook answered ${res.status}`);
}

export async function notifyBusiness(client: Business, r: BookingRequest, change?: BookingChange): Promise<void> {
  const setup = client.booking;
  if (!setup) return;
  const jobs: Promise<unknown>[] = [];
  if (setup.notifyEmail) {
    const { subject, text } = emailText(client, r, change);
    jobs.push(sendAccountEmail(setup.notifyEmail, subject, text));
  }
  if (setup.leadWebhook) {
    jobs.push(postWebhook(setup, { event: change ? `booking_${change.kind}` : r.kind, ...(change ? { previousStart: change.was } : {}), business: client.settings.businessName, receptionistId: client.id, ...r }));
  }
  // The business's own apps (ServiceM8, Cliniko, Xero), for the ones it switched on. Moves and cancellations aren't sent.
  if (!change) jobs.push(syncBooking(client, r));
  for (const result of await Promise.allSettled(jobs)) {
    if (result.status === "rejected") console.error(`[notify ${client.id}]`, (result.reason as Error).message);
  }
}

/** A finished call's summary: to the webhook ("call_summary") and the switched-on apps. Only logs on failure. */
export async function notifyCallSummary(client: Business, s: SummaryPush & { callId: string }): Promise<void> {
  const setup = client.booking;
  const jobs: Promise<unknown>[] = [syncSummary(client, s)];
  if (setup?.leadWebhook) {
    jobs.push(postWebhook(setup, { event: "call_summary", business: client.settings.businessName, receptionistId: client.id, callId: s.callId, phone: s.phone, summary: s.summary, outcome: s.outcome, at: s.at }));
  }
  for (const result of await Promise.allSettled(jobs)) {
    if (result.status === "rejected") console.error(`[notify ${client.id}] summary`, (result.reason as Error).message);
  }
}
