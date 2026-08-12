select jsonb_build_object(
 'tax_year_function',to_regprocedure('public.create_austrian_tax_year(uuid,integer,numeric,text,text,text,text)')is not null,
 'tax_settings_table',to_regclass('public.austrian_tax_year_settings')is not null,
 'form_versions',(select count(*)from public.finanzonline_form_versions where form_code in('U30','U1')),
 'verified_form_fields',(select count(*)from public.finanzonline_fields),
 'cross_border_codes',(select count(*)from public.vat_codes where workspace_id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'and code in('AT-RC-IN20','AT-IG-IN20','AT-RC-OUT')),
 'unverified_cross_border_mappings',(select count(*)from public.austrian_tax_code_mappings where workspace_id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'and status='unverified'),
 'afa_schedule',to_regclass('public.fixed_asset_depreciation_schedule')is not null,
 'bank_statement_tables',(select count(*)from information_schema.tables where table_schema='public'and table_name in('bank_statement_imports','bank_statement_rows')),
 'austrian_bank_accounts',(select count(*)from public.bank_accounts where workspace_id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'and bank_name in('Bank Austria','N26 (credit card / clearing)'))
)verification;
