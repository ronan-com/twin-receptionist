import { createHmac } from "node:crypto";
import { formatNumber, industry, type BookingRequest, type Business } from "../src/lib/shared";
import { sendAccountEmail } from "./mailer";
import { isPublicHost } from "./net";
import { ValidationError } from "./prompt";

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

// "an appointment", "a centre tour": what this kind of business calls a booking.
function aBooking(client: Business): string {
  const what = industry(client.settings.industry).booking;
  return `${/^[aeiou]/i.test(what) ? "an" : "a"} ${what}`;
}

const whenText = (client: Business, r: BookingRequest) =>
  new Date(r.start).toLocaleString("en-AU", { timeZone: client.settings.timezone, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });

/**
 * The caller's own confirmation of a booking, sent to the email they gave on the
 * call. Plain facts only: when, where, and who to ring to change it.
 */
export async function confirmToCaller(client: Business, r: BookingRequest): Promise<boolean> {
  if (r.kind !== "booking" || r.status !== "booked" || !r.email) return false;
  const s = client.settings;
  const what = industry(s.industry).booking;
  const number = client.phoneNumbers?.[0];
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
  return sendAccountEmail(r.email, `Your ${what} at ${s.businessName}: ${whenText(client, r)}`, lines.join("\n"));
}

function emailText(client: Business, r: BookingRequest): { subject: string; text: string } {
  const who = r.name || "Someone";
  const how = r.channel === "sms" ? "by text" : r.channel === "email" ? "by email" : "on a call";
  const lines =
    r.kind === "booking"
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
  const subject = r.kind === "booking" ? `New booking: ${who}, ${r.service || "appointment"}` : `Call back: ${who}`;
  return { subject, text: lines.join("\n") };
}

export async function notifyBusiness(client: Business, r: BookingRequest): Promise<void> {
  const setup = client.booking;
  if (!setup) return;
  const jobs: Promise<unknown>[] = [];
  if (setup.notifyEmail) {
    const { subject, text } = emailText(client, r);
    jobs.push(sendAccountEmail(setup.notifyEmail, subject, text));
  }
  if (setup.leadWebhook) {
    jobs.push(
      (async () => {
        // Checked again at send time: a name can be repointed after it was saved.
        if (!(await isPublicHost(new URL(setup.leadWebhook!).hostname))) throw new Error("webhook host is not public");
        const body = JSON.stringify({
          event: r.kind,
          business: client.settings.businessName,
          receptionistId: client.id,
          ...r,
        });
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
      })(),
    );
  }
  for (const result of await Promise.allSettled(jobs)) {
    if (result.status === "rejected") console.error(`[notify ${client.id}]`, (result.reason as Error).message);
  }
}
