// The wizard's engine: one state machine per buyer, kept in SQLite, so any number of
// buyers can be part-way through at once and a closed tab (or a restarted site) loses nothing.
//   actions   one function per form the buyer can submit
//   tick()    background work (create the droplet, write DNS, watch DNS, watch Resend)
//   p*()      the endpoints the buyer's new server calls (it calls us; we never call it)
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG, PACKAGES_DIR, RAILWAY, currentPackage, db, now, slug, type Buyer } from "./lib";
import {
  DEFAULT_REGION, DEFAULT_SIZE, ProviderError, cfCanEdit, cfEnsure, cfFindZone, cfHasDmarc, cfRecords, cfZone, checkCloudflare,
  checkDigitalOcean, checkGoogle, checkMicrosoft, checkRailway, checkResend, checkSmtp, checkTelnyx, doApi, lookup, normalizeDomain,
  railway, railwayUpload, recordLive, resendDomain, resendSend, resendSendingKey, resendStatus, resendVerify, smtpSend, smtpUrl,
} from "./providers";
import {
  STEPS, buyerByAttemptToken, buyerByDropletToken, deleteAllSecrets, getSecret, getSetup, hasSecret, logAppend, logBytes,
  logClear, logRead, newToken, putSecret, redact, saveSetup, secretValues, setAttemptToken, setDropletToken, updateSetup,
  activeSetups, deleteSecret, staleSecretBuyers, type DnsRecord, type SetupData, type StepId,
} from "./store";
import { USER_DATA_LIMIT, buildEnv, buildUserData } from "./userdata";

