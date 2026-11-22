# Answered AI + Twin Receptionist: the merged version

Decisions taken on 22 Nov 2026 (Ronan asked for an isolated, fixed-up merged build; Jesse's live Answered AI is not touched).

## What we are building

One product, branded **Answered**, running on the **Twin engine**:

- **Engine (kept from Twin):** Bun + Postgres on AWS Sydney, Telnyx AI Assistants for calls, SMS and Australian numbers, the booking tools (built-in calendar, Google/Outlook), callbacks, email/webhook follow-ups, three tiers (platform team, agencies, end businesses), invites, View as, branding, test lab, number requests.
- **Product surface (taken from Answered):** the brand, the light visual style, the customer workspace layout (sidebar: Dashboard, Calls, Bookings, Follow-ups, Reports, Receptionist, Settings) and the owner-console ideas (failed calls, incidents, usage, audit).
- **Dropped:** Vapi, Twilio, Supabase/Lovable as the app backend. Answered's marketing site can stay on Lovable.

## Isolation

- **Jesse's Answered** (Lovable project 15564634…, Supabase giylacbpdkojikuxvbse): read-only. Nothing is written to it. A code snapshot lives in `../answered-ai-snapshot` (commit 250d245), with no customer data copied.
- **Current Twin production** (https://13-211-218-61.sslip.io, branch `main`): unchanged by this work.
- **Merged build:** branch `answered`, deployed as a separate app container with its own database (`answered` on the same RDS instance) and its own address. Its secrets live under SSM `/answered/`.

## Why the Twin engine

The audit of Answered (22 Nov 2026) found: an unauthenticated Vapi webhook writing with the service role; no calendar or booking path; settings never pushed to Vapi; no notifications; real callers stored in the public demo workspace; no working admin account. Twin already has authenticated tool hooks, duplicate-safe booking, failed-booking-to-callback, email/webhook follow-ups and tested tenant isolation. Rebuilding Twin's engine inside Answered would take longer than putting Answered's screens on Twin.

## Order of work

1. Snapshot Answered code (done) and keep it as the design reference.
2. Branch `answered`: brand + light theme, customer workspace with a sidebar and a Dashboard overview page.
3. Isolated deployment of the branch (own container, database, address).
4. Owner console additions: stored call events (for failed calls and retries), incidents, usage per agency, audit log.
5. Pilot connectors per the connector plan: Google Calendar verification, SES email, Telnyx AU number, Cliniko or ServiceM8 depending on the pilot business.
