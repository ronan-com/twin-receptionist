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
- Admin sync and View as: the buyer app sends a whitelisted heartbeat (counts and health only, no personal data). It's **on by default and can be switched off**. "View as" works only while **Support access** is on. It was off by default when this was written; since 27 Nov 2026 it is on for fresh installs (see "Approved by Jesse" below). It can expire, and it writes to the audit log. See `server/supportSync.ts`, `server/supportAccess.ts` and `download-site/sync.ts`.
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

## Approved by Jesse (27 Nov 2026): support defaults
Jesse, the owner, approved this product decision for fresh installs:
- **Stats sharing is ON by default** (the whitelisted heartbeat). The owner can switch it off in Settings, Support.
- **Support access is ON by default** on a fresh install. The setup site sets `SUPPORT_ACCESS_DEFAULT=on` at install only, never on an update, so older agencies keep what they chose. The owner can switch it off, and that ends any open support session at once.
- **Support can make changes** ("Support can make changes" is ON unless the owner switches it off), limited by the deny-by-default matrix in `server/supportChanges.ts`. Support can never touch keys or connection secrets, billing, the owner account or team, deleting the agency, exports, or the owner's Support and Updates switches. Every change is written to the audit log, marked "By support".
- The buyer-pack wording now says this plainly (`handoff-content/buyer-pack/buyer-email.txt` "Who owns what", `owner-quickstart.md`, `wording-changes.md`). Both defaults are on, either can be switched off, and while access is on support can see the dashboard (calls and messages included) and make changes, which can include buying a phone number on the buyer's Telnyx account.
- Code defaults that match: `server/supportAccess.ts` (`accessDefaultOn`, `editAllowed`, `syncAllowed`), with tests in `server/ops.inner.ts` ("Support access on by default", "support sessions are allowed or blocked per the deny-by-default matrix").
- Done since: the DigitalOcean install path also sets `SUPPORT_ACCESS_DEFAULT=on`. `ownership-checklist.md`, `welcome-email.md`, `landing-copy.md`, `wizard-copy.md` and the setup-site admin wording now match.

## Auto-update when Railway refuses the project token (27 Nov 2026)
Nobody has run the project-token calls against real Railway yet: `projectTokenCreate`, the `Project-Access-Token` header on `/up`, `variableCollectionUpsert` and `deployment(id)`. The app (`server/autoUpdate.ts`) now fails safe:
- If Railway answers anything but success on the variable upsert or the upload, the running version stays, the version label is put back, and automatic updates **turn themselves off for that token**. They don't retry every hour. Settings shows "aren't available", and the setup site's admin shows "Auto-update unavailable" (the heartbeat's `updates.available` is false). It's recorded once as an incident and a problem.
- If `deployment(id)` is refused three times in a row, the app stops watching and turns itself off. A new version that does start still reports itself at boot.
- A network failure (Railway unreachable) is not a refusal, so the app tries again next hour.
- The manual "Update your agency" on the setup link uses the buyer's account token, not this one, so it keeps working. Because the last result is "failed", it also mints a new project token, and a new token re-arms automatic updates. We store only a short SHA-256 tag of the token, never the token.
- If `projectTokenCreate` fails at install, the setup site already installs without a token and the app reports "unavailable" (`download-site/setup.ts` `autoUpdateVars`).

## Things to review closely / known risks
- **Ownership promise changed (approved, see above).** Stats sync and support access are both on by default and can be switched off. While access is on, support can make changes within the matrix.
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
