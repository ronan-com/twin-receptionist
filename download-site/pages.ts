// HTML for the public pages (/, /guide, errors) and the shared layout. The wizard's
// screens are in wizard.ts. The only script is /wizard.js, on wizard pages only.
import { CONFIG, RAILWAY } from "./lib";
import { allHowTos, howTo } from "./content";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const P = () => esc(CONFIG.productName);
const S = () => esc(CONFIG.sellerName);
const support = () =>
  CONFIG.supportEmail ? `<a href="mailto:${esc(CONFIG.supportEmail)}">${esc(CONFIG.supportEmail)}</a>` : `${S()} (reply to your purchase email)`;

export function layout(title: string, body: string, opts: { active?: "home" | "guide"; wizard?: boolean; refresh?: number } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
${opts.wizard ? `<script src="/wizard.js" defer></script>` : ""}
${opts.refresh ? `<noscript><meta http-equiv="refresh" content="${opts.refresh}"></noscript>` : ""}
</head>
<body>
<header class="top"><div class="wrap top-in">
  <a class="brand" href="/"><span class="logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg></span><span><b>${P()}</b><small>by ${S()}</small></span></a>
  <nav class="nav"><a href="/"${opts.active === "home" ? ' aria-current="page"' : ""}>Overview</a><a href="/guide"${opts.active === "guide" ? ' aria-current="page"' : ""} ${opts.wizard ? 'target="_blank" rel="noopener"' : ""}>Guide</a></nav>
</div></header>
<main class="wrap">${body}</main>
<footer class="foot"><div class="wrap">&copy; ${new Date().getFullYear()} ${S()}. Your own AI receptionist agency, on your own accounts. Questions: ${support()}</div></footer>
</body>
</html>`;
}

const codeBox = (error = "", value = "") => `
<section class="card codebox" id="code">
  <h2>Bought your agency?</h2>
  <p>Your private setup link was emailed to you after purchase. Paste the link or just the code.</p>
  <form method="post" action="/go" class="code-form">
    <label class="sr" for="c">Setup code or link</label>
    <input id="c" name="code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" placeholder="Paste your link or code" value="${esc(value)}" required>
    <button class="btn" type="submit">Open my setup</button>
  </form>
  ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
</section>`;

const NEEDS: [string, string][] = RAILWAY ? [
  ["A Railway account", "On the Hobby plan (US$5 a month including US$5 of usage; it needs a card). Your agency and its database run here, in your name."],
  ["A Telnyx account", "The phone company that carries your calls. Upgrade it from trial before real callers ring."],
  ["Optional: your own email", "A Resend account (free to start) so invites and notices come from your address. Without it, invite links show on screen for you to copy and send."],
  ["Optional: your own domain", "From any registrar, so your agency lives at app.yourcompany.com. Without it, it runs at the https address Railway gives it."],
  ["Optional: calendar keys", "Google or Microsoft keys so receptionists can book into calendars."],
  ["About 15 minutes", "In any browser, on a computer or a phone. There's nothing to download or install."],
] : [
  ["A domain", "From any registrar. Your dashboard lives at an address like app.yourcompany.com."],
  ["A DigitalOcean account", "With a payment method. Your server is rented here, in your name, from about US$18 a month."],
  ["A Telnyx account", "The phone company that carries your calls. Upgrade it from trial before real callers ring."],
  ["A Resend account", "Free to start. Sends your sign-in links, invites and call notices. Other SMTP services work too."],
  ["Google or Microsoft keys", "Optional, so receptionists can book into calendars. You can add them later."],
  ["About 20 minutes", "In any browser, on a computer or a phone. There's nothing to download or install."],
];

const FOUR = [
  ["Open your private link", "It came in your purchase email and opens your own setup page."],
  ["Connect your accounts", RAILWAY ? "Two accounts, one at a time: Railway (hosting) and Telnyx (phones). Each is checked before you move on. Email and your own domain are optional extras." : "One at a time: domain, server, phones, email. Each is checked before you move on."],
  ["Click Install", RAILWAY ? "We set up your agency and its database in your Railway account. It's live at an https address straight away; your own domain is optional." : "We create a server in your DigitalOcean account and set up your agency on it, with https on your own domain."],
  ["It's yours", `Your brand, your clients, your ${RAILWAY ? "hosting" : "server"}. We delete every key you gave us and have no login to your accounts. Your agency shares health counts with us unless you switch it off, and we can only sign in if you turn Support access on.`],
];

export function homePage(error = "", value = "") {
  return layout(`Your own AI receptionist agency`, `
<section class="hero">
  <p class="eyebrow">Your agency, packaged</p>
  <h1>Your own AI receptionist agency, under your brand</h1>
  <p class="lead">A guided setup page builds your agency in <b>your</b> ${RAILWAY ? "Railway account, with <b>your</b> Telnyx phone account. Email and your own domain are optional extras you can add now or later" : "DigitalOcean account, on <b>your</b> domain, with <b>your</b> phone and email accounts"}. You sell AI receptionists to your clients. Nothing to download, and ${S()} has no login to your accounts.</p>
  <div class="row"><a class="btn" href="#code">Open my setup</a><a class="btn ghost" href="/guide">Read the guide</a></div>
</section>
<section>
  <h2>What you need</h2>
  <div class="grid">${NEEDS.map(([t, d]) => `<div class="card need"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join("")}</div>
  <p class="hint">You pay each provider directly for what you use. The <a href="/guide#accounts">guide</a> explains every account and where to find each key.</p>
</section>
<section>
  <h2>How it works</h2>
  <ol class="steps4">${FOUR.map(([t, d], i) => `<li><span class="num">${i + 1}</span><div><h3>${esc(t)}</h3><p>${esc(d)}</p></div></li>`).join("")}</ol>
</section>
${codeBox(error, value)}
`, { active: "home" });
}

export function messagePage(status: number, title: string, text: string, withCodeBox = false) {
  return layout(`${title} · ${CONFIG.productName}`, `
<section class="hero small"><p class="eyebrow">Error ${status}</p><h1>${esc(title)}</h1><p class="lead">${text}</p>
<div class="row"><a class="btn ghost" href="/">Back to the overview</a></div></section>
${withCodeBox ? codeBox() : ""}`);
}

export const badCodePage = () =>
  messagePage(404, "That setup link isn't valid", `Check you copied the whole link from your purchase email. If it still doesn't work, contact ${support()}.`, true);
export const revokedPage = () => messagePage(410, "This setup link has been turned off", `If you think that's a mistake, contact ${support()}.`);
export const limitedPage = (retry: number) => messagePage(429, "Too many tries", `Please wait ${retry} seconds and try again.`);
export const notFoundPage = () => messagePage(404, "Page not found", "That page doesn't exist.");
export const demoOfflinePage = (back: string) => messagePage(503, "The test dashboard is offline right now", `The test app isn't answering, so we can't open the dashboard. Try again in a minute. <a href="${esc(back)}">Back to your setup</a>`);
export const forbiddenPage = () => messagePage(403, "Please reload the page", "Your form expired or came from another site, so we didn't act on it. Reload the setup page and try again.");

// ---------------- the buyer guide ----------------
const sec = (id: string, title: string, body: string) => `<section class="gsec" id="${id}"><h2>${title}</h2>${body}</section>`;
const ul = (items: string[]) => `<ul class="gul">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const ht = (id: string) => {
  const h = howTo(id);
  const meta = [h.time, h.cost].filter(Boolean).map((x) => esc(x!)).join(" · ");
  return `<div class="ght" id="${esc(id)}"><h3>${esc(h.title)}</h3>${meta ? `<p class="hint">${meta}</p>` : ""}<div class="md">${h.html}</div>${h.link ? `<p class="hint"><a href="${esc(h.link)}" rel="noopener noreferrer" target="_blank">Open the provider's page</a></p>` : ""}</div>`;
};

export function guidePage() {
  const toc: [string, string][] = [
    ["requirements", "What you need"], ["accounts", "Get your accounts ready"], ["wizard", "The setup page, step by step"],
    ["after", "After the install"], ...(RAILWAY ? [["later", "Adding the extras later"] as [string, string]] : []), ["backups", "Backups and updates"], ["problems", "If something goes wrong"], ["yours", "What's yours now"],
  ];
  const known = new Set(["cloudflare-domain", "registrar-nameservers", "cloudflare-token", "registrar-dns-records", "digitalocean-token", "railway-token", "telnyx-account", "telnyx-api-key", "resend", "google-oauth", "microsoft-oauth"]);
  const extra = allHowTos().filter((h) => !known.has(h.id) && !h.placeholder);
  return layout(`Buyer guide · ${CONFIG.productName}`, `
<section class="hero small">
  <p class="eyebrow">Buyer guide</p>
  <h1>Setting up your AI receptionist agency</h1>
  <p class="lead">Everything from opening your accounts to your first sign-in. The setup page does the work; this guide explains each account and key it asks for. Allow about ${RAILWAY ? "15" : "20"} minutes, plus any waiting for Telnyx's checks.</p>
</section>
<div class="guide">
<nav class="toc card" aria-label="On this page"><b>On this page</b><ol>${toc.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join("")}</ol></nav>
<article class="gbody">
${sec("requirements", "1. What you need", RAILWAY ? `<p>Two accounts are all it takes: <b>Railway</b> and <b>Telnyx</b>.</p>${ul([
    "<b>A Railway account</b> on the Hobby plan (US$5 a month including US$5 of usage, with a card). Your agency and its database run here.",
    "<b>A Telnyx account</b>, upgraded from trial and with credit. Telnyx provides phone numbers and carries the calls.",
    "<b>A browser.</b> There's nothing to download or install on your computer.",
  ])}<p><b>Optional extras</b>, which you can add during setup or any time later:</p>${ul([
    "<b>Your own email.</b> A Resend account (or any SMTP service) so invites and notices come from your address. Without it, invite links show on screen for you to copy and send yourself.",
    "<b>Your own domain</b>, from any registrar (GoDaddy, Namecheap, Crazy Domains, VentraIP, Cloudflare and so on), so your agency lives at app.yourcompany.com. Without it, your agency runs at the https address Railway gives it. Resend sends from a domain you own, so email goes with your domain.",
    "<b>Calendar keys.</b> Google Cloud or Microsoft Entra keys, so receptionists can book into calendars.",
    "<b>AI help for your team.</b> An OpenRouter key pasted into Railway variables switches on an <b>Ask for help</b> assistant in your dashboard.",
  ])}` : ul([
    "<b>A domain</b> you own, from any registrar (GoDaddy, Namecheap, Crazy Domains, VentraIP, Cloudflare and so on).",
    "<b>A DigitalOcean account</b> with a payment method. Your server is rented here.",
    "<b>A Telnyx account</b>, upgraded from trial and with credit. Telnyx provides phone numbers and carries the calls.",
    "<b>A Resend account</b> to send email (or any SMTP service, under Advanced on the Email step).",
    "<b>Optional:</b> Google Cloud or Microsoft Entra keys, so receptionists can book into calendars.",
    "<b>A browser.</b> There's nothing to download or install on your computer.",
  ]))}
${sec("accounts", "2. Get your accounts ready", RAILWAY ? `
<h3>Hosting (Railway)</h3>${ht("railway-token")}
<h3>Phones (Telnyx)</h3>${ht("telnyx-account")}${ht("telnyx-api-key")}
<h2 class="gopt">Optional extras</h2>
<p>Skip these to install now. Each can be added later (see <a href="#later">Adding the extras later</a>).</p>
<h3>Email (optional)</h3>${ht("resend")}
<h3>Your own domain (optional)</h3>
<p>The setup page offers two ways. <b>Let the setup handle DNS</b> (recommended): put your domain on a free Cloudflare account and change its nameservers at your registrar; the setup then adds every record for you. <b>I'll add the records myself</b>: keep DNS where it is, and the setup shows you each record to add.</p>
${ht("cloudflare-domain")}${ht("registrar-nameservers")}${ht("cloudflare-token")}${ht("registrar-dns-records")}
<h3>Calendars (optional)</h3>${ht("google-oauth")}${ht("microsoft-oauth")}
${extra.map((h) => ht(h.id)).join("")}` : `
<h3>Your domain</h3>
<p>The setup page offers two ways. <b>Let the setup handle DNS</b> (recommended): put your domain on a free Cloudflare account and change its nameservers at your registrar; the setup then adds every record for you. <b>I'll add the records myself</b>: keep DNS where it is, and the setup shows you each record to add.</p>
${ht("cloudflare-domain")}${ht("registrar-nameservers")}${ht("cloudflare-token")}${ht("registrar-dns-records")}
<h3>Your server</h3>${ht("digitalocean-token")}
<h3>Phones</h3>${ht("telnyx-account")}${ht("telnyx-api-key")}
<h3>Email</h3>${ht("resend")}
<h3>Calendars (optional)</h3>${ht("google-oauth")}${ht("microsoft-oauth")}
${extra.map((h) => ht(h.id)).join("")}`)}
${sec("wizard", "3. The setup page, step by step", RAILWAY ? `
<ol class="glist steps-long">
  <li><b>Welcome.</b> Open the private link from your purchase email. Your progress is saved, so you can stop and come back to it.</li>
  <li><b>Brand.</b> Your brand name, which your clients see on every screen and email, and your owner email (you sign in with it).</li>
  <li><b>Railway.</b> Paste your Railway token. We check it works and that the account is on the Hobby plan.</li>
  <li><b>Telnyx.</b> Paste your Telnyx key. Every client's receptionist answers calls on your Telnyx account.</li>
  <li><b>Optional extras.</b> Three cards: your own <b>email</b> (Resend), your own <b>domain</b>, and <b>calendars</b>. Press <b>Skip for now</b> on any of them, or <b>Skip all and continue</b>. Nothing here is needed to go live.</li>
  <li><b>Install.</b> We make a project in your Railway account with a database and the app, and Railway builds it (about 5 minutes). Your agency is then live at the https address Railway gives it (it ends in <b>.up.railway.app</b>). If you added a domain, <b>app.your-domain</b> follows once its two records are in. If a build fails, <b>Try again</b> builds again in the same project, or <b>Delete the project</b> removes it.</li>
  <li><b>Done.</b> Open your address and sign in with your owner email. Delete your Railway token (and your Cloudflare token, if you used one). The page lists any extras you skipped, with how to add each later.</li>
</ol>` : `
<ol class="glist steps-long">
  <li><b>Welcome.</b> Open the private link from your purchase email. Your progress is saved, so you can stop and come back to it.</li>
  <li><b>Brand.</b> Your brand name, which your clients see on every screen and email, and your owner email (you sign in with it).</li>
  <li><b>Domain.</b> Connect Cloudflare (we wait for your nameserver change, then handle DNS) or choose to add records yourself. Pick the dashboard address, <b>app</b> by default.</li>
  <li><b>Server.</b> Paste your DigitalOcean token, then choose where the server lives and its size. You see the monthly price before anything is made.</li>
  <li><b>Phones.</b> Paste your Telnyx key. The page shows your credit.</li>
  <li><b>Email.</b> Paste your Resend key. We add your sending domain to Resend, put its records into DNS (or show them to you), and wait until Resend verifies them. Then send yourself a test email.</li>
  <li><b>Calendars</b> (optional). Paste Google or Microsoft keys, or skip.</li>
  <li><b>Install.</b> Click <b>Create my server and install</b>. We create the server in your DigitalOcean account and point your address at it. The server then downloads the app from us with a one-time link and installs it, 5 to 15 minutes. You can close the page. If it stops, the page says why: <b>Try again</b> reuses the same server, or <b>Delete the server</b> removes it.</li>
  <li><b>Done.</b> Your agency is live. Open your address and sign in with your owner email. Delete your DigitalOcean and Cloudflare tokens. Keep your Resend key: your server sends email with it.</li>
</ol>`)}
${sec("after", "4. After the install", ul([
    "Open your address and <b>sign in with the owner email</b> you entered. That makes you the owner of your agency.",
    "Add your first client (a business you sell a receptionist to), open it and click <b>Buy a number</b>. Australian numbers need proof of address and take about three days.",
    "The <b>Connections</b> page shows your Telnyx connection and credit (it warns you below US$5). Every client's receptionist runs on your Telnyx account.",
  ]))}
${RAILWAY ? sec("later", "5. Adding the extras later", `
<p>Skipped email, your domain or calendars? Your agency works without them, and you can add each one whenever you like. Your setup link keeps listing the extras you skipped, with these steps.</p>
<h3>Your own email</h3>
${ul([
    "Open your dashboard, then <b>Settings</b>, then <b>Email and calendars</b>.",
    "Paste your mail server address (for Resend: <code>smtps://resend:YOUR_RESEND_KEY@smtp.resend.com:465</code>) and the address emails come from, then press the test button.",
    "Resend sends from a domain you own, so add the DNS records it shows you for that domain.",
    "<b>Until email is set up</b>, invites show a link on screen for you to copy and send yourself. If you forget your own password, the reset link is printed in the app's <b>Logs</b> in Railway (your project, then the <b>app</b> service, then <b>Deployments</b>, then <b>View logs</b>).",
  ])}
<h3>Your own domain</h3>
${ul([
    "In Railway, open your project, the <b>app</b> service, then <b>Settings</b>, <b>Networking</b>, <b>Custom Domain</b>, and type <code>app.yourbusiness.com</code>.",
    "Railway shows a CNAME and a TXT record. Add both where your domain's DNS is managed.",
    "When Railway shows the domain as active, open the app service's <b>Variables</b> and change <code>PUBLIC_URL</code> to <code>https://app.yourbusiness.com</code>. Railway restarts the app.",
  ])}
<h3>Calendars</h3>
${ul([
    "Make the Google Cloud or Microsoft Entra app (see the how-tos above). Its redirect address is your agency's address followed by <code>/api/oauth/google/callback</code> (or <code>/microsoft/callback</code>).",
    "Open <b>Settings</b>, then <b>Email and calendars</b>, and paste the client ID and secret.",
  ])}
<h3>AI help for your team</h3>
${ul([
    "Make an account at openrouter.ai and create an API key. Add a few dollars of credit.",
    "In Railway, open the <b>app</b> service, then <b>Variables</b>, and add <code>OPENROUTER_API_KEY</code> with your key. Railway restarts the app.",
    "Your dashboard then shows an <b>Ask for help</b> button at the bottom right, where owners and admins can ask how to do things. Optionally set <code>OPENROUTER_MODEL</code> to choose a different model.",
  ])}`) + sec("backups", "6. Backups and updates", ul([
    "Your database is the <b>Postgres</b> service in your Railway project. Open it, then <b>Backups</b>, and turn on daily (and weekly) backups. Railway charges backups like volume storage.",
    "Your app's settings are the <b>app</b> service's <b>Variables</b> in Railway. Never change <code>MAILBOX_KEY</code>: it unlocks saved mailbox and calendar logins.",
    "Updates: we'll send you a link when a new version is out.",
  ])) : sec("backups", "5. Backups and updates", `
<p>Your app lives in <code>/opt/receptionist</code> on your server. Sign in with your own SSH key (if you added one) or the <b>Console</b> button on the droplet's page in DigitalOcean.</p>
${ul([
    "The database is backed up <b>every night at about 03:30</b> (server time) into <code>/opt/receptionist/backups</code>, kept for 14 days.",
    "Make one by hand: <code>sudo bash /opt/receptionist/backup.sh</code>. Restore: <code>sudo bash /opt/receptionist/restore.sh &lt;file&gt;</code>.",
    "Copy backups off the server now and then, or turn on DigitalOcean's droplet backups. Keep <code>/opt/receptionist/secrets.env</code> safe too.",
    "Updates: copy a new <code>selfhost-bundle.tgz</code> to the server and run <code>sudo bash /opt/receptionist/update.sh /root/selfhost-bundle.tgz</code>. It backs up first and keeps your settings and data.",
  ])}`)}
${sec("problems", `${RAILWAY ? 7 : 6}. If something goes wrong`, `
<dl class="faq">
  <dt>"That token can only read"</dt><dd>Make a new DigitalOcean token with Full Access (or tick Write) and paste that one.</dd>
  <dt>Cloudflare is still waiting for the nameserver change</dt><dd>Check the two nameservers at your registrar match exactly. Most changes show within an hour; some registrars take up to a day.</dd>
  <dt>"This token can't change DNS records"</dt><dd>Create a Cloudflare token with Zone: Read and DNS: Edit for your domain, or choose to add the records yourself.</dd>
  <dt>"That Resend key can only send email"</dt><dd>Create a new Resend key with Full access. The setup needs it to add your sending domain.</dd>
  <dt>A record never shows as found</dt><dd>Compare the name and value with the setup page. Some registrars want the name without your domain on the end (for example <code>app</code>, not <code>app.yourcompany.com</code>).</dd>
  <dt>"Telnyx didn't accept that key"</dt><dd>Copy it again from API Keys, or create a new one. Check you copied the whole line, starting with KEY.</dd>
  <dt>The install stopped</dt><dd>The page says why. Fix that if it's on your side, then press <b>Try again</b>: it reuses the same server and picks up where it stopped.</dd>
  <dt>Callers can't get through</dt><dd>Check your Telnyx Account Level says Paid, that you have credit, and that the number is connected on the client's page.</dd>
</dl>`)}
${sec("yours", `${RAILWAY ? 8 : 7}. What's yours now`, `
${ul([
    RAILWAY ? "<b>Your agency and its database</b> are in your Railway project. You pay Railway for them and can back up, resize or delete them." : "<b>The server</b> is in your DigitalOcean account. You pay DigitalOcean for it and can resize, back up or delete it.",
    RAILWAY ? "<b>Telnyx</b>, and any <b>domain, Resend or Google or Microsoft keys</b> you add, are yours, billed to you by each provider." : "<b>Your domain, Telnyx, Resend</b> and any <b>Google or Microsoft keys</b> are yours, billed to you by each provider.",
    `<b>Your data</b> (your clients, their receptionists, calls and settings) lives only on your ${RAILWAY ? "Railway project" : "server"}.`,
  ])}
<p>${S()} has <b>no login to your accounts</b>. While you set up, your keys are stored encrypted; once the install succeeds we delete every one of them. We never hold a key or password to your ${RAILWAY ? "Railway project" : "server"}.</p>
<h3>What your agency shares with us, and what it doesn't</h3>
${ul([
    "<b>Health and usage stats: on by default, and you can switch it off.</b> Every 15 minutes your agency sends us its version and address, whether it's healthy, counts (clients, receptionists, phone numbers, calls over the last 24 hours, 7 and 30 days, bookings, errors), when the last call came in, your brand name and logo address, and yes or no for email, your own domain and AI help. It never sends caller names or numbers, messages, transcripts, recordings, customer details, passwords or keys. Switch it off in your dashboard: <b>Settings</b>, then <b>Support</b>. When it's off, nothing is sent.",
    "<b>Support access: off unless you turn it on.</b> In <b>Settings</b>, then <b>Support</b>, you can let " + S() + " sign in to your dashboard to help you, for 24 hours, 7 days or until you turn it off. They sign in through a link that works once, for 60 seconds, as a read-only support person: they can look, not change anything, and can't see your keys or export your data. Every sign-in is recorded in your audit log and shown in Settings. Turn it off and any open support session ends straight away.",
    "Agencies installed before this existed share nothing and can't be signed in to.",
  ])}`)}
</article></div>`, { active: "guide" });
}
