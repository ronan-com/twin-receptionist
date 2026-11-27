import type { PlatformServiceState, PlatformSettings, PlatformTestResult } from "../src/lib/shared";
import { AuthError, singleAgency, type Ctx } from "./accounts";
import { audit } from "./audit";
import { testTransport } from "./mailer";
import { mailboxSignInAllowed, redirectBase, redirectUri, requestedScopes, usesSharedApp, type OAuthProvider } from "./oauth";
import { brokerConfig, brokerStatus } from "./broker";
import { countCheck } from "./phoneAccount";
import { UI_PRODUCT } from "./product";
import {
  clearSaved,
  fresh,
  last4OfSmtp,
  mailConfig,
  oauthClient,
  refresh,
  saveMail,
  saveOAuth,
  savedInfo,
  savedSecret,
  smtpHost,
  type Service,
} from "./platformSettings";
import { ValidationError } from "./prompt";
import { json, readBody } from "./routes/http";

// /api/admin/platform-settings: the platform admin's "Email and calendars" tab.
// GET shows what's set (never a whole secret), PUT saves, DELETE goes back to the
// server's environment, POST .../test checks a setting before or after saving.

const NAME: Record<OAuthProvider, string> = { google: "Google", microsoft: "Microsoft" };
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the platform admin (with SINGLE_AGENCY, the agency's owner), in their own console (not while viewing as an agency). */
function requirePlatformOwner(ctx: Ctx): void {
  const owner = ctx.user.platformAdmin || (singleAgency() && ctx.role === "owner");
  if (!owner) throw new AuthError(singleAgency() ? "Only the owner can change these settings." : "Only the platform admin can change these settings.", 403);
  if (ctx.viewing) throw new AuthError(`You're viewing ${ctx.viewing.org}. Exit the view to change platform settings.`, 403);
}

const text = (v: unknown, max = 1000) => String(v ?? "").trim().slice(0, max + 1);

// ---- Checks: plain answers for the most common copy-and-paste mistakes ----

function checkSmtpUrl(raw: string): string {
  if (!raw) throw new ValidationError("Paste the mail server address first.");
  if (raw.length > 1000 || /\s/.test(raw)) throw new ValidationError("The mail server address should be one line with no spaces.");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ValidationError("That isn't a mail server address. It looks like smtps://USERNAME:PASSWORD@smtp.example.com:465.");
  }
  if (u.protocol !== "smtp:" && u.protocol !== "smtps:") {
    throw new ValidationError("The mail server address starts with smtps:// (port 465) or smtp:// (port 587).");
  }
  if (!u.hostname) {
    throw new ValidationError("The mail server address is missing the server's name, e.g. smtp.example.com. If your password has @, / or # in it, write them as %40, %2F and %23.");
  }
  return raw;
}

