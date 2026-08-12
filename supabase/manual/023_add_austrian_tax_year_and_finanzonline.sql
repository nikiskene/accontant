-- Austrian tax-year decisions and effective-dated FinanzOnline reporting fields.
begin;
create table if not exists public.austrian_tax_year_settings(
 workspace_id uuid not null references public.workspaces(id)on delete cascade,tax_year_id uuid not null references public.tax_years(id)on delete cascade,
 prior_year_revenue numeric(15,2) not null default 0,vat_regime text not null default 'normal' check(vat_regime in('normal','small_business')),
 vat_accounting_method text not null default 'accrual' check(vat_accounting_method in('accrual','cash')),
 calculated_uva_frequency text not null check(calculated_uva_frequency in('annual_only','quarterly','monthly')),
 filing_frequency text not null check(filing_frequency in('annual_only','quarterly','monthly')),
 override_reason text,accountant_confirmed boolean not null default false,accountant_confirmed_at timestamptz,
 u1_annual_required boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(workspace_id,tax_year_id)
);
create table if not exists public.finanzonline_form_versions(
 id uuid primary key default gen_random_uuid(),form_code text not null,version_name text not null,effective_from date not null,effective_to date,
 official_source_url text not null,status text not null default 'draft' check(status in('draft','verified','retired')),verified_by text,verified_at timestamptz,
 unique(form_code,version_name)
);
create table if not exists public.finanzonline_fields(
 id uuid primary key default gen_random_uuid(),form_version_id uuid not null references public.finanzonline_form_versions(id)on delete cascade,
 kennzahl text not null,label text not null,value_type text not null default 'amount' check(value_type in('amount','integer','boolean','text')),
 required boolean not null default false,calculation_rule text,validation_rule text,source_note text,unique(form_version_id,kennzahl)
);
create table if not exists public.austrian_tax_code_mappings(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id)on delete cascade,
 vat_code_id uuid not null references public.vat_codes(id)on delete cascade,transaction_context text not null check(transaction_context in('domestic_sale','domestic_purchase','eu_service_sale','eu_service_purchase_rc','eu_goods_acquisition','third_country_service_purchase_rc','exempt','out_of_scope')),
 form_version_id uuid references public.finanzonline_form_versions(id),base_kennzahl text,tax_kennzahl text,input_tax_kennzahl text,
 status text not null default 'unverified' check(status in('unverified','accountant_verified','retired')),notes text,unique(workspace_id,vat_code_id,transaction_context,form_version_id)
);
alter table public.austrian_tax_year_settings enable row level security;alter table public.finanzonline_form_versions enable row level security;alter table public.finanzonline_fields enable row level security;alter table public.austrian_tax_code_mappings enable row level security;
drop policy if exists austrian_tax_year_settings_read on public.austrian_tax_year_settings;drop policy if exists austrian_tax_year_settings_write on public.austrian_tax_year_settings;
drop policy if exists finanzonline_form_versions_read on public.finanzonline_form_versions;drop policy if exists finanzonline_fields_read on public.finanzonline_fields;
drop policy if exists austrian_tax_code_mappings_read on public.austrian_tax_code_mappings;drop policy if exists austrian_tax_code_mappings_write on public.austrian_tax_code_mappings;
create policy austrian_tax_year_settings_read on public.austrian_tax_year_settings for select to authenticated using(public.is_workspace_member(workspace_id));create policy austrian_tax_year_settings_write on public.austrian_tax_year_settings for all to authenticated using(public.can_admin(workspace_id))with check(public.can_admin(workspace_id));
create policy finanzonline_form_versions_read on public.finanzonline_form_versions for select to authenticated using(true);create policy finanzonline_fields_read on public.finanzonline_fields for select to authenticated using(true);
create policy austrian_tax_code_mappings_read on public.austrian_tax_code_mappings for select to authenticated using(public.is_workspace_member(workspace_id));create policy austrian_tax_code_mappings_write on public.austrian_tax_code_mappings for all to authenticated using(public.can_admin(workspace_id))with check(public.can_admin(workspace_id));
insert into public.finanzonline_form_versions(form_code,version_name,effective_from,effective_to,official_source_url,status,verified_by,verified_at)values
('U30','2026-H1','2026-01-01','2026-06-30','https://service.bmf.gv.at/service/anwend/formulare/show_det.asp?MIdVal=47086&STyp=&Typ=SD&s=u30','verified','BMF U30 2026',now()),
('U30','2026-H2','2026-07-01',null,'https://www.bmf.gv.at/dam/jcr%3A922a2cf9-e758-40c4-a671-1674044cced1/BMF_Dokumentenversion_UVA%20ab_07_2026.pdf','verified','BMF document version 08.07.2026',now()),
('U1','2026','2026-01-01',null,'https://service.bmf.gv.at/service/anwend/formulare/_start.asp','draft',null,null)
on conflict(form_code,version_name)do nothing;
-- Seed only officially evidenced U30 fields. Remaining Kennzahlen are added
-- after the full 2026 U30 schema is reviewed; no guessed mappings are enabled.
insert into public.finanzonline_fields(form_version_id,kennzahl,label,required,calculation_rule,source_note)
select id,'000','Steuerbare Umsätze',true,null,'BMF validation: KZ000 must exist' from public.finanzonline_form_versions where form_code='U30'
on conflict do nothing;
insert into public.finanzonline_fields(form_version_id,kennzahl,label,required,calculation_rule,source_note)
select id,'124','Additional taxable turnover field from July 2026',false,null,'Permitted only from 07/2026 or Q3 2026' from public.finanzonline_form_versions where version_name='2026-H2'
on conflict do nothing;
insert into public.finanzonline_fields(form_version_id,kennzahl,label,required,calculation_rule,source_note)
select id,'125','Additional intra-Community acquisition field from July 2026',false,null,'Permitted only from 07/2026 or Q3 2026' from public.finanzonline_form_versions where version_name='2026-H2'
on conflict do nothing;
commit;

