-- The business's own notes and status for a contact (a caller, texter or website visitor).
-- Contacts themselves aren't stored: they are worked out from calls, bookings and chats
-- (server/routes/workspaceMore.ts), and `key` is their phone digits (or "e:<email>").
create table if not exists contact_notes (
  client_id uuid not null references clients on delete cascade,
  key text not null,
  name text not null default '',
  notes text not null default '',
  status text not null default 'new' check (status in ('new', 'active', 'customer', 'closed')),
  updated_at timestamptz not null default now(),
  primary key (client_id, key)
);
alter table contact_notes enable row level security;