function checkFrom(raw: string): string {
  if (!raw) throw new ValidationError(`Add the address emails come from, e.g. ${UI_PRODUCT} <no-reply@example.com>.`);
  if (raw.length > 200) throw new ValidationError("The from address is too long.");
  if (!/^(?:[^<>@]*<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/.test(raw)) {
    throw new ValidationError(`The from address should be an email address, or a name and address like ${UI_PRODUCT} <no-reply@example.com>.`);
  }
  return raw;
}

function checkClient(provider: OAuthProvider, id: string, secret: string): void {
  if (!id) throw new ValidationError(`Paste the ${NAME[provider]} client ID first.`);
  if (!secret) throw new ValidationError(`Paste the ${NAME[provider]} client secret first.`);
  if (/\s/.test(id) || /\s/.test(secret)) throw new ValidationError("Each value is one line with no spaces. Copy it again.");
  if (secret.length < 10 || secret.length > 300) throw new ValidationError("That doesn't look like a whole client secret. Copy it again.");
  if (secret === id) throw new ValidationError("The client secret is the same as the client ID. Copy the secret again.");
  if (provider === "google") {
    if (!/^[0-9]+-[a-z0-9_]+\.apps\.googleusercontent\.com$/i.test(id)) {
      throw new ValidationError("A Google client ID ends in .apps.googleusercontent.com. Copy it from Credentials in Google Cloud.");
    }
    if (secret.endsWith(".apps.googleusercontent.com")) throw new ValidationError("That's the client ID again. The secret is the other value (it usually starts with GOCSPX-).");
  } else {
    if (!GUID.test(id)) {
      throw new ValidationError("A Microsoft client ID looks like 1a2b3c4d-1234-5678-9abc-1234567890ab. Copy \"Application (client) ID\" from the app's Overview.");
    }
    if (GUID.test(secret)) {
      throw new ValidationError("That's the secret's ID. Copy the secret's Value instead (Microsoft shows it only once, right after you make it).");
    }
  }
}

// ---- What the screen sees ----

function serviceState(service: Service, source: "saved" | "server" | "none", serverHas: boolean, secretInUse: string): PlatformServiceState {
  const s = savedInfo(service);
  return {
    state: source,
    serverHas,
    last4: source === "saved" ? (s.last4 ?? "") : source === "server" ? secretInUse.slice(-4) : "",
    savedAt: s.updatedAt ?? "",
    savedBy: s.updatedBy ?? "",
    problem: s.problem,
  };
}

function publicWarning(base: string): string {
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
    return `This server's address is a local one (${base}), so sign-in will only work on this computer. Set PUBLIC_URL to its public https address.`;
  }
  if (!base.startsWith("https://")) return "Google and Microsoft only accept https:// addresses. Give this server an https address first.";
  return "";
}

const envServer = (a: string, b: string) => Boolean((process.env[a] ?? "").trim() && (process.env[b] ?? "").trim());

export async function platformSettings(ctx: Ctx): Promise<PlatformSettings> {
  await refresh();
  const mail = mailConfig();
  const g = oauthClient("google");
  const m = oauthClient("microsoft");
  const base = redirectBase();
  const mailbox = await mailboxSignInAllowed();
  await brokerStatus();
  return {
    mail: {
      ...serviceState("mail", mail.source, envServer("SMTP_URL", "MAIL_FROM"), last4OfSmtp(mail.smtpUrl)),
      host: smtpHost(mail.smtpUrl),
      from: mail.from,
    },
    google: { ...serviceState("google", g.source, envServer("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"), g.clientSecret), clientId: g.clientId, redirectUri: redirectUri("google"), scopes: await requestedScopes("google"), mailboxSignIn: mailbox.google },
    microsoft: {
      ...serviceState("microsoft", m.source, envServer("MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"), m.clientSecret),
      clientId: m.clientId,
      redirectUri: redirectUri("microsoft"),
      scopes: await requestedScopes("microsoft"),
      mailboxSignIn: mailbox.microsoft,
    },
    // The setup site's shared Google / Microsoft app (server/broker.ts): in use for a provider with no app of its own saved.
    shared: { configured: brokerConfig() !== null, google: usesSharedApp("google", "calendar"), microsoft: usesSharedApp("microsoft", "calendar") },
    publicBase: base,
    publicWarning: publicWarning(base),
    testTo: ctx.user.email,
  };
}

// ---- Saving ----

async function save(ctx: Ctx, service: Service, input: any): Promise<void> {
  await fresh();
  if (service === "mail") {
    // An empty address box keeps the saved one (it holds the password, so it's never sent back).
    const smtpUrl = checkSmtpUrl(text(input?.smtpUrl) || savedSecret("mail"));
    const from = checkFrom(text(input?.from, 200));
    await saveMail({ smtpUrl, from }, ctx.user.email);
    await audit(ctx, "platform_settings.save", { service, host: smtpHost(smtpUrl), last4: last4OfSmtp(smtpUrl) });
    return;
  }
  const clientId = text(input?.clientId, 300);
  const clientSecret = text(input?.clientSecret, 300) || savedSecret(service);
  checkClient(service, clientId, clientSecret);
  await saveOAuth(service, { clientId, clientSecret }, ctx.user.email);
  await audit(ctx, "platform_settings.save", { service, last4: clientSecret.slice(-4) });
}

