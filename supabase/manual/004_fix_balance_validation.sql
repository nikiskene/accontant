-- A posted transaction must have at least two lines and sum to zero.

begin;

create or replace function public.is_transaction_balanced(p_transaction_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) >= 2
    and abs(coalesce(sum(amount), 0)) < 0.005
  from public.transaction_lines
  where transaction_id = p_transaction_id;
$$;

commit;

-- Expected before data repair: unbalanced_posted = 16.
select count(*) as unbalanced_posted
from public.transactions
where status = 'posted'
  and not public.is_transaction_balanced(id);
