# What you own

Everything that runs {{brand}} sits in accounts in your name. Use this page to check each one, tidy up after setup, and make sure you can always get back in.

## Your accounts

| What | Where it lives | What it does | You pay |
|---|---|---|---|
| Domain `{{domain}}` | Your registrar (and Cloudflare, if you chose "Let the wizard handle DNS") | Your web address. `app.{{domain}}` points at Railway (a CNAME and a TXT record). Resend's email records sit here too. | Your registrar, yearly |
| Hosting | A project in your Railway account | Runs the dashboard and its Postgres database | Railway: Hobby plan US$5 a month, includes US$5 of usage, plus any usage above that |
| Phone account | Your Telnyx account | Every client's numbers, call minutes and receptionists. You see every call and charge in the Telnyx portal. | Telnyx, from prepaid credit |
| Email sending | Your Resend account | Invites, password resets and booking emails from `{{domain}}` | Resend (free plan available) |
| Calendar apps (optional) | Your Google Cloud project and/or Microsoft Entra app registration | One-click calendar sign-in for your clients | Usually nothing |
| Dashboard owner login | `https://app.{{domain}}`, the owner email you chose | Full control of every client and setting | Nothing |

## Your hosting and data

Your Railway project holds two services:

| Service | What it is |
|---|---|
| The app | Your dashboard. Its **Variables** tab holds your settings: brand name, domain, owner email, Telnyx key, email and calendar settings, and `MAILBOX_KEY`. |
| Postgres | Your database, on a Railway volume. Your call records, clients, bookings and follow-ups are stored there. |

**Keep a copy of `MAILBOX_KEY`** in your password manager (copy it from the app's **Variables** tab). It unlocks saved mailbox and calendar logins. Lose it and those logins have to be connected again.

**Backups are not automatic.** Turn them on for the Postgres volume in Railway: open the Postgres service, then its **Backups** tab, and pick a schedule (daily backups are kept for 6 days). See the operating guide.

> TODO (Ronan): Railway's docs don't say which plans get volume backups, and Railway staff have said backups went to Pro first. Check the Backups tab on a real Hobby account, then say here whether Hobby buyers need Pro (US$20 a month) or another backup route.

## Tidy up after setup

Delete these. You don't need them again: the wizard is finished.

- [ ] **Railway:** Account Settings → Tokens ([railway.com/account/tokens](https://railway.com/account/tokens)). Delete the token you made for setup. (If you ever rerun the wizard, make a new one.)
- [ ] **Cloudflare** (only if the wizard handled DNS): My Profile → API Tokens. Delete the token you made for setup.
- [ ] **Resend Full access key** you pasted into the wizard. Your agency doesn't use it: the wizard made it a separate send-only key. Delete it in Resend under API Keys, or keep it in your password manager if you'll want to add domains later.

Keep these, but save them in your password manager. The dashboard uses them to run:

- [ ] **Telnyx API key.** Rotate it if it was ever pasted anywhere else: create a new one in Telnyx, paste it into the app's Variables in Railway (see the operating guide), then delete the old one. Use a key from the same Telnyx account: your receptionists live in that account.
- [ ] **Resend send-only key** (the one the wizard made, in the app's `SMTP_URL` variable). To rotate it, make a new one with Sending access, update the mail server address in **Settings → Email and calendars** (`smtps://resend:NEW_KEY@smtp.resend.com:465`), click **Send test email**, then delete the old one in Resend.
- [ ] **Google / Microsoft client secrets** (if set). Change them in **Settings → Email and calendars**.
- [ ] **`MAILBOX_KEY`** from the app's Variables in Railway.

## Make sure you can always get back in

Do this once for **each** account: registrar, Cloudflare, Railway, Telnyx, Resend, Google, Microsoft.

1. **Turn on two-step sign-in** (2FA). Telnyx makes you do this when you upgrade. Do it everywhere else too.
2. **Save the recovery codes** each provider gives you. Store them in your password manager, and keep a printed copy somewhere safe.
3. **Use a work email you'll keep** for every account, not a personal one. If you have staff, think about a shared admin mailbox.
4. **Keep your card current** at Railway, Telnyx and your registrar. An expired card is the most common way a service stops.
5. **Turn on domain auto-renew** at your registrar. If the domain lapses, the dashboard, email and calendar sign-in all stop.

**Your dashboard login:** the dashboard has no two-step sign-in of its own, so use a long, unique password. Password reset works by email. If email isn't working, the reset link is written to the app's log instead. In Railway, open the app service, click the latest deployment and read its logs.

## What we keep

Nothing that gives us a way in on our own. The only way into your dashboard is Support access, and only you can turn it on.

- Our setup site deleted every key and token you gave it when your install finished. It keeps your brand, owner email, domain, the Railway project id, your addresses, timestamps and the install log (with keys removed).
- We have no login to your Railway project, database or any of your provider accounts.
- Your Telnyx, Resend and calendar keys live only in your Railway project.
- We don't receive your calls, call records or client data.
- **Health and usage stats: on by default, off with one switch** (your dashboard, Settings, Support). Every 15 minutes your agency sends us its version, health, counts (clients, receptionists, numbers, calls and bookings over recent days, errors), your brand name and logo address, and yes or no for your optional extras. Never caller names or numbers, messages, transcripts, recordings, customer details, passwords or keys. We keep the latest snapshot and a short history of the counts.
- **Support access: off unless you turn it on.** With it on we can sign in to your dashboard as a read-only support person, through a one-time link (60 seconds, single use), for the time you choose. We can't change anything, see your keys, or export your data. Every sign-in is in your audit log and shown in Settings. Turn it off and any open session ends straight away.

> TODO (Ronan): decide what we keep about the buyer after handover (name, email, payment record, setup date) and say it here.
