-- Vapi as a second voice engine next to Telnyx (server/voice/).
-- orgs.voice_provider: the engine new receptionists of this agency are made on
-- ('telnyx' or 'vapi'); null follows the install's VOICE_PROVIDER (default telnyx).
-- An agency's own Vapi keys are kept like its Telnyx key: the private one sealed
-- with MAILBOX_KEY, the public one (made for browsers) as it is.
alter table orgs add column if not exists voice_provider text;
alter table orgs add column if not exists vapi_key text;
alter table orgs add column if not exists vapi_key_last4 text;
alter table orgs add column if not exists vapi_public_key text;
alter table orgs add column if not exists vapi_key_at timestamptz;

-- Calls from Vapi arrive as end-of-call reports with the whole conversation, so the
-- transcript, recording and cost are kept here (Telnyx calls are read from Telnyx on demand).
alter table call_log add column if not exists provider text not null default 'telnyx';
alter table call_log add column if not exists transcript jsonb;
alter table call_log add column if not exists recording_url text;
alter table call_log add column if not exists cost_usd numeric(10, 4);
alter table call_log add column if not exists ended_reason text;
