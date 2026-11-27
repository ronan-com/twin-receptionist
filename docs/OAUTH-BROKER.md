# Shared Google and Microsoft sign-in (OAuth broker)

Agencies connect Google Calendar, Gmail and Outlook with one click, without making a Google Cloud or Azure app. Bring-your-own keys
still work and always win for the provider they are saved for. Everything below is OFF until you do the checklist and set the flags.

## How it works (and why a broker)

A refresh token only works with the client id AND client secret that issued it, and Google says the secret must stay on a server you
control ([web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)). So the secret cannot be handed to
each agency's app. The setup site keeps it and does the secret-bearing steps:

1. Connect: the agency app asks the setup site (`POST /api/broker/start`, signed with the app's existing sync token) for the Google/Microsoft
   address, sending its own PKCE challenge and its own return address. The person signs in at Google/Microsoft, which returns to
   `<BROKER_URL>/oauth/broker/<provider>/callback`. The setup site swaps the code for tokens, then sends the browser back to the agency
   app with a one-time ticket. The app redeems it (`/api/broker/redeem`) with its PKCE verifier. The ticket lives 2 minutes and is deleted on first use.
2. What the app stores is `brk1.<sealed>`: the Google/Microsoft refresh token encrypted (AES-256-GCM) with a key only the setup site has,
   bound to that agency, provider and purpose. A copy lifted from a database or backup is useless on its own.
3. Refresh: each time the app needs an access token (about hourly per connection, cached in memory) it calls `/api/broker/refresh`;
   the setup site opens the wrapper, calls Google/Microsoft with its secret, and returns only the access token (and a new wrapper if Microsoft rotated it).
4. The setup site stores nothing about anyone's mail or calendar. Tables `broker_states` (10 min) and `broker_tickets` (2 min) hold single-use rows only.

If the setup site is down: access tokens already in memory keep working for up to an hour; after that mail and calendar calls pause with
"temporarily unreachable" and resume on their own. Nobody has to reconnect. Rate limits: 20 starts, 30 redeems, 600 refreshes per agency per hour.
The setup site is already needed for updates, tickets and support, so this adds no new single point.

Consent screens show YOUR app name, not the agency's. Pick a name that is fine for every agency's clients to see (for example "AI Receptionist
Connector"), or have an agency use its own app (Settings, Email and calendars) if it wants its own brand there.

## What each provider needs from you

| | Scopes (what agencies' clients are asked to approve) | Review |
|---|---|---|
| Google Calendar | `calendar.events`, `calendar.events.freebusy` | Sensitive-scope verification: brand + domain + privacy policy + demo video, free, up to about 10 days ([requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)) |
| Gmail | `https://mail.google.com/` | Restricted scope: needs an annual third-party security assessment you pay for ([restricted scopes](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)). Leave `BROKER_GOOGLE_MAIL` off; clients keep using an app password |
| Outlook calendar and mail | `Calendars.ReadWrite`, `IMAP.AccessAsUser.All`, `SMTP.Send` | Publisher verification (free; needs a verified Microsoft Cloud Partner account). Without it, users in most organisations are blocked from consenting ([overview](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)) |

Until Google verifies the app, only 100 test users can use it and, in Testing mode, refresh tokens expire after 7 days. Do not turn the flags on for agencies before verification is approved.

## Owner checklist

### 0. Pick the public address
- [ ] Use `BROKER_URL=https://setup.sageai.agency` (the owner admin domain, already routed on the server; the deploy script routes `/oauth/broker/*` on it). The sslip.io address cannot be verified with Google.
- [ ] Redirect URIs you will register: `https://setup.sageai.agency/oauth/broker/google/callback` and `https://setup.sageai.agency/oauth/broker/microsoft/callback`.
- [ ] A public home page and privacy policy on `sageai.agency` (same domain) that say how Google user data is used: calendar access to check free times and add or change appointments for the receptionist; refresh tokens are kept only inside the agency's own app; nothing is stored by the setup site; data is not sold or used for ads.
- [ ] Verify `sageai.agency` in [Google Search Console](https://search.google.com/search-console) with the same Google account that owns the Cloud project.

### 1. Google Cloud (console.cloud.google.com)
- [ ] New project (for example "AI Receptionist Connector"), owned by a company account, not a personal one.
- [ ] APIs and Services, Library: enable **Google Calendar API**.
- [ ] OAuth consent screen (Google Auth Platform, Branding): app name, support email, logo, home page and privacy policy links on `sageai.agency`, authorised domain `sageai.agency`, developer contact email. User type **External**.
- [ ] Data Access: add scopes `.../auth/calendar.events` and `.../auth/calendar.events.freebusy` (plus `openid`, `email`). Write the justification: the receptionist books callers into the business's calendar and must read free/busy to avoid double-booking; `calendar.events` is the narrowest scope that can create and edit events.
- [ ] Clients, Create client: type **Web application**, authorised redirect URI exactly `https://setup.sageai.agency/oauth/broker/google/callback`. Copy the Client ID and Secret.
- [ ] Record a demo video (YouTube, Unlisted, English): show the consent screen with the app name, the address bar with the client id, and what each calendar scope does in the dashboard.
- [ ] Publish the app (Testing to In production) and submit for verification. Wait for approval before step 4.

### 2. Microsoft Entra (entra.microsoft.com)
- [ ] App registrations, New registration: name as on the Google screen, supported account types **Accounts in any organizational directory and personal Microsoft accounts**, Redirect URI platform **Web**: `https://setup.sageai.agency/oauth/broker/microsoft/callback`.
- [ ] API permissions, Microsoft Graph delegated: `Calendars.ReadWrite`, `offline_access`, `openid`, `email`. Add Office 365 Exchange Online delegated `IMAP.AccessAsUser.All` and `SMTP.Send`.
- [ ] Branding: logo, home page, privacy and terms URLs on `sageai.agency`; publisher domain `sageai.agency` (verified).
- [ ] Certificates and secrets: new client secret, copy the **Value** now. Maximum life is 24 months: put a reminder to rotate it a month early.
- [ ] Publisher verification: join the Microsoft Cloud Partner Program (free), verify the organisation, then Branding, Add MPN ID. Register the app in the same (work or school) tenant the partner account is linked to.

### 3. Set the flags on the setup site (SSM `/setupsite/env/*`, then a normal release via `scripts/release-chloe.sh`)
```
OAUTH_BROKER=1
BROKER_URL=https://setup.sageai.agency
GOOGLE_BROKER_CLIENT_ID=...      GOOGLE_BROKER_CLIENT_SECRET=...
MICROSOFT_BROKER_CLIENT_ID=...   MICROSOFT_BROKER_CLIENT_SECRET=...
# BROKER_GOOGLE_MAIL=1   only after the Gmail security assessment
```
`SETUP_SECRET_KEY` must never change: it seals every connection's token. It is already in SSM and in the backups' key path; keep it that way.

### 4. Turn it on for agencies
- [ ] New installs get `OAUTH_BROKER=1` automatically while the site flag is on. For an installed agency, set `OAUTH_BROKER=1` on its app (Railway variable) and restart it.
- [ ] Check in a test agency: Settings, Email and calendars shows "already working without an app of your own"; the calendar Connect button signs in through your app and the calendar books.
- [ ] To turn it off everywhere: remove `OAUTH_BROKER` on the setup site. Existing connections then ask to be reconnected (their wrappers can no longer be refreshed); an agency's own saved app is unaffected.

### Quick tests after setup (each should pass before telling agencies)
1. Connect a Google calendar from a test agency dashboard; confirm an event can be booked.
2. Wait an hour (or restart the app) and book again: it refreshes through `/api/broker/refresh`.
3. Revoke access in the Google account's security page; the dashboard shows "Connect it again".
4. Stop the setup site for a minute; calendar calls pause with "temporarily unreachable" and recover.
