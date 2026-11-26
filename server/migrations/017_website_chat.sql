-- Website chat: a chatbot a business puts on its own website with a copy-paste snippet
-- (server/webchat.ts, public/webchat.js). Every statement is repeatable, so a test can
-- apply this file directly.

-- Per-receptionist chat settings. Kept out of clients.data so saving a receptionist never
-- overwrites them. public_id is the unguessable id the snippet carries (not the client id).
create table if not exists webchat_settings (
  client_id uuid primary key references clients on delete cascade,
  public_id text not null unique,
  enabled boolean not null default false,
  -- Website domains allowed to show the chat ("example.com" also covers www.example.com).
  -- Empty means any website may.
  allowed_domains text[] not null default '{}',
  -- The chat's first message; empty means the default built from the receptionist's name.
  greeting text not null default '',
  updated_at timestamptz not null default now()
);

-- One row per visitor chat. id is made by the visitor's browser (a random uuid).
create table if not exists webchat_conversations (
  id uuid primary key,
  client_id uuid not null references clients on delete cascade,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  -- The website address the chat happened on (host only), for the list.
  origin text not null default '',
  message_count int not null default 0,
  -- Set when the chat made a booking ('booked') or left a message ('callback').
  outcome text check (outcome in ('booked', 'callback')),
  visitor_name text not null default ''
);
create index if not exists webchat_conversations_client on webchat_conversations (client_id, last_message_at desc);

-- The transcript. role 'tool' rows are the receptionist's lookups and bookings: kept so the
-- model remembers the exact times it offered, shown in the dashboard as small notes.
create table if not exists webchat_messages (
  id bigserial primary key,
  conversation_id uuid not null references webchat_conversations on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  -- assistant rows that called tools: the OpenAI-style tool_calls array
  tool_calls jsonb,
  -- tool rows: which call this answers, and the tool's name
  tool_call_id text,
  tool_name text,
  created_at timestamptz not null default now()
);
create index if not exists webchat_messages_conversation on webchat_messages (conversation_id, id);

alter table webchat_settings enable row level security;
alter table webchat_conversations enable row level security;
alter table webchat_messages enable row level security;
