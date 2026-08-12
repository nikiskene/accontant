-- Workspace-specific legal credentials, banking, and immutable issue snapshots.
begin;

create table if not exists public.company_legal_profiles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  legal_form text,
  registration_number text,
  tax_identification_number text,
  vat_number text,
  uid_number text,
  corporate_tax_number text,
  trade_licence_number text,
  licensing_authority text,
  tax_office text,
  address_line_1 text,
  address_line_2 text,
  postal_code text,
  city text,
  state_region text,
  country_code text not null,
  billing_email text,
  phone text,
  website text,
  authorized_signatory text,
  default_payment_terms_days integer not null default 14 check (default_payment_terms_days between 0 and 365),
  legal_footer text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.company_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_name text not null,
  bank_name text not null,
  currency text not null,
  iban text,
  bic_swift text,
  account_number text,
  routing_details text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sales_documents
  add column if not exists issuer_snapshot jsonb,
  add column if not exists customer_snapshot jsonb,
  add column if not exists bank_snapshot jsonb,
  add column if not exists issued_at timestamptz;

alter table public.company_legal_profiles enable row level security;
alter table public.company_bank_accounts enable row level security;

drop policy if exists company_legal_profiles_read on public.company_legal_profiles;
drop policy if exists company_legal_profiles_write on public.company_legal_profiles;
create policy company_legal_profiles_read on public.company_legal_profiles
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy company_legal_profiles_write on public.company_legal_profiles
for all to authenticated using (public.can_admin(workspace_id)) with check (public.can_admin(workspace_id));

drop policy if exists company_bank_accounts_read on public.company_bank_accounts;
drop policy if exists company_bank_accounts_write on public.company_bank_accounts;
create policy company_bank_accounts_read on public.company_bank_accounts
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy company_bank_accounts_write on public.company_bank_accounts
for all to authenticated using (public.can_admin(workspace_id)) with check (public.can_admin(workspace_id));

insert into public.company_legal_profiles (
  workspace_id, vat_number, corporate_tax_number, country_code, billing_email
)
select id, vat_trn, ct_trn, country, 'billing@iacy.com'
from public.workspaces on conflict (workspace_id) do nothing;

commit;

select table_name from information_schema.tables where table_schema='public'
and table_name in ('company_legal_profiles','company_bank_accounts') order by table_name;
