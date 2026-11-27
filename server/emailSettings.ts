import type { EmailSenderView, EmailSettings, PlatformTestResult } from "../src/lib/shared";
import { AuthError, singleAgency, type Ctx } from "./accounts";
import { audit } from "./audit";
import { deliver, recentMail, testTransport } from "./mailer";
import { buildSender, describeUrl, friendlySmtpError, guessProvider, providerLabel, type MailProvider, type SenderInput } from "./mailPresets";
import { countCheck } from "./phoneAccount";
import { clearSaved, fresh, mailConfig, refresh, saveMail, savedInfo, type MailConfig } from "./platformSettings";
import { ValidationError } from "./prompt";
import { json, readBody } from "./routes/http";

// /api/admin/email-settings: Settings, "Email". The simple choices (Resend, Gmail, Microsoft 365, Zoho,
// any SMTP) for the main sender and a backup, a test email, and the last 10 emails sent or failed.
// It changes the same saved sender as "Email and calendars" (server/platformSettings.ts).

/**
 * Who may change how account emails are sent: on a packaged install (SINGLE_AGENCY) the agency's owner
 * or admins; on a shared platform, only the platform admin (it's the platform's sender). Never while viewing as someone.
 */
export function canManageEmail(ctx: Pick<Ctx, "user" | "role" | "viewing">, single = singleAgency()): boolean {
  if (ctx.viewing) return false;
  if (ctx.user.platformAdmin) return true;
  return single && (ctx.role === "owner" || ctx.role === "admin");
}

function requireEmailAdmin(ctx: Ctx): void {
  if (canManageEmail(ctx)) return;
  if (ctx.viewing) throw new AuthError(`You're viewing ${ctx.viewing.org}. Exit the view to change email settings.`, 403);
  throw new AuthError(singleAgency() ? "Only an owner or admin can change how emails are sent." : "Only the platform admin can change how emails are sent.", 403);
}

// The real SMTP login check; tests swap it.
type Verifier = (url: string) => Promise<void>;
const realVerify: Verifier = async (url) => {
  const t = testTransport(url);
  try {
    await t.verify();
  } finally {
    t.close();
  }
};
let verify: Verifier = realVerify;
export const setVerifier = (v?: Verifier) => void (verify = v ?? realVerify);

/** Checks the choice and signs in to it for real. Throws a ValidationError with the provider's usual fix. */
export async function checkSender(input: SenderInput) {
  const s = buildSender(input);
  try {
    await verify(s.smtpUrl);
  } catch (err) {
    throw new ValidationError(friendlySmtpError(err, s.provider, s.host, s.port));
  }
  return s;
}

function view(url: string | undefined, from: string | undefined, provider: string | undefined): EmailSenderView | null {
  if (!url) return null;
  const d = describeUrl(url);
  const p = (provider || guessProvider(url)) as MailProvider;
  return { provider: p, label: providerLabel(p), host: d.host, port: d.port, username: d.username === "resend" ? "" : d.username, from: from ?? "", last4: d.last4 };
}

export async function emailSettings(ctx: Ctx): Promise<EmailSettings> {
  await refresh();
  const c = mailConfig();
  const info = savedInfo("mail");
  return {
    source: c.source,
    primary: c.smtpUrl && c.from ? view(c.smtpUrl, c.from, c.provider) : null,
    backup: view(c.backupUrl, c.backupFrom || c.from, c.backupProvider),
    savedAt: info.saved ? String((info as any).updatedAt ?? "") : "",
    savedBy: info.saved ? String((info as any).updatedBy ?? "") : "",
    problem: info.problem,
    recent: await recentMail(10).catch(() => []),
    testTo: ctx.user.email,
  };
}

const current = (): MailConfig => {
  const { source, ...c } = mailConfig();
  return c;
};

async function savePrimary(ctx: Ctx, input: SenderInput): Promise<void> {
  const s = await checkSender(input);
  await saveMail({ ...current(), smtpUrl: s.smtpUrl, from: s.from, provider: s.provider }, ctx.user.email);
  await audit(ctx, "email_settings.save", { which: "primary", provider: s.provider, host: s.host });
}

async function saveBackup(ctx: Ctx, input: SenderInput): Promise<void> {
  const c = current();
  if (!c.smtpUrl || !c.from) throw new ValidationError("Set up the main sender first. The backup is only used when it fails.");
  const s = await checkSender(input);
  if (s.smtpUrl === c.smtpUrl) throw new ValidationError("That's the same account as the main sender. A backup should be a different account.");
  await saveMail({ ...c, backupUrl: s.smtpUrl, backupFrom: s.from, backupProvider: s.provider }, ctx.user.email);
  await audit(ctx, "email_settings.save", { which: "backup", provider: s.provider, host: s.host });
}

async function sendTest(ctx: Ctx, input: any): Promise<PlatformTestResult> {
  countCheck(`email-settings:${ctx.user.id}`);
  await fresh();
  const which = input?.which === "backup" ? "backup" : input?.which === "primary" ? "primary" : undefined;
  const c = mailConfig();
  const v = which === "backup" ? view(c.backupUrl, c.backupFrom || c.from, c.backupProvider) : view(c.smtpUrl, c.from, c.provider);
  if (!v) throw new ValidationError(which === "backup" ? "There's no backup sender yet." : "Set up how emails are sent first.");
  const r = await deliver(ctx.user.email, "Test email from your dashboard", `This is a test from Settings, "Email".\n\nIf you're reading it, invites, password resets and booking emails will reach people.`, which);
  if (!r.ok) {
    throw new ValidationError(friendlySmtpError({ message: r.error }, which === "backup" ? v.provider : (c.provider || guessProvider(c.smtpUrl)), v.host, v.port));
  }
  const used = r.via === "backup" ? view(c.backupUrl, c.backupFrom || c.from, c.backupProvider)! : view(c.smtpUrl, c.from, c.provider)!;
  const note = !which && r.via === "backup" ? " The main sender failed, so the backup sent it: check the main one." : "";
  return { ok: true, message: `Sent a test email to ${ctx.user.email} through ${used.label} (${r.via === "backup" ? "backup" : "main sender"}).${note}` };
}

export async function emailSettingsRoutes(req: Request, path: string, method: string, ctx: Ctx): Promise<Response | null> {
  if (path !== "/api/admin/email-settings" && !path.startsWith("/api/admin/email-settings/")) return null;
  requireEmailAdmin(ctx);
  if (path === "/api/admin/email-settings") return method === "GET" ? json(await emailSettings(ctx)) : null;
  if (path === "/api/admin/email-settings/test") return method === "POST" ? json(await sendTest(ctx, await readBody(req))) : null;
  const m = path.match(/^\/api\/admin\/email-settings\/(primary|backup)$/);
  if (!m) return null;
  await fresh();
  if (method === "PUT") {
    countCheck(`email-settings:${ctx.user.id}`);
    const body = (await readBody(req)) as SenderInput;
    await (m[1] === "primary" ? savePrimary(ctx, body) : saveBackup(ctx, body));
    return json(await emailSettings(ctx));
  }
  if (method === "DELETE") {
    if (m[1] === "primary") await clearSaved("mail");
    else {
      const c = current();
      if (c.smtpUrl) await saveMail({ ...c, backupUrl: "", backupFrom: "", backupProvider: "" }, ctx.user.email);
    }
    await audit(ctx, "email_settings.clear", { which: m[1] });
    return json(await emailSettings(ctx));
  }
  return null;
}
