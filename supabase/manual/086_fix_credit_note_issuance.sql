-- Fix signed credit-note issuance and prevent cumulative over-crediting.
begin;
create or replace function public.issue_sales_document(p_document_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_doc public.sales_documents%rowtype; v_profile public.company_legal_profiles%rowtype; v_customer public.counterparties%rowtype; v_bank public.company_bank_accounts%rowtype; v_original public.sales_documents%rowtype; v_credited numeric;
begin
  select * into v_doc from public.sales_documents where id=p_document_id for update;
  if not found then raise exception 'Document not found'; end if;
  if auth.uid() is null or not coalesce(public.can_write(v_doc.workspace_id),false) then raise exception 'Not authorized'; end if;
  if v_doc.status<>'draft' then raise exception 'Only draft documents can be issued'; end if;
  if v_doc.document_type='invoice' then perform public.samly_assert_free_setup_capacity(v_doc.workspace_id,'invoice'); end if;
  if not exists(select 1 from public.sales_document_lines where document_id=p_document_id) then raise exception 'Document requires at least one line'; end if;
  if v_doc.document_type='credit_note' then
    select original.* into v_original from public.sales_document_links l join public.sales_documents original on original.id=l.source_document_id and original.workspace_id=v_doc.workspace_id where l.target_document_id=v_doc.id and l.link_type='invoice_to_credit_note' for update of original;
    if v_original.id is null then raise exception 'Original invoice not found'; end if;
    select coalesce(sum(abs(c.total)),0) into v_credited from public.sales_document_links l join public.sales_documents c on c.id=l.target_document_id and c.workspace_id=v_doc.workspace_id where l.source_document_id=v_original.id and l.link_type='invoice_to_credit_note' and c.status<>'void' and c.id<>v_doc.id;
    if v_credited+abs(v_doc.total)>v_original.total then raise exception 'Credit exceeds the remaining invoice amount'; end if;
    if v_doc.subtotal<>(select coalesce(sum(net_amount),0) from public.sales_document_lines where document_id=v_doc.id) or v_doc.tax_total<>(select coalesce(sum(vat_amount),0) from public.sales_document_lines where document_id=v_doc.id) or v_doc.total<>v_doc.subtotal+v_doc.tax_total then raise exception 'Credit totals must reconcile with lines'; end if;
    if v_doc.total>=0 then raise exception 'Credit note must have a negative accounting total'; end if;
    if not exists(select 1 from public.sales_document_links l join public.sales_documents original on original.id=l.source_document_id and original.workspace_id=v_doc.workspace_id where l.target_document_id=v_doc.id and l.link_type='invoice_to_credit_note' and original.status not in('draft','void')) then raise exception 'Credit note must reference an issued invoice in this company'; end if;
  elsif v_doc.total<=0 then raise exception 'Document requires a positive total'; end if;
  if exists(select 1 from public.sales_document_lines where document_id=p_document_id and workspace_id<>v_doc.workspace_id) then raise exception 'Invoice line belongs to another company'; end if;
  if v_doc.document_type='credit_note' and exists(select 1 from public.sales_document_lines where document_id=p_document_id and (quantity>=0 or net_amount>0 or vat_amount>0 or gross_amount>0)) then raise exception 'Credit-note line signs are invalid'; end if;
  select * into v_profile from public.company_legal_profiles where workspace_id=v_doc.workspace_id;
  if v_profile.address_line_1 is null or v_profile.city is null or coalesce(v_profile.vat_number,v_profile.uid_number,v_profile.tax_identification_number) is null then raise exception 'Complete company address and tax credentials before issuing'; end if;
  select * into v_customer from public.counterparties where id=v_doc.customer_id and workspace_id=v_doc.workspace_id;
  if not found then raise exception 'Customer not found in this company'; end if;
  select * into v_bank from public.company_bank_accounts where workspace_id=v_doc.workspace_id and is_active order by is_default desc,created_at limit 1;
  update public.sales_documents set document_number=coalesce(document_number,public.next_document_number(v_doc.workspace_id,v_doc.document_type,v_doc.issue_date)),issuer_snapshot=case when v_doc.document_type='credit_note' and v_doc.issuer_snapshot is not null then v_doc.issuer_snapshot else jsonb_build_object('legal_name',(select legal_name from public.workspaces where id=v_doc.workspace_id),'profile',to_jsonb(v_profile),'einvoice_settings',(select to_jsonb(es) from public.einvoice_settings es where es.workspace_id=v_doc.workspace_id)) end,customer_snapshot=case when v_doc.document_type='credit_note' and v_doc.customer_snapshot is not null then v_doc.customer_snapshot else to_jsonb(v_customer) end,bank_snapshot=case when v_bank.id is null then null else to_jsonb(v_bank) end,status='sent',issued_at=now(),sent_at=now(),updated_at=now() where id=p_document_id;
  insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details) values(v_doc.workspace_id,v_doc.document_type,p_document_id,'issued',auth.uid(),jsonb_build_object('snapshot_frozen',true));
