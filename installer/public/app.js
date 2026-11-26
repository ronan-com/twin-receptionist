// Setup page. One step at a time; the server keeps the real progress, so a
// reload (or a restarted installer) comes back to the same place.
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const main = $("#main");
let S = null; // last state from the server
let shown = null; // step currently on screen
let pollTimer = null;

const TITLES = {
  brand: "Your brand",
  domain: "Web address",
  digitalocean: "DigitalOcean",
  telnyx: "Telnyx (phones)",
  email: "Email sender",
  calendar: "Calendars",
  server: "Create server",
  dns: "Point your domain",
  install: "Install",
  done: "Done",
};

async function api(path, data) {
  const opts = data === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Installer": "1" }, body: JSON.stringify(data) };
  try {
    const res = await fetch(path, opts);
    const j = await res.json();
    if (j.state) S = j.state;
    return j;
  } catch {
    return { ok: false, message: "Lost contact with the installer. Is it still running? Start it again and this page will pick up where you left off." };
  }
}

// ---------- small UI helpers ----------
function msg(el, kind, text) {
  if (!el) return;
  if (!text) { el.className = "msg"; el.innerHTML = ""; return; }
  const ic = { ok: "✓", err: "!", warn: "!", info: "i" }[kind] || "";
  el.className = "msg " + kind;
  el.innerHTML = `<span class="ic">${ic}</span><div>${text}</div>`;
}
async function busy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span>${esc(label)}`;
  try { return await fn(); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}
function secretInput(id, placeholder, hint) {
  return `<div class="secret"><input id="${id}" type="password" class="mono" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}" />
    <button type="button" class="btn ghost small reveal" data-reveal="${id}">Show</button></div>${hint ? `<small>${hint}</small>` : ""}`;
}
function howto(steps, link, linkLabel) {
  return `<div class="howto"><ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol>${link ? `<a class="open" href="${esc(link)}" target="_blank" rel="noopener">${esc(linkLabel)} <span aria-hidden="true">↗</span></a>` : ""}</div>`;
}
function copyable(text) {
  return `<div class="codebox"><code>${esc(text)}</code><button type="button" class="copy" data-copy="${esc(text)}">Copy</button></div>`;
}
function actions(inner) {
  return `<div class="actions">${inner}</div>`;
}
const backBtn = (step) => `<button type="button" class="btn ghost" data-goto="${step}">Back</button>`;
function confirmBox(title, text, yes) {
  const d = $("#confirm");
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  $("#confirm-yes").textContent = yes;
  d.showModal();
  return new Promise((r) => d.addEventListener("close", () => r(d.returnValue === "yes"), { once: true }));
}
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-reveal],[data-copy],[data-goto]");
  if (!t) return;
  if (t.dataset.reveal) {
    const inp = document.getElementById(t.dataset.reveal);
    inp.type = inp.type === "password" ? "text" : "password";
    t.textContent = inp.type === "password" ? "Show" : "Hide";
  } else if (t.dataset.copy) {
    try { await navigator.clipboard.writeText(t.dataset.copy); t.textContent = "Copied"; } catch { t.textContent = "Select and copy"; }
    setTimeout(() => (t.textContent = "Copy"), 1600);
  } else if (t.dataset.goto) {
    const r = await api("/api/goto", { step: t.dataset.goto });
    if (r.ok) render(true);
  }
});

// ---------- step list / progress ----------
const done = (id) => !!S.completed[id];
function renderNav() {
  const firstOpen = S.steps.findIndex((id) => !done(id));
  $("#steps").innerHTML = S.steps
    .map((id, i) => {
      const can = !S.finished && (done(id) || i <= firstOpen) && id !== S.step;
      const cls = [id === S.step ? "current" : "", done(id) && id !== S.step ? "done" : "", can ? "can" : ""].join(" ");
      return `<button type="button" class="${cls}" ${can ? `data-goto="${id}"` : "tabindex=-1"}><span class="dot">${done(id) && id !== S.step ? "✓" : i + 1}</span>${TITLES[id]}${id === "calendar" ? ' <span class="opt">optional</span>' : ""}</button>`;
    })
    .join("");
  const idx = S.steps.indexOf(S.step);
  $("#progress-bar").style.width = `${Math.round(((S.finished ? S.steps.length : idx) / S.steps.length) * 100)}%`;
  $("#brand-name").textContent = S.brand?.productName || "Receptionist";
  $("#mock-badge").hidden = !S.mock;
  document.title = `${S.brand?.productName || "Receptionist"} Setup`;
}
const stepLabel = () => `<div class="mobile-step">Step ${S.steps.indexOf(S.step) + 1} of ${S.steps.length} · ${TITLES[S.step]}</div>`;

// ---------- steps ----------
const STEPS = {};

STEPS.brand = {
  html: () => {
    const b = S.brand || {};
    return `${stepLabel()}<h1>Let's set up your AI receptionist</h1>
    <p class="lead">This takes about 20 minutes. We'll go one account at a time, check each one works, then build your own server. Your computer isn't needed once it's done.</p>
    <label class="field"><span>Product name</span><input id="productName" type="text" maxlength="60" placeholder="e.g. Acme Reception" value="${esc(b.productName || "")}" /><small>Your customers see this name on the app and in emails.</small></label>
    <label class="field"><span>Your email</span><input id="ownerEmail" type="email" autocomplete="email" placeholder="you@yourcompany.com" value="${esc(b.ownerEmail || "")}" /><small>You'll sign in with this to create the main admin account.</small></label>
    <div class="field"><span style="display:block;font-weight:600;font-size:14.5px;margin-bottom:8px">Phone numbers for agencies</span>
      <div class="choices">
        <label class="choice"><input type="radio" name="phone" value="shared" ${b.ownPhoneAccount ? "" : "checked"} /><div><b>Agencies use my Telnyx account</b><span>Simplest. You pay Telnyx for all calls and numbers, and bill agencies yourself.</span></div></label>
        <label class="choice"><input type="radio" name="phone" value="own" ${b.ownPhoneAccount ? "checked" : ""} /><div><b>Each agency brings its own Telnyx account</b><span>Agencies paste their own Telnyx key and pay Telnyx directly.</span></div></label>
      </div></div>
    <div class="msg" id="m"></div>
    ${actions(`<span class="grow"></span><button class="btn" id="go">Save and continue</button>`)}`;
  },
  mount: () => {
    $("#go").onclick = (e) =>
      busy(e.currentTarget, "Saving", async () => {
        const r = await api("/api/brand", { productName: $("#productName").value, ownerEmail: $("#ownerEmail").value, ownPhoneAccount: document.querySelector("input[name=phone]:checked").value === "own" });
        r.ok ? render(true) : msg($("#m"), "err", esc(r.message));
      });
  },
};

STEPS.domain = {
  html: () => `${stepLabel()}<h1>Choose your web address</h1>
    <p class="lead">This is where you and your agencies will sign in. Use a domain you already own.</p>
    ${howto([
      "Pick a name on a domain you own, like <b>reception.yourcompany.com</b> (using a sub-name keeps your main website untouched).",
      "Don't change anything yet. Once your server exists, we'll show you the one DNS record to add.",
    ])}
    <label class="field"><span>Web address</span><input id="domain" type="text" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="reception.yourcompany.com" value="${esc(S.domain)}" /></label>
    <div class="msg" id="m"></div>
    ${actions(`${backBtn("brand")}<span class="grow"></span><button class="btn" id="go">Save and continue</button>`)}`,
  mount: () => {
    $("#go").onclick = (e) =>
      busy(e.currentTarget, "Saving", async () => {
        const r = await api("/api/domain", { domain: $("#domain").value });
        r.ok ? render(true) : msg($("#m"), "err", esc(r.message));
      });
  },
};

function money(n) {
  return n == null ? "" : `US$${Number(n) % 1 ? Number(n).toFixed(2) : n}`;
}

STEPS.digitalocean = {
  html: () => {
    const d = S.digitalocean;
    const locked = !!S.server?.dropletId;
    return `${stepLabel()}<h1>Connect DigitalOcean</h1>
    <p class="lead">DigitalOcean rents you the server your receptionist runs on. It's billed to you monthly by DigitalOcean.</p>
    ${howto([
      "Sign up (or sign in) and add a payment method under <b>Billing</b>.",
      "Go to <b>API</b> in the left menu, then <b>Generate New Token</b>. Name it <b>setup</b>, choose <b>Full Access</b>, and set it to expire in 30 days.",
      "Copy the token (it's only shown once) and paste it below.",
    ], "https://cloud.digitalocean.com/account/api/tokens", "Open DigitalOcean")}
    <label class="field"><span>API token</span>${secretInput("token", d?.hasToken ? `Saved (${d.tokenHint}). Paste a new one to replace it.` : "dop_v1_…")}</label>
    <div class="row"><button class="btn secondary" id="check">Check token</button></div>
    <div class="msg" id="m"></div>
    <div id="choose"></div>
    ${locked ? `<div class="msg info"><span class="ic">i</span><div>Your server already exists, so its location and size are fixed.</div></div>` : ""}
    ${actions(`${backBtn("domain")}<span class="grow"></span><button class="btn" id="go" ${d?.hasToken ? "" : "disabled"}>Continue</button>`)}`;
  },
  mount: () => {
    const showChoices = () => {
      const o = S.doOptions;
      const d = S.digitalocean;
      if (!o || !d) return;
      const locked = !!S.server?.dropletId;
      const region = d.region;
      const sizes = o.sizes.filter((s) => !s.regions || s.regions.includes(region));
      $("#choose").innerHTML = `<h2>Where should your server live?</h2>
        <label class="field"><select id="region" ${locked ? "disabled" : ""}>${o.regions.map((r) => `<option value="${esc(r.slug)}" ${r.slug === region ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select><small>Pick the one closest to your callers. Sydney suits Australia and New Zealand.</small></label>
        <h2>Server size</h2>
        <div class="choices">${sizes.map((s) => `<label class="choice"><input type="radio" name="size" value="${esc(s.slug)}" ${s.slug === d.size ? "checked" : ""} ${locked ? "disabled" : ""} /><div><b>${esc(s.label)}</b><span>${s.slug === "s-2vcpu-4gb" ? "Recommended. Room for many agencies." : s.memoryGb < 4 ? "Works, but slower to install and update." : "For a lot of agencies and calls."}</span></div><span class="price">${money(s.priceMonthly)}/mo</span></label>`).join("")}</div>`;
      $("#region").onchange = () => { d.region = $("#region").value; showChoices(); };
      document.querySelectorAll("input[name=size]").forEach((i) => (i.onchange = () => (d.size = i.value)));
      $("#go").disabled = false;
    };
    const check = async (token) => {
      const r = await api("/api/digitalocean/check", { token });
      if (r.ok) { msg($("#m"), "ok", esc(r.message)); $("#token").value = ""; $("#token").placeholder = `Saved (${S.digitalocean.tokenHint}). Paste a new one to replace it.`; showChoices(); }
      else msg($("#m"), "err", esc(r.message));
      return r.ok;
    };
    $("#check").onclick = (e) => busy(e.currentTarget, "Checking", () => check($("#token").value));
    if (S.digitalocean?.hasToken) {
      if (S.doOptions) { msg($("#m"), "ok", `Connected to the DigitalOcean account ${esc(S.digitalocean.accountEmail)}.`); showChoices(); }
      else busy($("#check"), "Checking", () => check(""));
    }
    $("#go").onclick = (e) =>
      busy(e.currentTarget, "Saving", async () => {
        if (S.server?.dropletId) return void (await api("/api/goto", { step: "telnyx" }), render(true));
        const size = document.querySelector("input[name=size]:checked")?.value;
        const r = await api("/api/digitalocean/choose", { region: $("#region")?.value, size });
        r.ok ? render(true) : msg($("#m"), "err", esc(r.message));
      });
  },
};

