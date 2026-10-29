begin;
alter table public.samly_accounts add column if not exists complimentary_until timestamptz;
create or replace function public.is_samly_superadmin() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(auth.uid()='c0a1df38-31e5-4feb-9c31-82ad11cc9af0'::uuid,false) and public.is_samly_admin();
$$;
create table public.samly_admin_actions (
 id uuid primary key, actor_id uuid not null, user_id uuid not null, user_email text,
 action text not null check(action in ('grant_month','delete_user')), status text not null default 'pending' check(status in ('pending','done','failed')),
 access_until timestamptz, error text, created_at timestamptz not null default now(), completed_at timestamptz
);
create unique index samly_admin_actions_one_pending on public.samly_admin_actions(user_id) where status='pending';
create table public.samly_removed_users(user_id uuid primary key, removed_at timestamptz not null default now());
alter table public.samly_admin_actions enable row level security;
alter table public.samly_removed_users enable row level security;
revoke all on public.samly_admin_actions,public.samly_removed_users from anon,authenticated;
grant select on public.samly_admin_actions to authenticated;
grant all on public.samly_admin_actions,public.samly_removed_users to service_role;
create policy superadmin_audit_read on public.samly_admin_actions for select to authenticated using(public.is_samly_superadmin());
create or replace function public.samly_user_not_removed() returns boolean language sql stable security definer set search_path=public as $$
 select not exists(select 1 from public.samly_removed_users where user_id=auth.uid());
$$;
-- Existing access tokens must lose data access immediately, even before JWT expiry.
do $$ declare t record; begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relrowsecurity and c.relkind='r' and (n.nspname='public' or (n.nspname='storage' and c.relname='objects')) loop
 execute format('create policy samly_removed_user_denied on %I.%I as restrictive for all to authenticated using ((select public.samly_user_not_removed())) with check ((select public.samly_user_not_removed()))',t.nspname,t.relname);
 end loop;
end $$;
create or replace function public.samly_admin_users_list() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_samly_superadmin() then raise exception 'Superadmin access required'; end if;
 return coalesce((select jsonb_agg(x order by x.created_at desc) from (
 select u.id user_id,u.email,u.created_at,u.last_sign_in_at,u.deleted_at,
 exists(select 1 from public.samly_removed_users r where r.user_id=u.id) removed,
 exists(select 1 from public.samly_admin_users ad where ad.user_id=u.id) is_admin,
 a.id account_id,a.display_name,a.plan_code,a.subscription_status,a.subscription_current_period_end,a.complimentary_until,
 coalesce((select jsonb_agg(jsonb_build_object('name',w.legal_name,'country',w.country)) from public.workspaces w where w.owner_user_id=u.id or exists(select 1 from public.workspace_members m where m.workspace_id=w.id and m.user_id=u.id)),'[]'::jsonb) companies
 from auth.users u left join public.samly_accounts a on a.owner_user_id=u.id
 ) x),'[]'::jsonb);
end $$;
create or replace function public.samly_begin_admin_action(p_id uuid,p_actor uuid,p_user uuid,p_email text,p_action text,p_paid_until timestamptz default null) returns public.samly_admin_actions language plpgsql security definer set search_path=public as $$
declare v public.samly_admin_actions; u auth.users; a public.samly_accounts;
begin
 if p_actor is distinct from 'c0a1df38-31e5-4feb-9c31-82ad11cc9af0'::uuid or not exists(select 1 from public.samly_admin_users where user_id=p_actor) then raise exception 'Superadmin access required'; end if;
 select * into u from auth.users where id=p_user for update;
 if not found then raise exception 'User not found'; end if;
 select * into v from public.samly_admin_actions where id=p_id;
 if found then
  if v.user_id<>p_user or v.action<>p_action or v.actor_id<>p_actor then raise exception 'Action does not match'; end if;
  if v.status='failed' then update public.samly_admin_actions set status='pending',error=null where id=p_id returning * into v; end if;
  return v;
 end if;
 if u.deleted_at is not null or exists(select 1 from public.samly_removed_users where user_id=p_user) then raise exception 'User has already been removed'; end if;
 if lower(trim(p_email)) is distinct from lower(u.email) then raise exception 'Confirmation email does not match'; end if;
 if p_user=p_actor or exists(select 1 from public.samly_admin_users where user_id=p_user) then raise exception 'Administrator accounts are protected'; end if;
 select * into a from public.samly_accounts where owner_user_id=p_user for update;
 if p_action='grant_month' and a.id is null then raise exception 'This user must finish company setup before receiving a free month'; end if;
 if p_action='grant_month' and a.plan_code='lifetime' then raise exception 'Lifetime access does not need a free month'; end if;
 insert into public.samly_admin_actions(id,actor_id,user_id,user_email,action,access_until)
 values(p_id,p_actor,p_user,u.email,p_action,case when p_action='grant_month' then greatest(now(),a.complimentary_until,p_paid_until,case when a.subscription_status in ('active','trialing') and a.plan_code<>'free_setup' then a.subscription_current_period_end end)+interval '1 month' end) returning * into v;
 return v;
