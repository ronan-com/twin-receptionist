-- A test agency the platform team can play with: demo receptionist, sample calls,
-- test logins. Nothing in it touches the phone provider.
alter table orgs add column sandbox boolean not null default false;
