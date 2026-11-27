import { ValidationError } from "./prompt";

// The simple choices behind Settings, "Email": Resend, or "use my own email account" with a preset
// for the big providers, or any SMTP server. Each choice turns into one SMTP address (what the
// mailer sends through) and a from address. Pure: nothing here connects anywhere.

export type MailProvider = "resend" | "gmail" | "microsoft" | "zoho_au" | "zoho" | "smtp";
export const MAIL_PROVIDERS: MailProvider[] = ["resend", "gmail", "microsoft", "zoho_au", "zoho", "smtp"];

export type Preset = { label: string; host: string; port: number; passwordName: string };

export const PRESETS: Record<Exclude<MailProvider, "smtp">, Preset> = {
  resend: { label: "Resend", host: "smtp.resend.com", port: 465, passwordName: "Resend API key" },
  gmail: { label: "Gmail / Google Workspace", host: "smtp.gmail.com", port: 587, passwordName: "app password" },
  microsoft: { label: "Microsoft 365 / Outlook", host: "smtp.office365.com", port: 587, passwordName: "password" },
  zoho_au: { label: "Zoho Mail (Australia)", host: "smtp.zoho.com.au", port: 587, passwordName: "password" },
  zoho: { label: "Zoho Mail", host: "smtp.zoho.com", port: 587, passwordName: "password" },
};

export const providerLabel = (p: string): string => (p in PRESETS ? PRESETS[p as keyof typeof PRESETS].label : p === "smtp" ? "Other (SMTP)" : "Email server");

export type SenderInput = {
  provider?: unknown;
  /** Resend: the API key. Others: the account's (app) password. */
  password?: unknown;
  /** The address emails come from (and, for the presets, the login). */
  address?: unknown;
  /** Optional name shown with the address, e.g. "Chloe". */
  fromName?: unknown;
  // Other (SMTP) only.
  host?: unknown;
  port?: unknown;
  username?: unknown;
};

export type Sender = { provider: MailProvider; smtpUrl: string; from: string; host: string; port: number; username: string };

const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const PORTS = [25, 465, 587, 2465, 2525, 2587];
const t = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);

