# Running {{product}} day to day

Most days you won't need to touch the server. This guide covers backups, updates, keeping an eye on things, what it costs, and what to do when something stops.

Commands below run on your server. Sign in with the SSH key from the wizard:

```bash
ssh -i path/to/your-server-key root@{{server_ip}}
cd /opt/receptionist
```

Always use `dc.sh` or `install.sh` in that folder. Plain `docker compose` won't pick up your settings.

```bash
sudo ./dc.sh ps                 # what's running
sudo ./dc.sh logs -f app        # the app log
sudo ./dc.sh restart app        # restart the app
```

---

## Backups

**What happens on its own**
- Every night at about 03:30 server time, the server saves a full copy of the database to `/opt/receptionist/backups/receptionist-YYYYmmdd-HHMMSS.dump`.
- A backup is also taken before every update (`pre-update-*.dump`) and every restore (`pre-restore-*.dump`).
- Backups older than 14 days are deleted.

**Check it's working**
```bash
systemctl list-timers receptionist-backup.timer
journalctl -u receptionist-backup
ls -lh /opt/receptionist/backups
```

**Take one now**
```bash
sudo bash /opt/receptionist/backup.sh
```

**Copy them off the server.** Backups live on the same server. If the server is lost, so are they. Do at least one of these:
- Turn on **Backups** for the droplet in DigitalOcean (weekly or daily). This copies the whole server.
- Copy `backups/` and `secrets.env` to another computer or storage regularly, for example with `rsync` or `scp`.

Always keep a copy of `secrets.env` with your backups. It holds the database password and `MAILBOX_KEY`. A backup restored without the matching `MAILBOX_KEY` loses saved mailbox and calendar logins.

**Restore a backup**
```bash
sudo bash /opt/receptionist/restore.sh /opt/receptionist/backups/receptionist-20261126-033000.dump
```
It asks you to type `restore`. It takes a safety backup first, stops the app, rebuilds the database from the file, and starts the app again. Everything since that backup is lost, so pick the most recent good one.

**Move to a new server**
1. Make a new droplet and install there with the same `.env`.
2. Stop it, copy the old `secrets.env` over the new one, then run `docker volume rm receptionist_db-data` and `sudo bash install.sh` again, so the database is made with the old password.
3. Copy your latest dump across and run `restore.sh` with it.
4. Point `app.{{domain}}` at the new server's IP.

---

## Changing a server setting

Your settings are in `/opt/receptionist/.env` (product name, domain, owner email, Telnyx key, whether agencies bring their own Telnyx account, email and calendar settings).

1. Edit `.env`. One `KEY=value` per line, no comments after a value.
2. Run `sudo bash /opt/receptionist/install.sh`. It backs up the database, rebuilds and restarts. It's safe to run any time.

Email and calendar settings can also be changed in the dashboard under **Settings → Email and calendars**, with no server work. What you save there replaces the `.env` value.

---

## Updates

**How you install one.** An update is a new bundle file. On the server:
```bash
sudo bash /opt/receptionist/update.sh /path/to/selfhost-bundle.tgz
```
It replaces the app and scripts, backs up the database, then rebuilds. Your `.env`, `secrets.env`, backups and data are left alone. Expect a few minutes of downtime while it rebuilds (longer on a 1 GB server).

`sudo bash update.sh` with no file rebuilds and repairs from what's already there. Try this first if the app won't start.

> TODO (Ronan): update policy isn't decided. Decide and fill in: whether updates are included and for how long, how buyers hear about them (email list?), where they download the bundle (their private link on our site?), and whether we ever offer to apply them (which would mean asking for access).

---

## Keeping an eye on things

**Server (DigitalOcean)**
- Open your droplet → **Monitoring**. If graphs are empty, follow DigitalOcean's prompt to install the metrics agent.
- Create alert policies for CPU, memory and disk (for example, disk over 80%). DigitalOcean emails you.
- Add an **Uptime** check for `https://app.{{domain}}/api/health` so you hear if the site goes down.

**Phone credit (Telnyx)**
- Turn on **Auto Recharge** in Telnyx Billing. If credit runs out, receptionists stop answering until you top up.
- Agencies on their own Telnyx account see their credit on **Connections**, with a warning below US$5.
- In your dashboard, **Overview → Needs attention** shows failed calls, number requests waiting and agencies with no phone account. **System / QA** lists background problems.

