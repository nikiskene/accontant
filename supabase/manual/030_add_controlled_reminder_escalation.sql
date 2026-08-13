-- Controlled two-step reminder and collection-referral workflow.
begin;

alter table public.payment_reminders
  add column if not exists balance_at_reminder numeric(15,2),
  add column if not exists late_fee_rate numeric(7,4) not null default 0 check (late_fee_rate between 0 and 1),
  add column if not exists late_fee_amount numeric(15,2) not null default 0 check (late_fee_amount >= 0),
  add column if not exists recipient_email text;

alter table public.payment_reminders drop constraint if exists payment_reminders_status_check;
alter table public.payment_reminders add constraint payment_reminders_status_check
  check(status in('draft','queued','sending','sent','failed','cancelled'));

-- Retain only the oldest row if historical testing produced duplicate levels.
delete from public.payment_reminders newer
using public.payment_reminders older
where newer.invoice_id=older.invoice_id and newer.reminder_level=older.reminder_level
  and (newer.created_at,newer.id)>(older.created_at,older.id);

create unique index if not exists payment_reminders_invoice_level_uidx
  on public.payment_reminders(invoice_id,reminder_level);

create table if not exists public.collection_referrals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.sales_documents(id) on delete restrict,
  recipient_email text not null,
  status text not null default 'sending' check(status in('sending','sent','failed','cancelled')),
  sent_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(invoice_id)
);

alter table public.collection_referrals enable row level security;
drop policy if exists collection_referrals_read on public.collection_referrals;
drop policy if exists collection_referrals_write on public.collection_referrals;
create policy collection_referrals_read on public.collection_referrals for select to authenticated
  using(public.is_workspace_member(workspace_id));
create policy collection_referrals_write on public.collection_referrals for all to authenticated
  using(public.can_write(workspace_id)) with check(public.can_write(workspace_id));

commit;

select jsonb_build_object(
  'unique_reminder_levels',to_regclass('public.payment_reminders_invoice_level_uidx') is not null,
  'collection_referrals',to_regclass('public.collection_referrals') is not null,
  'fee_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='payment_reminders' and column_name in('balance_at_reminder','late_fee_rate','late_fee_amount','recipient_email'))
) as verification;
