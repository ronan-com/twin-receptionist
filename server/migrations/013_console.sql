-- The console (area C, docs/ANSWERED_UI_PORT.md).

-- One business can be paused on its own (not only its whole agency). While paused,
-- its receptionist's booking tools refuse and its business users can't change it.
alter table clients add column paused_at timestamptz;

-- The access a customer invite grants (manager runs the receptionist, viewer is
-- read-only). The workspace-manage migration (012) may already have added it.
alter table invites add column if not exists access_role text check (access_role in ('viewer', 'manager'));

create index if not exists number_requests_org on number_requests (org_id, created_at desc);
