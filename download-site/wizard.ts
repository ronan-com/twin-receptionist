// The setup wizard's screens. Same look as the app's own Setup wizard: a step rail, one
// card per step with an icon tile, a headline, one short sentence, the inputs, one primary
// button. How-tos sit behind a collapsed "Show me how". Plain forms (they work without
// JavaScript); /wizard.js adds copy buttons and live progress.
import { CONFIG, RAILWAY, type Buyer, type Style } from "./lib";
import { DEMO, demoSample, isDemo } from "./demo";
import { esc } from "./pages";
import { howTo } from "./content";
import { chatBubble, chatHead } from "./chat";
import { oauthEnabled, type OAuthProvider } from "./oauth";
import { brokerOn, offered } from "./broker";
import { PHONE_LATER, agencyUrl, canView, firstOpen, hostOf, locked, oauthRedirect, phoneSkipped, stepDone, updateInfo, webUrl, zoneOf } from "./setup";
import { detailOf, hasAssist, helpedStep, stepRows, type AssistId } from "./assist";
import { personFormHtml, personHelpHtml } from "./wizhelp";
import { DEFAULT_REGION, DEFAULT_SIZE, RAILWAY_PLAN_UNKNOWN_MSG, RAILWAY_TRIAL_MSG } from "./providers";
import { OPTIONAL_HUB, STEPS, csrfToken, isOptional, logRead, secretHint, type DnsRecord, type SetupData, type StepId } from "./store";

