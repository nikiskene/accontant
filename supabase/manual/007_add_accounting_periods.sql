-- Adds period-lock infrastructure. Posting functions must be wired to this
-- structure in a later, separately reviewed change.

begin;

create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open', 'locked')),
  locked_at timestamptz,
  locked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint accounting_periods_valid_dates check (period_end >= period_start),
  constraint accounting_periods_workspace_dates_unique
    unique (workspace_id, period_start, period_end)
);

alter table public.accounting_periods enable row level security;

drop policy if exists "accounting periods read" on public.accounting_periods;
create policy "accounting periods read"
on public.accounting_periods for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "accounting periods admin insert" on public.accounting_periods;
create policy "accounting periods admin insert"
on public.accounting_periods for insert to authenticated
with check (public.can_admin(workspace_id));

drop policy if exists "accounting periods admin update" on public.accounting_periods;
create policy "accounting periods admin update"
on public.accounting_periods for update to authenticated
using (public.can_admin(workspace_id))
with check (public.can_admin(workspace_id));

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'accounting_periods';