end $$;
create or replace function public.samly_complete_admin_action(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v public.samly_admin_actions;
begin
 select * into v from public.samly_admin_actions where id=p_id for update;
 if not found then raise exception 'Action not found'; end if;
 if v.status='done' then return; end if;
 if v.action='grant_month' then
 update public.samly_accounts set complimentary_until=greatest(complimentary_until,v.access_until),updated_at=now() where owner_user_id=v.user_id;
 if not found then raise exception 'Account not found'; end if;
 else
 if not exists(select 1 from auth.users where id=v.user_id and deleted_at is not null) then raise exception 'Authentication deletion must complete first'; end if;
 delete from public.workspace_members where user_id=v.user_id;
 delete from public.receipt_mailbox_members where user_id=v.user_id;
 update public.samly_accounts set subscription_status='cancelled',complimentary_until=null,updated_at=now() where owner_user_id=v.user_id;
 end if;
 update public.samly_admin_actions set status='done',error=null,completed_at=now() where id=p_id;
end $$;
create or replace function public.delete_samly_bug_report(p_report_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_samly_superadmin() then raise exception 'Superadmin access required'; end if;
 delete from public.samly_bug_reports where id=p_report_id;
 if not found then raise exception 'Bug report not found'; end if;
end $$;
-- Keep the original free-setup guards, but lift limits only until the gift expires.
create or replace function public.samly_assert_free_setup_capacity(p_workspace_id uuid,p_resource text)
returns void language plpgsql security definer set search_path=public as $$
declare v_plan text; v_until timestamptz; v_used integer; v_limit constant integer:=10;
begin
 select a.plan_code,a.complimentary_until into v_plan,v_until from public.samly_account_workspaces aw join public.samly_accounts a on a.id=aw.account_id where aw.workspace_id=p_workspace_id;
 if v_plan is distinct from 'free_setup' or v_until>now() then return; end if;
 if p_resource='customer' then select count(*) into v_used from public.counterparties where workspace_id=p_workspace_id and kind in ('customer','both');
 elsif p_resource='invoice' then select count(*) into v_used from public.sales_documents where workspace_id=p_workspace_id and document_type='invoice' and status<>'draft';
 elsif p_resource='receipt' then select count(*) into v_used from public.receipt_candidates where workspace_id=p_workspace_id;
 else raise exception 'Unknown Samly usage resource'; end if;
 if v_used>=v_limit then raise exception 'Your free setup plan includes 10 %s. Activate a Samly plan to create another one.',p_resource; end if;
end $$;
revoke all on function public.is_samly_superadmin(),public.samly_user_not_removed(),public.samly_admin_users_list(),public.delete_samly_bug_report(uuid) from public;
grant execute on function public.is_samly_superadmin(),public.samly_user_not_removed(),public.samly_admin_users_list(),public.delete_samly_bug_report(uuid) to authenticated;
revoke all on function public.samly_begin_admin_action(uuid,uuid,uuid,text,text,timestamptz),public.samly_complete_admin_action(uuid) from public,anon,authenticated;
grant execute on function public.samly_begin_admin_action(uuid,uuid,uuid,text,text,timestamptz),public.samly_complete_admin_action(uuid) to service_role;
create or replace function public.samly_free_setup_usage()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_account public.samly_accounts%rowtype; v_workspace uuid;
begin
  select * into v_account from public.samly_accounts where owner_user_id=auth.uid();
  if not found then return null; end if;
  select workspace_id into v_workspace from public.samly_account_workspaces where account_id=v_account.id;
  return jsonb_build_object('complimentary_until',v_account.complimentary_until,'plan_code',v_account.plan_code,'subscription_status',v_account.subscription_status,'limits',jsonb_build_object('customers',10,'invoices',10,'receipts',10),'usage',jsonb_build_object('customers',(select count(*) from public.counterparties where workspace_id=v_workspace and kind in ('customer','both')),'invoices',(select count(*) from public.sales_documents where workspace_id=v_workspace and document_type='invoice' and status<>'draft'),'receipts',(select count(*) from public.receipt_candidates where workspace_id=v_workspace)));
end $$;


-- Deny stale tokens at the API boundary too, including security-definer RPCs.
create or replace function public.samly_check_api_access() returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.samly_user_not_removed() then raise insufficient_privilege using message='This user has been deleted'; end if;
end $$;
revoke all on function public.samly_check_api_access() from public;
grant execute on function public.samly_check_api_access() to anon,authenticated,service_role;
alter role authenticator set pgrst.db_pre_request='public.samly_check_api_access';
notify pgrst, 'reload config';
commit;
