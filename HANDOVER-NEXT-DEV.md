# Handover to the next developer (27 Nov 2026)

**For Jesse, in plain English.** Chloe works end to end: the landing page, the setup site, and a real agency installed on Railway. Credits ran out before the last pieces were finished. The finished and proven parts are live. The unfinished parts are saved on GitHub, labelled below. Hand this file to GPT or Claude and say: "Finish the unfinished work in HANDOVER-NEXT-DEV.md in the order given, test it, then release with the script." Nothing unfinished is live, so nothing live is at risk.

**Where the code is (private repo `ronan-com/twin-receptionist`):**
- `own-phone-account` — stable, **this is what's live** (1.0.5). Start from here.
- `demo-flow` — finished-ish work on top, plus three WIP commits (listed below).
- `wip-unfinished` — a snapshot of 23 uncommitted files (done-for-you setup, help-ticket wiring, DNS and hosts). May not compile.

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

## Unfinished work (what each agent reported at the end)
All of this is **not release-ready**. Tests passed on pieces in isolation; the pieces were never run together.

1. **Auto-update, problems feed, support access, alerts** — committed on `demo-flow` as `444f443`.
   - Done and unit-tested: shared Railway code (`server/railwayUp.ts` + identical `download-site/railwayUp.ts`), app auto-update (`server/autoUpdate.ts`, hourly check, 2–4am option, sha256 check, owner off switch), setup-site `releases.ts` (signed bundle URLs, `GET /api/releases/latest`, "Push update now"), problems feed (`server/problems.ts`, heartbeat `problems` field), admin Problems pages and badge, "Fetch recent logs", alerts (`download-site/alerts.ts`: email or `ALERT_WEBHOOK_URL`), support access on by default for fresh installs (`SUPPORT_ACCESS_DEFAULT`), "Support can make changes" with a deny-by-default matrix (`server/supportChanges.ts`), Settings → Updates and Support UI, docs updated.
   - **Unverified against real Railway:** `projectTokenCreate` and its input shape; whether a project token works on `/project/.../up` via the `Project-Access-Token` header; `variableCollectionUpsert` and `deployment(id)` with a project token; the account-token scope needed to create one. Only fakes were used. If any of this fails, keep the manual "Update now" flow and show "Auto-update unavailable".
   - Not done: the REVIEW-NOTES line that this needs Jesse's approval (see below), the dry run (`real-run/run.mjs --dry-run`), a full `bun test server/`, a live check that support sessions are blocked or allowed per the matrix, browser screenshots, real email/webhook alert delivery. The `wizard.css` styles for the admin log lines are missing from the commit (they are in `wip-unfinished`).
2. **Help tickets** — committed as `05e2a24` on `demo-flow`, but **not wired in**.
   - Done and tested alone: setup-site `download-site/tickets.ts` + `public/tickets.css` (12 tests), app `server/tickets.ts` + migration `024_support_tickets.sql` (12 tests), `SupportDialog.tsx` and "Contact support" in the help menus.
   - The wiring is only in `wip-unfinished`: `download-site/admin-web.ts` (Buyers → Agencies rename, real agencies only, collapsed "Test runs (N)" at the bottom, `/admin/agencies` aliases, Help tickets routes and badge), `download-site/server.ts` (`/api/tickets`, body limit raised to 3 MB), `server/index.ts` (`/api/tickets`, `startTicketSync()`).
   - Not built: the agency "Support requests" page and nav item, regenerating `routeTree.gen.ts`. The frontend was never type-checked.
3. **Done-for-you onboarding from admin** — only in `wip-unfinished`. Fill a buyer's steps for them, write DNS via Cloudflare or GoDaddy, install for them, serve the buyer's setup link on their own domain (Caddy on-demand TLS; changing the shared `/opt/twin/Caddyfile` needs care). It was mid-build and has a failing `hosts` test. Treat it as a draft.

**Needs Jesse's approval before release:** stats sharing and support access being **on by default**, and support being able to **edit** (not just view) an agency, change the "you own everything" promise in the buyer email. Add that line to `REVIEW-NOTES.md` when finishing.

## Finish order I'd follow
1. `git checkout demo-flow`, merge in the needed files from `wip-unfinished` (`git checkout wip-unfinished -- <path>`), then run `bunx tsc --noEmit`, `bun run build`, `bun test --env-file=../.env server/`, `cd download-site && bun test`, and `NODE_PATH=$PWD/node_modules node download-site/real-run/run.mjs --dry-run`. Fix what's red.
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
