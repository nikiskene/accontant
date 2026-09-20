-- Samly legal acceptance ledger.
-- Run before deploying the matching frontend release. It records the version accepted
-- by a public Samly account without exposing acceptance data across accounts.
begin;

create table if not exists public.samly_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.samly_accounts(id) on delete cascade,
  document_key text not null check (document_key in ('terms','eula','privacy','tax_notice')),
  document_version text not null check (char_length(document_version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  unique (account_id, document_key, document_version)
);

alter table public.samly_legal_acceptances drop constraint if exists samly_legal_acceptances_document_key_check;
alter table public.samly_legal_acceptances add constraint samly_legal_acceptances_document_key_check
  check (document_key in ('terms','eula','privacy','tax_notice'));

alter table public.samly_legal_acceptances enable row level security;
revoke all on public.samly_legal_acceptances from anon;
grant select on public.samly_legal_acceptances to authenticated;
grant all on public.samly_legal_acceptances to service_role;

drop policy if exists samly_legal_acceptances_owner_read on public.samly_legal_acceptances;
create policy samly_legal_acceptances_owner_read on public.samly_legal_acceptances
  for select to authenticated
  using (exists (
    select 1 from public.samly_accounts a
    where a.id = samly_legal_acceptances.account_id
      and a.owner_user_id = auth.uid()
  ));

create or replace function public.record_samly_legal_acceptance(
  p_terms_version text,
  p_eula_version text,
  p_privacy_version text,
  p_tax_notice_version text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_account_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select a.id into v_account_id
  from public.samly_accounts a
  where a.owner_user_id = auth.uid();
  if v_account_id is null then raise exception 'A Samly account is required'; end if;

  insert into public.samly_legal_acceptances(account_id, document_key, document_version)
  values
    (v_account_id, 'terms', trim(p_terms_version)),
    (v_account_id, 'eula', trim(p_eula_version)),
    (v_account_id, 'privacy', trim(p_privacy_version)),
    (v_account_id, 'tax_notice', trim(p_tax_notice_version))
  on conflict (account_id, document_key, document_version) do nothing;
end $$;

revoke all on function public.record_samly_legal_acceptance(text,text,text,text) from public;
grant execute on function public.record_samly_legal_acceptance(text,text,text,text) to authenticated;

commit;

select jsonb_build_object(
  'legal_acceptance_table', to_regclass('public.samly_legal_acceptances') is not null,
  'acceptance_rpc', to_regprocedure('public.record_samly_legal_acceptance(text,text,text,text)') is not null,
  'workspace_data_is_not_in_acceptance_ledger', not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'samly_legal_acceptances' and column_name = 'workspace_id'
  )
) as samly_legal_acceptance_verification;
