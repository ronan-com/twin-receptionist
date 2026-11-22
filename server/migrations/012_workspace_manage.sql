-- The business workspace's manage side (area S, docs/ANSWERED_UI_PORT.md).

-- A business invite says what the person gets once they accept: manager or viewer.
-- acceptInvite (server/accounts.ts) copies it into client_access.role. "if not exists"
-- because the console (migration 013) needs the same column.
alter table invites add column if not exists access_role text check (access_role in ('viewer', 'manager'));

-- Knowledge items keep Answered's type and status so the page round-trips them.
-- enabled stays the one switch the receptionist's instructions read (status = 'published').
alter table knowledge_items add column if not exists kind text not null default 'faq'
  check (kind in ('faq', 'service', 'pricing', 'policy', 'location', 'fact', 'custom_qa'));
alter table knowledge_items add column if not exists status text not null default 'published'
  check (status in ('published', 'draft', 'archived'));
