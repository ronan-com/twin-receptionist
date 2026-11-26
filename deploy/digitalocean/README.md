# DigitalOcean 1-Click image (backup route)

The main hosting route is Railway. This folder is the backup: a DigitalOcean Marketplace
"Droplet 1-Click App" image. A buyer clicks Create, and the Droplet boots with Docker, the app
image, Postgres and Caddy already on the disk. They finish setup in a browser on the Droplet's
IP, or the settings arrive in user data and it sets itself up with no page at all.

It reuses `deploy/selfhost/` unchanged. The image is that bundle plus pre-built images, and
first boot just runs `install.sh`.

## Files

| Path | What it does |
|---|---|
| `receptionist.pkr.hcl` | Packer template. Builds on Ubuntu 24.04 (`ubuntu-24-04-x64`) using a $6 `s-1vcpu-1gb` build Droplet with no droplet agent, monitoring or IPv6, as DigitalOcean asks. It snapshots as `receptionist-1click-<date>`. |
| `scripts/10-system.sh` | Runs OS updates and installs curl, openssl, ufw and python3. Installs Docker via get.docker.com (the same route install.sh uses). Removes `droplet-agent`, because img_check fails on `/opt/digitalocean`. |
| `scripts/20-app.sh` | Unpacks the bundle into `/opt/receptionist` and builds the app image with a temporary 2 GB swap. Pulls `postgres:16` and `caddy:2.8.4`. Then it removes the throwaway compose settings and fails if any container or volume exists. |
| `scripts/30-oneclick.sh` | Installs the first-boot hook, the setup service and the MOTD. Turns on ufw with 22 (limited), 80 and 443 open. Starts nothing. |
| `scripts/90-cleanup.sh`, `scripts/99-img-check.sh` | DigitalOcean's own scripts from [marketplace-partners](https://github.com/digitalocean/marketplace-partners), unchanged (commit `fb9f872e7ade`, 2026-11-05). Cleanup removes logs, SSH host and root keys, history and cloud-init instance data, then zeroes free space. img_check exits non-zero on any FAIL, which fails the Packer build. |
| `files/firstboot.sh` | Goes in `/var/lib/cloud/scripts/per-instance/01-receptionist-setup`, so cloud-init runs it once per Droplet. It decides between the setup page and installing straight from user data (see below). |
| `files/oneclick.py` | The one-time setup page and the headless installer. Python standard library only (python3 ships with Ubuntu). About 250 lines. |
| `files/receptionist-oneclick.service` | The systemd unit. It is enabled per Droplet, never in the image, and stops for good once `oneclick/done` exists. |
| `files/motd.sh` | Installed as `/etc/update-motd.d/99-one-click`. It shows the setup URL and code, or the app URL, plus the day-to-day commands. |

Nothing secret is in the image. There is no `.env`, no `secrets.env`, and no database or
certificate volume. `install.sh` makes a fresh Postgres password and `MAILBOX_KEY` on each
buyer's first boot.

## First boot

cloud-init runs `firstboot.sh`, which reads the user data
(`/var/lib/cloud/instance/user-data.txt`, or the metadata service):

1. **User data is a complete `.env`** (has `DOMAIN=` and `FIRST_ADMIN_EMAIL=` lines and no
   `#!` or `#cloud-config` header). It is saved as `oneclick/pending.env`, and the service waits
   until `DOMAIN` resolves to this Droplet (for up to 3 days). Then it writes `.env` and runs
   `install.sh`, with up to 3 attempts. No page is ever opened. This is the mode the hosted
   wizard would use.