STEPS.telnyx = {
  html: () => `${stepLabel()}<h1>Connect Telnyx for phone calls</h1>
    <p class="lead">Telnyx provides the phone numbers and carries the calls your receptionist answers.</p>
    ${howto([
      "Sign up (or sign in) to Telnyx.",
      "In the left menu open <b>Account Settings → Keys &amp; Credentials → API Keys</b>, then <b>Create API Key</b>.",
      "Copy the whole key (it starts with <b>KEY</b>) and paste it below.",
    ], "https://portal.telnyx.com/#/api-keys", "Open Telnyx")}
    <div class="msg warn" style="margin:0 0 18px"><span class="ic">!</span><div><p><b>New Telnyx accounts start as a trial.</b> Trial accounts can't take calls from the public. Before you go live, upgrade it in Telnyx: add a payment method and finish their identity check (<b>Account → Upgrade</b>).</p></div></div>
    <label class="field"><span>API key</span>${secretInput("key", S.telnyx ? `Saved (${S.telnyx.keyHint}). Paste a new one to replace it.` : "KEY…")}</label>
    <div class="row"><button class="btn secondary" id="check">Check key</button></div>
    <div class="msg" id="m"></div>
    ${actions(`${backBtn("digitalocean")}<span class="grow"></span><button class="btn" id="go" ${S.telnyx ? "" : "disabled"}>Continue</button>`)}`,
  mount: () => {
    if (S.telnyx) msg($("#m"), "ok", `Telnyx key saved. Available credit: ${esc(S.telnyx.balance)}.`);
    $("#check").onclick = (e) =>
      busy(e.currentTarget, "Checking", async () => {
        const r = await api("/api/telnyx/check", { apiKey: $("#key").value });
        if (r.ok) {
          msg($("#m"), "ok", esc(r.message) + (parseFloat(S.telnyx.balance) <= 0 ? "<br>Add some credit in Telnyx (Billing) before you buy numbers." : ""));
          $("#key").value = "";
          $("#go").disabled = false;
        } else msg($("#m"), "err", esc(r.message));
      });
    $("#go").onclick = (e) => busy(e.currentTarget, "Saving", async () => { const r = await api("/api/telnyx/next", {}); r.ok ? render(true) : msg($("#m"), "err", esc(r.message)); });
  },
};

