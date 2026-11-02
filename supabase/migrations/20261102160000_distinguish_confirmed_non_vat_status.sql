begin;
alter table public.einvoice_settings add column vat_status text not null default 'unconfirmed' check(vat_status in('unconfirmed','registered','not_registered'));
update public.einvoice_settings set vat_status='registered' where vat_registered=true;
create or replace function public.save_einvoice_settings(p_workspace_id uuid,p_settings jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not coalesce(public.can_write(p_workspace_id),false) then raise exception 'Not authorized'; end if;
 if not exists(select 1 from public.workspaces where id=p_workspace_id and country='AE') then raise exception 'UAE company required'; end if;
 insert into public.einvoice_settings(workspace_id,vat_registered,tin,target_date,revenue_band,registration_type,vat_status,updated_by)
 values(p_workspace_id,case when p_settings->>'vat_status' in('registered','not_registered') then p_settings->>'vat_status'='registered' else coalesce((p_settings->>'vat_registered')::boolean,false) end,nullif(trim(p_settings->>'tin'),''),nullif(p_settings->>'target_date','')::date,coalesce(p_settings->>'revenue_band','unconfirmed'),coalesce(nullif(p_settings->>'registration_type',''),'TL'),coalesce(nullif(p_settings->>'vat_status',''),case when coalesce((p_settings->>'vat_registered')::boolean,false) then 'registered' else 'unconfirmed' end),auth.uid())
 on conflict(workspace_id) do update set vat_registered=excluded.vat_registered,tin=excluded.tin,target_date=excluded.target_date,revenue_band=excluded.revenue_band,registration_type=excluded.registration_type,vat_status=excluded.vat_status,updated_at=now(),updated_by=auth.uid();
 insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details) values(p_workspace_id,'einvoicing',p_workspace_id,'preparation_settings_saved',auth.uid(),jsonb_build_object('mode','preparation'));
end $$;

insert into supabase_migrations.schema_migrations(version,name)values('20261102160000','distinguish_confirmed_non_vat_status');
notify pgrst, 'reload schema';
commit;
