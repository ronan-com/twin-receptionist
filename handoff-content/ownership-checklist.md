# What you own

Everything that runs {{product}} sits in accounts in your name. Use this page to check each one, tidy up after setup, and make sure you can always get back in.

## Your accounts

| What | Where it lives | What it does | You pay |
|---|---|---|---|
| Domain `{{domain}}` | Your registrar (and Cloudflare, if you chose "Let the wizard handle DNS") | Your web address. `app.{{domain}}` points at your server. Resend's email records sit here too. | Your registrar, yearly |
| Server | Your DigitalOcean account, in the location you picked | Runs the dashboard, its database and the backups | DigitalOcean, monthly |
| Phone account | Your Telnyx account | Your numbers, call minutes and receptionists. You see every call and charge in the Telnyx portal. | Telnyx, from prepaid credit |
| Email sending | Your Resend account | Invites, password resets and booking emails from `{{domain}}` | Resend (free plan available) |
| Calendar apps (optional) | Your Google Cloud project and/or Microsoft Entra app registration | One-click calendar sign-in for your clients | Usually nothing |
| Dashboard owner login | `https://app.{{domain}}`, the owner email you chose | Full control of every agency, client and setting | Nothing |

## Your server and data

On the server, everything is in `/opt/receptionist`:

| Path | What it is |
|---|---|
| `.env` | Your settings: product name, domain, owner email, Telnyx key, email and calendar settings (readable by root only) |
| `secrets.env` | The database password and `MAILBOX_KEY`, made on the first install (root only). **Keep a copy off the server.** `MAILBOX_KEY` unlocks saved mailbox and calendar logins. Restore a backup without it and those logins are lost. |
| `backups/` | Database backups: one every night at about 03:30 server time, kept for 14 days, plus one before every update and restore |

The database is Postgres 16, running on the same server. It's never open to the internet. Your call records, clients, bookings and follow-ups are stored there.

**Backups stay on the server.** If the server is lost, so are they. Copy `backups/` and `secrets.env` somewhere else regularly, or turn on DigitalOcean's droplet backups. See the operating guide.

## Tidy up after setup

Delete these. You don't need them again: the wizard is finished.

- [ ] **DigitalOcean:** API → Tokens. Delete the token named `setup`. (If you ever rerun the wizard, make a new one.)
- [ ] **Cloudflare** (only if the wizard handled DNS): My Profile → API Tokens. Delete the token you made for setup.

Keep these, but save them in your password manager. The dashboard uses them to run:

- [ ] **Telnyx API key.** Rotate it if it was ever pasted anywhere else: create a new one in Telnyx, paste it into the server settings (see the operating guide), then delete the old one. Use a key from the same Telnyx account: your receptionists live in that account.
- [ ] **Resend API key.** Same idea: make a new one with Sending access, update the mail server address in **Settings → Email and calendars** (`smtps://resend:NEW_KEY@smtp.resend.com:465`), click **Send test email**, then delete the old one in Resend.
- [ ] **Google / Microsoft client secrets** (if set). Change them in **Settings → Email and calendars**.
- [ ] **Server SSH key** you downloaded on the last screen. It's the only way into the server's command line.

Lost the SSH key? In DigitalOcean, open the droplet's **Access** tab and use the web console, or add a new SSH key to the droplet.

## Make sure you can always get back in

Do this once for **each** account: registrar, Cloudflare, DigitalOcean, Telnyx, Resend, Google, Microsoft.

1. **Turn on two-step sign-in** (2FA). Telnyx makes you do this when you upgrade. Do it everywhere else too.
2. **Save the recovery codes** each provider gives you. Store them in your password manager, and keep a printed copy somewhere safe.
3. **Use a work email you'll keep** for every account, not a personal one. If you have staff, think about a shared admin mailbox.
4. **Keep your card current** at DigitalOcean, Telnyx and your registrar. An expired card is the most common way a service stops.
5. **Turn on domain auto-renew** at your registrar. If the domain lapses, the dashboard, email and calendar sign-in all stop.

**Your dashboard login:** the dashboard has no two-step sign-in of its own, so use a long, unique password. Password reset works by email. If email isn't working, the reset link is written to the app log on the server instead (`sudo ./dc.sh logs app` in `/opt/receptionist`).

## What we keep

Nothing that gives us access.

- We have no login to your dashboard, server, database or any of your provider accounts.
- Your Telnyx, Resend and calendar keys live on your server only.
- We don't receive your calls, call records or client data.

> TODO (Ronan): confirm against the wizard code what our setup site stores while it runs (tokens, keys, the server SSH key, progress), and that it's all deleted when the buyer reaches Done. Then replace this note with a plain statement, e.g. "Our setup site deleted its copy of your tokens, keys and server key when you finished. We keep your name, email and the date you set up."

> TODO (Ronan): decide what we keep about the buyer after handover (name, email, payment record, setup date) and say it here.
