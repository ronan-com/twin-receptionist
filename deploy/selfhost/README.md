# Self-hosting on one Ubuntu server

This bundle runs a complete, private copy of the app on a single Ubuntu server (for example a DigitalOcean droplet): the app, its own Postgres database, automatic https, and nightly backups. One script installs it, and the same script updates or repairs it.

## Server size

| | |
|---|---|
| **Recommended** | 2 GB memory, 1 or 2 vCPU, 50 GB disk (DigitalOcean Basic, $12 to $18/month), Ubuntu 22.04 or 24.04 LTS |
| **Minimum** | 1 GB memory. This works because install.sh adds swap, but every install and update rebuilds the app and takes much longer. |

The app image is built on the server. Measured: `bun install` peaks at about 1.1 GB and the Vite build at about 1 GB (it is killed at 768 MB). At runtime the stack is small: idle, the app, Postgres and Caddy together used about 170 MB in testing. On a server with less than 3.5 GB of memory and no swap, install.sh adds a 2 GB swap file at `/swapfile`.

## Installing

1. Point a DNS **A record** for your domain (e.g. `app.example.com`) at the server's public IP. Don't proxy it (Cloudflare "DNS only"), or Let's Encrypt can't issue the certificate.
2. Unpack the bundle into `/opt/receptionist` and write `/opt/receptionist/.env` (mode 600):

   ```
   PRODUCT_NAME=Chloe
   DOMAIN=app.example.com
   FIRST_ADMIN_EMAIL=you@example.com
   TELNYX_API_KEY=KEY...
   OWN_PHONE_ACCOUNT=
   SMTP_URL=smtps://user:pass@smtp.example.com:465
   MAIL_FROM=Chloe <no-reply@example.com>
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   MICROSOFT_CLIENT_ID=
   MICROSOFT_CLIENT_SECRET=
   ```

   One `KEY=value` per line. Values are taken literally: everything after the first `=` (no `#` comments after a value, no `$` expansion). Surrounding quotes are optional and are stripped. Empty values are treated as unset. Any other setting the app understands (e.g. `ALLOW_SIGNUP=true`, `SELF_SIGNUP=off`) can be added the same way.
3. Run `sudo bash /opt/receptionist/install.sh`. The last line is `INSTALL OK https://<DOMAIN>`, or `INSTALL FAILED: <reason>` with a non-zero exit.
4. Open `https://<DOMAIN>` and create the first account with the `FIRST_ADMIN_EMAIL` address. It becomes the platform admin. Nobody else can create the first account.

### The settings

| Setting | |
|---|---|
| `PRODUCT_NAME` | The name shown everywhere (page title, emails, screens). Empty means "AI Receptionist". |
| `DOMAIN` | The host name only, no `https://`. `PUBLIC_URL` becomes `https://<DOMAIN>`. |
| `FIRST_ADMIN_EMAIL` | The only email that can create the first (platform admin) account. |
| `TELNYX_API_KEY` | Your Telnyx key. Agencies without their own key use it. |
| `OWN_PHONE_ACCOUNT` | `required` makes every agency paste its own Telnyx key. Empty means agencies use yours. |
| `SMTP_URL`, `MAIL_FROM` | Outgoing email (invites, password resets, booking emails). Without them, emails only go to the app log. |
| `GOOGLE_*`, `MICROSOFT_*` | Optional one-click calendar and mailbox sign-in. Add `https://<DOMAIN>/api/oauth/google/callback` (or `/microsoft/callback`) as a redirect URI in the provider's console. |

To change a setting, edit `.env` and run `sudo bash install.sh` again.

## What install.sh does

Every step is safe to repeat:

1. Checks `.env` (`DOMAIN` and `FIRST_ADMIN_EMAIL` are required).
2. Installs curl, openssl and ufw if they are missing. Adds swap on small servers. Turns on the firewall (ufw) with only 22/tcp, 80/tcp, 443/tcp and 443/udp open.
3. Installs Docker with the official script (get.docker.com) if Docker isn't there.
4. On the first run only, creates `secrets.env` with a random `POSTGRES_PASSWORD` and `MAILBOX_KEY`. These are never made again. If `secrets.env` is missing but a database already exists, it stops rather than lock the app out of its data.
5. Unpacks `app-src.tgz` fresh into `app/` and writes the container settings into `run/`.
6. Backs up the database if the app is already installed (`backups/pre-update-*.dump`), then builds the app image. The build log is in `run/build.log`.
7. Starts Postgres and the app, then waits for both to be healthy. Database migrations run when the app starts.
8. Installs the nightly backup timer.
9. Checks that `DOMAIN` resolves to this server. If it doesn't, it stops with a clear message, and the app and database are left running. Fix the DNS and run it again. `SKIP_DNS_CHECK=1` skips this check, for example behind a proxy you set up on purpose.
10. Starts Caddy and waits (up to 10 minutes) until `https://<DOMAIN>/api/health` answers with a valid certificate.

