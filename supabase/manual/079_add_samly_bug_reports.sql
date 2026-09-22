-- Private, opt-out bug reporting for Samly. Screenshots are visible only to Samly administrators.
begin;

create table if not exists public.samly_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bug_reporting_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.samly_user_preferences enable row level security;
revoke all on public.samly_user_preferences from anon;
grant select, insert, update on public.samly_user_preferences to authenticated;
grant all on public.samly_user_preferences to service_role;
drop policy if exists samly_user_preferences_self on public.samly_user_preferences;
create policy samly_user_preferences_self on public.samly_user_preferences
  for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

create table if not exists public.samly_bug_reports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.samly_accounts(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check(char_length(trim(title)) between 4 and 160),
  description text not null check(char_length(trim(description)) between 10 and 5000),
  page_path text not null check(char_length(page_path) <= 1000),
  screenshot_path text,
  status text not null default 'queued' check(status in ('queued','working_on_it','done','ignored')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists samly_bug_reports_admin_queue_idx on public.samly_bug_reports(status, created_at asc);
create index if not exists samly_bug_reports_account_created_idx on public.samly_bug_reports(account_id, created_at desc);
alter table public.samly_bug_reports enable row level security;
revoke all on public.samly_bug_reports from anon, authenticated;
grant all on public.samly_bug_reports to service_role;
drop policy if exists samly_bug_reports_admin_read on public.samly_bug_reports;
create policy samly_bug_reports_admin_read on public.samly_bug_reports for select to authenticated using(public.is_samly_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('samly-bug-screenshots','samly-bug-screenshots',false,5242880,array['image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/png','image/jpeg'];

drop policy if exists samly_bug_screenshot_upload on storage.objects;
create policy samly_bug_screenshot_upload on storage.objects for insert to authenticated
with check(bucket_id='samly-bug-screenshots' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists samly_bug_screenshot_admin_read on storage.objects;
create policy samly_bug_screenshot_admin_read on storage.objects for select to authenticated
using(bucket_id='samly-bug-screenshots' and public.is_samly_admin());

create or replace function public.submit_samly_bug_report(
  p_title text,
  p_description text,
  p_page_path text,
  p_screenshot_path text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_account uuid; v_id uuid; v_screenshot text:=nullif(trim(coalesce(p_screenshot_path,'')), '');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.samly_user_preferences p where p.user_id=auth.uid() and not p.bug_reporting_enabled) then raise exception 'Bug reporting is disabled in your settings'; end if;
  if v_screenshot is not null then
    if v_screenshot !~ ('^' || auth.uid()::text || '/') then raise exception 'Invalid screenshot attachment'; end if;
    if not exists(select 1 from storage.objects o where o.bucket_id='samly-bug-screenshots' and o.name=v_screenshot) then raise exception 'Screenshot upload was not found'; end if;
  end if;
  select id into v_account from public.samly_accounts where owner_user_id=auth.uid();
  insert into public.samly_bug_reports(account_id,created_by,title,description,page_path,screenshot_path)
  values(v_account,auth.uid(),trim(p_title),trim(p_description),left(trim(coalesce(p_page_path,'')),1000),v_screenshot)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.review_samly_bug_report(
  p_report_id uuid,
  p_status text,
  p_admin_note text default null
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_samly_admin() then raise exception 'Samly administrator access required'; end if;
  if p_status not in ('queued','working_on_it','done','ignored') then raise exception 'Invalid bug report status'; end if;
  update public.samly_bug_reports
  set status=p_status,admin_note=nullif(trim(p_admin_note),''),updated_at=now()
  where id=p_report_id;
  if not found then raise exception 'Bug report not found'; end if;
end $$;

revoke all on function public.submit_samly_bug_report(text,text,text,text),public.review_samly_bug_report(uuid,text,text) from public;
grant execute on function public.submit_samly_bug_report(text,text,text,text),public.review_samly_bug_report(uuid,text,text) to authenticated;
commit;

select jsonb_build_object(
 'bug_reports_table',to_regclass('public.samly_bug_reports') is not null,
 'preferences_table',to_regclass('public.samly_user_preferences') is not null,
 'private_screenshot_bucket',exists(select 1 from storage.buckets where id='samly-bug-screenshots' and not public),
 'submission_rpc',to_regprocedure('public.submit_samly_bug_report(text,text,text,text)') is not null,
 'admin_review_rpc',to_regprocedure('public.review_samly_bug_report(uuid,text,text)') is not null
) as samly_bug_reports_verification;