const MAIL_PRESETS = {
  resend: { label: "Resend", host: "smtp.resend.com", port: 465, user: "resend", userHint: "Always <b>resend</b>.", passLabel: "API key", link: "https://resend.com/api-keys", how: ["Add and verify your domain under <b>Domains</b>.", "Create a key under <b>API Keys</b> (Sending access) and paste it as the password."] },
  postmark: { label: "Postmark", host: "smtp.postmarkapp.com", port: 587, user: "", userHint: "Your <b>Server API token</b> (the same value goes in both boxes).", passLabel: "Server API token", link: "https://account.postmarkapp.com/servers", how: ["Open your server, then <b>API Tokens</b>.", "Copy the Server API token into both the username and password boxes."] },
  sendgrid: { label: "SendGrid", host: "smtp.sendgrid.net", port: 587, user: "apikey", userHint: "Always <b>apikey</b>.", passLabel: "API key", link: "https://app.sendgrid.com/settings/api_keys", how: ["Verify your sender under <b>Settings → Sender Authentication</b>.", "Create an API key under <b>Settings → API Keys</b> and paste it as the password."] },
  gmail: { label: "Gmail / Google Workspace", host: "smtp.gmail.com", port: 587, user: "", userHint: "Your full Gmail or Workspace address.", passLabel: "App password", link: "https://myaccount.google.com/apppasswords", how: ["Turn on 2-Step Verification for the account.", "Create an <b>App password</b> and paste it as the password (not your normal password)."] },
  m365: { label: "Microsoft 365", host: "smtp.office365.com", port: 587, user: "", userHint: "Your full Microsoft 365 address.", passLabel: "Password", link: "https://admin.microsoft.com/", how: ["Your admin must allow <b>Authenticated SMTP</b> for this mailbox (Admin center → Users → Mail).", "Use the mailbox address and its password (or an app password)."] },
  other: { label: "Other", host: "", port: 587, user: "", userHint: "From your email provider's SMTP settings.", passLabel: "Password", link: "", how: ["Find your provider's <b>SMTP</b> settings: server name, port, username and password."] },
};

