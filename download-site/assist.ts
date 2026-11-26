// "Set up for them": our admin fills in parts of a buyer's setup, or all of it, from /admin/b/<id>.
// Everything here calls the SAME wizard code the buyer's own forms call (setup.ts actions, providers.ts checks,
// dns.ts writers): the admin just goes through `asAdmin` (ctx.ts), which lifts the "earlier steps first" ordering.
// Keys are stored exactly like the buyer's own (sealed, deleted when the install finishes); a DNS login is kept only
// if the admin ticks "keep for later changes". Every action is written to the audit log (support_log) with who and when,
// never with a key. The buyer's wizard (wizard.ts) shows the steps done here as "Set up by your provider".
import nodemailer from "nodemailer";
import { CONFIG, RAILWAY, currentPackage, now, type Buyer } from "./lib";
import { asAdmin } from "./ctx";
import { actions, allow, appUrlOf, firstOpen, hostOf, kick, stepDone, type Flash } from "./setup";
import { OPTIONAL_STEPS, STEPS, deleteSecret, getSecret, getSetup, hasSecret, putSecret, secretHint, updateSetup, type DnsRecord, type SetupData, type StepId } from "./store";
import { ProviderError, checkCloudflare, checkOpenRouter, cfFindZone, recordLive } from "./providers";
import { checkGoDaddy, cloudflareWriter, godaddyWriter } from "./dns";
import { logSupport, ownerResetLink } from "./sync";
import { hostDnsOk, hostOfBuyer, hostRecord, markHostDns, removeHost, setHost, setHostCheck } from "./hosts";

export type Out = { ok: boolean; message: string; kind?: "ok" | "err" | "info" };
const good = (message: string): Out => ({ ok: true, message, kind: "ok" });
const bad = (message: string): Out => ({ ok: false, message, kind: "err" });
const info = (message: string): Out => ({ ok: true, message, kind: "info" });
const fromFlash = (f: Flash | null, done: string): Out => (!f ? good(done) : f.kind === "err" ? bad(f.text) : { ok: true, message: f.text, kind: f.kind });
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const errText = (e: unknown) => (e instanceof ProviderError ? e.message : "Something went wrong on our side. Try again in a minute.");

/** The audit trail: who did what to this buyer, and when. Never holds a key or a link. */
export function audit(b: { id: number }, admin: string, action: string, note = "") { logSupport(b.id, admin, action, note); }

// ---------------- the steps our admin can fill ----------------
export type AssistId = "brand" | "railway" | "server" | "phones" | "email" | "domain" | "calendars" | "vapi" | "twilio";
export const ASSIST_STEPS: { id: AssistId; title: string; optional: boolean }[] = [
  { id: "brand", title: "Brand", optional: false },
  ...(RAILWAY ? [{ id: "railway" as const, title: "Hosting (Railway)", optional: false }] : [{ id: "server" as const, title: "Server (DigitalOcean)", optional: false }]),
  { id: "phones", title: "Phones (Telnyx)", optional: false },
  { id: "email", title: "Email", optional: true },
  { id: "domain", title: "Own domain and DNS", optional: true },
  { id: "calendars", title: "Calendars", optional: true },
  { id: "vapi", title: "Backup: Vapi", optional: true },
  { id: "twilio", title: "Backup: Twilio", optional: true },
];
/** Did the step really get filled in (as opposed to skipped)? */
export function didStep(s: SetupData, id: AssistId): boolean {
  switch (id) {
    case "brand": return !!s.brand;
    case "railway": return !!s.railway?.confirmed;
    case "server": return !!s.server?.chosen;
    case "phones": return !!s.phones?.confirmed;
    case "email": return !!s.email?.confirmed;
    case "domain": return !!s.domain?.confirmed && !!s.domain.host;
    case "calendars": return !!s.calendars?.google || !!s.calendars?.microsoft;
    case "vapi": return !!s.vapi?.confirmed;
    case "twilio": return !!s.twilio?.confirmed;
  }
}
/** Steps that need the brand first (the wizard's own actions read it). */
const NEEDS_BRAND: AssistId[] = ["phones", "email", "vapi"];

