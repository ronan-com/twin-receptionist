-- Agencies don't buy phone numbers themselves: they ask, and the platform team
-- buys and connects one on our account.

create table number_requests (
  id uuid primary key,
  org_id uuid not null references orgs on delete cascade,
  client_id uuid not null references clients on delete cascade,
  kind text not null check (kind in ('local', 'mobile')),
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'done', 'declined')),
  phone_number text,
  reason text not null default '',
  requested_by uuid references users on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index number_requests_org on number_requests (org_id, created_at desc);
create index number_requests_client on number_requests (client_id, created_at desc);
create index number_requests_status on number_requests (status, created_at);
alter table number_requests enable row level security;
