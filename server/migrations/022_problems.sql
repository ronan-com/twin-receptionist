-- Recent problems for the support heartbeat (server/problems.ts): what went wrong in the background, with
-- no names, numbers or messages (the text is scrubbed before it is stored). Pruned after two days. Repeatable.
create table if not exists problem_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,
  msg text not null
);
create index if not exists problem_log_at on problem_log (at desc);
alter table problem_log enable row level security;
