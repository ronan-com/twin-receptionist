import nodemailer from "nodemailer";
import { fresh, mailConfig } from "./platformSettings";

// Account emails (invites, password resets) sent from the platform itself, not
// from a client's mailbox. The platform admin sets the mail server and sender in
// Settings, "Email and calendars"; until then SMTP_URL (e.g.
// smtps://user:pass@smtp.resend.com:465, or Amazon SES SMTP credentials) and
// MAIL_FROM from the environment are used. With neither, emails are printed to
// the server log so local development still works.

type Transport = ReturnType<typeof nodemailer.createTransport>;

// Rebuilt whenever the mail server address changes, so a new setting takes effect
// on the next email without a restart.
let transport: Transport | null = null;
let transportUrl = "";

/** A one-off connection for the settings screen's test, which gives up quickly. */
export function testTransport(smtpUrl: string): Transport {
  return nodemailer.createTransport({ url: smtpUrl, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 } as any);
}

function transportFor(smtpUrl: string): Transport {
  if (!transport || transportUrl !== smtpUrl) {
    transport?.close();
    transport = nodemailer.createTransport(smtpUrl);
    transportUrl = smtpUrl;
  }
  return transport;
}

export const mailerReady = () => {
  const c = mailConfig();
  return Boolean(c.smtpUrl && c.from);
};

export async function sendAccountEmail(to: string, subject: string, text: string): Promise<boolean> {
  await fresh();
  const c = mailConfig();
  if (!c.smtpUrl || !c.from) {
    console.log(`[mail not configured] To: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return false;
  }
  await transportFor(c.smtpUrl).sendMail({ from: c.from, to, subject, text });
  return true;
}