end $$;


create or replace function public.create_credit_note(p_invoice_id uuid,p_fraction numeric default 1,p_issue_date date default current_date)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype;v_id uuid;v_number text;v_existing numeric;
begin select * into d from public.sales_documents where id=p_invoice_id and document_type='invoice' and status not in('draft','void') for update;if not found then raise exception 'Invoice not found';end if;
if auth.uid() is null or not coalesce(public.can_write(d.workspace_id),false) then raise exception 'Not authorized';end if;if p_fraction is null or p_fraction<=0 or p_fraction>1 then raise exception 'Fraction must be between 0 and 1';end if;
select coalesce(sum(abs(c.total)),0) into v_existing from public.sales_document_links l join public.sales_documents c on c.id=l.target_document_id and c.workspace_id=d.workspace_id where l.source_document_id=d.id and l.link_type='invoice_to_credit_note' and c.status<>'void';
if p_issue_date is null or p_issue_date<d.issue_date then raise exception 'Credit note date cannot precede the original invoice'; end if;
if round(d.total*p_fraction,2)<=0 or v_existing+round(d.total*p_fraction,2)>d.total then raise exception 'Credit exceeds the remaining invoice amount'; end if;
v_number:=public.next_document_number(d.workspace_id,'credit_note',p_issue_date);
insert into public.sales_documents(workspace_id,document_type,document_number,customer_id,issue_date,currency,status,subtotal,tax_total,total,created_by,issuer_snapshot,customer_snapshot,bank_snapshot)
values(d.workspace_id,'credit_note',v_number,d.customer_id,p_issue_date,d.currency,'draft',-round(d.subtotal*p_fraction,2),-round(d.tax_total*p_fraction,2),-round(d.total*p_fraction,2),auth.uid(),d.issuer_snapshot,d.customer_snapshot,d.bank_snapshot)returning id into v_id;
insert into public.sales_document_lines(workspace_id,document_id,line_no,product_service_id,description,quantity,unit,unit_price,discount_percent,vat_code_id,vat_rate,net_amount,vat_amount,gross_amount,revenue_account_id)
select workspace_id,v_id,line_no,product_service_id,'Credit: '||description,-quantity*p_fraction,unit,unit_price,discount_percent,vat_code_id,vat_rate,-round(net_amount*p_fraction,2),-round(vat_amount*p_fraction,2),-round(net_amount*p_fraction,2)-round(vat_amount*p_fraction,2),revenue_account_id from public.sales_document_lines where document_id=p_invoice_id;
update public.sales_documents set subtotal=(select sum(net_amount) from public.sales_document_lines where document_id=v_id),tax_total=(select sum(vat_amount) from public.sales_document_lines where document_id=v_id),total=(select sum(gross_amount) from public.sales_document_lines where document_id=v_id) where id=v_id;
if (select abs(total) from public.sales_documents where id=v_id)+v_existing>d.total then raise exception 'Rounded credit exceeds remaining amount'; end if;
insert into public.sales_document_links(workspace_id,source_document_id,target_document_id,link_type,fraction)values(d.workspace_id,p_invoice_id,v_id,'invoice_to_credit_note',p_fraction);return v_id;end$$;

revoke all on function public.issue_sales_document(uuid), public.create_credit_note(uuid,numeric,date) from public,anon;
grant execute on function public.issue_sales_document(uuid), public.create_credit_note(uuid,numeric,date) to authenticated;
commit;
