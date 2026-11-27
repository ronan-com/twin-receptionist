-- Telegram as a third chatbot channel (server/telegram.ts). Every statement is repeatable.

-- One bot per receptionist. The token is sealed (server/secrets.ts). secret_hash is the SHA-256 of the
-- secret_token we gave Telegram's setWebhook; every update must carry that secret in a header.
create table if not exists telegram_bots (
  client_id uuid primary key references clients on delete cascade,
  token_sealed text not null,
  bot_id bigint not null,
  username text not null default '',
  bot_name text not null default '',
  secret_hash text not null,
  connected_at timestamptz not null default now()
);

-- A Telegram chat with the bot, and the conversation it is in now (a new one after a quiet day).
create table if not exists telegram_threads (
  client_id uuid not null references clients on delete cascade,
  chat_id bigint not null,
  conversation_id uuid not null references webchat_conversations on delete cascade,
  last_at timestamptz not null default now(),
  primary key (client_id, chat_id)
);

-- Who a conversation was with, for contacts: "t:<telegram user id>" for a Telegram chat.
alter table webchat_conversations add column if not exists contact_key text not null default '';

alter table telegram_bots enable row level security;
alter table telegram_threads enable row level security;
