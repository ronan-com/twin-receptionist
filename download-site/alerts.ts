// Alerts to us (the seller) when a buyer's agency needs a look. Three triggers:
//   no_heartbeat        an agency that was reporting has been silent for 30 minutes (and it isn't just that its owner
//                       turned sharing off: we ask the app directly before alerting)
//   problem:<kind>      a kind of problem appears in a heartbeat that wasn't in the one before
//   update_failed       an automatic update failed
// Channels, each used only if set: email (SITE_SMTP_URL + SITE_MAIL_FROM, to ALERT_EMAIL_TO or else ADMIN_EMAILS) and
// ALERT_WEBHOOK_URL (POST JSON with "text" and "content", so Slack and Discord incoming webhooks work as they are).
// One alert per agency per kind per hour; every alert is kept for the admin's alert history, sent or not.
import { hasResend, htmlMail, mailDeps, sendSiteMail, siteMailConfigured } from "./mailer";
import { CONFIG, db, now } from "./lib";
import { appUrlOf } from "./setup";
import { getSetup } from "./store";
import { allSnapshots, heartbeatHooks, probeApp, type Snapshot } from "./sync";

export const SILENCE_MINUTES = 30;
const HOUR = 3600_000;

export type AlertKind = "no_heartbeat" | "update_failed" | `problem:${string}`;
export interface AlertRow { id: number; buyer_id: number; kind: string; message: string; at: string; sent: string }

export function alertConfig(env: Record<string, string | undefined> = process.env) {
  const t = (k: string) => (env[k] ?? "").trim();
  const to = (t("ALERT_EMAIL_TO") || t("ADMIN_EMAILS")).split(",").map((s) => s.trim()).filter(Boolean);
  let webhook = "";
  try { const u = new URL(t("ALERT_WEBHOOK_URL")); if (u.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) webhook = u.toString(); } catch {}
  return { smtp: t("SITE_SMTP_URL"), from: t("SITE_MAIL_FROM"), to, webhook };
}

/** The two ways out, swappable in tests. */
export const alertDeps = {
  fetch: ((u: any, i: any) => fetch(u, i)) as typeof fetch,
  sendMail: (smtp: string, mail: { from: string; to: string; subject: string; text: string; html?: string }) => mailDeps.deliver(smtp, { ...mail, html: mail.html ?? htmlMail(mail.text) }),
};

/** True when this agency already has an alert of this kind in the last hour. */
export function duplicate(buyerId: number, kind: string, at = Date.now()): boolean {
  const r = db().query("SELECT at FROM alerts WHERE buyer_id = ? AND kind = ? ORDER BY id DESC LIMIT 1").get(buyerId, kind) as { at: string } | null;
  return !!r && at - Date.parse(r.at) < HOUR;
}

/**
 * Records an alert (unless the same kind was raised for this agency within the hour) and sends it on every
 * channel that is set. Returns what happened. The record is written before anything is sent, so two heartbeats
 * arriving together can't both alert.
 */
export async function raise(buyerId: number, kind: AlertKind, message: string, at = Date.now()): Promise<{ raised: boolean; sent: string[] }> {
  if (duplicate(buyerId, kind, at)) return { raised: false, sent: [] };
  const b = findBuyerById(buyerId);
  const label = b ? `${b.name}${getSetup(buyerId).brand?.productName ? ` (${getSetup(buyerId).brand!.productName})` : ""}` : `buyer ${buyerId}`;
  const link = `${CONFIG.siteUrl}/admin/b/${buyerId}`;
  const text = `AI Agency Admin alert: ${label}: ${message}\n${link}`;
  const id = Number(db().query("INSERT INTO alerts (buyer_id, kind, message, at, sent) VALUES (?, ?, ?, ?, '')").run(buyerId, kind, message.slice(0, 400), new Date(at).toISOString()).lastInsertRowid);
  const c = alertConfig();
  const sent: string[] = [];
  if ((c.smtp || hasResend()) && c.from && c.to.length) {
    try { await alertDeps.sendMail(c.smtp, { from: c.from, to: c.to.join(", "), subject: `AI Agency Admin alert: ${label}`, text }); sent.push("email"); } catch (e) { console.error(`[alerts] email failed: ${(e as any)?.code || (e as Error)?.name}`); }
  }
  if (c.webhook) {
    try {
      const res = await alertDeps.fetch(c.webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, content: text, kind, buyerId, buyer: label, url: link }), redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (res.ok) sent.push("webhook"); else console.error(`[alerts] webhook answered ${res.status}`);
    } catch (e) { console.error(`[alerts] webhook failed: ${(e as Error)?.name}`); }
  }
  if (sent.length) db().query("UPDATE alerts SET sent = ? WHERE id = ?").run(sent.join(","), id);
  return { raised: true, sent };
}
const findBuyerById = (id: number) => db().query("SELECT * FROM buyers WHERE id = ?").get(id) as { name: string; demo: number; revoked_at: string | null } | null;

