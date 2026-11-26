-- Follow-up automations (server/followups.ts, server/followupsRun.ts): appointment
-- reminders, missed-call follow-up and review requests.
--
-- Every message is claimed here BEFORE it is sent. (client, dedupe_key, channel) is
-- unique, so a restart or a second server never sends the same reminder, follow-up or
-- review request twice, and the screen can show what happened.
create table followup_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients on delete cascade,
  kind text not null check (kind in ('reminder', 'missed', 'review')),
  channel text not null check (channel in ('sms', 'email')),
  -- What this message is about: reminder:<booking id>, missed:<call id>,
  -- callback:<request id>, review:<booking id>.
  dedupe_key text not null,
  -- The mobile number or email address it went (or would have gone) to.
  to_address text,
  -- Who the customer is (their mobile, else "email:..."), for once-per-customer rules.
  customer_key text,
  status text not null check (status in ('sending', 'sent', 'skipped', 'failed')),
  detail text not null default '',
  created_at timestamptz not null default now(),
  unique (client_id, dedupe_key, channel)
);
create index followup_messages_client on followup_messages (client_id, created_at desc);
create index followup_messages_customer on followup_messages (client_id, kind, customer_key, created_at desc) where status in ('sending', 'sent');
alter table followup_messages enable row level security;

-- When each follow-up was last switched on (kept by the minute job): reminders,
-- calls and callbacks from before that are never acted on.
alter table client_automations add column followups_since jsonb not null default '{}';
