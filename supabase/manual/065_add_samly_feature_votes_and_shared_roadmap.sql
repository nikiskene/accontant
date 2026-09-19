-- Shared Samly feature roadmap with counted, one-per-user upvotes.
-- Run after 064_allow_samly_admin_feature_requests.sql.

begin;

alter table public.samly_feature_requests
  add column if not exists upvote_count integer not null default 0 check (upvote_count >= 0);

create table if not exists public.samly_feature_request_votes (
  request_id uuid not null references public.samly_feature_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);
create index if not exists samly_feature_request_votes_request_idx on public.samly_feature_request_votes(request_id);

-- Backfill safely if this script is re-run after a partial setup.
update public.samly_feature_requests r
set upvote_count = (select count(*) from public.samly_feature_request_votes v where v.request_id = r.id)
where upvote_count is distinct from (select count(*) from public.samly_feature_request_votes v where v.request_id = r.id);

alter table public.samly_feature_request_votes enable row level security;
revoke all on public.samly_feature_request_votes from anon;
grant select on public.samly_feature_request_votes to authenticated;
grant all on public.samly_feature_request_votes to service_role;

-- A Samly customer sees the shared roadmap, but no unrelated Accontant data.
drop policy if exists samly_feature_requests_customer_read on public.samly_feature_requests;
create policy samly_feature_requests_customer_read on public.samly_feature_requests
  for select to authenticated using (
    public.is_samly_admin()
    or exists(select 1 from public.samly_accounts a where a.owner_user_id = auth.uid())
  );

drop policy if exists samly_feature_votes_read on public.samly_feature_request_votes;
create policy samly_feature_votes_read on public.samly_feature_request_votes
  for select to authenticated using (user_id = auth.uid() or public.is_samly_admin());

create or replace function public.toggle_samly_feature_request_vote(p_request_id uuid)
returns table(upvoted boolean, upvote_count integer)
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_samly_admin() and not exists(select 1 from public.samly_accounts where owner_user_id = auth.uid()) then
    raise exception 'A Samly account is required';
  end if;
  if not exists(select 1 from public.samly_feature_requests where id = p_request_id) then raise exception 'Feature request not found'; end if;

  if exists(select 1 from public.samly_feature_request_votes where request_id = p_request_id and user_id = auth.uid()) then
    delete from public.samly_feature_request_votes where request_id = p_request_id and user_id = auth.uid();
    update public.samly_feature_requests set upvote_count = greatest(upvote_count - 1, 0), updated_at = now() where id = p_request_id returning upvote_count into v_count;
    return query select false, v_count;
  else
    insert into public.samly_feature_request_votes(request_id, user_id) values (p_request_id, auth.uid());
    update public.samly_feature_requests set upvote_count = upvote_count + 1, updated_at = now() where id = p_request_id returning upvote_count into v_count;
    return query select true, v_count;
  end if;
end;
$$;

revoke all on function public.toggle_samly_feature_request_vote(uuid) from public;
grant execute on function public.toggle_samly_feature_request_vote(uuid) to authenticated;

commit;

select jsonb_build_object(
  'shared_roadmap_read_policy', exists(select 1 from pg_policies where schemaname='public' and tablename='samly_feature_requests' and policyname='samly_feature_requests_customer_read'),
  'votes_table', to_regclass('public.samly_feature_request_votes') is not null,
  'vote_rpc', to_regprocedure('public.toggle_samly_feature_request_vote(uuid)') is not null
) as samly_feature_votes_verification;
