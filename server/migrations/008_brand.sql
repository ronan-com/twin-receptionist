-- White-label: an agency sets its own logo and background, and can override them
-- per business for that business's customer dashboard.
alter table orgs add column brand jsonb not null default '{}';
alter table clients add column brand jsonb not null default '{}';

create table brand_assets (
  id uuid primary key,
  org_id uuid not null references orgs on delete cascade,
  client_id uuid references clients on delete cascade,
  kind text not null check (kind in ('logo', 'background')),
  content_type text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
create index brand_assets_scope on brand_assets (org_id, client_id, kind);
alter table brand_assets enable row level security;
