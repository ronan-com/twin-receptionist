-- Calendars connected directly (no n8n). A receptionist books into one of:
--   builtin   - appointments kept here, in calendar_events
--   google    - the business's Google Calendar (calendar_links holds the sign-in)
--   microsoft - the business's Outlook / Microsoft 365 calendar

create table calendar_links (
  client_id uuid primary key references clients on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  account text not null,
  secret text not null,                 -- refresh token, sealed with MAILBOX_KEY
  calendar_id text not null default 'primary',
  last_error text not null default '',
  connected_at timestamptz not null default now()
);

create table calendar_events (
  id uuid primary key,
  client_id uuid not null references clients on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  title text not null,
  details text not null default '',
  created_at timestamptz not null default now()
);
create index calendar_events_client on calendar_events (client_id, starts_at);

alter table calendar_links enable row level security;
alter table calendar_events enable row level security;

-- Receptionists set up on n8n: its demo calendar becomes the built-in one, and a
-- Google one keeps its choice but needs connecting again.
update clients set data = jsonb_set(data, '{booking,provider}', '"builtin"')
  where data->'booking'->>'provider' = 'demo';
update clients set data = data #- '{booking,workflowId}' #- '{booking,tableId}'
  where data ? 'booking';