STEPS.email = {
  html: () => {
    const e = S.email;
    return `${stepLabel()}<h1>Set up the email sender</h1>
    <p class="lead">Your receptionist sends sign-in links, invites and call notices from this address.</p>
    <div class="chips" id="chips">${Object.entries(MAIL_PRESETS).map(([k, p]) => `<button type="button" class="chip" data-preset="${k}">${esc(p.label)}</button>`).join("")}</div>
    <div id="how"></div>
    <div class="grid-port">
      <label class="field"><span>SMTP server</span><input id="host" type="text" autocapitalize="off" spellcheck="false" placeholder="smtp.example.com" value="${esc(e?.smtp?.host || "")}" /></label>
      <label class="field"><span>Port</span><input id="port" type="number" inputmode="numeric" value="${esc(e?.smtp?.port || 587)}" /></label>
    </div>
    <div class="grid2">
      <label class="field"><span>Username</span><input id="user" type="text" autocapitalize="off" spellcheck="false" value="${esc(e?.smtp?.user || "")}" /><small id="userHint"></small></label>
      <label class="field"><span id="passLabel">Password</span>${secretInput("pass", e ? "Saved. Type again to change it." : "")}</label>
    </div>
    <label class="field"><span>Send emails from</span><input id="from" type="text" placeholder="Acme Reception &lt;hello@yourcompany.com&gt;" value="${esc(e?.mailFrom || (S.brand ? `${S.brand.productName} <hello@${(S.domain || "yourcompany.com").split(".").slice(-2).join(".")}>` : ""))}" /><small>Must be an address your email provider lets you send from.</small></label>
    <div class="row"><button class="btn secondary" id="check">Check email sender</button><button class="btn link" id="test" ${e ? "" : "hidden"}>Send a test email to ${esc(S.brand?.ownerEmail)}</button></div>
    <div class="msg" id="m"></div>
    ${actions(`${backBtn("telnyx")}<span class="grow"></span><button class="btn" id="go" ${e ? "" : "disabled"}>Continue</button>`)}`;
  },
  mount: () => {
    const pick = (k) => {
      const p = MAIL_PRESETS[k];
      document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.preset === k));
      $("#how").innerHTML = howto(p.how, p.link, p.link ? `Open ${p.label}` : "");
      if (p.host) $("#host").value = p.host;
      $("#port").value = p.port;
      if (p.user || !$("#user").value) $("#user").value = p.user;
      $("#userHint").innerHTML = p.userHint;
      $("#passLabel").textContent = p.passLabel;
    };
    document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => pick(c.dataset.preset)));
    const known = Object.entries(MAIL_PRESETS).find(([, p]) => p.host && p.host === S.email?.smtp?.host);
    if (known) pick(known[0]);
    else if (S.email) pick("other");
    else pick("resend");
    if (S.email) msg($("#m"), "ok", `Email sender saved (${esc(S.email.smtp?.host)}).${S.email.testSentTo ? ` Test email sent to ${esc(S.email.testSentTo)}.` : ""}`);
    const buildUrl = () => {
      const host = $("#host").value.trim();
      const port = parseInt($("#port").value, 10) || 587;
      const user = $("#user").value.trim();
      const pass = $("#pass").value;
      if (!host) return { err: "Enter the SMTP server name." };
      if (!user) return { err: "Enter the username." };
      if (!pass) return S.email && host === S.email.smtp?.host && user === S.email.smtp?.user && String(port) === String(S.email.smtp?.port || port) ? { url: "" } : { err: "Enter the password." };
      const proto = port === 465 ? "smtps" : "smtp";
      return { url: `${proto}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}` };
    };
    $("#check").onclick = (e) =>
      busy(e.currentTarget, "Connecting", async () => {
        const u = buildUrl();
        if (u.err) return msg($("#m"), "err", esc(u.err));
        const r = await api("/api/email/check", { smtpUrl: u.url, mailFrom: $("#from").value });
        if (r.ok) { msg($("#m"), "ok", esc(r.message) + " You can send yourself a test email to be sure."); $("#test").hidden = false; $("#go").disabled = false; }
        else msg($("#m"), "err", esc(r.message));
      });
    $("#test").onclick = (e) =>
      busy(e.currentTarget, "Sending", async () => {
        const r = await api("/api/email/test", {});
        msg($("#m"), r.ok ? "ok" : "err", esc(r.message));
      });
    $("#go").onclick = (e) => busy(e.currentTarget, "Saving", async () => { const r = await api("/api/email/next", {}); r.ok ? render(true) : msg($("#m"), "err", esc(r.message)); });
  },
};

