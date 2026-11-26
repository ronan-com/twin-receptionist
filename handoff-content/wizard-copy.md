# Setup wizard: on-screen copy

Exact words for each screen, in order. Placeholders: `{{product}}` (the name the buyer picks), `{{domain}}` (their domain, e.g. `example.com.au`), `{{owner_email}}`, `{{server_ip}}`, `{{region}}`, `{{size}}`, `{{balance}}`. The dashboard always lives at `app.{{domain}}`.

Style: Australian spelling, short sentences, no exclamation marks.

> TODO (Ronan): match screen order and field names against the wizard code in `download-site/` once it's built. Where this copy and the code disagree, the code wins and this file gets fixed.

---

## 1. Welcome

**Headline:** Let's set up your receptionist business

**Body:** At the end you'll have your own AI receptionist dashboard at app.your-domain, running on a server you own, with your own phone, email and domain accounts. We don't keep any access.

**What you'll have at the end**
- Your dashboard at `app.{{domain}}`, with your name and branding
- A private server in your DigitalOcean account, with nightly database backups
- Phone numbers and calls on your own Telnyx account
- Invites and booking emails sent from your domain through Resend
- Optional: Google and Microsoft calendar sign-in for your clients

**What you need**
- A domain you own (any registrar), or a Cloudflare account it's already on
- A DigitalOcean account with a payment method
- A Telnyx account, upgraded from trial, with some credit
- A Resend account
- Optional: a Google Cloud and/or Microsoft Entra account for calendars
- A password manager, to save the logins and keys you make today

**How long:** About 20 to 30 minutes of your time. Some providers then do their own checks: Telnyx can take up to two working days to approve a card, and a nameserver change can take a few hours. You can close this page and come back to your link at any time.

**Buttons:** `Start` · `See the provider how-tos`

---

## 2. Brand

**Headline:** Name your product

**Body:** This name appears on every screen, email and page title your clients see. The owner email becomes the first account, with full control.

**Fields**
- Product name. Hint: "For example, Chloe. You can't leave this blank."
- Owner email. Hint: "Only this address can create the first account. Use one you'll keep."

**Buttons:** `Back` · `Next`

---

## 3. Domain

**Headline:** Where your dashboard will live

**Body:** Enter the domain you own. Your dashboard goes at app.{{domain}}, so your main website stays as it is.

**Field:** Your domain. Hint: "Just the domain, like example.com.au. No https://, no www."

**Preview line:** Your dashboard will be at **app.{{domain}}**

**Choice (radio cards):**

**Let the wizard handle DNS** (Recommended)
Your domain uses Cloudflare for DNS, and the wizard adds every record for you: the server address and the email records Resend needs. If your domain is with another registrar, you point it at Cloudflare once. You keep the domain where it is.
Field: Cloudflare API token. Hint: "Create it with the Edit zone DNS template, for {{domain}} only."

