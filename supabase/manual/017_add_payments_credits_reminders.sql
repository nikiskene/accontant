-- Payment allocation, credit-note creation, and reminder history.
begin;
create table if not exists public.payment_reminders (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 invoice_id uuid not null references public.sales_documents(id) on delete cascade,
 reminder_level integer not null default 1 check(reminder_level between 1 and 9),
 reminder_date date not null default current_date, status text not null default 'draft' check(status in('draft','queued','sent','cancelled')),
 subject text not null, message text not null, sent_at timestamptz, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
alter table public.payment_reminders enable row level security;
drop policy if exists payment_reminders_read on public.payment_reminders;drop policy if exists payment_reminders_write on public.payment_reminders;
create policy payment_reminders_read on public.payment_reminders for select to authenticated using(public.is_workspace_member(workspace_id));
create policy payment_reminders_write on public.payment_reminders for all to authenticated using(public.can_write(workspace_id)) with check(public.can_write(workspace_id));
commit;

create or replace function public.record_customer_payment(p_invoice_id uuid,p_payment_date date,p_amount numeric,p_reference text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype;v_payment uuid;v_due numeric;
begin select * into d from public.sales_documents where id=p_invoice_id and document_type='invoice' and status<>'void' for update;
if not found then raise exception 'Open invoice not found';end if;if not public.can_write(d.workspace_id) then raise exception 'Not authorized';end if;
v_due:=d.total-d.amount_paid;if p_amount<=0 or p_amount>v_due then raise exception 'Payment must be positive and no more than %',v_due;end if;
insert into public.customer_payments(workspace_id,customer_id,payment_date,amount,currency,reference) values(d.workspace_id,d.customer_id,p_payment_date,p_amount,d.currency,p_reference) returning id into v_payment;
insert into public.payment_allocations(workspace_id,payment_id,invoice_id,amount) values(d.workspace_id,v_payment,p_invoice_id,p_amount);
update public.sales_documents set amount_paid=amount_paid+p_amount,status=case when amount_paid+p_amount>=total then 'paid' else 'partially_paid' end,updated_at=now() where id=p_invoice_id;
insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)values(d.workspace_id,'invoice',p_invoice_id,'payment_recorded',auth.uid(),jsonb_build_object('payment_id',v_payment,'amount',p_amount));return v_payment;end$$;

create or replace function public.create_credit_note(p_invoice_id uuid,p_fraction numeric default 1,p_issue_date date default current_date)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype;v_id uuid;v_number text;
begin select * into d from public.sales_documents where id=p_invoice_id and document_type='invoice' and status<>'void' for update;if not found then raise exception 'Invoice not found';end if;
if not public.can_write(d.workspace_id) then raise exception 'Not authorized';end if;if p_fraction<=0 or p_fraction>1 then raise exception 'Fraction must be between 0 and 1';end if;
v_number:=public.next_document_number(d.workspace_id,'credit_note',p_issue_date);
insert into public.sales_documents(workspace_id,document_type,document_number,customer_id,issue_date,currency,status,subtotal,tax_total,total,created_by)
values(d.workspace_id,'credit_note',v_number,d.customer_id,p_issue_date,d.currency,'draft',-round(d.subtotal*p_fraction,2),-round(d.tax_total*p_fraction,2),-round(d.total*p_fraction,2),auth.uid())returning id into v_id;
insert into public.sales_document_lines(workspace_id,document_id,line_no,product_service_id,description,quantity,unit,unit_price,discount_percent,vat_code_id,vat_rate,net_amount,vat_amount,gross_amount,revenue_account_id)
select workspace_id,v_id,line_no,product_service_id,'Credit: '||description,-quantity*p_fraction,unit,unit_price,discount_percent,vat_code_id,vat_rate,-round(net_amount*p_fraction,2),-round(vat_amount*p_fraction,2),-round(gross_amount*p_fraction,2),revenue_account_id from public.sales_document_lines where document_id=p_invoice_id;
insert into public.sales_document_links(workspace_id,source_document_id,target_document_id,link_type,fraction)values(d.workspace_id,p_invoice_id,v_id,'invoice_to_credit_note',p_fraction);return v_id;end$$;
revoke all on function public.record_customer_payment(uuid,date,numeric,text) from public;revoke all on function public.create_credit_note(uuid,numeric,date) from public;
grant execute on function public.record_customer_payment(uuid,date,numeric,text) to authenticated;grant execute on function public.create_credit_note(uuid,numeric,date) to authenticated;
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in('record_customer_payment','create_credit_note') order by proname;