const CAL = {
  google: {
    name: "Google Calendar",
    link: "https://console.cloud.google.com/apis/credentials",
    how: (uri) => [
      "In Google Cloud, pick or create a project, then enable the <b>Google Calendar API</b> (APIs &amp; Services → Library).",
      "Go to <b>APIs &amp; Services → Credentials → Create credentials → OAuth client ID</b>, type <b>Web application</b>.",
      `Under <b>Authorized redirect URIs</b> add the address below, save, then copy the Client ID and Client secret.${copyable(uri)}`,
    ],
    idLabel: "Client ID", idPh: "…apps.googleusercontent.com", secretLabel: "Client secret",
  },
  microsoft: {
    name: "Microsoft Outlook / 365",
    link: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    how: (uri) => [
      "In Microsoft Entra open <b>App registrations → New registration</b>. For account types choose <b>any organization and personal Microsoft accounts</b>.",
      `Set the redirect URI type to <b>Web</b> with the address below, then register.${copyable(uri)}`,
      "Copy the <b>Application (client) ID</b>. Then under <b>Certificates &amp; secrets → New client secret</b>, copy the secret's <b>Value</b>.",
    ],
    idLabel: "Application (client) ID", idPh: "1234abcd-12ab-…", secretLabel: "Client secret value",
  },
};

STEPS.calendar = {
  html: () => `${stepLabel()}<h1>Calendar booking <span class="muted" style="font-size:16px">(optional)</span></h1>
    <p class="lead">Let agencies connect Google or Outlook calendars so your receptionist can book appointments. You can skip this and add it later.</p>
    ${["google", "microsoft"].map((p) => {
      const c = CAL[p];
      const saved = S.calendar[p];
      const uri = S.calendar[p + "Redirect"];
      return `<details class="cal" id="cal-${p}" ${saved ? "" : ""}><summary>${esc(c.name)}<span class="state ${saved ? "ok" : ""}">${saved ? "✓ Connected" : "Not set up"}</span></summary><div class="body">
        ${howto(c.how(uri), c.link, p === "google" ? "Open Google Cloud" : "Open Microsoft Entra")}
        <label class="field"><span>${c.idLabel}</span><input id="${p}-id" type="text" class="mono" autocapitalize="off" spellcheck="false" placeholder="${esc(c.idPh)}" value="${esc(saved?.clientId || "")}" /></label>
        <label class="field"><span>${c.secretLabel}</span>${secretInput(p + "-secret", saved ? "Saved. Paste again to change it." : "")}</label>
        <div class="row"><button class="btn secondary" data-check="${p}">Check keys</button>${saved ? `<button class="btn link" data-remove="${p}">Remove</button>` : ""}</div>
        <div class="msg" id="m-${p}"></div></div></details>`;
    }).join("")}
    ${actions(`${backBtn("email")}<span class="grow"></span><button class="btn" id="go">${S.calendar.google || S.calendar.microsoft ? "Continue" : "Skip for now"}</button>`)}`,
  mount: () => {
    document.querySelectorAll("[data-check]").forEach((b) =>
      (b.onclick = (e) =>
        busy(e.currentTarget, "Checking", async () => {
          const p = b.dataset.check;
          const r = await api("/api/calendar/check", { provider: p, clientId: $(`#${p}-id`).value, clientSecret: $(`#${p}-secret`).value });
          if (r.ok) {
            const open = ["google", "microsoft"].filter((x) => $(`#cal-${x}`).open);
            render(true);
            open.forEach((x) => ($(`#cal-${x}`).open = true));
            msg($(`#m-${p}`), "ok", esc(r.message));
          }
          else msg($(`#m-${p}`), "err", esc(r.message));
        })));
    document.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = async () => { await api("/api/calendar/remove", { provider: b.dataset.remove }); render(true); }));
    $("#go").onclick = (e) => busy(e.currentTarget, "Saving", async () => { const r = await api("/api/calendar/next", {}); if (r.ok) render(true); });
  },
};

