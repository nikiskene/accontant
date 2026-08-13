select jsonb_build_object(
  'customer_terms', exists(select 1 from information_schema.columns where table_schema='public' and table_name='counterparties' and column_name='default_payment_terms'),
  'document_header', exists(select 1 from information_schema.columns where table_schema='public' and table_name='sales_documents' and column_name='header_text'),
  'document_terms', exists(select 1 from information_schema.columns where table_schema='public' and table_name='sales_documents' and column_name='terms_text'),
  'payment_font_size', exists(select 1 from information_schema.columns where table_schema='public' and table_name='document_templates' and column_name='payment_instructions_font_size'),
  'conversion_function', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='convert_quote_to_invoice')
) as verification;