// ---------------- icons (Lucide, MIT) ----------------
const I: Record<string, string> = {
  sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
  tag: '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  party: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  right: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  left: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
};
const icon = (n: string, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

/**
 * Provider logos: small simple marks drawn inline (no files, no hotlinks), in each provider's own colour. They are our own
 * simplified drawings, not the providers' artwork; paths use presentation attributes only, so they are safe under the page's CSP.
 */
const svgOf = (inner: string) => `<svg viewBox="0 0 32 32" aria-hidden="true">${inner}</svg>`;
const LOGO: Record<string, string> = {
  telnyx: svgOf('<rect width="32" height="32" rx="8" fill="#00c08b"/><path d="M9 11.5h14M16 11.5v10.5" stroke="#fff" stroke-width="3.4" stroke-linecap="round" fill="none"/>'),
  vapi: svgOf('<rect width="32" height="32" rx="8" fill="#0d1f1a"/><path d="M9 10.5l7 12.5 7-12.5" stroke="#5dfeca" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'),
  openrouter: svgOf('<rect width="32" height="32" rx="8" fill="#6366f1"/><path d="M8 12.5h11m-3.5-3.5l3.5 3.5-3.5 3.5M24 19.5H13m3.5-3.5L13 19.5l3.5 3.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'),
  railway: svgOf('<rect width="32" height="32" rx="8" fill="#13111c"/><path d="M8 20.5c.3-6.2 4.8-10.7 11-11M9.5 25c.2-4.2 3.2-7.4 7.5-7.7M16.5 25c.2-2.2 1.6-3.7 3.8-4" stroke="#fff" stroke-width="2.3" stroke-linecap="round" fill="none"/>'),
  resend: svgOf('<rect width="32" height="32" rx="8" fill="#111"/><rect x="8" y="10" width="16" height="12" rx="2.4" stroke="#fff" stroke-width="2.2" fill="none"/><path d="M9 12l7 5 7-5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'),
  twilio: svgOf('<rect width="32" height="32" rx="8" fill="#f22f46"/><circle cx="16" cy="16" r="7.2" fill="none" stroke="#fff" stroke-width="2"/><circle cx="13.4" cy="13.4" r="1.5" fill="#fff"/><circle cx="18.6" cy="13.4" r="1.5" fill="#fff"/><circle cx="13.4" cy="18.6" r="1.5" fill="#fff"/><circle cx="18.6" cy="18.6" r="1.5" fill="#fff"/>'),
  domain: svgOf('<rect width="32" height="32" rx="8" fill="#0ea5e9"/><circle cx="16" cy="16" r="7" stroke="#fff" stroke-width="2.2" fill="none"/><path d="M9 16h14M16 9c2.6 2.2 2.6 11.8 0 14M16 9c-2.6 2.2-2.6 11.8 0 14" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/>'),
};
/** A provider's logo as a tile: "sm" inline, "big" at the top of a step. */
const plogo = (p: string, size: "sm" | "big" = "sm") => `<span class="pl ${size}">${LOGO[p] || ""}</span>`;
/** The generic mark next to the agency name: the buyer's own logo once they've added one, else a plain neutral one. */
const GENERIC_MARK = svgOf('<rect width="32" height="32" rx="9" fill="#101828"/><path d="M9 17v-2M13 20v-8M17 23V9M21 19v-6M25 17v-2" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none"/>');
const markLogo = (logo?: string) => (logo && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(logo) ? `<img class="mlogo" src="${esc(logo)}" alt="" width="28" height="28">` : `<span class="mlogo">${GENERIC_MARK}</span>`);

const META: Record<StepId, { title: string; short: string; icon: string; hue: string }> = {
  welcome: { title: "Welcome", short: "", icon: "sparkles", hue: "indigo" },
  brand: { title: "Brand", short: "Name, logo, colour", icon: "tag", hue: "indigo" },
  domain: { title: "Domain", short: RAILWAY ? "Optional" : "Your web address", icon: "globe", hue: "cyan" },
  server: { title: "Server", short: "DigitalOcean", icon: "server", hue: "indigo" },
  railway: { title: "Hosting", short: "Railway", icon: "server", hue: "indigo" },
  phones: { title: "Voice", short: "Telnyx", icon: "phone", hue: "indigo" },
  ai: { title: "AI", short: "OpenRouter", icon: "sparkles", hue: "indigo" },
  email: { title: "Email", short: "Optional", icon: "mail", hue: "green" },
  calendars: { title: "Calendars", short: "Optional", icon: "calendar", hue: "magenta" },
  extras: { title: "Connect more", short: "Optional", icon: "sparkles", hue: "cyan" },
  vapi: { title: "Vapi", short: "Backup option", icon: "phone", hue: "coral" },
  twilio: { title: "Twilio", short: "Optional", icon: "phone", hue: "coral" },
  install: { title: "Install", short: RAILWAY ? "About 10 min" : "About 15 min", icon: "rocket", hue: "violet" },
  done: { title: "Live", short: "", icon: "party", hue: "green" },
};

interface Ctx { b: Buyer; s: SetupData; code: string; sid: string; view: StepId; flash?: SetupData["flash"]; /** Voice step: which provider card was opened (?opt=telnyx|vapi). */ opt?: string }
const base = (c: Ctx) => `/setup/${esc(c.code)}`;
const hidden = (c: Ctx) => `<input type="hidden" name="t" value="${esc(csrfToken(c.sid, c.code))}"><input type="hidden" name="v" value="${c.view}">`;
/** The step's main form. Its primary button lives in the nav, via form="main". */
const mainForm = (c: Ctx, action: string, body: string) => `<form id="main" method="post" action="${base(c)}/a/${action}">${hidden(c)}${body}</form>`;
/** A small one-button form (secondary actions). */
const mini = (c: Ctx, action: string, label: string, cls = "btn o", extra = "", fields = "") =>
  `<form method="post" action="${base(c)}/a/${action}">${hidden(c)}${fields}<button class="${cls}" type="submit"${extra}>${label}</button></form>`;
const primary = (label: string, formId = "main") => `<button class="btn p" type="submit" form="${formId}">${label} ${icon("right")}</button>`;
const val = (c: Ctx, k: string, d = "") => esc(c.flash?.form?.[k] ?? (d || demoSample(c.view, k, c.code, isDemo(c.b))));
const secretIn = (name: string, ph: string, saved: string | null, label: string) =>
  `<label class="f" for="${name}">${label}</label><input id="${name}" name="${name}" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" placeholder="${saved ? `Saved (${esc(saved)}). Paste a new one to replace it.` : esc(ph)}">`;
/** Demo: put the pretend value into a screen's empty inputs. */
function demoFill(c: Ctx, html: string): string {
  if (!isDemo(c.b)) return html;
  return html.replace(/<input id="(token|key|domain|address)"([^>]*?)>/g, (m, id, rest) => {
    const v = demoSample(c.view, id, c.code, true);
    if (!v) return m;
    return `<input id="${id}"${/ value="/.test(rest) ? rest.replace(/ value=""/, ` value="${esc(v)}"`) : `${rest} value="${esc(v)}"`}>`;
  });
}
const copy = (v: string) => `<button type="button" class="copy" data-copy="${esc(v)}">Copy</button>`;
const notice = (kind: "err" | "ok" | "warn" | "info", html: string) => `<div class="notice ${kind}">${icon(kind === "ok" ? "check" : kind === "err" || kind === "warn" ? "alert" : "info")}<div>${html}</div></div>`;
const when = (iso?: string) => (iso ? new Date(iso).toISOString().slice(11, 19) + " UTC" : "");

function showMeHow(ids: string[]) {
  const parts = ids.map((id) => {
    const h = howTo(id);
    const meta = [h.time, h.cost].filter(Boolean).map((x) => esc(x!)).join(" · ");
    return `<section class="howpart"><h3>${esc(h.title)}</h3>${meta ? `<p class="howmeta">${meta}</p>` : ""}${h.html}</section>`;
  }).join("");
  // Without script this is a plain open/close box; /wizard.js turns it into a side panel.
  return `<details class="how" data-title="${esc(ids.length > 1 ? "Show me how" : howTo(ids[0]).title)}"><summary>Show me how</summary><div class="howbox">${parts}<p><a class="more-link" href="/guide#${esc(ids[0])}" target="_blank" rel="noopener">Open the full guide ${icon("ext")}</a></p></div></details>`;
}

function head(c: Ctx, title: string, lead: string, prov?: string) {
  const m = META[c.view];
  return `${prov ? plogo(prov, "big") : `<div class="ico ${m.hue}">${icon(m.icon)}</div>`}<h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ""}`;
}
/** The big button that opens the provider's own page where the key is made (new tab, so the wizard stays put). */
const openBtn = (prov: string, href: string, label: string) => `<p><a class="btn p big prov" data-prov="${prov}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${plogo(prov)}<span>${label}</span>${icon("ext")}</a></p>`;
/** Two or three short numbered steps (one line each). */
const mini3 = (steps: string[]) => `<ol class="mini3">${steps.map((x) => `<li>${x}</li>`).join("")}</ol>`;
function nav(c: Ctx, right: string, opts: { back?: boolean } = {}) {
  const i = STEPS.indexOf(c.view);
  // An optional step goes back to the extras screen; the others to the step before, skipping optional ones.
  const prev = isOptional(c.view) ? OPTIONAL_HUB : [...STEPS.slice(0, i)].reverse().find((id) => !isOptional(id));
  const back = opts.back !== false && i > 1 && c.view !== "done" && prev ? `<a class="btn g" href="${base(c)}?step=${prev}">${icon("left")} Back</a>` : "<span></span>";
  // Test sites only: a plain link to look at the next step without filling this one in.
  const skip = CONFIG.previewJump && i < STEPS.length - 1 ? `<a class="btn g" href="${base(c)}?step=${STEPS[i + 1]}">Skip (preview)</a>` : "";
  return `<div class="nav">${back}<div class="right">${skip}${right}</div></div>`;
}
/** The buyer's brand. Before they've named it, a plain "your agency": nothing of ours shows anywhere. */
const NEUTRAL = "your agency";
const P = (c: Ctx) => esc(c.s.brand?.productName || NEUTRAL);

// ======================= screens =======================
function welcome(c: Ctx) {
  const rows = RAILWAY
    ? `<li>${plogo("railway")}<b>Hosting</b><span>Railway</span></li><li>${plogo("telnyx")}<b>Voice</b><span>Telnyx or Vapi</span></li><li>${plogo("openrouter")}<b>AI</b><span>OpenRouter</span></li>`
    : `<li><b>Server</b><span>DigitalOcean</span></li><li>${plogo("telnyx")}<b>Voice</b><span>Telnyx</span></li><li>${plogo("openrouter")}<b>AI</b><span>OpenRouter</span></li>`;
  return `${head(c, "Set up your agency", RAILWAY ? "About 10 minutes. Close the page any time: your link remembers where you were." : "A few short steps. About 20 minutes.")}
<ul class="needs">${rows}</ul>
<p class="hint">Everything stays yours.</p>
${mainForm(c, "start", "")}
${nav(c, primary("Start"), { back: false })}`;
}

function brand(c: Ctx) {
  const br = c.s.brand;
  const cols = br?.colours?.length ? br.colours : br?.colour ? [br.colour] : [];
  const theme = br?.theme || "light";
  return `${head(c, "Your brand", "")}
<div class="body">${mainForm(c, "brand", `
  <label class="f" for="productName">Name</label>
  <input id="productName" name="productName" maxlength="60" required value="${val(c, "productName", br?.productName || "")}" placeholder="Acme AI">
  <label class="f" for="ownerEmail">Your email</label>
  <input id="ownerEmail" name="ownerEmail" type="email" maxlength="200" required autocomplete="email" value="${val(c, "ownerEmail", br?.ownerEmail || c.b.email)}">
  <label class="f" for="logoFile">Logo <span class="tag">Optional</span></label>
  <input id="logoFile" type="file" accept="image/png,image/jpeg,image/webp">
  <input type="hidden" id="logo" name="logo" value="${esc(br?.logo || "")}">
  <input type="hidden" id="removeLogo" name="removeLogo" value="">
  <p class="hint" id="logoNote">${br?.logo ? "Logo added. Pick another to replace it." : ""}</p>
  <p class="logoRow"><img id="logoPreview" alt="Your logo" width="96"${br?.logo ? ` src="${esc(br.logo)}"` : " hidden"}> <button type="button" class="linkbtn" id="logoRemove"${br?.logo ? "" : " hidden"}>Remove logo</button></p>
  <label class="f" for="colour">Brand colours <span class="tag">1 to 3</span></label>
  <div class="colours">
    <label class="cpick" for="colour"><input id="colour" name="colour" type="color" value="${esc(cols[0] || "#4f46e5")}" aria-label="Main colour"><span>Main</span></label>
    <label class="cpick" for="colour2"><input id="colour2" name="colour2" type="color" value="${esc(cols[1] || "#0ea5e9")}" aria-label="Second colour"><span class="ctick"><input type="checkbox" name="colour2on" value="1"${cols[1] ? " checked" : ""}> Second</span></label>
    <label class="cpick" for="colour3"><input id="colour3" name="colour3" type="color" value="${esc(cols[2] || "#f59e0b")}" aria-label="Third colour"><span class="ctick"><input type="checkbox" name="colour3on" value="1"${cols[2] ? " checked" : ""}> Third</span></label>
  </div>
  <label class="f">Look</label>
  <div class="choice looks"><label class="opt"><input type="radio" name="theme" value="light"${theme === "light" ? " checked" : ""}><b>Light</b></label><label class="opt"><input type="radio" name="theme" value="dark"${theme === "dark" ? " checked" : ""}><b>Dark</b></label></div>
  <p class="hint">You can change the colours and the look later in your dashboard.</p>`)}</div>
${nav(c, primary("Continue"))}`;
}

function domainStep(c: Ctx) {
  const d = c.s.domain;
  const cf = d?.cf;
  if (RAILWAY && d?.mode === "manual" && d.host && !c.flash?.form?.mode) return domainManualRecords(c);
  // Waiting for the nameserver switch: its own screen.
  if (d?.mode === "cloudflare" && cf?.zoneId && cf.status && cf.status !== "active") {
    return `${head(c, "Switch your nameservers", `At the company you bought <b>${esc(d.zone!)}</b> from, replace its nameservers with these two.`)}
<div class="ns">${(cf.nameServers || []).map((n) => `<div><code>${esc(n)}</code>${copy(n)}</div>`).join("")}</div>
${notice("warn", "Have a website or email on this domain? Check Cloudflare copied all your records before you switch.")}
<p class="status"><span class="spin"></span>Waiting for the switch. This can take minutes or hours; you can close this page.</p>
${showMeHow(["registrar-nameservers"])}
${nav(c, `${mini(c, "domain-edit", "Change domain", "btn o")}${mini(c, "cf-recheck", "Check now", "btn p")}`)}`;
  }
  const mode = c.flash?.form?.mode || d?.mode || (isDemo(c.b) ? "manual" : "cloudflare");
  const zone = c.flash?.form?.domain || d?.zone || (RAILWAY && c.s.email?.sendingDomain ? c.s.email.sendingDomain.replace(/^(mail|send|email|mg|news)\./, "") : "");
  const saved = d?.mode === "cloudflare" ? secretHint(c.b.id, "cf_token") : null;
  const replace = d?.mode === "cloudflare" && cf?.status === "active" && cf.existing && !d.confirmed
    ? `${notice("warn", `<b>app.${esc(d.zone!)}</b> already points somewhere else.`)}<label class="opt"><input type="checkbox" name="replace" value="1"><b>Replace it with my new server</b><small>Nothing else on your domain changes.</small></label>` : "";
  return `${head(c, RAILWAY ? "Your own web address (optional)" : "Your web address", RAILWAY ? "Your agency already works at the https address Railway gives it. Add your domain to use app.your-domain instead. Your main website stays as it is." : "Your dashboard will live at app.your-domain. Your main website stays as it is.")}
<div class="body">${mainForm(c, "domain", `
  <label class="f" for="domain">Your domain</label>
  <input id="domain" name="domain" maxlength="253"${c.b.demo === 1 ? "" : " required"} autocapitalize="off" spellcheck="false" placeholder="yourbusiness.com.au" value="${esc(zone)}">
  <p class="hint">Your dashboard: <b id="pv">app.${esc(zone || "your-domain")}</b></p>
  <div class="choice">
    <label class="opt"><input type="radio" name="mode" value="cloudflare"${mode !== "manual" ? " checked" : ""}><b>Let the wizard handle DNS <span class="tag">Recommended</span></b><small>Use a free Cloudflare account; we add every record for you.</small></label>
    <label class="opt"><input type="radio" name="mode" value="manual"${mode === "manual" ? " checked" : ""}><b>I'll add the records myself</b><small>Keep DNS where it is. We tick each record off as it appears.</small></label>
  </div>
  <div class="only-cf">
    ${secretIn("token", "Paste your Cloudflare API token", saved, "Cloudflare API token")}
    <p class="hint">Use the <b>Edit zone DNS</b> template and add <b>Zone: Read</b>, for this domain.</p>
    ${showMeHow(["cloudflare-domain", "registrar-nameservers", "cloudflare-token"])}
  </div>
  <div class="only-manual">${RAILWAY ? `<p class="hint">We'll show you each record to add, with a tick as it appears.</p>` : ""}${showMeHow(["registrar-dns-records"])}</div>
  ${replace}`)}</div>
${nav(c, `${RAILWAY ? mini(c, "domain-skip", "Skip for now", "btn o") : c.b.demo === 1 ? mini(c, "domain", "Skip this step", "btn o", "", `<input type="hidden" name="domain" value="">`) : ""}${primary("Continue")}`)}`;
}

/** "Login with ..." button. Only drawn when that login is set up on this site. */
const oauthBtn = (c: Ctx, p: OAuthProvider, label: string) => (oauthEnabled(p) ? `<p><a class="btn p big oauth" data-oauth="${p}" href="${base(c)}/oauth/${p}">${label}</a></p>` : "");
/** The paste-a-key form: open on its own when there's no login button, otherwise tucked under "or paste". */
const pasteBox = (c: Ctx, p: OAuthProvider, form: string, open = false) =>
  oauthEnabled(p) ? `<details class="alt"${open || c.flash?.kind === "err" ? " open" : ""}><summary>Paste a key instead</summary>${form}</details>` : form;
const okRow = (text: string) => `<div class="okrow">${icon("check")}<b>${text}</b></div>`;

function railwayStep(c: Ctx) {
  const saved = secretHint(c.b.id, "railway_token");
  // "Connected" is what's really stored: the saved flag AND the token itself (a purged or replaced one must not still say connected).
  const on = !!c.s.railway?.confirmed && hasS(c, "railway_token");
  const form = (id: string, button: string) => `<form id="${id}" method="post" action="${base(c)}/a/railway">${hidden(c)}
  ${secretIn("token", "Paste your Railway token", saved, "Railway token")}
  ${button}</form>`;
  const create = `${openBtn("railway", "https://railway.com/account/tokens", "Open Railway and create your token")}
${mini3(["Sign in to Railway.", "Name the token, leave <b>No workspace</b>, press <b>Create</b>.", "Copy the token and paste it below."])}`;
  const plan = `<p class="hint">Needs the <b>Hobby plan</b> on Railway (US$5 a month, with a card). The free trial can set things up but stops after 30 days.</p>`;
  const signIn = oauthEnabled("railway") ? `<p class="hint"><a data-oauth="railway" href="${base(c)}/oauth/railway">Or connect with your Railway sign-in</a></p>` : "";
  if (on) {
    return `${head(c, "Hosting", "", "railway")}
<div class="body">${okRow(`Railway connected${c.s.railway?.workspaceName ? ` · ${esc(c.s.railway.workspaceName)}` : ""}`)}
${c.s.railway?.trial ? notice("warn", `<b>You're on Railway's free trial.</b> ${esc(RAILWAY_TRIAL_MSG.replace(/^Your Railway account is on its free trial\. /, ""))} After upgrading, connect again here. Or continue to just try it.`) : ""}
${c.s.railway?.planUnknown ? notice("warn", esc(RAILWAY_PLAN_UNKNOWN_MSG)) : ""}
<details class="alt"${c.flash?.kind === "err" ? " open" : ""}><summary>Use a different token</summary>${create}${form("swap", `<p><button class="btn o" type="submit">Check token</button></p>`)}</details></div>
${nav(c, mini(c, "railway-continue", `Continue ${icon("right")}`, "btn p"))}`;
  }
  return `${head(c, "Connect Railway", "Your agency runs in your own Railway account.", "railway")}
<div class="body">${create}
${form("main", `${plan}${showMeHow(["railway-token"])}`)}${signIn}</div>
${nav(c, primary("Check and continue"))}`;
}
const hasS = (c: Ctx, n: Parameters<typeof secretHint>[1]) => !!secretHint(c.b.id, n) || c.b.demo === 1 || c.s.phase !== "idle";

/** Railway order, "I'll add the records myself": the email records to add now. */
function domainManualRecords(c: Ctx) {
  const rs = c.s.email?.resend;
  const rows = [...(rs?.records || []), ...(rs?.dmarc ? [rs.dmarc] : [])];
  return `${head(c, "Add your email records", `Add each one where you manage DNS for <b>${esc(c.s.domain!.zone!)}</b>. They tick off as they appear; you can keep going meanwhile.`)}
${rows.length ? recordTable(rows, true) : notice("info", "Nothing to add for email.")}
<p class="hint">Your dashboard's two records come on the Install step.</p>
${showMeHow(["registrar-dns-records"])}
${rs && rs.status !== "verified" ? `<p class="status"><span class="spin"></span>Waiting for Resend to verify${rs.lastCheck ? ` · checked ${when(rs.lastCheck)}` : ""}</p>` : rs ? notice("ok", "Resend verified your email domain.") : ""}
${mainForm(c, "domain-continue", "")}
${nav(c, `${mini(c, "domain-edit", "Change domain", "btn o")}${primary("Continue")}`)}`;
}

const REGIONS = [["syd1", "Sydney"], ["sgp1", "Singapore"], ["blr1", "Bangalore"], ["sfo3", "San Francisco"], ["nyc3", "New York"], ["tor1", "Toronto"], ["lon1", "London"], ["fra1", "Frankfurt"], ["ams3", "Amsterdam"]];
const SIZES: [string, string][] = [["s-2vcpu-2gb", "2 GB · US$18/mo · recommended"], ["s-1vcpu-2gb", "2 GB, 1 CPU · US$12/mo"], ["s-2vcpu-4gb", "4 GB · US$24/mo"]];

function server(c: Ctx) {
  const sv = c.s.server;
  const saved = secretHint(c.b.id, "do_token");
  const region = c.flash?.form?.region || sv?.region || DEFAULT_REGION;
  const size = c.flash?.form?.size || sv?.size || DEFAULT_SIZE;
  const regions = sv?.regions?.map((r) => [r.slug, r.name.replace(/ \d+$/, "")]) || REGIONS;
  const sizes: [string, string][] = sv?.sizes ? sv.sizes.map((z) => [z.slug, `${(z.label.match(/(\d+) GB memory/) || [])[1] || "?"} GB, ${(z.label.match(/^(\d+) CPU/) || [])[1] || "?"} CPU · US$${z.price}/mo${z.slug === DEFAULT_SIZE ? " · recommended" : ""}`]) : SIZES;
  return `${head(c, "Your server", "We create one server in your DigitalOcean account. You pay DigitalOcean directly.")}
<div class="body">${mainForm(c, "server", `
  ${secretIn("token", "dop_v1_...", saved, "DigitalOcean API token")}
  <div class="two">
    <div><label class="f" for="region">Location</label><select id="region" name="region">${regions.map(([v, n]) => `<option value="${esc(v)}"${v === region ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></div>
    <div><label class="f" for="size">Size</label><select id="size" name="size">${sizes.map(([v, n]) => `<option value="${esc(v)}"${v === size ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></div>
  </div>
  ${showMeHow(["digitalocean-token"])}
  <details class="advanced"><summary>Advanced: add your own SSH key</summary>
    <label class="f" for="sshPublicKey">SSH public key (optional)</label>
    <textarea id="sshPublicKey" name="sshPublicKey" rows="2" spellcheck="false" placeholder="ssh-ed25519 AAAA... you@laptop">${val(c, "sshPublicKey", sv?.sshPublicKey || "")}</textarea>
    <p class="hint">Lets you log in to the server yourself. We never hold a key to it.</p>
  </details>`)}</div>
${nav(c, primary("Check and continue"))}`;
}

/** Railway: the buyer can install with no phone provider and connect it later in their dashboard. */
const skipPhones = (c: Ctx) => (RAILWAY && !c.s.phones?.confirmed && !c.s.vapi?.confirmed ? `<div class="skip-phones">${mini(c, "phones-skip", "Skip for now", "linkbtn", " data-skip-phones")}</div>` : "");
/** After a skip: a gentle nudge to connect now (before the install), and the same reminder on the Done screen. */
const phoneLaterNote = (c: Ctx) => notice("warn", `<b>No voice provider yet.</b> ${esc(PHONE_LATER)}.${c.s.phase === "idle" && c.view !== "phones" ? ` <a class="btn o" href="${base(c)}?step=phones" data-action="connect-phones">Connect now</a>` : ""}`);

const phonesSummary = (c: Ctx) => {
  if (phoneSkipped(c.s)) return esc(PHONE_LATER);
  const t = secretHint(c.b.id, "telnyx_key");
  const telnyx = c.s.phones?.confirmed ? `Telnyx ${esc(t || "")}`.trim() : "";
  if (c.s.vapi?.confirmed && c.s.twilio?.confirmed && !telnyx) return `Vapi ${esc(secretHint(c.b.id, "vapi_key") || "")} + Twilio`.replace("  ", " ");
  const bits = [telnyx || (t ? `Telnyx ${esc(t)}` : "")];
  if (c.s.vapi?.confirmed || c.s.phones?.provider === "vapi") bits.push(`Vapi ${esc(secretHint(c.b.id, "vapi_key") || "")}`.trim());
  if (c.s.twilio?.confirmed || c.s.phones?.twilioSid) bits.push("Twilio");
  return bits.filter(Boolean).join(" + ") || "Telnyx";
};

/** Vapi (voice) with optional Twilio (numbers and texts): the way in when Telnyx isn't used, or a backup engine next to it. */
function vapiTwilio(c: Ctx): string {
  const tel = !!c.s.phones?.confirmed;
  const on = !!c.s.vapi?.confirmed;
  const fl = c.flash?.form || {};
  const form = `<form id="vapitwilio" method="post" action="${base(c)}/a/phones-vapi">${hidden(c)}
  <div class="two"><div>${secretIn("vapiKey", "Private key", secretHint(c.b.id, "vapi_key"), "Vapi private key")}</div>
  <div><label class="f" for="vapiPublic">Vapi public key</label><input id="vapiPublic" name="vapiPublic" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" placeholder="Public key" value="${esc(fl.vapiPublic ?? "")}"></div></div>
  <div class="two"><div><label class="f" for="twilioSid">Twilio Account SID <span class="tag">Optional</span></label><input id="twilioSid" name="twilioSid" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="60" placeholder="AC..." value="${esc(fl.twilioSid ?? c.s.twilio?.sid ?? "")}"></div>
  <div>${secretIn("twilioToken", "Auth Token", secretHint(c.b.id, "twilio_token"), "Twilio Auth Token")}</div></div>
  ${showMeHow(["vapi-account", "twilio-account"])}
  <p><button class="btn o" type="submit" data-action="phones-vapi">Check and save</button></p></form>`;
  const status = on ? okRow(`Vapi connected${c.s.twilio?.confirmed ? " + Twilio" : ""}${tel ? " (backup)" : ""} ${mini(c, "phones-vapi-remove", "Remove", "linkbtn")}`) : "";
  return `<section class="phone-alt" data-option="vapi-twilio"><details class="alt"${on || c.flash?.form?.vapiPublic !== undefined || (c.flash?.kind === "err" && c.flash?.form?.twilioSid !== undefined) ? " open" : ""}><summary>${tel ? "Add Vapi as a backup" : "Can't use Telnyx? Use Vapi + Twilio"}</summary>${status}${form}</details></section>`;
}

function phones(c: Ctx) {
  const s = c.s;
  const tel = !!s.phones?.confirmed;
  const saved = secretHint(c.b.id, "telnyx_key");
  const nums = s.phones?.numbers || [];
  const connected = tel ? `${okRow(`Telnyx connected${s.phones?.balance ? ` · ${esc(s.phones.balance)}` : ""}`)}
  <div class="nums"><h3>Your numbers</h3>${nums.length ? `<ul>${nums.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : `<p class="hint">No numbers on this account yet. Add them later.</p>`}</div>` : "";
  const form = `<form id="main" method="post" action="${base(c)}/a/phones">${hidden(c)}
  ${secretIn("key", "KEY...", saved, "Telnyx API key")}
  ${showMeHow(["telnyx-account", "telnyx-api-key"])}
  <p><button class="btn o" type="submit">Check key</button></p></form>`;
  const ready = tel || !!s.vapi?.confirmed || phoneSkipped(s);
  return `${head(c, "Voice", "Telnyx carries your calls.")}
<div class="body">${connected}
${tel ? "" : `${oauthBtn(c, "telnyx", "Sign in with Telnyx")}${pasteBox(c, "telnyx", form, !oauthEnabled("telnyx"))}`}
${vapiTwilio(c)}
${phoneSkipped(s) ? phoneLaterNote(c) : skipPhones(c)}</div>
${nav(c, ready ? mini(c, "phones-continue", `Continue ${icon("right")}`, "btn p") : "")}`;
}

function vapi(c: Ctx) {
  const vSaved = secretHint(c.b.id, "vapi_key");
  return `${head(c, "Vapi for voice", "Your receptionists run on your own Vapi account. Add Twilio too for Australian numbers and texts.")}
<div class="body">${mainForm(c, "vapi", `
  ${secretIn("vapiKey", "Private key", vSaved, "Vapi private API key")}
  <label class="f" for="vapiPublic">Vapi public key (used by the browser test call)</label><input id="vapiPublic" name="vapiPublic" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" placeholder="Public key" value="${val(c, "vapiPublic", "")}">
  ${showMeHow(["vapi-account", "twilio-account"])}`)}
  ${phoneSkipped(c.s) ? "" : skipPhones(c)}</div>
${nav(c, `${mini(c, "vapi-skip", "Skip", "linkbtn")}${primary("Check and continue")}`)}`;
}

function twilio(c: Ctx) {
  return `${head(c, "Connect Twilio", RAILWAY ? "Australian numbers and follow-up texts, on your own Twilio account." : "A backup option. Buy Australian numbers on your own Twilio account, or use ones you already have, and send follow-up texts from them. It works with the Vapi backup option. You can also add it later under Connections.", RAILWAY ? "twilio" : undefined)}
<div class="body">${RAILWAY ? `${openBtn("twilio", "https://console.twilio.com/", "Open Twilio and copy your two details")}
${mini3(["Sign in to Twilio.", "On the Console home page, find <b>Account Info</b>.", "Copy the <b>Account SID</b> and <b>Auth Token</b> and paste them below."])}` : ""}${mainForm(c, "twilio", `
  <label class="f" for="twilioSid">Twilio Account SID${RAILWAY ? "" : ` <span class="tag">Optional</span>`}</label><input id="twilioSid" name="twilioSid" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="60" placeholder="AC..." value="${val(c, "twilioSid", c.s.twilio?.sid || c.s.phones?.twilioSid || "")}">
  ${secretIn("twilioToken", "Auth Token", secretHint(c.b.id, "twilio_token"), "Twilio Auth Token")}`)}</div>
${nav(c, `${mini(c, "twilio-skip", "Skip", "linkbtn")}${primary("Check and continue")}`)}`;
}

function recordTable(rows: DnsRecord[], manual: boolean) {
  return `<table class="records"><thead><tr><th>Type</th><th>Name</th><th>Value</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr>
<td data-l="Type"><b>${esc(r.type)}</b>${r.type === "MX" ? ` <span class="hint">priority ${r.priority ?? 10}</span>` : ""}</td>
<td data-l="Name"><code>${esc(r.name)}</code>${manual ? ` ${copy(r.name)}` : ""}</td>
<td data-l="Value" class="v"><code>${esc(r.value)}</code>${manual ? ` ${copy(r.value)}` : ""}</td>
<td>${r.ok ? `<span class="st f">${icon("check")} Found</span>` : `<span class="st w">Waiting</span>`}${manual && !r.ok && r.seen ? `<span class="hint seen">Found <code>${esc(r.seen)}</code> instead</span>` : ""}</td></tr>`).join("")}</tbody></table>`;
}

function email(c: Ctx) {
  const e = c.s.email;
  const zone = zoneOf(c.s);
  const manual = c.s.domain?.mode === "manual";
  if (e?.mode === "smtp") {
    const sm = e.smtp;
    return `${head(c, "Send email from your domain", "Use any email service that gives you SMTP details.")}
<div class="body">${mainForm(c, "smtp", `
  <div class="two"><div><label class="f" for="host">SMTP server</label><input id="host" name="host" required maxlength="200" autocapitalize="off" spellcheck="false" placeholder="smtp.example.com" value="${val(c, "host", sm?.host || "")}"></div>
  <div><label class="f" for="port">Port</label><input id="port" name="port" inputmode="numeric" maxlength="5" value="${val(c, "port", String(sm?.port || 587))}"></div></div>
  <div class="two"><div><label class="f" for="user">Username</label><input id="user" name="user" required maxlength="200" autocapitalize="off" spellcheck="false" value="${val(c, "user", sm?.user || "")}"></div>
  <div>${secretIn("pass", "Password", secretHint(c.b.id, "smtp_password"), "Password")}</div></div>
  <label class="f" for="address">Send from</label><input id="address" name="address" type="email" required maxlength="200" placeholder="hello@yourbusiness.com" value="${val(c, "address", e.address || (zone ? `hello@${zone}` : ""))}">`)}</div>
${nav(c, `${mini(c, "email-mode", "Use Resend instead", "linkbtn", "", `<input type="hidden" name="mode" value="resend">`)}${skipEmail(c)}${primary("Check and continue")}`)}`;
  }
  const rs = e?.resend;
  if (RAILWAY && !c.s.domain?.confirmed) {
    if (rs?.domainId && e?.checked) {
      return `${head(c, "Email is connected", `Emails will come from <b>${esc(e.from || "")}</b>.`)}
${notice("ok", `Resend is connected. We add its records for <b>${esc(e.sendingDomain || "")}</b> on the Domain step.`)}
${mainForm(c, "email-continue", `<input type="hidden" name="later" value="1">`)}
${nav(c, `${mini(c, "email-mode", "Use another key or address", "linkbtn", "", `<input type="hidden" name="mode" value="resend"><input type="hidden" name="reset" value="1">`)}${primary("Continue")}`)}`;
    }
    return `${head(c, "Send email from your own address (optional)", "Invites and notices go out through your own Resend account. Without it, invite links show on screen for you to copy and send yourself.")}
<div class="body">${mainForm(c, "email", `
  ${secretIn("key", "re_...", secretHint(c.b.id, "resend_key"), "Resend API key")}
  <p class="hint">Create it with <b>Full access</b>. Your agency only ever gets a send-only key. Resend sends from a domain you own, so adding email means adding your domain too.</p>
  <label class="f" for="address">Send from</label>
  <input id="address" name="address" type="email" required maxlength="200" placeholder="hello@mail.yourbusiness.com" value="${val(c, "address", e?.address || "")}">
  <p class="hint">A sub-domain like mail.yourbusiness.com keeps your main email separate.</p>
  ${showMeHow(["resend"])}`)}</div>
${nav(c, `${mini(c, "email-mode", "Use another email service", "linkbtn", "", `<input type="hidden" name="mode" value="smtp">`)}${skipEmail(c)}${primary("Check and continue")}`)}`;
  }
  if (rs?.domainId && e?.checked) {
    const rows = [...(rs.records || []), ...(rs.dmarc ? [rs.dmarc] : [])];
    const verified = rs.status === "verified";
    if (verified) {
      return `${head(c, "Email is ready", `Emails will come from <b>${esc(e.from || "")}</b>.`)}
${notice("ok", `Resend verified <b>${esc(e.sendingDomain || "")}</b>.${e.testSentTo ? ` We sent a test email to ${esc(e.testSentTo)}.` : ""}`)}
${mainForm(c, "email-continue", "")}
${nav(c, `${e.testSentTo ? "" : mini(c, "email-test", "Send a test email", "btn o")}${primary("Continue")}`)}`;
    }
    return `${head(c, manual ? "Add these records" : "Verifying your email domain", manual ? `Add each one where you manage DNS for <b>${esc(zone)}</b>. They tick off as they appear.` : "We added Resend's records to Cloudflare. Resend usually verifies them in a few minutes.")}
${manual ? recordTable(rows, true) + showMeHow(["registrar-dns-records"]) : ""}
<p class="status"><span class="spin"></span>Waiting for Resend to verify${rs.lastCheck ? ` · checked ${when(rs.lastCheck)}` : ""}</p>
${manual ? "" : `<details class="log"><summary>Show details</summary>${recordTable(rows, false)}</details>`}
${nav(c, `${mini(c, "email-continue", "Continue, finish later", "btn o", "", `<input type="hidden" name="later" value="1">`)}${mini(c, "email-recheck", `Check now ${icon("right")}`, "btn p")}`)}`;
  }
  return `${head(c, RAILWAY ? "Send email from your own address (optional)" : "Send email from your domain", "Invites and notices go out through your own Resend account.")}
<div class="body">${mainForm(c, "email", `
  ${secretIn("key", "re_...", secretHint(c.b.id, "resend_key"), "Resend API key")}
  <p class="hint">Create it with <b>Full access</b>.</p>
  <label class="f" for="address">Send from</label>
  <input id="address" name="address" type="email" maxlength="200" value="${val(c, "address", e?.address || `hello@mail.${zone}`)}">
  <p class="hint">A sub-domain like mail.${esc(zone)} keeps your main email separate.</p>
  ${showMeHow(["resend"])}`)}</div>
${nav(c, `${mini(c, "email-mode", "Use another email service", "linkbtn", "", `<input type="hidden" name="mode" value="smtp">`)}${skipEmail(c)}${primary("Check and continue")}`)}`;
}
/** Railway: email is optional. */
const skipEmail = (c: Ctx) => (RAILWAY ? mini(c, "email-skip", "Skip for now", "btn o") : "");

function calendars(c: Ctx) {
  const cal = c.s.calendars || {};
  const card = (p: "google" | "microsoft", title: string, ph: string) => {
    const saved = secretHint(c.b.id, p === "google" ? "google_secret" : "microsoft_secret");
    const r = oauthRedirect(c.s, p);
    return `<div class="cal"><b>${title}</b><p class="hint">Redirect URI: <code>${esc(r)}</code> ${copy(r)}</p>
  <input name="${p}Id" aria-label="${title} client ID" autocapitalize="off" spellcheck="false" maxlength="300" placeholder="${ph}" value="${val(c, `${p}Id`, cal[p]?.clientId || "")}">
  <input name="${p}Secret" type="password" aria-label="${title} client secret" autocomplete="off" maxlength="500" placeholder="${saved ? `Secret saved (${esc(saved)})` : "Client secret"}"></div>`;
  };
  // The shared Google / Microsoft sign-in is on (broker.ts): nothing to register, and no domain needed.
  const shared = brokerOn() && (offered().google.calendar || offered().microsoft.calendar);
  if (shared) {
    return `${head(c, "Calendar booking", "Let receptionists book into Google or Outlook calendars.")}
<div class="body">${notice("info", "Nothing to set up here. Connecting Google Calendar or Outlook is one click from your dashboard. Only fill in the keys below if you would rather use your own Google or Microsoft app.")}
${mainForm(c, "calendars", `<div class="choice">${card("google", "Google", "Client ID")}${card("microsoft", "Microsoft", "Application (client) ID")}</div>
  ${showMeHow(["google-oauth", "microsoft-oauth"])}`)}</div>
${nav(c, `${mini(c, "cal-skip", "Continue without my own keys")}${primary("Check and save my keys")}`)}`;
  }
  if (RAILWAY && !hostOf(c.s)) {
    return `${head(c, "Calendar booking (optional)", "Let receptionists book into Google or Outlook calendars.")}
${notice("info", "Calendar sign-in needs a web address of your own to send people back to. Add your domain first, or skip this and add calendars later in your dashboard's Settings.")}
${mainForm(c, "cal-skip", "")}
${nav(c, `<a class="btn o" href="${base(c)}?step=domain">Add my domain</a>${primary("Skip for now")}`)}`;
  }
  return `${head(c, "Calendar booking (optional)", "Let receptionists book into Google or Outlook calendars.")}
<div class="body">${mainForm(c, "calendars", `<div class="choice">${card("google", "Google", "Client ID")}${card("microsoft", "Microsoft", "Application (client) ID")}</div>
  ${showMeHow(["google-oauth", "microsoft-oauth"])}`)}</div>
${nav(c, `${mini(c, "cal-skip", "Skip for now")}${primary("Check and continue")}`)}`;
}

/** Voice, Railway: Telnyx, Vapi or Skip. One provider card at a time, each with a button straight to where its key is made. */
function phonesRailway(c: Ctx) {
  const s = c.s;
  const tel = !!s.phones?.confirmed && hasS(c, "telnyx_key");
  const vap = !!s.vapi?.confirmed && hasS(c, "vapi_key");
  if (tel || vap) {
    const nums = s.phones?.numbers || [];
    return `${head(c, "Voice", "", tel ? "telnyx" : "vapi")}
<div class="body">${tel ? okRow(`Telnyx connected${s.phones?.balance ? ` · ${esc(s.phones.balance)}` : ""}`) : ""}${vap ? okRow("Vapi connected") : ""}
${tel ? `<div class="nums"><h3>Your numbers</h3>${nums.length ? `<ul>${nums.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : `<p class="hint">No numbers on this account yet. Add them later.</p>`}</div>` : ""}
<p class="hint">${mini(c, "phones-reset", "Choose a different provider", "linkbtn")}</p></div>
${nav(c, mini(c, "phones-continue", `Continue ${icon("right")}`, "btn p"))}`;
  }
  const opt = c.opt === "telnyx" || c.opt === "vapi" ? c.opt : "";
  const optField = `<input type="hidden" name="opt" value="${opt}">`;
  const swap = `<p class="hint"><a href="${base(c)}?step=phones">Choose a different provider</a></p>`;
  if (opt === "telnyx") {
    return `${head(c, "Connect Telnyx", "Telnyx carries your calls.", "telnyx")}
<div class="body">${openBtn("telnyx", "https://portal.telnyx.com/#/app/api-keys", "Open Telnyx and create your key")}
${mini3(["Sign in. The account must be upgraded and have credit.", "Press <b>Create API Key</b>.", "Copy the key (it starts with <code>KEY</code>) and paste it below."])}
<form id="main" method="post" action="${base(c)}/a/phones">${hidden(c)}${optField}
  ${secretIn("key", "KEY...", secretHint(c.b.id, "telnyx_key"), "Telnyx API key")}
  ${showMeHow(["telnyx-account", "telnyx-api-key"])}</form>
${swap}</div>
${nav(c, primary("Check key"))}`;
  }
  if (opt === "vapi") {
    return `${head(c, "Connect Vapi", "Vapi runs your receptionists' voices.", "vapi")}
<div class="body">${openBtn("vapi", "https://dashboard.vapi.ai/org/api-keys", "Open Vapi and copy your two keys")}
${mini3(["Sign in to Vapi and add some credit.", "Copy the <b>Private</b> key and the <b>Public</b> key.", "Paste both below."])}
<form id="main" method="post" action="${base(c)}/a/phones-vapi">${hidden(c)}${optField}
  ${secretIn("vapiKey", "Private key", secretHint(c.b.id, "vapi_key"), "Vapi private key")}
  <label class="f" for="vapiPublic">Vapi public key</label><input id="vapiPublic" name="vapiPublic" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" placeholder="Public key" value="${esc(c.flash?.form?.vapiPublic ?? "")}">
  ${showMeHow(["vapi-account"])}</form>
${swap}</div>
${nav(c, primary("Check keys"))}`;
  }
  return `${head(c, "Voice", "Choose who carries your calls.")}
<div class="body"><div class="vchoice">
  <a class="vc telnyx" href="${base(c)}?step=phones&amp;opt=telnyx">${plogo("telnyx")}<span><b>Telnyx</b><small>Phone numbers and calls. Recommended.</small></span></a>
  <a class="vc vapi" href="${base(c)}?step=phones&amp;opt=vapi">${plogo("vapi")}<span><b>Vapi</b><small>Use your own Vapi account.</small></span></a>
  <form method="post" action="${base(c)}/a/phones-skip">${hidden(c)}<button class="vc skip" type="submit" data-skip-phones><span><b>Skip for now</b><small>Connect it later in your dashboard.</small></span></button></form>
</div>
${phoneSkipped(s) ? phoneLaterNote(c) : ""}</div>
${nav(c, "")}`;
}

// ---------------- AI (OpenRouter) ----------------
function aiStep(c: Ctx) {
  const hint = secretHint(c.b.id, "openrouter_key");
  const on = !!c.s.ai?.confirmed && hasS(c, "openrouter_key");
  const create = `${openBtn("openrouter", "https://openrouter.ai/settings/keys", "Open OpenRouter and create a key")}
${mini3(["Sign in and add a few dollars of credit.", "Press <b>Create Key</b>.", "Copy the key (it starts with <code>sk-or-</code>) and paste it below."])}`;
  const form = (id: string, button: string) => `<form id="${id}" method="post" action="${base(c)}/a/ai">${hidden(c)}
  ${secretIn("key", "sk-or-...", hint, "OpenRouter key")}
  ${showMeHow(["openrouter-key"])}${button}</form>`;
  const tip = `<p class="hint tip">Tip: switch on auto top-up at Railway, Telnyx and OpenRouter so calls never stop.</p>`;
  if (on) {
    return `${head(c, "AI", "", "openrouter")}
<div class="body">${okRow(`OpenRouter connected${hint ? ` · ${esc(hint)}` : ""}`)}
<details class="alt"${c.flash?.kind === "err" ? " open" : ""}><summary>Use a different key</summary>${oauthEnabled("openrouter") ? `<p><a class="btn o big oauth" data-oauth="openrouter" href="${base(c)}/oauth/openrouter">Sign in with OpenRouter again</a></p>` : ""}${create}${form("swap", `<p><button class="btn o" type="submit">Check key</button></p>`)}</details>
${tip}</div>
${nav(c, mini(c, "ai-continue", `Continue ${icon("right")}`, "btn p"))}`;
  }
  if (oauthEnabled("openrouter")) {
    return `${head(c, "Connect OpenRouter", "It powers your receptionists' thinking.", "openrouter")}
<div class="body"><p><a class="btn p big oauth prov" data-prov="openrouter" data-oauth="openrouter" href="${base(c)}/oauth/openrouter">${plogo("openrouter")}<span>Sign in with OpenRouter</span></a></p>
<details class="alt"${c.flash?.kind === "err" ? " open" : ""}><summary>Or paste a key</summary>${create}${form("main", `<p><button class="btn o" type="submit">Check key</button></p>`)}</details>
${tip}</div>
${nav(c, "")}`;
  }
  return `${head(c, "Connect OpenRouter", "It powers your receptionists' thinking.", "openrouter")}
<div class="body">${create}${form("main", "")}${tip}</div>
${nav(c, primary("Check and continue"))}`;
}

// ---------------- Connect more (optional) ----------------
/** What the buyer has added so far, for the Connect more screen and the Done screen. */
const extrasState = (s: SetupData) => ({
  email: !!s.email?.confirmed,
  domain: !!s.domain?.host && !!s.domain.confirmed,
  calendars: !!s.calendars?.google || !!s.calendars?.microsoft,
  vapi: !!s.vapi?.confirmed,
  twilio: !!s.twilio?.confirmed,
});

function extras(c: Ctx) {
  const have = extrasState(c.s);
  const card = (key: "email" | "domain" | "calendars" | "twilio", logo: string, title: string, text: string, step: StepId, skipAction: string) => {
    const added = have[key];
    return `<div class="xcard${added ? " added" : ""}" data-card="${key}"><div class="xh">${logo}<b>${title}</b></div><p>${text}</p>
  <div class="xa">${added ? `<span class="st f">${icon("check")} Added</span><a class="btn o" href="${base(c)}?step=${step}">Change</a>`
      : `<a class="btn o" href="${base(c)}?step=${step}">Add</a>${c.s.skipped?.[key] ? `<span class="st w">Skipped: add it later</span>` : mini(c, skipAction, "Skip", "linkbtn")}`}</div></div>`;
  };
  return `${head(c, "Connect more", `All optional. ${P(c)} works without them: skip any now and add them later in your dashboard.`)}
<div class="xcards">
${card("email", plogo("resend"), "Your own email", "Send invites and notices from your own address.", "email", "email-skip")}
${card("domain", plogo("domain"), "Your own web address", "Use app.yourbusiness.com instead of the Railway address.", "domain", "domain-skip")}
${card("calendars", `<span class="pl sm cal">${icon("calendar")}</span>`, "Calendars", "Let receptionists book into Google or Outlook calendars.", "calendars", "cal-skip")}
${card("twilio", plogo("twilio"), "Twilio", "Australian numbers and follow-up texts, on your own Twilio account.", "twilio", "twilio-skip")}
</div>
${mainForm(c, "extras-continue", "")}
${nav(c, primary(have.email || have.domain || have.calendars || have.twilio ? "Continue to install" : "Skip all and continue"))}`;
}

// ---------------- install ----------------
function stageOf(s: SetupData): number {
  if (s.phase === "creating" || s.phase === "create_failed") return s.ip ? 2 : s.dropletId ? 1 : 0;
  if (s.phase === "dns") return 2;
  if (s.phase === "starting") return 3;
  const n = Number((s.installStep || "").match(/^(\d+)\//)?.[1] || 0);
  if (s.phase === "installing" || s.phase === "failed") return n === 0 ? 3 : n <= 4 ? 4 : n <= 6 ? 5 : n <= 8 ? 6 : 7;
  return 8;
}

function install(c: Ctx) {
  if (RAILWAY) return installRailway(c);
  const s = c.s;
  const host = hostOf(s);
  if (s.phase === "idle") {
    const sv = s.server!;
    const region = sv.regions?.find((r) => r.slug === sv.region)?.name.replace(/ \d+$/, "") || sv.region;
    const rows: [string, string][] = [
      ["Brand", `${esc(s.brand?.productName || "")} · ${s.brand?.logo ? "logo added" : "no logo yet"}`], ["Dashboard", esc(host)], ["Server", `${esc(region)} · ${esc((sv.sizes?.find((z) => z.slug === sv.size)?.label.match(/(\d+) GB memory/) || [])[1] || "2")} GB · US$${sv.price}/mo`],
      ["Phones", phonesSummary(c)], ["Email from", esc(s.email?.from || "")],
      ["DNS", s.domain?.mode === "cloudflare" ? "Handled by the wizard" : s.domain?.mode === "godaddy" ? "Handled by the wizard (GoDaddy)" : "You add one record"],
    ];
    return `${head(c, "Ready to install", `We'll set up ${P(c)} on your new server. You can close the page while it runs.`)}
<div class="summary">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>
${mainForm(c, "install-start", "")}
${nav(c, primary("Install"))}`;
  }
  const manual = s.domain?.mode === "manual";
  const stages = ["Creating your server in DigitalOcean", "Starting your server", manual ? `Waiting for your DNS record for ${host}` : `Pointing ${host} at your server`,
    "Downloading the app", "Preparing the server", "Building the app (the longest step)", "Starting the database and the app", "Getting your security certificate"];
  const at = stageOf(s);
  const bad = s.phase === "failed" || s.phase === "create_failed";
  const list = `<ul class="stages">${stages.map((t, i) => {
    const cls = i < at ? "ok" : i === at ? (bad ? "bad" : "run") : "";
    const mark = cls === "ok" ? icon("check") : cls === "bad" ? icon("x") : "";
    const rec = i === 2 && at === 2 && manual && s.aRecord ? `<li class="inline-rec">${recordTable([s.aRecord], true)}</li>` : "";
    return `<li class="${cls}"><i>${mark}</i>${esc(t)}</li>${rec}`;
  }).join("")}</ul>`;
  const { text, next } = logRead(c.b.id);
  const log = `<details class="log"><summary>Show details</summary><pre id="log" data-next="${next}">${esc(text.slice(-60000))}</pre></details>`;
  const del = mini(c, "server-delete", "Delete the server", "linkbtn", ` data-confirm="Delete this server from your DigitalOcean account?"`);
  if (bad) {
    return `${head(c, s.phase === "failed" ? "The install stopped" : "We couldn't make your server", "")}
${notice("err", esc((s.error || "Something went wrong.").replace(/^./, (x) => x.toUpperCase())))}
${list}${log}
${nav(c, `${s.dropletId ? del : ""}${mini(c, s.phase === "failed" ? "install-retry" : "install-start", `Try again ${icon("right")}`, "btn p")}`, { back: false })}`;
  }
  const status = s.phase === "creating" ? "Usually a minute or two."
    : s.phase === "dns" ? (manual ? `Add the record above. It usually shows up within 15 minutes.` : "Usually a few seconds.")
    : s.phase === "starting" ? (s.lastSeenAt ? "Your server is collecting the app." : "Your server is finishing booting.")
    : `Step ${esc((s.installStep || "").replace(/^(\d+)\/(\d+) /, "$1 of $2: ") || "starting")}${s.attempt && s.attempt > 1 ? ` · attempt ${s.attempt}` : ""}`;
  const skip = s.phase === "dns" && (s.dnsChecks || 0) >= 3 ? mini(c, "dns-skip", "I've added it, install anyway", "btn o") : "";
  return `${head(c, `Setting up ${P(c)}`, "About 10 to 15 minutes. You can close this page; your link picks up where you left off.")}
${list}
<p class="status"><span class="spin"></span>${status}</p>
${log}
${nav(c, `${s.dropletId ? del : ""}${skip}`, { back: false })}`;
}

function railStage(s: SetupData): number {
  const rw = s.rw || {};
  if (s.phase === "creating" || s.phase === "create_failed") return !rw.projectId ? 0 : !rw.pgVolume ? 1 : !rw.deploymentId ? 2 : 3;
  if (s.phase === "deploying" || s.phase === "failed") return rw.deployStatus === "DEPLOYING" || rw.deployStatus === "CRASHED" ? 4 : 3;
  if (s.phase === "domain") return !s.domain?.host ? 5 : rw.records?.every((r) => r.ok) ? 6 : 5;
  return 7;
}

function installRailway(c: Ctx) {
  const s = c.s;
  const host = hostOf(s);
  const manual = s.domain?.mode === "manual";
  if (s.phase === "idle") {
    const rows: [string, string][] = [
      ["Address", host ? esc(host) : "Your Railway address (ready as soon as it's built)"], ["Hosting", `Railway${s.railway?.workspaceName ? ` · ${esc(s.railway.workspaceName)}` : ""} · from US$5/mo`],
      ["Voice", phonesSummary(c)], ["AI", secretHint(c.b.id, "openrouter_key") ? `OpenRouter ${esc(secretHint(c.b.id, "openrouter_key") || "")}` : "Add later"], ["Email", s.email?.from ? esc(s.email.from) : "Add later"],
      ...(host ? [["DNS", manual ? "You add two records" : "Handled by the wizard"] as [string, string]] : [["Own domain", "Add later"] as [string, string]]),
    ];
    return `${head(c, "Ready to install", `We'll set up ${P(c)} in your Railway account. You can close the page while it runs.`)}
<div class="summary">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>
${phoneSkipped(s) ? phoneLaterNote(c) : ""}
${mainForm(c, "install-start", "")}
${nav(c, primary("Install"))}`;
  }
  const rw = s.rw || {};
  const stages = ["Creating your project in Railway", "Adding your database", "Adding the app and your settings", "Building the app (the longest step)", "Starting the app",
    ...(host ? [manual ? `Waiting for your records for ${host}` : `Connecting ${host}`, "Getting your security certificate"] : ["Checking it answers"])];
  const at = railStage(s);
  const bad = s.phase === "failed" || s.phase === "create_failed";
  const list = `<ul class="stages">${stages.map((t, i) => {
    const cls = i < at ? "ok" : i === at ? (bad ? "bad" : "run") : "";
    return `<li class="${cls}"><i>${cls === "ok" ? icon("check") : cls === "bad" ? icon("x") : ""}</i>${esc(t)}</li>`;
  }).join("")}</ul>`;
  const recs = rw.records?.length && (manual || s.phase === "domain") && !bad
    ? `<div class="recbox"><b>${manual ? `Add these two records for ${esc(host)}` : `Records for ${esc(host)}`}</b>${manual ? `<p class="hint">Add them now, while the app builds.</p>` : ""}${recordTable(rw.records, manual)}</div>` : "";
  const { text, next } = logRead(c.b.id);
  const log = `<details class="log"><summary>Show details</summary><pre id="log" data-next="${next}">${esc(text.slice(-60000))}</pre></details>`;
  const del = rw.projectId ? mini(c, "server-delete", "Delete the project", "linkbtn", ` data-confirm="Delete this project (app and database) from your Railway account?"`) : "";
  if (bad) {
    return `${head(c, s.phase === "failed" ? "The install stopped" : "We couldn't set up Railway", "")}
${notice("err", esc((s.error || "Something went wrong.").replace("press Check again", "press Try again").replace(/^./, (x) => x.toUpperCase())))}
${list}${log}
${nav(c, `${del}${mini(c, s.phase === "failed" ? "install-retry" : "install-start", `Try again ${icon("right")}`, "btn p")}`, { back: false })}`;
  }
  if (isDemo(c.b) && s.phase === "domain") return doneRailway(c);
  if (s.phase === "domain" && !host) {
    return `${head(c, `${P(c)} is running`, "Checking it answers at its Railway address. A few seconds.")}
${list}
<p class="status"><span class="spin"></span>Almost there.</p>
${log}
${nav(c, del, { back: false })}`;
  }
  if (s.phase === "domain") {
    const temp = isDemo(c.b) ? `${base(c)}/open` : webUrl(rw.serviceDomain);
    return `${head(c, `${P(c)} is running`, `Use your temporary address now. ${esc(host)} starts working once its records are in.`)}
<div class="live"><div class="dot">● Running</div><a class="url" href="${esc(temp)}" target="_blank" rel="noopener noreferrer">${esc(temp)}</a><p class="hint">Your temporary address. It keeps working after ${esc(host)} is ready.</p></div>
${list}${recs}
<p class="status"><span class="spin"></span>${rw.records?.every((r) => r.ok) ? "Railway is getting your security certificate. Usually a few minutes." : manual ? "Waiting for your records. Usually within 15 minutes." : "Waiting for DNS. Usually a minute or two."}</p>
${log}
${mainForm(c, "install-finish", "")}
${nav(c, `${del}<button class="btn o" type="submit" form="main">Finish now</button>`, { back: false })}`;
  }
  const status = s.phase === "creating" ? "Setting up your Railway project. About a minute."
    : rw.deployStatus === "DEPLOYING" ? "Starting the app and its database." : "Railway is building the app. Usually 3 to 6 minutes.";
  return `${head(c, `Setting up ${P(c)}`, "About 10 minutes. You can close this page; your link picks up where you left off.")}
${list}${recs}
<p class="status"><span class="spin"></span>${status}${s.attempt && s.attempt > 1 ? ` · attempt ${s.attempt}` : ""}</p>
${log}
${nav(c, del, { back: false })}`;
}

function done(c: Ctx) {
  const s = c.s;
  if (RAILWAY) return doneRailway(c);
  const url = s.resultUrl || `https://${hostOf(s)}`;
  const { text, next } = logRead(c.b.id);
  return `${head(c, "Your agency is live", `${P(c)} is running on your own server. Everything here is yours.`)}
<div class="live"><div class="dot">● Live</div><a class="url" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>
<p class="hint"><b>First time in:</b> you'll see <b>Set up your agency</b>. Use <b>${esc(s.brand?.ownerEmail || "your owner email")}</b> and pick a password. Only that address can create the first account.</p></div>
<div class="checks"><b>Before you go</b>
  ${todo("do", `Delete your DigitalOcean token. <a href="https://cloud.digitalocean.com/account/api/tokens" target="_blank" rel="noopener noreferrer">Open DigitalOcean</a>`)}
  ${s.domain?.mode === "cloudflare" ? todo("cf", `Delete your Cloudflare token. <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer">Open Cloudflare</a>`) : ""}
  ${note(`Keep your ${s.email?.mode === "resend" ? "Resend key" : "email login"}: your server sends email with it.`)}
  ${note(s.sshKeyAdded ? `Log in to the server with your SSH key: <code>ssh root@${esc(s.ip || "")}</code>` : "Server login: DigitalOcean emailed you its root password, or use the droplet's Console.")}
</div>
${lockedOut(c)}
<details class="log"><summary>Show details</summary><pre id="log" data-next="${next}">${esc(text.slice(-60000))}</pre></details>
${nav(c, `<a class="btn p" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open your dashboard ${icon("ext")}</a>`, { back: false })}`;
}

/** Done screen: for owners with no email set up (or who simply forgot). Asks their agency for a one-time reset link; the answer comes back on screen only. */
function lockedOut(c: Ctx): string {
  return `<details class="lockedout"><summary>Locked out? Reset your owner password</summary>
<p class="hint">If you can't sign in and the reset email never arrives (email may not be set up), press the button. Your agency gives us a one-time link to choose a new password for the owner account (<b>${esc(c.s.brand?.ownerEmail || "your owner email")}</b>). It works once and runs out in 15 minutes. Nobody else's password can be reset this way, and your agency records it in its audit log.</p>
${mini(c, "owner-reset", `Reset your owner password ${icon("right")}`, "btn o", " data-owner-reset")}</details>`;
}

// ---------------- Update your agency (after Done) ----------------
const verText = (v: string) => (v ? `version ${esc(v)}` : "an earlier version");
const notesHtml = (notes: { version: string; lines: string[] }[]) =>
  notes.length ? `<div class="whatsnew"><b>What's new</b>${notes.map((n) => `<div class="nv"><span>${notes.length > 1 ? `Version ${esc(n.version)}` : ""}</span><ul>${n.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`).join("")}</div>` : "";

/** The small banner on the Done screen: which version they're on, and "Update now" when there's a newer one. */
function updateBanner(c: Ctx): string {
  const info = updateInfo(c.b, c.s);
  if (!info) return "";
  if (!info.available) return `<p class="hint verline">Your agency is on ${verText(info.installed)}, the latest.</p>`;
  return `<div class="notice info updatebar">${icon("rocket")}<div><b>Your agency is on ${verText(info.installed)}. Version ${esc(info.latest)} is available.</b>${notesHtml(info.notes)}
${mini(c, "update-open", `Update now ${icon("right")}`, "btn p")}</div></div>`;
}

/** The three update screens: paste a token, watch it run, or it stopped (nothing lost). */
function updateScreen(c: Ctx): string {
  const s = c.s, u = s.update!;
  const info = updateInfo(c.b, s);
  const from = u.from ?? info?.installed ?? "", to = u.to ?? info?.latest ?? "";
  if (u.phase === "ask") {
    const saved = secretHint(c.b.id, "railway_token");
    return `${head(c, "Update your agency", `${P(c)} goes from ${verText(from)} to version ${esc(to)}. Same Railway project, same database, same settings: only the app changes. About 5 minutes.`)}
<div class="body">${info ? notesHtml(info.notes) : ""}${mainForm(c, "update-start", `
  ${secretIn("token", "Paste your Railway token", saved, "Railway account token")}
  <p class="hint">The same kind of token as when you set up: make it under Account Settings, Tokens, with <b>No workspace</b>. We use it for this update only, then delete it.</p>
  ${showMeHow(["railway-token"])}`)}</div>
${nav(c, `${mini(c, "update-cancel", "Not now", "btn o")}${primary("Check and update")}`, { back: false })}`;
  }
  const rw = u;
  const stages = ["Finding your agency in Railway", "Adding any new settings", "Sending the new version to Railway", "Building the app (the longest step)", "Starting the app", "Checking it answers"];
  const at = !rw.appId ? 0 : !rw.varsSet ? 1 : !rw.deploymentId ? 2 : rw.deployStatus === "SUCCESS" ? 5 : rw.deployStatus === "DEPLOYING" ? 4 : 3;
  const bad = u.phase === "failed";
  const list = `<ul class="stages">${stages.map((t, i) => {
    const cls = i < at ? "ok" : i === at ? (bad ? "bad" : "run") : "";
    return `<li class="${cls}"><i>${cls === "ok" ? icon("check") : cls === "bad" ? icon("x") : ""}</i>${esc(t)}</li>`;
  }).join("")}</ul>`;
  const { text, next } = logRead(c.b.id);
  const log = `<details class="log"><summary>Show details</summary><pre id="log" data-next="${next}">${esc(text.slice(-60000))}</pre></details>`;
  if (bad) {
    return `${head(c, "The update stopped", "")}
${notice("err", esc((u.error || "Something went wrong.").replace(/^./, (x) => x.toUpperCase())))}
${notice("ok", `Nothing was lost. Your agency is still running ${verText(from)} with all your data, and keeps working while you try again.`)}
${list}${log}
${nav(c, `${mini(c, "update-cancel", "Not now", "btn o")}${mini(c, "update-retry", `Try again ${icon("right")}`, "btn p")}`, { back: false })}`;
  }
  const status = at <= 2 ? "Getting the update ready." : at === 3 ? "Railway is building the new version. Usually 3 to 6 minutes." : at === 4 ? "Starting the new version." : "Almost there.";
  return `${head(c, `Updating ${P(c)}`, `To version ${esc(to)}. Your agency keeps working while this runs. You can close this page; your link picks up where you left off.`)}
${list}
<p class="status"><span class="spin"></span>${status}${u.attempt && u.attempt > 1 ? ` · attempt ${u.attempt}` : ""}</p>
${log}
${nav(c, "", { back: false })}`;
}

/**
 * A "Before you go" to-do. It starts empty: we can't see whether they did it (deleting a token happens in another site), so a tick only
 * appears when the buyer presses it (wizard.js keeps it on this device). A note with nothing to do uses `note()` instead.
 */
const todo = (key: string, html: string) => `<div class="todo" data-todo="${key}"><button type="button" class="tick" role="checkbox" aria-checked="false" aria-label="Mark as done"></button><span>${html}</span></div>`;
const note = (html: string) => `<div>${icon("info")}<span>${html}</span></div>`;

/** The one to-do left on the Done screen: the DNS login (Cloudflare / GoDaddy) given for the domain. */
function dnsCheck(s: SetupData): string {
  const m = s.domain?.mode;
  if (m !== "cloudflare" && m !== "godaddy") return "";
  const [name, href] = m === "godaddy" ? ["GoDaddy API key", "https://developer.godaddy.com/keys"] : ["Cloudflare token", "https://dash.cloudflare.com/profile/api-tokens"];
  if (s.assist?.keepDns) return note(`Your provider kept the ${m === "godaddy" ? "GoDaddy" : "Cloudflare"} access you gave them, only for changes to your domain's records that you ask for. You can delete that ${name} any time. <a href="${href}" target="_blank" rel="noopener noreferrer">Open ${m === "godaddy" ? "GoDaddy" : "Cloudflare"}</a>`);
  return todo("dns", `Delete your ${name}. <a href="${href}" target="_blank" rel="noopener noreferrer">Open ${m === "godaddy" ? "GoDaddy" : "Cloudflare"}</a>`);
}

function doneRailway(c: Ctx) {
  if (c.s.update && c.s.update.phase !== "done") return updateScreen(c);
  if (isDemo(c.b)) {
    return `${head(c, "Your agency is live", `${P(c)} is ready. This test uses a temporary address instead of your own domain.`)}
<div class="live"><div class="dot">● Live</div><p class="hint">Next: create your password and your branded dashboard opens.</p></div>
${updateBanner(c)}
${nav(c, `<a class="btn p" href="${base(c)}/open">Open your dashboard ${icon("ext")}</a>`, { back: false })}`;
  }
  const s = c.s;
  const url = s.resultUrl || agencyUrl(s);
  const temp = s.tempUrl || "";
  const pending = !!s.domainPending;
  const shown = pending && temp ? temp : url;
  const { text, next } = logRead(c.b.id);
  return `${head(c, "Your agency is live", "")}
<div class="live"><div class="dot">● Live</div><a class="url" href="${esc(shown)}" target="_blank" rel="noopener noreferrer">${esc(shown)}</a>
${pending ? `<p class="hint">Your temporary address. <b>${esc(hostOf(s))}</b> starts working by itself once the records below are in.</p>` : ""}
<p class="hint">Sign up as <b>${esc(s.brand?.ownerEmail || "your owner email")}</b>. Only that address can.</p></div>
${updateBanner(c)}
${phoneSkipped(s) ? phoneLaterNote(c) : ""}
${dnsCheck(s) ? `<div class="checks">${dnsCheck(s)}</div>` : ""}
${pending && s.finishRecords?.length ? `<div class="recbox"><b>Records for ${esc(hostOf(s))}</b>${recordTable(s.finishRecords, true)}</div>` : ""}
${lockedOut(c)}
<details class="log"><summary>Show details</summary><pre id="log" data-next="${next}">${esc(text.slice(-60000))}</pre></details>
${nav(c, `<a class="btn p big" href="${esc(shown)}" target="_blank" rel="noopener noreferrer">Open your dashboard ${icon("ext")}</a>`, { back: false })}`;
}

const SCREENS: Record<StepId, (c: Ctx) => string> = { welcome, brand, railway: railwayStep, domain: domainStep, server, phones: RAILWAY ? phonesRailway : phones, ai: aiStep, email, calendars, extras, vapi, twilio, install, done };

export function statusRev(c: { b: Buyer; s: SetupData }): string {
  const s = c.s;
  const bits = [s.step, s.phase, (s.progress || []).length, s.installStep, s.error, s.aRecord?.ok, s.dnsChecks && s.dnsChecks >= 3, s.lastSeenAt ? 1 : 0, s.domain?.cf?.status, s.domain?.cf?.canEdit,
    s.email?.resend?.status, s.email?.testSentTo, ...(s.email?.resend?.records || []).map((r) => (r.ok ? 1 : 0)), s.email?.resend?.dmarc?.ok ? 1 : 0, s.attempt, s.dropletId ? 1 : 0, s.ip ? 1 : 0,
    s.rw?.projectId ? 1 : 0, s.rw?.pgVolume ? 1 : 0, s.update?.phase, s.update?.deployStatus, s.update?.appId ? 1 : 0, s.update?.varsSet ? 1 : 0, s.update?.deploymentId, s.rw?.deploymentId, s.rw?.deployStatus, s.rw?.certStatus, s.rw?.healthy ? 1 : 0, ...(s.rw?.records || []).map((r) => `${r.ok ? 1 : 0}${r.seen || ""}`), ...(s.email?.resend?.records || []).map((r) => r.seen || "")];
  return Bun.hash(JSON.stringify(bits)).toString(36);
}
const isLive = (c: Ctx) =>
  (c.view === "install" && ["creating", "dns", "starting", "installing", "deploying", "domain"].includes(c.s.phase)) ||
  (c.view === "done" && c.s.update?.phase === "running") ||
  (c.view === "domain" && RAILWAY && c.s.domain?.mode === "manual" && !!c.s.domain.host && c.s.email?.resend?.status !== "verified" && !!c.s.email?.resend?.records?.length) ||
  (c.view === "domain" && !!c.s.domain?.cf?.zoneId && !!c.s.domain.cf.status && c.s.domain.cf.status !== "active") ||
  (c.view === "email" && !!c.s.email?.resend?.domainId && c.s.email.resend.status !== "verified");

/** The steps shown in the rail: optional ones only while you're on them (they hang off the extras step). */
const railSteps = (view: StepId) => STEPS.filter((id) => !isOptional(id) || id === view);
function rail(c: Ctx) {
  return `<aside class="rail"><h2>Set up ${esc(c.s.brand?.productName || "your agency")}</h2><ol>${railSteps(c.view).map((id, i) => {
    const m = META[id];
    const isDone = stepDone(c.b, c.s, id) && id !== c.view && id !== "done";
    const can = canView(c.b, c.s, id) && id !== c.view && !(c.s.phase === "done" && id !== "done");
    const inner = `<b>${isDone ? icon("check") : i + 1}</b><span><span class="t">${m.title}</span></span>`;
    return `<li class="${id === c.view ? "on" : isDone ? "done" : ""}">${can ? `<a href="/setup/${esc(c.code)}?step=${id}">${inner}</a>` : `<span>${inner}</span>`}</li>`;
  }).join("")}</ol></aside>`;
}

/** Messages go just above the buttons, next to what they're about. */
const withFlash = (html: string, fl: string) => {
  if (!fl) return html;
  const at = html.lastIndexOf('<div class="nav">');
  return at < 0 ? fl + html : html.slice(0, at) + fl + html.slice(at);
};

/** A step our admin filled in for them: what was set, a way to change it, and on to what's left. */
function helped(c: Ctx): string {
  const id = c.view as AssistId;
  const next = firstOpen(c.b, c.s);
  const who = c.s.assist?.steps?.[id];
  const change = locked(c.s) ? "" : mini(c, "assist-release", "Change", "btn o", "", `<input type="hidden" name="step" value="${esc(id)}">`);
  return `${head(c, `${META[c.view].title}: set up by your provider`, "Your provider already did this step for you, so there's nothing to do here.")}
<div class="summary"><div><span>Set up</span><b>${esc(detailOf(c.b, c.s, id)) || "Done"}</b></div>${who ? `<div><span>When</span><b>${esc(who.at.slice(0, 10))}</b></div>` : ""}</div>
${notice("info", "Your keys for this step were checked and stored the same way yours would be.")}
${nav(c, `${change}<a class="btn p" href="${base(c)}?step=${next}">${next === "done" ? "See your agency" : "Continue"} ${icon("right")}</a>`)}`;
}

/** At the top of every step: what your provider did for you, and what's left. */
function assistNote(c: Ctx): string {
  if (!hasAssist(c.s)) return "";
  const rows = stepRows(c.b, c.s);
  const mine = rows.filter((r) => r.by === "you").map((r) => r.title);
  if (c.s.phase === "done") return notice("info", "Your provider helped set this up.");
  const left = rows.filter((r) => !r.optional && !r.done).map((r) => r.title);
  return notice("info", `<b>Your provider helped set this up.</b> Done for you: ${esc(mine.join(", "))}. ${left.length ? `Left for you: ${esc(left.join(", "))}.` : "Nothing is left for you: you can install now."}`);
}

// A step opened out of order on a test site may be missing what earlier steps fill in.
function screenOf(c: Ctx): string {
  try {
    if (c.s.phase !== "done" && c.s.phase === "idle" && helpedStep(c.s, c.view) && !c.flash?.form) return helped(c);
    return demoFill(c, SCREENS[c.view](c));
  } catch {
    return head(c, META[c.view].title, "This screen needs the earlier steps filled in first.") + nav(c, "");
  }
}

/**
 * The wizard page. It is generic: it never shows our name. The title and placeholders use "your agency" until the buyer
 * names their brand, and the /guide page it links to is generic too.
 */
export function wizardPage(b: Buyer, s: SetupData, code: string, sid: string, view: StepId, flash?: SetupData["flash"], opt = "") {
  return wizardHtml(b, s, code, sid, view, flash, opt);
}
/** The colour a step takes (its provider's): buttons, the active step in the list and the progress bar pick it up. Everything else stays white. */
const ACCENT: Partial<Record<StepId, string>> = { railway: "railway", ai: "openrouter", extras: "more", email: "resend", twilio: "twilio", domain: "domain", vapi: "vapi" };
function wizardHtml(b: Buyer, s: SetupData, code: string, sid: string, view: StepId, flash?: SetupData["flash"], opt = "") {
  const c: Ctx = { b, s, code, sid, view, flash, opt };
  const acc = view === "phones" ? (opt === "vapi" || (s.vapi?.confirmed && !s.phones?.confirmed) ? "vapi" : "telnyx") : ACCENT[view] || "";
  const live = isLive(c);
  const mainSteps = STEPS.filter((id) => !isOptional(id));
  const i = isOptional(view) ? mainSteps.indexOf(OPTIONAL_HUB) : mainSteps.indexOf(view);
  const lockNote = locked(s) && s.phase !== "done" && !["install", "done", "welcome"].includes(view)
    ? notice("info", `Your server is already built with these settings. <a href="/setup/${esc(code)}?step=install">Go to Install</a>`) : "";
  const fl = flash ? notice(flash.kind === "ok" ? "ok" : flash.kind === "err" ? "err" : "info", esc(flash.text)).replace('class="notice ', 'class="notice flash ') : "";
  // A one-time link (owner password reset): a big button, shown once and never stored.
  const flLink = flash?.link && /^https?:\/\/[^\s"'<>]+$/.test(flash.link)
    ? `<p class="resetlink"><a class="btn p big" href="${esc(flash.link)}" target="_blank" rel="noopener noreferrer" data-owner-reset-link>Set a new password ${icon("ext")}</a></p>` : "";
  const title = `${META[view].title} · Set up ${s.brand?.productName || NEUTRAL}`;
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/wizard.css">
<script src="/wizard.js" defer></script>
${chatHead()}
${live ? `<noscript><meta http-equiv="refresh" content="8"></noscript>` : ""}
</head>
<body>
<div class="ribbon" aria-hidden="true"></div>
<header class="top"><a class="mark" href="/setup/${esc(code)}">${markLogo(s.brand?.logo)}<span>${esc(s.brand?.productName || "Your agency")}</span></a>
<nav><a href="/guide" target="_blank" rel="noopener">Full guide</a><a href="#person">Talk to a person</a></nav></header>
<div class="shell wiz${acc ? ` acc-${acc}` : ""}" data-status="/setup/${esc(code)}/status" data-rev="${statusRev(c)}"${live ? ' data-live="1"' : ""}>
${rail(c)}
<main>
  <div class="phonebar"><div class="lab"><span>Step ${i + 1} of ${mainSteps.length}</span><b>${META[view].title}</b></div><progress class="bar" max="${mainSteps.length}" value="${i + 1}">${i + 1} of ${mainSteps.length}</progress></div>
  <section class="card step-${view}">${b.demo === 1 ? notice("info", "<b>Test run.</b> Every account here is pretend: press Continue on each step. Nothing real is connected.") : ""}${assistNote(c)}${lockNote}${(flLink ? fl + flLink + screenOf(c) : withFlash(screenOf(c), fl))}</section>
  ${personHelpHtml(b, s, code, hidden(c))}
  <p class="foot">${icon("shield")} Your keys are stored encrypted.</p>
</main>
</div>
${chatBubble({ url: `/setup/${code}/chat`, t: csrfToken(sid, code), view, person: personFormHtml(b, s, code, hidden(c), "chat") })}
</body>
</html>`;
}

/**
 * The page shell for the public onboarding link pages (genericlink.ts): the wizard's own look (same stylesheet, ribbon,
 * header and footer line). Generic: it shows nothing of ours.
 */
export function startShell(_style: Style, title: string, inner: string): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/wizard.css">
<script src="/wizard.js" defer></script>
</head>
<body>
<div class="ribbon" aria-hidden="true"></div>
<header class="top"><span class="mark">${markLogo()}<span>Your AI receptionist agency</span></span>
<nav>${CONFIG.supportEmail ? `<a href="mailto:${esc(CONFIG.supportEmail)}">Help</a>` : ""}</nav></header>
<div class="shell wiz admshell"><main>
  <section class="card">${inner}</section>
  <p class="foot">Your keys are stored encrypted.</p>
</main></div>
</body>
</html>`;
}
