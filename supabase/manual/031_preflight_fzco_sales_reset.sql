-- READ ONLY: inspect exactly what the FZCO sales reset will remove.
with target as (
  select id from public.workspaces
  where id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'
    and legal_name='IACy International FZCO' and country='AE'
), documents as (
  select d.* from public.sales_documents d join target t on t.id=d.workspace_id
), payments as (
  select distinct p.id from public.customer_payments p
  join public.payment_allocations a on a.payment_id=p.id
  join documents d on d.id=a.invoice_id
)
select jsonb_build_object(
  'workspace',(select jsonb_build_object('id',id,'legal_name',legal_name,'country',country) from public.workspaces where id=(select id from target)),
  'documents_by_type',(select coalesce(jsonb_object_agg(document_type,n), '{}'::jsonb) from (select document_type,count(*) n from documents group by document_type) counts),
  'documents_by_status',(select coalesce(jsonb_object_agg(status,n), '{}'::jsonb) from (select status,count(*) n from documents group by status) counts),
  'sales_documents',(select count(*) from documents),
  'sales_document_lines',(select count(*) from public.sales_document_lines where document_id in(select id from documents)),
  'sales_document_links',(select count(*) from public.sales_document_links where source_document_id in(select id from documents) or target_document_id in(select id from documents)),
  'payment_allocations',(select count(*) from public.payment_allocations where invoice_id in(select id from documents)),
  'customer_payments_affected',(select count(*) from payments),
  'payment_reminders',(select count(*) from public.payment_reminders where invoice_id in(select id from documents)),
  'email_outbox',(select count(*) from public.email_outbox where document_id in(select id from documents)),
  'document_audit_events',(select count(*) from public.audit_events where workspace_id=(select id from target) and entity_id in(select id from documents)),
  'document_sequences',(select count(*) from public.document_sequences where workspace_id=(select id from target)),
  'preserved',jsonb_build_array('customers','products_services','document_templates','company credentials','bank data','expenses','supplier invoices','trips','ledger transactions','tax settings')
) as reset_preflight;

