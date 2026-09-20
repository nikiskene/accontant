-- Samly permanent free setup plan. It has no calendar expiry.
begin;

alter table public.samly_accounts drop constraint if exists samly_accounts_plan_code_check;
alter table public.samly_accounts add constraint samly_accounts_plan_code_check
  check (plan_code in ('pending', 'free_setup', 'monthly', 'annual', 'lifetime'));

create or replace function public.create_samly_account(p_company_name text,p_country text,p_language_code text default 'en')
returns table(account_id uuid, workspace_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_account uuid; v_workspace uuid; v_country text:=upper(trim(coalesce(p_country,''))); v_language text:=lower(trim(coalesce(p_language_code,'en'))); v_currency text; v_year integer:=extract(year from current_date)::integer; v_lifetime boolean:=false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_company_name),'') is null or char_length(trim(p_company_name))>160 then raise exception 'Enter a company name of up to 160 characters'; end if;
  if v_country not in ('AT','AE') then raise exception 'Choose Austria or United Arab Emirates'; end if;
  if v_language not in ('en','de') then raise exception 'Unsupported language'; end if;
  if exists(select 1 from public.samly_accounts where owner_user_id=auth.uid()) then raise exception 'A Samly account already exists for this user'; end if;
  v_currency:=case v_country when 'AT' then 'EUR' else 'AED' end;
  v_lifetime:=exists(select 1 from public.samly_lifetime_entitlements where owner_user_id=auth.uid());
  insert into public.samly_accounts(owner_user_id,display_name,language_code,billing_email,plan_code,subscription_status)
  values(auth.uid(),trim(p_company_name),v_language,(select email from auth.users where id=auth.uid()),case when v_lifetime then 'lifetime' else 'free_setup' end,case when v_lifetime then 'active' else 'trialing' end) returning id into v_account;
  insert into public.workspaces(legal_name,trade_name,country,base_currency,owner_user_id) values(trim(p_company_name),trim(p_company_name),v_country,v_currency,auth.uid()) returning id into v_workspace;
  insert into public.workspace_members(workspace_id,user_id,role) values(v_workspace,auth.uid(),'owner');
  insert into public.workspace_settings(workspace_id) values(v_workspace) on conflict(workspace_id) do nothing;
  insert into public.tax_years(workspace_id,label,start_date,end_date,status,is_default) values(v_workspace,v_year::text,make_date(v_year,1,1),make_date(v_year,12,31),'open',true);
  insert into public.samly_account_workspaces(account_id,workspace_id) values(v_account,v_workspace);
  return query select v_account,v_workspace;
end $$;

create or replace function public.samly_assert_free_setup_capacity(p_workspace_id uuid,p_resource text)
returns void language plpgsql security definer set search_path=public as $$
declare v_plan text; v_used integer; v_limit constant integer:=10;
begin
  select a.plan_code into v_plan from public.samly_account_workspaces aw join public.samly_accounts a on a.id=aw.account_id where aw.workspace_id=p_workspace_id;
  if v_plan is distinct from 'free_setup' then return; end if;
  if p_resource='customer' then select count(*) into v_used from public.counterparties where workspace_id=p_workspace_id and kind in ('customer','both');
  elsif p_resource='invoice' then select count(*) into v_used from public.sales_documents where workspace_id=p_workspace_id and document_type='invoice' and status<>'draft';
  elsif p_resource='receipt' then select count(*) into v_used from public.receipt_candidates where workspace_id=p_workspace_id;
  else raise exception 'Unknown Samly usage resource'; end if;
  if v_used>=v_limit then raise exception 'Your free setup plan includes 10 %s. Activate a Samly plan to create another one.',p_resource; end if;
end $$;

create or replace function public.enforce_samly_free_setup_customer_limit()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.kind in ('customer','both') and (tg_op='INSERT' or old.kind not in ('customer','both')) then perform public.samly_assert_free_setup_capacity(new.workspace_id,'customer'); end if;
  return new;
end $$;
drop trigger if exists samly_free_setup_customer_limit on public.counterparties;
create trigger samly_free_setup_customer_limit before insert or update of kind on public.counterparties for each row execute function public.enforce_samly_free_setup_customer_limit();

create or replace function public.enforce_samly_free_setup_receipt_limit()
returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.samly_assert_free_setup_capacity(new.workspace_id,'receipt'); return new; end $$;
drop trigger if exists samly_free_setup_receipt_limit on public.receipt_candidates;
create trigger samly_free_setup_receipt_limit before insert on public.receipt_candidates for each row when (new.workspace_id is not null) execute function public.enforce_samly_free_setup_receipt_limit();

