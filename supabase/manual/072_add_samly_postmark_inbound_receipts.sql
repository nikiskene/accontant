-- Dedicated Postmark inbound routing for public Samly accounts.
-- Existing Microsoft Graph / billing@iacy.com mailboxes retain provider=microsoft_graph
-- and are never selected by the Postmark webhook.
begin;

alter table public.receipt_mailboxes add column if not exists provider text not null default 'microsoft_graph';
alter table public.receipt_mailboxes drop constraint if exists receipt_mailboxes_provider_check;
alter table public.receipt_mailboxes add constraint receipt_mailboxes_provider_check check(provider in ('microsoft_graph','postmark_inbound'));
update public.receipt_mailboxes set provider='microsoft_graph' where provider is null;
create index if not exists receipt_mailboxes_provider_enabled_idx on public.receipt_mailboxes(provider,enabled);

create or replace function public.create_samly_account(p_company_name text,p_country text,p_language_code text default 'en')
returns table(account_id uuid, workspace_id uuid)
language plpgsql security definer set search_path=public as $$
declare v_account uuid; v_workspace uuid; v_mailbox uuid; v_address text; v_country text:=upper(trim(coalesce(p_country,''))); v_language text:=lower(trim(coalesce(p_language_code,'en'))); v_currency text; v_year integer:=extract(year from current_date)::integer; v_lifetime boolean:=false;
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
 v_address:='receipts+'||replace(v_account::text,'-','')||'@inbound.samly.cc';
 insert into public.receipt_mailboxes(mailbox,provider,enabled,ai_enabled,auto_book,start_at) values(v_address,'postmark_inbound',true,true,false,now()) returning id into v_mailbox;
 insert into public.receipt_mailbox_members(mailbox_id,user_id) values(v_mailbox,auth.uid());
 insert into public.receipt_aliases(alias,mailbox_id,workspace_id) values(v_address,v_mailbox,v_workspace);
 return query select v_account,v_workspace;
end $$;

revoke all on function public.create_samly_account(text,text,text) from public;
grant execute on function public.create_samly_account(text,text,text) to authenticated;
commit;

select jsonb_build_object(
 'postmark_provider_supported',exists(select 1 from pg_constraint where conname='receipt_mailboxes_provider_check' and pg_get_constraintdef(oid) like '%postmark_inbound%'),
 'existing_iacy_mailboxes_remain_graph',(select count(*)=0 from public.receipt_mailboxes where mailbox in ('billing@iacy.com') and provider<>'microsoft_graph'),
 'new_samly_accounts_get_dedicated_address',position('inbound.samly.cc' in pg_get_functiondef('public.create_samly_account(text,text,text)'::regprocedure))>0,
 'postmark_function_source','Deploy postmark-receipt-inbound after this SQL and configure Postmark inbound forwarding.'
) as samly_postmark_inbound_verification;
