// The wizard's engine: one state machine per buyer, kept in SQLite, so any number of
// buyers can be part-way through at once and a closed tab (or a restarted site) loses nothing.
//   actions   one function per form the buyer can submit
//   tick()    background work (build on Railway, add the custom domain, watch DNS, watch Resend)
import { randomBytes } from "node:crypto";
import { CONFIG, currentPackage, db, listPackages, now, type Buyer } from "./lib";
import {
  ProviderError, cfCanEdit, cfEnsure, cfFindZone, cfRecords, cfZone, checkCloudflare,
  checkGoogle, checkMicrosoft, checkRailway, checkResend, checkOpenRouter, checkSmtp, checkTelnyx, checkTwilio, checkVapi, listTelnyxNumbers, lookup, normalizeDomain,
  RAILWAY_API, RAILWAY_TOKEN_MSG, publicSmtpAddress, railway, railwayUpload, recordLive, resendDomain, resendSend, resendSendingKey, resendStatus, resendVerify, smtpSend, smtpUrl,
} from "./providers";
import {
  STEPS, OPTIONAL_HUB, isOptional, deleteAllSecrets, getSecret, getSetup, hasSecret,
  logAppend, logClear, logRead, putSecret, redact, saveSetup, secretValues, updateSetup,
  activeSetups, deleteSecret, staleSecretBuyers, type DnsRecord, type SetupData, type StepId,
} from "./store";
import { SYNC_URL, latestSnapshot, newSyncToken } from "./sync";
import { brokerOn } from "./broker";
import { appSource } from "./releases";
import { createProjectToken, RailwayError } from "./railwayUp";
import { railwayToken, telnyxKeyFrom, type OAuthProvider, type Tokens } from "./oauth";
import { asAdmin } from "./ctx";
import { checkGoDaddy, cloudflareWriter, dnsKeyMissing, godaddyExisting, godaddyWriter, writerFor, type DnsWriter } from "./dns";

