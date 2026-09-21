-- Move public Samly receipt inboxes from @inbound.samly.cc to @samly.cc.
-- Existing @inbound.samly.cc addresses remain aliases and continue to receive receipts.
-- Only workspaces linked through samly_account_workspaces are affected; personal IACy/Graph mailboxes are untouched.
begin;

-- Fail before changing anything if a root-domain address has been claimed by another inbox.
do $$
declare v_conflicts integer;
begin
  select count(*) into v_conflicts
  from public.receipt_mailboxes m
  join public.receipt_aliases old_alias on old_alias.mailbox_id=m.id and old_alias.alias like '%@inbound.samly.cc'
  join public.samly_account_workspaces aw on aw.workspace_id=old_alias.workspace_id
  join public.receipt_aliases root_alias on root_alias.alias=replace(old_alias.alias,'@inbound.samly.cc','@samly.cc') and root_alias.mailbox_id<>m.id;
  if v_conflicts > 0 then
    raise exception 'Cannot move Samly receipt addresses: % root-domain address(es) are already assigned to a different inbox',v_conflicts;
  end if;
end $$;

-- Give each existing public inbox its root-domain equivalent and make that the displayed primary address.
insert into public.receipt_aliases(alias,mailbox_id,workspace_id)
select replace(old_alias.alias,'@inbound.samly.cc','@samly.cc'), old_alias.mailbox_id, old_alias.workspace_id
from public.receipt_aliases old_alias
join public.receipt_mailboxes m on m.id=old_alias.mailbox_id and m.provider='postmark_inbound'
join public.samly_account_workspaces aw on aw.workspace_id=old_alias.workspace_id
where old_alias.alias like '%@inbound.samly.cc'
on conflict(alias) do nothing;

update public.receipt_mailboxes m
set mailbox=replace(m.mailbox,'@inbound.samly.cc','@samly.cc')
where m.provider='postmark_inbound'
  and m.mailbox like '%@inbound.samly.cc'
  and exists(
    select 1 from public.receipt_aliases ra
    join public.samly_account_workspaces aw on aw.workspace_id=ra.workspace_id
    where ra.mailbox_id=m.id
  );

-- New Samly accounts receive a root-domain address from day one.
create or replace function public.create_samly_account(p_company_name text,p_country text,p_language_code text default 'en')
returns table(account_id uuid, workspace_id uuid)
language plpgsql security definer set search_path=public as $$
#variable_conflict use_column
declare v_account uuid; v_workspace uuid; v_mailbox uuid; v_address text; v_country text:=upper(trim(coalesce(p_country,''))); v_language text:=lower(trim(coalesce(p_language_code,'en'))); v_currency text; v_year integer:=extract(year from current_date)::integer; v_lifetime boolean:=false;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if nullif(trim(p_company_name),'') is null or char_length(trim(p_company_name))>160 then raise exception 'Enter a company name of up to 160 characters'; end if;
 if v_country not in ('AT','AE') then raise exception 'Choose Austria or United Arab Emirates'; end if;
 if v_language not in ('en','de') then raise exception 'Unsupported language'; end if;
 if exists(select 1 from public.samly_accounts a where a.owner_user_id=auth.uid()) then raise exception 'A Samly account already exists for this user'; end if;
 v_currency:=case v_country when 'AT' then 'EUR' else 'AED' end;
 v_lifetime:=exists(select 1 from public.samly_lifetime_entitlements e where e.owner_user_id=auth.uid());
 insert into public.samly_accounts(owner_user_id,display_name,language_code,billing_email,plan_code,subscription_status)
 values(auth.uid(),trim(p_company_name),v_language,(select u.email from auth.users u where u.id=auth.uid()),case when v_lifetime then 'lifetime' else 'free_setup' end,case when v_lifetime then 'active' else 'trialing' end) returning id into v_account;
 insert into public.workspaces(legal_name,trade_name,country,base_currency,owner_user_id) values(trim(p_company_name),trim(p_company_name),v_country,v_currency,auth.uid()) returning id into v_workspace;
 insert into public.workspace_members(workspace_id,user_id,role) values(v_workspace,auth.uid(),'owner');
 insert into public.workspace_settings(workspace_id) values(v_workspace) on conflict(workspace_id) do nothing;
 insert into public.tax_years(workspace_id,label,start_date,end_date,status,is_default) values(v_workspace,v_year::text,make_date(v_year,1,1),make_date(v_year,12,31),'open',true);
 insert into public.samly_account_workspaces(account_id,workspace_id) values(v_account,v_workspace);
 v_address:='receipts+'||replace(v_account::text,'-','')||'@samly.cc';
 insert into public.receipt_mailboxes(mailbox,provider,enabled,ai_enabled,auto_book,start_at) values(v_address,'postmark_inbound',true,true,false,now()) returning id into v_mailbox;
 insert into public.receipt_mailbox_members(mailbox_id,user_id) values(v_mailbox,auth.uid());
 insert into public.receipt_aliases(alias,mailbox_id,workspace_id) values(v_address,v_mailbox,v_workspace);
 return query select v_account,v_workspace;