export function smtpUrlOf(host: string, port: number, user: string, pass: string): string {
  return `${port === 465 || port === 2465 ? "smtps" : "smtp"}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
}

/** Checks one choice and builds its SMTP address. Throws a ValidationError with a plain sentence. */
export function buildSender(input: SenderInput): Sender {
  const provider = t(input.provider, 20) as MailProvider;
  if (!MAIL_PROVIDERS.includes(provider)) throw new ValidationError("Choose how emails are sent.");
  const address = t(input.address, 254).toLowerCase();
  const password = String(input.password ?? "").trim().slice(0, 500);
  const name = t(input.fromName, 80).replace(/[<>"\r\n]/g, "");
  if (!EMAIL.test(address)) throw new ValidationError("Enter the address emails come from, like hello@yourbusiness.com.");
  const from = name ? `${name} <${address}>` : address;

  if (provider === "resend") {
    if (!password) throw new ValidationError("Paste your Resend API key. It starts with re_.");
    if (!/^re_[A-Za-z0-9_]{8,}$/.test(password)) throw new ValidationError("That doesn't look like a Resend API key. It starts with re_ (make one at resend.com, API Keys).");
    const p = PRESETS.resend;
    return { provider, smtpUrl: smtpUrlOf(p.host, p.port, "resend", password), from, host: p.host, port: p.port, username: "resend" };
  }
  if (provider === "smtp") {
    const host = t(input.host, 253).toLowerCase();
    const port = Number(t(input.port, 6) || 587);
    const username = t(input.username, 254) || address;
    if (!HOST.test(host)) throw new ValidationError("Enter the SMTP server, like smtp.example.com.");
    if (!Number.isInteger(port) || !PORTS.includes(port)) throw new ValidationError("The port is usually 587 (or 465).");
    if (!password) throw new ValidationError("Enter the SMTP password.");
    return { provider, smtpUrl: smtpUrlOf(host, port, username, password), from, host, port, username };
  }
  const p = PRESETS[provider];
  if (!password) {
    throw new ValidationError(provider === "gmail" ? "Paste the 16-letter app password from your Google account (not your normal password)." : `Enter the ${p.passwordName} for ${address}.`);
  }
  // Google shows app passwords in groups of four; the spaces are not part of it.
  const pass = provider === "gmail" ? password.replace(/\s+/g, "") : password;
  if (provider === "gmail" && !/^[a-z]{16}$/i.test(pass)) {
    throw new ValidationError("A Google app password is 16 letters, like abcd efgh ijkl mnop. Make one at myaccount.google.com/apppasswords.");
  }
  return { provider, smtpUrl: smtpUrlOf(p.host, p.port, address, pass), from, host: p.host, port: p.port, username: address };
}

/** A plain sentence for a failed SMTP login or send, with the provider's usual fix. */
export function friendlySmtpError(err: unknown, provider: MailProvider | string, host: string, port: number): string {
  const e = err as { code?: string; message?: string; response?: string; responseCode?: number };
  const code = String(e?.code ?? "");
  const text = String(e?.response || e?.message || "");
  if (code === "EAUTH" || e?.responseCode === 535 || /\b535\b|authentication|username and password/i.test(text)) {
    if (provider === "gmail") return "Gmail didn't accept that. Use an app password (16 letters) made at myaccount.google.com/apppasswords, not your normal password. 2-Step Verification must be on.";
    if (provider === "microsoft") {
      if (/SmtpClientAuthentication|5\.7\.139|disabled/i.test(text)) return "Microsoft 365 has SMTP sign-in switched off for this mailbox. An admin turns on \"Authenticated SMTP\" for it in the Microsoft 365 admin centre (Users, Mail, Manage email apps).";
      return "Microsoft didn't accept that address and password. If the account has multi-factor sign-in, make an app password, and check \"Authenticated SMTP\" is on for the mailbox.";
    }
    if (provider === "zoho" || provider === "zoho_au") return "Zoho didn't accept that. Check you chose the right region (Australia is zoho.com.au), and if two-factor sign-in is on, use an app-specific password.";
    if (provider === "resend") return "Resend didn't accept that API key. Make a new one at resend.com (API Keys) and paste it again.";
    return `${host} didn't accept the username and password. Check them (some providers need an app password).`;
  }
  if (code === "EDNS" || /ENOTFOUND|EAI_AGAIN/.test(text)) return `Couldn't find a mail server called ${host}. Check the server name.`;
  if (/wrong version number|ssl3_get_record|unknown protocol/i.test(text)) return `Couldn't start a secure connection to ${host} on port ${port}. Try 587, or 465.`;
  if (code === "ETIMEDOUT" || /timed? ?out/i.test(text)) return `${host} didn't answer on port ${port}. Check the port (usually 587), and that this server may send mail out.`;
  if (["ECONNREFUSED", "ESOCKET", "ECONNECTION", "ECONNRESET"].includes(code) || /ECONNREFUSED|ECONNRESET/.test(text)) return `Couldn't connect to ${host} on port ${port}. Check the server name and port.`;
  if (code === "EENVELOPE" || /sender|from address|SendAsDenied|not verified|domain/i.test(text)) {
    return `The mail server wouldn't send from that address: ${text.replace(/[\r\n]+/g, " ").slice(0, 160)}. Use the account's own address, or verify the domain with your provider.`;
  }
  return `The mail server said: ${text.replace(/[\r\n]+/g, " ").slice(0, 160) || "an unknown error"}.`;
}

/** What may be shown about a sender: the provider, server and from address, never the password. */
export function describeUrl(smtpUrl: string): { host: string; port: number; username: string; last4: string } {
  try {
    const u = new URL(smtpUrl);
    const port = Number(u.port || (u.protocol === "smtps:" ? 465 : 587));
    return { host: u.hostname, port, username: decodeURIComponent(u.username), last4: decodeURIComponent(u.password).slice(-4) };
  } catch {
    return { host: "", port: 0, username: "", last4: "" };
  }
}

/** Which preset an SMTP address belongs to (for settings made from the server's files). */
export function guessProvider(smtpUrl: string): MailProvider {
  const { host } = describeUrl(smtpUrl);
  const hit = (Object.keys(PRESETS) as (keyof typeof PRESETS)[]).find((k) => PRESETS[k].host === host);
  return hit ?? "smtp";
}