const MIN = 60_000;
const ago = (iso?: string) => (iso ? Date.now() - Date.parse(iso) : Infinity);
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isEmail = (v: string) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) && v.length <= 200;
const LOGO_MAX = 30_000; // characters of PNG data URL: it rides along as one setting (a DigitalOcean server's settings are capped at 64 KB)
const pngBytes = (dataUrl: string) => { try { const b = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"); return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; } catch { return false; } };
const errMsg = (e: unknown) => (e instanceof ProviderError ? e.message : "Something went wrong on our side. Try again in a minute.");
const safeLog = (where: string, e: unknown) => console.error(`[setup] ${where}: ${e instanceof ProviderError ? `provider error ${e.status} ${e.code}` : (e as Error)?.name || "error"}`);

export type Flash = NonNullable<SetupData["flash"]>;
const ok = (text: string): Flash => ({ kind: "ok", text });
const err = (text: string, form?: Record<string, string>): Flash => ({ kind: "err", text, form });

// ---------------- rate limits (per buyer, in memory) ----------------
const buckets = new Map<string, number[]>();
export function allow(key: string, max: number, windowMs: number): number {
  const t = Date.now();
  const arr = (buckets.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return Math.ceil((arr[0] + windowMs - t) / 1000); }
  arr.push(t); buckets.set(key, arr);
  return 0;
}
const tooMany = (secs: number) => err(`You've tried that a lot in a short time. Please wait ${secs > 90 ? `${Math.ceil(secs / 60)} minutes` : `${secs} seconds`} and try again.`);
const checkLimit = (b: Buyer) => allow(`check:${b.id}`, CONFIG.checksPer10Min, 10 * MIN);

// ---------------- steps ----------------
export function stepDone(b: Buyer, s: SetupData, id: StepId): boolean {
  switch (id) {
    case "welcome": return s.step !== "welcome" || !!s.brand;
    case "brand": return !!s.brand;
    case "domain": return !!s.domain?.confirmed && !!s.domain.host;
    case "server": return !!s.server?.chosen && (b.demo === 1 || hasSecret(b.id, "do_token") || s.phase !== "idle");
    case "railway": return !!s.railway?.confirmed && (b.demo === 1 || hasSecret(b.id, "railway_token") || s.phase !== "idle");
    case "phones": return !!s.phones?.confirmed;
    case "email": return !!s.email?.confirmed;
    case "calendars": return !!s.calendars?.done;
    case "install": return s.phase === "done";
    case "done": return s.phase === "done";
  }
}
export const firstOpen = (b: Buyer, s: SetupData): StepId => STEPS.find((id) => !stepDone(b, s, id)) || "done";
export const canView = (b: Buyer, s: SetupData, id: StepId) => CONFIG.previewJump || STEPS.indexOf(id) <= STEPS.indexOf(firstOpen(b, s));
/** Settings are baked into the server when it's made; after that they can't change here. */
export const locked = (s: SetupData) => s.phase !== "idle";
const nextStep = (b: Buyer, s: SetupData, from: StepId) => {
  const i = STEPS.indexOf(from);
  s.step = STEPS.slice(i + 1).find((id) => !stepDone(b, s, id) || id === "done") || "done";
};

export const zoneOf = (s: SetupData) => s.domain?.zone || "";
export const hostOf = (s: SetupData) => s.domain?.host || "";
export const oauthRedirect = (s: SetupData, p: "google" | "microsoft") => `https://${hostOf(s) || "app.your-domain"}/api/oauth/${p}/callback`;
/** Railway's own address for the app: https, except the local fake (localhost:<port>). */
export const webUrl = (domain?: string) => (!domain ? "" : /^(localhost|127\.)/.test(domain) ? `http://${domain}` : `https://${domain}`);

// ======================= actions =======================
type Form = Record<string, string>;
export type Action = (b: Buyer, f: Form) => Promise<Flash | null> | Flash | null;

const LOCKED_MSG = "Your server has already been made with these settings. To change them, delete the server on the Install step first.";
function guard(b: Buyer, step: StepId): Flash | null {
  const s = getSetup(b.id);
  if (s.phase === "done") return err("Your install is finished.");
  if (step !== "install" && locked(s)) return err(LOCKED_MSG);
  if (!canView(b, s, step)) return err("Finish the earlier steps first.");
  return null;
}
const go = (b: Buyer, from: StepId) => updateSetup(b.id, (s) => nextStep(b, s, from));

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
    const keep = { productName: f.productName || "", ownerEmail: f.ownerEmail || "" };
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
      const colour = /^#[0-9a-fA-F]{6}$/.test(f.colour || "") ? f.colour.toLowerCase() : s.brand?.colour;
      s.brand = { productName, ownerEmail, ownPhoneAccount: false, logo, colour }; nextStep(b, s, "brand");
    });
    return null;
  },

  // ---- Domain: type it, choose who handles DNS, (Cloudflare) paste a token ----
  async domain(b, f) {
    const g = guard(b, "domain"); if (g) return g;
    if (RAILWAY) return domainRailway(b, f);
    const s = getSetup(b.id);
    const domain = normalizeDomain(str(f.domain, 253) || s.domain?.zone || "");
    const mode = f.mode === "manual" ? "manual" : "cloudflare";
    if (!domain) return err("Type your domain, like yourcompany.com.", f);
    const sub = "app";
    const resetEmail = (s: SetupData) => { if ((s.domain?.zone !== domain || s.domain?.mode !== mode) && s.email) { delete s.email.resend; s.email.confirmed = false; s.email.checked = false; } };
    if (mode === "manual") {
      deleteSecret(b.id, "cf_token");
      updateSetup(b.id, (s) => { resetEmail(s); s.domain = { mode: "manual", zone: domain, sub, host: `${sub}.${domain}`, confirmed: true }; nextStep(b, s, "domain"); });
      return null;
    }
    const token = str(f.token, 300) || (s.domain?.mode === "cloudflare" ? getSecret(b.id, "cf_token") : null) || "";
    if (!token) return err("Paste your Cloudflare token.", { domain, mode });
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    const r = await checkCloudflare(token);
    if (!r.ok) return err(r.message, { domain, mode });
    const zone = await cfFindZone(token, domain).catch(() => null);
    if (!zone) return err(`This token can't see ${domain}. Add it to Cloudflare first, or make the token for it.`, { domain, mode });
    putSecret(b.id, "cf_token", token);
    updateSetup(b.id, (s) => { resetEmail(s); s.domain = { mode: "cloudflare", zone: zone.name, sub, cf: { zones: [zone], replace: f.replace === "1" || (s.domain?.cf?.zoneId === zone.id && !!s.domain.cf.replace) } }; });
    const res = await applyZone(b.id, zone.id, sub, f.replace === "1" || !!getSetup(b.id).domain?.cf?.replace);
    const d = getSetup(b.id).domain!;
    if (d.cf?.status === "active" && d.cf.canEdit && (!d.cf.existing || d.cf.replace)) {
      updateSetup(b.id, (s) => { s.domain!.confirmed = true; nextStep(b, s, "domain"); });
      return null;
    }
    return res && res.kind === "err" ? res : null;
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
    updateSetup(b.id, (s) => { if (s.domain) { s.domain.confirmed = false; if (RAILWAY && s.domain.mode === "manual") delete s.domain.host; if (s.domain.cf) s.domain.cf = { zones: s.domain.cf.zones }; } });
    return null;
  },
  async "cf-recheck"(b) {
    const g = guard(b, "domain"); if (g) return g;
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    const s = getSetup(b.id);
    if (!s.domain?.cf?.zoneId) return err("Type your domain first.");
    return applyZone(b.id, s.domain.cf.zoneId, s.domain.sub, !!s.domain.cf.replace);
  },

  // ---- Server (DigitalOcean): token + where + size, one button ----
  async server(b, f) {
    const g = guard(b, "server"); if (g) return g;
    const s0 = getSetup(b.id);
    const token = str(f.token, 300) || getSecret(b.id, "do_token") || "";
    if (!token) return err("Paste your DigitalOcean token.", f);
    const key = str(f.sshPublicKey, 4000).replace(/\s+/g, " ");
    if (key && !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/]+=*( [^\s]{0,100})?$/.test(key)) return err("That SSH key doesn't look right: paste the one line from your .pub file.", f);
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    const r = await checkDigitalOcean(token);
    if (!r.ok) return err(r.message, f);
    putSecret(b.id, "do_token", token);
    const region = r.regions.find((x) => x.slug === (f.region || s0.server?.region || DEFAULT_REGION)) || r.regions.find((x) => x.slug === DEFAULT_REGION) || r.regions[0];
    const size = r.sizes.find((x) => x.slug === (f.size || s0.server?.size || DEFAULT_SIZE)) || r.sizes.find((x) => x.slug === DEFAULT_SIZE) || r.sizes[0];
    const fits = !size.regions.length || size.regions.includes(region.slug);
    updateSetup(b.id, (s) => {
      s.server = { accountEmail: r.accountEmail, regions: r.regions, sizes: r.sizes, region: region.slug, size: size.slug, price: size.price, sshPublicKey: key || undefined, chosen: fits };
      if (fits) nextStep(b, s, "server");
    });
    return fits ? null : err("That size isn't offered in that location. Pick another.", f);
  },

  // ---- Railway: an account token; we check it and the plan ----
  async railway(b, f) {
    const g = guard(b, "railway"); if (g) return g;
    const token = str(f.token, 300) || getSecret(b.id, "railway_token") || "";
    if (!token) return err("Paste your Railway token.");
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    const r = await checkRailway(token);
    if (!r.ok) return err(r.message);
    putSecret(b.id, "railway_token", token);
    updateSetup(b.id, (s) => { s.railway = { email: r.email, workspaceId: r.workspace.id, workspaceName: r.workspace.name, plan: r.workspace.plan, confirmed: true }; nextStep(b, s, "railway"); });
    return null;
  },

  // ---- Phones (Telnyx): the buyer's key is the app's main Telnyx key ----
  async phones(b, f) {
    const g = guard(b, "phones"); if (g) return g;
    const key = str(f.key, 300) || getSecret(b.id, "telnyx_key") || "";
    if (!key) return err("Paste your Telnyx API key.", f);
    const wait = checkLimit(b); if (wait) return tooMany(wait);
    const r = await checkTelnyx(key);
    if (!r.ok) return err(r.message, f);
    putSecret(b.id, "telnyx_key", key);
    updateSetup(b.id, (s) => {
      s.brand!.ownPhoneAccount = false;
      s.phones = { balance: r.balance, checked: true, confirmed: true };
      nextStep(b, s, "phones");
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
    if (RAILWAY && !s.domain?.confirmed) return emailBeforeDomain(b, f);
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
      if (s.domain?.mode === "cloudflare") {
        const cfTok = getSecret(b.id, "cf_token")!;
        needDmarc = !(await cfHasDmarc(cfTok, s.domain.cf!.zoneId!, zone));
        for (const rec of d.records) rec.cfId = await cfEnsure(cfTok, s.domain.cf!.zoneId!, rec);
        if (needDmarc) dmarc.cfId = await cfEnsure(cfTok, s.domain.cf!.zoneId!, dmarc);
      } else {
        needDmarc = !(await lookup("TXT", dmarc.name, zone)).some((v) => /^v=DMARC1/i.test(v));
      }
      if (d.status !== "verified") await resendVerify(key, d.id).catch(() => {});
      updateSetup(b.id, (s) => {
        s.email = { mode: "resend", address, sendingDomain, from: `${s.brand!.productName} <${address}>`, checked: true, resend: { domainId: d.id, status: d.status === "verified" ? "verified" : "pending", records: d.records, dmarc: needDmarc ? dmarc : null, written: s.domain?.mode === "cloudflare", verifyAt: now(), lastCheck: undefined } };
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
    const r = await checkSmtp(url);
    if (!r.ok) return err(r.message, { ...f, pass: "" });
    putSecret(b.id, "smtp_password", pass);
    const s = getSetup(b.id);
    const from = `${s.brand!.productName} <${address}>`;
    const sent = allow(`testmail:${b.id}`, CONFIG.testEmailsPerHour, 60 * MIN) ? null : await smtpSend(url, from, s.brand!.ownerEmail, s.brand!.productName);
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

  // ---- Calendars (optional): whatever is filled in is checked, one button ----
  async calendars(b, f) {
    const g = guard(b, "calendars"); if (g) return g;
    const s = getSetup(b.id);
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
    updateSetup(b.id, (s) => { s.calendars = { done: true }; nextStep(b, s, "calendars"); });
    return null;
  },

  // ---- Install ----
  "install-start"(b) {
    const g = guard(b, "install"); if (g) return g;
    const s = getSetup(b.id);
    if (!["idle", "create_failed"].includes(s.phase)) return null;
    const missing = STEPS.slice(0, STEPS.indexOf("install")).find((id) => !stepDone(b, s, id));
    if (missing) return err("Finish the earlier steps first.");
    if (RAILWAY ? !hasSecret(b.id, "railway_token") : !hasSecret(b.id, "do_token")) return err(RAILWAY ? "Your Railway token is missing. Go back to the Railway step and check it again." : "Your DigitalOcean token is missing. Go back to the Server step and check it again.");
    if (!currentPackage()) return err("The app isn't ready to install yet. We've been told; please try again later or contact support.");
    const wait = allow(`install:${b.id}`, 6, 10 * MIN); if (wait) return tooMany(wait);
    updateSetup(b.id, (s) => { s.phase = "creating"; s.error = undefined; if (!s.dropletId && !s.rw?.projectId) s.progress = []; s.step = "install"; });
    kick(b.id);
    return null;
  },
  // Railway: the app runs at its temporary address; finish without waiting for app.<domain>.
  "install-finish"(b) {
    const g = guard(b, "install"); if (g) return g;
    const s = getSetup(b.id);
    if (!RAILWAY || s.phase !== "domain") return null;
    if (busy.has(b.id)) return err("One moment: we're still checking. Try again in a few seconds.");
    finish(b.id, `https://${hostOf(s)}`);
    return null;
  },
  "dns-skip"(b) {
    const g = guard(b, "install"); if (g) return g;
    const s = getSetup(b.id);
    if (s.phase !== "dns") return null;
    if ((s.dnsChecks || 0) < 3) return err("Give it a minute: we're still checking.");
    updateSetup(b.id, (s) => { s.dnsSkipped = true; startAttempt(s); });
    return { kind: "info", text: "Starting the install. If your address still doesn't point at the server, the install will stop and tell you, and you can try again." };
  },
  "install-retry"(b) {
    const g = guard(b, "install"); if (g) return g;
    const s = getSetup(b.id);
    if (s.phase !== "failed") return null;
    const wait = allow(`install:${b.id}`, 6, 10 * MIN); if (wait) return tooMany(wait);
    if (RAILWAY) {
      // Same project, database and settings: send the app again for a fresh build.
      updateSetup(b.id, (s) => { s.phase = "creating"; s.error = undefined; s.attempt = (s.attempt || 1) + 1; if (s.rw) { delete s.rw.deploymentId; delete s.rw.deployStatus; } });
      kick(b.id);
      return { kind: "info", text: "Building the app again in the same Railway project." };
    }
    if (ago(s.lastSeenAt) > 3 * MIN) return err("Your server stopped checking in, so it can't try again. Delete it, then press Install.");
    updateSetup(b.id, (s) => { startAttempt(s); s.error = undefined; });
    return { kind: "info", text: "Trying the install again on the same server." };
  },
  async "server-delete"(b) {
    const g = guard(b, "install"); if (g) return g;
    if (RAILWAY) return deleteRailwayProject(b);
    const s = getSetup(b.id);
    const token = getSecret(b.id, "do_token");
    if (!token) return err("We no longer hold your DigitalOcean token: delete the server in DigitalOcean, under Droplets.");
    if (busy.has(b.id)) return err("One moment: we're still working on your server. Try again in a few seconds.");
    busy.add(b.id);
    try {
      if (s.dropletId) await doApi(token, "DELETE", `/v2/droplets/${s.dropletId}`).catch((e) => { if (!(e instanceof ProviderError && e.status === 404)) throw e; });
      if (s.aRecord?.cfId && s.domain?.mode === "cloudflare") {
        const cfTok = getSecret(b.id, "cf_token");
        if (cfTok) await fetchDelete(cfTok, s.domain.cf!.zoneId!, s.aRecord.cfId).catch(() => {});
      }
    } catch (e) { return err(errMsg(e)); } finally { busy.delete(b.id); }
    setDropletToken(b.id, null); setAttemptToken(b.id, null); logClear(b.id);
    updateSetup(b.id, (s) => {
      for (const k of ["dropletId", "ip", "aRecord", "dnsChecks", "dnsSkipped", "attempt", "attemptIssuedAt", "bundleFetches", "lastSeenAt", "lastLogAt", "installStep", "error", "serverCreatedAt", "pendingAttempt"] as const) delete (s as any)[k];
      s.phase = "idle"; s.progress = [];
    });
    return ok("Server deleted. Press Install to make a new one.");
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
  server(b) {
    const g = guard(b, "server"); if (g) return g;
    updateSetup(b.id, (s) => { s.server = { region: DEFAULT_REGION, size: DEFAULT_SIZE, price: 18, chosen: true }; nextStep(b, s, "server"); });
    return null;
  },
  phones(b) {
    const g = guard(b, "phones"); if (g) return g;
    updateSetup(b.id, (s) => { s.brand!.ownPhoneAccount = false; s.phones = { balance: "demo", checked: true, confirmed: true }; nextStep(b, s, "phones"); });
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
    const missing = STEPS.slice(0, STEPS.indexOf("install")).find((id) => !stepDone(b, s, id));
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
    ["Adding the app and your settings", (s) => { s.rw!.deploymentId = "demo"; s.phase = "deploying"; s.rw!.deployStatus = "BUILDING"; }],
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

async function fetchDelete(cfTok: string, zoneId: string, id: string) {
  const { CF_API } = await import("./providers");
  await fetch(`${CF_API}/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${cfTok}` }, signal: AbortSignal.timeout(15000) });
}

function startAttempt(s: SetupData) {
  s.phase = "starting";
  s.pendingAttempt = (s.attempt || 0) + 1;
  s.lastLogAt = undefined;
  s.installStep = undefined;
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
const fast = CONFIG.mockDO; // the fakes answer instantly, so check more often in test mode

/** Run this buyer's background step now (e.g. right after they click Install). */
export function kick(buyerId: number) { lastRun.delete(`do:${buyerId}`); void tickOne(buyerId); }

export function startTicker() {
  const t = setInterval(() => { for (const { buyerId } of activeSetups()) void tickOne(buyerId); }, fast ? 1500 : 3000);
  t.unref?.();
  // A setup nobody has touched for SECRETS_IDLE_DAYS (14) loses its stored keys; they paste them again if they come back.
  const purge = () => {
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
  if (!["creating", "dns", "starting", "installing", "deploying", "domain"].includes(s.phase) && !wantsEmail && !wantsDomain) return;
  busy.add(id);
  try {
    if (isDemoBuyer(id)) { if (["creating", "deploying"].includes(s.phase)) await tickDemoInstall(id); }
    else if (RAILWAY && s.phase === "creating") await tickRailCreate(id);
    else if (s.phase === "deploying") await tickRailDeploy(id);
    else if (s.phase === "domain") await tickRailDomain(id);
    else if (s.phase === "creating") await tickCreate(id);
    else if (s.phase === "dns") await tickDns(id);
    else if (s.phase === "starting" || s.phase === "installing") tickWatch(id);
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

/** The logo and colour from the Brand step. The app applies them once, when the owner first signs up. */
function brandSettings(s: SetupData): Record<string, string> {
  const v: Record<string, string> = {};
  if (s.brand?.logo) v.BRAND_LOGO_PNG = s.brand.logo.slice(s.brand.logo.indexOf(",") + 1);
  if (s.brand?.colour) v.BRAND_COLOUR = s.brand.colour;
  return v;
}

function buildSettings(id: number, s: SetupData): string {
  const resendKey = getSecret(id, "resend_key");
  const smtp = s.email?.mode === "resend" ? `smtps://resend:${resendKey}@smtp.resend.com:465` : smtpUrl(s.email!.smtp!.host, s.email!.smtp!.port, s.email!.smtp!.user, getSecret(id, "smtp_password") || "");
  return buildEnv({
    PRODUCT_NAME: s.brand!.productName,
    DOMAIN: hostOf(s),
    FIRST_ADMIN_EMAIL: s.brand!.ownerEmail,
    TELNYX_API_KEY: getSecret(id, "telnyx_key") || "",
    ...brandSettings(s),
    OWN_PHONE_ACCOUNT: "", // the buyer is the agency: every client runs on their Telnyx key
    SMTP_URL: smtp,
    MAIL_FROM: s.email!.from || "",
    GOOGLE_CLIENT_ID: s.calendars?.google?.clientId || "",
    GOOGLE_CLIENT_SECRET: s.calendars?.google ? getSecret(id, "google_secret") || "" : "",
    MICROSOFT_CLIENT_ID: s.calendars?.microsoft?.clientId || "",
    MICROSOFT_CLIENT_SECRET: s.calendars?.microsoft ? getSecret(id, "microsoft_secret") || "" : "",
  });
}

async function tickCreate(id: number) {
  let s = getSetup(id);
  const token = getSecret(id, "do_token");
  if (!token) return fail(id, "create_failed", "Your DigitalOcean token is missing. Go back to the Server step and check it again.");
  try {
    if (!s.dropletId) {
      let sshKeys: number[] = [];
      if (s.server?.sshPublicKey && !s.sshKeyAdded) {
        progress(id, "Adding your SSH key to DigitalOcean");
        try {
          const r = await doApi(token, "POST", "/v2/account/keys", { name: `${slug(s.brand!.productName)} owner key`, public_key: s.server.sshPublicKey });
          sshKeys = [r.ssh_key.id];
        } catch (e) {
          if (!(e instanceof ProviderError && e.status === 422)) throw e;
          const all = await doApi(token, "GET", "/v2/account/keys?per_page=200");
          const k = (all.ssh_keys || []).find((k: any) => String(k.public_key).trim().split(" ").slice(0, 2).join(" ") === s.server!.sshPublicKey!.split(" ").slice(0, 2).join(" "));
          if (!k) throw e;
          sshKeys = [k.id];
        }
      }
      const dtok = newToken("d");
      const userData = buildUserData({ dropletToken: dtok, env: buildSettings(id, s), productName: s.brand!.productName, testMode: CONFIG.mockDO });
      if (Buffer.byteLength(userData) > USER_DATA_LIMIT) return fail(id, "create_failed", "Your settings are too long to send to DigitalOcean (64 KB limit). Contact support.");
      progress(id, `Creating your server in DigitalOcean (${s.server!.size}, ${s.server!.regions?.find((r) => r.slug === s.server!.region)?.name || s.server!.region})`);
      setDropletToken(id, dtok);
      const r = await doApi(token, "POST", "/v2/droplets", {
        name: `${slug(s.brand!.productName)}-server`.replace(/[^a-z0-9.-]/g, "-").slice(0, 60),
        region: s.server!.region, size: s.server!.size, image: "ubuntu-24-04-x64",
        ssh_keys: sshKeys, tags: ["receptionist"], monitoring: true, ipv6: false, backups: false, user_data: userData,
      });
      updateSetup(id, (s) => { s.dropletId = r.droplet.id; s.serverCreatedAt = now(); s.sshKeyAdded = sshKeys.length > 0; });
      progress(id, "Waiting for DigitalOcean to switch it on (usually about a minute)");
      return;
    }
    if (!due(`do-poll:${id}`, fast ? 1000 : 5000)) return;
    let d: any;
    try {
      d = (await doApi(token, "GET", `/v2/droplets/${s.dropletId}`)).droplet;
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) {
        updateSetup(id, (s) => { delete s.dropletId; s.progress = [...(s.progress || []), "The server we made earlier is gone, so we'll make a new one"]; });
        return;
      }
      throw e;
    }
    const ip = d?.networks?.v4?.find((n: any) => n.type === "public")?.ip_address;
    if (d.status === "errored") return fail(id, "create_failed", "DigitalOcean couldn't start the server. Delete it and try again, or pick another region.");
    if (d.status !== "active" || !ip) {
      if (ago(s.serverCreatedAt) > 15 * MIN) return fail(id, "create_failed", "DigitalOcean is taking unusually long to start your server. Wait a few minutes and press Try again, or delete it.");
      return;
    }
    s = updateSetup(id, (s) => {
      s.ip = ip;
      s.aRecord = { key: "a", purpose: "Your dashboard", type: "A", name: hostOf(s), value: ip, ttl: s.domain?.mode === "cloudflare" ? "Auto" : 300 };
      s.phase = "dns"; s.dnsChecks = 0;
      s.progress = [...(s.progress || []), `Your server is on, at ${ip}`];
    });
  } catch (e) {
    safeLog("create", e);
    fail(id, "create_failed", errMsg(e));
  }
}

async function tickDns(id: number) {
  const s = getSetup(id);
  if (s.domain?.mode === "cloudflare" && !s.aRecord?.cfId) {
    const token = getSecret(id, "cf_token");
    if (!token) return fail(id, "create_failed", "Your Cloudflare token is missing. Delete the server, check the token on the Domain step, and start again.");
    try {
      const cfId = await cfEnsure(token, s.domain.cf!.zoneId!, s.aRecord!);
      updateSetup(id, (s) => { s.aRecord!.cfId = cfId; s.progress = [...(s.progress || []), `Pointed ${hostOf(s)} at your server in Cloudflare`]; });
    } catch (e) {
      safeLog("cf A", e);
      return fail(id, "create_failed", `We couldn't add the DNS record in Cloudflare: ${errMsg(e)}`);
    }
    return;
  }
  if (!due(`dns:${id}`, fast ? 1500 : 10_000)) return;
  const live = await recordLive(s.aRecord!, zoneOf(s));
  updateSetup(id, (s) => {
    s.dnsChecks = (s.dnsChecks || 0) + 1;
    s.aRecord!.ok = live.ok; s.aRecord!.seen = live.seen;
    if (live.ok) { s.progress = [...(s.progress || []), `${hostOf(s)} now points at your server`]; startAttempt(s); }
  });
}

function tickWatch(id: number) {
  const s = getSetup(id);
  if (s.phase === "starting" && ago(s.serverCreatedAt) > 20 * MIN && ago(s.lastSeenAt) > 15 * MIN)
    return fail(id, "failed", "Your server hasn't checked in with us. It may not have started properly. Delete the server and start the install again.");
  if (s.phase === "installing" && ago(s.lastLogAt) > 25 * MIN)
    return fail(id, "failed", "Your server stopped sending progress. If it doesn't come back in a few minutes, delete the server and start again.");
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
  const r = s.email!.mode === "resend"
    ? await resendSend(getSecret(id, "resend_key")!, s.email!.from!, to, s.brand!.productName)
    : await smtpSend(smtpUrl(s.email!.smtp!.host, s.email!.smtp!.port, s.email!.smtp!.user, getSecret(id, "smtp_password")!), s.email!.from!, to, s.brand!.productName);
  if (r.ok) updateSetup(id, (s) => { s.email!.testSentTo = to; });
  return r;
}

// ======================= the server calls these =======================
const plain = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export function pNext(dtok: string): Response {
  const id = buyerByDropletToken(dtok);
  if (!id) return plain("stop\n");
  const s = getSetup(id);
  updateSetup(id, (s) => { s.lastSeenAt = now(); });
  if (s.phase === "done" || s.phase === "idle") return plain("stop\n");
  if (s.phase !== "starting") return plain("wait\n");
  const pkg = currentPackage();
  if (!pkg) return plain("wait\n");
  // A fresh one-time attempt token each time we hand out work (an earlier one that got lost stops working).
  const atok = newToken("a");
  setAttemptToken(id, atok);
  logClear(id);
  const n = s.pendingAttempt || (s.attempt || 0) + 1;
  updateSetup(id, (s) => { s.attempt = n; s.attemptIssuedAt = now(); s.attemptVersion = pkg.version; s.bundleFetches = 0; s.progress = [...(s.progress || []).filter((p) => !/^Install attempt/.test(p))]; });
  return plain(`go ${atok} ${pkg.sha256} ${n}\n`);
}

export function pBundle(atok: string): Response {
  const id = buyerByAttemptToken(atok);
  if (!id) return plain("This link has expired.\n", 410);
  const s = getSetup(id);
  if (!["starting", "installing"].includes(s.phase) || ago(s.attemptIssuedAt) > 2 * 60 * MIN || (s.bundleFetches || 0) >= 3) return plain("This link has expired.\n", 410);
  const pkg = currentPackage();
  const file = pkg && /^[a-z0-9-]+-server-[0-9A-Za-z.+-]+\.tgz$/.test(pkg.file) ? join(PACKAGES_DIR, pkg.file) : "";
  if (!file || !existsSync(file) || pkg!.version !== s.attemptVersion) return plain("The app bundle changed; ask again.\n", 410);
  updateSetup(id, (s) => { s.bundleFetches = (s.bundleFetches || 0) + 1; s.phase = "installing"; s.lastLogAt = now(); });
  const f = Bun.file(file);
  return new Response(f, { headers: { "Content-Type": "application/gzip", "Content-Length": String(f.size), "Cache-Control": "no-store" } });
}

export async function pLog(atok: string, offset: number, req: Request): Promise<Response> {
  const id = buyerByAttemptToken(atok);
  if (!id) return plain("gone\n", 410);
  const s = getSetup(id);
  if (s.phase !== "installing" || ago(s.attemptIssuedAt) > 6 * 60 * MIN) return plain("gone\n", 410);
  const buf = new Uint8Array(await req.arrayBuffer());
  const have = logBytes(id);
  if (offset !== have || !buf.length) return plain(`ok ${have}\n`); // duplicate or out of step: tell it where we are
  const text = redact(new TextDecoder().decode(buf), secretValues(id));
  logAppend(id, text, buf.length);
  const steps = [...text.matchAll(/^==> (?:\[(\d+)\/(\d+)\] )?(.*)$/gm)];
  updateSetup(id, (s) => {
    s.lastLogAt = now();
    if (steps.length) { const m = steps[steps.length - 1]; s.installStep = m[1] ? `${m[1]}/${m[2]} ${m[3]}` : m[3]; }
  });
  return plain(`ok ${have + buf.length}\n`);
}

export function pExit(atok: string, code: number): Response {
  const id = buyerByAttemptToken(atok);
  if (!id) return plain("ok\n");
  const s = getSetup(id);
  if (s.phase !== "installing") return plain("ok\n");
  const { text } = logRead(id);
  const okLine = text.match(/^INSTALL OK (https?:\/\/\S+)\s*$/m);
  const failLine = [...text.matchAll(/^INSTALL FAILED:\s*(.*)$/gm)].pop();
  setAttemptToken(id, null);
  if (okLine && code === 0) {
    finish(id, okLine[1]);
  } else {
    const reason = failLine ? failLine[1].trim() : `the installer stopped (code ${code}) without saying why`;
    updateSetup(id, (s) => { s.phase = "failed"; s.error = reason; });
    console.log(`[setup] buyer ${id}: install attempt ${s.attempt} failed`);
  }
  return plain("ok\n");
}

/** Success: forget every secret, keep only what the buyer's Done page and our records need. */
function finish(id: number, url: string) {
  const removed = deleteAllSecrets(id);
  setDropletToken(id, null);
  setAttemptToken(id, null);
  const s = getSetup(id);
  const demo = isDemoBuyer(id); // a demo keeps its logo and colour: the demo dashboard is built from them
  const kept: SetupData = {
    step: "done", phase: "done",
    brand: s.brand ? { productName: s.brand.productName, ownerEmail: s.brand.ownerEmail, ownPhoneAccount: s.brand.ownPhoneAccount, ...(demo ? { logo: s.brand.logo, colour: s.brand.colour } : {}) } : undefined,
    domain: s.domain ? { mode: s.domain.mode, zone: s.domain.zone, sub: s.domain.sub, host: s.domain.host, confirmed: true } : undefined,
    server: s.server ? { region: s.server.region, size: s.server.size, price: s.server.price, chosen: true, sshPublicKey: s.server.sshPublicKey ? "yes" : undefined } : undefined,
    phones: { confirmed: true }, email: s.email ? { mode: s.email.mode, address: s.email.address, from: s.email.from, confirmed: true, resend: s.email.resend ? { status: s.email.resend.status } : undefined } : undefined,
    calendars: s.calendars ? { google: s.calendars.google, microsoft: s.calendars.microsoft, done: true } : undefined,
    dropletId: s.dropletId, ip: s.ip, attempt: s.attempt, attemptVersion: s.attemptVersion,
    serverCreatedAt: s.serverCreatedAt, installedAt: now(), purgedAt: now(), resultUrl: url, sshKeyAdded: s.sshKeyAdded,
    railway: s.railway ? { workspaceName: s.railway.workspaceName, confirmed: true } : undefined,
    rw: s.rw ? { projectId: s.rw.projectId, serviceDomain: s.rw.serviceDomain, certStatus: s.rw.certStatus, domainOk: s.rw.domainOk } : undefined,
    tempUrl: s.rw?.serviceDomain ? webUrl(s.rw.serviceDomain) : undefined,
    domainPending: RAILWAY && !demo ? !s.rw?.domainOk : undefined,
    finishRecords: RAILWAY && !demo && !s.rw?.domainOk ? (s.rw?.records || []).map(({ cfId, ...r }) => r) : undefined,
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
async function emailDns(id: number, zone: string, cfTok?: string, zoneId?: string) {
  const s = getSetup(id);
  if (s.email?.mode !== "resend" || !s.email.sendingDomain) return;
  const key = getSecret(id, "resend_key");
  if (!key) throw new ProviderError("Your Resend key is missing. Go back to the Email step and check it again.");
  const d = await resendDomain(key, s.email.sendingDomain, zone);
  const dmarc: DnsRecord = { key: "dmarc", purpose: "Spoofing protection (DMARC)", type: "TXT", name: `_dmarc.${zone}`, value: "v=DMARC1; p=none;", ttl: "Auto" };
  let needDmarc: boolean;
  if (cfTok && zoneId) {
    needDmarc = !(await cfHasDmarc(cfTok, zoneId, zone));
    for (const rec of d.records) rec.cfId = await cfEnsure(cfTok, zoneId, rec);
    if (needDmarc) dmarc.cfId = await cfEnsure(cfTok, zoneId, dmarc);
  } else {
    needDmarc = !(await lookup("TXT", dmarc.name, zone)).some((v) => /^v=DMARC1/i.test(v));
  }
  if (d.status !== "verified") await resendVerify(key, d.id).catch(() => {});
  updateSetup(id, (s) => {
    s.email!.resend = { domainId: d.id, status: d.status === "verified" ? "verified" : "pending", records: d.records, dmarc: needDmarc ? dmarc : null, written: !!cfTok, verifyAt: now() };
  });
}

/** Domain (Railway order: after email). Cloudflare writes Resend's records now; the app's two come at Install. */
async function domainRailway(b: Buyer, f: Form): Promise<Flash | null> {
  const s = getSetup(b.id);
  const domain = normalizeDomain(str(f.domain, 253) || s.domain?.zone || "");
  const mode = f.mode === "manual" ? "manual" : "cloudflare";
  if (!domain) return err("Type your domain, like yourbusiness.com.", f);
  const sd = s.email?.mode === "resend" ? s.email.sendingDomain || "" : "";
  if (sd && sd !== domain && !sd.endsWith("." + domain)) return err(`Your email address is on ${sd}. Use that domain here, or go back to Email and change the address.`, { domain, mode });
  const sub = "app";
  if (mode === "manual") {
    deleteSecret(b.id, "cf_token");
    updateSetup(b.id, (s) => { s.domain = { mode: "manual", zone: domain, sub, host: `${sub}.${domain}`, confirmed: false }; });
    try { await emailDns(b.id, domain); } catch (e) { safeLog("email dns", e); return err(errMsg(e)); }
    return null; // the screen now lists the email records, with Continue
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
    try { await emailDns(b.id, zone.name, token, zone.id); } catch (e) { safeLog("email dns", e); return err(errMsg(e)); }
    updateSetup(b.id, (s) => { s.domain!.confirmed = true; nextStep(b, s, "domain"); });
    return null;
  }
  return res && res.kind === "err" ? res : null;
}

async function deleteRailwayProject(b: Buyer): Promise<Flash | null> {
  const s = getSetup(b.id);
  const token = getSecret(b.id, "railway_token");
  if (!token) return err("We no longer hold your Railway token: delete the project in Railway, under its Settings.");
  if (busy.has(b.id)) return err("One moment: we're still working on your project. Try again in a few seconds.");
  busy.add(b.id);
  try {
    if (s.rw?.projectId) await railway(token, "mutation($id: String!) { projectDelete(id: $id) }", { id: s.rw.projectId }).catch((e) => { if (!(e instanceof ProviderError && /not found/i.test(e.message))) throw e; });
    const cfTok = s.domain?.mode === "cloudflare" ? getSecret(b.id, "cf_token") : null;
    if (cfTok) for (const r of s.rw?.records || []) if (r.cfId) await fetchDelete(cfTok, s.domain!.cf!.zoneId!, r.cfId).catch(() => {});
  } catch (e) { return err(errMsg(e)); } finally { busy.delete(b.id); }
  logClear(b.id);
  updateSetup(b.id, (s) => { delete s.rw; delete s.error; delete s.attempt; s.phase = "idle"; s.progress = []; });
  return ok("Project deleted. Press Install to make a new one.");
}

/** The app's source (.tar.gz), taken out of the published bundle once and kept next to it. */
async function appSource(): Promise<Uint8Array> {
  const pkg = currentPackage();
  if (!pkg) throw new ProviderError("The app isn't ready to install yet. Please try again later or contact support.");
  const bundle = join(PACKAGES_DIR, pkg.file);
  const cached = bundle.replace(/\.tgz$/, ".app-src.tgz");
  if (!existsSync(cached)) {
    const p = Bun.spawn(["tar", "-xzOf", bundle, "./app-src.tgz"], { stdout: "pipe", stderr: "ignore" });
    const out = new Uint8Array(await new Response(p.stdout).arrayBuffer());
    if ((await p.exited) !== 0 || out.length < 1000) throw new ProviderError("The app bundle is damaged. Contact support.");
    writeFileSync(cached, out, { mode: 0o600 });
  }
  return new Uint8Array(readFileSync(cached));
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

async function railwayVars(id: number, s: SetupData, token: string): Promise<Record<string, string>> {
  let smtp: string;
  if (s.email?.mode === "resend") {
    const key = getSecret(id, "resend_key");
    if (!key || !s.email.resend?.domainId) throw new ProviderError("Your Resend key is missing. Go back to the Email step and check it again.");
    // The server gets a send-only key for this one domain, never the Full access key.
    const send = await resendSendingKey(key, `${s.brand!.productName} server`, s.email.resend.domainId);
    smtp = `smtps://resend:${send}@smtp.resend.com:465`;
  } else smtp = smtpUrl(s.email!.smtp!.host, s.email!.smtp!.port, s.email!.smtp!.user, getSecret(id, "smtp_password") || "");
  const v: Record<string, string> = {
    PRODUCT_NAME: s.brand!.productName,
    PUBLIC_URL: `https://${hostOf(s)}`,
    FIRST_ADMIN_EMAIL: s.brand!.ownerEmail,
    TELNYX_API_KEY: getSecret(id, "telnyx_key") || "",
    SMTP_URL: smtp,
    MAIL_FROM: s.email!.from || "",
    // Encrypts saved mailbox and calendar logins in the database. Lives only in Railway.
    MAILBOX_KEY: randomBytes(32).toString("base64"),
    SINGLE_AGENCY: "1",
    ...brandSettings(s),
    HOST: "0.0.0.0",
    API_PORT: String(APP_PORT),
    PORT: String(APP_PORT),
    DATABASE_URL: "${{Postgres.DATABASE_URL}}",
    RAILWAY_DOCKERFILE_PATH: "deploy/Dockerfile",
  };
  if (s.calendars?.google) { v.GOOGLE_CLIENT_ID = s.calendars.google.clientId; v.GOOGLE_CLIENT_SECRET = getSecret(id, "google_secret") || ""; }
  if (s.calendars?.microsoft) { v.MICROSOFT_CLIENT_ID = s.calendars.microsoft.clientId; v.MICROSOFT_CLIENT_SECRET = getSecret(id, "microsoft_secret") || ""; }
  void token;
  return v;
}

function setRw(id: number, fn: (rw: NonNullable<SetupData["rw"]>, s: SetupData) => void) {
  return updateSetup(id, (s) => { s.rw = s.rw || {}; fn(s.rw, s); });
}

async function tickRailCreate(id: number) {
  let s = getSetup(id);
  const token = getSecret(id, "railway_token");
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
    if (!rw.serviceDomain) {
      const d = (await railway(token, "mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { id domain } }", { input: { serviceId: rw.appId, environmentId: rw.environmentId, targetPort: APP_PORT } })).serviceDomainCreate;
      setRw(id, (r) => { r.serviceDomain = String(d.domain); });
      return;
    }
    if (!rw.customDomainId) {
      const cd = (await railway(token, `mutation($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { ${DOMAIN_FIELDS} } }`, { input: { ...base, serviceId: rw.appId, domain: hostOf(s), targetPort: APP_PORT } })).customDomainCreate;
      setRw(id, (r) => { r.customDomainId = String(cd.id); r.records = railRecords(cd, hostOf(s), zoneOf(s)); });
      return;
    }
    if (s.domain?.mode === "cloudflare" && !rw.cfWritten && rw.records?.length) {
      const cfTok = getSecret(id, "cf_token");
      if (!cfTok) return fail(id, "create_failed", "Your Cloudflare token is missing. Check it again on the Domain step.");
      const recs = rw.records.map((r) => ({ ...r }));
      for (const r of recs) r.cfId = await cfEnsure(cfTok, s.domain.cf!.zoneId!, r);
      setRw(id, (r) => { r.records = recs; r.cfWritten = true; });
      progress(id, `Added ${hostOf(s)}'s records to Cloudflare`);
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
  const token = getSecret(id, "railway_token");
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
  const token = getSecret(id, "railway_token");
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
