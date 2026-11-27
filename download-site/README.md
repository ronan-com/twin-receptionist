# Setup site (hosted wizard)

The one thing we host for the packaged AI receptionist agency. A buyer (the agency) opens their
private link, connects their own accounts, clicks **Install**, and the wizard sets their agency
up in **their** accounts. Nothing to download and nothing to run on the buyer's computer. After
a successful install we delete every key they gave us and have no login to their accounts. Their
app sends us a health heartbeat (counts only; on by default, the buyer can switch it off) and we can
"View as" them only while the buyer has switched on Support access in their app (sync.ts).

Hosting is **Railway** only: the agency and its Postgres run in the buyer's own Railway
project. No server to look after. (A buyer who wants a plain server of their own uses
`deploy/selfhost/`, outside this site.)

One Bun process + SQLite (`bun:sqlite`), behind Caddy. Many buyers at once: all wizard state is
per buyer in SQLite, and background work runs from a ticker that picks up again after a restart.
A closed tab loses nothing. We manage buyers at **/admin** (or with `admin.ts`).

```
server.ts          routes, CSRF + same-origin check, rate limits, security headers, startup guards
setup.ts           the wizard engine: actions, background ticker, the Railway install
wizard.ts          the wizard screens (same look as the app's own Setup wizard)
admin-web.ts       /admin: our buyers dashboard (sign-in, list, add, per-buyer view and actions)
store.ts           per-buyer state, encrypted secrets vault, install log, tokens, CSRF tokens
providers.ts       Railway, Cloudflare, Telnyx, Resend, SMTP, Google/Microsoft, public DNS
content.ts         loads the how-tos (handoff-content/providers/*.md) and the welcome email
pages.ts           /, /guide, error pages
chat.ts           the Need help? chat: bubble HTML, what the model is told, OpenRouter call (public/chat.js, chat.css)
lib.ts             settings, database, buyer codes, bundles, production guard
admin.ts           command-line admin
public/            wizard.css + Inter fonts, wizard.js, styles.css (/, /guide), favicon
mock/serve.ts      TEST ONLY: fake Railway, Cloudflare, Resend, SMTP and DNS
test/              end-to-end tests (puppeteer), see below
deploy/            compose.yml + Caddyfile + .env.example for our small server
```

## The buyer's path (Railway)

`/setup/<code>` (old `/download/<code>` links redirect there). One screen per step; how-tos sit
behind **Step-by-step guide** (from `handoff-content/providers/<id>.md`), which opens a side panel: numbered steps, a Copy button on anything to paste, and a **Common problems** list with each fix. Facts are researched from the provider's own pages; update the `checked:` date when you re-check one. The same files feed the /guide page and the AI helper's prompt (`guides.ts`), so they never disagree. The helper card has a remembered **Hide** button.

