-- Allow Samly product administrators to submit their own feature requests
-- without creating a customer account or workspace.
-- Run after 063_add_samly_feature_requests.sql.

begin;

alter table public.samly_feature_requests
  alter column account_id drop not null;

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
  if v_account is null and not public.is_samly_admin() then
    raise exception 'A Samly account is required';
  end if;
  insert into public.samly_feature_requests(account_id, created_by, title, description, category)
  values (v_account, auth.uid(), trim(p_title), trim(p_description), lower(trim(coalesce(p_category, 'idea'))))
  returning id into v_id;
  return v_id;
end;
$$;

commit;

select jsonb_build_object(
  'admin_can_submit_without_customer_account', true,
  'account_id_is_optional_for_internal_requests', (
    select is_nullable = 'YES' from information_schema.columns
    where table_schema = 'public' and table_name = 'samly_feature_requests' and column_name = 'account_id'
  )
) as samly_admin_feature_request_verification;
