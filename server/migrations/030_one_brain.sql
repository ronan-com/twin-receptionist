-- One brain: all text AI runs on OpenRouter on both provider paths; texts come through our server.
-- Every statement is repeatable.

-- The agency's own OpenRouter key (sealed like the phone keys), used before the server's OPENROUTER_API_KEY.
alter table orgs add column if not exists openrouter_key text;
alter table orgs add column if not exists openrouter_key_last4 text;
alter table orgs add column if not exists openrouter_key_at timestamptz;

-- A text thread: one customer's number with one receptionist. Its messages live in
-- webchat_conversations / webchat_messages (origin 'sms'), so they show with the website chats.
create table if not exists sms_threads (
  client_id uuid not null references clients on delete cascade,
  contact text not null,
  conversation_id uuid not null references webchat_conversations on delete cascade,
  last_at timestamptz not null default now(),
  primary key (client_id, contact)
);

-- People who texted STOP to this receptionist's number. No automatic text goes to them again
-- until they text START.
create table if not exists sms_optouts (
  client_id uuid not null references clients on delete cascade,
  contact text not null,
  at timestamptz not null default now(),
  primary key (client_id, contact)
);

-- Texts already handled (a provider retries a webhook until it gets a 2xx), so none is answered twice.
create table if not exists sms_seen (
  message_id text primary key,
  at timestamptz not null default now()
);

-- When the "running low" email last went out for a provider, so it's sent at most once a day.
create table if not exists provider_alerts (
  org_id uuid not null references orgs on delete cascade,
  provider text not null,
  emailed_at timestamptz not null default now(),
  primary key (org_id, provider)
);

alter table sms_threads enable row level security;
alter table sms_optouts enable row level security;
alter table sms_seen enable row level security;
alter table provider_alerts enable row level security;
