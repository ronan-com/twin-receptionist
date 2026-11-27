// "I need a person": a buyer stuck in the setup wizard asks one of us for help, and it lands in our admin at once.
//   POST /setup/<code>/a/help-request   the small form on every step (same-origin + the session's CSRF token, like
//                                       every wizard form; 5 an hour per setup code)
// It becomes a Help ticket (tickets.ts) with source "wizard", tied to the buyer, carrying where they are: the step,
// the last error we showed them on that step, their brand name, which keys they've given us (names only, never a
// value), and their browser. Their problem text has anything that looks like a key, and every key we hold for them,
// masked before it's stored. One open request per buyer: asking again adds to it. Our replies show on their wizard.
import { CONFIG, db, now, type Buyer } from "./lib";
import { esc } from "./pages";
import { allow } from "./setup";
import { ALL_SECRETS, STEPS, hasSecret, redact, secretValues, type SetupData, type StepId } from "./store";
import { messagesOf, text, ticketById, ticketTables, touch, wizardCtx, type Ticket, type WizardContext } from "./tickets";

export const MAX_PROBLEM = 1000;
export const HELP_PER_HOUR = 5;
export const HELP_EMPTY = "Please tell us what's wrong, even in a few words, so we know how to help.";
export const HELP_SENT = "We've got it — we'll get back to you shortly. You can keep going or wait here.";

/** The step's name, as our admin reads it. */
const STEP_LABEL: Record<StepId, string> = {
  welcome: "Welcome", brand: "Brand", domain: "Domain", server: "DigitalOcean server", railway: "Railway", phones: "Voice", ai: "AI",
  email: "Email", calendars: "Calendars", extras: "Extras", vapi: "Vapi", twilio: "Twilio", install: "Install", done: "Live",
};
export const stepLabel = (id: string) => STEP_LABEL[id as StepId] || "setup";

/** The last error the wizard showed them on this step: a form's red message, or the install's failure. */
export function lastErrorOf(s: SetupData, step: StepId): string {
  const e = s.lastErrors?.[step]?.text || (step === "install" || step === "done" ? s.error || s.update?.error || "" : "");
  return e;
}
/** Kept by server.ts each time a wizard form answers with an error, so a help request can say what went wrong. */
export function noteStepError(s: SetupData, step: StepId, msg: string) {
  s.lastErrors = { ...(s.lastErrors || {}), [step]: { text: msg.slice(0, 300), at: now() } };
}

/** Their one open (or waiting) request from the wizard, if any; else the newest closed in the last 3 days. */
export function wizardTicketOf(buyerId: number): Ticket | null {
  ticketTables();
  const open = db().query("SELECT * FROM tickets WHERE buyer_id = ? AND source = 'wizard' AND status <> 'closed' ORDER BY id DESC LIMIT 1").get(buyerId) as Ticket | null;
  if (open) return open;
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  return db().query("SELECT * FROM tickets WHERE buyer_id = ? AND source = 'wizard' AND status = 'closed' AND updated_at > ? ORDER BY id DESC LIMIT 1").get(buyerId, since) as Ticket | null;
}

/** The alert to us. The hook is swappable in tests; it does nothing when no alert channel is set (alerts.ts decides). */
export const wizhelpHooks = {
  async alert(buyerId: number, kind: `problem:${string}`, message: string): Promise<void> {
    try {
      const mod: any = await import(/* @vite-ignore */ ["./", "alerts"].join(""));
      if (typeof mod.raise === "function") await mod.raise(buyerId, kind, message);
    } catch { /* no alerts module on this site */ }
  },
};

export type HelpResult = { ok: true; ticketId: number; created: boolean } | { ok: false; message: string };