const MIN = 60_000;
const ago = (iso?: string) => (iso ? Date.now() - Date.parse(iso) : Infinity);
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isEmail = (v: string) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) && v.length <= 200;
const LOGO_MAX = 30_000; // characters of PNG data URL: it rides along as one setting (the settings ride along as one variable)
const pngBytes = (dataUrl: string) => { try { const b = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"); return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; } catch { return false; } };
const errMsg = (e: unknown) => (e instanceof ProviderError ? e.message : "Something went wrong on our side. Try again in a minute.");
const safeLog = (where: string, e: unknown) => console.error(`[setup] ${where}: ${e instanceof ProviderError ? `provider error ${e.status} ${e.code}` : (e as Error)?.name || "error"}`);

export type Flash = NonNullable<SetupData["flash"]>;
const ok = (text: string): Flash => ({ kind: "ok", text });
const err = (text: string, form?: Record<string, string>): Flash => ({ kind: "err", text, form });

// ---------------- rate limits (per buyer, in memory) ----------------
const buckets = new Map<string, number[]>();
const LONGEST_WINDOW = 24 * 3600_000; // the longest window any caller uses
let lastSweep = 0;
/** Drops buckets nobody has touched for a day. Without this every address that ever hit the site (scanners too) stays in memory. */
export function sweepBuckets(t = Date.now()): number {
  lastSweep = t;
  let n = 0;
  for (const [k, arr] of buckets) if (!arr.length || t - arr[arr.length - 1] > LONGEST_WINDOW) { buckets.delete(k); n++; }
  return n;
}
export const bucketCount = () => buckets.size;
export function allow(key: string, max: number, windowMs: number): number {
  const t = Date.now();
  if (buckets.size > 2000 && t - lastSweep > 60_000) sweepBuckets(t);
  const arr = (buckets.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return Math.ceil((arr[0] + windowMs - t) / 1000); }
  arr.push(t); buckets.set(key, arr);
  return 0;
}
const tooMany = (secs: number) => err(`You've tried that a lot in a short time. Please wait ${secs > 90 ? `${Math.ceil(secs / 60)} minutes` : `${secs} seconds`} and try again.`);
const checkLimit = (b: Buyer) => (asAdmin.getStore() ? 0 : allow(`check:${b.id}`, CONFIG.checksPer10Min, 10 * MIN)); // our admin has their own limit (assist.ts)

// ---------------- steps ----------------
export function stepDone(b: Buyer, s: SetupData, id: StepId): boolean {
  switch (id) {
    case "welcome": return s.step !== "welcome" || !!s.brand;
    case "brand": return !!s.brand;
    case "domain": return (!!s.domain?.confirmed && !!s.domain.host) || !!s.skipped?.domain;
    case "railway": return !!s.railway?.confirmed && (b.demo === 1 || hasSecret(b.id, "railway_token") || s.phase !== "idle");
    // Voice is required on Railway: a Telnyx or Vapi key that passed its check (or an install already under way). "Not now" is not a way through.
    case "phones": return !!s.phones?.confirmed || !!s.vapi?.confirmed || s.phase !== "idle";
    case "vapi": return !!s.vapi?.confirmed || !!s.skipped?.vapi;
    case "twilio": return !!s.twilio?.confirmed || !!s.skipped?.twilio;
    case "email": return !!s.email?.confirmed || !!s.skipped?.email;
    case "calendars": return !!s.calendars?.done || !!s.skipped?.calendars;
    // AI is required: a key that passed its check (it is only stored after it does), or an install already under way.
    case "ai": return (!!s.ai?.confirmed && (b.demo === 1 || hasSecret(b.id, "openrouter_key"))) || s.phase !== "idle";
    case "extras": return !!s.extrasDone;
    case "install": return s.phase === "done";
    case "done": return s.phase === "done";
  }
}
/** The first step still to do. Optional steps never hold anyone up. */
export const firstOpen = (b: Buyer, s: SetupData): StepId => STEPS.find((id) => !isOptional(id) && !stepDone(b, s, id)) || "done";
/** An optional step opens from the extras screen, so it's viewable as soon as extras is. */
// An install under way, or a finished one, always shows its own screen, whatever else is (or isn't) stored on the earlier steps.
export const canView = (b: Buyer, s: SetupData, id: StepId) => CONFIG.previewJump || (s.phase !== "idle" && (id === "install" || id === "done")) || STEPS.indexOf(isOptional(id) ? OPTIONAL_HUB : id) <= STEPS.indexOf(firstOpen(b, s));
/** Settings are baked into the server when it's made; after that they can't change here. */
export const locked = (s: SetupData) => s.phase !== "idle";
const nextStep = (b: Buyer, s: SetupData, from: StepId) => {
  // Finishing (or skipping) an optional step goes back to the extras screen.
  if (isOptional(from)) { s.step = s.moved = OPTIONAL_HUB; return; }
  const i = STEPS.indexOf(from);
  s.step = s.moved = STEPS.slice(i + 1).find((id) => !isOptional(id) && (!stepDone(b, s, id) || id === "done")) || "done";
};

/** Telnyx is the default; Vapi only when the buyer added it as the backup option (or an older setup chose it). */
export const useVapi = (s: SetupData) => !!s.vapi?.confirmed || s.phones?.provider === "vapi";
/** The buyer skipped the phone provider: the app is installed with no voice key and they connect it in their dashboard (Connections). */
export const phoneSkipped = (s: SetupData) => !!s.skipped?.phones && !s.phones?.confirmed && !s.vapi?.confirmed;
/** The words for it, on the step list, the install summary and the Done screen. */
export const PHONE_LATER = "Not connected yet — connect it in your dashboard (Connections)";
export const twilioSidOf = (s: SetupData) => s.twilio?.sid || s.phones?.twilioSid || "";
export const zoneOf = (s: SetupData) => s.domain?.zone || "";
export const hostOf = (s: SetupData) => s.domain?.host || "";
export const oauthRedirect = (s: SetupData, p: "google" | "microsoft") => `https://${hostOf(s) || "app.your-domain"}/api/oauth/${p}/callback`;
/** Where the finished agency answers: the buyer's own domain if they added one, else Railway's own address. */
/** The address of their running app, for calling it ("Sync now", "View as", owner reset): their own domain once it works, else Railway's. */
export const appUrlOf = (s: SetupData) => (s.phase !== "done" ? "" : s.domainPending && s.tempUrl ? s.tempUrl : agencyUrl(s));
export const agencyUrl = (s: SetupData) => (hostOf(s) ? `https://${hostOf(s)}` : s.resultUrl || s.tempUrl || webUrl(s.rw?.serviceDomain));
/** Railway's own address for the app: https, except the local fake (localhost:<port>). */
export const webUrl = (domain?: string) => (!domain ? "" : /^(localhost|127\.)/.test(domain) ? `http://${domain}` : `https://${domain}`);

// ======================= actions =======================
type Form = Record<string, string>;
export type Action = (b: Buyer, f: Form) => Promise<Flash | null> | Flash | null;

/** Email through Resend and calendar sign-in both need the buyer's own domain. Nothing else does. */
function extrasProblem(b: Buyer, s: SetupData): string | null {
  if (hostOf(s) || b.demo === 1) return null;
  if (s.email?.mode === "resend" && s.email.confirmed) return "Email through Resend sends from your own domain, so add your domain too, or skip Email for now.";
  if (s.calendars?.google || s.calendars?.microsoft) return "Calendar sign-in needs your own domain, so add your domain too, or skip Calendars for now.";
  return null;
}

/** Telnyx is needed, unless the buyer switched to Vapi in the backup options. */
function phonesProblem(b: Buyer, s: SetupData): string | null {
  if (s.phones?.confirmed || s.vapi?.confirmed) return null;
  return "Choose a voice provider first: connect Telnyx or Vapi on the Voice step.";
}

const LOCKED_MSG = "Your server has already been made with these settings. To change them, delete the server on the Install step first.";
function guard(b: Buyer, step: StepId): Flash | null {
  const s = getSetup(b.id);
  if (s.phase === "done") return err("Your install is finished.");
  if (step !== "install" && locked(s)) return err(LOCKED_MSG);
  if (!canView(b, s, step) && !asAdmin.getStore()) return err("Finish the earlier steps first.");
  return null;
}
const go = (b: Buyer, from: StepId) => updateSetup(b.id, (s) => nextStep(b, s, from));

// ---- what saving a step does: shared by the paste forms and "Login with ..." (oauthComplete) ----
const OAUTH_RAILWAY_MSG = "Railway let you in, but we couldn't use that login. Try again, or paste a Railway token instead.";

/** Railway: check the login, keep it (an OAuth login also keeps its refresh token), go on. */
async function saveRailway(b: Buyer, token: string, via: "oauth" | "paste", tokens?: Tokens): Promise<Flash | null> {
  const r = await checkRailway(token);
  if (!r.ok) return err(via === "oauth" && r.message === RAILWAY_TOKEN_MSG ? OAUTH_RAILWAY_MSG : r.message);
  putSecret(b.id, "railway_token", token);
  if (tokens?.refresh) putSecret(b.id, "railway_refresh", tokens.refresh); else deleteSecret(b.id, "railway_refresh");
  const expiresAt = via === "oauth" && tokens?.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : undefined;
  // On a free trial (or a plan we can't read) stay on the Hosting step, so the warning is read before they go on; "Continue" then moves on.
  const warn = r.trial || !r.planKnown;
  updateSetup(b.id, (s) => {
    s.railway = { via, expiresAt, email: r.email, workspaceId: r.workspace.id, workspaceName: r.workspace.name, plan: r.workspace.plan, trial: r.trial || undefined, planUnknown: !r.planKnown || undefined, confirmed: true };
    if (!warn) nextStep(b, s, "railway");
  });
  return null;
}

/**
 * Telnyx: check the key (pretrial keeps the key so "Check again" works), keep it, read the numbers already on the
 * account. Stays on the Voice step: the buyer sees those numbers, then presses Continue.
 */
async function telnyxAttempt(b: Buyer, key: string, via: "oauth" | "paste", keep?: Form): Promise<Flash | null> {
  const r = await checkTelnyx(key);
  if (!r.ok && r.pretrial) { putSecret(b.id, "telnyx_key", key); updateSetup(b.id, (s) => { s.phones = { ...s.phones, checked: true, confirmed: false }; }); return err(r.message); }
  if (!r.ok) return err(r.message, keep);
  return saveTelnyx(b, key, r.balance, via);
}
async function saveTelnyx(b: Buyer, key: string, balance: string, via: "oauth" | "paste"): Promise<Flash | null> {
  putSecret(b.id, "telnyx_key", key);
  const numbers = await listTelnyxNumbers(key);
  updateSetup(b.id, (s) => {
    s.brand!.ownPhoneAccount = false;
    s.phones = { ...s.phones, via, numbers, numbersAt: now(), balance, checked: true, confirmed: true, provider: "telnyx", deferred: undefined };
    if (s.skipped) delete s.skipped.phones;
  });
  return null;
}

/** OpenRouter: check the key, keep it, go on. */
async function saveOpenRouter(b: Buyer, key: string, via: "oauth" | "paste"): Promise<Flash | null> {
  const r = await checkOpenRouter(key);
  if (!r.ok) return err(r.message);
  putSecret(b.id, "openrouter_key", key);
  // Stays on the step so the buyer sees "OpenRouter connected" and presses Continue (like Voice and Hosting).
  updateSetup(b.id, (s) => { s.ai = { confirmed: true, via }; if (s.skipped) delete s.skipped.ai; });
  return null;
}

/** The step each "Login with ..." belongs to. */
export const OAUTH_STEP: Record<OAuthProvider, StepId> = { railway: "railway", telnyx: "phones", openrouter: "ai" };
/** May this buyer start a login for that provider now? (Same rule as the step's own form.) Null when yes. */
export const oauthGuard = (b: Buyer, p: OAuthProvider): Flash | null => guard(b, OAUTH_STEP[p]);
/** A login came back with a token: do what the step's paste form would do with it. */
export async function oauthComplete(b: Buyer, p: OAuthProvider, t: Tokens): Promise<Flash | null> {
  const g = oauthGuard(b, p); if (g) return g;
  const wait = checkLimit(b); if (wait) return tooMany(wait);
  try {
    if (p === "railway") return await saveRailway(b, t.access, "oauth", t);
    if (p === "openrouter") return await saveOpenRouter(b, t.access, "oauth");
    // Telnyx: an OAuth token runs out and the app needs a key that doesn't, so ask Telnyx for one with it.
    const key = await telnyxKeyFrom(t.access);
    if (!key) return err("Telnyx let you in, but wouldn't make the key your agency needs. Paste a Telnyx API key instead.");
    return await telnyxAttempt(b, key, "oauth");
  } catch (e) { safeLog("oauth", e); return err(errMsg(e)); }
}

export const actions: Record<string, Action> = {
  start(b) {
    updateSetup(b.id, (s) => { if (s.step === "welcome") s.step = "brand"; });
    return null;
  },

  // ---- Brand ----
  brand(b, f) {
    const g = guard(b, "brand"); if (g) return g;
    const productName = str(f.productName, 60).replace(/[\r\n]/g, " ");
    const ownerEmail = str(f.ownerEmail, 200).toLowerCase();
    const ownerName = str(f.ownerName, 80).replace(/[\r\n]/g, " ");
    const keep = { productName: f.productName || "", ownerEmail: f.ownerEmail || "", ownerName: f.ownerName || "" };
    if (!productName) return err("Give your brand a name.", keep);
    if (!isEmail(ownerEmail)) return err("Enter a real email address.", keep);
    // The logo arrives already shrunk by the page (wizard.js) as a PNG data URL. It travels to the
    // agency's own server as one setting, so it has to stay small.
    let logo: string | undefined;
    if (f.logo) {
      if (f.logo.length > LOGO_MAX) return err("That logo is too big to send. Choose a smaller picture, or leave the logo out and add it later in Settings.", keep);
      if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(f.logo) || !pngBytes(f.logo)) return err("We couldn't read that logo. Choose a PNG or JPG picture, or leave it out and add it later in Settings.", keep);
      logo = f.logo;
    }
    updateSetup(b.id, (s) => {
      if (!logo && f.removeLogo !== "1") logo = s.brand?.logo;
      // 1 to 3 brand colours (the first is the main one); the 2nd and 3rd only count when their box is ticked.
      const hex = (v?: string) => (/^#[0-9a-fA-F]{6}$/.test(v || "") ? (v as string).toLowerCase() : "");
      const picked = [hex(f.colour), f.colour2on === "1" ? hex(f.colour2) : "", f.colour3on === "1" ? hex(f.colour3) : ""].filter(Boolean);
      const colours = picked.length ? [...new Set(picked)] : s.brand?.colours || (s.brand?.colour ? [s.brand.colour] : undefined);
      const colour = colours?.[0];
      const theme = f.theme === "dark" ? "dark" : f.theme === "light" ? "light" : s.brand?.theme;
      s.brand = { productName, ownerEmail, ...(ownerName ? { ownerName } : {}), ownPhoneAccount: false, logo, colour, colours, theme }; nextStep(b, s, "brand");
    });
    return null;
  },

  // ---- Domain: type it, choose who handles DNS, (Cloudflare) paste a token ----
  async domain(b, f) {
    const g = guard(b, "domain"); if (g) return g;
    return domainRailway(b, f);
  },
  "domain-continue"(b) {
    const g = guard(b, "domain"); if (g) return g;
    const s = getSetup(b.id);
    if (!s.domain?.host) return err("Type your domain first.");
    updateSetup(b.id, (s) => { s.domain!.confirmed = true; nextStep(b, s, "domain"); });
    return null;
  },
  "domain-edit"(b) {
    const g = guard(b, "domain"); if (g) return g;
    updateSetup(b.id, (s) => { if (s.domain) { s.domain.confirmed = false; if (s.domain.mode === "manual") delete s.domain.host; if (s.domain.cf) s.domain.cf = { zones: s.domain.cf.zones }; } });
    return null;
  },
  async "cf-recheck"(b) {
    const g = guard(b, "domain"); if (g) return g;
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    const s = getSetup(b.id);
    if (!s.domain?.cf?.zoneId) return err("Type your domain first.");
    return applyZone(b.id, s.domain.cf.zoneId, s.domain.sub, !!s.domain.cf.replace);
  },

  // ---- Railway: "Login with Railway" (oauthComplete), or an account token; we check it and the plan ----
  async railway(b, f) {
    const g = guard(b, "railway"); if (g) return g;
    const token = str(f.token, 300) || getSecret(b.id, "railway_token") || "";
    if (!token) return err("Paste your Railway token.");
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    return saveRailway(b, token, "paste");
  },

  // ---- Phones: Telnyx is the main path. The buyer's key is the app's main phone key ----
  async phones(b, f) {
    const g = guard(b, "phones"); if (g) return g;
    const key = str(f.key, 300) || getSecret(b.id, "telnyx_key") || "";
    if (!key) return err("Paste your Telnyx API key.", f);
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    return telnyxAttempt(b, key, "paste", f);
  },
  // No Telnyx account yet: go on to the backup options (Vapi) instead. Install still needs one of the two.
  "phones-backup"(b) {
    const g = guard(b, "phones"); if (g) return g;
    updateSetup(b.id, (s) => { s.phones = { ...s.phones, deferred: true }; s.step = "phones"; });
    return null;
  },

  // ---- Phones, the second option: Vapi for voice and Twilio for numbers and texts, both on this step ----
  // Same checks as the backup steps (checkVapi, checkTwilio). Counts as the phone step being done.
  async "phones-vapi"(b, f) {
    const g = guard(b, "phones"); if (g) return g;
    const s0 = getSetup(b.id);
    const vKey = str(f.vapiKey, 300) || getSecret(b.id, "vapi_key") || "";
    const vPublic = str(f.vapiPublic, 300) || getSecret(b.id, "vapi_public") || "";
    const sid = str(f.twilioSid, 60) || s0.twilio?.sid || "";
    const token = str(f.twilioToken, 300) || getSecret(b.id, "twilio_token") || "";
    const keep = { vapiPublic: str(f.vapiPublic, 300), twilioSid: str(f.twilioSid, 60) };
    if (!vKey) return err("Paste your Vapi private API key.", keep);
    if (!vPublic) return err("Paste your Vapi public key too.", keep);
    // Twilio is optional: Vapi alone runs the receptionist (browser test calls); Twilio adds numbers and texts.
    const withTwilio = !!(sid || token);
    if (withTwilio && !sid) return err("Paste your Twilio Account SID too, or leave both Twilio boxes empty.", keep);
    if (withTwilio && !token) return err("Paste your Twilio Auth Token too, or leave both Twilio boxes empty.", keep);
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    const r = await checkVapi(vKey, vPublic);
    if (!r.ok) return err(r.message, keep);
    if (withTwilio) { const w = await checkTwilio(sid, token); if (!w.ok) return err(w.message, keep); }
    putSecret(b.id, "vapi_key", vKey);
    putSecret(b.id, "vapi_public", vPublic);
    if (withTwilio) putSecret(b.id, "twilio_token", token);
    // With Telnyx connected, Vapi is added as the backup engine and Telnyx stays the main one. Without it, Vapi runs alone.
    const withTelnyx = !!s0.phones?.confirmed;
    if (!withTelnyx) deleteSecret(b.id, "telnyx_key");
    updateSetup(b.id, (s) => {
      s.brand!.ownPhoneAccount = false;
      s.vapi = { confirmed: true };
      if (withTwilio) s.twilio = { sid, confirmed: true };
      s.phones = withTelnyx ? { ...s.phones } : { checked: true, provider: "vapi" };
      if (s.skipped) { delete s.skipped.vapi; delete s.skipped.twilio; delete s.skipped.phones; }
      nextStep(b, s, "phones");
    });
    return null;
  },
  /** Back to Telnyx: forget the Vapi and Twilio keys and stay on the Phones step. */
  "phones-vapi-remove"(b) {
    const g = guard(b, "phones"); if (g) return g;
    for (const n of ["vapi_key", "vapi_public", "twilio_token"] as const) deleteSecret(b.id, n);
    updateSetup(b.id, (s) => {
      delete s.vapi; delete s.twilio;
      s.phones = { ...s.phones, provider: "telnyx" };
      s.step = "phones";
    });
    return null;
  },

  /** Voice step, "Choose a different provider": forget the Telnyx and Vapi keys and show the three choices again. Twilio (a separate extra) stays. */
  "phones-reset"(b) {
    const g = guard(b, "phones"); if (g) return g;
    for (const n of ["telnyx_key", "vapi_key", "vapi_public"] as const) deleteSecret(b.id, n);
    updateSetup(b.id, (s) => {
      delete s.vapi;
      if (s.skipped) { delete s.skipped.phones; delete s.skipped.vapi; }
      s.phones = undefined;
      s.step = "phones";
    });
    return null;
  },

  // ---- Backup option: Vapi instead of Telnyx for voice (added from the last optional screen) ----
  async vapi(b, f) {
    const g = guard(b, "vapi"); if (g) return g;
    // Vapi: a private and a public key. Nothing from Telnyx is asked for on this path.
    const vKey = str(f.vapiKey, 300) || getSecret(b.id, "vapi_key") || "";
    const vPublic = str(f.vapiPublic, 300) || getSecret(b.id, "vapi_public") || "";
    if (!vKey) return err("Paste your Vapi private API key.", f);
    if (!vPublic) return err("Paste your Vapi public key too.", f);
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    const r = await checkVapi(vKey, vPublic);
    if (!r.ok) return err(r.message, f);
    putSecret(b.id, "vapi_key", vKey);
    putSecret(b.id, "vapi_public", vPublic);
    updateSetup(b.id, (s) => {
      s.brand!.ownPhoneAccount = false;
      s.vapi = { confirmed: true };
      s.phones = { ...s.phones, provider: "vapi" };
      if (s.skipped) { delete s.skipped.vapi; delete s.skipped.phones; }
      nextStep(b, s, "vapi");
    });
    return null;
  },
  "vapi-skip"(b) {
    const g = guard(b, "vapi"); if (g) return g;
    deleteSecret(b.id, "vapi_key"); deleteSecret(b.id, "vapi_public");
    updateSetup(b.id, (s) => {
      delete s.vapi;
      if (s.phones) s.phones = { ...s.phones, provider: "telnyx" };
      s.skipped = { ...s.skipped, vapi: true };
      nextStep(b, s, "vapi");
    });
    return null;
  },
  // ---- Backup option: a Twilio account for numbers and follow-up texts (works with Vapi) ----
  async twilio(b, f) {
    const g = guard(b, "twilio"); if (g) return g;
    const sid = str(f.twilioSid, 60) || getSetup(b.id).twilio?.sid || "";
    const token = str(f.twilioToken, 300) || getSecret(b.id, "twilio_token") || "";
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    const w = await checkTwilio(sid, token);
    if (!w.ok) return err(w.message, f);
    putSecret(b.id, "twilio_token", token);
    updateSetup(b.id, (s) => {
      s.twilio = { sid, confirmed: true };
      if (s.phones?.twilioSid) s.phones = { ...s.phones, twilioSid: undefined };
      if (s.skipped) delete s.skipped.twilio;
      nextStep(b, s, "twilio");
    });
    return null;
  },
  "twilio-skip"(b) {
    const g = guard(b, "twilio"); if (g) return g;
    deleteSecret(b.id, "twilio_token");
    updateSetup(b.id, (s) => {
      delete s.twilio;
      if (s.phones?.twilioSid) s.phones = { ...s.phones, twilioSid: undefined };
      s.skipped = { ...s.skipped, twilio: true };
      nextStep(b, s, "twilio");
    });
    return null;
  },

  // ---- Email (Resend; other SMTP behind a link) ----
  "email-mode"(b, f) {
    const g = guard(b, "email"); if (g) return g;
    updateSetup(b.id, (s) => { const mode = f.mode === "smtp" ? "smtp" : "resend"; if (s.email?.mode !== mode || f.reset === "1") s.email = { mode }; });
    return null;
  },
  async email(b, f) {
    const g = guard(b, "email"); if (g) return g;
    const s = getSetup(b.id);
    if (!s.domain?.confirmed) return emailBeforeDomain(b, f);
    const zone = zoneOf(s);
    const key = str(f.key, 300) || getSecret(b.id, "resend_key") || "";
    const address = (str(f.address, 200) || `hello@mail.${zone}`).toLowerCase();
    if (!key) return err("Paste your Resend API key.", f);
    if (!isEmail(address)) return err("Enter the address emails come from.", f);
    const sendingDomain = address.split("@")[1];
    if (sendingDomain !== zone && !sendingDomain.endsWith("." + zone)) return err(`Use an address on ${zone}, like hello@mail.${zone}.`, f);
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    const r = await checkResend(key);
    if (!r.ok) return err(r.message, f);
    putSecret(b.id, "resend_key", key);
    try {
      const d = await resendDomain(key, sendingDomain, zone);
      const dmarc: DnsRecord = { key: "dmarc", purpose: "Spoofing protection (DMARC)", type: "TXT", name: `_dmarc.${zone}`, value: "v=DMARC1; p=none;", ttl: "Auto" };
      let needDmarc = true;
      const writer = writerFor(b.id, s);
      if (writer) {
        needDmarc = !(await writer.hasDmarc(zone));
        for (const rec of d.records) rec.cfId = await writer.ensure(rec);
        if (needDmarc) dmarc.cfId = await writer.ensure(dmarc);
      } else {
        needDmarc = !(await lookup("TXT", dmarc.name, zone)).some((v) => /^v=DMARC1/i.test(v));
      }
      if (d.status !== "verified") await resendVerify(key, d.id).catch(() => {});
      updateSetup(b.id, (s) => {
        s.email = { mode: "resend", address, sendingDomain, from: `${s.brand!.productName} <${address}>`, checked: true, resend: { domainId: d.id, status: d.status === "verified" ? "verified" : "pending", records: d.records, dmarc: needDmarc ? dmarc : null, written: !!writer, verifyAt: now(), lastCheck: undefined } };
      });
      return null;
    } catch (e) { safeLog("email", e); return err(errMsg(e), f); }
  },
  async "email-recheck"(b) {
    const g = guard(b, "email"); if (g) return g;
    const wait = allow(`recheck:${b.id}`, 6, MIN); if (wait) return tooMany(wait);
    await checkEmailDns(b.id, true);
    return null;
  },
  async smtp(b, f) {
    const g = guard(b, "email"); if (g) return g;
    const host = str(f.host, 200).toLowerCase(), port = Number(f.port) || 587, user = str(f.user, 200);
    const pass = str(f.pass, 300) || getSecret(b.id, "smtp_password") || "";
    const address = str(f.address, 200).toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && !(CONFIG.mockResend && host === "127.0.0.1")) return err("Enter the SMTP server, like smtp.example.com.", f);
    if (![25, 465, 587, 2465, 2587].includes(port)) return err("The port is usually 587 or 465.", f);
    if (!user || !pass) return err("Enter the SMTP username and password.", f);
    if (!isEmail(address)) return err("Enter the address emails come from.", f);
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    const url = smtpUrl(host, port, user, pass);
    // The server's address is looked up once, must be a public one, and is the one connected to (no private or cloud-metadata addresses).
    const where = CONFIG.mockResend && host === "127.0.0.1" ? { ok: true as const, ip: "" } : await publicSmtpAddress(host);
    if (!where.ok) return err(where.message, { ...f, pass: "" });
    const r = await checkSmtp(url, where.ip || undefined);
    if (!r.ok) return err(r.message, { ...f, pass: "" });
    putSecret(b.id, "smtp_password", pass);
    const s = getSetup(b.id);
    const from = `${s.brand!.productName} <${address}>`;
    const sent = allow(`testmail:${b.id}`, CONFIG.testEmailsPerHour, 60 * MIN) ? null : await smtpSend(url, from, s.brand!.ownerEmail, s.brand!.productName, where.ip || undefined);
    updateSetup(b.id, (s) => {
      s.email = { mode: "smtp", address, from, smtp: { host, port, user }, checked: true, confirmed: true, testSentTo: sent?.ok ? s.brand!.ownerEmail : undefined };
      nextStep(b, s, "email");
    });
    return null;
  },
  async "email-test"(b) {
    const g = guard(b, "email"); if (g) return g;
    const s = getSetup(b.id);
    if (!s.email?.checked) return err("Connect your email first.");
    if (s.email.mode === "resend" && s.email.resend?.status !== "verified") return err("Resend hasn't verified your domain yet.");
    const wait = allow(`testmail:${b.id}`, CONFIG.testEmailsPerHour, 60 * MIN); if (wait) return tooMany(wait);
    const r = await sendTest(b.id);
    return r.ok ? ok(r.message) : err(r.message);
  },
  "email-continue"(b, f) {
    const g = guard(b, "email"); if (g) return g;
    const s = getSetup(b.id);
    if (!s.email?.checked) return err("Connect your email first.");
    if (s.email.mode === "resend" && s.email.resend?.status !== "verified" && f.later !== "1") return err("Resend hasn't verified your domain yet.");
    updateSetup(b.id, (s) => { s.email!.confirmed = true; nextStep(b, s, "email"); });
    return null;
  },

  // ---- Optional extras (Railway): email, your own domain, calendars. Each can be skipped. ----
  "email-skip"(b) {
    const g = guard(b, "email"); if (g) return g;
    deleteSecret(b.id, "resend_key"); deleteSecret(b.id, "smtp_password");
    updateSetup(b.id, (s) => { delete s.email; s.skipped = { ...s.skipped, email: true }; nextStep(b, s, "email"); });
    return null;
  },
  "domain-skip"(b) {
    const g = guard(b, "domain"); if (g) return g;
    const s = getSetup(b.id);
    if (s.email?.mode === "resend" && s.email.confirmed) return err("Email through Resend sends from your own domain, so it needs the domain's records. Either add your domain, or skip Email for now first.");
    if (s.calendars?.google || s.calendars?.microsoft) return err("Calendar sign-in needs your own domain. Either add your domain, or skip Calendars for now first.");
    deleteSecret(b.id, "cf_token");
    updateSetup(b.id, (s) => { delete s.domain; s.skipped = { ...s.skipped, domain: true }; nextStep(b, s, "domain"); });
    return null;
  },
  "extras-continue"(b) {
    const g = guard(b, "extras"); if (g) return g;
    const p = phonesProblem(b, getSetup(b.id)) || extrasProblem(b, getSetup(b.id)); if (p) return err(p);
    updateSetup(b.id, (s) => { s.extrasDone = true; nextStep(b, s, "extras"); });
    return null;
  },

  // ---- Calendars (optional): whatever is filled in is checked, one button ----
  async calendars(b, f) {
    const g = guard(b, "calendars"); if (g) return g;
    const s = getSetup(b.id);
    if (!hostOf(s) && (f.googleId || f.googleSecret || f.microsoftId || f.microsoftSecret)) return err("Calendar sign-in needs your own web address to send people back to. Add your domain first, or skip this for now and add calendars later in Settings.");
    const pairs = [
      { p: "google" as const, name: "google_secret" as const, id: str(f.googleId, 300), secret: str(f.googleSecret, 500) },
      { p: "microsoft" as const, name: "microsoft_secret" as const, id: str(f.microsoftId, 300), secret: str(f.microsoftSecret, 500) },
    ].filter((x) => x.id || x.secret);
    if (pairs.length) { const wait = checkLimit(b); if (wait) return tooMany(wait); }
    const keep: Record<string, string> = { googleId: str(f.googleId, 300), microsoftId: str(f.microsoftId, 300) };
    for (const x of pairs) {
      const secret = x.secret || (s.calendars?.[x.p]?.clientId === x.id ? getSecret(b.id, x.name) || "" : "");
      const r = x.p === "google" ? await checkGoogle(x.id, secret, oauthRedirect(s, "google")) : await checkMicrosoft(x.id, secret, oauthRedirect(s, "microsoft"));
      if (!r.ok) return err(r.message, keep);
      putSecret(b.id, x.name, secret);
    }
    updateSetup(b.id, (s) => {
      s.calendars = { done: true };
      for (const x of pairs) s.calendars[x.p] = { clientId: x.id };
      for (const p of ["google", "microsoft"] as const) if (!s.calendars[p]) deleteSecret(b.id, p === "google" ? "google_secret" : "microsoft_secret");
      nextStep(b, s, "calendars");
    });
    return null;
  },
  "cal-skip"(b) {
    const g = guard(b, "calendars"); if (g) return g;
    deleteSecret(b.id, "google_secret"); deleteSecret(b.id, "microsoft_secret");
    updateSetup(b.id, (s) => { s.calendars = { done: true }; s.skipped = { ...s.skipped, calendars: true }; nextStep(b, s, "calendars"); });
    return null;
  },

  // "Continue" on a screen that is already done (Login with ... and pasting both stay on the screen so the buyer sees the result).
  "railway-continue"(b) { const g = guard(b, "railway"); if (g) return g; updateSetup(b.id, (s) => { if (s.railway?.confirmed) nextStep(b, s, "railway"); }); return null; },
  "phones-continue"(b) { const g = guard(b, "phones"); if (g) return g; updateSetup(b.id, (s) => { if (stepDone(b, s, "phones")) nextStep(b, s, "phones"); }); return null; },
  "ai-continue"(b) { const g = guard(b, "ai"); if (g) return g; updateSetup(b.id, (s) => { if (stepDone(b, s, "ai")) nextStep(b, s, "ai"); }); return null; },

  // ---- AI (OpenRouter): "Login with OpenRouter" (oauthComplete) or paste a key. The key goes to the app as OPENROUTER_API_KEY. ----
  async ai(b, f) {
    const g = guard(b, "ai"); if (g) return g;
    const key = str(f.key, 300) || getSecret(b.id, "openrouter_key") || "";
    if (!key) return err("Paste your OpenRouter key.");
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    return saveOpenRouter(b, key, "paste");
  },

  // ---- Install ----
  "install-start"(b) {
    const g = guard(b, "install"); if (g) return g;
    const s = getSetup(b.id);
    if (!["idle", "create_failed"].includes(s.phase)) return null;
    // "Connect more" (extras) is only a screen to pass through: nothing on it is needed.
    const missing = STEPS.slice(0, STEPS.indexOf("install")).find((id) => id !== "extras" && !isOptional(id) && !stepDone(b, s, id));
    if (missing) return err("Finish the earlier steps first.");
    const p = phonesProblem(b, s) || extrasProblem(b, s); if (p) return err(p);
    if (!hasSecret(b.id, "railway_token")) return err("Your Railway token is missing. Go back to the Railway step and check it again.");
    if (!currentPackage()) return err("The app isn't ready to install yet. Please try again later.");
    const wait = allow(`install:${b.id}`, 6, 10 * MIN); if (wait) return tooMany(wait);
    updateSetup(b.id, (s) => { s.phase = "creating"; s.error = undefined; if (!s.rw?.projectId) s.progress = []; s.step = "install"; });
    kick(b.id);
    return null;
  },
  // Railway: the app runs at its temporary address; finish without waiting for app.<domain>.
  "install-finish"(b) {
    const g = guard(b, "install"); if (g) return g;
    const s = getSetup(b.id);
    if (s.phase !== "domain" || !hostOf(s)) return null;
    if (busy.has(b.id)) return err("One moment: we're still checking. Try again in a few seconds.");
    finish(b.id, `https://${hostOf(s)}`);
    return null;
  },
  "install-retry"(b) {
    const g = guard(b, "install"); if (g) return g;
    const s = getSetup(b.id);
    if (s.phase !== "failed") return null;
    const wait = allow(`install:${b.id}`, 6, 10 * MIN); if (wait) return tooMany(wait);
    // Same project, database and settings: send the app again for a fresh build.
    updateSetup(b.id, (s) => { s.phase = "creating"; s.error = undefined; s.attempt = (s.attempt || 1) + 1; if (s.rw) { delete s.rw.deploymentId; delete s.rw.deployStatus; } });
    kick(b.id);
    return { kind: "info", text: "Building the app again in the same Railway project." };
  },
  async "server-delete"(b) {
    const g = guard(b, "install"); if (g) return g;
    return deleteRailwayProject(b);
  },
};

// ---------------- demo buyers ----------------
// A demo buyer (Admin > Start a demo) goes through the same screens, but every account step
// accepts anything and NOTHING here calls a provider (no Railway, Telnyx, Resend, Cloudflare,
// SMTP or Google/Microsoft), and no key is stored. Real buyers never reach these functions: each
// one is wrapped so it only runs when buyers.demo = 1.
const demoZone = (b: Buyer) => `demo-${b.code.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}.test`;
const demoActions: Record<string, Action> = {
  railway(b) {
    const g = guard(b, "railway"); if (g) return g;
    updateSetup(b.id, (s) => { s.railway = { email: s.brand?.ownerEmail, workspaceName: "Test workspace", plan: "hobby", confirmed: true }; nextStep(b, s, "railway"); });
    return null;
  },
  phones(b) {
    const g = guard(b, "phones"); if (g) return g;
    updateSetup(b.id, (s) => { s.brand!.ownPhoneAccount = false; s.phones = { balance: "demo", checked: true, confirmed: true, provider: "telnyx" }; nextStep(b, s, "phones"); });
    return null;
  },
  ai(b) {
    const g = guard(b, "ai"); if (g) return g;
    updateSetup(b.id, (s) => { s.ai = { confirmed: true, via: "paste" }; nextStep(b, s, "ai"); });
    return null;
  },
  // The backup options accept anything in a test run and store nothing.
  vapi(b) {
    const g = guard(b, "vapi"); if (g) return g;
    updateSetup(b.id, (s) => { s.vapi = { confirmed: true }; s.phones = { ...s.phones, provider: "vapi" }; nextStep(b, s, "vapi"); });
    return null;
  },
  twilio(b) {
    const g = guard(b, "twilio"); if (g) return g;
    updateSetup(b.id, (s) => { s.twilio = { sid: "AC" + "0".repeat(32), confirmed: true }; nextStep(b, s, "twilio"); });
    return null;
  },
  email(b, f) {
    const g = guard(b, "email"); if (g) return g;
    const typed = str(f.address, 200).toLowerCase();
    const address = isEmail(typed) ? typed : `hello@mail.${demoZone(b)}`;
    updateSetup(b.id, (s) => {
      s.email = { mode: "resend", address, sendingDomain: address.split("@")[1], from: `${s.brand!.productName} <${address}>`, checked: true, confirmed: true, resend: { status: "verified", records: [], dmarc: null } };
      nextStep(b, s, "email");
    });
    return null;
  },
  smtp(b, f) { return demoActions.email(b, f); },
  "email-recheck": () => null,
  "email-test": () => ok("Test email skipped: this is a test run."),
  // Any domain, or none: the demo gets its own pretend address.
  domain(b, f) {
    const g = guard(b, "domain"); if (g) return g;
    const typed = normalizeDomain(str(f.domain, 253));
    const zone = typed || demoZone(b);
    updateSetup(b.id, (s) => { s.domain = { mode: "manual", zone, sub: "app", host: `app.${zone}`, confirmed: true }; nextStep(b, s, "domain"); });
    return null;
  },
  "cf-recheck": () => null,
  calendars(b) {
    const g = guard(b, "calendars"); if (g) return g;
    updateSetup(b.id, (s) => { s.calendars = { done: true }; nextStep(b, s, "calendars"); });
    return null;
  },
  "install-start"(b) {
    const g = guard(b, "install"); if (g) return g;
    const s = getSetup(b.id);
    if (!["idle", "create_failed", "failed"].includes(s.phase)) return null;
    const missing = STEPS.slice(0, STEPS.indexOf("install")).find((id) => id !== "extras" && !isOptional(id) && !stepDone(b, s, id));
    if (missing) return err("Finish the earlier steps first.");
    updateSetup(b.id, (s) => { s.phase = "creating"; s.error = undefined; s.progress = []; s.rw = {}; s.step = "install"; });
    kick(b.id);
    return null;
  },
  "install-retry": (b, f) => demoActions["install-start"](b, f),
  "install-finish"(b) { finish(b.id, demoOpenUrl(b)); return null; },
  "server-delete"(b) {
    updateSetup(b.id, (s) => { s.phase = "idle"; s.progress = []; s.rw = undefined; s.error = undefined; });
    return ok("Test project removed. Press Install to start it again.");
  },
};
// Every action that could reach a provider is swapped for its demo twin, for demo buyers only.
for (const [name, fn] of Object.entries(demoActions)) {
  const real = actions[name];
  actions[name] = real ? (b, f) => (b.demo === 1 ? fn(b, f) : real(b, f)) : fn;
}
export const demoOpenUrl = (b: Buyer) => `${CONFIG.siteUrl}/setup/${b.code}/open`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A pretend install: the normal stages tick by in a few seconds, then it finishes. */
async function tickDemoInstall(id: number) {
  const b = db().query("SELECT * FROM buyers WHERE id = ?").get(id) as Buyer | null;
  if (!b) return;
  const still = () => ["creating", "deploying"].includes(getSetup(id).phase) && !!db().query("SELECT 1 FROM buyers WHERE id = ?").get(id);
  const stages: [string, (s: SetupData) => void][] = [
    ["Creating your project", (s) => { s.rw = { ...s.rw, projectId: "demo" }; }],
    ["Adding your database", (s) => { s.rw!.pgVolume = true; }],
    ["Adding the app and your settings", (s) => { s.rw!.appVolume = true; s.rw!.deploymentId = "demo"; s.phase = "deploying"; s.rw!.deployStatus = "BUILDING"; }],
    ["Building the app", (s) => { s.rw!.deployStatus = "DEPLOYING"; }],
    ["Starting the app", () => {}],
  ];
  for (const [msg, fn] of stages) {
    if (!still()) return;
    await sleep(1200);
    if (!still()) return;
    updateSetup(id, (s) => { fn(s); s.progress = [...(s.progress || []), msg]; });
  }
  await sleep(1000);
  if (still()) finish(id, demoOpenUrl(b));
}

/** Looks at the chosen Cloudflare zone: active yet? can the token write? anything at app.<zone> already? */
async function applyZone(id: number, zoneId: string, sub: string, replace: boolean): Promise<Flash | null> {
  const s = getSetup(id);
  const token = getSecret(id, "cf_token");
  if (!token || !s.domain?.cf) return err("Check your Cloudflare token first.");
  const z = s.domain.cf.zones.find((x) => x.id === zoneId);
  if (!z) return err("Pick your domain from the list.");
  try {
    const zone = await cfZone(token, z.id);
    const host = `${sub}.${zone.name}`;
    let canEdit: boolean | undefined, existing: string | undefined;
    if (zone.status === "active") {
      canEdit = await cfCanEdit(token, zone.id, zone.name);
      const here = (await cfRecords(token, zone.id, host)).filter((x) => ["A", "AAAA", "CNAME"].includes(x.type));
      existing = here.length ? here.map((x) => `${x.type} ${x.content}${x.proxied ? " (proxied)" : ""}`).join(", ") : undefined;
    }
    updateSetup(id, (s) => {
      s.domain = { ...s.domain!, mode: "cloudflare", zone: zone.name, sub, host, confirmed: false, cf: { ...s.domain!.cf!, zoneId: zone.id, status: zone.status, nameServers: zone.nameServers, canEdit, existing, replace, checks: s.domain?.cf?.zoneId === zone.id ? s.domain.cf.checks || 0 : 0, lastCheck: now() } };
    });
    if (zone.status !== "active") return { kind: "info", text: "Cloudflare is waiting for your nameserver change. We'll keep checking." };
    if (canEdit === false) return err("This token can read your domain but can't change its DNS records. Make a token with Zone: Read and DNS: Edit, or add the records yourself instead.");
    return null;
  } catch (e) { return err(errMsg(e)); }
}

// ======================= background work =======================
const busy = new Set<number>();
const lastRun = new Map<string, number>();
const due = (key: string, everyMs: number) => {
  const t = Date.now();
  if (t - (lastRun.get(key) || 0) < everyMs) return false;
  lastRun.set(key, t);
  return true;
};
const fast = CONFIG.mockFast; // the fakes answer instantly, so check more often in test mode

/** Run this buyer's background step now (e.g. right after they click Install). */
export function kick(buyerId: number) { lastRun.delete(`do:${buyerId}`); void tickOne(buyerId); }

export function startTicker() {
  const t = setInterval(() => { for (const { buyerId } of activeSetups()) void tickOne(buyerId); }, fast ? 1500 : 3000);
  t.unref?.();
  // A setup nobody has touched for SECRETS_IDLE_DAYS (14) loses its stored keys; they paste them again if they come back.
  const purge = () => {
    dropExpiredFirstLogins();
    for (const id of staleSecretBuyers(CONFIG.secretsIdleDays)) {
      if (busy.has(id)) continue;
      const n = deleteAllSecrets(id);
      updateSetup(id, (s) => { s.flash = { kind: "info", text: "For safety we deleted the keys you gave us, since this setup sat unused for a while. Paste them again to carry on." }; });
      console.log(`[setup] buyer ${id}: idle for ${CONFIG.secretsIdleDays} days, ${n} stored keys deleted`);
    }
  };
  purge();
  const p = setInterval(purge, 60 * MIN);
  p.unref?.();
}

const isDemoBuyer = (id: number) => (db().query("SELECT demo FROM buyers WHERE id = ?").get(id) as { demo: number } | null)?.demo === 1;

async function tickOne(id: number) {
  if (busy.has(id)) return;
  const s = getSetup(id);
  const wantsEmail = s.email?.mode === "resend" && s.email.resend && s.email.resend.status !== "verified" && !!s.email.resend.records?.length && hasSecret(id, "resend_key");
  const wantsDomain = s.step === "domain" && s.domain?.mode === "cloudflare" && s.domain.cf?.zoneId && ["pending", "initializing"].includes(s.domain.cf.status || "");
  const updating = s.update?.phase === "running";
  if (!["creating", "deploying", "domain"].includes(s.phase) && !wantsEmail && !wantsDomain && !updating) return;
  busy.add(id);
  try {
    if (updating) await tickUpdate(id);
    else if (isDemoBuyer(id)) { if (["creating", "deploying"].includes(s.phase)) await tickDemoInstall(id); }
    else if (s.phase === "creating") await tickRailCreate(id);
    else if (s.phase === "deploying") await tickRailDeploy(id);
    else if (s.phase === "domain") await tickRailDomain(id);
    if (wantsEmail) await checkEmailDns(id, false);
    if (wantsDomain) await tickZone(id);
  } catch (e) {
    safeLog(`tick ${id}`, e);
  } finally {
    busy.delete(id);
  }
}

function progress(id: number, msg: string) {
  updateSetup(id, (s) => { s.progress = [...(s.progress || []), msg]; });
}
function fail(id: number, phase: "create_failed" | "failed", msg: string) {
  updateSetup(id, (s) => { s.phase = phase; s.error = msg; });
}

async function tickZone(id: number) {
  const s = getSetup(id);
  if (!due(`zone:${id}`, fast ? 2000 : 30_000)) return;
  const token = getSecret(id, "cf_token");
  if (!token) return;
  const z = await cfZone(token, s.domain!.cf!.zoneId!).catch(() => null);
  if (!z) return;
  updateSetup(id, (s) => { s.domain!.cf!.checks = (s.domain!.cf!.checks || 0) + 1; s.domain!.cf!.lastCheck = now(); if (z.status !== "active") s.domain!.cf!.status = z.status; });
  if (z.status === "moved" || z.status === "deleted") updateSetup(id, (s) => { s.flash = { kind: "err", text: `Cloudflare says ${z.name} is no longer pointed at it. Put Cloudflare's nameservers back at your registrar, or add the records yourself.` }; });
  if (z.status === "active") {
    const f = await applyZone(id, z.id, s.domain!.sub, !!s.domain!.cf!.replace);
    if (!f) updateSetup(id, (s) => { s.flash = { kind: "ok", text: `Your nameserver change has gone through: Cloudflare is now in charge of ${z.name}.` }; });
  }
}

/** "jane.smith@x.com" -> "Jane Smith": the name the app gives the owner it creates (the wizard doesn't ask for one). */
export function ownerNameOf(email: string): string {
  const local = email.split("@")[0].replace(/[._+-]+/g, " ").trim();
  return local.replace(/\b\p{L}/gu, (c) => c.toUpperCase()).slice(0, 80) || "Owner";
}
/** How long the done screen offers the one-time sign-in link (the app accepts it for 24 hours after it starts). */
export const FIRST_LOGIN_MS = 23 * 3_600_000;
export const firstLoginFresh = (s: SetupData) => !!s.firstLogin && Date.now() - Date.parse(s.firstLogin.at) < FIRST_LOGIN_MS;
/**
 * The app makes the owner on first start from these (OWNER_NAME, AGENCY_NAME, FIRST_ADMIN_EMAIL), so the buyer never
 * sees a create-account form, and FIRST_LOGIN_TOKEN is the one-time link behind the done screen's button. The token
 * is made once per install and kept with the setup (not a provider key: it works once and runs out in 24 hours).
 */
export function firstRunSettings(id: number, s: SetupData): Record<string, string> {
  let token = getSetup(id).firstLogin?.token;
  if (!token || !firstLoginFresh(getSetup(id))) {
    token = randomBytes(32).toString("base64url");
    const t = token;
    updateSetup(id, (x) => { x.firstLogin = { token: t, at: now() }; });
  }
  return { OWNER_NAME: s.brand!.ownerName || ownerNameOf(s.brand!.ownerEmail), AGENCY_NAME: s.brand!.productName, FIRST_LOGIN_TOKEN: token };
}
/** The one-time owner sign-in token is not kept past its 24 hours: it is dropped from every stored setup that holds an old one. Returns how many. */
export function dropExpiredFirstLogins(at = Date.now()): number {
  let n = 0;
  for (const { buyerId, s } of activeSetups()) {
    if (s.firstLogin && at - Date.parse(s.firstLogin.at) >= FIRST_LOGIN_HOURS_MS) { updateSetup(buyerId, (x) => { delete x.firstLogin; }); n++; }
  }
  return n;
}
const FIRST_LOGIN_HOURS_MS = 24 * 3_600_000;
/** The done screen's "Open your dashboard" target: the one-time sign-in link while it is fresh, else the plain address. */
export function dashboardLink(s: SetupData, base: string): string {
  return firstLoginFresh(s) ? `${base.replace(/\/+$/, "")}/welcome?t=${encodeURIComponent(s.firstLogin!.token)}` : base;
}

/** The logo, colours and look (light or dark) from the Brand step. The app applies them once, when the owner first signs up. */
function brandSettings(s: SetupData): Record<string, string> {
  const v: Record<string, string> = {};
  if (s.brand?.logo) v.BRAND_LOGO_PNG = s.brand.logo.slice(s.brand.logo.indexOf(",") + 1);
  // BRAND_COLOURS: 1 to 3 hex colours, comma-separated, the first is the main one. BRAND_COLOUR stays the first, for older apps.
  const colours = s.brand?.colours?.length ? s.brand.colours : s.brand?.colour ? [s.brand.colour] : [];
  if (colours.length) { v.BRAND_COLOURS = colours.join(","); v.BRAND_COLOUR = colours[0]; }
  if (s.brand?.theme) v.THEME = s.brand.theme;
  return v;
}

/** Telnyx is connected (the main voice engine). */
export const hasTelnyx = (id: number, s: SetupData) => !!s.phones?.confirmed && hasSecret(id, "telnyx_key");
/**
 * The phone keys the installed app is given:
 *   Telnyx only         TELNYX_API_KEY, VOICE_PROVIDER=telnyx
 *   Telnyx + Vapi       both, VOICE_PROVIDER=telnyx (Telnyx stays the main engine; Vapi is the backup one)
 *   Vapi (+ Twilio)     VAPI_*, VOICE_PROVIDER=vapi, no Telnyx key (only when Telnyx was not connected)
 * Twilio (numbers and texts) goes with whichever is there. Skipped: nothing at all.
 */
export function phoneSettings(id: number, s: SetupData): Record<string, string> {
  const sid = twilioSidOf(s);
  const twilio: Record<string, string> = sid && getSecret(id, "twilio_token") ? { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: getSecret(id, "twilio_token") || "" } : {};
  // No voice provider (an old setup that skipped it): no voice key. The app (SINGLE_AGENCY) expects the owner's own key, pasted in Connections. Twilio from Connect more still goes along.
  if (phoneSkipped(s)) return twilio;
  const telnyx = hasTelnyx(id, s);
  const vapi = useVapi(s) && hasSecret(id, "vapi_key");
  const out: Record<string, string> = {};
  if (telnyx || !vapi) out.TELNYX_API_KEY = getSecret(id, "telnyx_key") || "";
  if (telnyx) out.VOICE_PROVIDER = "telnyx";
  if (vapi) {
    if (!telnyx) out.VOICE_PROVIDER = "vapi";
    out.VAPI_API_KEY = getSecret(id, "vapi_key") || "";
    out.VAPI_PUBLIC_KEY = getSecret(id, "vapi_public") || "";
  }
  return { ...out, ...twilio };
}

/**
 * Settings for the health heartbeat and Support access (sync.ts). The app sends counts and health to us
 * with SUPPORT_SYNC_TOKEN (we keep only its hash), and we call it with SUPPORT_CALL_TOKEN. The buyer sees
 * and controls both in their app's Settings, "Support". On a fresh install all of it starts ON (SUPPORT_ACCESS_DEFAULT=on,
 * set by buildSettings and railwayVars, never by an update): sharing, Support access, and "Support can make changes"
 * (the app's own default). The owner can switch each one off.
 */
function supportSettings(id: number): Record<string, string> {
  const { token, callToken } = newSyncToken(id);
  return { SUPPORT_SYNC_URL: SYNC_URL(), SUPPORT_SYNC_TOKEN: token, SUPPORT_CALL_TOKEN: callToken, SUPPORT_SELLER_NAME: CONFIG.sellerName, APP_VERSION: currentPackage()?.version || "", ...(brokerOn() ? { OAUTH_BROKER: "1" } : {}) };
}

/** Resend domain + (manual path) each record in public DNS. */
export async function checkEmailDns(id: number, force: boolean) {
  const s = getSetup(id);
  const e = s.email?.resend;
  const key = getSecret(id, "resend_key");
  if (!e?.domainId || !key || e.status === "verified") return;
  if (!force && !due(`email:${id}`, fast ? 2000 : 20_000)) return;
  const zone = zoneOf(s);
  const recs = [...(e.records || []), ...(e.dmarc ? [e.dmarc] : [])];
  for (const r of recs) {
    const live = await recordLive(r, zone);
    r.ok = live.ok; r.seen = live.seen;
  }
  // Ask Resend to look again now and then (it also re-checks by itself).
  if (force || ago(e.verifyAt) > (fast ? 3000 : 2 * MIN)) { await resendVerify(key, e.domainId).catch(() => {}); e.verifyAt = now(); }
  let status = e.status;
  try {
    const st = await resendStatus(key, e.domainId);
    status = st.status;
    for (const r of e.records || []) {
      const rs = st.recordStatus[`${r.type}:${r.value.toLowerCase()}`];
      if (rs === "verified") r.ok = true;
    }
  } catch (err) { safeLog("resend status", err); }
  updateSetup(id, (s) => {
    if (!s.email?.resend) return;
    s.email.resend = { ...e, status: status === "verified" ? "verified" : status === "failed" ? "failed" : "pending", lastCheck: now() };
  });
  // Verified just now: send the owner a test email straight away.
  if (status === "verified" && !s.email?.testSentTo && !allow(`testmail:${id}`, CONFIG.testEmailsPerHour, 60 * MIN)) await sendTest(id);
}

async function sendTest(id: number) {
  const s = getSetup(id);
  const to = s.brand!.ownerEmail;
  let r: { ok: boolean; message: string };
  if (s.email!.mode === "resend") r = await resendSend(getSecret(id, "resend_key")!, s.email!.from!, to, s.brand!.productName);
  else {
    const host = s.email!.smtp!.host;
    const where = CONFIG.mockResend && host === "127.0.0.1" ? { ok: true as const, ip: "" } : await publicSmtpAddress(host);
    r = where.ok ? await smtpSend(smtpUrl(host, s.email!.smtp!.port, s.email!.smtp!.user, getSecret(id, "smtp_password")!), s.email!.from!, to, s.brand!.productName, where.ip || undefined) : where;
  }
  if (r.ok) updateSetup(id, (s) => { s.email!.testSentTo = to; });
  return r;
}

/** Success: forget every secret, keep only what the buyer's Done page and our records need. */
export function finish(id: number, url: string) {
  const removed = deleteAllSecrets(id);
  const s = getSetup(id);
  const demo = isDemoBuyer(id); // a demo keeps its logo and colour: the demo dashboard is built from them
  const kept: SetupData = {
    step: "done", phase: "done",
    brand: s.brand ? { productName: s.brand.productName, ownerEmail: s.brand.ownerEmail, ...(s.brand.ownerName ? { ownerName: s.brand.ownerName } : {}), ownPhoneAccount: s.brand.ownPhoneAccount, ...(demo ? { logo: s.brand.logo, colour: s.brand.colour } : {}) } : undefined,
    domain: s.domain ? { mode: s.domain.mode, zone: s.domain.zone, sub: s.domain.sub, host: s.domain.host, confirmed: true } : undefined,
    phones: phoneSkipped(s) ? { deferred: true, provider: "telnyx" } : { confirmed: true, provider: hasTelnyx(id, s) || !useVapi(s) ? "telnyx" : "vapi" }, email: s.email ? { mode: s.email.mode, address: s.email.address, from: s.email.from, confirmed: true, resend: s.email.resend ? { status: s.email.resend.status } : undefined } : undefined,
    calendars: s.calendars ? { google: s.calendars.google, microsoft: s.calendars.microsoft, done: true } : undefined,
    skipped: s.skipped, extrasDone: s.extrasDone,
    assist: s.assist ? { steps: s.assist.steps, keepDns: s.assist.keepDns, dnsBy: s.assist.dnsBy, installBy: s.assist.installBy, openrouter: s.assist.openrouter } : undefined,
    attempt: s.attempt, attemptVersion: s.attemptVersion,
    installedAt: now(), purgedAt: now(), resultUrl: url, firstLogin: s.firstLogin,
    railway: s.railway ? { workspaceName: s.railway.workspaceName, confirmed: true } : undefined,
    rw: s.rw ? { projectId: s.rw.projectId, serviceDomain: s.rw.serviceDomain, certStatus: s.rw.certStatus, domainOk: s.rw.domainOk } : undefined,
    tempUrl: s.rw?.serviceDomain ? webUrl(s.rw.serviceDomain) : undefined,
    domainPending: !demo && !!s.domain?.host ? !s.rw?.domainOk : undefined,
    finishRecords: !demo && !!s.domain?.host && !s.rw?.domainOk ? (s.rw?.records || []).map(({ cfId, ...r }) => r) : undefined,
  };
  saveSetup(id, kept);
  console.log(`[setup] buyer ${id}: installed; ${removed} secrets deleted`);
}

// ======================= Railway =======================
// Install = one Railway project in the buyer's account: a Postgres service (with a volume)
// and the app service, built by Railway from our source with deploy/Dockerfile. Each piece
// is saved as soon as it exists, so a restart or a retry carries on where it stopped.
const APP_PORT = 8791;
const PG_IMAGE = "ghcr.io/railwayapp-templates/postgres-ssl:16";

/** Email before the domain step: check the key and add the sending domain to Resend. Records come later. */
async function emailBeforeDomain(b: Buyer, f: Form): Promise<Flash | null> {
  const key = str(f.key, 300) || getSecret(b.id, "resend_key") || "";
  const address = str(f.address, 200).toLowerCase();
  if (!key) return err("Paste your Resend API key.", f);
  if (!isEmail(address)) return err("Enter the address emails come from, like hello@mail.yourbusiness.com.", f);
  const sendingDomain = address.split("@")[1];
  if (!normalizeDomain(sendingDomain)) return err("That address's domain doesn't look right.", f);
  const wait = checkLimit(b); if (wait) return tooMany(wait);
  const r = await checkResend(key);
  if (!r.ok) return err(r.message, f);
  putSecret(b.id, "resend_key", key);
  try {
    const d = await resendDomain(key, sendingDomain, guessZone(sendingDomain));
    updateSetup(b.id, (s) => {
      s.email = { mode: "resend", address, sendingDomain, from: `${s.brand!.productName} <${address}>`, checked: true, confirmed: true, resend: { domainId: d.id, status: d.status === "verified" ? "verified" : "pending", records: [], dmarc: null } };
      nextStep(b, s, "email");
    });
    return null;
  } catch (e) { safeLog("email", e); return err(errMsg(e), f); }
}
/** mail.example.com -> example.com (a first guess; the Domain step sets the real one). */
const guessZone = (d: string) => (d.split(".").length > 2 && /^(mail|send|email|mg|mx|news)\./.test(d) ? d.slice(d.indexOf(".") + 1) : d);

/** Resend's records (and DMARC if missing) for `zone`: written to Cloudflare, or kept to show. */
export async function emailDns(id: number, zone: string, writer?: DnsWriter | null) {
  const s = getSetup(id);
  if (s.email?.mode !== "resend" || !s.email.sendingDomain) return;
  const key = getSecret(id, "resend_key");
  if (!key) throw new ProviderError("Your Resend key is missing. Go back to the Email step and check it again.");
  const d = await resendDomain(key, s.email.sendingDomain, zone);
  const dmarc: DnsRecord = { key: "dmarc", purpose: "Spoofing protection (DMARC)", type: "TXT", name: `_dmarc.${zone}`, value: "v=DMARC1; p=none;", ttl: "Auto" };
  let needDmarc: boolean;
  if (writer) {
    needDmarc = !(await writer.hasDmarc(zone));
    for (const rec of d.records) rec.cfId = await writer.ensure(rec);
    if (needDmarc) dmarc.cfId = await writer.ensure(dmarc);
  } else {
    needDmarc = !(await lookup("TXT", dmarc.name, zone)).some((v) => /^v=DMARC1/i.test(v));
  }
  if (d.status !== "verified") await resendVerify(key, d.id).catch(() => {});
  updateSetup(id, (s) => {
    s.email!.resend = { domainId: d.id, status: d.status === "verified" ? "verified" : "pending", records: d.records, dmarc: needDmarc ? dmarc : null, written: !!writer, verifyAt: now() };
  });
}

/** Domain (Railway order: after email). Cloudflare writes Resend's records now; the app's two come at Install. */
async function domainRailway(b: Buyer, f: Form): Promise<Flash | null> {
  const s = getSetup(b.id);
  const domain = normalizeDomain(str(f.domain, 253) || s.domain?.zone || "");
  const mode = f.mode === "manual" ? "manual" : f.mode === "godaddy" ? "godaddy" : "cloudflare";
  if (!domain) return err("Type your domain, like yourbusiness.com.", f);
  const sd = s.email?.mode === "resend" ? s.email.sendingDomain || "" : "";
  if (sd && sd !== domain && !sd.endsWith("." + domain)) return err(`Your email address is on ${sd}. Use that domain here, or go back to Email and change the address.`, { domain, mode });
  const sub = "app";
  if (mode === "manual") {
    deleteSecret(b.id, "cf_token"); deleteSecret(b.id, "godaddy_key"); deleteSecret(b.id, "godaddy_secret");
    updateSetup(b.id, (s) => { s.domain = { mode: "manual", zone: domain, sub, host: `${sub}.${domain}`, confirmed: false }; });
    try { await emailDns(b.id, domain); } catch (e) { safeLog("email dns", e); return err(errMsg(e)); }
    return null; // the screen now lists the email records, with Continue
  }
  if (mode === "godaddy") {
    // GoDaddy's own DNS API (key + secret). Same shape as Cloudflare: check, write email records now, the app's at Install.
    const gk = str(f.gdKey, 200) || (s.domain?.mode === "godaddy" ? getSecret(b.id, "godaddy_key") : null) || "";
    const gs = str(f.gdSecret, 200) || (s.domain?.mode === "godaddy" ? getSecret(b.id, "godaddy_secret") : null) || "";
    if (!gk || !gs) return err("Paste your GoDaddy API key and secret.", { domain, mode });
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    const r = await checkGoDaddy(gk, gs, domain);
    if (!r.ok) return err(r.message, { domain, mode });
    if (sd && sd !== r.zone && !sd.endsWith("." + r.zone)) return err(`Your email address is on ${sd}, which isn't part of ${r.zone}.`, { domain, mode });
    const replace = f.replace === "1" || (s.domain?.mode === "godaddy" && !!s.domain.replace);
    const host = `${sub}.${r.zone}`;
    try {
      const existing = await godaddyExisting(gk, gs, r.zone, host);
      if (existing && !replace) return err(`${host} already points somewhere else (${existing}). Tick "Replace it" to point it at the new agency.`, { domain, mode });
    } catch (e) { safeLog("godaddy", e); return err(errMsg(e), { domain, mode }); }
    deleteSecret(b.id, "cf_token");
    putSecret(b.id, "godaddy_key", gk); putSecret(b.id, "godaddy_secret", gs);
    updateSetup(b.id, (s) => { s.domain = { mode: "godaddy", zone: r.zone, sub, host, replace }; });
    try { await emailDns(b.id, r.zone, godaddyWriter(gk, gs, r.zone, { replace })); } catch (e) { safeLog("email dns", e); return err(errMsg(e), { domain, mode }); }
    updateSetup(b.id, (s) => { s.domain!.confirmed = true; nextStep(b, s, "domain"); });
    return null;
  }
  const token = str(f.token, 300) || (s.domain?.mode === "cloudflare" ? getSecret(b.id, "cf_token") : null) || "";
  if (!token) return err("Paste your Cloudflare token.", { domain, mode });
  const wait = checkLimit(b); if (wait) return tooMany(wait);
  const r = await checkCloudflare(token);
  if (!r.ok) return err(r.message, { domain, mode });
  const zone = await cfFindZone(token, domain).catch(() => null);
  if (!zone) return err(`This token can't see ${domain}. Add it to Cloudflare first, or make the token for it.`, { domain, mode });
  if (sd && sd !== zone.name && !sd.endsWith("." + zone.name)) return err(`Your email address is on ${sd}, which isn't part of ${zone.name}.`, { domain, mode });
  putSecret(b.id, "cf_token", token);
  const replace = f.replace === "1" || (s.domain?.cf?.zoneId === zone.id && !!s.domain.cf.replace);
  updateSetup(b.id, (s) => { s.domain = { mode: "cloudflare", zone: zone.name, sub, cf: { zones: [zone], replace } }; });
  const res = await applyZone(b.id, zone.id, sub, replace);
  const d = getSetup(b.id).domain!;
  if (d.cf?.status === "active" && d.cf.canEdit && (!d.cf.existing || d.cf.replace)) {
    try { await emailDns(b.id, zone.name, cloudflareWriter(token, zone.id)); } catch (e) { safeLog("email dns", e); return err(errMsg(e)); }
    updateSetup(b.id, (s) => { s.domain!.confirmed = true; nextStep(b, s, "domain"); });
    return null;
  }
  return res && res.kind === "err" ? res : null;
}

async function deleteRailwayProject(b: Buyer): Promise<Flash | null> {
  const s = getSetup(b.id);
  const token = await railwayToken(b.id);
  if (!token) return err("We no longer hold your Railway token: delete the project in Railway, under its Settings.");
  if (busy.has(b.id)) return err("One moment: we're still working on your project. Try again in a few seconds.");
  busy.add(b.id);
  try {
    if (s.rw?.projectId) await railway(token, "mutation($id: String!) { projectDelete(id: $id) }", { id: s.rw.projectId }).catch((e) => { if (!(e instanceof ProviderError && /not found/i.test(e.message))) throw e; });
    // The app's records we wrote at Install (Cloudflare or GoDaddy). Best effort: the project is already gone.
    const writer = writerFor(b.id, s);
    if (writer) for (const r of s.rw?.records || []) if (r.cfId) await writer.remove(r).catch((e) => safeLog("dns delete", e));
  } catch (e) { return err(errMsg(e)); } finally { busy.delete(b.id); }
  logClear(b.id);
  updateSetup(b.id, (s) => { delete s.rw; delete s.error; delete s.attempt; s.phase = "idle"; s.progress = []; });
  return ok("Project deleted. Press Install to make a new one.");
}


const PROJECT_Q = "query($id: String!) { project(id: $id) { id environments { edges { node { id name } } } } }";
const DOMAIN_FIELDS = "id domain status { verified certificateStatus verificationDnsHost verificationToken dnsRecords { recordType hostlabel fqdn zone requiredValue currentValue status purpose } }";

/** Railway's records for app.<domain>, as rows for our table (and Cloudflare). */
function railRecords(cd: any, host: string, zone: string, old: DnsRecord[] = []): DnsRecord[] {
  const out: DnsRecord[] = [];
  const full = (n: string) => { n = String(n || "").replace(/\.$/, "").toLowerCase(); return !n ? host : n === zone || n.endsWith("." + zone) ? n : `${n}.${zone}`; };
  for (const r of cd?.status?.dnsRecords || []) {
    const t = String(r.recordType || "").replace("DNS_RECORD_TYPE_", "");
    if (!["CNAME", "TXT", "A"].includes(t)) continue;
    out.push({ key: `rw-${t.toLowerCase()}-${out.length}`, purpose: t === "TXT" ? "Proves the domain is yours (Railway)" : "Your dashboard (Railway)", type: t as DnsRecord["type"], name: r.fqdn ? full(r.fqdn) : full(r.hostlabel ? `${r.hostlabel}.${r.zone || zone}` : host), value: bareValue(r.requiredValue), ttl: "Auto" });
  }
  const vh = cd?.status?.verificationDnsHost, vt = cd?.status?.verificationToken;
  if (vh && vt && !out.some((r) => r.type === "TXT")) out.push({ key: "rw-verify", purpose: "Proves the domain is yours (Railway)", type: "TXT", name: full(vh), value: bareValue(vt), ttl: "Auto" });
  for (const r of out) { const o = old.find((x) => x.type === r.type && x.name === r.name && x.value === r.value); if (o) { r.cfId = o.cfId; r.ok = o.ok; r.seen = o.seen; } }
  return out;
}
const bareValue = (v: unknown) => String(v ?? "").trim().replace(/^"([\s\S]*)"$/, "$1");

export async function railwayVars(id: number, s: SetupData, token: string): Promise<Record<string, string>> {
  // Email is optional. Without it the app still works: invite links show on screen for the owner to copy.
  let smtp = "";
  if (!s.email) smtp = "";
  else if (s.email.mode === "resend") {
    const key = getSecret(id, "resend_key");
    if (!key || !s.email.resend?.domainId) throw new ProviderError("Your Resend key is missing. Go back to the Email step and check it again.");
    // The server gets a send-only key for this one domain, never the Full access key.
    const send = await resendSendingKey(key, `${s.brand!.productName} server`, s.email.resend.domainId);
    smtp = `smtp://resend:${send}@smtp.resend.com:2587`;
  } else smtp = smtpUrl(s.email.smtp!.host, s.email.smtp!.port, s.email.smtp!.user, getSecret(id, "smtp_password") || "");
  const v: Record<string, string> = {
    PRODUCT_NAME: s.brand!.productName,
    // Their own domain if they added one; otherwise Railway's own https address, which works straight away.
    PUBLIC_URL: hostOf(s) ? `https://${hostOf(s)}` : webUrl(s.rw?.serviceDomain),
    // With their own domain: the Railway address that works from the start. The app uses it for phone/text hooks and email links until the domain answers.
    ...(hostOf(s) && s.rw?.serviceDomain ? { FALLBACK_URL: webUrl(s.rw.serviceDomain) } : {}),
    FIRST_ADMIN_EMAIL: s.brand!.ownerEmail,
    ...firstRunSettings(id, s),
    ...phoneSettings(id, s),
    SMTP_URL: smtp,
    MAIL_FROM: s.email?.from || "",
    // Encrypts saved mailbox and calendar logins in the database. Lives only in Railway.
    MAILBOX_KEY: randomBytes(32).toString("base64"),
    SINGLE_AGENCY: "1",
    ...brandSettings(s),
    ...supportSettings(id),
    HOST: "0.0.0.0",
    API_PORT: String(APP_PORT),
    PORT: String(APP_PORT),
    DATABASE_URL: "${{Postgres.DATABASE_URL}}",
    RAILWAY_DOCKERFILE_PATH: "deploy/Dockerfile",
    RAILWAY_RUN_UID: "0", // a Railway volume is owned by root: the app writes its backups to one
  };
  if (s.calendars?.google) { v.GOOGLE_CLIENT_ID = s.calendars.google.clientId; v.GOOGLE_CLIENT_SECRET = getSecret(id, "google_secret") || ""; }
  if (s.calendars?.microsoft) { v.MICROSOFT_CLIENT_ID = s.calendars.microsoft.clientId; v.MICROSOFT_CLIENT_SECRET = getSecret(id, "microsoft_secret") || ""; }
  // Optional "Ask for help" in their dashboard: an OpenRouter key our admin added for them.
  const orKey = getSecret(id, "openrouter_key");
  if (orKey) v.OPENROUTER_API_KEY = orKey;
  // Fresh installs only: Support access starts ON (the owner can switch it off in Settings, "Support"). Never set by an update.
  v.SUPPORT_ACCESS_DEFAULT = "on";
  Object.assign(v, await autoUpdateVars(id, token, { projectId: s.rw?.projectId, environmentId: s.rw?.environmentId, serviceId: s.rw?.appId }));
  return v;
}

/**
 * The app's own Railway PROJECT token, so it can update itself without us holding anyone's access: scoped to this one
 * project and environment, made with the account token the buyer just gave us, and handed straight to the app (we keep
 * nothing). Best effort: if Railway won't make one the agency still installs, and the admin shows "Auto-update
 * unavailable: buyer must press Update". Returns the variables to set, or none.
 */
/** Should "Update your agency" mint the app a new Railway project token? */
export function needsProjectToken(have: Record<string, string>, st: { snap: { updates: { available: boolean; lastResult?: string | null } } } | null): boolean {
  if (!("RAILWAY_PROJECT_TOKEN" in have)) return true;
  const u = st?.snap.updates;
  return !!u && (u.lastResult === "failed" || u.available === false);
}

export async function autoUpdateVars(id: number, accountToken: string, ids: { projectId?: string; environmentId?: string; serviceId?: string }): Promise<Record<string, string>> {
  if (!ids.projectId || !ids.environmentId || !ids.serviceId) return {};
  try {
    const t = await createProjectToken(accountToken, ids.projectId, ids.environmentId, "Automatic updates", { base: RAILWAY_API });
    return { RAILWAY_PROJECT_TOKEN: t, AUTOUPDATE_PROJECT_ID: ids.projectId, AUTOUPDATE_ENVIRONMENT_ID: ids.environmentId, AUTOUPDATE_SERVICE_ID: ids.serviceId };
  } catch (e) {
    console.log(`[setup] buyer ${id}: no project token for automatic updates (${e instanceof RailwayError ? e.code : "error"})`);
    return {};
  }
}

function setRw(id: number, fn: (rw: NonNullable<SetupData["rw"]>, s: SetupData) => void) {
  return updateSetup(id, (s) => { s.rw = s.rw || {}; fn(s.rw, s); });
}

async function tickRailCreate(id: number) {
  let s = getSetup(id);
  const token = await railwayToken(id);
  if (!token) return fail(id, "create_failed", "Your Railway token is missing. Go back to the Railway step and check it again.");
  const rw = s.rw || {};
  try {
    if (!rw.projectId) {
      progress(id, "Creating your project in Railway");
      const p = (await railway(token, "mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { id environments { edges { node { id name } } } } }", {
        input: { name: s.brand!.productName.slice(0, 60), description: `${s.brand!.productName}: AI receptionist agency`, workspaceId: s.railway?.workspaceId, defaultEnvironmentName: "production" },
      })).projectCreate;
      setRw(id, (r) => { r.projectId = String(p.id); r.environmentId = p.environments?.edges?.[0]?.node?.id; r.createdAt = now(); });
      return;
    }
    if (!rw.environmentId) {
      const p = (await railway(token, PROJECT_Q, { id: rw.projectId })).project;
      const env = p.environments?.edges?.[0]?.node?.id;
      if (!env) return; // not ready yet
      setRw(id, (r) => { r.environmentId = String(env); });
      return;
    }
    const base = { projectId: rw.projectId, environmentId: rw.environmentId };
    if (!rw.pgId) {
      progress(id, "Adding your database (Postgres)");
      const pw = randomBytes(24).toString("hex");
      const svc = (await railway(token, "mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }", {
        input: { ...base, name: "Postgres", source: { image: PG_IMAGE }, variables: {
          POSTGRES_USER: "postgres", POSTGRES_PASSWORD: pw, POSTGRES_DB: "railway", PGUSER: "postgres", PGPASSWORD: "${{POSTGRES_PASSWORD}}", PGDATABASE: "${{POSTGRES_DB}}",
          PGHOST: "${{RAILWAY_PRIVATE_DOMAIN}}", PGPORT: "5432", PGDATA: "/var/lib/postgresql/data/pgdata", SSL_CERT_DAYS: "820",
          DATABASE_URL: "postgresql://${{PGUSER}}:${{POSTGRES_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:5432/${{PGDATABASE}}",
        } },
      })).serviceCreate;
      setRw(id, (r) => { r.pgId = String(svc.id); });
      return;
    }
    if (!rw.pgVolume) {
      await railway(token, "mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }", { input: { ...base, serviceId: rw.pgId, mountPath: "/var/lib/postgresql/data" } });
      setRw(id, (r) => { r.pgVolume = true; });
      return;
    }
    if (!rw.appId) {
      progress(id, "Adding the app and your settings");
      const svc = (await railway(token, "mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }", { input: { ...base, name: "app" } })).serviceCreate;
      setRw(id, (r) => { r.appId = String(svc.id); });
      return;
    }
    // The app's own volume: the daily backups (server/backup.ts) are kept on it. Railway sets RAILWAY_VOLUME_MOUNT_PATH.
    if (!rw.appVolume) {
      await railway(token, "mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }", { input: { ...base, serviceId: rw.appId, mountPath: APP_VOLUME_PATH } });
      setRw(id, (r) => { r.appVolume = true; });
      return;
    }
    // Railway's own address first: with no custom domain it is the app's PUBLIC_URL.
    if (!rw.serviceDomain) {
      const d = (await railway(token, "mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { id domain } }", { input: { serviceId: rw.appId, environmentId: rw.environmentId, targetPort: APP_PORT } })).serviceDomainCreate;
      setRw(id, (r) => { r.serviceDomain = String(d.domain); });
      return;
    }
    if (!rw.varsSet) {
      const vars = await railwayVars(id, s, token);
      await railway(token, "mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }", { input: { ...base, serviceId: rw.appId, variables: vars, skipDeploys: true } });
      setRw(id, (r) => { r.varsSet = true; });
      return;
    }
    if (!rw.settingsSet) {
      await railway(token, "mutation($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }", {
        serviceId: rw.appId, environmentId: rw.environmentId, input: { dockerfilePath: "deploy/Dockerfile", healthcheckPath: "/api/health", healthcheckTimeout: 300, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
      });
      setRw(id, (r) => { r.settingsSet = true; });
      return;
    }
    if (hostOf(s) && !rw.customDomainId) {
      const cd = (await railway(token, `mutation($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { ${DOMAIN_FIELDS} } }`, { input: { ...base, serviceId: rw.appId, domain: hostOf(s), targetPort: APP_PORT } })).customDomainCreate;
      setRw(id, (r) => { r.customDomainId = String(cd.id); r.records = railRecords(cd, hostOf(s), zoneOf(s)); });
      return;
    }
    if (hostOf(s) && (s.domain?.mode === "cloudflare" || s.domain?.mode === "godaddy") && !rw.cfWritten && rw.records?.length) {
      const writer = writerFor(id, s);
      if (!writer) return fail(id, "create_failed", dnsKeyMissing(s));
      const recs = rw.records.map((r) => ({ ...r }));
      for (const r of recs) r.cfId = await writer.ensure(r);
      setRw(id, (r) => { r.records = recs; r.cfWritten = true; });
      progress(id, `Added ${hostOf(s)}'s records to ${writer.kind === "godaddy" ? "GoDaddy" : "Cloudflare"}`);
      return;
    }
    if (!rw.deploymentId) {
      progress(id, s.attempt && s.attempt > 1 ? `Sending the app to Railway again (attempt ${s.attempt})` : "Sending the app to Railway to build");
      const src = await appSource();
      const up = await railwayUpload(token, rw.projectId!, rw.environmentId!, rw.appId!, src, `${s.brand!.productName} ${currentPackage()?.version || ""}`.trim());
      s = setRw(id, (r, s) => { r.deploymentId = up.deploymentId; r.deployStatus = "QUEUED"; r.uploadedAt = now(); s.phase = "deploying"; s.attemptVersion = currentPackage()?.version; s.attempt = s.attempt || 1; });
      logClear(id);
      return;
    }
    updateSetup(id, (s) => { s.phase = "deploying"; });
  } catch (e) {
    safeLog("railway create", e);
    fail(id, "create_failed", errMsg(e));
  }
}

async function railLogs(id: number, token: string, deploymentId: string, runtime: boolean) {
  const q = `query($d: String!) { buildLogs(deploymentId: $d, limit: 400) { timestamp message } ${runtime ? "deploymentLogs(deploymentId: $d, limit: 150) { timestamp message }" : ""} }`;
  const r = await railway(token, q, { d: deploymentId }).catch(() => null);
  if (!r) return "";
  const app = runtime ? (r.deploymentLogs || []).map((l: any) => String(l.message)) : [];
  const lines = [...(r.buildLogs || []).map((l: any) => String(l.message)), ...(app.length ? ["", "---- the app ----", ...app] : [])];
  const text = redact(lines.join("\n") + "\n", secretValues(id));
  logClear(id); logAppend(id, text, text.length);
  return text;
}

async function tickRailDeploy(id: number) {
  const s = getSetup(id);
  const token = await railwayToken(id);
  if (!token || !s.rw?.deploymentId) return fail(id, "create_failed", "We lost track of the build. Press Try again.");
  if (!due(`rw-dep:${id}`, fast ? 2000 : 6000)) return;
  try {
    const d = (await railway(token, "query($id: String!) { deployment(id: $id) { id status } }", { id: s.rw.deploymentId })).deployment;
    const st = String(d.status);
    if (st !== s.rw.deployStatus) setRw(id, (r) => { r.deployStatus = st; });
    if (due(`rw-log:${id}`, fast ? 3000 : 12_000) || ["SUCCESS", "FAILED", "CRASHED"].includes(st)) await railLogs(id, token, s.rw.deploymentId, st !== "BUILDING" && st !== "QUEUED");
    if (st === "SUCCESS") {
      updateSetup(id, (s) => { s.phase = "domain"; s.rw!.deployedAt = now(); s.progress = [...(s.progress || []), "Your agency is running on Railway"]; });
      kick(id);
    } else if (["FAILED", "CRASHED", "REMOVED", "SKIPPED"].includes(st)) {
      const { text } = logRead(id);
      const why = text.split("\n").reverse().find((l) => /error|failed|exit code/i.test(l))?.trim().slice(0, 200);
      fail(id, "failed", st === "CRASHED" ? `the app started but then stopped${why ? `: ${why}` : ""}` : `Railway couldn't build the app${why ? `: ${why}` : ""}`);
    } else if (ago(s.rw.uploadedAt) > 45 * MIN) {
      fail(id, "failed", "the build is taking far longer than usual. Press Try again, or check the project in Railway.");
    }
  } catch (e) { safeLog("railway deploy", e); if (e instanceof ProviderError && e.status === 401) fail(id, "failed", e.message); }
}

async function tickRailDomain(id: number) {
  const s = getSetup(id);
  if (!hostOf(s)) {
    // No custom domain: the agency lives at Railway's own address. Done as soon as it answers.
    if (!due(`rw-dom:${id}`, fast ? 1500 : 5000)) return;
    const temp = webUrl(s.rw?.serviceDomain);
    const healthy = !!temp && (await fetch(`${temp}/api/health`, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false));
    setRw(id, (r) => { r.healthy = healthy; });
    if (healthy) { progress(id, `${temp} is ready`); finish(id, temp); }
    return;
  }
  const token = await railwayToken(id);
  if (!token || !s.rw?.customDomainId) return;
  if (!due(`rw-dom:${id}`, fast ? 2000 : 15_000)) return;
  const healthy = await fetch(`${webUrl(s.rw.serviceDomain)}/api/health`, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false);
  let cert = s.rw.certStatus, verified = false, records = s.rw.records || [];
  try {
    const cd = (await railway(token, `query($id: String!, $p: String!) { customDomain(id: $id, projectId: $p) { ${DOMAIN_FIELDS} } }`, { id: s.rw.customDomainId, p: s.rw.projectId })).customDomain;
    cert = String(cd.status?.certificateStatus || "");
    verified = !!cd.status?.verified;
    const fresh = railRecords(cd, hostOf(s), zoneOf(s), records);
    const byRail = new Map((cd.status?.dnsRecords || []).map((r: any) => [`${String(r.recordType).replace("DNS_RECORD_TYPE_", "")}:${bareValue(r.requiredValue)}`, r.status === "DNS_RECORD_STATUS_PROPAGATED"]));
    for (const r of fresh) {
      const live = await recordLive(r, zoneOf(s));
      r.ok = live.ok || byRail.get(`${r.type}:${r.value}`) === true || (r.type === "TXT" && verified);
      r.seen = live.seen;
    }
    records = fresh;
  } catch (e) { safeLog("railway domain", e); }
  const domainOk = cert === "CERTIFICATE_STATUS_TYPE_VALID";
  setRw(id, (r) => { r.records = records; r.certStatus = cert; r.healthy = healthy; r.domainOk = domainOk; });
  if (domainOk && healthy) {
    progress(id, `https://${hostOf(s)} is ready`);
    finish(id, `https://${hostOf(s)}`);
  }
}

// ======================= Update your agency (Railway) =======================
// The buyer's setup link keeps working after Done. When we publish a newer bundle it shows "Update available";
// "Update now" asks for a Railway token again, sends the newest app source to the SAME project and service (the
// database and every existing variable stay as they are; only variables the new version needs are added), waits
// for the build and for /api/health, records the new version, then deletes the token. If anything fails, Railway
// keeps the previous deployment running, so nothing is lost and the buyer can press Try again.
export interface UpdateInfo { installed: string; latest: string; available: boolean; notes: { version: string; lines: string[] }[] }
const notesLines = (n: string | null | undefined) => String(n || "").split("\n").map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean).slice(0, 40);

/** What version this agency is on, what's newest, and what changed in between. null when updating isn't possible (not a finished Railway install). */
export function updateInfo(b: { demo: number }, s: SetupData): UpdateInfo | null {
  if (s.phase !== "done") return null;
  const demo = b.demo === 1;
  if (!demo && !s.rw?.projectId) return null;
  const pkgs = listPackages().filter((p) => p.file.endsWith(".tgz"));
  const cur = currentPackage();
  // A test run pretends to be one version behind (or, with nothing published, on 0.9.0), so it always shows the banner.
  const latest = cur?.version || (demo ? "1.0.0" : "");
  if (!latest) return null;
  const installed = s.attemptVersion || (demo ? (pkgs.length > 1 ? pkgs[pkgs.length - 2].version : "0.9.0") : "");
  const at = pkgs.findIndex((p) => p.version === installed);
  let notes = (at >= 0 ? pkgs.slice(at + 1) : cur ? [cur] : []).filter((p) => p.notes).map((p) => ({ version: p.version, lines: notesLines(p.notes) }));
  if (demo && !notes.length && installed !== latest) notes = [{ version: latest, lines: ["A faster, smoother dashboard.", "Small fixes and improvements."] }];
  return { installed, latest, available: installed !== latest, notes };
}

/** Other code (support sync, ...) can give an update the variables a newer version needs. Only added when the agency doesn't already have them. */
export const updateVarHooks: ((buyerId: number, existing: Record<string, string>) => Record<string, string>)[] = [];
// The health heartbeat settings (sync.ts): added to agencies installed before it existed. Never re-made when present (that would cut the app off).
updateVarHooks.push((id, have) => ("SUPPORT_SYNC_TOKEN" in have ? {} : supportSettings(id)));

const UPDATE_TOKEN_MSG = "That token can't see your agency's project. Paste the token from the Railway account you installed with (workspace set to No workspace).";
/** Where the app's volume is mounted (the backups go to <this>/backups). */
export const APP_VOLUME_PATH = "/data";

/**
 * An agency installed before backups existed has no volume on its app service: add one (once). Returns true if it
 * created one. Best effort: a failure is logged and the update carries on (the app then keeps backups on its
 * temporary disk and says so in Settings, Backups).
 */
export async function ensureAppVolume(token: string, projectId: string, envId: string, appId: string): Promise<boolean> {
  try {
    const p = (await railway(token, "query($id: String!) { project(id: $id) { volumes { edges { node { id volumeInstances { edges { node { serviceId environmentId } } } } } } } }", { id: projectId })).project;
    const has = (p?.volumes?.edges || []).some((v: any) => (v.node?.volumeInstances?.edges || []).some((i: any) => String(i.node?.serviceId) === appId));
    if (has) return false;
    await railway(token, "mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }", { input: { projectId, environmentId: envId, serviceId: appId, mountPath: APP_VOLUME_PATH } });
    return true;
  } catch (e) {
    console.log(`[setup] couldn't add the app volume: ${(e as Error).message}`);
    return false;
  }
}

async function locateAgency(token: string, projectId: string): Promise<{ envId: string; appId: string }> {
  let p: any;
  try {
    p = (await railway(token, "query($id: String!) { project(id: $id) { id environments { edges { node { id name } } } services { edges { node { id name } } } } }", { id: projectId })).project;
  } catch (e) {
    if (e instanceof ProviderError && (e.status === 401 || /not found|not authorized|permission/i.test(e.message))) throw new ProviderError(UPDATE_TOKEN_MSG, e.status);
    throw e;
  }
  const envs = (p?.environments?.edges || []).map((x: any) => x.node);
  const svcs = (p?.services?.edges || []).map((x: any) => x.node);
  const env = envs.find((e: any) => e.name === "production") || envs[0];
  const app = svcs.find((x: any) => x.name === "app");
  if (!env || !app) throw new ProviderError("We couldn't find your agency in that Railway project (its app service may have been renamed or deleted).");
  return { envId: String(env.id), appId: String(app.id) };
}

const setUpdate = (id: number, fn: (u: NonNullable<SetupData["update"]>, s: SetupData) => void) => updateSetup(id, (s) => { if (s.update) fn(s.update, s); });
const failUpdate = (id: number, msg: string) => setUpdate(id, (u, s) => { u.phase = "failed"; u.error = msg; s.progress = [...(s.progress || []), "The update stopped. Your agency is still running as before."]; });
const runUpdate = (id: number) => { setUpdate(id, (u) => { u.phase = "running"; u.error = undefined; u.startedAt = now(); u.attempt = (u.attempt || 0) + 1; }); kick(id); };

actions["update-open"] = (b) => {
  const s = getSetup(b.id);
  const info = updateInfo(b, s);
  if (!info?.available || s.update?.phase === "running") return null;
  updateSetup(b.id, (s) => { s.update = { phase: "ask", from: info.installed, to: info.latest }; });
  return null;
};
actions["update-cancel"] = (b) => {
  const s = getSetup(b.id);
  if (!s.update || s.update.phase === "running") return null;
  if (b.demo !== 1) deleteSecret(b.id, "railway_token");
  updateSetup(b.id, (s) => { delete s.update; });
  return null;
};
actions["update-start"] = async (b, f) => {
  const s = getSetup(b.id);
  const info = updateInfo(b, s);
  if (!info?.available || !s.update || !["ask", "failed"].includes(s.update.phase)) return null;
  const wait = allow(`update:${b.id}`, 6, 10 * MIN); if (wait) return tooMany(wait);
  let loc = { envId: "", appId: "" };
  if (b.demo !== 1) {
    // The same check as the Railway step, then: can this token see this agency's project?
    const token = str(f.token, 300) || getSecret(b.id, "railway_token") || "";
    if (!token) return err("Paste your Railway token.");
    const r = await checkRailway(token);
    if (!r.ok) return err(r.message);
    try { loc = await locateAgency(token, s.rw!.projectId!); } catch (e) { return err(errMsg(e)); }
    putSecret(b.id, "railway_token", token);
  }
  updateSetup(b.id, (s) => {
    s.update = { phase: "ask", from: info.installed, to: info.latest, envId: loc.envId || undefined, appId: loc.appId || undefined, attempt: s.update?.attempt };
    s.progress = []; delete s.flash;
  });
  logClear(b.id);
  runUpdate(b.id);
  return null;
};
actions["update-retry"] = (b) => {
  const s = getSetup(b.id);
  if (s.update?.phase !== "failed") return null;
  if (b.demo !== 1 && !hasSecret(b.id, "railway_token")) { setUpdate(b.id, (u) => { u.phase = "ask"; }); return err("Paste your Railway token again to carry on."); }
  const wait = allow(`update:${b.id}`, 6, 10 * MIN); if (wait) return tooMany(wait);
  // A build that already succeeded is kept (we only check it answers); a failed one is sent again.
  setUpdate(b.id, (u) => { if (u.deployStatus !== "SUCCESS") { delete u.deploymentId; delete u.deployStatus; delete u.uploadedAt; } delete u.healthSince; });
  runUpdate(b.id);
  return { kind: "info", text: "Trying the update again. Your agency keeps running as it is until the new version is ready." };
};

/** One step of the update per tick, like tickRailCreate: each piece is saved as it's done, so a retry carries on. */
async function tickUpdate(id: number) {
  const s = getSetup(id);
  const u = s.update;
  if (!u || u.phase !== "running") return;
  if (isDemoBuyer(id)) return tickDemoUpdate(id);
  const token = await railwayToken(id);
  if (!token || !s.rw?.projectId) return failUpdate(id, "We don't have your Railway token any more. Press Try again and paste it.");
  const projectId = s.rw.projectId;
  try {
    if (!u.envId || !u.appId) {
      progress(id, "Finding your agency in Railway");
      const loc = await locateAgency(token, projectId);
      setUpdate(id, (u) => { u.envId = loc.envId; u.appId = loc.appId; });
      return;
    }
    const base = { projectId, environmentId: u.envId };
    if (!u.varsSet) {
      progress(id, "Adding any new settings (your existing ones stay as they are)");
      const have = ((await railway(token, "query($p: String!, $e: String!, $s: String!) { variables(projectId: $p, environmentId: $e, serviceId: $s) }", { p: projectId, e: u.envId, s: u.appId })).variables || {}) as Record<string, string>;
      const to = currentPackage()?.version || u.to || "";
      const add: Record<string, string> = {};
      for (const h of updateVarHooks) for (const [k, v] of Object.entries(h(id, have))) if (!(k in have) && !(k in add)) add[k] = v;
      if (!("RAILWAY_RUN_UID" in have)) add.RAILWAY_RUN_UID = "0"; // so the app can write to its backup volume
      add.APP_VERSION = to; // ours: says which version this agency is
      // Automatic updates: a new project token for the app if it has none yet, its last automatic update failed, or its
      // latest heartbeat says automatic updates are unavailable (a token Railway no longer accepts). Not kept by us.
      if (needsProjectToken(have, latestSnapshot(id))) {
        Object.assign(add, await autoUpdateVars(id, token, { projectId, environmentId: u.envId, serviceId: u.appId }));
      }
      await railway(token, "mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }", { input: { ...base, serviceId: u.appId, variables: add, skipDeploys: true } });
      setUpdate(id, (u) => { u.varsSet = true; u.to = to; });
      return;
    }
    if (!u.volumeSet) {
      if (await ensureAppVolume(token, projectId, u.envId, u.appId)) progress(id, "Adding a volume for your daily backups");
      setUpdate(id, (u) => { u.volumeSet = true; });
      return;
    }
    if (!u.deploymentId) {
      progress(id, u.attempt && u.attempt > 1 ? `Sending version ${u.to} to Railway again` : `Sending version ${u.to} to Railway to build`);
      const src = await appSource();
      const up = await railwayUpload(token, projectId, u.envId, u.appId, src, `${s.brand?.productName || "Agency"} ${u.to || ""}`.trim());
      setUpdate(id, (u) => { u.deploymentId = up.deploymentId; u.deployStatus = "QUEUED"; u.uploadedAt = now(); });
      logClear(id);
      return;
    }
    if (u.deployStatus !== "SUCCESS") {
      if (!due(`up-dep:${id}`, fast ? 2000 : 6000)) return;
      const d = (await railway(token, "query($id: String!) { deployment(id: $id) { id status } }", { id: u.deploymentId })).deployment;
      const st = String(d.status);
      if (st !== u.deployStatus) setUpdate(id, (u) => { u.deployStatus = st; });
      if (due(`up-log:${id}`, fast ? 3000 : 12_000) || ["SUCCESS", "FAILED", "CRASHED"].includes(st)) await railLogs(id, token, u.deploymentId, st !== "BUILDING" && st !== "QUEUED");
      if (st === "SUCCESS") { setUpdate(id, (u, s) => { u.healthSince = now(); s.progress = [...(s.progress || []), "The new version is running on Railway"]; }); kick(id); }
      else if (["FAILED", "CRASHED", "REMOVED", "SKIPPED"].includes(st)) {
        const { text } = logRead(id);
        const why = text.split("\n").reverse().find((l) => /error|failed|exit code/i.test(l))?.trim().slice(0, 200);
        failUpdate(id, `${st === "CRASHED" ? "The new version started but then stopped" : "Railway couldn't build the new version"}${why ? `: ${why}` : ""}. Your agency is still running version ${u.from || "as before"}, with all your data.`);
      } else if (ago(u.uploadedAt) > 45 * MIN) failUpdate(id, `The build is taking far longer than usual. Your agency is still running version ${u.from || "as before"}. Press Try again, or check the project in Railway.`);
      return;
    }
    // Built and running on Railway: wait until the live address answers.
    if (!due(`up-health:${id}`, fast ? 1500 : 5000)) return;
    const urls = [...new Set([s.domainPending && s.tempUrl ? s.tempUrl : agencyUrl(s), s.tempUrl].filter(Boolean) as string[])];
    let healthy = false;
    for (const url of urls) if (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false)) { healthy = true; break; }
    if (healthy) return finishUpdate(id);
    if (ago(u.healthSince) > 5 * MIN) failUpdate(id, `The new version was built but isn't answering at ${urls[0] || "your address"} yet. Wait a minute and press Try again.`);
  } catch (e) {
    safeLog("update", e);
    if (e instanceof ProviderError && e.status !== 429 && e.status < 500) failUpdate(id, errMsg(e));
    else if (!(e instanceof ProviderError)) failUpdate(id, errMsg(e));
  }
}

