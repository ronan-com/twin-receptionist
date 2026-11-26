# Wording changes for Jesse to approve

Your materials were written for the Vapi, Supabase and Netlify build, where our team ran the infrastructure. The buyer now sets everything up themselves through a private setup link on setup.chloeeai.co. They connect their own Railway, Telnyx, Resend, domain and (optionally) Google or Microsoft accounts. The wizard installs their dashboard at app.[THEIR DOMAIN], and we have no login to their accounts after that. Their app shares health counts with us unless they switch it off, and we can sign in only if they turn Support access on.

Each line below quotes something that's now wrong, then gives the replacement. Tick or change each one.

## Your email to Ronan (26 November)

| # | Now says | Change to |
|---|---|---|
| 1 | "Our team handles the infrastructure." | "The buyer connects their own accounts through a private setup link. Once it's live, we have no login to their accounts. Stats sharing is on by default and can be turned off; support access is off unless they turn it on." |
| 2 | "The buyer should open one owner invitation, set a password and be able to start onboarding centres." | "The buyer opens their setup link, connects their accounts, then creates the owner account at app.[THEIR DOMAIN] and starts adding centres." |
| 3 | "Connect a Chloe-controlled Vapi assistant and Australian number" | "The buyer buys an Australian number for each centre from their dashboard (Buy a number). It runs on their own Telnyx account." |
| 4 | "Give the buyer control of the site, forms, hosting, database, phone, calendar, sender, source and recovery." | "Hosting, database, phone, email and calendar are in the buyer's own accounts from the start. Only the website, forms, brand files and business pack need handing over." |

## buyer-email.txt (replaced by buyer-pack/buyer-email.txt)

| # | Now says | Change to |
|---|---|---|
| 5 | "Open the private owner invitation sent to [buyer's work email] to choose your password." | "Open your private setup link. When it finishes, open app.[THEIR DOMAIN] and click Create an account with your owner email." |
| 6 | "From then on you can use [owner dashboard] to manage your centres, receptionists and calls." | "From then on you manage your centres, receptionists and calls at app.[THEIR DOMAIN]." |
| 7 | "Visit [business website] and call [verified Chloe number] to hear the service." | "Test-call any receptionist from its page with Talk to this receptionist." |
| 8 | "send the director [centre setup form], then open Add a client in your dashboard." | "Collect the director's answers with the Centre setup form, then open Clients and click New receptionist." |
| 9 | "It includes the software and brand files" | "It includes the brand files" (the software is installed by the setup link, not handed over as files) |
| 10 | "The ownership invitations for [transferred services] use your work email." | "You open each account yourself with your work email. There's nothing to transfer." |

## Chloe-Owner-Quickstart.pdf (replaced by buyer-pack/owner-quickstart.md)

| # | Now says | Change to |
|---|---|---|
| 11 | "Once your owner invitation is active" | "Once your setup link has finished" |
| 12 | "Accept the invitation sent to your work email and choose your password." | "Open app.[THEIR DOMAIN], click Create an account and use your owner email." |
| 13 | "Open Owner dashboard to see clients, receptionists and calls." / link "Owner dashboard" | "Open app.[THEIR DOMAIN]." Link to that address. |
| 14 | "Open Add a client, enter the centre and invite the director from Team using their work email." | "Open Clients, click New receptionist and pick Childcare or early learning centre. Then invite the director from Customers with access on the centre's page." |
| 15 | "Confirm the centre's permissions for the phone and tour calendar." | "Connect the centre's tour calendar in its Settings, Integrations, and buy its number from the centre's page." |
| 16 | Link "Centre dashboard" | "the centre's page (Open and edit)" |
| 17 | Link "Add a client" | "New receptionist" |

## 00-Start-Here.pdf

| # | Now says | Change to |
|---|---|---|
| 18 | "Give the developer the source. The separate private source ZIP contains the editable site, dashboards, voice and booking integration, database migrations, tests and deployment guide. Start with README.md." | "Set up your agency. Your private setup link installs the software into your own Railway account. There's nothing to build or deploy." |
| 19 | "The buyer controls the accounts. Jesse or the technical operator configures the service." | "The buyer controls the accounts and sets up each centre from their dashboard. A centre director approves its answers, calendar and routes." |
| 20 | "3 Launch the backend: Provision a separate production database and host. Apply migrations, configure authentication and backups, verify email and bootstrap the buyer's owner role." | "3 Run the setup link: connect Railway, Telnyx, Resend, your domain and (optionally) calendars, press Install, then turn on database backups in Railway." |
| 21 | "Connect the buyer's Vapi workspace, Google tour calendar and verified email sender." | "Buy the centre's number from its page, and connect its Google or Outlook calendar from its Integrations. Email is set up by the wizard." |
| 22 | "Transfer source and files to a buyer-controlled private folder or repository. Invite the owner to the domain, hosting, database, form and relevant suppliers." | "Put the business pack in a buyer-controlled folder. Hosting, database, phone and email are already in the buyer's name." |
| 23 | "Agree Jesse's support hours, end date and any continuing access" / "reduce temporary access" | "Agree Jesse's support hours and end date. We keep no software access after install except what the buyer chooses: health stats are on by default and can be turned off, and support access is off unless they turn it on. The buyer deletes the Railway (and Cloudflare, if used) setup tokens." |
| 24 | "The buyer's production URL and login are pending." | "The buyer's dashboard is at app.[THEIR DOMAIN]." |

