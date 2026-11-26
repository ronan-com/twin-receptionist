# Handover to the next developer (27 Nov 2026)

Read `REVIEW-NOTES.md` first for the product, branches and what's live. This file is the **to-do list and the safe way to finish**. Credits ran out on the previous session, so some work is committed but unfinished.

## Ground rules (please keep)
1. **Release only from GitHub.** Use `bash scripts/release-chloe.sh <version> "<notes>"`. It clones `own-phone-account`, runs tsc, the build and all tests, deploys the setup site with the new app bundle, and tags `chloe-v<version>`. Never ship from a laptop working tree.
2. **`main` is Twin production** (a different product). Do not merge Chloe work into it. Chloe's release branch is `own-phone-account`.
3. **Telnyx is the main voice and number provider.** Vapi and Twilio are backup options at the end of onboarding and in Connections.
4. **Buyers own their accounts.** The app runs in the buyer's Railway with their Telnyx key. We keep no keys after install. Never ask for or store a buyer's keys on our side beyond the install.
5. Machine limits on the previous laptop: /tmp is a small tmpfs and filled up twice. Keep scratch files out of /tmp and run one build at a time.

## State right now
| What | Where | Version / state |
|---|---|---|
| Landing page | https://chloeeai.co (AWS Sydney, Caddy `chloedemo.caddy`) | Jesse's current "Chloee" site, sign-in links point at the first real agency |
| Setup site + admin | https://setup.chloeeai.co (AWS, container `setup-site`, SQLite, nightly backup to S3) | **1.0.5 live**, tagged `chloe-v1.0.5` |
| First real agency | https://app-production-f1179659.up.railway.app (Ronan's Railway) | Still **1.0.2**. Needs **Update now** from its setup link |
| Team test dashboard | ThinkCentre via a Cloudflare quick link (`DEMO_APP_URL` in SSM `/setupsite/env/`) | Fragile. AWS copy `chloe-test` exists at test.chloeeai.co but waits on the GoDaddy `test` A record |
| Code | GitHub `ronan-com/twin-receptionist` (private) | See branches below |

Logins and secrets are NOT in git. Ask Ronan: setup admin (`admin@chloeeai.co`), the AWS profile, the Telnyx key, the OpenRouter key, the Railway token for the first agency.

## Branches
- `own-phone-account` — release branch. Stable, 1.0.5 + the release script. **Start here.**
- `demo-flow` — working branch. **Contains unfinished, partly untested work** (see next section) committed by three agents as WIP. Review it before merging anything into `own-phone-account`.
- `vapi-provider` — already merged into `demo-flow`/`own-phone-account` (1.0.4+). Safe to ignore.

## Unfinished work on `demo-flow` (three agents were mid-build)
Each was told to commit and push whatever it had. Check `git log demo-flow` for the newest commits and the notes below. Treat all of it as **not release-ready** until its tests pass and it has been click-tested.
1. **Auto-update, problems feed, support fixes, alerts** (biggest piece).
   - Auto-update: the app creates a Railway project token at install, polls `GET /api/releases/latest` on the setup site, verifies sha256, redeploys itself. Unverified against real Railway (`projectTokenCreate`, upload path).
   - Problems feed in the heartbeat + admin "Problems" page + "Fetch recent logs".
   - Support access ON by default for fresh installs, and support sessions able to edit (not keys, billing, owner, delete, export).
   - Alerts (offline, new problem kind, failed update) to email or `ALERT_WEBHOOK_URL`.
   - Needs Jesse's approval: stats sharing and support access on by default changes the "you own everything" promise.
2. **Done-for-you onboarding from admin**: fill a buyer's steps for them, write DNS via Cloudflare/GoDaddy, install for them, and serve the buyer's setup link on their own domain (on-demand TLS in Caddy; touching the shared `/opt/twin/Caddyfile` needs care).
3. **Agencies list cleanup and help tickets**: rename "Buyers" to "Agencies", test runs in a small collapsed section at the bottom, and a help-ticket system between agencies, us and their clients.

## Finish order I'd follow
1. `git checkout demo-flow`, run `bunx tsc --noEmit`, `bun run build`, `bun test --env-file=../.env server/`, `cd download-site && bun test`, and `NODE_PATH=$PWD/node_modules node download-site/real-run/run.mjs --dry-run`. Fix what's red.
2. Finish and click-test the three pieces above, one at a time, on a local run (`scripts/e2e/setup.sh`) and on the test dashboard.
3. Merge `demo-flow` into `own-phone-account`, then run `scripts/release-chloe.sh 1.0.6 "<notes>"`.
4. **Update the first real agency** (Ronan's setup link → Update now → paste a Railway token). Watch it. It's the first real run of the update flow.
5. Reset-without-email is already committed on `demo-flow` (a57931c, merged for 1.0.6): owner reset from the setup link, "Copy reset link" for team, clear forgot-password wording.

## Known gaps / risks
- Railway upload uses the CLI's undocumented `/up` endpoint (works, proven once). Longer term: "Login with Railway" OAuth + private image deploys.
- Railway Hobby may not include database backups. Check before a buyer relies on them.
- Hosting region: Railway has no Australia. Singapore. Centre privacy notices must say so (Jesse to confirm).
- AU phone numbers need Telnyx proof of address, 1–3 days. Our Perth number is stuck in `requirement-info-pending`.
- Replies to text messages (C/X on reminders) aren't wired (no inbound SMS).
- Vapi and Twilio have only been tested with mocked requests.
- The setup admin password is weak and was shared in chat. Change it (SSM `/setupsite/env/ADMIN_PASSWORD_HASH`). Buyer-facing support email is still a personal Gmail.
- Jesse's wording approvals (`handoff-content/buyer-pack/wording-changes.md`) and the buyer details are still open.
- The ThinkCentre test dashboard has leftover test agencies and clients.

## Where things live
- App: `server/` (Bun), `src/` (React/TanStack), migrations in `server/migrations/`.
- Setup site: `download-site/` (Bun + SQLite). Deploy: `download-site/deploy/aws/`. Tests: `download-site/test/`. Full pretend-install: `download-site/real-run/run.mjs --dry-run`.
- Buyer docs: `handoff-content/buyer-pack/` and `handoff-content/providers/`.
- Templates: `src/lib/templates/`; profile options: `src/lib/profile.ts`.