/** The new version is live: record it, forget the token again. */
function finishUpdate(id: number) {
  const removed = deleteSecret(id, "railway_token").changes;
  const s = getSetup(id);
  const u = s.update!;
  updateSetup(id, (s) => {
    s.attemptVersion = u.to; s.update = { phase: "done", from: u.from, to: u.to, at: now() };
    s.progress = [...(s.progress || []), `Your agency is now on version ${u.to}`];
    s.flash = { kind: "ok", text: `Your agency is now on version ${u.to}.` };
  });
  console.log(`[setup] buyer ${id}: updated ${u.from || "?"} -> ${u.to}; ${removed} token deleted`);
}

/** Test runs: the same stages tick by, nothing is called, no token is kept. */
async function tickDemoUpdate(id: number) {
  const still = () => getSetup(id).update?.phase === "running" && !!db().query("SELECT 1 FROM buyers WHERE id = ?").get(id);
  const stages: [string, (u: NonNullable<SetupData["update"]>) => void][] = [
    ["Finding your agency in Railway", (u) => { u.envId = "demo"; u.appId = "demo"; }],
    ["Adding any new settings (your existing ones stay as they are)", (u) => { u.varsSet = true; }],
    ["Sending the new version to Railway to build", (u) => { u.deploymentId = "demo"; u.deployStatus = "BUILDING"; }],
    ["Building the app", (u) => { u.deployStatus = "DEPLOYING"; }],
    ["The new version is running on Railway", (u) => { u.deployStatus = "SUCCESS"; }],
  ];
  for (const [msg, fn] of stages) {
    if (!still()) return;
    await sleep(1000);
    if (!still()) return;
    updateSetup(id, (s) => { fn(s.update!); s.progress = [...(s.progress || []), msg]; });
  }
  await sleep(800);
  if (still()) finishUpdate(id);
}
