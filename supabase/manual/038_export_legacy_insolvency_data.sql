-- READ ONLY. Run in OLD project qednxzolyqzthukqzooh and return the single JSON result.
select jsonb_build_object(
 'exported_at',now(),'organizations',(select coalesce(jsonb_agg(to_jsonb(x)order by name),'[]')from public.organizations x),
 'payment_plans',(select coalesce(jsonb_agg(to_jsonb(x)order by start_date,id),'[]')from public.payment_plans x),
 'scheduled_payments',(select coalesce(jsonb_agg(to_jsonb(x)order by due_date,id),'[]')from public.scheduled_payments x),
 'payments',(select coalesce(jsonb_agg(to_jsonb(x)order by paid_date,id),'[]')from public.payments x),
 'payment_files',(select coalesce(jsonb_agg(to_jsonb(x)order by created_at,id),'[]')from public.payment_files x),
 'bulk_runs',(select coalesce(jsonb_agg(to_jsonb(x)order by created_at,id),'[]')from public.bulk_runs x),
 'control_totals',jsonb_build_object(
  'organizations',(select count(*)from public.organizations),'plans',(select count(*)from public.payment_plans),
  'scheduled',(select count(*)from public.scheduled_payments),'scheduled_total',(select coalesce(sum(amount_due),0)from public.scheduled_payments),
  'payments',(select count(*)from public.payments),'payments_total',(select coalesce(sum(amount_paid)filter(where not is_voided),0)from public.payments),
  'voided_payments',(select count(*)from public.payments where is_voided),'files',(select count(*)from public.payment_files)
 ))as insolvency_data_export;
