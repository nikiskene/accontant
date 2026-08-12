select jsonb_build_object(
  'tables',(select count(*) from information_schema.tables where table_schema='public' and table_name in ('products_services','document_templates','document_sequences','sales_documents','sales_document_lines','sales_document_links','customer_payments','payment_allocations','email_outbox')),
  'rls_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('products_services','document_templates','document_sequences','sales_documents','sales_document_lines','sales_document_links','customer_payments','payment_allocations','email_outbox') and c.relrowsecurity),
  'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('next_document_number','convert_quote_to_invoice')),
  'views',(select count(*) from information_schema.views where table_schema='public' and table_name in ('v_invoice_balances','v_sales_analysis_monthly')),
  'default_templates',(select count(*) from public.document_templates where is_default),
  'sequences',(select count(*) from public.document_sequences)
) verification;
