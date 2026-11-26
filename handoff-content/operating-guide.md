# Running {{brand}} day to day

Most days you won't need to touch anything. This guide covers backups, logs, settings, updates, what it costs, and what to do when something stops.

Your agency runs in one project in your Railway account, with two services: **the app** (your dashboard) and **Postgres** (your database). Everything below is done in the Railway dashboard. There's no server to log in to.

---

## Backups

**Turn them on once.** Railway doesn't back up your database until you ask it to.

1. In Railway, open your project and click the **Postgres** service.
2. Open its **Backups** tab and pick a schedule. You can pick more than one:
   - Daily: every 24 hours, kept for 6 days
   - Weekly: every 7 days, kept for 27 days
   - Monthly: every 30 days, kept for 89 days
3. You can also make a backup by hand from the same tab, for example before a big change.

Backups are billed like volume storage, for the space they add. See "What it costs" below.

> TODO (Ronan): Railway's docs don't say which plans get volume backups, and Railway staff have said backups went to Pro first. Check the Backups tab on a real Hobby account. If it's locked, say here what Hobby buyers should do (move to Pro, or another backup route we give them).

**Restore a backup**
1. On the Postgres service's **Backups** tab, find the backup by its date and click **Restore**.
2. Railway mounts a new volume from that backup in place of the current one. The old volume is kept, unmounted.
3. Click **Details** at the top of the project to review the change, then **Deploy**.

Everything since that backup is lost, so pick the most recent good one.