**Email (Resend)**
- In Resend, check **Emails** now and then for bounced or complained messages. Lots of bounces usually means a wrong client email address.
- If Resend shows your domain as not verified, the DNS records have changed. Put them back.

**Domain**
- Keep auto-renew on and your card current at the registrar.

---

## What it costs each month

All billed to you directly by each provider. Prices checked 26 November 2026, in US dollars. Always check current pricing.

| Provider | What you pay for | Typical | Current pricing |
|---|---|---|---|
| DigitalOcean | One server | Basic droplet: US$12/month for 2 GB (recommended), US$6 for 1 GB, US$24 for 4 GB. Droplet backups add 20% (weekly) or 30% (daily). | https://www.digitalocean.com/pricing/droplets |
| Telnyx | Phone numbers (monthly each), call minutes, the AI voice, and texts | Depends on numbers and call volume. The dashboard shows each number's monthly price before you buy. Minimum top-up is US$10. | https://telnyx.com/pricing |
| Resend | Sending emails | Free plan: 3,000 emails a month, 100 a day. Pro: US$20/month for 50,000. | https://resend.com/pricing |
| Cloudflare | DNS (only if the wizard handles it) | Free plan covers it | https://www.cloudflare.com/plans/ |
| Domain registrar | Your domain | Yearly, varies by registrar and domain ending | Your registrar |
| Google / Microsoft | Calendar sign-in apps | Check current pricing | https://cloud.google.com/pricing · https://azure.microsoft.com/pricing/ |

If agencies bring their own Telnyx account, they pay for their own numbers and calls.

---

## If calls stop

Work down this list. Most problems are the first two.

1. **Telnyx credit.** Sign in to Telnyx → Billing. No credit, no calls. Top up and turn on Auto Recharge.
2. **Telnyx account level.** Profile → Account Level should say **Paid**. A trial account blocks real callers. A changed card or failed payment can also hold the account.
3. **The number.** Open the client's page in the dashboard. The number should be listed under **Phone number**. In Telnyx, check the number is active and not still waiting for approval (Australian numbers take about three days).
4. **The receptionist is paused.** On the client's page, a paused receptionist shows **Paused**. Click **Resume**.
5. **The key.** For agencies on their own Telnyx account, **Connections** shows "Telnyx isn't accepting your key" if the key was deleted. Use **Replace key** with a key from the same Telnyx account.
6. **The server.** Open `https://app.{{domain}}/api/health`. If it doesn't answer, check the droplet is on in DigitalOcean, then run `sudo ./dc.sh ps` and `sudo bash update.sh` on the server.

Callers hear a Telnyx automated-call notice first? Telnyx may play it on accounts that aren't fully verified. Completing Telnyx's Verified level removes it.

---

## Troubleshooting

| Problem | Likely cause | What to do |
|---|---|---|
| Dashboard won't load | Server off, or the app stopped | Check the droplet in DigitalOcean. On the server: `sudo ./dc.sh ps`, then `sudo bash update.sh` |
| "Not secure" or certificate error | `app.{{domain}}` no longer points at the server, or it's proxied | Check the A record points at `{{server_ip}}`, DNS only (no Cloudflare proxy), then run `sudo bash install.sh` |
| Nobody gets invite or reset emails | Email not set, or Resend domain unverified | **Settings → Email and calendars → Send test email**. Check the domain in Resend. Until fixed, emails are written to the app log |
| Locked out of the owner account | Forgotten password and email not working | On the server: `sudo ./dc.sh logs app` and look for the reset link after requesting one |
| Calendar sign-in fails | Redirect URI missing, or secret expired | Add the redirect URI shown in **Settings → Email and calendars** to Google or Microsoft. Paste a new secret and click **Check** |
| Can't buy a number | No credit, or none available | Top up Telnyx. Try the other number type |
| Number bought but not ringing | Telnyx still approving it | Wait for approval (Australian numbers about three days). Check it in Telnyx |
| Disk full | Old files or large logs | `df -h` on the server. Resize the droplet in DigitalOcean if needed |
| Update failed | Build ran out of memory, or a network blip | Run `sudo bash update.sh` again. On a 1 GB server, consider resizing to 2 GB. The log is in `run/build.log` |
| Restored, but calendar logins gone | Restored with a different `MAILBOX_KEY` | Put back the `secrets.env` that matches the backup and restore again, or have clients reconnect calendars |

> TODO (Ronan): decide what support we offer after handover (none, email for N days, paid). Add the contact line here once decided.
