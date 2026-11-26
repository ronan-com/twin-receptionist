-- An agency's own Twilio account, kept like its other phone keys: the credentials as one
-- sealed JSON (MAILBOX_KEY), the Account SID (not a secret) and last 4 of the secret to show.
-- Twilio numbers are answered by a Vapi receptionist (Vapi imports them) and send its texts.
alter table orgs add column if not exists twilio_creds text;
alter table orgs add column if not exists twilio_account_sid text;
alter table orgs add column if not exists twilio_last4 text;
alter table orgs add column if not exists twilio_name text;
alter table orgs add column if not exists twilio_at timestamptz;