2. **User data is a script that mentions `/opt/receptionist`** (today's wizard `user_data`). The
   setup page stays off and the wizard's runner does the install as before.
3. **Anything else, including empty user data.** A one-time code is made (or taken from a
   `SETUP_CODE=...` line in user data). The code is printed to the console and
   `cloud-init-output.log`, and the MOTD shows it at SSH login. The page then runs on
   `http://<ip>/`.

The page asks for:

- the code
- brand name (`PRODUCT_NAME`)
- owner email (`FIRST_ADMIN_EMAIL`)
- domain
- Telnyx key, with a box for "every agency brings its own" (`OWN_PHONE_ACCOUNT=required`)
- email: a Resend key (it becomes `SMTP_URL=smtps://resend:<key>@smtp.resend.com:465`), any
  SMTP URL, or "later"
- the from address

After the code is accepted it shows the A record (`domain -> IP`, DNS only) and polls DNS
every 10 seconds. Once DNS points at the Droplet, it shuts the page to free port 80, writes
`/opt/receptionist/.env` (mode 600) and runs `install.sh`. The browser keeps polling
`https://<domain>/api/health` and goes there when it answers. If `install.sh` fails, it stops
Caddy, deletes `.env` and brings the page back with the `INSTALL FAILED` line. On success it
writes `oneclick/done`, deletes the code and disables the service.

Five wrong codes from one IP lock that IP out for a minute. The code has about 50 bits of
randomness. The page is plain http because there is no certificate yet, and it says so. Any
key can be left empty and added to `.env` later (then `sudo bash install.sh`).

**First-boot build time.** `install.sh` always runs `docker compose build app`.
`20-app.sh` unpacks the app exactly as install.sh does, so that build should be a full
BuildKit cache hit (seconds) and nothing is downloaded. **This has not been timed on a real
Droplet.** The cleaner fix belongs in `deploy/selfhost/install.sh`, owned by another agent:
skip the build when `receptionist-app:latest` already has a label matching the `app-src.tgz`
sha256.

## Building the image

```bash
bash deploy/selfhost/make-bundle.sh                      # -> deploy/selfhost/out/selfhost-bundle.tgz
packer init deploy/digitalocean
DIGITALOCEAN_TOKEN=dop_v1_... packer build deploy/digitalocean
# options: -var region=nyc3  -var bundle=/path/bundle.tgz  -var 'snapshot_regions=["syd1","nyc3"]'
```

This takes about 15 to 25 minutes, most of it the Vite build on 1 GB plus swap, and the
secure-erase `dd`. The token needs write scope. The build Droplet costs cents and Packer
deletes it. The snapshot costs $0.06/GB-month while you keep it.

## Testing

Done locally, without spending anything:

- `packer validate` passes (plugin digitalocean v1.4.2) and `packer fmt -check` is clean.
- shellcheck and `bash -n` are clean on all the scripts.
- `oneclick.py` was run with a stand-in `install.sh`. Checked:
  - a wrong code gets 403
  - bad fields get 400 with messages
  - a lowercase code is accepted
  - `.env` is written at mode 600, with quotes and URL-encoding correct
  - the page closes after success, and the hook refuses to run again
  - a failed install brings the page back with the error, and the retry succeeds
  - user data as `.env` installs headless
  - wizard-script user data keeps the page off
  - `SETUP_CODE` from user data works

The full stack has not been run in a container, because the work was cut short when Railway
became the main route.

To test a real image:

1. Create a Droplet from the snapshot (2 GB recommended). Open `http://<ip>/` and enter the
   code from `ssh root@<ip>` (MOTD).
2. Use a throwaway subdomain. Check that `https://<domain>/api/health` returns `{"ok":true}`
   and that `systemctl is-enabled receptionist-oneclick` says `disabled`.
3. Create a second Droplet with a full `.env` as user data and check that it comes up with no
   page.
4. Run `bash /opt/receptionist/install.sh` again to check it is idempotent. Destroy both.

## Submitting to the Marketplace

1. **Vendor application** at <https://marketplace.digitalocean.com/vendors>. You need:
   - a DigitalOcean account and a Team
   - current-year tax forms (W-9 for the US, or W-8BEN-E plus a VAT certificate otherwise)
   - an ACH authorization form, sent to one-clicks-team@digitalocean.com
   ([guidelines](https://marketplace.digitalocean.com/vendors/guidelines-resources))
2. When approved, you get a short listing form and access to the **Vendor Portal**
   ([getting started](https://marketplace.digitalocean.com/vendors/getting-started-as-a-digitalocean-marketplace-vendor)).
   The snapshot must belong to the same Team.
3. Submit the snapshot in the Vendor Portal. DigitalOcean tests it, approves it and lists it.
4. Later updates: build a new snapshot, then either use "Update Marketplace 1-Click App" in
   Backups & Snapshots, or
   `PATCH https://api.digitalocean.com/api/v1/vendor-portal/apps/<app_id>` with `imageId`.
   Apps that are pending or in review can't be updated.

Rules DigitalOcean states:

- a supported OS (Ubuntu 24.04 is on the list)
- cloud-init 0.76 or later, and openssh-server
- the smallest suitable disk and a $6 build Droplet
- no monitoring, IPv6 or private networking on the build Droplet
- cleanup.sh and img_check run with no FAIL
- no passwords set on accounts, no `authorized_keys`, no bash history
- per-instance scripts in `/var/lib/cloud/scripts/per-instance`, and MOTD files in
  `/etc/update-motd.d/99-*`

The listing must say DigitalOcean doesn't build or support the software, and must spell it
"DigitalOcean".

**Deploy link.** `https://marketplace.digitalocean.com/apps/<slug>?action=deploy` opens Create
for signed-in users and the listing for everyone else. The "Deploy to DigitalOcean" button is
for App Platform, not Droplets.

**Private distribution without a public listing.** No unlisted Marketplace option is
documented; ask one-clicks-team. What does exist:

- **Snapshot transfer by email**, through the control panel or
  `POST /v2/images/<id>/account_transfer {"recipient_email": ...}`. The snapshot is *moved, not
  copied*, so each buyer needs a fresh one, and the buyer must accept
  ([docs](https://docs.digitalocean.com/products/snapshots/how-to/transfer/)).
- **Custom image import from a URL** into the buyer's account. This needs a qcow2 or raw file,
  which DigitalOcean can't export from a snapshot, so it would need a separate Packer `qemu`
  build ([limits](https://docs.digitalocean.com/products/custom-images/details/limits/)).

Neither is practical at scale.

**Timeline.** DigitalOcean does not publish one for vendor approval or image review. Honest
estimate:

| Stage | Time |
|---|---|
| Vendor application | days to a few weeks (unstated) |
| Paperwork | your own turnaround |
| Image review | about 3 to 4 days, per [FlowFuse's release notes](https://flowfuse.com/handbook/engineering/releases/digital-ocean/), for an update |
| First listing | probably 2 to 4 weeks end to end |
| Each later update | about 3 to 4 days |

## Draft listing copy

These are the fields DigitalOcean's form normally asks for. The exact form only appears after
vendor approval.

- **App name:** `<Brand> AI Receptionist Platform` (use the real product name, not "Twin")
- **Version / OS:** `<VERSION from bundle>` on Ubuntu 24.04
- **Category:** Business Apps or Communication
- **Software included:**

  | Software | License |
  |---|---|
  | Docker CE | Apache-2.0 |
  | PostgreSQL 16 | PostgreSQL |
  | Caddy 2.8 | Apache-2.0 |
  | Bun 1.4 | MIT |
  | `<App>` | our license |

- **Short description:** Run your own AI phone receptionist agency: branded dashboard,
  AI voice agents that answer, book and take messages for your clients, on your own Droplet.
- **Long description:** `<Brand>` is a white-label platform for agencies that sell AI phone
  receptionists to local businesses. Each client gets a receptionist that answers calls 24/7,
  books appointments into their calendar, takes messages and texts summaries. You manage every
  client, number and call from one dashboard under your own brand and domain. This 1-Click
  Droplet includes the app, its own PostgreSQL database and automatic HTTPS (Let's Encrypt via
  Caddy), with nightly database backups. Your data stays on your Droplet. You bring a Telnyx
  account for phone numbers and an email sender (Resend or any SMTP). Recommended size: 2 GB
  memory. DigitalOcean does not build or support this software; support is provided by
  `<company>` at `<support URL>`.
- **Getting started:**
  1. Create the Droplet. Optionally paste `SETUP_CODE=<your-code>` as user data, or log in
     with SSH to see the code.
  2. Open `http://<droplet-ip>/` and enter the setup code, your brand, owner email, domain,
     Telnyx key and email sender.
  3. Add the DNS A record the page shows (`app.yourdomain.com` to the Droplet IP, not proxied).
     Setup continues by itself and HTTPS is issued automatically.
  4. Open `https://app.yourdomain.com` and create the first account with the owner email.
  5. Files live in `/opt/receptionist` (`README.md`). Keep a copy of
     `/opt/receptionist/secrets.env`. Backups run nightly to `/opt/receptionist/backups`.
- **Support / docs URLs, logo** (SVG or PNG on a transparent background), **minimum size:**
  s-1vcpu-2gb recommended. 1 GB also works, because install.sh adds swap.

## For the hosted wizard (download-site/)

To use this image, the wizard changes one line in `setup.ts` (line ~498): the `image` becomes the
Marketplace slug instead of `ubuntu-24-04-x64` (and the same check in `mock/serve.ts`). Its current `user_data` still works, because
of mode 2 above. It saves the Docker install and image pulls, and mostly the build.

Two optional follow-ups:

- send just the `.env` as user_data (mode 1) and drop the download step, at the cost of the
  wizard's live log
- have `runner.sh` skip the bundle download when `/opt/receptionist/VERSION` already matches

A private snapshot can't be used to create Droplets in a buyer's account. The wizard can only
launch this image once it is a public Marketplace listing.
