select jsonb_build_object(
 'private_bucket',(select not public from storage.buckets where id='finance-documents'),
 'storage_policies',(select count(*)from pg_policies where schemaname='storage'and tablename='objects'and policyname like 'finance_documents_%'),
 'import_function',to_regprocedure('public.import_reconciled_bank_statement(uuid)')is not null,
 'statement_columns',(select count(*)from information_schema.columns where table_schema='public'and table_name='bank_statement_imports'and column_name in('extraction_model','extraction_response_id','extracted_row_count','extracted_at','imported_at'))
)verification;