create or replace function public.configure_austrian_tax_year(p_tax_year_id uuid,p_prior_year_revenue numeric,p_vat_regime text default 'normal',p_accounting_method text default 'accrual',p_override_frequency text default null,p_override_reason text default null)
returns text language plpgsql security definer set search_path=public as $$declare v_ws uuid;v_calc text;v_final text;begin
select workspace_id into v_ws from public.tax_years where id=p_tax_year_id;if v_ws is null or not exists(select 1 from public.workspaces where id=v_ws and country='AT')then raise exception 'Austrian tax year not found';end if;if not public.can_admin(v_ws)then raise exception 'Not authorized';end if;
v_calc:=case when p_prior_year_revenue>100000 then 'monthly' when p_prior_year_revenue>55000 then 'quarterly' else 'annual_only' end;v_final:=coalesce(p_override_frequency,v_calc);
if p_override_frequency is not null and p_override_reason is null then raise exception 'Override reason required';end if;
insert into public.austrian_tax_year_settings(workspace_id,tax_year_id,prior_year_revenue,vat_regime,vat_accounting_method,calculated_uva_frequency,filing_frequency,override_reason)
values(v_ws,p_tax_year_id,p_prior_year_revenue,p_vat_regime,p_accounting_method,v_calc,v_final,p_override_reason)
on conflict(workspace_id,tax_year_id)do update set prior_year_revenue=excluded.prior_year_revenue,vat_regime=excluded.vat_regime,vat_accounting_method=excluded.vat_accounting_method,calculated_uva_frequency=excluded.calculated_uva_frequency,filing_frequency=excluded.filing_frequency,override_reason=excluded.override_reason,accountant_confirmed=false,accountant_confirmed_at=null,updated_at=now();return v_final;end$$;
revoke all on function public.configure_austrian_tax_year(uuid,numeric,text,text,text,text)from public;grant execute on function public.configure_austrian_tax_year(uuid,numeric,text,text,text,text)to authenticated;

create or replace function public.create_austrian_tax_year(p_workspace_id uuid,p_year integer,p_prior_year_revenue numeric,p_vat_regime text default 'normal',p_accounting_method text default 'accrual',p_override_frequency text default null,p_override_reason text default null)
returns table(tax_year_id uuid,filing_frequency text)language plpgsql security definer set search_path=public as $$declare v_tax_year uuid;v_frequency text;begin
if p_year<2000 or p_year>2100 then raise exception 'Invalid tax year';end if;
if not public.can_admin(p_workspace_id)or not exists(select 1 from public.workspaces where id=p_workspace_id and country='AT')then raise exception 'Not authorized Austrian workspace';end if;
select id into v_tax_year from public.tax_years where workspace_id=p_workspace_id and label=p_year::text limit 1;
if v_tax_year is null then
 insert into public.tax_years(workspace_id,label,start_date,end_date,status,is_default)
 values(p_workspace_id,p_year::text,make_date(p_year,1,1),make_date(p_year,12,31),'open',not exists(select 1 from public.tax_years where workspace_id=p_workspace_id))returning id into v_tax_year;
end if;
v_frequency:=public.configure_austrian_tax_year(v_tax_year,p_prior_year_revenue,p_vat_regime,p_accounting_method,p_override_frequency,p_override_reason);
return query select v_tax_year,v_frequency;end$$;
revoke all on function public.create_austrian_tax_year(uuid,integer,numeric,text,text,text,text)from public;grant execute on function public.create_austrian_tax_year(uuid,integer,numeric,text,text,text,text)to authenticated;
