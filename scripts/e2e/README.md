# Local end-to-end tests

Everything runs against a scratch database in the `twin-pg` Docker container and a
local server with a fake phone-provider key. Nothing touches production.

```bash
bash scripts/e2e/setup.sh            # build, fresh DB, server, seed accounts
node scripts/e2e/foundation.mjs      # browser test (puppeteer-core + /snap/bin/chromium)
```

## Settings

| Variable | Default | |
|---|---|---|
| `E2E_PORT` | `8899` | server port |
| `E2E_DB` | `agency_test` | scratch database (dropped and recreated; `twin`, `answered`, `postgres` are refused) |
| `TWIN_ENV` | `/home/ronan/aibiz/.env` | env file to read `DATABASE_URL` from (only the host and credentials are used) |
| `E2E_DIR` | `/tmp/twin-e2e-$E2E_PORT` | cookies (`*.jar`), ids, `server.log` |
| `E2E_SKIP_BUILD` | unset | `1` reuses `dist/` |
| `SIGNUP_LIMIT_PER_HOUR` | `50` | sign-ups per address an hour (production default is 5) |

Area ports and databases, so worktrees can run side by side: W 8901/e2e_w, S 8902/e2e_s,
C 8903/e2e_c, M 8904/e2e_m, Q 8905/e2e_q. Example: `E2E_PORT=8901 E2E_DB=e2e_w bash scripts/e2e/setup.sh`.

## What setup.sh creates

- platform admin `ronan@test.dev` / `correct-horse-battery` (cookie `admin.jar`)
- Agency A owner `a@a.test` / `password-for-agency-a` (cookie `a.jar`), with one receptionist
  "Alpha Plumbing" (id in `clientid`, agency id in `agencyid`; its assistant id is not a demo one,
  so anything that asks the phone provider for it fails, as it would with a bad key)

## The fake phone provider

The server runs with `TELNYX_API_KEY=platform-fake-...`. With that key (or `E2E_FAKE_PROVIDER=1`)
new receptionists, from the business sign-up or `POST /api/clients`, are made as demo ones
(assistant id `demo-…`): no provider calls, sample calls from `server/sandbox.ts`, and the
call_log sync fills five sample calls a minute after they're made. `/api/voices` answers with
one stand-in voice. Production always has a real key and never takes this path.

Password-reset and invite links are printed in `server.log` (no mail server locally).

Snap Chromium can't read files under `/tmp`: keep upload fixtures under `$HOME`.

## foundation.mjs covers

Signed-out redirect; agency sign-up to `/admin` and first receptionist; agency blocked from
platform-only pages and from `/app`; sign out and in; business sign-up to `/app` with demo
data; business user blocked from `/admin`, the console API and other businesses; password
reset (invalid link and full flow); an agency's customer accepting an invite (view-only, can't
write); the connect page; the platform console, View as a business and Exit view; no
horizontal scrolling at 390px on `/login`, `/signup`, `/app`, `/admin`, `/connect`.
A new demo business's sample calls arrive with the next call sync (up to a minute), so the
dashboard checks reload until they show.

## p-phone-setup.mjs covers

An agency's own phone account. Start the main server with
`OWN_PHONE_ACCOUNT=required E2E_PORT=8905 E2E_DB=e2e_q bash scripts/e2e/setup.sh`, then
`E2E_PORT=8905 E2E_DB=e2e_q node scripts/e2e/p-phone-setup.mjs`. It starts a second server
itself (`PRODUCT_NAME=Chloe`, default phone mode; `E2E_PORT2`/`E2E_DB2`, default 8907/e2e_q3)
and a third with `SINGLE_AGENCY=1` on an empty database (`E2E_PORT3`/`E2E_DB3`, default
8908/e2e_q4), and stops both at the end.

New agency held at `/setup` (console pages and `POST /api/clients` refused); malformed keys
refused; the pretend key `KEYTEST-LOCAL-DEMO-0001` connects; Connections and the menu; buying
a number for a demo receptionist; member/admin/owner/business permissions on
`/api/phone-account`; booking through `/hooks/<id>/book` with an email (both emails in
`server.log`, same slot refused); Answered vs Chloe naming and `/`; default mode sends a new
agency to `/admin`; `/guide` signed out. US numbers: a US-time-zone receptionist's picker starts
on the United States, `(212) 555-0101` format, 10DLC note, no texting; bad +1/+61 picks refused.
SINGLE_AGENCY: first account lands on a plain agency console (no Agencies, Number Requests, Test
Lab, Setup, "Platform" labels), platform APIs 403, key can't be replaced, Email and calendars with
Google calendar-only scopes, direct number buying, invited admin, sign-up closed afterwards. Only malformed keys and the pretend key are ever sent.
