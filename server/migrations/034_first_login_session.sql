-- The session opened by the one-time first sign-in link (server/accounts.ts firstLogin). Only that session may
-- set the owner's first password without a current one (and only for 24 hours). Repeatable.
alter table sessions add column if not exists first_login boolean not null default false;
