-- The console (area C, docs/ANSWERED_UI_PORT.md).

-- One business can be paused on its own (not only its whole agency). While paused,
-- its receptionist's booking tools refuse and its business users can't change it.
alter table clients add column paused_at timestamptz;

-- The access a customer invite grants (manager runs the receptionist, viewer is
-- read-only). The workspace-manage migration (012) may already have added it.
alter table invites add column if not exists access_role text check (access_role in ('viewer', 'manager'));

create index if not exists number_requests_org on number_requests (org_id, created_at desc);

-- Companies: an agency's client is a company (a business), which can have several
-- receptionists (clients rows) and other automations. Branding can be set per company
-- (logo, background, colours); it applies to that company's customer workspace.
create table companies (
  id uuid primary key,
  org_id uuid not null references orgs (id) on delete cascade,
  name text not null,
  industry text not null default '',
  brand jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index companies_org on companies (org_id, name);
alter table companies enable row level security;

alter table clients add column company_id uuid references companies (id) on delete set null;
create index clients_company on clients (company_id);

-- One company per existing receptionist, with the receptionist's id and business name.
insert into companies (id, org_id, name, industry, created_at)
select c.id, c.org_id, coalesce(nullif(c.data->'settings'->>'businessName', ''), 'Client'), coalesce(c.data->'settings'->>'industry', ''), c.created_at
from clients c;
update clients set company_id = id;

-- An invite from a company gives access to all of its receptionists.
alter table invites add column company_id uuid references companies (id) on delete cascade;

-- Logos and backgrounds uploaded for a company.
alter table brand_assets add column company_id uuid references companies (id) on delete cascade;
