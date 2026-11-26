> **Superseded.** Buyers no longer run anything locally: the hosted setup wizard in
> `download-site/` (see its README) does all of this from our site, provisioning the server with
> DigitalOcean user_data instead of SSH. This folder is kept for reference only and isn't
> shipped or used.

# Receptionist Setup (the installer)

A small web app the buyer runs on their own computer with Docker. It opens a
setup page at http://localhost:4400, checks each of their accounts, then
creates a server in **their** DigitalOcean account and installs the
receptionist on it. Once it's done, their computer isn't needed.

## For buyers

1. Install **Docker Desktop** (https://www.docker.com/products/docker-desktop/) and open it.
2. Unzip the setup folder and start it:
   - **Mac:** double-click `start.command` (first time: right-click → Open).
   - **Windows:** double-click `start.bat`.
   - **Linux:** `bash start.sh`
3. Your browser opens the setup page. Follow it step by step.

Have these ready (the page shows exactly where to click for each):
a DigitalOcean account with a payment method, a Telnyx account, an email
sending service (Resend, Postmark, SendGrid, Gmail, Microsoft 365, …), a
domain you can add DNS records to, and optionally Google / Microsoft
calendar app keys.

Closed the tab or restarted your computer? Run the start file again; it picks
up where you left off. When you're finished: `docker stop receptionist-setup`.
To remove the saved progress too: `docker volume rm receptionist-setup-data`.

## What it does

| Step | What the Check button really does |
|---|---|
| Brand | Product name, owner email (`FIRST_ADMIN_EMAIL`), and whether agencies bring their own Telnyx key (`OWN_PHONE_ACCOUNT=required`). Format checks only. |
| Web address | Normalises and validates the host name (`DOMAIN`). |
| DigitalOcean | `GET /v2/account` (token valid, account active, email verified, droplet limit > 0), then `/v2/regions` and `/v2/sizes` for the location list and monthly prices. Defaults: `syd1`, `s-2vcpu-4gb`. |
| Telnyx | `GET https://api.telnyx.com/v2/balance`; shows available credit. Warns that trial accounts must be upgraded before the public can call. |
| Email | `nodemailer.verify()` (connects and signs in), optional test email to the owner. Builds `SMTP_URL` from server/port/user/password (port 465 → `smtps://`). |
| Calendars (optional) | Shows the redirect URIs `https://<DOMAIN>/api/oauth/google/callback` and `…/microsoft/callback` (from `server/oauth.ts`). Checks the id/secret pair by asking the provider's token endpoint to redeem a made-up code: a bad pair fails with `invalid_client`, a good one fails later with `invalid_grant`. Nothing is created. |
| Create server | Makes an ed25519 key, `POST /v2/account/keys`, `POST /v2/droplets` (image `ubuntu-24-04-x64`, tag `receptionist`), waits for `active` and for SSH to answer. |
| Point your domain | Shows the exact A record, then polls 1.1.1.1 / 8.8.8.8 until the domain resolves to the server. "Install anyway" is allowed. |
| Install | Uploads the bundle to `/opt/receptionist/`, unpacks it, writes `.env` (mode 600, piped over SSH so secrets never appear in a command line), runs `sudo bash /opt/receptionist/install.sh` **detached on the server** (a dropped connection or closed laptop doesn't stop it), and streams its log into the page. `INSTALL OK <url>` / `INSTALL FAILED: <reason>` decide the result. On failure: **Try install again** (same server) or **Delete the server**. |
| Done | Link, "sign in with <owner email>", server SSH key download, reminder to delete the DigitalOcean token. The installer's own copy of the token is deleted here. "Erase everything" wipes the rest. |

Saved progress lives in the `/state` volume (`installer-state.json`, the
install log and the server key, all mode 600). Secrets are never printed;
anything shown from the server is scrubbed of them first.

Safety: the page only binds to 127.0.0.1 (via `-p 127.0.0.1:4400:4400`),
rejects requests whose Host isn't localhost (DNS rebinding), and every write
needs an `X-Installer: 1` header (so other websites can't post to it).

## For us: building it

```bash
bash installer/build.sh          # make-bundle.sh, then docker image receptionist-installer:latest
bash installer/build.sh --save   # also installer/out/: image tarball + start scripts, ready to zip
```

The start scripts load `receptionist-installer-image.tar.gz` if it sits next
to them, otherwise `docker pull $IMAGE` (set `IMAGE` to use a registry).

Run without Docker while developing: `cd installer && bun install && STATE_DIR=./.state-dev bun src/server.ts`.

## Test mode (no cloud, no money)

`MOCK_DO=1` starts a fake DigitalOcean API on 127.0.0.1:4401 (token
`mock-do-token-for-tests`) whose "droplets" are local Docker containers built
from `mock-droplet/` (Ubuntu 24.04 + sshd, root key login like a real
droplet), plus a fake SMTP server on 127.0.0.1:4402 (`test` / `test-pass`).
The SSH, upload, unpack and `.env` steps run for real against the container.
`install.sh` itself needs Docker inside the server, so in test mode only its
final run is replaced by a stand-in that checks the unpacked bundle, `.env`
permissions, that `.env` parses with the bundle's own `read_env`, and prints
`INSTALL OK`. Other test switches: `MOCK_OAUTH=1` (calendar checks don't call
Google/Microsoft), `MOCK_FAIL_FIRST_INSTALL=1`, and the Telnyx key
`KEY_TEST_MODE_ACCEPT` is accepted without calling Telnyx (test mode only).

```bash
cd installer && bun install && bun test/e2e.ts   # needs /snap/bin/chromium; screenshots -> test-shots/
```

Mock mode runs on the host (it needs the docker CLI); the image itself is the
real-mode build.
