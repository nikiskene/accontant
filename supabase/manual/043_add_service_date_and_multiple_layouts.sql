begin;

alter table public.sales_documents add column if not exists service_date text;
alter table public.document_templates add column if not exists language_code text not null default 'en';
alter table public.document_templates drop constraint if exists document_templates_language_code_check;
alter table public.document_templates add constraint document_templates_language_code_check check(language_code in('en','de'));

-- Only one default is allowed for each company and document type.
with ranked as(
  select id,row_number()over(partition by workspace_id,document_type order by updated_at desc nulls last,created_at desc)position
  from public.document_templates where is_default
)
update public.document_templates t set is_default=false from ranked r where t.id=r.id and r.position>1;
create unique index if not exists document_templates_one_default_uidx
  on public.document_templates(workspace_id,document_type)where is_default;

-- A deleted layout must not delete or block its historical documents.
alter table public.sales_documents drop constraint if exists sales_documents_template_id_fkey;
alter table public.sales_documents add constraint sales_documents_template_id_fkey
  foreign key(template_id)references public.document_templates(id)on delete set null;

create or replace function public.duplicate_invoice_as_draft(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype;v_new uuid;v_term integer;
begin
 select*into d from public.sales_documents where id=p_invoice_id and document_type='invoice';
 if d.id is null then raise exception'Invoice not found';end if;
 if not public.can_write(d.workspace_id)then raise exception'Not authorized';end if;
 v_term:=case when d.due_date is not null then greatest(d.due_date-d.issue_date,0)else 14 end;
 insert into public.sales_documents(workspace_id,document_type,document_number,customer_id,template_id,issue_date,due_date,service_date,currency,status,
  customer_reference,header_text,introduction,notes,terms_text,subtotal,tax_total,total,amount_paid,created_by)
 values(d.workspace_id,'invoice',null,d.customer_id,d.template_id,current_date,current_date+v_term,d.service_date,d.currency,'draft',
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

commit;

select jsonb_build_object(
  'service_date',exists(select 1 from information_schema.columns where table_schema='public'and table_name='sales_documents'and column_name='service_date'),
  'template_language',exists(select 1 from information_schema.columns where table_schema='public'and table_name='document_templates'and column_name='language_code'),
  'one_default_index',to_regclass('public.document_templates_one_default_uidx')is not null,
  'layouts',(select count(*)from public.document_templates)
)as verification;
