// The "Set up for them" panel on /admin/b/<id> and its routes (POST /admin/b/<id>/assist/<what>, GET /admin/b/<id>/status).
// All the work is in assist.ts; this file is forms, the result page and the audit list. admin-web.ts hands us its page helpers.
import { now, type Buyer } from "./lib";
import { esc } from "./pages";
import { allow, appUrlOf, hostOf } from "./setup";
import { getSetup, logRead, hasSecret, secretHint, type SetupData } from "./store";
import { statusRev } from "./wizard";
import { supportLog } from "./sync";
import { cloudflareTokenLink } from "./dns";
import { hostOfBuyer, hostRecord } from "./hosts";
import {
  ASSIST_STEPS, canInstall, checkDns, cloudflareCheck, dnsRows, dropDnsCreds, dropHost, fillStep, finishExtras, installFor, inviteState, mailConfigured,
  markInvitedByHand, ownerLogin, sendInvite, setDomain, setOpenRouter, setupHost, stepRows, type DnsProvider, type Out,
} from "./assist";

export interface Helpers {
  hiddenT: (sid: string) => string;
  notice: (kind: "ok" | "err" | "info", html: string) => string;
  copyBtn: (v: string) => string;
  when: (iso?: string | null) => string;
  page: (title: string, body: string, opts?: { sid?: string; email?: string }) => string;
}

// A result is shown once, on the next page load (this process only; an admin who reloads loses nothing important: the audit log has it).
const flashes = new Map<string, { out: Out; at: number }>();
const flashKey = (sid: string, id: number) => `${sid}:${id}`;
const setFlash = (sid: string, id: number, out: Out) => { flashes.set(flashKey(sid, id), { out, at: Date.now() }); for (const [k, v] of flashes) if (Date.now() - v.at > 10 * 60_000) flashes.delete(k); };
const takeFlash = (sid: string, id: number) => { const k = flashKey(sid, id); const f = flashes.get(k); flashes.delete(k); return f?.out; };

export const ACTIVE_PHASES = ["creating", "deploying", "domain"];
export const isInstalling = (s: SetupData) => ACTIVE_PHASES.includes(s.phase);

const pass = (name: string, label: string, saved?: string | null, ph = "") => `<label class="f" for="a-${name}">${label}</label><input id="a-${name}" name="${name}" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" placeholder="${saved ? `Saved (${esc(saved)}). Paste a new one to replace it.` : esc(ph)}">`;
const text = (name: string, label: string, val = "", ph = "", extra = "") => `<label class="f" for="a-${name}">${label}</label><input id="a-${name}" name="${name}" maxlength="300" value="${esc(val)}" placeholder="${esc(ph)}" autocomplete="off" ${extra}>`;

