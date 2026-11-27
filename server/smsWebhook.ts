import { createHmac, timingSafeEqual } from "node:crypto";
import { publicUrl } from "./booking";

// Where a provider tells our server a text arrived. One address per receptionist, with a secret
// made from the server's key and the receptionist's id (nothing stored, one leaked address opens
// one receptionist only):
//   Telnyx  POST /hooks/sms/telnyx/<clientId>/<secret>   (the messaging profile's webhook_url)
//   Twilio  POST /hooks/sms/twilio/<clientId>/<secret>   (the number's SmsUrl; also signed by Twilio)

function secretBase(): string {
  const base = process.env.SMS_WEBHOOK_SECRET || process.env.VAPI_WEBHOOK_SECRET || process.env.MAILBOX_KEY || process.env.SESSION_SECRET || "";
  if (!base) throw new Error("Set SMS_WEBHOOK_SECRET (or MAILBOX_KEY) so incoming texts can be checked.");
  return base;
}

export const smsSecret = (clientId: string): string => createHmac("sha256", secretBase()).update(`sms-hook:${clientId}`).digest("base64url");

export function smsSecretOk(clientId: string, given: string): boolean {
  let want: string;
  try {
    want = smsSecret(clientId);
  } catch {
    return false;
  }
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SmsVia = "telnyx" | "twilio";

/** The address a provider posts incoming texts to, or "" when this server has no public address. */
export function smsHookUrl(via: SmsVia, clientId: string, base = publicUrl()): string {
  return base ? `${base}/hooks/sms/${via}/${clientId}/${smsSecret(clientId)}` : "";
}

/**
 * Twilio's X-Twilio-Signature: base64 HMAC-SHA1, keyed by the account's Auth Token, of the full
 * address followed by every posted field (name then value) in name order.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function twilioSignatureOk(authToken: string, url: string, params: Record<string, string>, given: string | null): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(twilioSignature(authToken, url, params));
  return a.length === b.length && timingSafeEqual(a, b);
}
