-- Run after 084, against the affected dataset. Every fixture is rolled back.
begin;
do $$
declare ws constant uuid:='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'; income numeric; tid uuid; did uuid; original_invoice public.sales_documents%rowtype;
begin
 select * into original_invoice from public.sales_documents where workspace_id=ws and document_number='10084';
 select sum(amount) into income from public.profit_and_loss(ws,'2026-01-01','2026-10-27') where type='income';
 if income is distinct from -18400 then raise exception 'Expected net invoice revenue 18400, got %',income;end if;
 if public.pl_currency_amount(100,'EUR','EUR','2026-05-18')<>100 then raise exception 'Same-currency conversion failed';end if;
 select sum(amount) into income from public.profit_and_loss(ws,'2026-05-01','2026-05-31') where type='income';
 if income is distinct from -4400 then raise exception 'Invoice date filter failed';end if;
 update public.sales_documents set status='draft' where id=original_invoice.id;
 select sum(amount) into income from public.profit_and_loss(ws,'2026-01-01','2026-10-27') where type='income';
 if income is distinct from -14000 then raise exception 'Draft must not count';end if;
 update public.sales_documents set status='void' where id=original_invoice.id;
 select sum(amount) into income from public.profit_and_loss(ws,'2026-01-01','2026-10-27') where type='income';
 if income is distinct from -14000 then raise exception 'Void must not count';end if;
 update public.sales_documents set status=original_invoice.status where id=original_invoice.id;
 insert into public.transactions(workspace_id,txn_date,txn_type,status,currency,invoice_number,counterparty_id)
 values(ws,original_invoice.issue_date,'sale','posted','EUR','10084',original_invoice.customer_id) returning id into tid;
 insert into public.transaction_lines(workspace_id,transaction_id,line_no,account_id,amount)
 select ws,tid,1,id,-4400 from public.accounts where workspace_id=ws and code='4000';
 insert into public.transaction_lines(workspace_id,transaction_id,line_no,account_id,amount)
 select ws,tid,2,id,5280 from public.accounts where workspace_id=ws and code='2800';
 insert into public.transaction_lines(workspace_id,transaction_id,line_no,account_id,amount)
 select ws,tid,3,id,-880 from public.accounts where workspace_id=ws and code='3500';
 select sum(amount) into income from public.profit_and_loss(ws,'2026-01-01','2026-10-27') where type='income';
 if income is distinct from -18400 then raise exception 'Existing ledger posting counted twice';end if;
 insert into public.sales_documents(workspace_id,document_type,document_number,customer_id,issue_date,currency,status,subtotal,tax_total,total)
 values(ws,'credit_note','PL-REGRESSION-CREDIT',original_invoice.customer_id,'2026-09-01','EUR','sent',-100,-20,-120) returning id into did;
 insert into public.sales_document_lines(workspace_id,document_id,line_no,description,quantity,unit_price,net_amount,vat_amount,gross_amount,revenue_account_id)
 select ws,did,1,'Test credit',-1,100,-100,-20,-120,id from public.accounts where workspace_id=ws and code='4000';
 select sum(amount) into income from public.profit_and_loss(ws,'2026-01-01','2026-10-27') where type='income';
 if income is distinct from -18300 then raise exception 'Credit note did not reduce revenue';end if;
 if (select amount from public.profit_and_loss_layout(ws,'2026-01-01','2026-10-27') where label='Total for Income') is distinct from income then raise exception 'PDF and screen disagree';end if;
end $$;
-- Exercise the same RLS context used by the browser, including negative access.
select set_config('request.jwt.claim.sub',(select owner_user_id::text from public.workspaces where id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'),true);
set local role authenticated;
do $$begin
 if not exists(select 1 from public.profit_and_loss('d621017c-e9bd-4334-a07f-5e7b6d31ef6e','2026-01-01','2026-10-27') where type='income') then raise exception 'Owner cannot see revenue';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $$begin
 if exists(select 1 from public.profit_and_loss('d621017c-e9bd-4334-a07f-5e7b6d31ef6e','2026-01-01','2026-10-27')) then raise exception 'Unauthorized report data exposed';end if;
end $$;
reset role;
rollback;
select 'P/L regression checks passed; all fixtures rolled back' result;
