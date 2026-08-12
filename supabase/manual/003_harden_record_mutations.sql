-- Writers may create/update operational records. Only admins may delete them.
-- SELECT policies are intentionally left unchanged.

begin;

drop policy if exists "workspace insert" on public.attachments;
drop policy if exists "workspace update" on public.attachments;
drop policy if exists "workspace delete" on public.attachments;
create policy "workspace insert" on public.attachments for insert to authenticated
  with check (public.can_write(workspace_id));
create policy "workspace update" on public.attachments for update to authenticated
  using (public.can_write(workspace_id)) with check (public.can_write(workspace_id));
create policy "workspace delete" on public.attachments for delete to authenticated
  using (public.can_admin(workspace_id));

drop policy if exists "workspace insert" on public.bank_imports;
drop policy if exists "workspace update" on public.bank_imports;
drop policy if exists "workspace delete" on public.bank_imports;
create policy "workspace insert" on public.bank_imports for insert to authenticated
  with check (public.can_write(workspace_id));
create policy "workspace update" on public.bank_imports for update to authenticated
  using (public.can_write(workspace_id)) with check (public.can_write(workspace_id));
create policy "workspace delete" on public.bank_imports for delete to authenticated
  using (public.can_admin(workspace_id));

drop policy if exists "workspace insert" on public.batches;
drop policy if exists "workspace update" on public.batches;
drop policy if exists "workspace delete" on public.batches;
create policy "workspace insert" on public.batches for insert to authenticated
  with check (public.can_write(workspace_id));
create policy "workspace update" on public.batches for update to authenticated
  using (public.can_write(workspace_id)) with check (public.can_write(workspace_id));
create policy "workspace delete" on public.batches for delete to authenticated
  using (public.can_admin(workspace_id));

drop policy if exists "workspace insert" on public.counterparties;
drop policy if exists "workspace update" on public.counterparties;
drop policy if exists "workspace delete" on public.counterparties;
create policy "workspace insert" on public.counterparties for insert to authenticated
  with check (public.can_write(workspace_id));
create policy "workspace update" on public.counterparties for update to authenticated
  using (public.can_write(workspace_id)) with check (public.can_write(workspace_id));
create policy "workspace delete" on public.counterparties for delete to authenticated
  using (public.can_admin(workspace_id));

drop policy if exists "workspace write" on public.tax_years;
create policy "workspace write" on public.tax_years for all to authenticated
  using (public.can_admin(workspace_id))
  with check (public.can_admin(workspace_id));

commit;

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('attachments', 'bank_imports', 'batches', 'counterparties', 'tax_years')
order by tablename, policyname;
