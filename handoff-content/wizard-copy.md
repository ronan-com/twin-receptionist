# Setup wizard: on-screen copy

The words on each screen, in order, as `download-site/wizard.ts` shows them today. Where this file and the code disagree, the code wins and this file gets fixed.

Placeholders: `{{brand}}` (the brand name the buyer picks), `{{domain}}` (e.g. `example.com.au`), `{{host}}` (`app.{{domain}}`), `{{owner_email}}`, `{{from}}`, `{{balance}}`, `{{temp_url}}` (the `https://….up.railway.app` address).

Style: Australian spelling, short sentences, no exclamation marks. Every step has a collapsed **Step-by-step guide** with the matching how-to from `providers/`.

**Order:** Welcome · Brand · Hosting (Railway) · Phones (Telnyx) · Email (Resend) · Domain · Calendars (optional) · Install · Live

**Footer on every step:** Your keys are stored encrypted and deleted once your install is done.

---

## 1. Welcome

**Headline:** Let's set up your AI receptionist agency

**Body:** By the end your agency runs at app.your-domain, under your brand, on your own Railway account.

**Tiles**
- **Yours to keep:** Your brand, hosting, accounts and clients. We have no login to them.
- **About 20 minutes:** Close the page any time; this link picks up where you left off.
- **Have these ready:** Your domain, Railway, Telnyx and Resend accounts.

**Button:** `Start`

---

## 2. Brand

**Headline:** Name your brand

**Body:** Your brand appears on every screen and email your clients see.

**Fields**
- Brand name. Placeholder: "e.g. Chloe".
- Owner email. Hint: "You'll sign in with this as the owner of your agency."

**Buttons:** `Back` · `Continue`

**Errors:** Give your brand a name. / Enter a real email address.

---

## 3. Hosting (Railway)

**Headline:** Connect Railway

**Body:** Your agency runs in your own Railway account. You pay Railway directly, from US$5 a month.

**Field:** Railway account token. Hint: "Railway needs the **Hobby** plan (it asks for a card). Make the token with **No workspace**."

**Buttons:** `Back` · `Check and continue`

**Success line:** Connected to Railway ({{railway_email}}).

**Errors**
- Railway didn't accept that token. Make it under Account Settings > Tokens with Workspace set to No workspace, then paste it again.
- Your Railway account needs the Hobby plan (US$5 a month, with a card) to run your agency. Upgrade in Railway, then press Check again.
- That Railway account has no workspace yet. Open Railway once to finish signing up, then try again.

---

## 4. Phones

**Headline:** Connect your Telnyx account

**Body:** Your clients' receptionists answer calls on your Telnyx account.

**Field:** Telnyx API key. Placeholder: "KEY...".

**Warning:** A new Telnyx account is a trial: callers can't get through until it's upgraded and has credit.

**Buttons:** `Back` · `Check and continue`

**Success line:** Telnyx key works. Available credit: {{balance}}.

---

## 5. Email

**Headline:** Send email from your domain

**Body:** Invites and notices go out through your own Resend account.

**Fields**
- Resend API key. Hint: "Create it with **Full access**. Your agency only ever gets a send-only key."
- Send from. Placeholder: "hello@mail.yourbusiness.com". Hint: "A sub-domain like mail.yourbusiness.com keeps your main email separate."

**Buttons:** `Use another email service` · `Check and continue`

**Once checked**
- Headline: Email is connected
- Body: Emails will come from **{{from}}**.
- Notice: Resend is connected. We add its records for **{{sending_domain}}** on the Domain step.
- Buttons: `Use another key or address` · `Continue`

**Another email service (SMTP)**
- Headline: Send email from your domain
- Body: Use any email service that gives you SMTP details.
- Fields: SMTP server, Port, Username, Password, Send from.
- Buttons: `Use Resend instead` · `Check and continue`

**Errors:** That Resend key can only send: make one with Full access. / {{domain}} is already added to another Resend account. Use that account's key, or remove it there first.

---

## 6. Domain

**Headline:** Your web address

**Body:** Your dashboard will live at app.your-domain. Your main website stays as it is.

**Field:** Your domain. Placeholder: "yourbusiness.com.au".

**Preview line:** Your dashboard: **app.{{domain}}**

**Choice (radio cards)**
- **Let the wizard handle DNS** (Recommended). "Use a free Cloudflare account; we add every record for you."
  Field: Cloudflare API token. Hint: "Use the **Edit zone DNS** template and add **Zone: Read**, for this domain."
- **I'll add the records myself.** "Keep DNS where it is. We tick each record off as it appears."
  Hint: "We'll show you each record to add, with a tick as it appears."

**If app.{{domain}} already exists (Cloudflare):** **app.{{domain}}** already points somewhere else. Tick box: **Replace it with my new server** · "Nothing else on your domain changes."

**Buttons:** `Back` · `Continue`

### 6a. Switch your nameservers (Cloudflare, only if needed)

