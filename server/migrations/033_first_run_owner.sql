-- First run without the create-owner form (server/accounts.ts bootstrapOwner). Every statement is repeatable.

-- An owner made by the install has no password yet: they sign in once with a link, then set one in Settings
-- (or use "Forgot password"). Setting it needs no "current password" while this is true.
alter table users add column if not exists password_unset boolean not null default false;

-- The one-time sign-in link from the setup wizard's done screen. Only the SHA-256 of the token is kept.
-- A row is deleted when the link is used, and expired rows are swept at start-up.
create table if not exists first_logins (
  token_hash text primary key,
  user_id uuid not null references users on delete cascade,
  expires_at timestamptz not null
);
