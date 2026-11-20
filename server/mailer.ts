import nodemailer from "nodemailer";

// Account emails (invites, password resets) sent from the platform itself, not
// from a client's mailbox. Set SMTP_URL (e.g. smtps://user:pass@smtp.resend.com:465,
// or Amazon SES SMTP credentials) and MAIL_FROM. Without them, emails are printed
// to the server log so local development still works.

const SMTP_URL = process.env.SMTP_URL ?? "";
const FROM = process.env.MAIL_FROM ?? "";

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

export const mailerReady = () => Boolean(SMTP_URL && FROM);

export async function sendAccountEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!mailerReady()) {
    console.log(`[mail not configured] To: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return false;
  }
  transport ??= nodemailer.createTransport(SMTP_URL);
  await transport.sendMail({ from: FROM, to, subject, text });
  return true;
}
