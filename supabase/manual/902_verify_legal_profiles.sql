select jsonb_build_object(
  'legal_profile_table',to_regclass('public.company_legal_profiles') is not null,
  'bank_accounts_table',to_regclass('public.company_bank_accounts') is not null,
  'profile_rows',(select count(*) from public.company_legal_profiles),
  'snapshot_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='sales_documents' and column_name in ('issuer_snapshot','customer_snapshot','bank_snapshot','issued_at')),
  'workflow_functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('issue_sales_document','accept_quote'))
) verification;