export interface StepRow { id: AssistId; title: string; optional: boolean; done: boolean; skipped: boolean; by: "you" | "buyer" | null; who?: string; at?: string; detail: string }
export function stepRows(b: Buyer, s: SetupData): StepRow[] {
  return ASSIST_STEPS.map(({ id, title, optional }) => {
    const done = didStep(s, id);
    const mark = s.assist?.steps?.[id];
    const skipped = !done && optional && stepDone(b, s, id as StepId);
    return { id, title, optional, done, skipped, by: done ? (mark ? "you" : "buyer") : null, who: mark?.by, at: mark?.at, detail: detailOf(b, s, id) };
  });
}
/** A short, key-free line about what's filled in. */
export function detailOf(b: { id: number }, s: SetupData, id: AssistId): string {
  const h = (n: Parameters<typeof secretHint>[1]) => secretHint(b.id, n) || "";
  switch (id) {
    case "brand": return s.brand ? `${s.brand.productName} · ${s.brand.ownerEmail}${s.brand.logo ? " · logo" : ""}${s.brand.colour ? ` · ${s.brand.colour}` : ""}` : "";
    case "railway": return s.railway?.confirmed ? `${s.railway.workspaceName || "workspace"}${s.railway.plan ? ` · ${s.railway.plan}` : ""} ${h("railway_token")}`.trim() : "";
    case "server": return s.server?.chosen ? `${s.server.region || ""} ${s.server.size || ""} ${h("do_token")}`.trim() : "";
    case "phones": return s.phones?.confirmed ? `Telnyx ${h("telnyx_key")}${s.phones.balance ? ` · ${s.phones.balance}` : ""}`.trim() : "";
    case "email": return s.email?.confirmed ? `${s.email.mode === "smtp" ? "SMTP" : "Resend"} · ${s.email.address || ""}` : "";
    case "domain": return s.domain?.host ? `${s.domain.host} · DNS by ${s.domain.mode === "manual" ? "hand" : s.domain.mode === "godaddy" ? "GoDaddy" : "Cloudflare"}${s.domain.confirmed ? "" : " (not finished)"}` : "";
    case "calendars": return [s.calendars?.google ? "Google" : "", s.calendars?.microsoft ? "Microsoft" : ""].filter(Boolean).join(" + ");
    case "vapi": return s.vapi?.confirmed ? `Vapi ${h("vapi_key")}`.trim() : "";
    case "twilio": return s.twilio?.confirmed ? `Twilio ${s.twilio.sid || ""}`.trim() : "";
  }
}

/** The required steps still open, in plain words (what blocks "Install for them"). */
export function installBlockers(b: Buyer, s: SetupData): string[] {
  const out: string[] = [];
  for (const id of STEPS.slice(0, STEPS.indexOf("install"))) {
    if (OPTIONAL_STEPS.includes(id) || id === "welcome" || id === "extras") continue;
    if (!stepDone(b, s, id)) out.push(ASSIST_STEPS.find((x) => x.id === id)?.title || id);
  }
  if (!s.phones?.confirmed && !s.vapi?.confirmed && !out.some((x) => /Phones/.test(x))) out.push("Phones (Telnyx)");
  return out;
}

// ---------------- running a wizard action as the admin ----------------
const mark = (id: AssistId | "openrouter", by: string) => (s: SetupData) => { s.assist = { ...s.assist, steps: { ...s.assist?.steps, [id]: { by, at: now() } }, released: (s.assist?.released || []).filter((x) => x !== id) }; };
/** Runs `action` exactly as the buyer's form would, as this admin. The wizard's step pointer is left where the buyer would find it. */
async function run(b: Buyer, admin: string, action: string, form: Record<string, string>): Promise<Flash | null> {
  const before = getSetup(b.id).step;
  try {
    return await asAdmin.run(admin, async () => actions[action](b, form));
  } finally {
    updateSetup(b.id, (s) => { if (before === "welcome") s.step = "welcome"; });
  }
}
function lockedOut(b: Buyer): Out | null {
  const s = getSetup(b.id);
  if (b.revoked_at) return bad("This buyer's link is turned off. Turn it back on first.");
  if (s.phase !== "idle") return bad(s.phase === "done" ? "Their install is finished, so these steps are closed." : "Their install has started. Wait for it, or reset their setup, to change these.");
  return null;
}

