-- Samly feature requests and admin inbox — additive only.
-- Run after 061_add_samly_public_account_foundation.sql.

begin;

create table if not exists public.samly_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Initial product administrator. This grants access only to Samly feedback,
-- never to customer accounting data outside its existing RLS boundary.
insert into public.samly_admin_users(user_id)
values ('c0a1df38-31e5-4feb-9c31-82ad11cc9af0'::uuid)
on conflict do nothing;

create or replace function public.is_samly_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.samly_admin_users where user_id = auth.uid());
$$;

create table if not exists public.samly_feature_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.samly_accounts(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 4 and 140),
  description text not null check (char_length(trim(description)) between 10 and 5000),
  category text not null default 'idea' check (category in ('idea','improvement','bug','integration')),
  status text not null default 'open' check (status in ('open','planned','in_progress','shipped','declined')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists samly_feature_requests_account_created_idx on public.samly_feature_requests(account_id, created_at desc);
create index if not exists samly_feature_requests_admin_queue_idx on public.samly_feature_requests(status, created_at asc);

alter table public.samly_admin_users enable row level security;
alter table public.samly_feature_requests enable row level security;
revoke all on public.samly_admin_users, public.samly_feature_requests from anon;
grant select on public.samly_admin_users to authenticated;
grant select on public.samly_feature_requests to authenticated;
grant all on public.samly_admin_users, public.samly_feature_requests to service_role;

drop policy if exists samly_admin_users_self_read on public.samly_admin_users;
create policy samly_admin_users_self_read on public.samly_admin_users
  for select to authenticated using (user_id = auth.uid());

drop policy if exists samly_feature_requests_customer_read on public.samly_feature_requests;
create policy samly_feature_requests_customer_read on public.samly_feature_requests
  for select to authenticated using (
    public.is_samly_admin()
    or exists(select 1 from public.samly_accounts a where a.id = account_id and a.owner_user_id = auth.uid())
  );

create or replace function public.submit_samly_feature_request(
  p_title text,
  p_description text,
  p_category text default 'idea'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_account uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into v_account from public.samly_accounts where owner_user_id = auth.uid();
  if v_account is null then raise exception 'A Samly account is required'; end if;
  insert into public.samly_feature_requests(account_id, created_by, title, description, category)
  values (v_account, auth.uid(), trim(p_title), trim(p_description), lower(trim(coalesce(p_category, 'idea'))))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.review_samly_feature_request(
  p_request_id uuid,
  p_status text,
  p_admin_note text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_samly_admin() then raise exception 'Samly administrator access required'; end if;
  if p_status not in ('open','planned','in_progress','shipped','declined') then raise exception 'Invalid request status'; end if;
  update public.samly_feature_requests
  set status = p_status, admin_note = nullif(trim(p_admin_note), ''), updated_at = now()
  where id = p_request_id;
  if not found then raise exception 'Feature request not found'; end if;
end;
$$;

revoke all on function public.is_samly_admin(), public.submit_samly_feature_request(text,text,text), public.review_samly_feature_request(uuid,text,text) from public;
grant execute on function public.is_samly_admin(), public.submit_samly_feature_request(text,text,text), public.review_samly_feature_request(uuid,text,text) to authenticated;

commit;

select jsonb_build_object(
  'feature_requests_table', to_regclass('public.samly_feature_requests') is not null,
  'admin_inbox_rpc', to_regprocedure('public.review_samly_feature_request(uuid,text,text)') is not null,
  'request_submission_rpc', to_regprocedure('public.submit_samly_feature_request(text,text,text)') is not null,
  'admin_count', (select count(*) from public.samly_admin_users)
) as samly_feature_request_verification;
