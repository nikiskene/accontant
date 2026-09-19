-- Admin-only removal of spam, duplicates, or obsolete Samly feature requests.
begin;
create or replace function public.delete_samly_feature_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_samly_admin() then raise exception 'Samly administrator access required'; end if;
  delete from public.samly_feature_requests where id = p_request_id;
  if not found then raise exception 'Feature request not found'; end if;
end;
$$;
revoke all on function public.delete_samly_feature_request(uuid) from public;
grant execute on function public.delete_samly_feature_request(uuid) to authenticated;
commit;
select to_regprocedure('public.delete_samly_feature_request(uuid)') is not null as samly_feature_request_deletion_ready;