function regionName() {
  const r = S.doOptions?.regions?.find((x) => x.slug === S.digitalocean?.region);
  return r ? r.name : S.digitalocean?.region;
}

STEPS.server = {
  html: () => {
    const d = S.digitalocean;
    const sv = S.server;
    const creating = sv?.phase === "creating";
    return `${stepLabel()}<h1>Create your server</h1>
    <p class="lead">We'll rent a server in your DigitalOcean account and get it ready. This takes 1 to 3 minutes.</p>
    <dl class="facts">
      <dt>Account</dt><dd>${esc(d?.accountEmail || "")}</dd>
      <dt>Location</dt><dd>${esc(regionName())}</dd>
      <dt>Size</dt><dd>${esc(d?.size)}${d?.priceMonthly ? ` · ${money(d.priceMonthly)} a month, billed by DigitalOcean` : ""}</dd>
      <dt>Address</dt><dd>${esc(S.domain)}</dd>
    </dl>
    <ul class="plist" id="plist"></ul>
    <div class="msg" id="m"></div>
    ${actions(`${backBtn("calendar")}<span class="grow"></span><span id="srv-actions"></span>`)}`;
  },
  mount: () => STEPS.server.update(),
  update: () => {
    const sv = S.server;
    const creating = sv?.phase === "creating";
    const items = sv?.progress || [];
    $("#plist").innerHTML = items.map((p, i) => (i === items.length - 1 && creating ? `<li class="now"><span class="spin"></span>${esc(p)}…</li>` : `<li><span class="tick">✓</span>${esc(p)}</li>`)).join("");
    if (sv?.phase === "failed") msg($("#m"), "err", `<p>${esc(sv.error)}</p>`);
    else msg($("#m"));
    const a = $("#srv-actions");
    if (creating) a.innerHTML = `<button class="btn" disabled><span class="spin"></span>Creating…</button>`;
    else if (sv?.phase === "failed")
      a.innerHTML = `${sv.dropletId ? `<button class="btn danger-outline" id="del">Delete the server</button>` : ""} <button class="btn" id="create">Try again</button>`;
    else a.innerHTML = `<button class="btn" id="create">Create my server</button>`;
    const c = $("#create");
    if (c) c.onclick = (e) => busy(e.currentTarget, "Starting", async () => { const r = await api("/api/server/create", {}); if (!r.ok) msg($("#m"), "err", esc(r.message)); else { STEPS.server.update(); poll(); } });
    const del = $("#del");
    if (del) del.onclick = () => deleteServerFlow($("#m"));
    if (creating) poll();
  },
};

async function deleteServerFlow(m) {
  if (!(await confirmBox("Delete the server?", "This removes the server from your DigitalOcean account so you stop paying for it. You can create a new one afterwards.", "Delete it"))) return;
  msg(m, "info", `<span class="spin"></span> Deleting the server…`);
  const r = await api("/api/server/delete", {});
  if (r.ok) { render(true); msg($("#m"), "ok", esc(r.message)); }
  else msg(m, "err", esc(r.message));
}

