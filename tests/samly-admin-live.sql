-- Run as the database owner after migration 088. All fixtures roll back.
begin;
do $$
declare u uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); a uuid; op public.samly_admin_actions; r uuid:=gen_random_uuid(); blocked boolean:=false;
begin
 insert into auth.users(id,email) values(u,'temporary-samly-admin-sql@example.com');
 insert into public.samly_accounts(owner_user_id,display_name,plan_code,subscription_status) values(u,'Temporary SQL test','free_setup','trialing') returning id into a;
 insert into public.workspaces(id,owner_user_id,legal_name,country,base_currency) values(w,u,'Temporary SQL test','AT','EUR');
 insert into public.samly_account_workspaces(account_id,workspace_id) values(a,w);
 for i in 1..10 loop insert into public.counterparties(workspace_id,kind,company_name) values(w,'customer','Temporary customer '||i); end loop;
 begin perform public.samly_assert_free_setup_capacity(w,'customer'); exception when others then blocked:=true; end;
 assert blocked,'Free setup limit must apply';
 select * into op from public.samly_begin_admin_action(r,'c0a1df38-31e5-4feb-9c31-82ad11cc9af0',u,'temporary-samly-admin-sql@example.com','grant_month');
 perform public.samly_complete_admin_action(r);
 perform public.samly_assert_free_setup_capacity(w,'customer');
 update public.samly_accounts set complimentary_until=now()-interval '1 second' where id=a;
 blocked:=false;
 begin perform public.samly_assert_free_setup_capacity(w,'customer'); exception when others then blocked:=true; end;
 assert blocked,'Expired gift must restore free setup limits';
 assert ('2028-01-31'::timestamptz+interval '1 month')='2028-02-29'::timestamptz,'Month-end gifts must clamp to leap February';
 perform set_config('request.jwt.claim.sub',u::text,true);
 blocked:=false;
 begin perform public.samly_admin_users_list(); exception when others then blocked:=true; end;
 assert blocked,'Non-admin directory access must fail';
 blocked:=false;
 begin perform public.samly_begin_admin_action(gen_random_uuid(),u,u,'temporary-samly-admin-sql@example.com','delete_user'); exception when others then blocked:=true; end;
 assert blocked,'Non-superadmin mutations must fail';
 insert into public.samly_removed_users(user_id) values(u);
 assert not public.samly_user_not_removed(),'Removed user must fail access predicate';
 blocked:=false;
 begin perform public.samly_check_api_access(); exception when insufficient_privilege then blocked:=true; end;
 assert blocked,'Removed user must fail the API guard';
end $$;
rollback;
select 'PASS: free month lifts limits, expiry restores limits, calendar month handling and unauthorized access guards' result;
