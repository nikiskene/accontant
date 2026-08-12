-- Adds a durable many-expenses-to-one-transaction link without changing or
-- guessing any existing relationship.

begin;

alter table public.trip_expenses
  add column if not exists transaction_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.trip_expenses'::regclass
      and conname = 'trip_expenses_transaction_id_fkey'
  ) then
    alter table public.trip_expenses
      add constraint trip_expenses_transaction_id_fkey
      foreign key (transaction_id)
      references public.transactions(id)
      on delete restrict;
  end if;
end
$$;

drop index if exists public.trip_expenses_transaction_id_unique;

create index if not exists trip_expenses_transaction_id_idx
  on public.trip_expenses(transaction_id)
  where transaction_id is not null;

commit;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'trip_expenses'
  and column_name = 'transaction_id';
