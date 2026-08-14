create or replace function public.duplicate_invoice_as_draft(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype;v_new uuid;v_term integer;
begin
 select*into d from public.sales_documents where id=p_invoice_id and document_type='invoice';
 if d.id is null then raise exception'Invoice not found';end if;
 if not public.can_write(d.workspace_id)then raise exception'Not authorized';end if;
 v_term:=case when d.due_date is not null then greatest(d.due_date-d.issue_date,0)else 14 end;
 insert into public.sales_documents(workspace_id,document_type,document_number,customer_id,template_id,issue_date,due_date,currency,status,
  customer_reference,header_text,introduction,notes,terms_text,subtotal,tax_total,total,amount_paid,created_by)
 values(d.workspace_id,'invoice',null,d.customer_id,d.template_id,current_date,current_date+v_term,d.currency,'draft',
  d.customer_reference,d.header_text,d.introduction,null,d.terms_text,d.subtotal,d.tax_total,d.total,0,auth.uid())returning id into v_new;
 insert into public.sales_document_lines(workspace_id,document_id,line_no,product_service_id,description,quantity,unit,unit_price,
  discount_percent,vat_code_id,vat_rate,net_amount,vat_amount,gross_amount,revenue_account_id)
 select workspace_id,v_new,line_no,product_service_id,description,quantity,unit,unit_price,discount_percent,vat_code_id,vat_rate,
  net_amount,vat_amount,gross_amount,revenue_account_id from public.sales_document_lines where document_id=d.id order by line_no;
 insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)
 values(d.workspace_id,'invoice',v_new,'duplicated_as_draft',auth.uid(),jsonb_build_object('source_invoice_id',d.id,'source_invoice_number',d.document_number));
 return v_new;
end $$;
revoke all on function public.duplicate_invoice_as_draft(uuid)from public;
grant execute on function public.duplicate_invoice_as_draft(uuid)to authenticated;
select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname='duplicate_invoice_as_draft')as verification;
