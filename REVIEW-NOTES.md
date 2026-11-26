# Review notes: Chloe packaged agency (27 Nov 2026)

What was built in this session, where it lives and what's still open. It's written for a reviewer coming in cold.

## The product in one paragraph
We sell a packaged AI receptionist agency. The buyer, the "agency", gets their own copy of this app, running in **their own** Railway account with **their own** Telnyx key. They create AI receptionists for their client businesses: dentists, childcare centres, tradies and so on. Our hosted setup site (`download-site/`, live at https://setup.chloeeai.co) walks them through connecting their accounts and installs the app. We sell it; Jesse runs the business side.

## Branches (all pushed to `ronan-com/twin-receptionist`)
| Branch | What | State |
|---|---|---|
| `own-phone-account` | What buyers get, plus the setup site. Merge target. | 053a73e |
| `demo-flow` | Day-to-day work branch, merged into `own-phone-account` regularly. Also drives the team test dashboard. | 47be640 |
| `vapi-provider` | Vapi as a second voice engine. **Not merged.** See risks. | bdb08cf |

## Live pieces
| URL | What | Host |
|---|---|---|
| https://chloeeai.co | Jesse's landing page (static, login links removed) | AWS EC2 `twinrecep-app`, Caddy `chloedemo.caddy` |
| https://setup.chloeeai.co | Setup wizard and our admin (`/admin`) | Same EC2, container `setup-site`, SQLite, nightly backup timer to S3 |
| ThinkCentre test dashboard (trycloudflare link in SSM `/setupsite/env/DEMO_APP_URL`) | Where "Start a test run" lands | ThinkCentre at home, `~/chloe-demo` |
| test.chloeeai.co | Permanent copy of the test dashboard (RDS db `chloe_test`) | Same EC2, container `chloe-test`. **Waits on the GoDaddy `test` A record.** |
| https://app-production-f1179659.up.railway.app | **First real buyer install** ("Real Ronan Agency") on Ronan's own Railway | Railway, bundle 1.0.2 |

Published app bundles on the setup site: 1.0.0, 1.0.1, **1.0.2** (current). 1.0.3 is next. See the end of this file.

## Done and pushed this session
**Setup wizard (download-site/)**
- Only Railway and Telnyx are required. Email (Resend), own domain and calendars are optional "add later" extras. With no domain, the app runs on the Railway `*.up.railway.app` address.
- The Railway free trial (US$5 credit) is accepted, with a reminder to add a card.
- Logo and colour flow through to the installed app on first boot.
- Resend DNS record names are fixed for subdomains (`fqdn()`).
- Admin "Start a test run": a per-buyer demo flag. Pretend accounts, no provider calls, and it lands on a real branded dashboard on the test app.
- Admin sync and View as: the buyer app sends a whitelisted heartbeat (counts and health only, no personal data). It's **on by default and can be switched off**. "View as" works only when the buyer turns on **Support access**, which is off by default, expires, and writes to the audit log. See `server/supportSync.ts`, `server/supportAccess.ts` and `download-site/sync.ts`.
- `real-run/run.mjs`: drives a full real install. `--dry-run` runs against the mock providers, and all 18 steps pass.

**App (agency dashboard)**
- New receptionist wizard:
  - 58 niche templates (`src/lib/templates/a.ts`, `b.ts`)
  - a "How it handles calls" step that edits `ReceptionProfile` (`src/lib/profile.ts`)
  - 24/7 hours, closures, custom business type, ready-made greetings, an urgent-calls step and childcare starter answers
- The profile drives the call script (`server/prompt.ts` `cleanProfile` / `buildInstructions`) and booking rules (notice, buffer, window, booking mode) in `server/booking.ts`.
- Get-started flow for new agencies: welcome dialog, guided tour, progress checklist and animated how-to guides (`src/components/onboarding/`).
- AI help assistant: an "Ask for help" chat via OpenRouter, agency owners and admins only, hidden without `OPENROUTER_API_KEY` (`server/assistant.ts`).
- Website chatbot: a copy-paste embed (`public/webchat.js`) per receptionist. It books and takes messages through the same booking code, and chats are stored and shown on the client page (`server/webchat.ts`, migration 017).
- Follow-up automations: appointment reminders, missed-call text-back and review requests. Quiet hours 8pm to 8am, no double sends (`server/followups*.ts`, migration 018).
- Use numbers the agency already owns on Telnyx (attach and detach), plus a "Waiting for Telnyx approval" status (`server/ownNumbers.ts`).
- One-click browser test call (`TestCall.tsx`); the panel fits its card.
- Recording notice only when recording is on. Refused double bookings are hidden from appointments.
- White-label: no "Answered" in visible strings. A buyer install shows one agency name, the brand.

**Docs:** `handoff-content/buyer-pack/` holds the buyer email, owner quickstart, wording changes for Jesse, the acceptance checklist and the acceptance results from the demo.

## In progress (agents running when this was written; not yet committed)
1. **Update your agency**: the buyer reopens their setup link, sees "version X available" with release notes, pastes a Railway token, and the app redeploys to the same Railway project with data kept. Old installs also get the sync variables. Files: `download-site/setup.ts`, `wizard.ts`, `admin.ts`, `mock/serve.ts`, `test/update.*`.
2. **Simpler client (end-business) dashboard**: Home, Calls, Bookings and Settings only, mobile first. Files: `src/routes/_authenticated/app/*`, `src/components/app/client/`, `ClientShell.tsx`.
3. **Simpler setup guides plus a setup-site help chatbot** (OpenRouter).

## Then: release 1.0.3
Merge, then `bunx tsc --noEmit`, `bun run build`, `bun test --env-file=../.env server/`, `cd download-site && bun test` and the dry run. After that:
```
bash deploy/selfhost/make-bundle.sh
DOMAIN=setup.chloeeai.co BUNDLE=deploy/selfhost/out/selfhost-bundle.tgz VERSION=1.0.3 bash download-site/deploy/aws/deploy.sh
```
Then rsync the test dashboard to the ThinkCentre, and the buyer presses **Update now**.

## Things to review closely / known risks
- **Ownership promise changed.** Stats sync is on by default (whitelisted, can be switched off), and support access is opt-in. Jesse needs to approve the buyer-pack wording.
- **Railway upload** uses the CLI's undocumented `/up` endpoint. It's proven once on a real install (1.0.2). Research suggests moving to OAuth ("Login with Railway") plus a private image later; that's about a day of work.
- **Telnyx detach** (`connection_id` cleared with `""` then null) hasn't been confirmed live.
- **Inbound SMS isn't wired**, so reminder replies C/X do nothing yet.
- **Vapi branch:** no live Vapi calls yet. Its migration is numbered 017, which clashes with `017_website_chat.sql`, so renumber it on merge. It touches `server/index.ts` heavily.
- **AU numbers** need Telnyx proof of address and take 1–3 days. Our own Perth number is stuck in `requirement-info-pending`.
- **Test dashboard on the ThinkCentre** depends on a home machine and a quick tunnel. The AWS copy, `chloe-test`, needs the DNS record.
- **Setup admin password** was set by the owner and is short. Change it before real buyers arrive.
- The test runs left several demo agencies on the ThinkCentre DB.

## How to check quickly
- Setup site: `/admin` → Start a test run → go through the wizard → Open your dashboard.
- Real install: open the Railway URL above → New receptionist → pick a template → Talk to this receptionist.
- Tests: the commands under "Then: release 1.0.3" above.
