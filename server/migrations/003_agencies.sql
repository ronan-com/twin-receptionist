-- Agencies: the platform team invites agencies; each agency is an org that brings
-- its own Telnyx account (or, if the platform allows it, runs on the platform's).

alter table orgs add column telnyx_key text;                 -- sealed with MAILBOX_KEY
alter table orgs add column telnyx_key_last4 text;
alter table orgs add column platform_telnyx boolean not null default false;  -- may use the platform's Telnyx key
alter table orgs add column suspended_at timestamptz;
alter table orgs add column created_by uuid references users on delete set null;

-- The platform team's own org(s) keep running on the platform's key.
update orgs set platform_telnyx = true
where id in (select m.org_id from memberships m join users u on u.id = m.user_id where u.platform_admin);

-- An agency's first person is invited as its owner.
alter table invites drop constraint if exists invites_role_check;
alter table invites add constraint invites_role_check check (role in ('owner', 'admin', 'member'));