const ACTION_OF: Record<AssistId, string> = { brand: "brand", railway: "railway", server: "server", phones: "phones", email: "email", domain: "domain", calendars: "calendars", vapi: "vapi", twilio: "twilio" };

/** Fill one step for the buyer. `f` holds the same field names the wizard form uses. Never audits a key. */
export async function fillStep(b: Buyer, admin: string, step: AssistId, f: Record<string, string>): Promise<Out> {
  const lock = lockedOut(b); if (lock) return lock;
  const s0 = getSetup(b.id);
  if (NEEDS_BRAND.includes(step) && !s0.brand) return bad("Fill in the Brand first: the other steps use the brand name.");
  let action = ACTION_OF[step];
  const form = { ...f };
  if (step === "email" && f.mode === "smtp") action = "smtp";
  const flash = await run(b, admin, action, form);
  let s = getSetup(b.id);
  let out = fromFlash(flash, `${ASSIST_STEPS.find((x) => x.id === step)!.title} is done.`);
  if (step === "domain" && flash?.kind !== "err" && s.domain && !s.domain.confirmed && s.domain.mode === "manual") {
    const f2 = await run(b, admin, "domain-continue", {});
    out = fromFlash(f2, "Domain added. The records to add are listed below.");
    s = getSetup(b.id);
  }
  if (didStep(s, step) && flash?.kind !== "err") updateSetup(b.id, mark(step, admin));
  else if (flash?.kind !== "err") out = { ...out, message: out.message || "Saved, but not finished yet." };
  const note = step === "domain" ? `${s.domain?.mode || ""} ${s.domain?.host || ""}`.trim() : step === "brand" ? str(f.productName, 60) : "";
  audit(b, admin, `${out.ok ? "filled" : "tried"}: ${step}`, `${note}${out.ok ? "" : ` · ${out.message.slice(0, 120)}`}`.trim());
  return out;
}

/** The optional OpenRouter key ("Ask for help" in their dashboard). Checked with OpenRouter; stored sealed; goes in as OPENROUTER_API_KEY. */
export async function setOpenRouter(b: Buyer, admin: string, key: string): Promise<Out> {
  const lock = lockedOut(b); if (lock) return lock;
  const k = str(key, 300);
  const r = await checkOpenRouter(k);
  if (!r.ok) { audit(b, admin, "tried: openrouter", r.message.slice(0, 120)); return bad(r.message); }
  putSecret(b.id, "openrouter_key", k);
  updateSetup(b.id, (s) => { mark("openrouter", admin)(s); s.assist!.openrouter = true; });
  audit(b, admin, "filled: openrouter");
  return good("OpenRouter key saved. Their dashboard gets the Ask for help button.");
}

/** Mark the optional extras screen finished (anything left empty is simply not added; the buyer can add it later from Settings or the guide). */
export async function finishExtras(b: Buyer, admin: string): Promise<Out> {
  const lock = lockedOut(b); if (lock) return lock;
  if (getSetup(b.id).extrasDone) return good("Extras are already finished.");
  const f = await run(b, admin, "extras-continue", {});
  if (!f) audit(b, admin, "finished extras");
  return fromFlash(f, "Extras finished.");
}

