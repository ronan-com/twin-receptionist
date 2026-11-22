# Twin Receptionist

The dashboard for someone who sells AI receptionists to local businesses. They open it, see every client's receptionist, and create a new one for each business they sign: enter the business's details, pick a voice, and a working receptionist is created on Telnyx. They can call it from the browser, read call transcripts and change its settings.

People sign in with an email and password. Each person belongs to one or more **teams** (an agency, the sales team, or a single business) as an owner, admin or member, and only sees their team's receptionists. The businesses being served don't need an account: they connect their mailbox from a private link.

## Run it

```bash
cd ~/aibiz/twin-receptionist
bun install
bun run dev
```

Open http://localhost:5173. Settings are read from `~/aibiz/.env` (every option is listed in `.env.example`). The database is Postgres: locally the `twin-pg` Docker container (`docker start twin-pg`), in the cloud Supabase or AWS RDS. Tables are created on startup from `server/migrations/`.

The first account to sign up becomes the owner and the **platform admin** (sees the Telnyx balance) and takes over any receptionists left in the old `data/*.json` files. After that, sign-up is by invite only (Team page), unless `ALLOW_SIGNUP=true`. Invite and password-reset emails need `SMTP_URL` and `MAIL_FROM`; without them invite links are shown to copy and reset links are printed in the server log.

### Roles

| | Member | Admin | Owner |
| --- | --- | --- | --- |
| Set up, change and test receptionists, connect email, calendars, texting | ✓ | ✓ | ✓ |
| Buy phone numbers, delete receptionists, invite and remove people | | ✓ | ✓ |
| Make or remove owners, rename the team | | | ✓ |

### In the cloud

**Production runs on AWS (Sydney). Where everything is, how to deploy, and how to change the domain: [deploy/AWS.md](deploy/AWS.md).**

