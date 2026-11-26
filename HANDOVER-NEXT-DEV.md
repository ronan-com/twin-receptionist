# Handover to the next developer (27 Nov 2026)

## READ THIS FIRST: update from Jesse's Claude (27 Nov 2026, later the same day)

The three unfinished pieces below are now **merged into `own-phone-account`** (from branch `chloe-finish`) and pushed. **Nothing is deployed.** Live is still 1.0.5 on the setup site and 1.0.2 on the first real agency.

**Checks run on Windows (Bun 1.4.5, Postgres 16 in Docker):**
| Check | Result |
|---|---|
| `bunx tsc --noEmit` (root) | pass |
| `cd download-site && bunx tsc --noEmit -p .` (new `download-site/tsconfig.json`) | pass |
| `bun run build` | pass |
| `bun test --env-file=.env server/` | **348 pass, 0 fail**. It was 150/11 before, and own-phone-account was also red. |
| `cd download-site && bun test` | **20 pass, 0 fail** |
| `node download-site/real-run/run.mjs --dry-run` | **NOT run to the end.** It stops at preflight because `deploy/selfhost/out/selfhost-bundle.tgz` must be built first with `bash deploy/selfhost/make-bundle.sh`, which is Linux/WSL only. Run it on Linux before releasing. |

**What was done:**
1. **Compile fix:** `demo-flow` + `wip-unfinished` reconciled (`download-site/admin-web.ts`, `download-site/server.ts`, `server/index.ts`).
2. **Server tests:** the 11 failures were stale `mock.module` stand-ins leaking across test files (`automations.apply.test.ts`, `ownNumbers.test.ts`, `voice/telnyx.test.ts`). `webchat.test.ts` now runs the real `migrate()`.
3. **Auto-update fails safe** (`server/autoUpdate.ts`): if Railway refuses the project token on upsert, `/up` or `deployment(id)` (3×), it turns itself off for that token, shows "Auto-update unavailable" plus the reason (Settings → Updates, and the admin through the heartbeat), and doesn't retry. A network error still retries hourly. Manual "Update your agency" keeps working and mints a fresh token, which re-arms it. There are 10 new fallback tests in `server/ops.inner.ts`. Everything was tested with fakes only, never with real Railway.
4. **Support:** `supportGate()` moved into `server/supportChanges.ts`, with 5 matrix tests. `server/problems.ts` uses an AsyncLocalStorage re-entry guard, so problems are no longer silently dropped.
5. **Jesse decided:** support access is **ON by default** and **support can make changes** (within the matrix). Set on both the Railway and DigitalOcean install paths. The buyer pack and handoff copy have been reworded to match. See REVIEW-NOTES.md "Approved by Jesse".
6. **Help tickets:** an agency "Support requests" page at `/admin/support-requests`, plus a nav item with an unread count, and a link from the Contact support dialog. `routeTree.gen.ts` has been regenerated.
7. **Done-for-you onboarding:** the admin panel is wired. "Delete the project" now also removes the GoDaddy/Cloudflare records it created (`download-site/test/dnsdelete.*`).

**Still to do (in this order):**
1. On Linux: `bash deploy/selfhost/make-bundle.sh`, then `NODE_PATH=$PWD/node_modules node download-site/real-run/run.mjs --dry-run`, and fix anything red. The setup-site agent was stopped before finishing this, so check its `run.mjs` / `mock/serve.ts` edits.
2. Click-test in a browser (`scripts/e2e/setup.sh`): Support requests page, Settings → Updates, admin Agencies / Help tickets / Problems / done-for-you panel. None of it was opened in a browser.
3. `download-site/setup.ts` "Update your agency" should also mint a new project token when the heartbeat says `updates.available` is false (today it does so only when `lastResult` is "failed").
4. Small gaps: the help-menu dialog skips the page link when an owner has only client requests, and new agency tickets have no client picker.
5. Release (Ronan or whoever has AWS): `bash scripts/release-chloe.sh 1.0.6 "<notes>"`, then Update now on the first real agency. It's the first real test of the project-token calls.

**Jesse to know:** with "Support can make changes" on, support can buy phone numbers on the buyer's Telnyx account (costs them money) and send onboarding to their businesses. The buyer wording says so.

**Security:** the setup admin password, Telnyx key and OpenRouter key were pasted in plain chat during this handover. **Rotate them.** Never put them in this repo.

---

**For Jesse, in plain English.** Chloe works end to end: the landing page, the setup site, and a real agency installed on Railway. Credits ran out before the last pieces were finished. The finished and proven parts are live. The unfinished parts are saved on GitHub, labelled below. Hand this file to GPT or Claude and say: "Finish the unfinished work in HANDOVER-NEXT-DEV.md in the order given, test it, then release with the script." Nothing unfinished is live, so nothing live is at risk.

**Where the code is (private repo `ronan-com/twin-receptionist`):**
- `own-phone-account` — stable, **this is what's live** (1.0.5). Start from here.
- `demo-flow` — finished-ish work on top, plus three WIP commits (`444f443`, `05e2a24`, `94c95ce`, listed below). May not compile until `admin-web.ts` is reconciled.
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
3. **Done-for-you onboarding from admin** — committed on `demo-flow` as `94c95ce` (the `admin-web.ts` panel is only in `wip-unfinished`).
   - Done: `download-site/assist.ts`, `assist-web.ts`, `dns.ts`, `hosts.ts`, `ctx.ts` — admin fills any wizard step via the wizard's own actions; GoDaddy and Cloudflare DNS writers; install-for-them, send-owner-login, DNS check, audit log; the buyer's wizard shows "Set up by your provider" and a done/left note; the setup link on the buyer's own domain (`/api/tls-allowed`, host routing with the buyer's brand, Caddy on-demand TLS block in the template, `deploy/Caddyfile` and `ensure-ondemand-tls.sh` called from `remote-deploy.sh`). 18 tests passed before the last split; not re-run on the commit.
   - **Not reachable yet:** the admin panel and routes live in `download-site/admin-web.ts` in `wip-unfinished`, mixed with the help-ticket edits. Someone has to merge those hunks. Commit `444f443` already imports `./assist-web` and `./hosts` from `admin-web.ts`, so `demo-flow` may not compile until that is resolved.
   - Gaps: GoDaddy writing is Railway-only (the DigitalOcean path only gets Cloudflare); "Delete the project" doesn't delete GoDaddy records; the `real-run --dry-run` never completed (`run.mjs` was edited to accept the "Agencies" heading).
   - **Unverified:** nothing ran against real Cloudflare, GoDaddy or Caddy. Check that `on_demand_tls` is accepted by the Caddy on the AWS server before deploying, and never change the shared `/opt/twin/Caddyfile` without a backup and `caddy validate`.

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