STEPS.dns = {
  html: () => {
    const rec = S.dns?.record;
    const zone = rec?.zone || S.domain;
    return `${stepLabel()}<h1>Point ${esc(S.domain)} at your server</h1>
    <p class="lead">Your server is ready at <b>${esc(S.server?.ip)}</b>. Add one DNS record so your web address finds it.</p>
    ${howto([
      `Sign in where you bought <b>${esc(zone)}</b> (GoDaddy, Namecheap, Cloudflare, Crazy Domains…) and open its <b>DNS</b> settings.`,
      "Add a new record with exactly these values (if a record with the same name exists, change it instead):",
    ])}
    <table class="record"><thead><tr><th>Type</th><th>Name / Host</th><th>Value / Points to</th><th>TTL</th></tr></thead>
      <tbody><tr><td data-label="Type">A</td><td data-label="Name">${esc(rec?.name)}<button class="copy" data-copy="${esc(rec?.name)}">Copy</button></td><td data-label="Value">${esc(rec?.value)}<button class="copy" data-copy="${esc(rec?.value)}">Copy</button></td><td data-label="TTL">Default</td></tr></tbody></table>
    <p class="hint" style="margin:-4px 0 16px">${rec?.name === "@" ? "“@” means the domain itself." : `Some providers want the full name, <b>${esc(S.domain)}</b>, instead of just <b>${esc(rec?.name)}</b>.`} On Cloudflare, set the cloud icon to grey (DNS only).</p>
    <div class="msg" id="m"></div>
    ${actions(`<button class="btn ghost" id="anyway">Install anyway</button><span class="grow"></span><button class="btn" id="go" disabled>Install now</button>`)}`;
  },
  mount: () => {
    $("#go").onclick = $("#anyway").onclick = async (e) => {
      if (e.currentTarget.id === "anyway" && !(await confirmBox("Install before the address works?", "The install will run, but its last step (the security certificate) needs the address working. If it isn't yet, the install will stop and you can press Try install again later.", "Install anyway"))) return;
      const r = await api("/api/install/start", {});
      r.ok ? render(true) : msg($("#m"), "err", esc(r.message));
    };
    STEPS.dns.update();
    dnsCheck();
  },
  update: () => {
    const d = S.dns;
    if (!$("#go")) return;
    if (d?.ok) {
      msg($("#m"), "ok", `<b>${esc(S.domain)}</b> now points at your server. You're ready to install.`);
      $("#go").disabled = false;
    } else if (d?.seen?.length) {
      msg($("#m"), "warn", `<span class="spin"></span>&nbsp;${esc(S.domain)} points at ${esc(d.seen.join(", "))}, not ${esc(S.server.ip)} yet. If you just changed it, give it a few minutes. Checking again… (${d.checks})`);
    } else {
      msg($("#m"), "info", `<span class="spin"></span>&nbsp;Waiting for ${esc(S.domain)} to point at your server. This usually takes 1 to 15 minutes after you save the record. Checking… ${d?.checks ? `(${d.checks})` : ""}`);
    }
  },
};
let dnsTimer = null;
async function dnsCheck() {
  clearTimeout(dnsTimer);
  if (S.step !== "dns" || S.dns?.ok) return;
  await api("/api/dns/check", {});
  if (S.step !== "dns") return;
  STEPS.dns.update();
  renderNav();
  if (!S.dns?.ok) dnsTimer = setTimeout(dnsCheck, S.mock ? 2000 : 10000);
}

let logFrom = 0;
STEPS.install = {
  html: () => `${stepLabel()}<h1>Installing your receptionist</h1>
    <p class="lead">This takes 5 to 15 minutes. It runs on your server, so you can close this page and come back; it keeps going.</p>
    <div class="istatus" id="istatus"></div>
    <div class="ibar" id="ibar"><div></div></div>
    <div class="msg" id="m"></div>
    <details class="more" id="more" open><summary>Show details</summary><div class="term" id="term"></div></details>
    ${actions(`<span class="grow"></span><span id="i-actions"></span>`)}`,
  mount: () => {
    logFrom = 0;
    $("#term").textContent = "";
    STEPS.install.update();
    pullLog();
  },
  update: () => {
    const i = S.install;
    const text = $("#term").textContent;
    const steps = [...text.matchAll(/==> \[(\d+)\/(\d+)\] (.*)/g)];
    const last = steps[steps.length - 1];
    let pct = last ? Math.round(((+last[1] - 0.5) / +last[2]) * 100) : text ? 4 : 2;
    const bar = $("#ibar");
    bar.className = "ibar";
    if (i?.phase === "ok") { pct = 100; bar.className = "ibar ok"; }
    if (i?.phase === "failed") bar.className = "ibar err";
    bar.firstElementChild.style.width = pct + "%";
    const running = i?.phase === "running";
    $("#istatus").innerHTML = running ? `<span class="spin"></span>${esc(last ? last[3] : "Getting started")}…` : i?.phase === "ok" ? "✓ Installed" : i?.phase === "failed" ? "The install stopped" : "";
    if (i?.phase === "failed") {
      msg($("#m"), "err", `<p><b>It stopped because:</b> ${esc(i.error)}</p><p>Fix that if it's something on your side (like the DNS record), then try again. Trying again is safe and reuses the same server.</p>`);
      $("#i-actions").innerHTML = `<button class="btn danger-outline" id="del">Delete the server</button> <button class="btn" id="retry">Try install again</button>`;
      $("#retry").onclick = (e) => busy(e.currentTarget, "Starting", async () => { const r = await api("/api/install/start", {}); if (r.ok) { render(true); } else msg($("#m"), "err", esc(r.message)); });
      $("#del").onclick = () => deleteServerFlow($("#m"));
    } else {
      msg($("#m"));
      $("#i-actions").innerHTML = i?.phase === "ok" ? `<button class="btn" data-goto="done">Continue</button>` : "";
    }
  },
};
let logTimer = null;
async function pullLog() {
  clearTimeout(logTimer);
  if (S.step !== "install") return;
  let r;
  try { r = await (await fetch(`/api/install/log?from=${logFrom}`)).json(); } catch { logTimer = setTimeout(pullLog, 3000); return; }
  S = r.state;
  const term = $("#term");
  if (!term) return;
  if (r.next < logFrom) { term.textContent = ""; logFrom = 0; } // log restarted (retry / reconnect)
  if (r.text) {
    const atBottom = term.scrollHeight - term.scrollTop - term.clientHeight < 40;
    term.textContent += r.text;
    if (atBottom) term.scrollTop = term.scrollHeight;
  }
  logFrom = r.next;
  if (S.step === "done") return render(true);
  STEPS.install.update();
  renderNav();
  if (S.install?.phase === "running") logTimer = setTimeout(pullLog, 1000);
}