**I'll add the records myself**
Keep DNS where it is now. The wizard shows you each record to add (the server address, then Resend's email records) and checks them for you. Works with GoDaddy, Crazy Domains, Namecheap, VentraIP and any other registrar.

**Note under the cards:** Already have something at app.{{domain}}? It will be replaced when the record is added. Pick a different domain if you need it.

**Buttons:** `Back` · `Check and continue`

**Success line:** Cloudflare token works. It can edit DNS for {{domain}}.

### 3a. Point your domain at Cloudflare (only if needed)

**Headline:** Point {{domain}} at Cloudflare

**Body:** Sign in where you bought {{domain}} and replace its nameservers with these two. This is the only change you make at your registrar.

**Shown:** `{{ns1}}` · `{{ns2}}` (copy buttons)

**Small print:** Most registrars take a few minutes. Some take up to 24 hours. You can keep going: we'll wait for it at the install step.

**Buttons:** `Back` · `I've changed them`

---

## 4. Server

**Headline:** Your server

**Body:** We create one server in your DigitalOcean account. It runs the dashboard, its database and the nightly backups. You pay DigitalOcean for it directly.

**Fields**
- DigitalOcean API token. Hint: "API → Generate New Token. Name it setup, give it full access and a 30-day expiry. You'll delete it when we're done."
- Location. Default: Sydney. Hint: "Pick the one closest to your clients. Your data is stored here."
- Size. Options:
  - 2 GB memory: "Recommended. Room for many agencies."
  - 1 GB memory: "Works, but slower to install and update."
  - Larger: "For a lot of agencies and calls."
  Each option shows DigitalOcean's monthly price.

**Buttons:** `Back` · `Check and continue`

**Success line:** Connected to the DigitalOcean account {{do_email}}.

---

## 5. Phones

**Headline:** Connect your phone account

**Body:** Your receptionists answer calls on Telnyx. The account is yours: every call and number is billed to it, at Telnyx's prices.

**Fields**
- Telnyx API key. Hint: "Account Settings → API Keys → Create API Key. Leave it on No Expiration. It starts with KEY."
- Who pays for calls? (radio)
  - **My account, for everyone** (default): "Agencies you invite run on your Telnyx account. You buy numbers for them."
  - **Each agency brings its own**: "Every agency connects its own Telnyx account before it can make receptionists. They buy and pay for their own numbers."

**Small print:** A brand-new Telnyx account is a trial. Real callers can't get through until it's upgraded and has credit.

**Buttons:** `Back` · `Check and continue`

**Success line:** Telnyx key works. Available credit: {{balance}}.

**Low-credit line (warning):** Your credit is low. Top up and turn on Auto Recharge in Telnyx Billing before you take real calls.

---

## 6. Email

**Headline:** Send email from your domain

**Body:** Invites, password resets and booking emails go out through your Resend account, from an address on {{domain}}.

**Fields**
- Resend API key. Hint: "API Keys → Create API Key, with Sending access. It starts with re_."
- Send from. Default: `{{product}} <no-reply@{{domain}}>`. Hint: "A name and an address on your domain."

**If "Let the wizard handle DNS":** We'll add Resend's records to Cloudflare for you during the install.
**If "I'll add the records myself":** Add these records where your DNS is. Resend checks them, usually within minutes. (Table of records, each with a copy button and a live status: Waiting / Found.)

**Buttons:** `Back` · `Check and continue` · `Send me a test email` (after the domain is verified)

**Success line:** Resend key works. Your domain is verified.

---

## 7. Calendars (optional)

**Headline:** Calendar sign-in (optional)

**Body:** Lets your clients connect Google or Outlook calendars with one click, so receptionists book into them. You can skip this and add it later in Settings → Email and calendars.

**Google card**
- Redirect URI to add: `https://app.{{domain}}/api/oauth/google/callback` (copy)
- Client ID · Client secret

**Microsoft card**
- Redirect URI to add: `https://app.{{domain}}/api/oauth/microsoft/callback` (copy)
- Application (client) ID · Client secret value

**Buttons:** `Back` · `Skip for now` · `Check and continue`

**Success line:** Google app accepted. / Microsoft app accepted.

---

## 8. Install

**Headline:** Installing {{product}}

**Body:** This takes about 10 to 20 minutes. You can leave this page open or come back later: the install keeps running on your server.

**Before it starts (summary card):** app.{{domain}} · {{region}} · {{size}} · Telnyx connected · Email from {{mail_from}} · Calendars: {{calendar_summary}}

**Button:** `Install` (then hidden)

### Progress messages (one line per stage, ticked when done)

1. Creating your server in DigitalOcean…
2. Waiting for your server to start…
3. Adding your DNS records in Cloudflare… *(wizard-DNS only)*
4. Checking app.{{domain}} points to your server…
5. Checking your email domain with Resend…
6. Copying {{product}} to your server…
7. Installing the system software…
8. Building the app. This is the longest step…
9. Starting the database and the app…
10. Getting your security certificate…
11. Checking everything answers…

**Done line:** All set. app.{{domain}} is live.

### Waiting messages

**Nameservers not changed yet**
Waiting for {{domain}} to move to Cloudflare. Your registrar can take up to 24 hours. We check every minute. You can close this page: come back to your link and we'll carry on.

**DNS not pointing yet** (manual DNS)
Add this record where your DNS is: **A** · **app** · **{{server_ip}}**. Turn off any proxy (DNS only). We'll check every 30 seconds.
Buttons: `Check now` · `Install anyway`
Small print under "Install anyway": The install runs, but its last step needs the address working. If it isn't yet, it stops and you can press Try again later.

**DNS added, still spreading**
The record is in place. Some networks take a little while to see it. We'll keep checking.

**Resend not verified yet**
Waiting for Resend to verify {{domain}}. This is usually a few minutes, sometimes longer. Everything else carries on in the meantime.
Button: `Check now`

---

## 9. Done

**Headline:** You're live

**Body:** {{product}} is running at app.{{domain}}, on your own server. Everything here is yours now.

**Your link:** `https://app.{{domain}}` · button `Open your dashboard`

**Line under it:** Create your account with **{{owner_email}}**. Only that address can make the first account, and it becomes the owner.

**Before you go (checklist, each ticks when clicked):**
- [ ] Delete the DigitalOcean token named "setup" (API → Tokens). `Open DigitalOcean`
- [ ] Delete the Cloudflare token you made for this (My Profile → API Tokens). `Open Cloudflare` *(wizard-DNS only)*
- [ ] Download your server key and save it in your password manager. `Download server key`
- [ ] Save your Telnyx, Resend and calendar keys in your password manager too.

**Server key note:** This key is the only way to sign in to your server's command line (for backups, restores and updates). We don't keep a copy. If you lose it, you can add a new key from the DigitalOcean console.

**Footer:** Next: read "Your first hour" for what to do once you're signed in. `Open Your first hour`

> TODO (Ronan): confirm the wizard deletes its stored tokens and the server key from our side at this screen, and say so here ("We've deleted our copy of your tokens and server key.") once it does.

---

## Error messages

Each: headline, body, buttons.

**Bad token / key (any provider)**
- Headline: That {{provider}} key didn't work
- Body: {{provider}} turned it down. Copy it again, making sure you've got the whole line, or create a new one.
- Buttons: `Try again` · `Open {{provider}}`

**Missing permission (Cloudflare)**
- Headline: This token can't edit DNS for {{domain}}
- Body: The token works but doesn't have Zone → DNS → Edit for {{domain}}. Make a new one with the Edit zone DNS template and pick {{domain}} under Zone Resources.
- Buttons: `Try again` · `Open Cloudflare`

**Missing permission (DigitalOcean)**
- Headline: This token is read-only
- Body: We need to create a server and an SSH key, so the token needs full (read and write) access. Make a new one with full access.
- Buttons: `Try again` · `Open DigitalOcean`

**DigitalOcean account not ready**
- Headline: DigitalOcean can't create servers yet
- Body: Your DigitalOcean account needs a verified email and a payment method before it can make a server. Finish those, then try again.
- Buttons: `Try again` · `Open DigitalOcean`

**Domain not on Cloudflare**
- Headline: {{domain}} isn't in this Cloudflare account
- Body: Add {{domain}} to Cloudflare first, or use a token from the account it's in. Or choose "I'll add the records myself".
- Buttons: `Try again` · `Add records myself`

**DNS not propagated yet**
- Headline: app.{{domain}} doesn't point to your server yet
- Body: We can still see {{found_ip}} (or nothing). If you've just added the record, give it a few minutes. If not, add **A · app · {{server_ip}}**, DNS only.
- Buttons: `Check again` · `Install anyway`

**Resend not verified yet**
- Headline: Resend hasn't verified {{domain}} yet
- Body: Resend is still looking for your email records. Check they match the table exactly. You can finish the install now: emails start sending as soon as Resend verifies the domain.
- Buttons: `Check again` · `Carry on without email for now`

> TODO (Ronan): decide whether "Carry on without email for now" is allowed. Without email, invites and password resets only appear in the server log until it's fixed in Settings → Email and calendars.

**Droplet create failed**
- Headline: DigitalOcean couldn't create your server
- Body: DigitalOcean said: "{{reason}}". This is often a server limit on new accounts or a size that isn't available in {{region}}. Try another location or size, or ask DigitalOcean to raise your limit.
- Buttons: `Try again` · `Change location or size`

**Install failed**
- Headline: The install stopped
- Body: Your server said: "{{reason}}". Nothing is lost: the server and its settings are still there, and it's safe to run the install again.
- Buttons: `Try install again` · `Show the log` · `Delete the server`
- Delete confirmation: This removes the server from your DigitalOcean account so you stop paying for it. You can create a new one afterwards. Buttons: `Cancel` · `Delete server`

**Telnyx still on trial**
- Headline: Your Telnyx account is still a trial
- Body: Real callers can't get through to a trial account. In Telnyx, open your profile → Account Level → Upgrade, then add credit. You can finish the install now and upgrade before you take real calls.
- Buttons: `Check again` · `Carry on` · `Open Telnyx`

**Lost contact (wizard page)**
- Headline: We've lost contact with the wizard
- Body: Check your internet connection. Your install keeps running on your server. Reopen your setup link and this page picks up where you left off.
- Buttons: `Reconnect`