create or replace function public.issue_sales_document(p_document_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_doc public.sales_documents%rowtype; v_profile public.company_legal_profiles%rowtype; v_customer public.counterparties%rowtype; v_bank public.company_bank_accounts%rowtype;
begin
  select * into v_doc from public.sales_documents where id=p_document_id for update;
  if not found then raise exception 'Document not found'; end if;
  if not public.can_write(v_doc.workspace_id) then raise exception 'Not authorized'; end if;
  if v_doc.status<>'draft' then raise exception 'Only draft documents can be issued'; end if;
  if v_doc.document_type='invoice' then perform public.samly_assert_free_setup_capacity(v_doc.workspace_id,'invoice'); end if;
  if v_doc.total<=0 or not exists(select 1 from public.sales_document_lines where document_id=p_document_id) then raise exception 'Document requires at least one positive line'; end if;
  select * into v_profile from public.company_legal_profiles where workspace_id=v_doc.workspace_id;
  if v_profile.address_line_1 is null or v_profile.city is null or coalesce(v_profile.vat_number,v_profile.uid_number,v_profile.tax_identification_number) is null then raise exception 'Complete company address and tax credentials before issuing'; end if;
  select * into v_customer from public.counterparties where id=v_doc.customer_id and workspace_id=v_doc.workspace_id;
  if not found then raise exception 'Customer not found in this company'; end if;
  select * into v_bank from public.company_bank_accounts where workspace_id=v_doc.workspace_id and is_active order by is_default desc,created_at limit 1;
  update public.sales_documents set document_number=coalesce(document_number,public.next_document_number(v_doc.workspace_id,v_doc.document_type,v_doc.issue_date)),issuer_snapshot=jsonb_build_object('legal_name',(select legal_name from public.workspaces where id=v_doc.workspace_id),'profile',to_jsonb(v_profile)),customer_snapshot=to_jsonb(v_customer),bank_snapshot=case when v_bank.id is null then null else to_jsonb(v_bank) end,status='sent',issued_at=now(),sent_at=now(),updated_at=now() where id=p_document_id;
  insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details) values(v_doc.workspace_id,v_doc.document_type,p_document_id,'issued',auth.uid(),jsonb_build_object('snapshot_frozen',true));
end $$;

create or replace function public.samly_free_setup_usage()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_account public.samly_accounts%rowtype; v_workspace uuid;
begin
  select * into v_account from public.samly_accounts where owner_user_id=auth.uid();
  if not found then return null; end if;
  select workspace_id into v_workspace from public.samly_account_workspaces where account_id=v_account.id;
  return jsonb_build_object('plan_code',v_account.plan_code,'subscription_status',v_account.subscription_status,'limits',jsonb_build_object('customers',10,'invoices',10,'receipts',10),'usage',jsonb_build_object('customers',(select count(*) from public.counterparties where workspace_id=v_workspace and kind in ('customer','both')),'invoices',(select count(*) from public.sales_documents where workspace_id=v_workspace and document_type='invoice' and status<>'draft'),'receipts',(select count(*) from public.receipt_candidates where workspace_id=v_workspace)));
end $$;

revoke all on function public.samly_assert_free_setup_capacity(uuid,text),public.enforce_samly_free_setup_customer_limit(),public.enforce_samly_free_setup_receipt_limit(),public.samly_free_setup_usage() from public;
grant execute on function public.create_samly_account(text,text,text),public.issue_sales_document(uuid),public.samly_free_setup_usage() to authenticated;
commit;

select jsonb_build_object(
 'free_setup_plan_supported',exists(select 1 from pg_constraint where conname='samly_accounts_plan_code_check' and pg_get_constraintdef(oid) like '%free_setup%'),
 'new_account_defaults_to_free_setup',position('free_setup' in pg_get_functiondef('public.create_samly_account(text,text,text)'::regprocedure))>0,
 'customer_guard',exists(select 1 from pg_trigger where tgname='samly_free_setup_customer_limit' and not tgisinternal),
 'receipt_guard',exists(select 1 from pg_trigger where tgname='samly_free_setup_receipt_limit' and not tgisinternal),
 'invoice_guard',position('samly_assert_free_setup_capacity' in pg_get_functiondef('public.issue_sales_document(uuid)'::regprocedure))>0,
 'usage_rpc',to_regprocedure('public.samly_free_setup_usage()') is not null
) as samly_free_setup_plan_verification;