STEPS.done = {
  html: () => {
    const url = S.install?.url || `https://${S.domain}`;
    return `<div class="done-hero"><div class="big">✓</div><h1>${esc(S.brand?.productName || "Your receptionist")} is live</h1>
      <p class="lead" style="margin-bottom:10px">Your server is running on its own now. You don't need this computer for it any more.</p>
      <a class="live-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https:\/\//, ""))}</a></div>
      <div class="todo"><span class="num">1</span><div><b>Create your admin account</b><p>Open your link and sign in with <b>${esc(S.brand?.ownerEmail)}</b>. That makes you the main admin; then you can invite agencies.</p><a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">Open ${esc(S.brand?.productName || "it")}</a></div></div>
      <div class="todo urgent"><span class="num">2</span><div><b>Delete the DigitalOcean token now</b><p>The token you pasted can create and delete servers in your account, and it isn't needed any more. In DigitalOcean go to <b>API → Tokens</b>, find <b>setup</b>, and choose <b>Delete</b>. <span id="tokmsg"></span></p><a class="btn small secondary" href="https://cloud.digitalocean.com/account/api/tokens" target="_blank" rel="noopener">Open DigitalOcean tokens ↗</a></div></div>
      <div class="todo"><span class="num">3</span><div><b>Keep your server key somewhere safe</b><p>This key lets you (or a technician) sign in to the server for repairs. Save it in a password manager. Don't share it.</p>${S.hasKey ? `<a class="btn small secondary" href="/api/ssh-key" download>Download server key</a>` : `<span class="hint">Erased from this computer.</span>`}</div></div>
      ${S.telnyx ? `<div class="todo"><span class="num">4</span><div><b>Upgrade Telnyx if it's still a trial</b><p>Real callers can't get through to a trial Telnyx account. Add a payment method and finish verification in Telnyx.</p><a class="btn small secondary" href="https://portal.telnyx.com/" target="_blank" rel="noopener">Open Telnyx ↗</a></div></div>` : ""}
      <details class="more"><summary>Server details</summary><dl class="facts" style="margin-top:12px"><dt>Server IP</dt><dd>${esc(S.server?.ip)}</dd><dt>Sign in</dt><dd><code>ssh -i &lt;key file&gt; root@${esc(S.server?.ip)}</code></dd><dt>App folder</dt><dd>/opt/receptionist</dd></dl></details>
      ${actions(`<button class="btn danger-outline small" id="erase">Erase everything this installer saved</button><span class="grow"></span><span class="hint">You can close this window and stop the installer.</span>`)}
      <div class="msg" id="m"></div>`;
  },
  mount: async () => {
    if (!S.finished) await api("/api/finish", {});
    $("#tokmsg").textContent = S.digitalocean?.tokenRemoved ? "(This installer has already deleted its own copy.)" : "";
    renderNav();
    $("#erase").onclick = async () => {
      if (!(await confirmBox("Erase installer data?", "This deletes your saved settings and the server key from this computer. Download the server key first if you want to keep it. Your live server is not affected.", "Erase"))) return;
      const r = await api("/api/erase", {});
      if (r.ok) {
        main.innerHTML = `<div class="done-hero"><div class="big">✓</div><h1>All erased</h1><p class="lead">Nothing from this setup is left on this computer. Your receptionist keeps running on its server. You can close this window.</p></div>`;
        $("#steps").innerHTML = "";
      } else msg($("#m"), "err", esc(r.message));
    };
  },
};

// ---------- render loop ----------
function render(force) {
  if (!S) return;
  renderNav();
  if (force || shown !== S.step) {
    shown = S.step;
    clearTimeout(pollTimer);
    clearTimeout(dnsTimer);
    clearTimeout(logTimer);
    main.innerHTML = STEPS[S.step].html();
    STEPS[S.step].mount?.();
    if (!force) main.scrollIntoView?.({ block: "start" });
    window.scrollTo({ top: 0 });
  }
}
function poll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    const before = S.step;
    await api("/api/state");
    if (S.step !== before) return render(true);
    renderNav();
    STEPS[S.step].update?.();
  }, 1200);
}

(async () => {
  const r = await api("/api/state");
  if (!S) { main.innerHTML = `<div class="msg err"><span class="ic">!</span><div>${esc(r.message)}</div></div>`; return; }
  render(true);
})();