// ---------------- Install for them ----------------
export function canInstall(b: Buyer, s: SetupData): { ok: true } | { ok: false; why: string } {
  if (b.revoked_at) return { ok: false, why: "Their link is turned off." };
  if (s.phase === "done") return { ok: false, why: "Already installed." };
  if (!["idle", "create_failed", "failed"].includes(s.phase)) return { ok: false, why: "An install is running." };
  const missing = installBlockers(b, s);
  if (missing.length) return { ok: false, why: `Still to fill in: ${missing.join(", ")}.` };
  if (!currentPackage()) return { ok: false, why: "The app isn't published on this site yet." };
  return { ok: true };
}
/** Same install engine as the buyer's Install button: the same action, the same log, the same finish (keys deleted at the end). */
export async function installFor(b: Buyer, admin: string): Promise<Out> {
  const s = getSetup(b.id);
  const can = canInstall(b, s);
  if (!can.ok) return bad(can.why);
  if (!s.extrasDone) { const e = await finishExtras(b, admin); if (!e.ok) return e; }
  const retry = ["failed"].includes(getSetup(b.id).phase);
  const f = await run(b, admin, retry ? "install-retry" : "install-start", {});
  if (f && f.kind === "err") { audit(b, admin, "tried: install", f.text.slice(0, 120)); return bad(f.text); }
  updateSetup(b.id, (x) => { x.assist = { ...x.assist, installBy: { by: admin, at: now() } }; });
  audit(b, admin, retry ? "install again" : "install started");
  kick(b.id);
  return good("The install has started. The log below updates by itself.");
}

// ---------------- Send owner their login ----------------
const SITE_SMTP = () => (process.env.SITE_SMTP_URL || "").trim();
const SITE_FROM = () => (process.env.SITE_MAIL_FROM || "").trim();
export const mailConfigured = () => !!SITE_SMTP() && !!SITE_FROM();
export type OwnerLogin = { ok: true; kind: "reset" | "first"; url: string; minutes: number; to: string; mailed: boolean; mailError?: string } | { ok: false; message: string };
/**
 * The owner's way in: a one-time "set your password" link from their app when an owner account exists (the same call as the
 * buyer's "Locked out?"), otherwise the first-account page (the owner signs up there with their owner email; only that address
 * can). Emailed from our site's mail if it's set up and `email` is true; the link is also returned for the admin to copy.
 */
export async function ownerLogin(b: Buyer, admin: string, email: boolean, doFetch: typeof fetch = fetch): Promise<OwnerLogin> {
  const s = getSetup(b.id);
  if (s.phase !== "done") return { ok: false, message: "Their agency isn't installed yet." };
  const app = appUrlOf(s);
  if (!app) return { ok: false, message: "We don't have their agency's address." };
  const wait = allow(`assist-owner:${b.id}`, 6, 10 * 60_000);
  if (wait) return { ok: false, message: `That was a lot of tries. Wait ${Math.ceil(wait / 60)} minutes.` };
  let kind: "reset" | "first" = "reset", url = "", minutes = 15;
  const r = await ownerResetLink(b.id, app, doFetch);
  if (r.ok) { url = r.url; minutes = r.minutes; }
  else if (/no agency owner/i.test(r.message)) { kind = "first"; url = app.replace(/\/$/, "") + "/"; minutes = 0; }
  else { audit(b, admin, "tried: owner login", r.message.slice(0, 120)); return { ok: false, message: r.message }; }
  const to = s.brand?.ownerEmail || b.email;
  let mailed = false, mailError: string | undefined;
  if (email) {
    if (!mailConfigured()) mailError = "Our site has no outgoing email set up, so copy the link and send it yourself.";
    else {
      const name = s.brand?.productName || "your agency";
      const text = kind === "reset"
        ? `Hi,\n\n${name} is ready. Open this link to choose your password and sign in as the owner:\n\n${url}\n\nIt works once and runs out in ${minutes} minutes. If it has run out, reply to this email and we'll send a new one.\n\n${CONFIG.sellerName}`
        : `Hi,\n\n${name} is ready. Open ${url} and create your account with this email address (${to}); only that address can create the first account. Then pick a password.\n\n${CONFIG.sellerName}`;
      const t = nodemailer.createTransport(SITE_SMTP(), { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 } as any);
      try { await t.sendMail({ from: SITE_FROM(), to, subject: `${name} is ready`, text }); mailed = true; }
      catch { mailError = "The email didn't send. Copy the link and send it yourself."; }
      finally { t.close(); }
    }
  }
  audit(b, admin, kind === "reset" ? "owner login: reset link made" : "owner login: first-account link", `${mailed ? `emailed to ${to}` : email ? "email failed, link shown" : "link shown"}`);
  return { ok: true, kind, url, minutes, to, mailed, mailError };
}