end $$;

-- Let owners choose a readable root-domain address while preserving all earlier aliases.
create or replace function public.set_samly_receipt_address(p_local_part text)
returns text language plpgsql security definer set search_path=public as $$
declare v_local text:=lower(trim(coalesce(p_local_part,''))); v_address text; v_mailbox uuid; v_workspace uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if v_local !~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' then raise exception 'Use 3–32 lowercase letters, numbers or hyphens'; end if;
 if v_local in ('admin','api','billing','contact','hello','legal','mail','noreply','privacy','support','team','samly') then raise exception 'That address is reserved'; end if;
 select m.id,aw.workspace_id into v_mailbox,v_workspace from public.samly_accounts a join public.samly_account_workspaces aw on aw.account_id=a.id join public.receipt_aliases ra on ra.workspace_id=aw.workspace_id join public.receipt_mailboxes m on m.id=ra.mailbox_id and m.provider='postmark_inbound' where a.owner_user_id=auth.uid() order by m.created_at limit 1 for update of m;
 if v_mailbox is null then raise exception 'Samly receipt inbox is not ready'; end if;
 v_address:=v_local||'@samly.cc';
 if exists(select 1 from public.receipt_aliases where alias=v_address and mailbox_id<>v_mailbox) then raise exception 'That receipt address is already taken'; end if;
 insert into public.receipt_aliases(alias,mailbox_id,workspace_id) values(v_address,v_mailbox,v_workspace) on conflict(alias) do nothing;
 update public.receipt_mailboxes set mailbox=v_address where id=v_mailbox;
 return v_address;
end $$;
revoke all on function public.create_samly_account(text,text,text),public.set_samly_receipt_address(text) from public;
grant execute on function public.create_samly_account(text,text,text),public.set_samly_receipt_address(text) to authenticated;

commit;

select jsonb_build_object(
  'root_receipt_domain','samly.cc',
  'provisioning_uses_root_domain',position('@samly.cc' in pg_get_functiondef('public.create_samly_account(text,text,text)'::regprocedure))>0,
  'custom_address_uses_root_domain',position('@samly.cc' in pg_get_functiondef('public.set_samly_receipt_address(text)'::regprocedure))>0,
  'public_root_primary_addresses',(select count(*) from public.receipt_mailboxes m where m.provider='postmark_inbound' and m.mailbox like '%@samly.cc' and exists(select 1 from public.receipt_aliases ra join public.samly_account_workspaces aw on aw.workspace_id=ra.workspace_id where ra.mailbox_id=m.id)),
  'legacy_inbound_aliases_preserved',(select count(*) from public.receipt_aliases ra join public.samly_account_workspaces aw on aw.workspace_id=ra.workspace_id where ra.alias like '%@inbound.samly.cc'),
  'iacy_graph_mailboxes_untouched',(select count(*) from public.receipt_mailboxes where mailbox='billing@iacy.com' and provider='microsoft_graph')=1
) as samly_root_receipt_domain_verification;
