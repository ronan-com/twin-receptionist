-- When an agency connected its own phone account (its Telnyx API key). Shown on
-- the Connections page.
alter table orgs add column telnyx_key_at timestamptz;
