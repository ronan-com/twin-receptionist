-- Agencies don't bring their own Telnyx account: everyone runs on the platform's API.
update orgs set platform_telnyx = true;
alter table orgs alter column platform_telnyx set default true;
