-- Reserve a lifetime Samly entitlement for the existing Niki user.
-- This does not create, modify or attach any existing IACy workspace.
-- When this user later creates a separate Samly workspace, the provisioning RPC
-- applies the lifetime plan atomically.

begin;

alter table public.samly_accounts
  drop constraint if exists samly_accounts_plan_code_check;
alter table public.samly_accounts
  add constraint samly_accounts_plan_code_check
  check (plan_code in ('pending', 'monthly', 'annual', 'lifetime'));

create table if not exists public.samly_lifetime_entitlements (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_note text not null default 'Founder lifetime subscription'
);
alter table public.samly_lifetime_entitlements enable row level security;
revoke all on public.samly_lifetime_entitlements from anon, authenticated;
grant all on public.samly_lifetime_entitlements to service_role;

insert into public.samly_lifetime_entitlements(owner_user_id)
values ('c0a1df38-31e5-4feb-9c31-82ad11cc9af0'::uuid)
on conflict (owner_user_id) do nothing;

create or replace function public.create_samly_account(
  p_company_name text,
  p_country text,
  p_language_code text default 'en'
)
returns table(account_id uuid, workspace_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_account uuid;
  v_workspace uuid;
  v_country text := upper(trim(coalesce(p_country, '')));
  v_language text := lower(trim(coalesce(p_language_code, 'en')));
  v_currency text;
  v_year integer := extract(year from current_date)::integer;
  v_lifetime boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_company_name), '') is null or char_length(trim(p_company_name)) > 160 then raise exception 'Enter a company name of up to 160 characters'; end if;
  if v_country not in ('AT', 'AE') then raise exception 'Choose Austria or United Arab Emirates'; end if;
  if v_language not in ('en', 'de') then raise exception 'Unsupported language'; end if;
  if exists (select 1 from public.samly_accounts where owner_user_id = auth.uid()) then raise exception 'A Samly account already exists for this user'; end if;

  v_currency := case v_country when 'AT' then 'EUR' else 'AED' end;
  v_lifetime := exists (select 1 from public.samly_lifetime_entitlements where owner_user_id = auth.uid());
  insert into public.samly_accounts(owner_user_id, display_name, language_code, billing_email, plan_code, subscription_status)
  values (auth.uid(), trim(p_company_name), v_language, (select email from auth.users where id = auth.uid()), case when v_lifetime then 'lifetime' else 'pending' end, case when v_lifetime then 'active' else 'pending' end)
  returning id into v_account;

  insert into public.workspaces(legal_name, trade_name, country, base_currency, owner_user_id)
  values (trim(p_company_name), trim(p_company_name), v_country, v_currency, auth.uid())
  returning id into v_workspace;
  insert into public.workspace_members(workspace_id, user_id, role) values (v_workspace, auth.uid(), 'owner');
  insert into public.workspace_settings(workspace_id) values (v_workspace) on conflict (workspace_id) do nothing;
  insert into public.tax_years(workspace_id, label, start_date, end_date, status, is_default)
  values (v_workspace, v_year::text, make_date(v_year, 1, 1), make_date(v_year, 12, 31), 'open', true);
  insert into public.samly_account_workspaces(account_id, workspace_id) values (v_account, v_workspace);
  return query select v_account, v_workspace;
end;
$$;

revoke all on function public.create_samly_account(text,text,text) from public;
grant execute on function public.create_samly_account(text,text,text) to authenticated;

commit;

select exists(select 1 from public.samly_lifetime_entitlements where owner_user_id='c0a1df38-31e5-4feb-9c31-82ad11cc9af0'::uuid) as lifetime_reserved,
       (select plan_code from public.samly_accounts where owner_user_id='c0a1df38-31e5-4feb-9c31-82ad11cc9af0'::uuid) as current_plan;
