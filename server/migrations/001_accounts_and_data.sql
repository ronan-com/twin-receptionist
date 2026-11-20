-- Accounts: an organisation (agency, sales team or single business) has members,
-- and owns receptionists ("clients"). Every client query is scoped to an org.

create table orgs (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key,
  email text not null unique,          -- always stored lower-case
  name text not null default '',
  password_hash text not null,         -- argon2id
  platform_admin boolean not null default false,  -- the team running the platform
  created_at timestamptz not null default now()
);

create table memberships (
  org_id uuid not null references orgs on delete cascade,
  user_id uuid not null references users on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user on memberships (user_id);

-- Only hashes of tokens are stored, so a database leak doesn't hand out sessions or links.
create table sessions (
  token_hash text primary key,
  user_id uuid not null references users on delete cascade,
  org_id uuid references orgs on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user on sessions (user_id);

create table invites (
  token_hash text primary key,
  org_id uuid not null references orgs on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'member')),
  invited_by uuid references users on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index invites_org on invites (org_id);

create table password_resets (
  token_hash text primary key,
  user_id uuid not null references users on delete cascade,
  expires_at timestamptz not null
);

create table clients (
  id uuid primary key,
  org_id uuid not null references orgs on delete restrict,
  data jsonb not null,
  connect_token_hash text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index clients_org on clients (org_id, created_at desc);
create unique index clients_connect on clients (connect_token_hash) where connect_token_hash is not null;

-- Mailbox logins are sealed with MAILBOX_KEY (AES-256-GCM) inside data.
create table mailboxes (
  client_id uuid primary key references clients on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table booking_requests (
  id bigserial primary key,
  client_id uuid not null references clients on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index booking_requests_client on booking_requests (client_id, id desc);

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table oauth_states (
  state text primary key,
  data jsonb not null,
  expires_at timestamptz not null
);

-- On Supabase every table in "public" is reachable through its Data API with the
-- public anon key unless row level security is on. The server connects as the
-- database owner (which bypasses RLS), so switching it on with no policies
-- closes that door without affecting the app.
alter table orgs enable row level security;
alter table users enable row level security;
alter table memberships enable row level security;
alter table sessions enable row level security;
alter table invites enable row level security;
alter table password_resets enable row level security;
alter table clients enable row level security;
alter table mailboxes enable row level security;
alter table booking_requests enable row level security;
alter table app_settings enable row level security;
alter table oauth_states enable row level security;
