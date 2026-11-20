import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ValidationError } from "./prompt";

// Secrets kept in the database (mailbox passwords, Google/Microsoft refresh tokens)
// are sealed with MAILBOX_KEY using AES-256-GCM. Format: v1.<iv>.<tag>.<ciphertext>.

function key(): Buffer {
  const k = Buffer.from(process.env.MAILBOX_KEY ?? "", "base64");
  if (k.length !== 32) {
    throw new ValidationError("MAILBOX_KEY is missing. Add one (openssl rand -base64 32) and restart.");
  }
  return k;
}

export function seal(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function unseal(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1") throw new Error("Unknown secret format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}
