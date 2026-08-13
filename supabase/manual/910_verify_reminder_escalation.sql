select jsonb_build_object(
  'unique_reminder_levels',to_regclass('public.payment_reminders_invoice_level_uidx') is not null,
  'collection_referrals',to_regclass('public.collection_referrals') is not null,
  'collection_rls',(select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='collection_referrals'),
  'duplicate_levels',(select count(*) from (select invoice_id,reminder_level from public.payment_reminders group by invoice_id,reminder_level having count(*)>1) duplicates)
) as verification;
