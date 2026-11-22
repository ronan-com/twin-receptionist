-- "View as": the platform team can step into an agency's dashboard, or a business's
-- customer view, read-only, from their own session.
alter table sessions add column view_org_id uuid references orgs on delete set null;
alter table sessions add column view_client_id uuid references clients on delete set null;
