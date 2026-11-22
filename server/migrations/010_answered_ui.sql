-- The Answered UI on the Twin engine (docs/ANSWERED_UI_PORT.md, "New backend data").

-- A business user is a manager (runs their receptionist, invites people) or a viewer (read-only).
alter table client_access add column role text not null default 'viewer' check (role in ('viewer', 'manager'));

-- The platform's own org for businesses that sign up by themselves (one at most).
alter table orgs add column direct boolean not null default false;
create unique index orgs_direct on orgs (direct) where direct;

-- Our own record of every call and text per receptionist, filled by the sync job
-- (server/callsync.ts) from the phone provider's conversations, upserted by provider_call_id.
create table call_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  client_id uuid not null references clients on delete cascade,
  provider_call_id text not null unique,
  channel text not null default 'call',
  from_number text,
  to_number text,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  status text not null default 'completed',
  outcome text,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index call_log_client on call_log (client_id, started_at desc);
create index call_log_org on call_log (org_id, started_at desc);

-- Who did what (server/audit.ts).
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  client_id uuid references clients on delete set null,
  actor uuid references users on delete set null,
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_org on audit_log (org_id, created_at desc);
create index audit_log_client on audit_log (client_id, created_at desc) where client_id is not null;

-- Things that went wrong: hooks, syncs, provider calls (server/incidents.ts).
create table incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs on delete cascade,
  client_id uuid references clients on delete cascade,
  kind text not null,
  message text not null,
  detail jsonb not null default '{}',
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index incidents_status on incidents (status, created_at desc);
create index incidents_client on incidents (client_id, kind) where status = 'open';

-- Questions and answers the business adds; included in the receptionist's instructions.
create table knowledge_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients on delete cascade,
  question text not null,
  answer text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_items_client on knowledge_items (client_id, created_at);

alter table call_log enable row level security;
alter table audit_log enable row level security;
alter table incidents enable row level security;
alter table knowledge_items enable row level security;