**Watch out for**
- Wiping a volume deletes all of its backups.
- Backups can only be restored into the same project and environment.
- Manual backups are limited to half the volume's size.
- Keep a copy of `MAILBOX_KEY` (from the app's **Variables** tab) in your password manager. It unlocks saved mailbox and calendar logins.

---

## Logs

- **The app's log:** open the app service, click the latest deployment, and read its logs. The **Build Logs** tab shows the last build.
- **Everything at once:** click **Observability** in the top bar for the Log Explorer.
- Railway keeps logs for 7 days on the Hobby plan (30 on Pro).

If email isn't working, sign-in and reset links are written to the app's log instead of being sent.

---

## Changing a setting

Your settings are on the app service's **Variables** tab: `PRODUCT_NAME` (your brand name), `PUBLIC_URL`, `FIRST_ADMIN_EMAIL`, `TELNYX_API_KEY`, `SMTP_URL`, `MAIL_FROM`, `MAILBOX_KEY`, and the Google and Microsoft keys if you set them.

1. Edit the value on the **Variables** tab.
2. Railway stages the change. Review it and deploy it, and the app restarts with the new value.

Don't change `MAILBOX_KEY` or `DATABASE_URL`. Changing `MAILBOX_KEY` loses saved mailbox and calendar logins.

Email and calendar settings can also be changed in the dashboard under **Settings → Email and calendars**, with nothing to do in Railway. What you save there replaces the variable.

---

## Updates

> TODO (Ronan): update policy and delivery aren't decided. Decide and fill in: whether updates are included and for how long, how buyers hear about them, and how a new version reaches their Railway project (for example a new private setup link that sends the update, or steps they follow). We keep no access, so we can't push it ourselves.

---

## Keeping an eye on things

**Hosting (Railway)**
- Open the **Usage** page ([railway.com/workspace/usage](https://railway.com/workspace/usage)) now and then to see what you're spending.
- Click **Set Usage Limits** there and add a **Custom email alert**, so you hear before a bill grows. A **Hard limit** takes everything offline when it's reached, receptionists included, so use it with care.
- Add an uptime check for `https://app.{{domain}}/api/health` with any uptime service, so you hear if the site goes down. Railway restarts the app if it crashes.

**Phone credit (Telnyx)**
- Turn on **Auto Recharge** in Telnyx Billing. If credit runs out, every client's receptionist stops answering until you top up.
- In your dashboard, **Overview → Needs attention** shows failed calls and other problems. **System / QA** lists background problems.

**Email (Resend)**
- In Resend, check **Emails** now and then for bounced or complained messages. Lots of bounces usually means a wrong client email address.
- If Resend shows your domain as not verified, the DNS records have changed. Put them back.

**Domain**
- Keep auto-renew on and your card current at the registrar.
- Don't delete the CNAME and TXT records for `app.{{domain}}`. Railway needs both.

---

## What it costs each month

All billed to you directly by each provider. Prices checked 26 November 2026, in US dollars. Always check current pricing.

| Provider | What you pay for | Typical | Current pricing |
|---|---|---|---|
| Railway | Hosting the app and its database | Hobby plan: US$5 a month, which includes US$5 of usage. Above that: RAM US$10 per GB a month, CPU US$20 per vCPU a month, storage US$0.15 per GB a month, outbound traffic US$0.05 per GB. Backups are charged like storage. | https://railway.com/pricing |
| Telnyx | Phone numbers (monthly each), call minutes, the AI voice, and texts, for all your clients | Depends on numbers and call volume. The dashboard shows each number's monthly price before you buy. Minimum top-up is US$10. | https://telnyx.com/pricing |
| Resend | Sending emails | Free plan: 3,000 emails a month, 100 a day. Pro: US$20/month for 50,000. | https://resend.com/pricing |
| Cloudflare | DNS (only if the wizard handles it) | Free plan covers it | https://www.cloudflare.com/plans/ |
| Domain registrar | Your domain | Yearly, varies by registrar and domain ending | Your registrar |
| Google / Microsoft | Calendar sign-in apps | Check current pricing | https://cloud.google.com/pricing · https://azure.microsoft.com/pricing/ |

> TODO (Ronan): add a typical Railway month (app + Postgres, quiet and busy) once measured.

---

## If calls stop

Work down this list. Most problems are the first two.

1. **Telnyx credit.** Sign in to Telnyx → Billing. No credit, no calls. Top up and turn on Auto Recharge.
2. **Telnyx account level.** Profile → Account Level should say **Paid**. A trial account blocks real callers. A changed card or failed payment can also hold the account.
3. **The number.** Open the client's page in the dashboard. The number should be listed under **Phone number**. In Telnyx, check the number is active and not still waiting for approval (Australian numbers take about three days).
4. **The receptionist is paused.** On the client's page, a paused receptionist shows **Paused**. Click **Resume**.
5. **The key.** If the Telnyx key was deleted, make a new one in the same Telnyx account and put it in `TELNYX_API_KEY` on the app's **Variables** tab.
6. **The app.** Open `https://app.{{domain}}/api/health`. If it doesn't answer, open the app service in Railway and check the latest deployment and its logs. Check Railway hasn't stopped it for a usage limit or a failed payment.

Callers hear a Telnyx automated-call notice first? Telnyx may play it on accounts that aren't fully verified. Completing Telnyx's Verified level removes it.

---

## Troubleshooting

| Problem | Likely cause | What to do |
|---|---|---|
| Dashboard won't load | App stopped, a usage limit was hit, or a payment failed | In Railway, check the app service's latest deployment and its logs, and your **Usage** page |
| "Not secure" or certificate error | The CNAME or TXT record for `app.{{domain}}` changed, or it's proxied | Check both records still match the app service's custom domain in Railway, with DNS only (no Cloudflare proxy) |
| Nobody gets invite or reset emails | Email not set, or Resend domain unverified | **Settings → Email and calendars → Send test email**. Check the domain in Resend. Until fixed, emails are written to the app's log |
| Locked out of the owner account | Forgotten password and email not working | Request a reset, then find the reset link in the app's log in Railway |
| Calendar sign-in fails | Redirect URI missing, or secret expired | Add the redirect URI shown in **Settings → Email and calendars** to Google or Microsoft. Paste a new secret and click **Check** |
| Can't buy a number | No credit, or none available | Top up Telnyx. Try the other number type |
| Number bought but not ringing | Telnyx still approving it | Wait for approval (Australian numbers about three days). Check it in Telnyx |
| Database full | The Postgres volume reached its size (5 GB on Hobby) | Resize the volume in Railway (Hobby and Pro can resize) |
| Restored, but calendar logins gone | `MAILBOX_KEY` was changed | Put back the `MAILBOX_KEY` from your password manager, or have clients reconnect calendars |

> TODO (Ronan): decide what support we offer after handover (none, email for N days, paid). Add the contact line here once decided.
