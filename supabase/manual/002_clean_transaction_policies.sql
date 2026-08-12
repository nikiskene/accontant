-- Removes duplicate policies whose OR semantics bypass can_write().

begin;

drop policy if exists "tx insert" on public.transactions;
drop policy if exists "tx read" on public.transactions;

drop policy if exists "delete_own_workspace_draft_transactions"
  on public.transactions;
create policy "delete_own_workspace_draft_transactions"
on public.transactions
for delete
to authenticated
using (
  status = 'draft'
  and public.can_write(workspace_id)
);

commit;

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'transactions'
order by policyname;
