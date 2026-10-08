-- Treat missing membership as denied rather than SQL NULL.
begin;
CREATE OR REPLACE FUNCTION public.save_company_legal_profile(p_workspace_id uuid, p_legal_name text, p_profile jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_country text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_legal_name),'') is null then raise exception 'Registered name is required'; end if;
  select country into v_country from public.workspaces where id=p_workspace_id;
  if v_country is null then raise exception 'Workspace not found'; end if;
  if not (coalesce(public.can_write(p_workspace_id),false) or coalesce(public.is_samly_workspace_owner(p_workspace_id),false)) then raise exception 'Not authorized to edit this company'; end if;

  update public.workspaces set legal_name=trim(p_legal_name),updated_at=now() where id=p_workspace_id;
  insert into public.company_legal_profiles(
    workspace_id,legal_form,registration_number,tax_identification_number,vat_number,uid_number,corporate_tax_number,trade_licence_number,licensing_authority,tax_office,address_line_1,address_line_2,postal_code,city,state_region,country_code,billing_email,phone,website,authorized_signatory,default_payment_terms_days,legal_footer,updated_at,updated_by
  ) values (
    p_workspace_id,nullif(trim(p_profile->>'legal_form'),''),nullif(trim(p_profile->>'registration_number'),''),nullif(trim(p_profile->>'tax_identification_number'),''),nullif(trim(p_profile->>'vat_number'),''),nullif(trim(p_profile->>'uid_number'),''),nullif(trim(p_profile->>'corporate_tax_number'),''),nullif(trim(p_profile->>'trade_licence_number'),''),nullif(trim(p_profile->>'licensing_authority'),''),nullif(trim(p_profile->>'tax_office'),''),nullif(trim(p_profile->>'address_line_1'),''),nullif(trim(p_profile->>'address_line_2'),''),nullif(trim(p_profile->>'postal_code'),''),nullif(trim(p_profile->>'city'),''),nullif(trim(p_profile->>'state_region'),''),v_country,nullif(trim(p_profile->>'billing_email'),''),nullif(trim(p_profile->>'phone'),''),nullif(trim(p_profile->>'website'),''),nullif(trim(p_profile->>'authorized_signatory'),''),greatest(0,least(365,coalesce((p_profile->>'default_payment_terms_days')::integer,14))),nullif(trim(p_profile->>'legal_footer'),''),now(),auth.uid()
  ) on conflict(workspace_id) do update set
    legal_form=excluded.legal_form,registration_number=excluded.registration_number,tax_identification_number=excluded.tax_identification_number,vat_number=excluded.vat_number,uid_number=excluded.uid_number,corporate_tax_number=excluded.corporate_tax_number,trade_licence_number=excluded.trade_licence_number,licensing_authority=excluded.licensing_authority,tax_office=excluded.tax_office,address_line_1=excluded.address_line_1,address_line_2=excluded.address_line_2,postal_code=excluded.postal_code,city=excluded.city,state_region=excluded.state_region,billing_email=excluded.billing_email,phone=excluded.phone,website=excluded.website,authorized_signatory=excluded.authorized_signatory,default_payment_terms_days=excluded.default_payment_terms_days,legal_footer=excluded.legal_footer,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
end $function$
;
commit;
