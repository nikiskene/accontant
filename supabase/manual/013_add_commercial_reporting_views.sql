create or replace view public.v_invoice_balances with (security_invoker = true) as
select d.workspace_id, d.id invoice_id, d.document_number, d.customer_id, d.issue_date,
  d.due_date, d.currency, d.status, d.total, d.amount_paid,
  round(d.total-d.amount_paid,2) amount_due,
  d.due_date < current_date and d.total > d.amount_paid as is_overdue
from public.sales_documents d where d.document_type='invoice' and d.status<>'void';

create or replace view public.v_sales_analysis_monthly with (security_invoker = true) as
select workspace_id, date_trunc('month',issue_date)::date month,
  extract(year from issue_date)::integer fiscal_year, currency, count(*) invoices,
  round(sum(total),2) invoiced_revenue, round(sum(amount_paid),2) collected_revenue
from public.sales_documents where document_type='invoice' and status<>'void'
group by workspace_id,date_trunc('month',issue_date),extract(year from issue_date),currency;

grant select on public.v_invoice_balances, public.v_sales_analysis_monthly to authenticated;
select table_name from information_schema.views where table_schema='public'
and table_name in ('v_invoice_balances','v_sales_analysis_monthly') order by table_name;
