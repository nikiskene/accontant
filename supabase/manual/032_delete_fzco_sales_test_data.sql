-- DESTRUCTIVE AND FZCO-SCOPED: remove all current commercial sales documents
-- and dependent operational records. Accounting, bank, tax, customer, product,
-- supplier, expense, trip, template, and company data are preserved.
begin;

do $$
declare
  v_workspace uuid:='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9';
  v_documents integer;
  v_lines integer;
  v_links integer;
  v_allocations integer;
  v_payments integer;
  v_reminders integer;
  v_outbox integer;
  v_audit integer;
  v_referrals integer:=0;
begin
  if not exists(
    select 1 from public.workspaces
    where id=v_workspace and legal_name='IACy International FZCO' and country='AE'
  ) then raise exception 'Safety check failed: exact FZCO workspace not found'; end if;

  create temporary table reset_documents on commit drop as
    select id from public.sales_documents where workspace_id=v_workspace;
  create temporary table reset_payments on commit drop as
    select distinct p.id from public.customer_payments p
    join public.payment_allocations a on a.payment_id=p.id
    where a.invoice_id in(select id from reset_documents);

  select count(*) into v_documents from reset_documents;
  select count(*) into v_lines from public.sales_document_lines where document_id in(select id from reset_documents);
  select count(*) into v_links from public.sales_document_links where source_document_id in(select id from reset_documents) or target_document_id in(select id from reset_documents);
  select count(*) into v_allocations from public.payment_allocations where invoice_id in(select id from reset_documents);
  select count(*) into v_payments from reset_payments;
  select count(*) into v_reminders from public.payment_reminders where invoice_id in(select id from reset_documents);
  select count(*) into v_outbox from public.email_outbox where document_id in(select id from reset_documents);
  select count(*) into v_audit from public.audit_events where workspace_id=v_workspace and entity_id in(select id from reset_documents);

  if to_regclass('public.collection_referrals') is not null then
    execute 'select count(*) from public.collection_referrals where invoice_id in(select id from reset_documents)' into v_referrals;
    execute 'delete from public.collection_referrals where invoice_id in(select id from reset_documents)';
  end if;

  delete from public.email_outbox where document_id in(select id from reset_documents);
  delete from public.payment_reminders where invoice_id in(select id from reset_documents);
  delete from public.payment_allocations where invoice_id in(select id from reset_documents);
  -- Remove only payments that were attached to the deleted documents and have
  -- no allocation to a preserved invoice.
  delete from public.customer_payments p where p.id in(select id from reset_payments)
    and not exists(select 1 from public.payment_allocations a where a.payment_id=p.id);
  delete from public.sales_document_links where source_document_id in(select id from reset_documents) or target_document_id in(select id from reset_documents);
  delete from public.audit_events where workspace_id=v_workspace and entity_id in(select id from reset_documents);
  delete from public.sales_documents where id in(select id from reset_documents);
  delete from public.document_sequences where workspace_id=v_workspace;

  insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)
  values(v_workspace,'sales_data_reset',null,'delete_test_sales_data',auth.uid(),jsonb_build_object(
    'sales_documents',v_documents,'sales_document_lines',v_lines,'sales_document_links',v_links,
    'payment_allocations',v_allocations,'customer_payments',v_payments,'payment_reminders',v_reminders,
    'collection_referrals',v_referrals,'email_outbox',v_outbox,'document_audit_events',v_audit,
    'reason','User-authorized cleanup before QuickBooks 2026 invoice migration'
  ));
end $$;

commit;

select jsonb_build_object(
  'workspace_id','fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9',
  'remaining_sales_documents',(select count(*) from public.sales_documents where workspace_id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'),
  'remaining_sales_lines',(select count(*) from public.sales_document_lines where workspace_id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'),
  'remaining_payment_reminders',(select count(*) from public.payment_reminders where workspace_id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'),
  'remaining_email_outbox',(select count(*) from public.email_outbox where workspace_id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9' and document_id is not null),
  'reset_audit_logged',exists(select 1 from public.audit_events where workspace_id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9' and entity_type='sales_data_reset' and action='delete_test_sales_data')
) as reset_verification;

