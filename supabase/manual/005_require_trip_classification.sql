-- Prevents future submitted/posted trip expenses without valid same-workspace
-- account and VAT classifications. Existing rows are not modified.

begin;

create or replace function public.enforce_trip_expense_classification()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status in ('submitted', 'posted') then
    if new.account_id is null or new.vat_code_id is null then
      raise exception 'Trip expense % requires account and VAT classification before %',
        new.id, new.status;
    end if;

    if not exists (
      select 1 from public.accounts a
      where a.id = new.account_id
        and a.workspace_id = new.workspace_id
        and a.is_active
    ) then
      raise exception 'Trip expense % has an invalid or cross-workspace account', new.id;
    end if;

    if not exists (
      select 1 from public.vat_codes v
      where v.id = new.vat_code_id
        and v.workspace_id = new.workspace_id
    ) then
      raise exception 'Trip expense % has an invalid or cross-workspace VAT code', new.id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trip_expenses_require_classification
  on public.trip_expenses;
create trigger trip_expenses_require_classification
before insert or update of status
on public.trip_expenses
for each row
execute function public.enforce_trip_expense_classification();

commit;

select trigger_name, event_manipulation, action_timing
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'trip_expenses'
  and trigger_name = 'trip_expenses_require_classification';
