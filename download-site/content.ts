// Buyer-facing how-tos, written as Markdown in handoff-content/providers/<id>.md
// (YAML-ish front matter: id, title, time, cost, link). Loaded once at startup.
// The renderer is deliberately tiny: headings, paragraphs, lists, quotes, code, bold,
// italics and links. All HTML in the source is escaped; only http(s), mailto and
// same-site links are kept.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG } from "./lib";

export const PROVIDER_IDS = [
  "cloudflare-domain", "cloudflare-token", "registrar-nameservers", "registrar-dns-records", "digitalocean-token", "railway-token",
  "telnyx-account", "telnyx-api-key", "vapi-account", "twilio-account", "openrouter-key", "resend", "google-oauth", "microsoft-oauth", "stripe",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface HowTo { id: string; title: string; time?: string; cost?: string; link?: string; html: string; md: string; placeholder: boolean }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function inline(s: string, copyCode = false): string {
  // Code spans first, so nothing inside them is touched. In a how-to every code span is something to
  // type or paste, so it gets a Copy button (hidden until /wizard.js is running, since it needs script).
  const codes: string[] = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(copyCode ? `<span class="cp"><code>${c}</code><button type="button" class="copy" data-copy="${c}" hidden>Copy</button></span>` : `<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const h = href.replace(/&amp;/g, "&");
    if (/^https?:\/\//i.test(h)) return `<a href="${esc(h)}" rel="noopener noreferrer" target="_blank">${label}</a>`;
    if (/^mailto:/i.test(h) || /^\/(?!\/)/.test(h) || /^#/.test(h)) return `<a href="${esc(h)}">${label}</a>`;
    return label;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, "$1<i>$2</i>");
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

export function markdown(src: string, headingShift = 1, copyCode = false): string {
  const lines = src.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const il = (t: string) => inline(t, copyCode);
  const flushPara = () => { if (para.length) out.push(`<p>${il(para.join("\n")).replace(/\n/g, "<br>")}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${il(i)}</li>`).join("")}</${list.tag}>`); list = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara(); flushList();
      const body: string[] = [];
      while (++i < lines.length && !/^```/.test(lines[i])) body.push(lines[i]);
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    let m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) { flushPara(); flushList(); const n = Math.min(6, m[1].length + headingShift); out.push(`<h${n}>${il(m[2])}</h${n}>`); continue; }
    m = line.match(/^\s*(?:[-*+])\s+(.*)$/);
    const o = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m || o) {
      flushPara();
      const tag = m ? "ul" : "ol";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((m || o)![1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += " " + line.trim(); continue; }
    m = line.match(/^>\s?(.*)$/);
    if (m) { flushPara(); flushList(); out.push(`<blockquote>${il(m[1])}</blockquote>`); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join("\n").replace(/<\/blockquote>\n<blockquote>/g, "<br>");
}

function frontMatter(src: string): { meta: Record<string, string>; body: string } {
  src = src.replace(/\r\n?/g, "\n");
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const l of m[1].split("\n")) {
    const kv = l.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: src.slice(m[0].length) };
}

// Short stand-ins, used until the real how-tos are written.
const PLACEHOLDER: Record<string, [string, string]> = {
  "cloudflare-domain": ["Put your domain on Cloudflare", "Sign up free at [cloudflare.com](https://dash.cloudflare.com/sign-up), click **Add a domain**, type your domain and pick the **Free** plan. Cloudflare copies your existing records; check they're all there. It then shows two nameservers."],
  "cloudflare-token": ["Create a Cloudflare API token", "In Cloudflare open **My Profile > API Tokens > Create Token**, use the **Edit zone DNS** template, add the permission **Zone: Read** next to **DNS: Edit**, choose your domain under Zone Resources, then **Create Token** and copy it."],
  "registrar-nameservers": ["Change your nameservers", "At the company you bought the domain from (GoDaddy, Namecheap, Crazy Domains, VentraIP...), find **Nameservers** (or **DNS servers**) for the domain, choose **custom**, and replace them with the two Cloudflare showed you. It usually takes minutes, sometimes a few hours."],
  "registrar-dns-records": ["Add DNS records at your registrar", "Open your domain's **DNS** or **DNS records** page at your registrar and add each record exactly as shown: type, name (host) and value. Leave TTL on the default. Some registrars want the name without your domain on the end."],
  "digitalocean-token": ["Create a DigitalOcean token", "Sign in at [DigitalOcean](https://cloud.digitalocean.com/), add a payment method, then open **API > Generate New Token**. Choose **Full Access** (it needs write scope), set it to expire in 30 days, and copy it (it starts with `dop_v1_`)."],
  "railway-token": ["Create a Railway token", "Sign up at [railway.com](https://railway.com), then choose the **Hobby** plan under **Account > Plans** (US$5 a month, which includes US$5 of usage; it needs a card). Open **Account Settings > Tokens** ([railway.com/account/tokens](https://railway.com/account/tokens)), type a name like *Setup*, leave **Workspace** on **No workspace**, click **Create** and copy the token. You can delete it once your agency is live."],
  "telnyx-account": ["Open and upgrade a Telnyx account", "Sign up at [telnyx.com](https://telnyx.com/sign-up), confirm your email, then upgrade from trial under **Account Level** and add credit under **Billing**. Real callers can't reach a trial account."],
  "telnyx-api-key": ["Create a Telnyx API key", "In Telnyx open **Account Settings > API Keys > Create API Key** and copy it straight away (it starts with `KEY`)."],
  "vapi-account": ["Vapi: sign up and copy your two keys", "Sign up at [dashboard.vapi.ai](https://dashboard.vapi.ai/), add credit under **Billing**, then open [API Keys](https://dashboard.vapi.ai/org/api-keys) and copy the key under **Private API Keys** and the one under **Public API Keys**."],
  "twilio-account": ["Twilio: numbers and texts", "Sign up at [twilio.com](https://www.twilio.com/try-twilio), click **Upgrade**, then copy the **Account SID** and **Auth Token** from **Account Info** on the [Console](https://console.twilio.com/) home page."],
  "openrouter-key": ["Get an OpenRouter key", "Sign up at [openrouter.ai](https://openrouter.ai/), add credit, then open **Keys > Create Key** and copy it (it starts with `sk-or-`)."],
  "resend": ["Create a Resend API key", "Sign up at [resend.com](https://resend.com/signup), open **API Keys > Create API Key**, choose **Full access** and copy it (it starts with `re_`). The setup adds and verifies your sending domain for you."],
  "google-oauth": ["Google calendar keys (optional)", "Not needed if your setup provider offers the shared connection: Google Calendar then connects with one click from your dashboard. To use your own app instead, in [Google Cloud](https://console.cloud.google.com/apis/credentials) enable the Google Calendar API, then create an **OAuth client ID** of type **Web application** with the redirect address shown on this page. Copy the Client ID and secret."],
  "microsoft-oauth": ["Microsoft calendar keys (optional)", "Not needed if your setup provider offers the shared connection: Outlook then connects with one click from your dashboard. To use your own app instead, in [Microsoft Entra](https://entra.microsoft.com/) open **App registrations > New registration**, allow any organisation and personal accounts, add the **Web** redirect address shown on this page, then create a client secret and copy its **Value**."],
  "stripe": ["Stripe (optional)", "Only needed if you bill your clients through Stripe. You can set it up later from your dashboard."],
};

let cache: Map<string, HowTo> | null = null;
function contentDirs(): string[] {
  return [CONFIG.contentDir, join(import.meta.dir, "content"), resolve(import.meta.dir, "../handoff-content")].filter(Boolean);
}
export function loadContent(): Map<string, HowTo> {
  const m = new Map<string, HowTo>();
  for (const id of PROVIDER_IDS) {
    const [title, body] = PLACEHOLDER[id];
    m.set(id, { id, title, html: markdown(body, 1, true), md: body, placeholder: true });
  }
  for (const dir of contentDirs()) {
    const pdir = join(dir, "providers");
    if (!existsSync(pdir)) continue;
    for (const f of readdirSync(pdir)) {
      if (!f.endsWith(".md")) continue;
      try {
        const { meta, body } = frontMatter(readFileSync(join(pdir, f), "utf8"));
        const id = (meta.id || f.replace(/\.md$/, "")).toLowerCase();
        if (!/^[a-z0-9-]+$/.test(id) || (m.has(id) && !m.get(id)!.placeholder)) continue;
        m.set(id, { id, title: meta.title || PLACEHOLDER[id]?.[0] || id, time: meta.time, cost: meta.cost, link: /^https?:\/\//.test(meta.link || "") ? meta.link : undefined, html: markdown(body.replace(/^#\s+.*\n/, ""), 1, true), md: body, placeholder: false });
      } catch (e) {
        console.error(`content: couldn't read ${f}: ${(e as Error).message}`);
      }
    }
    break; // first folder that exists wins
  }
  cache = m;
  return m;
}
export const howTo = (id: string): HowTo => (cache || loadContent()).get(id) || { id, title: id, html: "", md: "", placeholder: true };
export const allHowTos = () => [...(cache || loadContent()).values()];

/** The welcome email (handoff-content/welcome-email.md): subject + plain-text body with {{placeholders}}. */
export function welcomeEmail(): { subject: string; body: string } | null {
  for (const dir of contentDirs()) {
    const f = join(dir, "welcome-email.md");
    if (!existsSync(f)) continue;
    const src = readFileSync(f, "utf8").replace(/\r\n?/g, "\n");
    const m = src.match(/\*\*Subject:\*\*\s*(.+)\n([\s\S]*)$/);
    if (!m) return null;
    const body = m[2].replace(/\*\*([^*]+)\*\*/g, "$1").replace(/^\s+/, "").trimEnd() + "\n";
    return { subject: m[1].trim(), body };
  }
  return null;
}
