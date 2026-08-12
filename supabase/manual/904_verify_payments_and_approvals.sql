select jsonb_build_object(
 'reminders_table',to_regclass('public.payment_reminders') is not null,
 'reminders_rls',(select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='payment_reminders'),
 'workflow_functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('record_customer_payment','create_credit_note','approve_supplier_invoice'))
) verification;