## What runs

| Container | Image | Ports | Data |
|---|---|---|---|
| `caddy` | caddy:2.8.4 | 80 and 443 (public). Gets and renews Let's Encrypt certificates and redirects http to https. | volume `receptionist_caddy-data` (certificates) |
| `app` | built here (`receptionist-app`) | 8791, inside the stack only | volume `receptionist_app-data` (legacy files only) |
| `db` | postgres:16 | 5432, inside the stack only. Never published. | volume `receptionist_db-data` |

Docker publishes only Caddy's ports. Note that Docker's published ports bypass ufw, so keep anything you publish yourself off the public interface.

### Files in /opt/receptionist

| Path | |
|---|---|
| `.env` | Your settings (written by the installer, mode 600) |
| `secrets.env` | `POSTGRES_PASSWORD` and `MAILBOX_KEY` (mode 600). **Keep a copy somewhere else.** `MAILBOX_KEY` encrypts the saved mailbox and calendar logins, so a backup restored with a different key loses those logins. |
| `run/` | Generated on every install (`app.env`, `compose.env`, `build.log`). Don't edit these. |
| `backups/` | Database dumps (mode 700) |
| `app/`, `app-src.tgz`, `VERSION` | The app source and the version this bundle was built from |
| `install.sh`, `update.sh`, `backup.sh`, `restore.sh`, `dc.sh`, `compose.yml`, `caddy/Caddyfile` | The scripts and stack definition |

## Day to day

```bash
cd /opt/receptionist
sudo ./dc.sh ps                 # what is running
sudo ./dc.sh logs -f app        # app log (emails also appear here when SMTP_URL is empty)
sudo ./dc.sh restart app
```

Always go through `dc.sh` (or install.sh). Running plain `docker compose` here would not pick up the generated settings.

## Backups

- `receptionist-backup.timer` runs `backup.sh` every night at about 03:30 server time (`systemctl list-timers receptionist-backup.timer`, logs in `journalctl -u receptionist-backup`).
- It writes `backups/receptionist-YYYYmmdd-HHMMSS.dump` (pg_dump custom format) and deletes dumps older than 14 days. Pre-update and pre-restore dumps follow the same rule.
- To take a backup now, run `sudo bash backup.sh`.
- Backups stay on the same server. Copy them off it regularly, together with `secrets.env`, for example with `rsync` or a DigitalOcean droplet backup.

## Restoring

```bash
sudo bash /opt/receptionist/restore.sh /opt/receptionist/backups/receptionist-20261126-033000.dump
```

It asks you to type `restore` (or pass `--yes`), takes a `pre-restore-*.dump` safety backup, stops the app, recreates the database from the file, and starts the app again.

To move to a new server: install there with the same `.env`, stop, copy the old `secrets.env` over the new one, then `docker volume rm receptionist_db-data` and run install.sh again, so Postgres is created with the old password. Then run restore.sh with the copied dump.

## Updating

With a new bundle:

```bash
sudo bash /opt/receptionist/update.sh /path/to/selfhost-bundle.tgz
```

This unpacks the bundle over the scripts and `app-src.tgz`, then runs install.sh. `.env`, `secrets.env`, `backups/` and the Docker volumes are untouched, and the database is backed up before the rebuild. Unpacking the new bundle into `/opt/receptionist` yourself and running install.sh does the same thing. `sudo bash update.sh` with no bundle rebuilds and repairs from the files already there.

## Uninstalling

```bash
cd /opt/receptionist
sudo ./dc.sh down               # stop; data volumes are kept
sudo ./dc.sh down -v            # stop AND delete the database, certificates and app data
sudo systemctl disable --now receptionist-backup.timer
sudo rm /etc/systemd/system/receptionist-backup.{service,timer}
sudo docker image rm receptionist-app:latest
sudo rm -rf /opt/receptionist   # includes backups/ and secrets.env: copy them first
```

Docker, ufw and the swap file stay installed. Remove them separately if you want.

## Testing the bundle locally

`bash deploy/selfhost/test-local.sh` (from the repo, no root and no cloud needed) builds the bundle and runs install.sh in a scratch folder in test mode. Test mode uses Caddy's internal CA on `127.0.0.1:18080/18443`, the compose project `rtest`, and skips the root, apt, firewall, timer and DNS steps. The test then checks health, the page title, backup and restore, and update, and removes everything afterwards. The test-only variables (`SELFHOST_TEST`, `SELFHOST_PROJECT`, `HTTP_PORT`, `HTTPS_PORT`, `CADDY_TLS`) must never be set on a real server.
