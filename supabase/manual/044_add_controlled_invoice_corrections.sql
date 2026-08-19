begin;

alter table public.sales_documents
  add column if not exists revision_number integer not null default 0,
  add column if not exists correction_pending_resend boolean not null default false,
  add column if not exists corrected_at timestamptz;

create table if not exists public.sales_document_revisions(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id)on delete cascade,
  document_id uuid not null references public.sales_documents(id)on delete restrict,
  revision_number integer not null check(revision_number>0),
  reason text not null check(length(trim(reason))>0),
  document_snapshot jsonb not null,
  lines_snapshot jsonb not null,
  corrected_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(document_id,revision_number)
);
alter table public.sales_document_revisions enable row level security;
drop policy if exists sales_document_revisions_read on public.sales_document_revisions;
create policy sales_document_revisions_read on public.sales_document_revisions for select to authenticated
  using(public.is_workspace_member(workspace_id));

create or replace function public.correct_issued_invoice(
  p_invoice_id uuid,p_customer_id uuid,p_template_id uuid,p_due_date date,
  p_service_date text,p_header_text text,p_terms_text text,p_reason text,
  p_line_descriptions jsonb
)returns integer language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype;v_revision integer;v_customer jsonb;v_old_lines jsonb;
begin
  select*into d from public.sales_documents where id=p_invoice_id for update;
  if not found or d.document_type<>'invoice'then raise exception'Invoice not found';end if;
  if d.status in('draft','void')then raise exception'Only issued, non-void invoices can be corrected';end if;
  if not public.can_write(d.workspace_id)then raise exception'Not authorized';end if;
  if nullif(trim(p_reason),'')is null then raise exception'Correction reason is required';end if;
  select to_jsonb(c)into v_customer from public.counterparties c where c.id=p_customer_id and c.workspace_id=d.workspace_id;
  if v_customer is null then raise exception'Customer not found in this company';end if;
  if p_template_id is not null and not exists(select 1 from public.document_templates where id=p_template_id and workspace_id=d.workspace_id and document_type='invoice')then raise exception'Invoice layout not found in this company';end if;
  if jsonb_typeof(p_line_descriptions)is distinct from'array'or jsonb_array_length(p_line_descriptions)<>(select count(*)from public.sales_document_lines where document_id=d.id)then raise exception'Every invoice line must be included';end if;
  if exists(select 1 from jsonb_to_recordset(p_line_descriptions)as x(id uuid,description text)where nullif(trim(x.description),'')is null or not exists(select 1 from public.sales_document_lines l where l.id=x.id and l.document_id=d.id))then raise exception'Invalid invoice line correction';end if;
  select coalesce(jsonb_agg(to_jsonb(l)order by l.line_no),'[]'::jsonb)into v_old_lines from public.sales_document_lines l where l.document_id=d.id;
  v_revision:=d.revision_number+1;
  insert into public.sales_document_revisions(workspace_id,document_id,revision_number,reason,document_snapshot,lines_snapshot,corrected_by)
  values(d.workspace_id,d.id,v_revision,trim(p_reason),to_jsonb(d),v_old_lines,auth.uid());
  update public.sales_documents set customer_id=p_customer_id,customer_snapshot=v_customer,template_id=p_template_id,due_date=p_due_date,
    service_date=nullif(trim(p_service_date),''),header_text=nullif(trim(p_header_text),''),terms_text=nullif(trim(p_terms_text),''),
    revision_number=v_revision,correction_pending_resend=true,corrected_at=now(),updated_at=now()where id=d.id;
  update public.sales_document_lines l set description=x.description
  from jsonb_to_recordset(p_line_descriptions)as x(id uuid,description text)where l.id=x.id and l.document_id=d.id;
  insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)
  values(d.workspace_id,'invoice',d.id,'corrected',auth.uid(),jsonb_build_object('revision_number',v_revision,'reason',trim(p_reason),'requires_resend',true));
  return v_revision;
end$$;
revoke all on function public.correct_issued_invoice(uuid,uuid,uuid,date,text,text,text,text,jsonb)from public;
grant execute on function public.correct_issued_invoice(uuid,uuid,uuid,date,text,text,text,text,jsonb)to authenticated;

commit;

select jsonb_build_object(
  'revision_table',to_regclass('public.sales_document_revisions')is not null,
  'correction_columns',(select count(*)from information_schema.columns where table_schema='public'and table_name='sales_documents'and column_name in('revision_number','correction_pending_resend','corrected_at')),
  'correction_function',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname='correct_issued_invoice')
)as verification;
