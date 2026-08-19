begin;

-- An email address is a delivery destination, not the unique identity of a
-- legal customer. Multiple customers may share an accounts-payable mailbox.
alter table public.counterparties
  drop constraint if exists counterparties_workspace_email_uq;
drop index if exists public.counterparties_workspace_email_uq;

-- Retain efficient company-scoped email search without enforcing uniqueness.
create index if not exists counterparties_workspace_email_idx
  on public.counterparties(workspace_id,email_lc)
  where email_lc is not null;

commit;

select jsonb_build_object(
  'unique_email_constraint_removed',not exists(
    select 1 from pg_constraint where conname='counterparties_workspace_email_uq'
  )and not exists(
    select 1 from pg_indexes where schemaname='public'and indexname='counterparties_workspace_email_uq'
  ),
  'search_index',to_regclass('public.counterparties_workspace_email_idx')is not null
)as verification;
