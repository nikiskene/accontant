-- Read-only verification for 049. It creates no records and changes nothing.
select jsonb_build_object(
  'tables', (select count(*) from information_schema.tables where table_schema='public' and table_name in ('receipt_mailboxes','receipt_mailbox_members','receipt_aliases','receipt_emails','receipt_candidates','receipt_revisions','receipt_vendor_rules','receipt_processing_events','receipt_ai_usage')),
  'booking_rpcs', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('save_receipt','book_receipt','correct_receipt','receipt_action','confirm_receipt_vendor_rule','configure_receipt_mailbox','claim_receipt_mailbox')),
  'private_bucket', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'public',public,'limit',file_size_limit)),'[]'::jsonb) from storage.buckets where id='receipt-originals'),
  'rls', (select count(*) from pg_tables where schemaname='public' and tablename like 'receipt_%' and rowsecurity),
  'policies', (select count(*) from pg_policies where schemaname='public' and policyname like 'receipt_%')
) as receipt_ingestion_verification;
