-- P/L includes issued commercial invoices not already represented by posted income.
-- No historical bank movements or accounting journal entries are manufactured.
begin;
create or replace function public.pl_currency_amount(p_amount numeric,p_currency text,p_base text,p_date date)
returns numeric language plpgsql stable security invoker set search_path=public as $$
declare r numeric; s numeric;
begin
 if p_currency=p_base then return p_amount; end if;
 select rate into r from public.fx_rates where base_currency=p_currency and quote_currency=p_base and rate_date<=p_date order by rate_date desc limit 1;
 if r is not null and r>0 then return p_amount*r; end if;
 select rate into r from public.fx_rates where base_currency=p_base and quote_currency=p_currency and rate_date<=p_date order by rate_date desc limit 1;
 if r is not null and r>0 then return p_amount/r; end if;
 if p_currency='AED' then r:=1; else
 select rate into r from public.fx_rates where base_currency=p_currency and quote_currency='AED' and rate_date<=p_date order by rate_date desc limit 1;
 end if;
 if p_base='AED' then s:=1; else
 select rate into s from public.fx_rates where base_currency=p_base and quote_currency='AED' and rate_date<=p_date order by rate_date desc limit 1;
 end if;
 if r is null or s is null or r<=0 or s<=0 then raise exception 'Missing exchange rate: % to % on %',p_currency,p_base,p_date; end if;
 return p_amount*r/s;
end $$;

create or replace function public.pl_source_rows(p_workspace_id uuid,p_from date,p_to date)
returns table(code text,name text,type text,amount numeric)
language sql stable security invoker set search_path=public as $$
 with ws as (
 select id,base_currency from public.workspaces where id=p_workspace_id
 ), ledger as (
 select a.code,a.name,a.type,
 public.pl_currency_amount(l.amount,t.currency,w.base_currency,t.txn_date) as amount
 from ws w join public.transactions t on t.workspace_id=w.id and t.status='posted'
 join public.transaction_lines l on l.transaction_id=t.id and l.workspace_id=w.id
 join public.accounts a on a.id=l.account_id and a.workspace_id=w.id
 where t.txn_date between p_from and p_to and a.type in ('income','cogs','expense')
 ), commercial as (
 select a.code,a.name,a.type,
 -public.pl_currency_amount(l.net_amount,d.currency,w.base_currency,d.issue_date) as amount
 from ws w join public.sales_documents d on d.workspace_id=w.id
 join public.sales_document_lines l on l.document_id=d.id and l.workspace_id=w.id
 left join public.workspace_settings s on s.workspace_id=w.id
 join public.accounts a on a.id=coalesce(l.revenue_account_id,s.default_revenue_account_id,
 (select aa.id from public.accounts aa where aa.workspace_id=w.id and aa.type='income' and aa.is_active order by aa.code limit 1))
 and a.workspace_id=w.id and a.type='income'
 where d.document_type in ('invoice','credit_note') and d.status in ('sent','partially_paid','paid','overdue')
 and d.issue_date between p_from and p_to
 -- Invoice numbers are scoped to the entity; require matching currency, customer
 -- (when recorded), and full net income to identify an existing ledger posting.
 and not exists (
 select 1 from public.transactions t
 join public.transaction_lines tl on tl.transaction_id=t.id and tl.workspace_id=w.id
 join public.accounts aa on aa.id=tl.account_id and aa.workspace_id=w.id and aa.type='income'
 where t.workspace_id=w.id and t.status='posted' and t.invoice_number=d.document_number
 and t.currency=d.currency and (t.counterparty_id=d.customer_id or t.counterparty_id is null)
 group by t.id having abs(sum(tl.amount)+d.subtotal)<0.01
 )
 ) select * from ledger union all select * from commercial;
$$;

create or replace function public.profit_and_loss(p_workspace_id uuid,p_from date,p_to date)
returns table(code text,name text,type text,amount numeric)
language sql stable security invoker set search_path=public as $$
 select r.code,r.name,r.type,round(sum(r.amount),2)
 from public.pl_source_rows(p_workspace_id,p_from,p_to) r
 group by r.code,r.name,r.type order by r.code;
$$;

CREATE OR REPLACE FUNCTION public.profit_and_loss_layout(p_workspace_id uuid, p_from date, p_to date)
 RETURNS TABLE(sort_order integer, level integer, label text, amount numeric, row_type text)
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
with pl as (
 select r.type as acct_type,r.code,r.name,round(sum(r.amount),6) as amt
 from public.pl_source_rows(p_workspace_id,p_from,p_to) r
 group by r.type,r.code,r.name
),
income_lines as (
  select 11 as sort_order, 1 as level, name as label, amt as amount, 'line'::text as row_type
  from pl
  where acct_type = 'income' and amt <> 0
),
cogs_lines as (
  select 21 as sort_order, 1 as level, name as label, amt as amount, 'line'::text as row_type
  from pl
  where acct_type = 'cogs' and amt <> 0
),
expense_lines as (
  select 41 as sort_order, 1 as level, name as label, amt as amount, 'line'::text as row_type
  from pl
  where acct_type = 'expense' and amt <> 0
),
totals as (
  select
    round(coalesce((select sum(amount) from income_lines), 0), 6) as income_total,
    round(coalesce((select sum(amount) from cogs_lines), 0), 6) as cogs_total,
    round(coalesce((select sum(amount) from expense_lines), 0), 6) as expense_total
)
select
  q.sort_order,
  q.level,
  q.label,
  q.amount,
  q.row_type
from (
  -- Income
  select 10, 0, 'Income', null::numeric, 'header'
  union all
  select sort_order, level, label, amount, row_type from income_lines
  union all
  select 19, 0, 'Total for Income', (select income_total from totals), 'total'

  -- Cost of Sales
  union all
  select 20, 0, 'Cost of Sales', null::numeric, 'header'
  union all
  select sort_order, level, label, amount, row_type from cogs_lines
  union all
  select 29, 0, 'Total for Cost of Sales', (select cogs_total from totals), 'total'

  -- Gross Profit
  union all
  select 30, 0, 'Gross Profit', (select income_total + cogs_total from totals), 'calc'

  -- Expenses
  union all
  select 40, 0, 'Expenses', null::numeric, 'header'
  union all
  select sort_order, level, label, amount, row_type from expense_lines
  union all
  select 49, 0, 'Total for Expenses', (select expense_total from totals), 'total'

  -- Net earnings
  union all
  select 60, 0, 'Net earnings', (select income_total + cogs_total + expense_total from totals), 'calc'
) as q(sort_order, level, label, amount, row_type)
order by q.sort_order, q.level, q.label;
$function$
;
revoke all on function public.pl_currency_amount(numeric,text,text,date) from public;
revoke all on function public.pl_source_rows(uuid,date,date) from public;
revoke all on function public.profit_and_loss(uuid,date,date) from public;
revoke all on function public.profit_and_loss_layout(uuid,date,date) from public;
grant execute on function public.pl_currency_amount(numeric,text,text,date),public.pl_source_rows(uuid,date,date),public.profit_and_loss(uuid,date,date),public.profit_and_loss_layout(uuid,date,date) to authenticated,service_role;
commit;
