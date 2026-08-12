-- Validate legal credentials and freeze issuer/customer/bank data at issue time.
create or replace function public.issue_sales_document(p_document_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_doc public.sales_documents%rowtype; v_profile public.company_legal_profiles%rowtype;
  v_customer public.counterparties%rowtype; v_bank public.company_bank_accounts%rowtype;
begin
  select * into v_doc from public.sales_documents where id=p_document_id for update;
  if not found then raise exception 'Document not found'; end if;
  if not public.can_write(v_doc.workspace_id) then raise exception 'Not authorized'; end if;
  if v_doc.status <> 'draft' then raise exception 'Only draft documents can be issued'; end if;
  if v_doc.total <= 0 or not exists(select 1 from public.sales_document_lines where document_id=p_document_id) then
    raise exception 'Document requires at least one positive line';
  end if;
  select * into v_profile from public.company_legal_profiles where workspace_id=v_doc.workspace_id;
  if v_profile.address_line_1 is null or v_profile.city is null or
     coalesce(v_profile.vat_number,v_profile.uid_number,v_profile.tax_identification_number) is null then
    raise exception 'Complete company address and tax credentials before issuing';
  end if;
  select * into v_customer from public.counterparties where id=v_doc.customer_id and workspace_id=v_doc.workspace_id;
  if not found then raise exception 'Customer not found in this company'; end if;
  select * into v_bank from public.company_bank_accounts
  where workspace_id=v_doc.workspace_id and is_active order by is_default desc,created_at limit 1;

  update public.sales_documents set
    document_number=coalesce(document_number,public.next_document_number(v_doc.workspace_id,v_doc.document_type,v_doc.issue_date)),
    issuer_snapshot=jsonb_build_object('legal_name',(select legal_name from public.workspaces where id=v_doc.workspace_id),'profile',to_jsonb(v_profile)),
    customer_snapshot=to_jsonb(v_customer), bank_snapshot=case when v_bank.id is null then null else to_jsonb(v_bank) end,
    status='sent', issued_at=now(), sent_at=now(), updated_at=now()
  where id=p_document_id;
  insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)
  values(v_doc.workspace_id,v_doc.document_type,p_document_id,'issued',auth.uid(),jsonb_build_object('snapshot_frozen',true));
end $$;

create or replace function public.accept_quote(p_quote_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from public.sales_documents
  where id=p_quote_id and document_type='quote' and status in ('sent','draft') for update;
  if v_workspace is null then raise exception 'Eligible quote not found'; end if;
  if not public.can_write(v_workspace) then raise exception 'Not authorized'; end if;
  update public.sales_documents set status='accepted',accepted_at=now(),updated_at=now() where id=p_quote_id;
  insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by)
  values(v_workspace,'quote',p_quote_id,'accepted',auth.uid());
end $$;

revoke all on function public.issue_sales_document(uuid) from public;
revoke all on function public.accept_quote(uuid) from public;
grant execute on function public.issue_sales_document(uuid) to authenticated;
grant execute on function public.accept_quote(uuid) to authenticated;

select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in ('issue_sales_document','accept_quote') order by proname;