`deploy/` holds the Dockerfile, Caddy and AWS setup. The server needs `DATABASE_URL`, `PUBLIC_URL` (its https address: used for the receptionists' booking tools, connect/invite/reset links, Google/Microsoft sign-in and secure cookies), `HOST=0.0.0.0`, `TELNYX_API_KEY` and `MAILBOX_KEY` (keep it forever: it decrypts saved mailbox logins). Run **one** instance: the mail checker and booking locks live in the process. Changing `PUBLIC_URL` and restarting re-points every receptionist's tools.

For booking on real calls and texts on a laptop, also run this and leave it open (in the cloud, `PUBLIC_URL` does this job):

```bash
bun run tunnel          # gives Telnyx a public address for the booking tools
```

## Pages

| Address | What it is |
|---|---|
| `/` | The client list: one card per business, plus "New receptionist". |
| `/new` | Four steps to create a receptionist for a business. |
| `/clients/<id>` | One receptionist: test call, call transcripts, edit, delete. |
| `/site` | A draft sales page a client business would see. Not linked from the dashboard. |

## What is real and what is missing

| Part | State |
|---|---|
| Creating, editing and deleting a receptionist | Real. Calls the Telnyx AI Assistants API. |
| Browser test call and call transcripts | Real. Uses Telnyx's web widget and conversations API. Calls cost money. |
| Accounts | Email and password (argon2id), 30-day sessions (only token hashes stored), teams with owner/admin/member roles, invites (7 days), password reset (1 hour), switching between teams. Every receptionist route is scoped to the signed-in team; another team's receptionist answers "not found". No billing yet: every team's numbers and calls run on the platform's Telnyx account. |
| Storage | Postgres (`server/db.ts`, `server/migrations/`). Row level security is switched on with no policies, so Supabase's public Data API can't read the tables; the server connects as the owner. Mailbox logins are encrypted with `MAILBOX_KEY`. |
| Call summaries | Real. Telnyx writes a short summary of each call, shown above the transcript. |
| Phone number | Search, buy and connect are built. Searching is tested. Buying is not: it spends Telnyx balance, and Telnyx may ask for address documents. |
| Email | Real. The business connects its own mailbox from a private **connect link** (`/connect/<token>`, made in the Email card, valid 7 days) with an app password: Gmail/Google Workspace and IMAP providers. They choose **drafts** (replies wait in Drafts) or **send** (replies go out automatically, with an `Auto-Submitted` header, max 20 an hour and 3 per person a day; over the limit falls back to drafts). Replies offer real free times when a calendar is connected. **Sign in with Google / Microsoft** (OAuth, no passwords) is built and switches on when the client IDs are in `.env` (see below); untested against the real providers until then. Without them, Gmail uses app passwords and Outlook can't connect. Tested end to end on a local test mail server (`twin-testmail` Docker container), not yet on a real Gmail. |
| Texting | Built, hosted by Telnyx (no public server needed). Each receptionist gets a Telnyx messaging profile linked to it, set to send only to Australia with a US$5/day spend cap. Any mobile number attached to that profile has its texts answered with the same script as calls. Conversations show under "Recent calls and texts". Not yet tested with a real number: it needs a mobile (about US$12 to start). |
| Test area | The top card on each receptionist has Call, Text and Email tabs. Text is a simulator: real replies from the receptionist in texting mode, nothing sent to a phone (fractions of a cent per reply). Email shows the draft it would save, or why it would skip the email, without touching a mailbox. |
| Calendar booking and CRM | Built in, no gateway. Each receptionist books into one of: the **built-in calendar** (appointments kept in this app's database and listed on the receptionist's page; nothing to connect), **Google Calendar** (free/busy + new events on the business's main calendar, scope `calendar.events`) or **Outlook / Microsoft 365** (Microsoft Graph, `Calendars.ReadWrite`). Google and Outlook are connected by signing in, either by a team member from the dashboard or by the business from its connect link. Every booking and callback is saved here, **emailed to the business** (needs `SMTP_URL`), and optionally **POSTed as JSON to a webhook** for a CRM (HubSpot, GoHighLevel, Zapier, Make...), signed with `X-Twin-Signature` (HMAC-SHA256). This server works out free times from the business's hours and the calendar's busy times, and books one at a time per business so a slot can't be taken twice. Telnyx reaches it at `PUBLIC_URL/hooks/*` (each receptionist's own key). Google and Outlook are tested against stand-ins for their APIs, not yet against real accounts. |

Without signing in, only these work: `/hooks/*` (each client's key), `/api/connect/*` (the business's link token, which only shows and changes that business's mailbox connection, and refuses private network addresses as mail servers), the Google/Microsoft sign-in callbacks, and sign-in, sign-up, invite and reset. Changes from another website's page are refused (Origin check).

## Sign in with Google / Microsoft (setup)

Add to `~/aibiz/.env`, then restart `bun run dev`:

```
GOOGLE_CLIENT_ID=...        GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...     MICROSOFT_CLIENT_SECRET=...
# OAUTH_REDIRECT_BASE=https://your.domain   (default http://localhost:8791)
```

Redirect URIs to register: `<OAUTH_REDIRECT_BASE>/api/oauth/google/callback` and `<OAUTH_REDIRECT_BASE>/api/oauth/microsoft/callback`.

The same sign-in is used for mailboxes and for calendars; it asks only for what that connection needs.

- **Google:** Cloud console, new project, enable the **Gmail API** and the **Google Calendar API**, Google Auth Platform (consent screen, External) with the `https://mail.google.com/` and `https://www.googleapis.com/auth/calendar.events` scopes, add test users, then a Web application OAuth client. In Testing mode only listed test users can connect and their sign-in lapses after 7 days. Going live means Google verification plus a yearly third-party security assessment (CASA), because reading Gmail is a restricted scope. The calendar scope is only "sensitive": going live with calendars alone needs Google verification but no security assessment.
- **Microsoft:** Entra admin centre, App registrations, new app for "any organizational directory and personal Microsoft accounts", Web redirect URI, a client secret, delegated permissions `IMAP.AccessAsUser.All`, `SMTP.Send`, `Calendars.ReadWrite` (Microsoft Graph), `offline_access`, `openid`, `email`. Some Microsoft 365 organisations need an admin to approve the app, and many have IMAP or authenticated SMTP switched off per mailbox.
- A business on another device can only finish signing in once `OAUTH_REDIRECT_BASE` is a stable public https address (real hosting), not localhost or a changing tunnel.

## Where things live

- `src/brand.ts` and the tokens at the top of `src/styles.css`: name, support email, colours. Change these to rebrand a copy for each seller.
- `src/lib/shared.ts`: industries, default hours and services, shared types.
- `server/prompt.ts`: turns a business's settings into the receptionist's script. Edit this to change how it behaves on calls.
- `server/index.ts`: the API routes and every Telnyx call.
- `server/accounts.ts`: sign-up, sign-in, sessions, teams, roles, invites, password reset. `src/pages/Auth.tsx` and `src/pages/Team.tsx` are their pages.
- `server/db.ts`, `server/migrations/`: the database connection and tables. `server/store.ts`: receptionists.
- `server/legacy.ts`: one-off import of the old JSON files into the first account.
- `server/numbers.ts`: number search, purchase and call summaries.
- `server/booking.ts`: free times, booking, callbacks, the receptionist's tool definitions and the `/hooks` endpoints they call.
- `server/calendars.ts`: the built-in, Google and Outlook calendars (busy times and booking). `server/notify.ts`: booking emails and the CRM webhook.
- `scripts/tunnel.ts`: opens the public address and points every receptionist's tools at it.
- `server/simulator.ts`: the Text and Email test tabs.
- `server/texting.ts`: switching texting on, attaching numbers for texts, and the test text.
- `server/oauth.ts`: Sign in with Google/Microsoft for mailboxes (PKCE, refresh tokens, access-token cache).
- `server/connect.ts`: the business's private connect link.
- `src/pages/Connect.tsx`: the page the business sees from that link.
- `server/email.ts`: reads a client's mailbox and drafts replies. Edit the prompt in `decide()` to change how replies read.
- `src/pages/`: client list, setup steps, receptionist page, sales page.