// ---------------- Domain and DNS ----------------
export type DnsProvider = "cloudflare" | "godaddy" | "manual";

/** Cloudflare: check the pasted token and remember which domains it can see, so the admin can pick one. The token is stored sealed (same as the buyer's). */
export async function cloudflareCheck(b: Buyer, admin: string, token: string): Promise<Out> {
  const lock = lockedOut(b); if (lock) return lock;
  const t = str(token, 300) || getSecret(b.id, "cf_token") || "";
  const r = await checkCloudflare(t);
  if (!r.ok) { audit(b, admin, "tried: cloudflare token", r.message.slice(0, 120)); return bad(r.message); }
  putSecret(b.id, "cf_token", t);
  updateSetup(b.id, (s) => { s.assist = { ...s.assist, cfZones: r.zones.map((z) => z.name) }; });
  audit(b, admin, "checked: cloudflare token", `${r.zones.length} domain(s) visible`);
  return good(r.message);
}

export interface DomainForm { provider: DnsProvider; domain: string; token?: string; gdKey?: string; gdSecret?: string; replace?: boolean; keep?: boolean }
/** Their own domain: the same wizard code as the buyer's Domain step, for Cloudflare, GoDaddy or "I'll add the records". */
export async function setDomain(b: Buyer, admin: string, f: DomainForm): Promise<Out> {
  const lock = lockedOut(b); if (lock) return lock;
  const form: Record<string, string> = { domain: f.domain, mode: f.provider, replace: f.replace ? "1" : "" };
  // Nothing typed: use the login already checked and held for this buyer (the wizard itself only reuses it once the domain is set).
  if (f.provider === "cloudflare") form.token = f.token || getSecret(b.id, "cf_token") || "";
  if (f.provider === "godaddy") { form.gdKey = f.gdKey || getSecret(b.id, "godaddy_key") || ""; form.gdSecret = f.gdSecret || getSecret(b.id, "godaddy_secret") || ""; }
  const out = await fillStep(b, admin, "domain", form);
  updateSetup(b.id, (s) => {
    s.assist = { ...s.assist, keepDns: f.provider === "manual" ? false : !!f.keep };
    if (didStep(s, "domain")) s.assist.dnsBy = f.provider;
  });
  if (f.provider === "manual") { deleteSecret(b.id, "cf_token"); deleteSecret(b.id, "godaddy_key"); deleteSecret(b.id, "godaddy_secret"); }
  return out;
}

/** Delete the DNS login we hold for them right now (and stop keeping it). */
export function dropDnsCreds(b: Buyer, admin: string): Out {
  const had = hasSecret(b.id, "cf_token") || hasSecret(b.id, "godaddy_key");
  for (const n of ["cf_token", "godaddy_key", "godaddy_secret"] as const) deleteSecret(b.id, n);
  updateSetup(b.id, (s) => { if (s.assist) s.assist.keepDns = false; });
  audit(b, admin, "deleted DNS login");
  return good(had ? "The DNS login is deleted." : "There was no DNS login to delete.");
}

