-- Receptionist depth (area R, docs/ANSWERED_UI_PORT.md).

-- Who paused a business (clients.paused_at, migration 013). 'business' = its own
-- manager paused it from the Receptionist page, so it may resume it there; null = the
-- agency or platform paused it from the console, and only they can resume it.
alter table clients add column if not exists paused_by text check (paused_by in ('business'));
