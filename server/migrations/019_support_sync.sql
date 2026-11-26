-- Support access and the health heartbeat (server/supportSync.ts). Repeatable.

-- The special support person ("<seller> support") that a one-time sign-in link signs in as.
-- It has no password and no team membership; it can't sign in the usual way.
alter table users add column if not exists support boolean not null default false;
-- A session opened by a support sign-in: read-only, and only while Support access is on.
alter table sessions add column if not exists support boolean not null default false;

-- One-time sign-in links the setup provider asked for (60 seconds, single use). Only hashes are kept.
create table if not exists support_login_links (
  token_hash text primary key,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table support_login_links enable row level security;
