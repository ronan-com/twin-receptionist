-- How many times the sync job (server/callSummary.ts) has tried to summarise a call, so each
-- ended call is looked at a few times at most. 99 means "skipped on purpose" (too short, no words).
alter table call_log add column if not exists summary_tries smallint not null default 0;
