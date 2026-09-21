-- Public Samly company-profile repair.
-- Keeps legacy IACy profiles untouched. Public Samly profiles use their owner's signup email,
-- never the legacy billing@iacy.com placeholder, and save through a controlled RPC.
begin;

create or replace function public.seed_samly_company_legal_profile(p_workspace_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_country text; v_email text;
begin
  select w.country, a.billing_email into v_country, v_email
  from public.samly_account_workspaces aw
  join public.samly_accounts a on a.id=aw.account_id
  join public.workspaces w on w.id=aw.workspace_id
  where aw.workspace_id=p_workspace_id;
  if v_country is null then return; end if;
  insert into public.company_legal_profiles(workspace_id,country_code,billing_email,updated_by)
  values(p_workspace_id,v_country,nullif(trim(v_email),''),auth.uid())
  on conflict(workspace_id) do update set
    billing_email=case when public.company_legal_profiles.billing_email is null or lower(public.company_legal_profiles.billing_email)='billing@iacy.com' then excluded.billing_email else public.company_legal_profiles.billing_email end,
    updated_at=now();
end $$;

create or replace function public.seed_samly_company_legal_profile_on_workspace()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.seed_samly_company_legal_profile(new.workspace_id);
  return new;
end $$;
drop trigger if exists samly_seed_company_legal_profile on public.samly_account_workspaces;
create trigger samly_seed_company_legal_profile
  after insert on public.samly_account_workspaces
  for each row execute function public.seed_samly_company_legal_profile_on_workspace();

-- Repair existing public Samly profiles only; personal IACy workspaces are deliberately excluded.
insert into public.company_legal_profiles(workspace_id,country_code,billing_email,updated_by)
select aw.workspace_id,w.country,a.billing_email,a.owner_user_id
from public.samly_account_workspaces aw
join public.samly_accounts a on a.id=aw.account_id
join public.workspaces w on w.id=aw.workspace_id
on conflict(workspace_id) do update set
  billing_email=case when public.company_legal_profiles.billing_email is null or lower(public.company_legal_profiles.billing_email)='billing@iacy.com' then excluded.billing_email else public.company_legal_profiles.billing_email end,
  updated_at=now();

create or replace function public.save_company_legal_profile(
  p_workspace_id uuid,
  p_legal_name text,
  p_profile jsonb
) returns void
language plpgsql security definer set search_path=public as $$
declare v_country text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_legal_name),'') is null then raise exception 'Registered name is required'; end if;
  select country into v_country from public.workspaces where id=p_workspace_id;
  if v_country is null then raise exception 'Workspace not found'; end if;
  if not (public.can_write(p_workspace_id) or public.is_samly_workspace_owner(p_workspace_id)) then raise exception 'Not authorized to edit this company'; end if;

  update public.workspaces set legal_name=trim(p_legal_name),updated_at=now() where id=p_workspace_id;
  insert into public.company_legal_profiles(
    workspace_id,legal_form,registration_number,tax_identification_number,vat_number,uid_number,corporate_tax_number,trade_licence_number,licensing_authority,tax_office,address_line_1,address_line_2,postal_code,city,state_region,country_code,billing_email,phone,website,authorized_signatory,default_payment_terms_days,legal_footer,updated_at,updated_by
  ) values (
    p_workspace_id,nullif(trim(p_profile->>'legal_form'),''),nullif(trim(p_profile->>'registration_number'),''),nullif(trim(p_profile->>'tax_identification_number'),''),nullif(trim(p_profile->>'vat_number'),''),nullif(trim(p_profile->>'uid_number'),''),nullif(trim(p_profile->>'corporate_tax_number'),''),nullif(trim(p_profile->>'trade_licence_number'),''),nullif(trim(p_profile->>'licensing_authority'),''),nullif(trim(p_profile->>'tax_office'),''),nullif(trim(p_profile->>'address_line_1'),''),nullif(trim(p_profile->>'address_line_2'),''),nullif(trim(p_profile->>'postal_code'),''),nullif(trim(p_profile->>'city'),''),nullif(trim(p_profile->>'state_region'),''),v_country,nullif(trim(p_profile->>'billing_email'),''),nullif(trim(p_profile->>'phone'),''),nullif(trim(p_profile->>'website'),''),nullif(trim(p_profile->>'authorized_signatory'),''),greatest(0,least(365,coalesce((p_profile->>'default_payment_terms_days')::integer,14))),nullif(trim(p_profile->>'legal_footer'),''),now(),auth.uid()
  ) on conflict(workspace_id) do update set
    legal_form=excluded.legal_form,registration_number=excluded.registration_number,tax_identification_number=excluded.tax_identification_number,vat_number=excluded.vat_number,uid_number=excluded.uid_number,corporate_tax_number=excluded.corporate_tax_number,trade_licence_number=excluded.trade_licence_number,licensing_authority=excluded.licensing_authority,tax_office=excluded.tax_office,address_line_1=excluded.address_line_1,address_line_2=excluded.address_line_2,postal_code=excluded.postal_code,city=excluded.city,state_region=excluded.state_region,billing_email=excluded.billing_email,phone=excluded.phone,website=excluded.website,authorized_signatory=excluded.authorized_signatory,default_payment_terms_days=excluded.default_payment_terms_days,legal_footer=excluded.legal_footer,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
end $$;

revoke all on function public.seed_samly_company_legal_profile(uuid),public.seed_samly_company_legal_profile_on_workspace(),public.save_company_legal_profile(uuid,text,jsonb) from public;
grant execute on function public.save_company_legal_profile(uuid,text,jsonb) to authenticated;

commit;

select jsonb_build_object(
  'new_samly_profiles_seed_signup_email',exists(select 1 from pg_trigger where tgname='samly_seed_company_legal_profile' and not tgisinternal),
  'controlled_company_profile_save_rpc',to_regprocedure('public.save_company_legal_profile(uuid,text,jsonb)')is not null,
  'public_samly_profiles_without_legacy_placeholder',(select count(*) from public.samly_account_workspaces aw join public.company_legal_profiles p on p.workspace_id=aw.workspace_id where lower(coalesce(p.billing_email,''))='billing@iacy.com')=0,
  'iacy_profiles_untouched','Only workspaces joined through samly_account_workspaces were repaired.'
) as samly_company_profile_repair_verification;
