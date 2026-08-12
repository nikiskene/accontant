select jsonb_build_object(
 'supplier_tables',(select count(*) from information_schema.tables where table_schema='public' and table_name in('supplier_invoices','supplier_invoice_lines')),
 'supplier_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('supplier_invoices','supplier_invoice_lines') and c.relrowsecurity),
 'receipt_link',(select count(*) from information_schema.columns where table_schema='public' and table_name='attachments' and column_name='supplier_invoice_id')
) verification;
