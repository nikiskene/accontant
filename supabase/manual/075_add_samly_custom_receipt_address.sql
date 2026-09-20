-- Lets a Samly owner claim a readable Postmark receipt address while preserving older aliases.
begin;
create or replace function public.set_samly_receipt_address(p_local_part text)
returns text language plpgsql security definer set search_path=public as $$
declare v_local text:=lower(trim(coalesce(p_local_part,''))); v_address text; v_mailbox uuid; v_workspace uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if v_local !~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' then raise exception 'Use 3–32 lowercase letters, numbers or hyphens'; end if;
 if v_local in ('admin','api','billing','contact','hello','legal','mail','noreply','privacy','support','team','samly') then raise exception 'That address is reserved'; end if;
 select m.id,aw.workspace_id into v_mailbox,v_workspace from public.samly_accounts a join public.samly_account_workspaces aw on aw.account_id=a.id join public.receipt_aliases ra on ra.workspace_id=aw.workspace_id join public.receipt_mailboxes m on m.id=ra.mailbox_id and m.provider='postmark_inbound' where a.owner_user_id=auth.uid() order by m.created_at limit 1 for update of m;
 if v_mailbox is null then raise exception 'Samly receipt inbox is not ready'; end if;
 v_address:=v_local||'@inbound.samly.cc';
 if exists(select 1 from public.receipt_aliases where alias=v_address and mailbox_id<>v_mailbox) then raise exception 'That receipt address is already taken'; end if;
 insert into public.receipt_aliases(alias,mailbox_id,workspace_id) values(v_address,v_mailbox,v_workspace) on conflict(alias) do nothing;
 update public.receipt_mailboxes set mailbox=v_address where id=v_mailbox;
 return v_address;
end $$;
revoke all on function public.set_samly_receipt_address(text) from public;
grant execute on function public.set_samly_receipt_address(text) to authenticated;
commit;
select jsonb_build_object('custom_address_rpc',to_regprocedure('public.set_samly_receipt_address(text)')is not null,'inbound_domain','inbound.samly.cc')as samly_custom_receipt_address_verification;
