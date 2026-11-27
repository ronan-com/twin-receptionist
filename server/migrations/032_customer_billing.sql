-- Agency-owned customer payment links. Stripe manages the actual recurring subscriptions.
create table if not exists customer_billing (
  company_id uuid primary key references companies(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  monthly_cents integer not null check (monthly_cents > 0),
  currency text not null check (currency in ('AUD','USD','NZD','GBP','EUR','CAD')),
  checkout_url text not null,
  status text not null check (status in ('not_started','active','past_due','cancelled')),
  updated_at timestamptz not null default now()
);
alter table customer_billing enable row level security;
