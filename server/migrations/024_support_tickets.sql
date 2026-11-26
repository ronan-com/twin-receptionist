-- Help tickets (server/tickets.ts): "Contact support" in the help menu.
--   route 'platform': an agency's owner or admin writing to the setup provider. Pushed to the setup site
--                     (POST /api/tickets, with the support sync token); its replies come back with GET /api/tickets/updates.
--   route 'agency':   a business user writing to their own agency. Stays in this app: the agency's "Support requests" list.
-- Screenshots are small images (at most 2 MB) kept on the message. No keys are ever stored here.
create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  client_id uuid references clients on delete set null,
  user_id uuid references users on delete set null,
  from_name text not null default '',
  route text not null check (route in ('platform', 'agency')),
  subject text not null,
  -- open: waiting for a reply from support/agency. waiting: waiting for the person who asked. closed.
  status text not null default 'open' check (status in ('open', 'waiting', 'closed')),
  -- What the form attached: page address (no query), app version, browser, agency and receptionist ids.
  context jsonb not null default '{}',
  -- Something new for the person who asked / for agency staff (on 'agency' tickets): the unread dot.
  requester_unread boolean not null default false,
  agency_unread boolean not null default false,
  -- 'platform' tickets: something still to send to the setup site, and why a send was refused for good.
  needs_push boolean not null default false,
  push_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_org on support_tickets (org_id, updated_at desc);
create index support_tickets_user on support_tickets (user_id, updated_at desc);
alter table support_tickets enable row level security;

create table support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets on delete cascade,
  -- requester: the person who asked (or their agency's team on a platform ticket). agency: agency staff replying to a business. support: the setup provider.
  author text not null check (author in ('requester', 'agency', 'support')),
  author_name text not null default '',
  body text not null,
  shot bytea,
  shot_type text,
  shot_name text,
  -- A reply that came from the setup site keeps its id there, so a repeat is ignored.
  remote_id bigint,
  pushed boolean not null default false,
  created_at timestamptz not null default now()
);
create index support_ticket_messages_ticket on support_ticket_messages (ticket_id, created_at);
create unique index support_ticket_messages_remote on support_ticket_messages (ticket_id, remote_id) where remote_id is not null;
alter table support_ticket_messages enable row level security;
