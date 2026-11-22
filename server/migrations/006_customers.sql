-- End customers (the businesses an agency serves) get their own read-only login to
-- see the calls, bookings and follow-ups of their own receptionist(s).

alter table memberships drop constraint if exists memberships_role_check;
alter table memberships add constraint memberships_role_check check (role in ('owner', 'admin', 'member', 'customer'));
alter table invites drop constraint if exists invites_role_check;
alter table invites add constraint invites_role_check check (role in ('owner', 'admin', 'member', 'customer'));

-- A customer invite is for one receptionist.
alter table invites add column client_id uuid references clients on delete cascade;

create table client_access (
  user_id uuid not null references users on delete cascade,
  client_id uuid not null references clients on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, client_id)
);
create index client_access_client on client_access (client_id);
alter table client_access enable row level security;
