// The site's own email (invites, admin password reset, offline notices). One place, two ways out:
//   SITE_SMTP_URL + SITE_MAIL_FROM        any SMTP server (smtps://user:pass@host:465)
//   RESEND_API_KEY + SITE_MAIL_FROM       Resend's HTTP API (from must be on a domain verified in Resend)
// Every email is plain text plus a small white HTML twin: one accent colour, one optional button.
import nodemailer from "nodemailer";

const t = (k: string) => (process.env[k] ?? "").trim();
export const mailFrom = () => t("SITE_MAIL_FROM");
export const hasSmtp = () => !!t("SITE_SMTP_URL");
export const hasResend = () => !!t("RESEND_API_KEY");
/** Can this site send email at all? */
export const siteMailConfigured = () => !!mailFrom() && (hasSmtp() || hasResend());

export interface Mail { from: string; to: string; subject: string; text: string; html?: string }

/** Sends one email by whichever way is set (SMTP first). Throws on failure; callers say a sentence of their own. */
export async function deliver(smtp: string, mail: Mail): Promise<void> {
  if (smtp) {
    const tr = nodemailer.createTransport(smtp, { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 } as any);
    try { await tr.sendMail(mail); } finally { tr.close(); }
    return;
  }
  const key = t("RESEND_API_KEY");
  if (!key) throw new Error("no mail sender");
  const base = (t("RESEND_API_BASE") || "https://api.resend.com").replace(/\/$/, "");
  const res = await fetch(`${base}/emails`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "agency-setup/1.0" },
    body: JSON.stringify({ from: mail.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}`);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const ACCENT = "#4f46e5";
/** The white HTML version of a plain-text email. URLs on their own line become the button (or a link). */
export function htmlMail(text: string, button?: { label: string; url: string }): string {
  const paras = text.trim().split(/\n{2,}/).map((p) => {
    const line = p.trim();
    if (/^https?:\/\/\S+$/.test(line)) return button && button.url === line ? "" : `<p style="margin:0 0 20px"><a href="${esc(line)}" style="color:${ACCENT};word-break:break-all">${esc(line)}</a></p>`;
    return `<p style="margin:0 0 20px">${esc(line).replace(/\n/g, "<br>")}</p>`;
  }).join("");
  const btn = button ? `<p style="margin:28px 0"><a href="${esc(button.url)}" style="background:${ACCENT};color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;display:inline-block">${esc(button.label)}</a></p>` : "";
  return `<!doctype html><html><body style="margin:0;background:#fff"><div style="max-width:520px;margin:0 auto;padding:40px 24px;font:16px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">${paras}${btn}</div></body></html>`;
}

/** Swappable in tests. */
export const mailDeps = { deliver };

/** Sends one email from the site. null = sent; otherwise a short sentence for the admin. */
export async function sendSiteMail(to: string, subject: string, text: string, button?: { label: string; url: string }): Promise<string | null> {
  if (!siteMailConfigured()) return "Email isn't set up on the setup site — copy and send it yourself.";
  try {
    await mailDeps.deliver(t("SITE_SMTP_URL"), { from: mailFrom(), to, subject, text, html: htmlMail(text, button) });
    return null;
  } catch (e: any) {
    console.error(`[mail] to ${to.replace(/^[^@]*/, "***")} failed: ${e?.code || e?.name || "error"}`);
    return "The email didn't send. Copy the link and send it yourself.";
  }
}