export interface DnsRow { r: DnsRecord; group: string }
/** Every record the buyer's domain needs, with the last check result: email (Resend), the agency address (Railway). */
export function dnsRows(s: SetupData): DnsRow[] {
  const rows: DnsRow[] = [];
  for (const r of s.email?.resend?.records || []) rows.push({ r, group: "Email" });
  if (s.email?.resend?.dmarc) rows.push({ r: s.email.resend.dmarc, group: "Email" });
  for (const r of s.phase === "done" ? s.finishRecords || [] : s.rw?.records || []) rows.push({ r, group: "Agency address" });
  return rows;
}
/** Look every record up in public DNS now, save the ticks, and (if the agency was waiting on its address) see if it answers there yet. */
export async function checkDns(b: Buyer): Promise<{ rows: { key: string; ok: boolean; seen: string }[]; all: boolean; host?: { ok: boolean; seen: string }; live?: boolean }> {
  const s = getSetup(b.id);
  const zone = s.domain?.zone || "";
  const res: { key: string; ok: boolean; seen: string }[] = [];
  for (const { r } of dnsRows(s)) { const l = await recordLive(r, zone); res.push({ key: r.key + ":" + r.name, ok: l.ok, seen: l.seen }); r.ok = l.ok; r.seen = l.seen; }
  updateSetup(b.id, (x) => {
    const apply = (list?: DnsRecord[]) => { for (const r of list || []) { const m = res.find((q) => q.key === r.key + ":" + r.name); if (m) { r.ok = m.ok; r.seen = m.seen; } } };
    apply(x.email?.resend?.records); if (x.email?.resend?.dmarc) apply([x.email.resend.dmarc]);
    apply(x.finishRecords); apply(x.rw?.records);
  });
  let live: boolean | undefined;
  const cur = getSetup(b.id);
  if (cur.phase === "done" && cur.domainPending && hostOf(cur) && res.length && res.every((x) => x.ok)) {
    live = await fetch(`https://${hostOf(cur)}/api/health`, { signal: AbortSignal.timeout(8000), redirect: "error" }).then((r) => r.ok).catch(() => false);
    if (live) updateSetup(b.id, (x) => { x.domainPending = false; x.resultUrl = `https://${hostOf(x)}`; x.finishRecords = undefined; });
  }
  const mine = hostOfBuyer(b.id);
  let host: { ok: boolean; seen: string } | undefined;
  if (mine) { host = await hostDnsOk(mine.host); markHostDns(b.id, host.ok); }
  return { rows: res, all: res.every((x) => x.ok), host, live };
}

// ---------------- Their setup link on their own domain ----------------
export interface HostForm { host: string; provider: DnsProvider; token?: string; gdKey?: string; gdSecret?: string; replace?: boolean; keep?: boolean }
/**
 * Registers setup.theirdomain.com for this buyer and writes (or shows) the CNAME to our site with the same writers as the
 * domain step. Credentials typed here are used once and dropped, unless "keep" is ticked; keys already held for their domain are reused.
 */
export async function setupHost(b: Buyer, admin: string, f: HostForm): Promise<Out> {
  if (b.revoked_at) return bad("This buyer's link is turned off. Turn it back on first.");
  const check = setHostCheck(b.id, f.host);
  if (!check.ok) return bad(check.message);
  const host = check.host;
  const rec = hostRecord(host);
  if (f.provider === "manual") {
    setHost(b.id, host); markHostDns(b.id, false, "manual");
    updateSetup(b.id, (s) => { s.assist = { ...s.assist }; });
    audit(b, admin, "setup link host", `${host} (records to add by hand)`);
    return info(`Add this record where DNS for ${host.split(".").slice(1).join(".")} is managed, then press Check DNS.`);
  }
  try {
    let writer;
    let used: string;
    if (f.provider === "cloudflare") {
      const token = str(f.token, 300) || getSecret(b.id, "cf_token") || "";
      if (!token) return bad("Paste the Cloudflare token.");
      const c = await checkCloudflare(token);
      if (!c.ok) return bad(c.message);
      const zone = await cfFindZone(token, host).catch(() => null);
      if (!zone) return bad(`This token can't see ${host.split(".").slice(1).join(".")}. Pick a token for that domain.`);
      writer = cloudflareWriter(token, zone.id); used = "Cloudflare";
      if (f.keep && str(f.token, 300)) putSecret(b.id, "cf_token", token);
    } else {
      const key = str(f.gdKey, 200) || getSecret(b.id, "godaddy_key") || "", secret = str(f.gdSecret, 200) || getSecret(b.id, "godaddy_secret") || "";
      const c = await checkGoDaddy(key, secret, host);
      if (!c.ok) return bad(c.message);
      writer = godaddyWriter(key, secret, c.zone, { replace: !!f.replace }); used = "GoDaddy";
      if (f.keep && str(f.gdKey, 200)) { putSecret(b.id, "godaddy_key", key); putSecret(b.id, "godaddy_secret", secret); }
    }
    await writer.ensure(rec);
    setHost(b.id, host); markHostDns(b.id, false, f.provider);
    if (f.keep) updateSetup(b.id, (s) => { s.assist = { ...s.assist, keepDns: true }; });
    audit(b, admin, "setup link host", `${host} via ${used}`);
    return good(`${host} now points at ${rec.value} (written to ${used}). The https certificate is issued the first time someone opens it.`);
  } catch (e) {
    audit(b, admin, "tried: setup link host", `${host}: ${errText(e).slice(0, 100)}`);
    return bad(errText(e));
  }
}
export function dropHost(b: Buyer, admin: string): Out {
  const had = removeHost(b.id);
  if (had) audit(b, admin, "removed setup link host");
  return good(had ? "Their own-domain setup link is removed. The normal link still works." : "There was no own-domain link.");
}