- Headline: Switch your nameservers
- Body: At the company you bought **{{domain}}** from, replace its nameservers with these two.
- Shown: the two nameservers, each with `Copy`.
- Warning: Have a website or email on this domain? Check Cloudflare copied all your records before you switch.
- Status: Waiting for the switch. This can take minutes or hours; you can close this page.
- Buttons: `Change domain` · `Check now`

### 6b. Add your email records (adding records yourself)

- Headline: Add your email records
- Body: Add each one where you manage DNS for **{{domain}}**. They tick off as they appear; you can keep going meanwhile.
- Table: Type · Name · Value (each with `Copy`) · Found / Waiting.
- Line under it: Your dashboard's two records come on the Install step.
- Status: Waiting for Resend to verify · checked {{time}}. Then: Resend verified your email domain.
- Buttons: `Change domain` · `Continue`

**Errors**
- This token can't see {{domain}}. Add it to Cloudflare first, or make the token for it.
- That token needs Zone: Read and DNS: Edit for your domain.
- Your email address is on {{sending_domain}}. Use that domain here, or go back to Email and change the address.

---

## 7. Calendars (optional)

**Headline:** Calendar booking

**Body:** Optional: let receptionists book into Google or Outlook calendars.

**Google card:** Redirect URI `https://app.{{domain}}/api/oauth/google/callback` (`Copy`) · Client ID · Client secret

**Microsoft card:** Redirect URI `https://app.{{domain}}/api/oauth/microsoft/callback` (`Copy`) · Application (client) ID · Client secret

**Buttons:** `Back` · `Skip for now` · `Check and continue`

**Success lines:** Google accepted these keys. / Microsoft found your app and accepted the secret.

---

## 8. Install

**Headline:** Ready to install

**Body:** We'll set up {{brand}} in your Railway account. You can close the page while it runs.

**Summary:** Dashboard: {{host}} · Hosting: Railway · {{workspace}} · from US$5/mo · Phones: Telnyx ••••{{last4}} · Email from: {{from}} · DNS: Handled by the wizard / You add two records

**Button:** `Install`

**While it runs**
- Headline: Setting up {{brand}}
- Body: About 10 minutes. You can close this page; your link picks up where you left off.
- Stages, ticked as they finish:
  1. Creating your project in Railway
  2. Adding your database
  3. Adding the app and your settings
  4. Building the app (the longest step)
  5. Starting the app
  6. Connecting {{host}} (or: Waiting for your records for {{host}})
  7. Getting your security certificate
- Status lines: Setting up your Railway project. About a minute. / Railway is building the app. Usually 3 to 6 minutes. / Starting the app and its database.
- Adding records yourself: a box **Add these two records for {{host}}** ("Add them now, while the app builds."), with Railway's CNAME and TXT and a tick for each.
- `Show details`: the install log.
- `Delete the project`. Confirm: "Delete this project (app and database) from your Railway account?"

**Running, waiting for the domain**
- Headline: {{brand}} is running
- Body: Use your temporary address now. {{host}} starts working once its records are in.
- Shown: ● Running · {{temp_url}} · "Your temporary address. It keeps working after {{host}} is ready."
- Status: Waiting for your records. Usually within 15 minutes. / Waiting for DNS. Usually a minute or two. / Railway is getting your security certificate. Usually a few minutes.
- Buttons: `Delete the project` · `Finish now`

**If it stops**
- Headline: The install stopped (build or start failed) / We couldn't set up Railway (project setup failed)
- Body: the reason in one line, e.g. "Railway couldn't build the app: …" or "The app started but then stopped: …"
- Buttons: `Delete the project` · `Try again`. Try again builds again in the same project, with the same database and settings.

---

## 9. Live

**Headline:** Your agency is live

**Body:** {{brand}} is running in your own Railway account. Everything here is yours.

**Shown:** ● Live · `https://app.{{domain}}` (or the temporary address, if the records aren't in yet: "Your temporary address. **{{host}}** starts working by itself once the records below are in.")

**Line under it:** Create your account with **{{owner_email}}**. Only that address can make the first account.

**Before you go**
- Delete your Railway token. `Open Railway`
- Delete your Cloudflare token. `Open Cloudflare` *(wizard-DNS only)*
- Keep your Resend account: your agency sends email through it with its own send-only key.
- Turn on backups for the Postgres volume in Railway (its Backups tab).

**Notice:** We've deleted every key you gave us. We have no login to your Railway project or accounts. Your agency shares health and usage counts with us (never calls or customer details). That is on by default and you can switch it off in your dashboard, under Settings, then Support. Support access lets us sign in to help you and make changes. It's also on by default, and you can turn it off there.

**Button:** `Open your dashboard`

> TODO (Ronan): Railway's docs don't say which plans get volume backups, and Railway staff have said backups went to Pro first. If the Backups tab is empty on Hobby, this line needs a different instruction (upgrade to Pro, or another backup route). Check on a real Hobby account.

---

## General messages

- Finish the earlier steps first.
- You've tried that a lot in a short time. Please wait {{n}} seconds and try again.
- For safety we deleted the keys you gave us, since this setup sat unused for a while. Paste them again to carry on.
- {{Provider}} is busy: wait a minute and try again. / {{Provider}} is having a problem: try again in a few minutes.