**Only Railway and Telnyx are required.** Email (Resend), the buyer's own domain and calendars are
optional: one **Optional extras** screen sits between Telnyx and Install, with a card for each
(**Add now** / **Skip for now**) and **Skip all and continue**. The agency is live at Railway's own
`https://<x>.up.railway.app` address straight after install; `PUBLIC_URL` is set to that when there
is no custom domain (the service domain is created before the app's variables for this reason).

| Step | What they do | What we check |
|---|---|---|
| Welcome | Read three tiles, press Start | |
| Brand | Brand name, owner email (`FIRST_ADMIN_EMAIL`), optional logo (shrunk to a small PNG in the page) and colour | email format; logo is a real PNG under 30 KB |
| Hosting | Railway **account token** (Account Settings > Tokens, Workspace: *No workspace*) | `me { email workspaces }`, then plan: refuses Free / no card ("needs the Hobby plan") |
| Phones | Telnyx key (becomes the app's `TELNYX_API_KEY`; every client runs on it) | `GET /v2/balance`; trial warning |
| Extras | Three skippable cards, then Continue | Resend and calendars need a domain (see below) |
| Email (optional) | Resend key (Full access) + the from address, e.g. `hello@mail.<domain>`; or **Skip for now** | key works; the sending domain is added to Resend (an existing one is reused) |
| Domain (optional) | Their domain. **Let the wizard handle DNS** (Cloudflare token) or **I'll add the records myself**; or **Skip for now** | Cloudflare: token valid, zone found by name, `active` (else the two nameservers and polling; `moved` is reported), token can write DNS, asks before replacing an existing `app.` record; then writes Resend's records if email was added (+ DMARC `p=none` if missing). Manual: shows those records with live ticks from public DNS and Resend's own check |
| Calendars (optional) | Google / Microsoft client id + secret, or Skip. Needs a domain (the redirect URI is on it) | token endpoint check |
| Install | Press Install | see below |
| Done | Their address, sign in with the owner email, delete the Railway (and Cloudflare) token, turn on Postgres backups. Skipped extras are listed as **Optional extras** with how to add each later | |

**AI help for your team** is not a wizard step and is never asked for. The Done screen's **Optional
extras** always lists it with the steps ("paste an OpenRouter key in Railway variables":
`OPENROUTER_API_KEY` on the app service, optionally `OPENROUTER_MODEL`). With no key the app shows no
**Ask for help** button; with one, agency owners and admins get the assistant (server/assistant.ts).

Rules between the extras: Resend sends from a domain the buyer owns, so adding email without a
domain (or calendars without a domain) is refused at Continue / Install with a plain message; skipping
the domain is refused while email or calendars are set (skip those first). With no email, the app's
`SMTP_URL` / `MAIL_FROM` are empty: sign-up and sign-in work, invite links show on screen for the
owner to copy, and password-reset links are written to the app's Railway log (and an owner/admin
can mint one for a team member: `POST /api/team/members/:id/reset-link`, returns `{ url }`).

**Adding the extras later.** The Done screen (the same setup link) lists each skipped extra with its
steps: email and calendars in the app's **Settings > Email and calendars**, the domain in Railway
(Networking > Custom Domain, then set `PUBLIC_URL`). There is no "re-run a step against the live
install": we hold no Railway token after install, by design.

**Test runs** (admin "Start a test run") use the Railway path above, so
they also only need Brand, Railway and Telnyx (all pretend) and may skip the extras.

### What Install does on Railway

All through Railway's public GraphQL API (`https://backboard.railway.com/graphql/v2`, bearer =
the buyer's account token). Each piece is saved as soon as it exists, so a site restart or a
retry carries on where it stopped.

1. `projectCreate` (in the workspace that has the paid plan), environment `production`.
2. Postgres: `serviceCreate` from `ghcr.io/railwayapp-templates/postgres-ssl:16` with the same
   variables Railway's own template sets (random password), then `volumeCreate` at
   `/var/lib/postgresql/data`.
3. The app: `serviceCreate` (empty), `variableCollectionUpsert` (`skipDeploys`):
   `PRODUCT_NAME`, `BRAND_LOGO_PNG` / `BRAND_COLOUR` (if chosen), `PUBLIC_URL=https://app.<domain>` (or the temporary address with no domain), `FIRST_ADMIN_EMAIL`, `TELNYX_API_KEY`,
   `SMTP_URL`, `MAIL_FROM` (empty if email was skipped), `MAILBOX_KEY` (new random 32 bytes), `SINGLE_AGENCY=1`, OAuth keys if
   given, `HOST=0.0.0.0`, `API_PORT=PORT=8791`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
   `RAILWAY_DOCKERFILE_PATH=deploy/Dockerfile`. `SMTP_URL` uses a **send-only Resend key for that
   one domain** that we create (`POST /api-keys`, `sending_access`), never the Full access key.
   `serviceInstanceUpdate`: `dockerfilePath`, `healthcheckPath=/api/health`, restart on failure.
4. `serviceDomainCreate` (target port 8791), done before step 3's variables: the **temporary address** `https://<x>.up.railway.app`, which is the agency's address when there is no custom domain.
5. Only with a domain: `customDomainCreate` for `app.<domain>`: Railway answers with a CNAME target and a TXT
   ownership check. Cloudflare path: we write both (DNS only). Manual path: the Install screen
   shows both, with live ticks (public DNS + Railway's own status), and says what it finds if a
   value is wrong.
6. The code: the app source from the published bundle (`app-src.tgz` inside
   `selfhost-bundle.tgz`) is posted as a `.tar.gz` to
   `backboard.railway.com/project/<id>/environment/<id>/up?serviceId=<app>`, which is what
   `railway up` does. **Our code is never public**: no GitHub, no registry; it goes only into the
   buyer's own project. Railway builds it with `deploy/Dockerfile`.
7. We poll `deployment(id) { status }` and copy `buildLogs` / `deploymentLogs` (redacted) into
   **Show details**. `SUCCESS`: the agency is running at its temporary address straight away.
   `FAILED` / `CRASHED`: the page shows the reason in one line.
8. No domain: we poll the temporary address's `/api/health` and finish when it answers. With a domain:
   we poll `customDomain { status { certificateStatus } }` and `/api/health`. When the
   certificate is `VALID`, setup finishes by itself. **Finish now** finishes without waiting:
   Railway issues the certificate on its own once the records are in, and the Done page lists them.

**Logo and colour.** They travel as the app's `BRAND_LOGO_PNG` (base64) and `BRAND_COLOUR` settings
With `SINGLE_AGENCY` the app applies them once, when the
owner first creates the account (`applyInstallBrand` in `server/brand.ts`), then never again, so
whatever the owner later changes in Settings sticks. The installed app sends a brand-new copy's owner
straight to its "Set up your agency" page, with the agency name filled in from `PRODUCT_NAME`.

**Try again** (failed build) sends the app again to the same project: same database and
settings. **Delete the project** runs `projectDelete` (app, database and volume) and removes the
records we wrote to Cloudflare, then goes back to the Install summary.

Railway facts (Nov 2026 docs): account tokens use `Authorization: Bearer`, workspace tokens too
(but can't run `me`), project tokens use `Project-Access-Token`. API limits: Hobby 1,000
requests/hour and 10/second. Hobby is US$5/month including US$5 of usage (RAM US$10/GB-month,
vCPU US$20/month, volume US$0.15/GB-month, egress US$0.05/GB), 5 GB volumes, 2 custom domains
per service. Free/Trial accounts need no card but get 0.5 GB volumes, 1 custom domain, and
unverified accounts land on a "limited trial" that can't deploy code, so we require Hobby.
Certificates are Let's Encrypt, normally within an hour of the DNS being right. Private
registry images need Pro, which is why we upload source instead.

## Secrets

- Stored in the `secrets` table, AES-256-GCM, key derived from `SETUP_SECRET_KEY`, bound to
  (buyer, name) so rows can't be swapped. `PRAGMA secure_delete` is on.
- Never sent back to the browser: forms show `Saved (••••abcd)`. Never logged. Install logs are
  redacted (every stored secret, plus anything shaped like a known key).
- After the install finishes we delete every secret and keep only: brand and owner email,
  domain, the Railway project id, addresses, timestamps, the redacted log.
- A setup nobody touches for `SECRETS_IDLE_DAYS` (14) loses its stored keys; the buyer pastes
  them again if they come back.
- We never hold a way in: no SSH key, no Railway access after the token is deleted.

## Safety

- CSRF: every POST must carry an HMAC token tied to the session cookie (`HttpOnly`,
  `SameSite=Lax`, `Secure` on https) **and** come from our own origin. "Our origin" is `SITE_URL`
  or the address the browser really used (`Host`, or `X-Forwarded-Host` + `X-Forwarded-Proto`
  from Caddy or a tunnel). A browser can't fake those for another site, so a wrong `SITE_URL` no
  longer breaks forms; the site logs a warning the first time it sees it.
- Startup guards: `PREVIEW_JUMP=1` refuses to start without a `MOCK_*` switch. Any `MOCK_*`,
  `PREVIEW_JUMP` or `*_API_BASE` with a public https `SITE_URL` refuses to start (except
  `*.trycloudflare.com` or `TEST_SITE=1`). Warnings for a missing / local / non-https / path
  `SITE_URL`, `TRUST_PROXY` off behind a proxy, and missing how-to files.
- Rate limits: 20 failed code lookups per IP per minute (then 429), 600 requests per IP per
  minute, 20 provider checks per buyer per 10 minutes, 3 test emails per buyer per hour, 6
  install starts per buyer per 10 minutes, 10 admin sign-in tries per IP / email per 15 minutes.
- Strict CSP (`script-src 'self'`, no inline scripts or styles), `Referrer-Policy: same-origin`,
  `X-Frame-Options: DENY`, `noindex`, `no-store` on wizard and admin pages.
- Codes are 128 random bits; looked up by SHA-256 and compared in constant time.

## Admin dashboard (/admin)

For us (Twin Technologies) only. Turn it on with `ADMIN_EMAILS` (comma-separated). Sign in with
a password (`ADMIN_PASSWORD_HASH`, made by `bun admin.ts admin-hash`) or a one-time link printed
by `bun admin.ts admin-link you@yourcompany.com` (works once, 15 minutes, needs a button press).
Sessions: random 256-bit id, `HttpOnly`, `SameSite=Strict`, `Path=/admin`, 12 hours.

- **Buyers**: name, email, brand, status (not started / in setup / installing / failed / live /
  revoked), step, live address, created, last activity. Search and filter by status.
- **Add a buyer**: name + email gives the private link to copy. With `SITE_SMTP_URL` and
  `SITE_MAIL_FROM` set, a "Send the welcome email" box sends `handoff-content/welcome-email.md`.
- **Per buyer**: the link again, which step they're on, which keys we hold (name and last 4 only,
  and only until the install finishes), the redacted install log, their setup **read-only**,
  turn the link off/on, reset their setup, delete the buyer.
- **Health and View as.** Install sets `SUPPORT_SYNC_URL`, `SUPPORT_SYNC_TOKEN` (we keep its hash), `SUPPORT_CALL_TOKEN`
  (worked out from the site key, so nothing extra is stored) and `SUPPORT_SELLER_NAME` on the buyer's app. The app POSTs a
  fixed whitelist of counts and health to `/api/sync` every 15 minutes (token auth, rate limited); the buyers list shows
  Live/last seen, version, calls 7d and receptionists, and the buyer page has the snapshot, **Sync now** and **View as**.
  View as asks the app for a one-time link (60 seconds, single use); the app refuses unless the buyer turned Support access
  on, and writes every link and sign-in to the buyer's audit log. Our clicks are in `support_log`. Agencies installed
  before this have no token: they sync nothing and can't be viewed.
- **Automatic updates** (`releases.ts`, the app's Settings, "Updates"). At install, and at the buyer's next manual
  **Update your agency**, we use the Railway token they just gave us to make a **project token** (`projectTokenCreate`,
  scoped to their one project and environment) and set it on their app as `RAILWAY_PROJECT_TOKEN` (with
  `AUTOUPDATE_PROJECT_ID`, `AUTOUPDATE_ENVIRONMENT_ID`, `AUTOUPDATE_SERVICE_ID`). We don't keep it. Hourly the app calls
  `GET /api/releases/latest` (Bearer: its sync token) and gets the version, notes, SHA-256 and a bundle address signed with
  our site key that runs out in 10 minutes (`GET /api/releases/bundle/<version>?b=&exp=&sig=`). If its owner's switch is on
  and it is 2-4am their time (or they chose "as soon as available") it downloads, checks the SHA-256, sets `APP_VERSION`
  and uploads to its own service; the new version reports the result in its first heartbeat. A failed update is an
  incident, a problem, and an alert. If Railway won't make a token the install carries on and the admin shows
  "Auto-update unavailable: buyer must press Update". **Push update now** (buyer page) queues `updateNow` on the next
  heartbeat answer; the app still obeys its owner's off switch.
- **Problems and logs.** The heartbeat carries up to 50 problems from the last 24 hours (a kind, a scrubbed one-line
  message, a count, a time), shown per buyer and on `/admin/problems`, with a red badge in the buyers list. **Fetch recent
  logs** asks the app (call token) for its last 200 log lines, scrubbed by the app; only while the buyer's Support access is
  on, shown once and never stored.
- **Support changes.** On a fresh install Support access starts on (`SUPPORT_ACCESS_DEFAULT=on`, set only at install, never
  by an update) and "Support can make changes" is on: a "View as" session may fix things like an agency admin (never keys,
  billing, the owner, deleting the agency or exports; `server/supportChanges.ts`), and every change is audited "By support".
- **Alerts** (`alerts.ts`, `/admin/alerts`). We alert when an agency that was reporting is silent for 30 minutes (after
  asking the app directly, so an owner who turned sharing off isn't an outage), when a new kind of problem appears, and when
  an automatic update fails: one per agency per kind per hour, to `ALERT_WEBHOOK_URL` (POST JSON with `text` and `content`,
  so Slack and Discord work) and/or email (`SITE_SMTP_URL` + `SITE_MAIL_FROM` to `ALERT_EMAIL_TO`, else `ADMIN_EMAILS`).
  History is kept either way.

## Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `SETUP_SECRET_KEY` | (required) | 32 bytes, base64 (`bun admin.ts gen-key`). **Never change or lose it**: it unlocks the keys of half-finished setups and signs every session. Keep a copy apart from the backups. |
| `SITE_URL` | `http://localhost:4500` | Public https address, no path. Setup links use it. |
| `SELLER_NAME` / `PRODUCT_NAME` / `SUPPORT_EMAIL` | | Shown on pages and in the welcome email |
| `DATA_DIR` | `download-site/data` | SQLite + bundles (`/data` in Docker) |
| `CONTENT_DIR` | | Folder with `providers/*.md` and `welcome-email.md`; else `download-site/content`, else `../handoff-content` |
| `PORT` / `HOST` / `TRUST_PROXY` | `4500` / `127.0.0.1` / `0` | `TRUST_PROXY=1` behind Caddy |
| `ADMIN_EMAILS`, `ADMIN_PASSWORD_HASH` | | /admin sign-in (escape each `$` as `$$` in a compose `.env`) |
| `DEMO_APP_URL`, `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD` | | Turns on /admin's **Start a test run** (not on Add agency any more; **Delete all test runs** clears them): a test buyer whose wizard accepts pretend accounts (no provider is called) and ends on a real branded agency on our team demo app (public `DEMO_APP_URL`, its platform admin sign-in). Unset = no button |
| `SITE_SMTP_URL` or `RESEND_API_KEY`, and `SITE_MAIL_FROM` | | Our own mail sender (SMTP, or Resend's API): invites, the admin's forgot-password link, "agency offline" emails, alert emails |
| `OPENROUTER_OAUTH` | on (https sites) | `0` hides **Sign in with OpenRouter** (paste a key still works). Nothing to register |
| `RAILWAY_OAUTH_CLIENT_ID` (+ `RAILWAY_OAUTH_CLIENT_SECRET`) or `RAILWAY_OAUTH=1` | (button off) | **Login with Railway**. Register an OAuth app (Railway workspace, Developer settings) with redirect `<SITE_URL>/oauth/railway/callback`, or `RAILWAY_OAUTH=1` to register a public client by itself. `RAILWAY_OAUTH_SCOPES` overrides the scopes |
| `TELNYX_OAUTH_CLIENT_ID` (+ `TELNYX_OAUTH_CLIENT_SECRET`) or `TELNYX_OAUTH=1` | (button off) | **Sign in with Telnyx** (OAuth 2.0 code + PKCE; dynamic client registration with `TELNYX_OAUTH=1`; redirect `<SITE_URL>/oauth/telnyx/callback`). Asks Telnyx for a long-lived API key with the login; if Telnyx refuses, the buyer is asked to paste one |
| `OAUTH_BROKER=1`, `GOOGLE_BROKER_CLIENT_ID` + `_SECRET`, `MICROSOFT_BROKER_CLIENT_ID` + `_SECRET`, `BROKER_URL`, `BROKER_GOOGLE_MAIL=1` | (all off) | **Shared Google / Microsoft sign-in** for agencies (broker.ts): our one Google app and one Microsoft app, so agencies connect Google Calendar, Gmail and Outlook without registering their own. Needs the apps registered and verified first: follow `docs/OAUTH-BROKER.md`. `BROKER_URL` is the public https address on a domain we own (default `SITE_URL`; use `https://setup.sageai.agency`) and the apps' redirect is `<BROKER_URL>/oauth/broker/<google|microsoft>/callback`. `BROKER_GOOGLE_MAIL=1` offers Gmail only after Google's restricted-scope assessment. New installs get `OAUTH_BROKER=1` while this is on |
| `ALERT_WEBHOOK_URL` | | https address that gets a JSON POST (`text`, `content`) for each alert: a Slack or Discord incoming webhook works as is |
| `ALERT_EMAIL_TO` | `ADMIN_EMAILS` | Who gets alert emails (comma separated; needs `SITE_SMTP_URL` and `SITE_MAIL_FROM`) |
| `OPENROUTER_API_KEY`, `SETUP_CHAT_MODEL` | (off), `anthropic/claude-sonnet-5.5` | Turns on the **Need help?** chat bubble on every wizard page and /guide (not /admin). Without the key the bubble is hidden and `/chat` answers 404. See "Help chat" |
| `LOOKUPS_PER_MINUTE`, `REQUESTS_PER_MINUTE`, `CHECKS_PER_10_MIN`, `TEST_EMAILS_PER_HOUR`, `SECRETS_IDLE_DAYS` | 20, 600, 20, 3, 14 | |
| `DNS_SERVERS` | `1.1.1.1,8.8.8.8` | Public resolvers to ask |

Test only (refused on a public address): `MOCK_RAILWAY`, `MOCK_FAST`, `MOCK_CF`, `MOCK_RESEND`,
`MOCK_TELNYX`, `MOCK_OAUTH`, `MOCK_PORT_BASE`, `MOCK_APP_PORTS`, `PREVIEW_JUMP`,
`*_API_BASE`, `TEST_SITE`.

## Help chat

When `OPENROUTER_API_KEY` is set, a **Need help?** bubble appears on every wizard page and on `/guide`. It asks
OpenRouter (`SETUP_CHAT_MODEL`, default `anthropic/claude-sonnet-5.5`) and the system prompt is built on the server from the
how-tos, the step names, the common errors and which step that buyer is on (from their saved setup). It never
contains keys, tokens, the buyer's email or their setup code, and what they type is scrubbed of anything key-shaped
before it's sent. Wizard questions go to `POST /setup/<code>/chat` with the same same-origin and per-session CSRF checks
as the wizard's forms; `/guide` uses `POST /chat` (same-origin only, no setup context). Limits: 500 characters a
question, 15 questions per setup code and 30 per IP every 10 minutes, 3000 a day for the whole site. In production set the two
variables in SSM (`/setupsite/env/OPENROUTER_API_KEY`, `/setupsite/env/SETUP_CHAT_MODEL`) or pass them to `deploy/aws/deploy.sh`.
Tests: `download-site/test/chat.test.ts` (fake OpenRouter, nothing real is called).

Alerts use two more SSM parameters, both optional: `/setupsite/env/ALERT_WEBHOOK_URL` (a Slack or Discord incoming-webhook
address) and `/setupsite/env/ALERT_EMAIL_TO` (who gets alert emails; they also need `SITE_SMTP_URL` and `SITE_MAIL_FROM`). Both
are in the list `deploy/aws/remote-deploy.sh` reads. With neither set, alerts are only recorded in /admin/alerts.

## Command-line admin

```bash
bun download-site/admin.ts add-buyer "Jane Citizen" jane@example.com   # prints her /setup/<code> link
bun download-site/admin.ts list                                        # buyers and where each is
bun download-site/admin.ts revoke|restore|reset <code or link>
bun download-site/admin.ts publish <selfhost-bundle.tgz> <version> [notes]   # the app new installs get; notes = text or a file, one change per line
bun download-site/admin.ts notes <version> <notes>                     # set or change a published version's release notes
bun download-site/admin.ts admin-link you@yourcompany.com              # one-time /admin sign-in
bun download-site/admin.ts admin-hash                                  # ADMIN_PASSWORD_HASH
bun download-site/admin.ts backup [file]                               # consistent copy of site.db
bun download-site/admin.ts gen-key                                     # a new SETUP_SECRET_KEY (first install only)
```

Publish a new app version (Railway installs from it). `make-package.sh` /
`make-bundle.sh` never include `download-site/` (our database, keys and old bundles live there) in the
app source that goes to buyers:

```bash
bash download-site/make-package.sh 1.0.1
bun download-site/admin.ts publish download-site/out/selfhost-bundle-1.0.1.tgz 1.0.1 "- Calls show in a new timeline
- Fixes the booking reminder time"
```

### Updating buyers who are already installed (Railway)

Publishing also makes every installed buyer's own setup link show **"Your agency is on version X. Version Y is
available"** with the release notes above. **Update now** asks them to paste a Railway token again, sends the
newest app to the same project and service (database and all existing variables untouched; only new variables
the version needs are added), waits for `/api/health`, records the version, then deletes the token. If it fails
Railway keeps the old deployment running and they press Try again. /admin shows each buyer's installed version
and an "Update available" pill; to tell a buyer, send them their setup link (the buyer page has a copy button).

## Run it for real (production)

On a small server (1 GB is plenty) with Docker:

1. DNS: an `A` record such as `setup.yourcompany.com` to the server. Open ports 80 and 443 only.
2. Copy `download-site/` to the server (e.g. `/opt/setup/download-site`) and copy the how-tos
   and welcome email in, so they're inside the image:
   `mkdir -p download-site/content && cp -r handoff-content/providers handoff-content/welcome-email.md download-site/content/`
3. `cd download-site/deploy && cp .env.example .env` and fill it in: `SITE_HOST`,
   `SITE_URL=https://setup.yourcompany.com`, `SETUP_SECRET_KEY` (from `bun admin.ts gen-key`,
   once), `ADMIN_EMAILS`, `ADMIN_PASSWORD_HASH` (`$` as `$$`), `SUPPORT_EMAIL`, optional
   `SITE_SMTP_URL` / `SITE_MAIL_FROM`. `chmod 600 .env`. Never set any `MOCK_*` or `PREVIEW_JUMP`.
4. `mkdir -p incoming && docker compose up -d --build`. Caddy gets the https certificate from
   Let's Encrypt and proxies to the site (`TRUST_PROXY=1`, `HOST=0.0.0.0` are set in compose).
   Check the logs once: `docker compose logs downloads` must show no `WARNING` lines.
5. Publish a bundle: copy it to `deploy/incoming/`, then
   `docker compose exec downloads bun admin.ts publish /incoming/selfhost-bundle-1.0.0.tgz 1.0.0`
6. Sign in at `https://setup.yourcompany.com/admin` and add buyers there (or
   `docker compose exec downloads bun admin.ts add-buyer "Name" email@x.com`).

**Data**: everything lives in the `downloads-data` Docker volume (`/data`): `site.db` (buyers,
setups, encrypted keys, admin sessions) and `packages/`. **Backups**: run nightly from cron,
e.g. `docker compose exec -T downloads bun admin.ts backup` (writes
`/data/backups/site-<time>.db` with SQLite `VACUUM INTO`, safe while running), then copy
`/data/backups` off the server and prune old copies. Keep `SETUP_SECRET_KEY` in your password
manager, **not** next to the backups (a backup plus the key opens half-finished setups' keys).
If the key is ever lost, finished buyers are unaffected; buyers mid-setup must paste their keys
again. Restore: stop the site, copy a backup to `/data/site.db`, start it.

Updating the site: pull the new `download-site/`, `docker compose up -d --build`. Running
setups pick up where they were.

### On our AWS server (shared with the Twin stack)

`deploy/aws/` runs the site as its own container `setup-site` (internal port 4500, volume
`setupsite_setup-data`) on the `twin_default` network, behind the server's existing Caddy via
`/opt/twin/sites/setupsite.caddy`, the same way `deploy/answered` does it.

```bash
# point setup.yourcompany.com at the server first, then:
DOMAIN=setup.yourcompany.com DRY_RUN=1 bash download-site/deploy/aws/deploy.sh   # shows every step, calls nothing
DOMAIN=setup.yourcompany.com ADMIN_EMAILS=you@yourcompany.com \
  ADMIN_PASSWORD_HASH="$(bun download-site/admin.ts admin-hash | cut -d= -f2-)" \
  SUPPORT_EMAIL=support@yourcompany.com \
  BUNDLE=deploy/selfhost/out/selfhost-bundle.tgz VERSION=1.0.0 \
  bash download-site/deploy/aws/deploy.sh
```

Settings are SSM SecureStrings under `/setupsite/env/*` (the site's `.env` is rebuilt from them
on every deploy). `SETUP_SECRET_KEY` is created once and never overwritten: copy it from SSM into
the password manager. The remote script refuses any test-only setting, waits for the container
to be healthy, publishes `BUNDLE` if given, reloads Caddy and installs a nightly backup, the systemd timer `chloe-setup-backup.timer`
(`deploy/aws/backup.sh`: `VACUUM INTO`, integrity check, gzip, 14 days in `/opt/setupsite/backups`,
and a copy in `s3://twinrecep-deploy-<account>/backups/setup-site/`, the only prefix the server's
role may write; logs: `journalctl -u chloe-setup-backup`).

## Run it locally (all fakes)

```bash
MOCK_PORT_BASE=4520 MOCK_APP_PORTS=4550-4559 bun download-site/mock/serve.ts &
SETUP_SECRET_KEY=$(bun download-site/admin.ts gen-key) PORT=4520 SITE_URL=http://localhost:4520 \
  DNS_SERVERS=127.0.0.1:4525 MOCK_PORT_BASE=4520 MOCK_APP_PORTS=4550-4559 \
  MOCK_RAILWAY=1 MOCK_CF=1 MOCK_RESEND=1 MOCK_TELNYX=1 MOCK_OAUTH=1 ADMIN_EMAILS=you@example.com \
  bun download-site/server.ts
```

Test values: Railway `mock-rail-token-ok` (`mock-rail-token-nocard` shows the Hobby/card
message), Cloudflare `mock-cf-token-ok` (zones `alpha-`, `beta-reception.test` active, `gamma-`
pending then active, `delta-` with an existing record; `mock-cf-token-readonly` can't edit),
Telnyx any key starting `platform-fake-`, Resend `re_mock_full_access_key`
(`re_mock_sending_only_key` shows the error). The fake Railway really builds the app image from
the uploaded source and runs it with a local `postgres:16` on `127.0.0.1:<MOCK_APP_PORTS>`
(containers `wiz-test-rail-*`), so the temporary address opens a working dashboard.
`POST :4521/_mock/rail/fail-next-deploy` makes the next build fail.

## End-to-end tests

```bash
bash download-site/test/run-e2e.sh            # Railway (default), ports 4520-4529 + 4550-4559
node download-site/test/admin-e2e.mjs         # /admin, ports 4560-4569
```

`run-e2e.sh` covers, with screenshots of every step at 390 px (and desktop) in `test-shots/` and
a sideways-scroll check on each: the startup guards; a bad code, the old link redirect, CSRF,
the tunnel/proxy origin case, per-IP and per-buyer rate limits; buyer A on the Cloudflare path
with every provider error (bad Railway token, no card, bad Telnyx/Cloudflare keys, send-only
Resend key, wrong Google secret), a failed build then **Try again** in the same project, the
tab closed and the site restarted mid-build, Done, every secret gone from SQLite (and no
plaintext in the db or WAL), the send-only key in `SMTP_URL`; buyer B in parallel on the
add-records-yourself path (email records ticking off one by one, Resend verifying, the app's two
records with a wrong one first); buyer C's **Delete the project**; nameservers pending then
active and an existing `app.` record; and both installed apps answering `/api/health` with the
brand as their title. Only things named `wiz-test-*` / labelled `wiz-test-port=<port>` are made
and removed. The first run builds the app image (3 to 4 minutes per build); later runs reuse
Docker's layer cache and take about 5 minutes in all.
