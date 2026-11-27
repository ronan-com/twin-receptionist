-- Account emails (server/mailer.ts): every one sent or failed, for Settings, "Email" (last 10), and the ones
-- waiting to be tried again (status 'pending', tried after 1, 5, 30 and 120 minutes, then 'failed').
-- body is only kept while pending: it can hold a sign-in or reset link.
create table if not exists mail_outbox (
  id uuid primary key default gen_random_uuid(),
  to_addr text not null,
  subject text not null default '',
  body text not null default '',
  status text not null check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  via text not null default '',
  last_error text not null default '',
  next_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mail_outbox_due on mail_outbox (next_at) where status = 'pending';
create index if not exists mail_outbox_recent on mail_outbox (created_at desc);
alter table mail_outbox enable row level security;