// ---------------- the buyer's side of it ----------------
// Registered here so every place that loads the admin also has these (server.ts imports admin-web, which imports this).
const STEP_OF_ACTION: Record<string, AssistId> = { brand: "brand", railway: "railway", server: "server", phones: "phones", email: "email", smtp: "email", domain: "domain", calendars: "calendars", vapi: "vapi", twilio: "twilio",
  "email-skip": "email", "domain-skip": "domain", "cal-skip": "calendars", "vapi-skip": "vapi", "twilio-skip": "twilio" };
for (const [name, step] of Object.entries(STEP_OF_ACTION)) {
  const real = actions[name];
  if (!real) continue;
  // When the BUYER saves (or skips) a step our admin filled in, it becomes theirs: the "set up by your provider" mark goes.
  actions[name] = async (b, f) => {
    const r = await real(b, f);
    if (!asAdmin.getStore() && !(r && r.kind === "err")) updateSetup(b.id, (s) => { if (s.assist?.steps?.[step]) { delete s.assist.steps[step]; s.assist.released = (s.assist.released || []).filter((x) => x !== step); } });
    return r;
  };
}
{
  // The buyer pressed Start: land on the first thing still left for them.
  const start = actions.start;
  actions.start = async (b, f) => { const r = await start(b, f); updateSetup(b.id, (s) => { if (s.assist?.steps && Object.keys(s.assist.steps).length) s.step = firstOpen(b, s); }); return r; };
}
/** "Set up by your provider: change". Shows the normal form again; for the domain it clears what we set so they choose again (records already written stay). */
actions["assist-release"] = (b, f) => {
  const step = f.step as AssistId;
  if (!ASSIST_STEPS.some((x) => x.id === step)) return null;
  const s0 = getSetup(b.id);
  if (s0.phase !== "idle" || !s0.assist?.steps?.[step]) return null;
  if (step === "domain") { deleteSecret(b.id, "cf_token"); deleteSecret(b.id, "godaddy_key"); deleteSecret(b.id, "godaddy_secret"); }
  updateSetup(b.id, (s) => {
    s.assist = { ...s.assist, released: [...new Set([...(s.assist?.released || []), step])] };
    if (step === "domain") { delete s.domain; if (s.skipped) delete s.skipped.domain; s.assist.dnsBy = undefined; }
  });
  return null;
};

/** For the wizard: is this step shown as "set up by your provider"? */
export const helpedStep = (s: SetupData, id: StepId | string): boolean => !!s.assist?.steps?.[id as AssistId] && !(s.assist.released || []).includes(id as StepId);
export const hasAssist = (s: SetupData): boolean => !!s.assist?.steps && Object.keys(s.assist.steps).length > 0;