// ---- Testing ----

function mailError(err: any, smtpUrl: string, from: string): string {
  const u = new URL(smtpUrl);
  const port = u.port || (u.protocol === "smtps:" ? "465" : "587");
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "");
  if (code === "EDNS" || /ENOTFOUND|EAI_AGAIN/.test(msg)) return `Couldn't find a mail server called ${u.hostname}. Check the server name.`;
  if (code === "EAUTH") return `${u.hostname} didn't accept the username and password. Check them, or make new SMTP credentials.`;
  if (/wrong version number|ssl3_get_record|unknown protocol/i.test(msg)) {
    return `Couldn't start a secure connection to ${u.hostname} on port ${port}. Use smtps:// with port 465, or smtp:// with port 587.`;
  }
  if (code === "ETIMEDOUT" || /timeout/i.test(msg)) return `${u.hostname} didn't answer on port ${port}. Check the port, and that this server is allowed to send mail out.`;
  if (code === "ECONNECTION" || code === "ESOCKET" || /ECONNREFUSED|ECONNRESET/.test(msg)) {
    return `Couldn't connect to ${u.hostname} on port ${port}. Check the server name and port.`;
  }
  if (code === "EENVELOPE" || err?.responseCode) {
    return `The mail server wouldn't send from ${from}: ${String(err?.response ?? msg).slice(0, 200)}. Check that this sender is verified with your email provider.`;
  }
  return `The mail server said: ${msg.slice(0, 200) || "an unknown error"}.`;
}

async function test(ctx: Ctx, service: Service, input: any): Promise<PlatformTestResult> {
  countCheck(`platform-settings:${ctx.user.id}`);
  await fresh();
  if (service === "mail") {
    // The boxes on screen if filled in, else what's in use now.
    const current = mailConfig();
    const smtpUrl = checkSmtpUrl(text(input?.smtpUrl) || current.smtpUrl);
    const from = checkFrom(text(input?.from, 200) || current.from);
    const t = testTransport(smtpUrl);
    try {
      await t.verify();
      await t.sendMail({
        from,
        to: ctx.user.email,
        subject: "Test email from your dashboard",
        text: `This is a test from Settings, "Email and calendars".\n\nIf you're reading it, invites, password resets and booking emails will reach people.\n\nSent through ${smtpHost(smtpUrl)} from ${from}.`,
      });
    } catch (err) {
      throw new ValidationError(mailError(err, smtpUrl, from));
    } finally {
      t.close();
    }
    return { ok: true, message: `Connected to ${smtpHost(smtpUrl)} and sent a test email to ${ctx.user.email}.` };
  }
  const current = oauthClient(service);
  const clientId = text(input?.clientId, 300) || current.clientId;
  const clientSecret = text(input?.clientSecret, 300) || current.clientSecret;
  checkClient(service, clientId, clientSecret);
  return {
    ok: true,
    message: `These look right. Make sure your ${NAME[service]} app lists this redirect URI exactly:`,
    redirectUri: redirectUri(service),
  };
}

// ---- Routes ----

export async function platformSettingsRoutes(req: Request, path: string, method: string, ctx: Ctx): Promise<Response | null> {
  if (path !== "/api/admin/platform-settings" && !path.startsWith("/api/admin/platform-settings/")) return null;
  requirePlatformOwner(ctx);
  if (path === "/api/admin/platform-settings") return method === "GET" ? json(await platformSettings(ctx)) : null;
  const m = path.match(/^\/api\/admin\/platform-settings\/(mail|google|microsoft)(\/test)?$/);
  if (!m) return null;
  const service = m[1] as Service;
  if (m[2]) return method === "POST" ? json(await test(ctx, service, await readBody(req))) : null;
  if (method === "PUT") {
    await save(ctx, service, await readBody(req));
    return json(await platformSettings(ctx));
  }
  if (method === "DELETE") {
    await clearSaved(service);
    await audit(ctx, "platform_settings.clear", { service });
    return json(await platformSettings(ctx));
  }
  return null;
}
