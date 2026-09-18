-- Samly public account foundation — additive only.
-- This does NOT change or attach the existing Niki workspaces.
-- It creates an isolated Samly account model on top of the existing workspace-based ledger.
-- Run after 060_samly_public_tenant_preflight.sql.

begin;

create table if not exists public.samly_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 160),
  language_code text not null default 'en' check (language_code in ('en','de')),
  billing_email text,
  plan_code text not null default 'pending' check (plan_code in ('pending','monthly','annual')),
  subscription_status text not null default 'pending' check (subscription_status in ('pending','trialing','active','past_due','cancelled','unpaid')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  subscription_current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.samly_account_workspaces (
  account_id uuid not null references public.samly_accounts(id) on delete cascade,
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, workspace_id)
);

create index if not exists samly_account_workspaces_workspace_idx
  on public.samly_account_workspaces(workspace_id);

create or replace function public.is_samly_account_owner(p_account_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.samly_accounts a
    where a.id = p_account_id and a.owner_user_id = auth.uid()
  );
$$;

create or replace function public.is_samly_workspace_owner(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.samly_account_workspaces aw
    join public.samly_accounts a on a.id = aw.account_id
    where aw.workspace_id = p_workspace_id and a.owner_user_id = auth.uid()
  );
$$;

alter table public.samly_accounts enable row level security;
alter table public.samly_account_workspaces enable row level security;
revoke all on public.samly_accounts, public.samly_account_workspaces from anon;
grant select on public.samly_accounts to authenticated;
grant select on public.samly_account_workspaces to authenticated;
grant all on public.samly_accounts, public.samly_account_workspaces to service_role;

drop policy if exists samly_accounts_owner_read on public.samly_accounts;
create policy samly_accounts_owner_read on public.samly_accounts
  for select to authenticated using (owner_user_id = auth.uid());
drop policy if exists samly_accounts_owner_update on public.samly_accounts;

drop policy if exists samly_account_workspaces_owner_read on public.samly_account_workspaces;
create policy samly_account_workspaces_owner_read on public.samly_account_workspaces
  for select to authenticated using (public.is_samly_account_owner(account_id));

-- Existing Niki workspaces retain their current membership behavior.
-- Public Samly workspaces cannot add any member after owner provisioning.
drop policy if exists "admins add workspace members" on public.workspace_members;
create policy "admins add workspace members"
  on public.workspace_members for insert to authenticated
  with check (
    public.can_admin(workspace_id)
    and role in ('admin', 'writer', 'viewer', 'accountant')
    and not exists (
      select 1 from public.samly_account_workspaces aw
      where aw.workspace_id = workspace_members.workspace_id
    )
  );

create or replace function public.protect_samly_workspace_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.samly_account_workspaces aw where aw.workspace_id = old.id)
     and new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'A Samly workspace owner cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists samly_workspace_owner_immutable on public.workspaces;
create trigger samly_workspace_owner_immutable
  before update of owner_user_id on public.workspaces
  for each row execute function public.protect_samly_workspace_owner();

-- Called once immediately after a verified Supabase user signs up.
-- The account and workspace are created atomically; no client can choose another owner.
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_company_name), '') is null or char_length(trim(p_company_name)) > 160 then
    raise exception 'Enter a company name of up to 160 characters';
  end if;
  if v_country not in ('AT', 'AE') then
    raise exception 'Choose Austria or United Arab Emirates';
  end if;
  if v_language not in ('en', 'de') then raise exception 'Unsupported language'; end if;
  if exists (select 1 from public.samly_accounts where owner_user_id = auth.uid()) then
    raise exception 'A Samly account already exists for this user';
  end if;

  v_currency := case v_country when 'AT' then 'EUR' else 'AED' end;
  insert into public.samly_accounts(owner_user_id, display_name, language_code, billing_email)
  values (auth.uid(), trim(p_company_name), v_language, (select email from auth.users where id = auth.uid()))
  returning id into v_account;

  insert into public.workspaces(legal_name, trade_name, country, base_currency, owner_user_id)
  values (trim(p_company_name), trim(p_company_name), v_country, v_currency, auth.uid())
  returning id into v_workspace;

  insert into public.workspace_members(workspace_id, user_id, role)
  values (v_workspace, auth.uid(), 'owner');
  insert into public.workspace_settings(workspace_id) values (v_workspace)
  on conflict (workspace_id) do nothing;
  insert into public.tax_years(workspace_id, label, start_date, end_date, status, is_default)
  values (v_workspace, v_year::text, make_date(v_year, 1, 1), make_date(v_year, 12, 31), 'open', true);
  insert into public.samly_account_workspaces(account_id, workspace_id) values (v_account, v_workspace);

  return query select v_account, v_workspace;
end;
$$;

revoke all on function public.is_samly_account_owner(uuid), public.is_samly_workspace_owner(uuid), public.create_samly_account(text,text,text) from public;
grant execute on function public.create_samly_account(text,text,text) to authenticated;

commit;

-- Verification: returns only the caller's own Samly account and its isolated workspace.
select jsonb_build_object(
  'my_samly_account', (
    select jsonb_build_object('id', a.id, 'display_name', a.display_name, 'plan', a.plan_code, 'status', a.subscription_status)
    from public.samly_accounts a where a.owner_user_id = auth.uid()
  ),
  'my_samly_workspaces', coalesce((
    select jsonb_agg(jsonb_build_object('workspace_id', aw.workspace_id, 'legal_name', w.legal_name, 'country', w.country, 'currency', w.base_currency))
    from public.samly_account_workspaces aw
    join public.workspaces w on w.id = aw.workspace_id
    join public.samly_accounts a on a.id = aw.account_id
    where a.owner_user_id = auth.uid()
  ), '[]'::jsonb),
  'shared_ledger_boundary', 'Samly accounting data is scoped by the newly created workspace_id.'
) as samly_public_account_foundation_verification;
