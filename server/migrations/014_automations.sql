-- Per-receptionist automations (area T, server/automations.ts): transfer to a person,
-- text-back after a call, call recording, language, call limits, after-hours mode.
-- Kept out of clients.data so saving a receptionist never overwrites them.
create table client_automations (
  client_id uuid primary key references clients on delete cascade,
  settings jsonb not null default '{}',
  -- When the settings last reached the phone provider, and the last error doing so.
  applied_at timestamptz,
  apply_error text,
  -- When text-back was last switched on: calls before that are never texted.
  text_back_since timestamptz,
  updated_by uuid references users on delete set null,
  updated_at timestamptz not null default now()
);

-- One row per call the text-back has dealt with (sent, skipped or failed), so a call
-- is never texted twice and the page can show what happened.
create table automation_texts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients on delete cascade,
  provider_call_id text not null unique,
  kind text not null check (kind in ('after_call', 'missed_call', 'booking')),
  to_number text,
  status text not null check (status in ('sent', 'skipped', 'failed')),
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index automation_texts_client on automation_texts (client_id, created_at desc);
create index automation_texts_to on automation_texts (client_id, to_number, created_at desc) where status = 'sent';

alter table client_automations enable row level security;
alter table automation_texts enable row level security;
