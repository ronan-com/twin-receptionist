# Answered UI on the Twin engine: build spec

Owner decision (Ronan, 22 Nov 2026): our own isolated product, branded **Answered**, using **Answered's real screens** (copied to `~/aibiz/answered-ai-snapshot`, commit 250d245) on top of **Twin's engine** (this repo). Agencies and businesses can both sign up on their own, and the full flow works end to end.

## Hard rules (every agent)

1. **Never touch Jesse's original Answered.** No Lovable tool that writes (send_message, create_draft, deploy, query_database with writes, enable_database…), and no queries at all against its database. The snapshot folder is read-only reference: copy from it, never edit it.
2. **Never deploy the main Twin app** (`deploy/aws/deploy.sh`) and never change `main`. Work only on your git branch. Only the foundation and QA agents deploy, and only with `bash deploy/answered/deploy.sh` (the isolated build at https://answered.13-211-218-61.sslip.io).
3. Only edit the files your area owns (below). If you need something in a shared file, keep it minimal and say so in your report.
4. No secrets in code, logs or reports. No real customer data anywhere.
5. Every change typechecks (`bunx tsc --noEmit`), builds (`bun run build`) and is tested end to end before you report done. Report honestly what passed, what failed and what you didn't test.

## Architecture

- **Server:** unchanged stack (Bun + Postgres, `server/`). New HTTP areas live in their own modules under `server/routes/` and are called from `server/index.ts` (the foundation wires them once).
- **Frontend:** Answered's UI replaces ours. Vite + React + **TanStack Router (file-based, `@tanstack/router-plugin/vite`)** + **TanStack Query** + **Tailwind v4** + **shadcn/ui (Radix)** + lucide, exactly like the snapshot, so route files copy across nearly verbatim.
  - Answered used TanStack **Start** (SSR). We use plain TanStack Router (client-side): `__root.tsx` renders `<Outlet/>`, with no `HeadContent`/`Scripts`/server functions. `src/routes/api/*` (the Vapi webhook) is dropped.
  - The **data layer** is the only big change: `src/integrations/supabase/*` is removed. `src/lib/app/queries.ts` keeps its exported names and return shapes, but each query calls our API. Direct `supabase.from()/rpc()` calls in pages are replaced by functions in `src/lib/api/*.ts`.
  - Types: keep Answered's `src/lib/app/types.ts` row shapes as the UI contract; servers return JSON in those shapes (snake_case fields as Answered expects).
- **Theme:** Answered's `src/styles.css` (Stripe-like light palette, Inter). Our old `styles.css` and old pages (`src/pages/*`, `src/components/*`) are retired as their replacements land. Agency-only features with no Answered page (agencies list, number requests, test lab, View as, branding) are rebuilt as console pages in Answered's style.

## Roles and where they land

| Who | How they get in | Lands on | Can do |
|---|---|---|---|
| Platform admin (`users.platform_admin`) | first account (FIRST_ADMIN_EMAIL lock) | `/admin` (console, variant "platform") | everything, all agencies and businesses, View as, test lab, number requests, agencies |
| Agency staff (owner/admin/member of an agency org) | **self-serve agency sign-up**, or invite | `/admin` (console, variant "agency", scoped to their org) | their businesses (create receptionists, settings, share with customers), team, branding, request numbers |
| Business manager (customer with `client_access.role = 'manager'`) | **self-serve business sign-up** (business is created under the platform's "Direct" org), or invited by an agency as manager | `/app` (workspace) | their own business: receptionist settings, knowledge, call handling, integrations (calendar/email), team (invite more managers/viewers), view calls/bookings/follow-ups/reports |
| Business viewer (`client_access.role = 'viewer'`) | invited by agency or manager | `/app` read-only | view only (today's customer dashboard behaviour) |

Map to Answered's roles: manager ≈ owner/admin, viewer ≈ read_only. A business user with several businesses switches with the WorkspaceSwitcher.

## Sign-up flows (must work end to end)

- `/signup` asks "I run a business" or "I'm an agency".
- **Agency:** name, email, password, agency name → creates the org + owner, signs in, lands on `/admin` with a "create your first receptionist" call to action.
- **Business:** name, email, password, business name, industry, suburb/timezone → ensures the platform "Direct" org exists (`orgs.direct = true`, `platform_telnyx = true`), creates the receptionist (Telnyx assistant via the existing `createClient` path), creates the user as `customer` + `client_access(manager)`, signs in, lands on `/app`.
- Abuse limits: max 5 sign-ups per IP per hour; the platform admin can pause any agency/business. The very first account is still locked to FIRST_ADMIN_EMAIL. (No email verification yet: no email provider is set up. Note it in the UI copy only where honest.)

## New backend data (one migration by the foundation: `010_answered_ui.sql`)

- `client_access.role text not null default 'viewer' check (role in ('viewer','manager'))`.
- `orgs.direct boolean not null default false` (the platform's own org for self-serve businesses).
- `call_log` — our own record of every call/text per receptionist (id, org_id, client_id, provider_call_id unique, channel, from_number, to_number, started_at, ended_at, duration_seconds, status, outcome, summary, created_at, updated_at), filled by a sync job that pulls recent Telnyx conversations per receptionist every minute (demo receptionists use sample data) and upserts by provider_call_id. Lists, metrics and the console read from this table.
- `audit_log` (id, org_id, client_id null, actor user_id, action, detail jsonb, created_at) written on key actions.
- `incidents` (id, org_id null, client_id null, kind, message, detail jsonb, status open/resolved, created_at, resolved_at) written when hooks, syncs or provider calls fail.
- `knowledge_items` (id, client_id, question, answer, enabled, created_at, updated_at) — included in the receptionist's instructions.
Areas needing more schema add their own migration with their reserved number: workspace-read 011, workspace-manage 012, console 013.

## Areas and file ownership

| Area | Owns |
|---|---|
| **F. Foundation** (first, alone) | tooling/package.json, vite config, router root + `_authenticated` layout, AppShell/BrandMark/UserMenu/WorkspaceSwitcher, `src/styles.css`, `src/components/ui/*`, `src/lib/app/{workspace,queries,types,format,csv,date-range,metrics,constants}` skeleton (queries delegate to area files), `src/lib/api/base.ts`, auth pages (login, signup, reset, invite accept), migration 010, `server/routes/signup.ts`, call_log sync, audit/incident helpers, route module stubs, placeholder route files for every page, `scripts/e2e/*` |
| **W. Workspace (read)** | `src/routes/_authenticated/app/{index,calls,bookings,leads,analytics}.tsx`, `src/components/app/{CallList,CallDetailSheet,Charts,DashboardJourney,DataTable,DateRangeSelect,StatusBadge}.tsx`, `src/lib/api/workspace.ts`, `server/routes/workspace.ts`, migration 011 |
| **S. Workspace (manage)** | `src/routes/_authenticated/app/{receptionist,knowledge,phone-numbers,integrations,team,settings}.tsx`, `src/lib/api/manage.ts`, `server/routes/manage.ts`, migration 012, knowledge → prompt in `server/prompt.ts` |
| **C. Console** | `src/routes/_authenticated/admin/*` (+ new: agencies, numbers requests, test-lab, branding), `src/lib/api/console.ts`, `server/routes/console.ts`, migration 013 |
| **M. Marketing** | `src/routes/index.tsx`, `src/components/{CallGlobe,HeroRibbonCanvas,ProductBookingDemo,RealCallDemo,worldLand}.ts(x)`, `src/assets/**`, `public/**` (images fetched read-only from the public site https://answeredai.co where needed) |
| **Q. QA** (last) | tests in `scripts/e2e/`, fixes anywhere (small, explained), final deploy to the isolated build |

## Testing

- `scripts/e2e/setup.sh` takes `E2E_PORT` (default 8899) and `E2E_DB` (default agency_test) and reads env from `TWIN_ENV` (default `/home/ronan/aibiz/.env`), so agents in separate worktrees can run their own server and database at the same time. Ports/DBs: W 8901/e2e_w, S 8902/e2e_s, C 8903/e2e_c, M 8904/e2e_m, Q 8905/e2e_q.
- Browser tests use `puppeteer-core` (devDependency) with `/snap/bin/chromium` (headless "new", `--no-sandbox`). Snap Chromium cannot read files under `/tmp`: put upload fixtures under `$HOME`.
- Locally the phone provider key is fake: stub `/api/...` carrier responses in the browser, or use the test-lab demo receptionist (assistant id `demo-…`), which never calls Telnyx.
