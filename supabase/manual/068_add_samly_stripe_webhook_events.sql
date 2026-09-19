-- Stripe webhook idempotency ledger. Run before deploying the Stripe webhook.
begin;
create table if not exists public.samly_stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
alter table public.samly_stripe_events enable row level security;
revoke all on public.samly_stripe_events from anon, authenticated;
grant all on public.samly_stripe_events to service_role;
commit;
select to_regclass('public.samly_stripe_events') is not null as stripe_event_ledger_ready;
