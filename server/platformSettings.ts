import { putSetting } from "./store";
import { sql } from "./db";
import { seal, unseal } from "./secrets";

// Settings the platform admin can change from the dashboard (Settings, "Email and
// calendars") instead of editing the server's environment: the account-email
// sender and the Google and Microsoft sign-in apps. Kept in app_settings, with the
// secret parts sealed (secrets.ts).
//
// What's saved here wins, service by service. With nothing saved for a service,
// the environment variables are used exactly as before (SMTP_URL, MAIL_FROM,
// GOOGLE_*, MICROSOFT_*), so existing servers behave the same.
//
// mailer.ts and oauth.ts read the current values through current(): it answers
// straight away from memory and refreshes from the database in the background
// every few seconds, so a change saved on any server is picked up without a
// restart. A save on this server updates the memory at once.

export type Service = "mail" | "google" | "microsoft";
export const SERVICES: Service[] = ["mail", "google", "microsoft"];

export type MailConfig = { smtpUrl: string; from: string };
export type OAuthClient = { clientId: string; clientSecret: string };

// As kept in app_settings.
type StoredMail = { smtpUrl: string; from: string; last4: string; updatedAt: string; updatedBy: string };
type StoredOAuth = { clientId: string; clientSecret: string; last4: string; updatedAt: string; updatedBy: string };

type Saved<T> = { value: T | null; meta: { last4: string; updatedAt: string; updatedBy: string } | null; problem: string };
type Snapshot = { mail: Saved<MailConfig>; google: Saved<OAuthClient>; microsoft: Saved<OAuthClient> };

const KEY: Record<Service, string> = { mail: "platform_mail", google: "platform_oauth_google", microsoft: "platform_oauth_microsoft" };
const UNREADABLE = "The saved secret can't be read on this server (its MAILBOX_KEY is different). Paste it again.";
const FRESH_MS = 10_000;

const empty = <T>(): Saved<T> => ({ value: null, meta: null, problem: "" });
let snapshot: Snapshot = { mail: empty(), google: empty(), microsoft: empty() };
let loadedAt = 0;
let loading: Promise<void> | null = null;

function open<T>(raw: any, build: (secret: string) => T, sealedField: string): Saved<T> {
  if (!raw || typeof raw !== "object") return empty();
  const meta = { last4: String(raw.last4 ?? ""), updatedAt: String(raw.updatedAt ?? ""), updatedBy: String(raw.updatedBy ?? "") };
  try {
    return { value: build(unseal(String(raw[sealedField]))), meta, problem: "" };
  } catch {
    return { value: null, meta, problem: UNREADABLE };
  }
}

async function load(): Promise<void> {
  const rows = await sql`select key, value from app_settings where key in (${KEY.mail}, ${KEY.google}, ${KEY.microsoft})`;
  const by = new Map<string, any>(rows.map((r: any) => [r.key, r.value]));
  const m = by.get(KEY.mail) as StoredMail | undefined;
  const oauth = (s: Service) => {
    const r = by.get(KEY[s]) as StoredOAuth | undefined;
    return open(r, (secret) => ({ clientId: String(r!.clientId), clientSecret: secret }), "clientSecret");
  };
  snapshot = {
    mail: open(m, (url) => ({ smtpUrl: url, from: String(m!.from) }), "smtpUrl"),
    google: oauth("google"),
    microsoft: oauth("microsoft"),
  };
  loadedAt = Date.now();
}

/** Reads the saved settings again (shared by everyone asking at the same time). */
export function refresh(): Promise<void> {
  loading ??= load()
    .catch((err) => console.error("[platform settings]", (err as Error).message))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Waits for the settings to be current. For paths that are about to use them. */
export async function fresh(): Promise<void> {
  if (Date.now() - loadedAt > FRESH_MS) await refresh();
}

function saved(): Snapshot {
  if (Date.now() - loadedAt > FRESH_MS) void refresh();
  return snapshot;
}

const env = (name: string) => (process.env[name] ?? "").trim();

/** The mail settings in use: the saved ones, else the server's environment. */
export function mailConfig(): MailConfig & { source: "saved" | "server" | "none" } {
  const s = saved().mail.value;
  if (s) return { ...s, source: "saved" };
  const e = { smtpUrl: env("SMTP_URL"), from: env("MAIL_FROM") };
  return { ...e, source: e.smtpUrl && e.from ? "server" : "none" };
}

/** The Google or Microsoft sign-in app in use: the saved one, else the environment. */
export function oauthClient(provider: "google" | "microsoft"): OAuthClient & { source: "saved" | "server" | "none" } {
  const s = saved()[provider].value;
  if (s) return { ...s, source: "saved" };
  const p = provider === "google" ? "GOOGLE" : "MICROSOFT";
  const e = { clientId: env(`${p}_CLIENT_ID`), clientSecret: env(`${p}_CLIENT_SECRET`) };
  return { ...e, source: e.clientId && e.clientSecret ? "server" : "none" };
}

/** What the settings screen may show about a saved service: never the secret itself. */
export function savedInfo(service: Service) {
  const s = snapshot[service];
  return { saved: Boolean(s.meta), ...s.meta, problem: s.problem };
}

/** The previously saved secret, so a save can keep it when the box is left empty. */
export function savedSecret(service: Service): string {
  const v = snapshot[service].value;
  if (!v) return "";
  return "smtpUrl" in v ? v.smtpUrl : v.clientSecret;
}

export async function saveMail(input: MailConfig, by: string): Promise<void> {
  const record: StoredMail = { smtpUrl: seal(input.smtpUrl), from: input.from, last4: last4OfSmtp(input.smtpUrl), updatedAt: new Date().toISOString(), updatedBy: by };
  await putSetting(KEY.mail, record);
  await load();
}

export async function saveOAuth(provider: "google" | "microsoft", input: OAuthClient, by: string): Promise<void> {
  const record: StoredOAuth = {
    clientId: input.clientId,
    clientSecret: seal(input.clientSecret),
    last4: input.clientSecret.slice(-4),
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  };
  await putSetting(KEY[provider], record);
  await load();
}

/** Forgets what was saved here, so the server's environment is used again. */
export async function clearSaved(service: Service): Promise<void> {
  await sql`delete from app_settings where key = ${KEY[service]}`;
  await load();
}

// The SMTP address holds the password; what's shown is the last 4 of the password.
export function last4OfSmtp(smtpUrl: string): string {
  try {
    return decodeURIComponent(new URL(smtpUrl).password).slice(-4);
  } catch {
    return "";
  }
}

/** The mail server's address without the username or password, safe to show. */
export function smtpHost(smtpUrl: string): string {
  try {
    const u = new URL(smtpUrl);
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return "";
  }
}