## Owner-Operating-Guide.pdf

| # | Now says | Change to |
|---|---|---|
| 25 | "/login … /operator … /app … /admin" | Your dashboard: Overview, Clients, Calls, Phone Numbers, Settings. Each centre's workspace: Dashboard, Calls, Bookings, Follow-ups, Receptionist, Reports, Settings. |
| 26 | "use 'Publish greeting and FAQs to phone' and test one call." | "Change the greeting under Receptionist, or the answers under Business knowledge, then test with Talk to this receptionist." |
| 27 | "Use separate Google Calendar events titled 'Chloe tour slot', marked Free with no attendees. Each slot holds one family. The agent checks up to 21 days ahead with at least one hour's notice. A successful booking changes it to busy…" | "Tours are offered inside the receptionist's active hours, one appointment length at a time, skipping anything already busy in the centre's calendar. Add a busy event to block a time. Each booking adds one event." |
| 28 | "The source README contains deployment and restore steps; record the result of a restore to a separate test project." | "Backups and restores are on the Postgres service's Backups tab in Railway. A restore goes into the same project. See operating-guide.md." |
| 29 | "Provider portals remain the authority for number routing and charging." | "The Telnyx portal shows every number, call and charge." |

## Account-and-Supplier-Register.csv

| # | Row | Now says | Change to |
|---|---|---|---|
| 30 | Database, auth and backups | "Supabase … provision, migrate and validate backup/restore" | "Railway Postgres, inside the app's Railway project. Created by the setup link. Turn on backups on its Backups tab." |
| 31 | Voice agent and call processing | "Vapi … US$0.05/min Vapi hosting" | "Telnyx (voice AI, numbers and minutes), prepaid credit. Minimum top-up US$10. See telnyx.com/pricing." |
| 32 | Carrier and numbers | "Buyer-approved carrier or imported number" | "Telnyx. Bought from the dashboard. Australian numbers need proof of address, about three days." |
| 33 | Production server | "Node 24 host / Docker … Buyer creates hosting account, sets secrets" | "Railway Hobby plan, US$5 a month including US$5 of usage. Set up by the setup link." |
| 34 | Platform administrator | "Chloe /login, /operator and /admin on eventual buyer host" | "app.[THEIR DOMAIN], owner email from the setup wizard." |
| 35 | Staff summary delivery | "Resend … grant server key" | "Resend. The wizard creates a send-only key for the buyer's domain. Free plan: 3,000 emails a month." |
| 36 | Centre calendar and confirmations | "Google Calendar … Authorise integration, share a separate tour calendar per centre" | "Google or Microsoft app from the wizard's Calendars step. Each centre signs in from its Integrations." |
| 37 | Monitoring and restore | "Host, Supabase, voice, mail and payment provider portals" | "Railway, Telnyx, Resend and Stripe portals." |
| 38 | (new row) | | "Cloudflare (optional): DNS, only if the wizard handled it. Free plan." |

## Asset-Schedule.csv and Launch-Checks-and-Evidence.csv

| # | Now says | Change to |
|---|---|---|
| 39 | "Software: Chloe source, migrations, locked dependencies, runtime setup, tests, server config and developer runbook." | "Software: installed by the setup link into the buyer's Railway project." (see open question on source) |
| 40 | "Voice and booking: Agent template, centre FAQs, protected provider endpoint, slot search, booking, callback and summary code." | "Voice and booking: childcare receptionist preset with seven starter answers, calendar booking, staff transfer, callbacks and booking emails." |
| 41 | "Independent software: Verified locally. Install from source, build and run handover tests in a separate environment." | "Agency install: setup link finishes and app.[THEIR DOMAIN]/api/health answers." |
| 42 | "Production dashboard … No Chloe production login." | Replaced by buyer-pack/acceptance-checklist.csv. |

## Centre pack (03-Onboard-a-centre)

| # | Now says | Change to |
|---|---|---|
| 43 | Centre-Intake-Form: "Invite the booking account to the selected calendar through your calendar provider." | "The centre signs in to its tour calendar from its Integrations page (Google or Outlook)." |
| 44 | Centre-Intake-Form: "We use the information you approve here to configure the receptionist" | Fine as is, but "we" is now the buyer's agency, not Twin. |
| 45 | Privacy-and-Call-Wording: "the release disables audio recording in the supplied assistant configuration." | Needs Ronan to confirm. Recording is off by default, but the ready-made greetings say "this call is recorded". Transcripts are kept either way. |
| 46 | Privacy-and-Call-Wording: "Identify the centre, Chloe operator, actual voice, calendar and email suppliers, countries of processing" | List: the buyer's agency, Telnyx (voice and calls), Railway (hosting, data stored outside Australia, see open questions), Resend (email), Google or Microsoft (calendar). |
