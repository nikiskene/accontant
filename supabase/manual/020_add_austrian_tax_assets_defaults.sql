-- Austrian tax candidates, entity defaults, and fixed assets. VAT mappings are
-- explicitly unverified until reviewed against FreeFinance/UVA and adviser input.
begin;
do $$declare v_ws uuid:='d621017c-e9bd-4334-a07f-5e7b6d31ef6e';begin
if not exists(select 1 from public.workspaces where id=v_ws and country='AT')then raise exception 'Verified Austrian workspace missing';end if;
insert into public.vat_codes(workspace_id,code,name,vat_rate,category,applies_to,is_default)values
(v_ws,'AT-U20','Umsatzsteuer 20% (unverified mapping)',.20,'standard','sales',false),(v_ws,'AT-U13','Umsatzsteuer 13% (unverified mapping)',.13,'standard','sales',false),(v_ws,'AT-U10','Umsatzsteuer 10% (unverified mapping)',.10,'standard','sales',false),(v_ws,'AT-U0','Umsatzsteuer 0% (unverified mapping)',0,'zero','sales',false),
(v_ws,'AT-V20','Vorsteuer 20% (unverified mapping)',.20,'standard','purchases',false),(v_ws,'AT-V13','Vorsteuer 13% (unverified mapping)',.13,'standard','purchases',false),(v_ws,'AT-V10','Vorsteuer 10% (unverified mapping)',.10,'standard','purchases',false),(v_ws,'AT-V0','Vorsteuer 0% (unverified mapping)',0,'zero','purchases',false),
(v_ws,'AT-OOS','Nicht steuerbar / außerhalb UVA',0,'out_of_scope','both',false)
on conflict(workspace_id,code)do update set name=excluded.name,vat_rate=excluded.vat_rate,applies_to=excluded.applies_to;
insert into public.document_sequences(workspace_id,document_type,fiscal_year,prefix)values(v_ws,'quote',2025,'AT-Q-'),(v_ws,'invoice',2025,'AT-RE-'),(v_ws,'credit_note',2025,'AT-GS-'),(v_ws,'quote',2026,'AT-Q-'),(v_ws,'invoice',2026,'AT-RE-'),(v_ws,'credit_note',2026,'AT-GS-')on conflict do nothing;
update public.workspace_settings set default_revenue_account_id=(select id from public.accounts where workspace_id=v_ws and code='4000'),default_bank_account_id=null where workspace_id=v_ws;
end$$;
create table if not exists public.fixed_assets(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id)on delete cascade,source_system text,source_asset_number text,account_id uuid references public.accounts(id),description text,supplier text,acquisition_date date,acquisition_cost numeric(15,2),original_cost numeric(15,2),useful_life_years numeric(8,2),book_value numeric(15,2),depreciation_method text,next_depreciation_year integer,disposed_on date,created_at timestamptz not null default now(),unique(workspace_id,source_system,source_asset_number));
alter table public.fixed_assets enable row level security;drop policy if exists fixed_assets_read on public.fixed_assets;drop policy if exists fixed_assets_write on public.fixed_assets;create policy fixed_assets_read on public.fixed_assets for select to authenticated using(public.is_workspace_member(workspace_id));create policy fixed_assets_write on public.fixed_assets for all to authenticated using(public.can_write(workspace_id))with check(public.can_write(workspace_id));
commit;
select count(*) vat_codes from public.vat_codes where workspace_id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e';