export function assistPanel(h: Helpers, sid: string, b: Buyer, s: SetupData): string {
  const flash = takeFlash(sid, b.id);
  const rows = stepRows(b, s);
  const idle = s.phase === "idle" && !b.revoked_at;
  const form = (what: string, body: string, btn = "Save", cls = "btn p", attrs = "") => `<form method="post" action="/admin/b/${b.id}/assist/${what}" class="body sf"${attrs}>${h.hiddenT(sid)}${body}<div class="nav"><span></span><div class="right"><button class="${cls}" type="submit">${btn}</button></div></div></form>`;
  const box = (title: string, inner: string, open = false) => `<details class="log assistbox"${open ? " open" : ""}><summary>${title}</summary>${idle ? inner : `<p class="hint">Closed: their install has ${s.phase === "done" ? "finished" : "started"}.</p>`}</details>`;
  const by = (r: (typeof rows)[number]) => r.done ? `<span class="pill ${r.by === "you" ? "live" : "in-setup"}">${r.by === "you" ? "Done by you" : "Done by buyer"}</span>` : r.skipped ? `<span class="pill">Skipped</span>` : `<span class="pill not-started">${r.optional ? "Not added" : "To do"}</span>`;
  const table = `<table class="records steps"><thead><tr><th>Step</th><th>Status</th><th>What's set</th><th>When</th></tr></thead><tbody>${rows.map((r) => `<tr><td data-l="Step"><b>${esc(r.title)}</b>${r.optional ? ` <span class="hint">optional</span>` : ""}</td><td data-l="Status">${by(r)}</td><td data-l="What's set">${esc(r.detail)}</td><td data-l="When">${r.at ? `${esc(h.when(r.at))} · ${esc(r.who || "")}` : ""}</td></tr>`).join("")}${s.assist?.steps?.openrouter ? `<tr><td data-l="Step"><b>AI help (OpenRouter)</b> <span class="hint">optional</span></td><td data-l="Status"><span class="pill live">Done by you</span></td><td data-l="What's set">${esc(secretHint(b.id, "openrouter_key") || "key saved")}</td><td data-l="When">${esc(h.when(s.assist.steps.openrouter.at))} · ${esc(s.assist.steps.openrouter.by)}</td></tr>` : ""}</tbody></table>`;

  const brand = s.brand;
  const bcols = brand?.colours?.length ? brand.colours : brand?.colour ? [brand.colour] : [];
  const btheme = brand?.theme || "light";
  const brandForm = form("brand", `<div class="two"><div>${text("ownerName", "Owner name", brand?.ownerName || s.prefill?.ownerName || "", "e.g. Dana Smith")}</div><div>${text("ownerEmail", "Owner email", brand?.ownerEmail || s.prefill?.ownerEmail || b.email, "", 'type="email" required')}</div></div>
  <div class="two"><div>${text("productName", "Agency name", brand?.productName || s.prefill?.agencyName || "", "e.g. Acme AI", "required")}</div></div>
  <label class="f" for="logoFile">Logo (optional)</label><input id="logoFile" type="file" accept="image/png,image/jpeg,image/webp">
  <input type="hidden" id="logo" name="logo" value="${esc(brand?.logo || "")}"><input type="hidden" id="removeLogo" name="removeLogo" value="">
  <p class="hint" id="logoNote">${brand?.logo ? "Logo added. Choose another file to replace it." : "A PNG or JPG works best. It's shrunk in your browser."}</p>
  <p class="logoRow"><img id="logoPreview" alt="Logo" width="96"${brand?.logo ? ` src="${esc(brand.logo)}"` : " hidden"}> <button type="button" class="linkbtn" id="logoRemove"${brand?.logo ? "" : " hidden"}>Remove logo</button></p>
  <label class="f" for="colour">Brand colours <span class="hint">1 to 3, the first is the main one</span></label>
  <div class="colours">
    <label class="cpick" for="colour"><input id="colour" name="colour" type="color" value="${esc(bcols[0] || "#4f46e5")}" aria-label="Main colour"><span>Main</span></label>
    <label class="cpick" for="colour2"><input id="colour2" name="colour2" type="color" value="${esc(bcols[1] || "#0ea5e9")}" aria-label="Second colour"><span class="ctick"><input type="checkbox" name="colour2on" value="1"${bcols[1] ? " checked" : ""}> Second</span></label>
    <label class="cpick" for="colour3"><input id="colour3" name="colour3" type="color" value="${esc(bcols[2] || "#f59e0b")}" aria-label="Third colour"><span class="ctick"><input type="checkbox" name="colour3on" value="1"${bcols[2] ? " checked" : ""}> Third</span></label>
  </div>
  <label class="f">Look</label>
  <div class="choice looks"><label class="opt"><input type="radio" name="theme" value="light"${btheme === "light" ? " checked" : ""}><b>Light</b></label><label class="opt"><input type="radio" name="theme" value="dark"${btheme === "dark" ? " checked" : ""}><b>Dark</b></label></div>`);
  const hosting = form("railway", pass("token", "Railway account token", secretHint(b.id, "railway_token"), "Their Railway token (No workspace, Hobby plan)"), "Check and save");
  const phones = form("phones", `<h4>Telnyx (recommended)</h4>${pass("key", "Telnyx API key", secretHint(b.id, "telnyx_key"), "KEY...")}`, "Check and save")
    + form("phones-vapi", `<h4>Or use Vapi + Twilio</h4><p class="hint">Vapi for voice, Twilio for numbers and texts.</p><div class="two"><div>${pass("vapiKey", "Vapi private key", secretHint(b.id, "vapi_key"))}</div><div>${pass("vapiPublic", "Vapi public key", secretHint(b.id, "vapi_public"))}</div></div><div class="two"><div>${text("twilioSid", "Twilio Account SID", s.twilio?.sid)}</div><div>${pass("twilioToken", "Twilio auth token", secretHint(b.id, "twilio_token"))}</div></div>`, "Check and save Vapi + Twilio", "btn o");
  const email = form("email", `<p class="hint">Resend (the wizard adds the sending domain, and the records go in with their domain's DNS below).</p>${pass("key", "Resend API key", secretHint(b.id, "resend_key"), "re_...")}${text("address", "Send from", s.email?.address || "", "hello@mail.theirbusiness.com")}`, "Check and save")
    + form("email-smtp", `<p class="hint">Or their own SMTP.</p><div class="two"><div>${text("host", "SMTP server", s.email?.smtp?.host, "smtp.example.com")}</div><div>${text("port", "Port", String(s.email?.smtp?.port || 587))}</div></div><div class="two"><div>${text("user", "Username", s.email?.smtp?.user)}</div><div>${pass("pass", "Password", secretHint(b.id, "smtp_password"))}</div></div>${text("address", "Send from", s.email?.address || "", "hello@theirbusiness.com")}`, "Check and save", "btn o");
  const cal = form("calendars", `<p class="hint">Needs their own domain below. Redirect: <code>https://${esc(hostOf(s) || "app.theirdomain")}/api/oauth/google/callback</code> (and /microsoft/).</p><div class="two"><div>${text("googleId", "Google client ID", s.calendars?.google?.clientId)}</div><div>${pass("googleSecret", "Google client secret", secretHint(b.id, "google_secret"))}</div></div><div class="two"><div>${text("microsoftId", "Microsoft client ID", s.calendars?.microsoft?.clientId)}</div><div>${pass("microsoftSecret", "Microsoft client secret", secretHint(b.id, "microsoft_secret"))}</div></div>`, "Check and save");
  const backups = form("openrouter", `<p class="hint">Powers their receptionists and the "Ask for help" button.</p>${pass("key", "OpenRouter API key", secretHint(b.id, "openrouter_key"))}`, "Check and save");

  // ---- domain + DNS ----
  const d = s.domain;
  const zones = s.assist?.cfZones || [];
  const zoneInput = zones.length
    ? `<label class="f" for="a-domain-cf">Their domain</label><select id="a-domain-cf" name="domain">${zones.map((z) => `<option value="${esc(z)}"${z === d?.zone ? " selected" : ""}>${esc(z)}</option>`).join("")}</select>`
    : text("domain", "Their domain", d?.zone || "", "theirbusiness.com.au");
  const keep = `<label class="opt inline"><input type="checkbox" name="keep" value="1"${s.assist?.keepDns ? " checked" : ""}> <b>Keep the DNS login for later changes</b> <span class="hint">Otherwise it's deleted when the install finishes, like every other key.</span></label>`;
  const replace = `<label class="opt inline"><input type="checkbox" name="replace" value="1"${d?.replace || d?.cf?.replace ? " checked" : ""}> <b>Replace what's at app.&lt;domain&gt;</b> <span class="hint">Only if something already points there.</span></label>`;
  const dnsForms = `<p class="hint">Pick how their DNS is handled. The email records go in now; the agency's own address (CNAME + verify TXT) goes in during the install.</p>
  ${form("cf-check", `<h4>Cloudflare</h4>${pass("token", "Cloudflare API token", secretHint(b.id, "cf_token"), "Zone: Read + DNS: Edit")}<p class="hint"><a href="${esc(cloudflareTokenLink())}" target="_blank" rel="noopener noreferrer">Open Cloudflare with the token already filled in</a>, then paste it here and press Check to see their domains.</p>${zones.length ? `<p class="hint">This token sees: ${esc(zones.join(", "))}</p>` : ""}`, "Check token", "btn o")}
  ${form("domain", `<input type="hidden" name="provider" value="cloudflare">${zoneInput}${pass("token", "Cloudflare token (leave empty to use the one checked above)", secretHint(b.id, "cf_token"))}${replace}${keep}`, "Write the records with Cloudflare")}
  ${form("domain", `<h4>GoDaddy</h4><input type="hidden" name="provider" value="godaddy">${text("domain", "Their domain", d?.mode === "godaddy" ? d.zone : "", "theirbusiness.com.au")}<div class="two"><div>${pass("gdKey", "GoDaddy API key", secretHint(b.id, "godaddy_key"), "From developer.godaddy.com/keys (Production)")}</div><div>${pass("gdSecret", "GoDaddy API secret", secretHint(b.id, "godaddy_secret"))}</div></div>${replace}${keep}`, "Write the records with GoDaddy")}
  ${form("domain", `<h4>Someone adds the records</h4><input type="hidden" name="provider" value="manual">${text("domain", "Their domain", d?.mode === "manual" ? d.zone : "", "theirbusiness.com.au")}<p class="hint">We list every record with a copy button and a Check DNS button below.</p>`, "Use their domain, show the records", "btn o")}`;
  const recs = dnsRows(s);
  const mine = hostOfBuyer(b.id);
  const hostRows = mine ? [{ r: { ...hostRecord(mine.host), ok: !!mine.dns_ok_at }, group: "Their setup link" }] : [];
  const allRecs = [...hostRows, ...recs];
  const recTable = allRecs.length ? `<div data-dns-poll="/admin/b/${b.id}/assist/check-dns" data-t="${esc(h.hiddenT(sid).match(/value="([^"]+)"/)?.[1] || "")}"><table class="records dnsrecs"><thead><tr><th>For</th><th>Type</th><th>Name</th><th>Value</th><th>Seen</th></tr></thead><tbody>${allRecs.map(({ r, group }) => `<tr data-rec="${esc(r.key + ":" + r.name)}"><td data-l="For">${esc(group)}</td><td data-l="Type">${esc(r.type)}</td><td data-l="Name"><code>${esc(r.name)}</code> ${h.copyBtn(r.name)}</td><td data-l="Value" class="v"><code>${esc(r.value)}</code> ${h.copyBtn(r.value)}</td><td data-l="Seen" class="rok">${r.ok ? "✓ live" : r.seen ? `found: ${esc(r.seen)}` : "waiting"}</td></tr>`).join("")}</tbody></table>
  <form method="post" action="/admin/b/${b.id}/assist/check-dns-now" class="sf">${h.hiddenT(sid)}<button class="btn o" type="submit">Check DNS now</button> <span class="hint" data-dns-note>It keeps checking by itself every few seconds while this page is open.</span></form></div>` : `<p class="hint">No records yet. They appear here once the domain and email are filled in, and again when the install makes their address.</p>`;
  const held = (["cf_token", "godaddy_key"] as const).filter((n) => hasSecret(b.id, n));
  const dnsState = `${d?.host ? `<p>Domain: <b>${esc(d.host)}</b> · DNS by <b>${d.mode === "manual" ? "hand" : d.mode === "godaddy" ? "GoDaddy" : "Cloudflare"}</b>${d.confirmed ? "" : " · <b>not finished</b> (Cloudflare may be waiting for the nameserver switch: " + esc((d.cf?.nameServers || []).join(", ")) + ")"}</p>` : ""}
  ${held.length ? `<p class="hint">We hold their ${held[0] === "cf_token" ? "Cloudflare token" : "GoDaddy key"}${s.assist?.keepDns ? " and will keep it after the install (you ticked keep)" : "; it's deleted when the install finishes"}. <form method="post" action="/admin/b/${b.id}/assist/dns-drop" class="inl">${h.hiddenT(sid)}<button class="linkbtn" type="submit">Delete it now</button></form></p>` : ""}`;

  // ---- their setup link on their own domain ----
  const hostForm = (idle || s.phase === "done") && !b.revoked_at ? form("host", `<p class="hint">Their private link as <code>https://setup.theirbusiness.com/</code>: the wizard opens at the root, with their brand and no code in the address. The normal link keeps working. The record is a CNAME to our site; the https certificate is issued by our server on first use.</p>
  ${text("host", "Address", mine?.host || "", "setup.theirbusiness.com")}
  <label class="f" for="a-hprov">DNS</label><select id="a-hprov" name="provider"><option value="cloudflare">Cloudflare (write it)</option><option value="godaddy">GoDaddy (write it)</option><option value="manual">I'll add it / they will</option></select>
  ${pass("token", "Cloudflare token (empty = the one we hold)", secretHint(b.id, "cf_token"))}
  <div class="two"><div>${pass("gdKey", "GoDaddy key (empty = the one we hold)", secretHint(b.id, "godaddy_key"))}</div><div>${pass("gdSecret", "GoDaddy secret", secretHint(b.id, "godaddy_secret"))}</div></div>${keep}`, "Use this address") : "";
  const hostLine = mine ? `<p>Their setup link on their domain: <a href="https://${esc(mine.host)}/" target="_blank" rel="noopener noreferrer"><b>https://${esc(mine.host)}/</b></a> ${h.copyBtn(`https://${mine.host}/`)} <span class="pill ${mine.dns_ok_at ? "live" : "in-setup"}">${mine.dns_ok_at ? "DNS points here" : "DNS not seen yet"}</span> <form method="post" action="/admin/b/${b.id}/assist/host-drop" class="inl">${h.hiddenT(sid)}<button class="linkbtn" type="submit" data-confirm="Remove their own-domain link? The normal link keeps working.">Remove</button></form></p>` : "";

  // ---- install for them ----
  const can = canInstall(b, s);
  const log = logRead(b.id);
  const live = isInstalling(s);
  const installBlock = (() => {
    if (s.phase === "done") {
      const url = appUrlOf(s);
      return `<p>${h.notice("ok", `Installed${s.assist?.installBy ? ` by ${esc(s.assist.installBy.by)}` : ""}. Live at <a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><b>${esc(url)}</b></a> ${h.copyBtn(url)}${s.domainPending ? " (their own address starts working once its DNS records are in: use Check DNS above)" : ""}`)}</p>
      <p class="hint">Send the owner their dashboard login from <a href="/admin/b/${b.id}?tab=setup#invite">Invite them</a>, below.</p>`;
    }
    if (live) return `<p class="status"><span class="spin"></span>Installing: ${esc(s.progress?.[s.progress.length - 1] || s.phase)}. This page updates by itself; the log below streams.</p>`;
    if (s.phase === "failed" || s.phase === "create_failed") return `${h.notice("err", esc(s.error || "The install stopped."))}<form method="post" action="/admin/b/${b.id}/assist/install" class="sf">${h.hiddenT(sid)}<button class="btn p" type="submit">Try the install again</button></form>`;
    return `<form method="post" action="/admin/b/${b.id}/assist/install" class="sf">${h.hiddenT(sid)}${can.ok ? `<p class="hint">Everything required is filled in. Optional extras left empty are simply not added. This runs the same install as the buyer's Install button, in their Railway account.</p><button class="btn p" type="submit" data-confirm="Install ${esc(b.name)} now?">Install for them</button>` : `<p class="hint">${esc(can.why)}</p><button class="btn p" type="button" disabled>Install for them</button>`}</form>`;
  })();

  const audit = supportLog(b.id, 40);
  const auditHtml = audit.length ? `<ul class="audit">${audit.map((l) => `<li><span class="hint">${esc(h.when(l.at))}</span> · <b>${esc(l.admin_email)}</b> · ${esc(l.action)}${l.note ? ` · <span class="hint">${esc(l.note)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="hint">Nothing yet.</p>`;

  return `<section class="assist" id="assist">
<h2>Set up for them</h2>
  <p class="lead">Brand, domain &amp; setup</p>
<p class="hint">Fill in any step for ${esc(b.name)}, or all of them. Keys are checked with the same code the wizard uses, stored sealed, and deleted when the install finishes. When they open their link, the steps you did show as done ("Set up by your provider") and the rest are theirs.</p>
${flash ? h.notice(flash.kind || (flash.ok ? "ok" : "err"), esc(flash.message)).replace('class="notice ', 'class="notice flash ') : ""}
${table}
${box("Brand: name, logo, colour", brandForm)}
${box("Hosting: Railway token", hosting)}
${box("Phones: Telnyx key, or Vapi + Twilio", phones)}
${box("Optional: email (Resend or SMTP)", email)}
${box("Optional: calendars (Google, Microsoft)", cal)}
${box("AI: OpenRouter key", backups)}
<h3>Domain and DNS</h3>
${dnsState}
${box("Their own domain: Cloudflare, GoDaddy or by hand", dnsForms, !!d && !d.confirmed)}
${recTable}
<h3>Their setup link on their own domain</h3>
${hostLine}
${hostForm ? `<details class="log assistbox"><summary>${mine ? "Change the address" : "Use their domain for the setup link"}</summary>${hostForm}</details>` : ""}
<h3>Install for them</h3>
${installBlock}
${live || s.phase === "failed" || s.phase === "create_failed" || (s.phase === "done" && log.text) ? `<details class="log" open><summary>Install log (keys hidden)</summary><pre id="log" data-next="${log.next}">${esc(log.text.slice(-60000))}</pre></details>` : ""}
<h3>Audit log</h3>
${auditHtml}
</section>`;
}

/**
 * The last card on the agency page: "Invite them". Live install -> their dashboard login; otherwise -> their setup link, with
 * what we did and what's left. One send button (our site's email), the link with Copy, and when they were invited.
 */
export function inviteCard(h: Helpers, sid: string, b: Buyer, s: SetupData): string {
  const flash = takeFlash(sid, -b.id);
  const st = inviteState(b, s);
  const sent = b.invited_at ? `<span class="pill live">Invited ${esc(h.when(b.invited_at))}</span>` : `<span class="pill not-started">Not invited yet</span>`;
  const head = `<section class="card invite" id="invite"><div class="titlerow"><h2>Invite them</h2> ${sent}</div>
${flash ? h.notice(flash.kind || (flash.ok ? "ok" : "err"), esc(flash.message)).replace('class="notice ', 'class="notice flash ') : ""}`;
  if (b.demo === 1) return `${head}<p class="hint">A test run: nobody to invite.</p></section>`;
  if (b.revoked_at) return `${head}<p class="hint">Their link is turned off. Turn it back on to invite them.</p></section>`;
  const what = st.kind === "dashboard"
    ? `<p class="lead"><b>Send their dashboard login.</b> Their agency is live, so they get their owner login: a one-time set-your-password link, or (if no owner account exists yet) their dashboard's first-account page, which only <b>${esc(st.to)}</b> can sign up on.</p>
${st.link ? `<label class="f">Their dashboard</label><div class="linkrow"><code id="invite-link">${esc(st.link)}</code>${h.copyBtn(st.link)}</div>` : ""}`
    : `<p class="lead"><b>Send their setup link.</b> Their install isn't finished, so they get their private setup link and carry on from there.</p>
<div class="summary"><div><span>Done by us</span><b>${esc(st.done.join(", ") || "Nothing yet")}</b></div><div><span>Left for them</span><b>${esc(st.left.join(", ") || "Nothing: the install is running")}</b></div></div>
<label class="f">Their setup link</label><div class="linkrow"><code id="invite-link">${esc(st.link)}</code>${h.copyBtn(st.link)}</div>`;
  const preview = st.kind === "setup" ? `<p><a class="btn o" href="/admin/b/${b.id}/email">Preview the email</a></p>` : "";
  const mark = `<form method="post" action="/admin/b/${b.id}/assist/mark-invited" class="sf">${h.hiddenT(sid)}<button class="btn o" type="submit">I've sent it myself: mark as invited</button></form>`;
  const send = mailConfigured()
    ? `<form method="post" action="/admin/b/${b.id}/assist/invite" class="sf">${h.hiddenT(sid)}<div class="nav"><span></span><div class="right"><button class="btn p" type="submit" data-confirm="${esc(`Email ${st.to} now?`)}">Send invite email to ${esc(st.to)}</button></div></div></form>`
    : `${h.notice("info", "Email isn't set up on the setup site — copy and send it yourself.")}
${st.kind === "dashboard" ? `<form method="post" action="/admin/b/${b.id}/assist/owner-login" class="sf">${h.hiddenT(sid)}<button class="btn p" type="submit" name="email" value="">Get their one-time login link to send</button></form>` : ""}${mark}`;
  return `${head}${what}${preview}${send}</section>`;
}

/** What /admin/b/<id>/status returns while an install runs: the same shape the wizard's live script reads. */
export function statusJson(b: Buyer, from: number) {
  const s = getSetup(b.id);
  const log = logRead(b.id, from);
  return { rev: statusRev({ b, s }), phase: s.phase, step: s.step, log: log.text.slice(-60000), next: log.next };
}

export interface RouteCtx { sid: string; email: string; h: Helpers; redirect: (to: string) => Response; html: (body: string, status?: number) => Response; json: (o: unknown, status?: number) => Response }
const bool = (v: string | undefined) => v === "1";

/** POST /admin/b/<id>/assist/<what>. */
export async function assistRoute(what: string, b: Buyer, f: Record<string, string>, c: RouteCtx): Promise<Response> {
  const back = (out: Out) => { setFlash(c.sid, b.id, out); return c.redirect(`/admin/b/${b.id}?tab=setup#assist`); };
  const wait = allow(`assist:${c.email}`, 240, 60 * 60_000);
  if (wait) return back({ ok: false, message: `Too many changes just now. Wait ${Math.ceil(wait / 60)} minutes.`, kind: "err" });
  switch (what) {
    case "brand": return back(await fillStep(b, c.email, "brand", { productName: f.productName || "", ownerEmail: f.ownerEmail || "", ownerName: f.ownerName || "", logo: f.logo || "", removeLogo: f.removeLogo || "", colour: f.colour || "", colour2: f.colour2 || "", colour2on: f.colour2on || "", colour3: f.colour3 || "", colour3on: f.colour3on || "", theme: f.theme || "" }));
    case "railway": return back(await fillStep(b, c.email, "railway", { token: f.token || "" }));
    case "phones": return back(await fillStep(b, c.email, "phones", { key: f.key || "" }));
    case "phones-vapi": return back(await fillStep(b, c.email, "phones", { vapiKey: f.vapiKey || "", vapiPublic: f.vapiPublic || "", twilioSid: f.twilioSid || "", twilioToken: f.twilioToken || "" }, "phones-vapi"));
    case "email": return back(await fillStep(b, c.email, "email", { key: f.key || "", address: f.address || "" }));
    case "email-smtp": return back(await fillStep(b, c.email, "email", { mode: "smtp", host: f.host || "", port: f.port || "", user: f.user || "", pass: f.pass || "", address: f.address || "" }));
    case "calendars": return back(await fillStep(b, c.email, "calendars", { googleId: f.googleId || "", googleSecret: f.googleSecret || "", microsoftId: f.microsoftId || "", microsoftSecret: f.microsoftSecret || "" }));
    case "vapi": return back(await fillStep(b, c.email, "vapi", { vapiKey: f.vapiKey || "", vapiPublic: f.vapiPublic || "" }));
    case "twilio": return back(await fillStep(b, c.email, "twilio", { twilioSid: f.twilioSid || "", twilioToken: f.twilioToken || "" }));
    case "openrouter": return back(await setOpenRouter(b, c.email, f.key || ""));
    case "cf-check": return back(await cloudflareCheck(b, c.email, f.token || ""));
    case "domain": {
      const provider = (["cloudflare", "godaddy", "manual"].includes(f.provider) ? f.provider : "manual") as DnsProvider;
      return back(await setDomain(b, c.email, { provider, domain: f.domain || "", token: f.token, gdKey: f.gdKey, gdSecret: f.gdSecret, replace: bool(f.replace), keep: bool(f.keep) }));
    }
    case "dns-drop": return back(dropDnsCreds(b, c.email));
    case "host": {
      const provider = (["cloudflare", "godaddy", "manual"].includes(f.provider) ? f.provider : "manual") as DnsProvider;
      return back(await setupHost(b, c.email, { host: f.host || "", provider, token: f.token, gdKey: f.gdKey, gdSecret: f.gdSecret, replace: bool(f.replace), keep: bool(f.keep) }));
    }
    case "host-drop": return back(dropHost(b, c.email));
    case "install": return back(await installFor(b, c.email));
    case "check-dns-now": {
      if (allow(`assist-dns:${b.id}`, 30, 5 * 60_000)) return back({ ok: false, message: "Checked a lot just now. Wait a minute.", kind: "err" });
      const r = await checkDns(b);
      return back(r.live ? { ok: true, message: "Their own address answers now: the agency is live there.", kind: "ok" } : r.all && (!r.host || r.host.ok) ? { ok: true, message: "Every record is live.", kind: "ok" } : { ok: true, message: `${r.rows.filter((x) => x.ok).length} of ${r.rows.length} records are live${r.host && !r.host.ok ? "; their setup-link address doesn't point at us yet" : ""}. DNS can take a few minutes.`, kind: "info" });
    }
    case "check-dns": {
      // The page's polling script: JSON in, JSON out.
      if (allow(`assist-dns:${b.id}`, 30, 5 * 60_000)) return c.json({ error: "slow down" }, 429);
      const r = await checkDns(b);
      return c.json({ rows: r.rows, all: r.all, host: r.host?.ok ?? null, live: r.live ?? null });
    }
    case "mark-invited": { setFlash(c.sid, -b.id, markInvitedByHand(b, c.email)); return c.redirect(`/admin/b/${b.id}?tab=setup#invite`); }
    case "invite": {
      const r = await sendInvite(b, c.email);
      if (!r.ok) { setFlash(c.sid, -b.id, { ok: false, message: r.message, kind: "err" }); return c.redirect(`/admin/b/${b.id}?tab=setup#invite`); }
      if (r.mailed) { setFlash(c.sid, -b.id, { ok: true, message: `Invite emailed to ${r.to}: ${r.kind === "dashboard" ? "their dashboard login" : "their setup link"}.`, kind: "ok" }); return c.redirect(`/admin/b/${b.id}?tab=setup#invite`); }
      return c.html(c.h.page("Invite", `<section class="card narrow"><h1>${esc(b.name)}: invite</h1>
${c.h.notice("err", esc(r.mailError || "The email didn't send."))}
<p class="lead">${r.kind === "dashboard" ? `Their ${r.loginKind === "reset" ? `one-time login link (works once, runs out in ${r.minutes} minutes)` : "dashboard's first-account page"}` : "Their private setup link"}, to send to <b>${esc(r.to)}</b>:</p>
<div class="linkrow"><code id="invite-link">${esc(r.link)}</code>${c.h.copyBtn(r.link)}</div>
<form method="post" action="/admin/b/${b.id}/assist/mark-invited" class="sf">${c.h.hiddenT(c.sid)}<button class="btn o" type="submit">I've sent it myself: mark as invited</button></form>
<p><a href="/admin/b/${b.id}?tab=setup#invite">← Back to ${esc(b.name)}</a></p></section>`, { sid: c.sid, email: c.email }));
    }
    case "owner-login": {
      const r = await ownerLogin(b, c.email, bool(f.email));
      if (!r.ok) return back({ ok: false, message: r.message, kind: "err" });
      const lead = r.kind === "reset"
        ? `This link lets <b>${esc(r.to)}</b> choose their password and sign in as the owner. It works once and runs out in ${r.minutes} minutes.`
        : `No owner account exists yet, so this is their first-account page. <b>${esc(r.to)}</b> signs up there (only that address can) and picks a password.`;
      return c.html(c.h.page("Owner login", `<section class="card narrow"><h1>${esc(b.name)}: owner login</h1>
<p class="lead">${lead}</p>
${r.mailed ? c.h.notice("ok", `Emailed to ${esc(r.to)}.`) : r.mailError ? c.h.notice("err", esc(r.mailError)) : c.h.notice("info", "Copy the link and send it to them yourself. It isn't stored anywhere.")}
<div class="linkrow"><code id="owner-link">${esc(r.url)}</code>${c.h.copyBtn(r.url)}</div>
${r.mailed ? "" : `<form method="post" action="/admin/b/${b.id}/assist/mark-invited" class="sf">${c.h.hiddenT(c.sid)}<button class="btn o" type="submit">I've sent it myself: mark as invited</button></form>`}
<p><a href="/admin/b/${b.id}?tab=setup#invite">← Back to ${esc(b.name)}</a></p></section>`, { sid: c.sid, email: c.email }));
    }
  }
  return back({ ok: false, message: "That didn't work. Reload the page and try again.", kind: "err" });
}
void ASSIST_STEPS; void now;