export const alertHistory = (n = 100, buyerId?: number): AlertRow[] =>
  (buyerId == null ? db().query("SELECT * FROM alerts ORDER BY id DESC LIMIT ?").all(n) : db().query("SELECT * FROM alerts WHERE buyer_id = ? ORDER BY id DESC LIMIT ?").all(buyerId, n)) as AlertRow[];

/** What to alert about after a heartbeat: kinds of problem that weren't there last time, and a failed update. Pure. */
export function heartbeatAlerts(prev: Snapshot | null, next: Snapshot): { kind: AlertKind; message: string }[] {
  const out: { kind: AlertKind; message: string }[] = [];
  const had = new Set((prev?.problems ?? []).map((p) => p.kind));
  const seen = new Set<string>();
  for (const p of next.problems) {
    if (had.has(p.kind) || seen.has(p.kind)) continue;
    seen.add(p.kind);
    out.push({ kind: `problem:${p.kind}`, message: `a new kind of problem, "${p.kind}": ${p.msg || "(no detail)"} (${p.count} time${p.count === 1 ? "" : "s"} in 24 hours)` });
  }
  const u = next.updates;
  if (u.lastResult === "failed" && (prev?.updates.lastResult !== "failed" || prev.updates.lastAt !== u.lastAt)) out.push({ kind: "update_failed", message: `the automatic update failed${u.lastError ? `: ${u.lastError}` : ""}` });
  return out;
}

heartbeatHooks.push((id, prev, next) => {
  const b = findBuyerById(id);
  if (!b || b.demo === 1) return;
  for (const a of heartbeatAlerts(prev, next)) void raise(id, a.kind, a.message).catch(() => {});
});

/**
 * "Your agency looks offline": one email to the agency's owner per outage. An outage ends when the agency reports again,
 * so a second email can only follow a heartbeat. Returns true when an email went out.
 */
export async function notifyOwnerOffline(buyerId: number, lastHeartbeatAt: string): Promise<boolean> {
  db().exec("CREATE TABLE IF NOT EXISTS offline_notices (buyer_id INTEGER PRIMARY KEY, at TEXT NOT NULL)");
  const prev = db().query("SELECT at FROM offline_notices WHERE buyer_id = ?").get(buyerId) as { at: string } | null;
  if (prev && Date.parse(prev.at) > Date.parse(lastHeartbeatAt)) return false; // already told them about this outage
  const b = db().query("SELECT * FROM buyers WHERE id = ?").get(buyerId) as { email: string; name: string } | null;
  if (!b || !siteMailConfigured()) return false;
  const s = getSetup(buyerId);
  const to = s.brand?.ownerEmail || b.email;
  const url = appUrlOf(s);
  // Written first, so two checks running together can't both send.
  db().query("INSERT OR REPLACE INTO offline_notices (buyer_id, at) VALUES (?, ?)").run(buyerId, now());
  const err = await sendSiteMail(to, `${s.brand?.productName || "Your agency"} looks offline`,
    `Hi,\n\n${s.brand?.productName || "Your agency"} hasn't checked in for a while, so it may be down.\n\nWe've been told and we're looking. You don't need to do anything.${url ? `\n\n${url}` : ""}`);
  if (err) { db().query("DELETE FROM offline_notices WHERE buyer_id = ?").run(buyerId); return false; }
  return true;
}

/** Agencies that were reporting and have gone quiet for 30 minutes. One alert per agency per hour. */
export async function checkSilence(at = Date.now(), probe: typeof probeApp = probeApp): Promise<{ buyerId: number; result: string }[]> {
  const out: { buyerId: number; result: string }[] = [];
  for (const [id, st] of allSnapshots()) {
    const b = findBuyerById(id);
    if (!b || b.demo === 1 || b.revoked_at) continue;
    const quiet = (at - Date.parse(st.receivedAt)) / 60_000;
    if (quiet < SILENCE_MINUTES) continue;
    if (db().query("SELECT 1 FROM sync_off WHERE buyer_id = ?").get(id)) continue;
    if (duplicate(id, "no_heartbeat", at)) continue;
    const s = getSetup(id);
    const result = await probe(id, appUrlOf(s));
    out.push({ buyerId: id, result });
    if (result === "no-app") continue;
    if (result === "sharing-off") { db().query("INSERT OR REPLACE INTO sync_off (buyer_id, at) VALUES (?, ?)").run(id, now()); continue; }
    const mins = Math.round(quiet);
    await notifyOwnerOffline(id, st.receivedAt);
    await raise(id, "no_heartbeat", result === "alive"
      ? `no heartbeat for ${mins} minutes, but the app answers: its health check may be stuck`
      : `no heartbeat for ${mins} minutes and the app doesn't answer: it may be down`, at);
  }
  return out;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startAlerts(): void {
  const c = alertConfig();
  console.log(`alerts: ${(c.smtp || hasResend()) && c.from && c.to.length ? "email" : "no email"}, ${c.webhook ? "webhook" : "no webhook"} (history is kept in /admin either way)`);
  timer ??= setInterval(() => void checkSilence().catch((e) => console.error(`[alerts] ${(e as Error)?.name}`)), 5 * 60_000);
  timer.unref?.();
}
