begin;
-- Reusable buyer identity; the normal issued customer snapshot freezes these values.
alter table public.counterparties add column einvoice_profile jsonb not null default '{}' check(jsonb_typeof(einvoice_profile)='object');
alter table public.einvoice_settings add column registration_type text not null default 'TL' check(registration_type in('TL','EID','PAS','CD'));
alter table public.einvoice_document_metadata add column buyer_reference text;
alter table public.einvoice_document_metadata add column purchase_order text;
-- This release only enables explicit sandbox validation, never production activation.
create table public.docflow_connections (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 environment text not null default 'sandbox' check(environment='sandbox'),
 provider_company_id uuid not null unique,
 tin text not null check(tin ~ '^[0-9]{10}$'),
 vat_trn text not null check(vat_trn ~ '^[0-9]{15}$'),
 encrypted_access_token text not null,
 updated_at timestamptz not null default now(),updated_by uuid references auth.users(id)
);
alter table public.docflow_connections enable row level security;
revoke all on public.docflow_connections from public,anon,authenticated;
grant all on public.docflow_connections to service_role;
create unique index sales_documents_id_workspace on public.sales_documents(id,workspace_id);
create table public.docflow_validations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 document_id uuid not null references public.sales_documents(id),
 environment text not null default 'sandbox' check(environment='sandbox'),
 payload jsonb not null,provider_response jsonb not null,
 validation_verified boolean not null default false check(validation_verified=false),
 created_at timestamptz not null default now(),created_by uuid references auth.users(id),
 foreign key(document_id,workspace_id) references public.sales_documents(id,workspace_id)
);
alter table public.docflow_validations enable row level security;
revoke all on public.docflow_validations from public,anon,authenticated;
grant select on public.docflow_validations to authenticated;
grant all on public.docflow_validations to service_role;
create policy docflow_validations_read on public.docflow_validations for select to authenticated using(public.is_workspace_member(workspace_id));
create index docflow_validation_history on public.docflow_validations(workspace_id,document_id,created_at desc);
create trigger docflow_validation_immutable before update or delete on public.docflow_validations for each row execute function public.guard_einvoice_evidence();
-- Extend existing guarded RPCs without allowing activation changes.
create or replace function public.save_einvoice_settings(p_workspace_id uuid,p_settings jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not coalesce(public.can_write(p_workspace_id),false) then raise exception 'Not authorized'; end if;
 if not exists(select 1 from public.workspaces where id=p_workspace_id and country='AE') then raise exception 'UAE company required'; end if;
 insert into public.einvoice_settings(workspace_id,vat_registered,tin,target_date,revenue_band,registration_type,updated_by)
 values(p_workspace_id,coalesce((p_settings->>'vat_registered')::boolean,false),nullif(trim(p_settings->>'tin'),''),nullif(p_settings->>'target_date','')::date,coalesce(p_settings->>'revenue_band','unconfirmed'),coalesce(nullif(p_settings->>'registration_type',''),'TL'),auth.uid())
 on conflict(workspace_id) do update set vat_registered=excluded.vat_registered,tin=excluded.tin,target_date=excluded.target_date,revenue_band=excluded.revenue_band,registration_type=excluded.registration_type,updated_at=now(),updated_by=auth.uid();
 insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details) values(p_workspace_id,'einvoicing',p_workspace_id,'preparation_settings_saved',auth.uid(),jsonb_build_object('mode','preparation'));
end $$;
create or replace function public.save_einvoice_metadata(p_document_id uuid,p_metadata jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype;
begin
 select * into d from public.sales_documents where id=p_document_id for update;
 if not found then raise exception 'Invoice not found'; end if;
 if auth.uid() is null or not coalesce(public.can_write(d.workspace_id),false) then raise exception 'Not authorized'; end if;
 if d.document_type not in('invoice','credit_note') or not exists(select 1 from public.workspaces where id=d.workspace_id and country='AE') then raise exception 'UAE invoice or credit note required'; end if;
 if exists(select 1 from public.einvoice_submissions where document_id=d.id and environment='production') then raise exception 'Submitted records are immutable; use the credit-note workflow'; end if;
 insert into public.einvoice_document_metadata(document_id,workspace_id,buyer,supply_date,payment_means,transaction_type,exchange_rate,credit_reason,lines,buyer_reference,purchase_order,updated_by)
 values(d.id,d.workspace_id,coalesce(p_metadata->'buyer','{}'),nullif(p_metadata->>'supply_date','')::date,nullif(p_metadata->>'payment_means',''),nullif(p_metadata->>'transaction_type',''),nullif(p_metadata->>'exchange_rate','')::numeric,nullif(trim(p_metadata->>'credit_reason'),''),coalesce(p_metadata->'lines','{}'),nullif(trim(p_metadata->>'buyer_reference'),''),nullif(trim(p_metadata->>'purchase_order'),''),auth.uid())
 on conflict(document_id) do update set buyer=excluded.buyer,supply_date=excluded.supply_date,payment_means=excluded.payment_means,transaction_type=excluded.transaction_type,exchange_rate=excluded.exchange_rate,credit_reason=excluded.credit_reason,lines=excluded.lines,buyer_reference=excluded.buyer_reference,purchase_order=excluded.purchase_order,updated_at=now(),updated_by=auth.uid();
 insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details) values(d.workspace_id,'invoice',d.id,'einvoice_preparation_saved',auth.uid(),'{}');
end $$;
revoke all on function public.save_einvoice_settings(uuid,jsonb),public.save_einvoice_metadata(uuid,jsonb) from public,anon;
grant execute on function public.save_einvoice_settings(uuid,jsonb),public.save_einvoice_metadata(uuid,jsonb) to authenticated;
commit;
