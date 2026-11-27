import { createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";
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

/**
 * Telnyx's own webhook signature (https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks):
 * headers `telnyx-signature-ed25519` (base64) and `telnyx-timestamp`; the signed text is `<timestamp>|<raw body>`;
 * the key is the account's public key (portal, Keys & Credentials, Public Key: 32 raw bytes in base64).
 * Checked only when the server has that key (TELNYX_PUBLIC_KEY): the address secret always guards the hook.
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
export function telnyxSignatureOk(publicKeyB64: string, rawBody: string, signatureB64: string | null, timestamp: string | null, nowMs = Date.now()): boolean {
  if (!signatureB64 || !timestamp) return false;
  const t = Number(timestamp);
  if (!Number.isFinite(t) || Math.abs(nowMs - t * 1000) > 5 * 60_000) return false;
  try {
    const raw = Buffer.from(publicKeyB64, "base64");
    if (raw.length !== 32) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
