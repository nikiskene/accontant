-- Idempotency ledger for paid bookings imported through the private integration.
begin;

create table if not exists public.bookingcal_payments (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check(status in('pending','paid','fulfilled','expired','failed')),
  stripe_account text not null check(stripe_account in('fzco','eu')),
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  booking_payload jsonb not null,
  accounting_payload jsonb not null,
  event_id text,
  manage_url text,
  invoice_id uuid,
  error text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bookingcal_payments enable row level security;

create table if not exists public.booking_invoice_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  external_booking_id text not null unique,
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text,
  invoice_id uuid not null references public.sales_documents(id),
  payment_id uuid not null references public.customer_payments(id),
  gross_amount numeric(15,2) not null check(gross_amount > 0),
  currency text not null,
  created_at timestamptz not null default now()
);

alter table public.booking_invoice_imports enable row level security;
create policy booking_invoice_imports_read on public.booking_invoice_imports
  for select to authenticated using(public.is_workspace_member(workspace_id));

commit;

select jsonb_build_object(
  'table',to_regclass('public.booking_invoice_imports')is not null,
  'rls',(select relrowsecurity from pg_class where oid='public.booking_invoice_imports'::regclass)
)as verification;