/** The form arriving. `f` is the posted form, `ua` the browser's User-Agent header. */
export function wizardHelpRequest(b: Buyer, s: SetupData, f: Record<string, string>, ua: string, code: string): HelpResult {
  ticketTables();
  const step: StepId = STEPS.includes(f.v as StepId) ? (f.v as StepId) : s.step;
  const mine = secretValues(b.id);
  const clean = (v: unknown, max: number, multi = false) => text(redact(typeof v === "string" ? v.slice(0, max * 2) : "", mine), max, multi);
  const problem = clean(f.problem, MAX_PROBLEM, true);
  // A request with no words gives us nothing to act on (and a fast double click would use up their hourly allowance).
  if (!problem.trim()) return { ok: false, message: HELP_EMPTY };
  const wait = allow(`wizhelp:${code}`, HELP_PER_HOUR, 60 * 60_000);
  if (wait) return { ok: false, message: `You've sent a few requests already. We have them; please wait ${Math.ceil(wait / 60)} minutes before sending another.` };
  const email = clean(f.contact, 200);
  const phone = clean(f.phone, 40).replace(/[^\d +().-]/g, "");
  const ctx: WizardContext = {
    source: "wizard", step, stepLabel: stepLabel(step),
    lastError: clean(lastErrorOf(s, step), 300),
    brand: clean(s.brand?.productName || "", 60),
    keysSet: ALL_SECRETS.filter((n) => hasSecret(b.id, n)),
    browser: clean(ua, 200),
    contactEmail: email || s.brand?.ownerEmail || b.email,
    contactPhone: phone,
  };
  const body = problem;
  const from = clean(s.brand?.ownerEmail || b.name, 80);
  const existing = db().query("SELECT * FROM tickets WHERE buyer_id = ? AND source = 'wizard' AND status <> 'closed' ORDER BY id DESC LIMIT 1").get(b.id) as Ticket | null;
  // Asking again without contact details keeps the ones they gave before.
  if (existing) { const prev = wizardCtx(existing); if (!email && prev.contactEmail) ctx.contactEmail = prev.contactEmail; if (!phone && prev.contactPhone) ctx.contactPhone = prev.contactPhone; }
  let id: number;
  if (existing) {
    id = existing.id;
    db().query("UPDATE tickets SET context = ?, subject = ? WHERE id = ?").run(JSON.stringify(ctx), `Help with setup: ${ctx.stepLabel} step`, id);
  } else {
    id = Number(db().query("INSERT INTO tickets (buyer_id, app_id, subject, status, context, from_name, created_at, updated_at, source) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, 'wizard')")
      .run(b.id, `wizard-${crypto.randomUUID()}`, `Help with setup: ${ctx.stepLabel} step`, JSON.stringify(ctx), from, now(), now()).lastInsertRowid);
  }
  const mid = Number(db().query("INSERT INTO ticket_messages (ticket_id, author, author_name, body, at) VALUES (?, 'agency', ?, ?, ?)").run(id, from, body, now()).lastInsertRowid);
  touch(id, "open");
  console.log(`[wizhelp] buyer ${b.id} asked for a person at ${step} (ticket ${id})`);
  void wizhelpHooks.alert(b.id, `problem:wizard-help-${mid}`, `Help request from ${b.name} at step ${ctx.stepLabel}${problem ? `: "${problem.slice(0, 160)}"` : ""}`).catch(() => {});
  return { ok: true, ticketId: id, created: !existing };
}

// ---------------- what the buyer sees (never our product name: "we" and "support" only) ----------------
const when = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** The ask-a-person form itself (fields: problem, contact, phone). `id` keeps the field ids unique when it appears twice on a page (the chat panel and the box at the bottom). */
export function personFormHtml(b: Buyer, s: SetupData, code: string, hidden: string, id = "person"): string {
  const t = wizardTicketOf(b.id);
  const email = s.brand?.ownerEmail || b.email;
  return `<form method="post" action="/setup/${esc(code)}/a/help-request" class="person-form">${hidden}
  <p class="hint">Stuck? Tell us what's wrong and a real person will help. ${t && t.status !== "closed" ? "This adds to your open request." : "We'll see it straight away."}</p>
  <label class="f" for="${id}-problem">What's the problem?</label>
  <textarea id="${id}-problem" name="problem" rows="3" required maxlength="${MAX_PROBLEM}" placeholder="e.g. The Railway token keeps saying it's not valid"></textarea>
  <label class="f" for="${id}-contact">Best way to reach you</label>
  <input id="${id}-contact" name="contact" type="email" maxlength="200" autocomplete="email" value="${esc(email)}">
  <input id="${id}-phone" name="phone" type="tel" maxlength="40" autocomplete="tel" placeholder="Phone (optional)" aria-label="Phone (optional)">
  <p class="hint">Please don't paste keys or tokens here.</p>
  <div class="nav"><span></span><div class="right"><button class="btn p" type="submit">Send to our team</button></div></div>
</form>`;
}

/**
 * The "Talk to a person" box at the bottom of every step: a collapsed form (works without script), and their open
 * request with our replies when there is one. `hidden` is the step's CSRF + view fields.
 */
export function personHelpHtml(b: Buyer, s: SetupData, code: string, hidden: string): string {
  const t = wizardTicketOf(b.id);
  const us = "Support";
  const msgs = t ? messagesOf(t.id) : [];
  const thread = t ? `<div class="person-req" id="person-request"><div class="person-head"><b>Your help request</b> <span class="pill ${t.status === "closed" ? "live" : t.status === "waiting" ? "installing" : "in-setup"}">${t.status === "closed" ? "Closed" : t.status === "waiting" ? "We replied" : "We've got it"}</span></div>
${msgs.map((m) => `<div class="person-msg ${m.author === "support" ? "us" : "me"}"><div class="who"><b>${m.author === "support" ? esc(us) : "You"}</b> <span>${esc(when(m.at))}</span></div><div class="text">${esc(m.body)}</div></div>`).join("")}
${t.status === "open" ? `<p class="hint">We'll get back to you shortly. Our reply shows here when you reload the page.</p>` : ""}</div>` : "";
  // No button of its own: the header's "Talk to a person" (#person) and the help panel's tab open it. :target shows the form without script.
  return `<div class="person" id="person">${thread}<div class="person-ask">${personFormHtml(b, s, code, hidden, "person")}</div></div>`;
}

/** For tests and the admin: the buyer-visible thread of a ticket. */
export const wizardThread = (id: number) => { const t = ticketById(id); return t ? { ticket: t, ctx: wizardCtx(t), messages: messagesOf(id) } : null; };
