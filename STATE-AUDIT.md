# Chloe: state for audit (27 Nov 2026, ~16:00 AEST)

Written for an outside reviewer (GPT/Claude) to audit. Read with `HANDOVER-NEXT-DEV.md` (to-do list) and `REVIEW-NOTES.md` (product, branches). The checks below were run against live systems on 27 Nov 2026.

## Update, release/1.0.19 (27 Nov 2026): read this first
The sections below were written at ~16:00 and are older than this one. Where they differ, this one is right.

**What is in release/1.0.19** (branch `release/1.0.19`, built on `integrate/1.0.18`, not yet on `own-phone-account` and not yet released):
- Everything in 1.0.14 to 1.0.18: neutral product name, call summaries, reschedule/cancel by phone, spam filter, simple onboarding (Brand, Hosting, Voice, AI), one brain on OpenRouter, daily backups to an app volume, app connectors, shared Google/Microsoft sign-in broker (off by default), agency quick guide, Connections tab for Telnyx/Vapi/Twilio keys, 10-minute number check.
- Onboarding rehearsal fixes (`fix/onboarding-rehearsal`): admin tables scroll under the CSP, AI row on the Install summary, the plan error says "Try again", the mock SMTP records mail.
- Resend over port 2587 (STARTTLS). **Railway blocks outbound 465 and 587 on plans below Pro**, so installs on Hobby could not send email on those ports.
- Leftovers fixed in 1.0.19: (a) Done page "Before you go" items start empty and only tick when the buyer presses them (we cannot see whether a token was deleted); (b) "I need a person" refuses an empty message; (c) `site.db` migrations run under one write lock and tolerate "duplicate column", so the server and `admin.ts publish` can open a fresh file together; (d) the Hosting step now says up front what plan is needed. A Railway free trial or an unreadable plan keeps the buyer on Hosting with a warning (per Railway's docs the trial ends after 30 days or when its US$5 is spent and the services stop; a Limited Trial has restricted outbound ports). The Free plan is refused with the Hobby message. **Not tested against a real trial account**: we only had a Hobby account, so the trial behaviour is from the docs and a stubbed Railway API.

**How the master admin is reached:** https://setup.sageai.agency/admin (the admin domain; buyer setup links stay on the generic sslip address). The old sslip `/admin` and setup.chloeeai.co still answer for installed agencies' `/api/*`.

**Test agency:** "Sage AI Test" on Ronan's Railway, https://app-production-4f265fb1.up.railway.app (login and Railway token are in `~/aibiz/.secrets/`, never in git). It has the "Test Plumbing" business. Installed by uploading a bundle built on the ThinkCentre, keeping env, DB and volume.

**Email:** the platform sends through Resend from the verified domain mail.twintechnologies.co (key in `~/aibiz/.secrets/test-install.env`).

**Building and testing:** this laptop is overloaded. Run builds and tests on the ThinkCentre with `~/aibiz/bin/tc-run.sh <folder> '<command>'` (rsyncs the folder, installs deps, gives a scratch Postgres as DATABASE_URL). Full check: `bunx tsc --noEmit && bun run build && bunx tsc --noEmit -p download-site && bun test server/ && (cd download-site && bun test)`. CI is `gh workflow run chloe-ci --ref <branch>`.

**Release process is unchanged:** `scripts/release-chloe.sh` releases from `own-phone-account` after a green CI run for that commit; the setup site and the app bundle are published together and every installed agency auto-updates from it. The exact steps for 1.0.19 are in `~/aibiz/reports/release-1.0.19-plan.md`.

**Open items**
1. Release 1.0.19 (plan above); nothing in it is live yet.
2. Railway free-trial behaviour at Install is unproven on a real trial account.
3. Everything in "Not proven yet" below still stands except the test agency now runs current code: no real phone call or booking has been proven on a buyer copy; auto-update against real Railway; the undocumented Railway upload endpoint; whether Hobby includes volume backups.
4. chloeeai.com DNS (Jesse), rotating the secrets pasted in chat, "Daniel" (admin buyer 10) is still an unclear setup link.

## What Chloe is
A packaged AI receptionist **agency**. A buyer (the agency) goes through our hosted setup wizard and connects their own accounts (Railway for hosting and Telnyx for voice and numbers; Vapi or Twilio optional; email, domain and calendars optional). The wizard installs the agency dashboard onto the buyer's own Railway. After setup we keep no keys and have no access. Telnyx is the main voice provider. Code: private repo `ronan-com/twin-receptionist`, release branch `own-phone-account`. `main` is Twin production, a different product: do not merge Chloe into it.

## Live systems (checked 27 Nov)
| What | Address | State found |
|---|---|---|
| Landing page | https://chloeeai.co | 200 OK, served from our AWS |
| chloeeai.com | — | DNS still points to Network Solutions (208.91.197.27), not our server. Jesse to change it |
| Setup site + admin | https://setup.13-211-218-61.sslip.io (admin at `/admin`) | 200, container `setup-site` healthy. `SITE_URL` is the sslip address **by design** (commit b950af6: "generic address, no chloe in links") |
| Old setup address | https://setup.chloeeai.co | 308 forward for pages to the sslip address. Still serves `/api/*` and `/healthz` so installed agencies keep syncing |
| First real agency | https://app-production-f1179659.up.railway.app | Gone: Ronan deleted it on purpose. It was our own **test agency** on his Railway (1.0.2), not a buyer. Railway now answers "Application not found" |
| Team test copy | test.chloeeai.co | No DNS record. Container `chloe-test` is healthy on AWS and waits on a GoDaddy `test` A record |

AWS server `twinrecep-app` (i-0a2c31a32dea60a59, ap-southeast-2, managed via SSM, no SSH). Containers: `setup-site` (up about 4h), `chloe-test`, `answered-app`, `twin-app-1`, `twin-caddy-1`, all healthy. Disk is 22% used. Memory: 1.8 GB total, about 0.9 GB available. Nightly setup-site backup timer `chloe-setup-backup.timer` is active; last run 13h ago, to `s3://twinrecep-deploy-323149985112/backups/setup-site/`.
Stale files: `/opt/twin/sites/chloedemo.caddy` and `chloe-landing.old/`.

## Code and releases
- `own-phone-account` head `dd1d9b2` is pushed and **released as `chloe-v1.0.13`** (all feature work is released; only these docs come after it). Live install "Ronan's AI Agency" reports app version 1.0.10 and is due an update.
- Uncommitted edits found in the `demo-flow` worktree (`download-site/admin-web.ts`, `download-site/server.ts`, `server/index.ts`) were pushed as branch `demo-flow-leftovers`. They are unreviewed and probably superseded by the reconcile in `chloe-finish`.
- All other local branches match GitHub. Agent worktree branches are already contained in pushed branches.

## Tests run 27 Nov (Linux laptop)
- `download-site`: `bun test` **24 pass, 0 fail**. `tsc --noEmit -p download-site` printed nothing (looked clean).
- Server suite and e2e were **not** run in this pass. See HANDOVER for the last full run (348 pass on Windows).

## Live install (27 Nov, 17:00 AEST)
- "Ronan's AI Agency" at https://app-production-aa9b9284.up.railway.app returns 200. Its last check-in was 16:54 AEST: version 1.0.10, health ok, phone key ok, 1 client, 1 receptionist, 0 numbers, 0 calls, 0 bookings.
- Setup admin has 9 buyers. 7 are "Test hh:mm" runs; "Daniel" is unclear. 0 help tickets, 1 alert, 3 onboarding links. Only one install is syncing.

## Not proven yet (audit focus)
1. **No real phone call or booking** has been proven on an installed buyer copy.
2. The test install was deleted (above). Re-run the wizard on a test account to prove an install on current code.
3. Auto-update with the Railway project token has only been tested with fakes, never against real Railway.
4. `real-run/run.mjs --dry-run` has not been run to the end. It needs `deploy/selfhost/make-bundle.sh` first.
5. Railway Hobby backups: the docs don't say whether volume backups are included, so the Done screen may need Pro.
6. The Railway upload uses the CLI's undocumented endpoint.
7. Undecided: buyer update policy and support terms. Support access is ON by default and can make changes, including buying numbers on the buyer's Telnyx account (Jesse approved this).

## Security
- Setup admin password, Telnyx key and OpenRouter key were pasted in chat during an earlier handover. **Rotate them.**
- Secrets live in SSM `/setupsite/env/*` and `~/aibiz/.secrets/`, never in git.
- Check that the sslip setup address and `/admin` sign-in are rate-limited, and that the open `/api/*` on setup.chloeeai.co only accepts calls from installed agencies.

## How to push safely (read before changing anything)
- **Work on a branch off `own-phone-account`**, merge back when green, and push. Never commit Chloe work to `main` (Twin production).
- **Pushing to GitHub changes nothing live.** CI (`.github/workflows`) runs typecheck, build and all tests on every push.
- **Release only with `bash scripts/release-chloe.sh <version> "<notes>"`.** It clones `own-phone-account` from GitHub, requires a green CI run for that exact commit, deploys the setup site with the new app bundle, and tags `chloe-v<version>`. Never deploy from a laptop working tree.
- **Setup-site redeploys must keep the same `DOMAIN`** (currently the sslip address). `remote-deploy.sh` keeps `setup.chloeeai.co` answering `/api/*`. Do not remove that block, because installed agencies call it.
- **Never touch** `answered-app`, `twin-app-1`, the Twin Caddy, or Jesse's Lovable/Supabase project. They share the same AWS server.

## Deployed partner dashboards still sync to us
Each buyer's dashboard runs on the buyer's own Railway but stays connected to our setup site through `SUPPORT_SYNC_URL` + `SUPPORT_SYNC_TOKEN`, which are set at install (`server/supportSync.ts` in the app, `download-site/sync.ts` on our side):
- `POST /api/sync` every 15 minutes: a fixed whitelist snapshot (version, health, counts, brand, support and update state). Anything else is dropped. The buyer can switch sharing off.
- `POST /api/tickets` and `GET /api/tickets/updates`: help tickets and our replies.
- `GET /api/releases/latest` and `/api/releases/bundle/<v>`: **how buyer apps update themselves.** A release you publish reaches every installed partner. A bad release therefore ships to every partner, which is why releases go through the script and CI.
- "View as": a one-time, 60-second sign-in link, only while the buyer's Support access is on (on by default). It is logged in their audit log.
So **breaking `/api/*` on the setup site, changing the sync shape on only one side (keep `SHAPE` in `sync.ts` and `supportSync.ts` in step), or losing `site.db` (it holds the sync token hashes) cuts every partner off.** `site.db` is backed up nightly to S3.

## Suggested audit order
Security items, then a real install plus a real call on current code, then update the live test install to 1.0.13, then the HANDOVER to-do list.
