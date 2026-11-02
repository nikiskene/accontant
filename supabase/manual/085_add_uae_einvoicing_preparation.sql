-- Provider-independent preparation only. Does not activate or submit e-invoices.
-- Apply after 084; reconcile live migration history before deploying.
begin;
create table public.einvoice_settings (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 mode text not null default 'preparation' check(mode='preparation'),
 vat_registered boolean not null default false,
 tin text check(tin is null or tin ~ '^[0-9]{10}$'),
 target_date date,
 revenue_band text not null default 'unconfirmed' check(revenue_band in('unconfirmed','below_50m','at_least_50m')),
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
create table public.einvoice_document_metadata (
 document_id uuid primary key references public.sales_documents(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 buyer jsonb not null default '{}',
 supply_date date,
 payment_means text,
 transaction_type text check(transaction_type is null or transaction_type ~ '^[01]{8}$'),
 exchange_rate numeric(20,8) check(exchange_rate>0),
 credit_reason text,
 lines jsonb not null default '{}',
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
 check(jsonb_typeof(buyer)='object' and jsonb_typeof(lines)='object')
);
-- These records are reserved for a future server-side adapter; clients have read access only.
create table public.einvoice_submissions (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete restrict,
 document_id uuid not null references public.sales_documents(id) on delete restrict,
 environment text not null check(environment in('sandbox','production')),
 provider text not null,
 idempotency_key text not null unique,
 payload jsonb not null,
 provider_document_id text,
 exchange_status text not null default 'pending' check(exchange_status in('pending','delivered','rejected')),
 reporting_status text not null default 'pending' check(reporting_status in('pending','reported','rejected')),
 created_at timestamptz not null default now(),
 unique(document_id,environment),
 unique(id,workspace_id),
 unique(workspace_id,provider,environment,provider_document_id)
);
create table public.einvoice_events (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete restrict,
 submission_id uuid not null,
 provider_event_id text not null,
 event_type text not null check(event_type in('delivered','delivery_rejected','reported','reporting_rejected')),
 occurred_at timestamptz not null,
 evidence jsonb not null,
 received_at timestamptz not null default now(),
 foreign key(submission_id,workspace_id) references public.einvoice_submissions(id,workspace_id) on delete restrict,
 unique(submission_id,provider_event_id)
);
create table public.einvoice_inbox (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete restrict,
 provider text not null, environment text not null check(environment in('sandbox','production')),
 provider_document_id text not null, payload jsonb not null,
 original_xml text not null,
 received_at timestamptz not null default now(),
 supplier_invoice_id uuid references public.supplier_invoices(id) on delete restrict,
 unique(workspace_id,provider,environment,provider_document_id)
);
alter table public.einvoice_settings enable row level security;
alter table public.einvoice_document_metadata enable row level security;
alter table public.einvoice_submissions enable row level security;
alter table public.einvoice_events enable row level security;
alter table public.einvoice_inbox enable row level security;
create policy einvoice_settings_read on public.einvoice_settings for select to authenticated using(public.is_workspace_member(workspace_id));
create policy einvoice_metadata_read on public.einvoice_document_metadata for select to authenticated using(public.is_workspace_member(workspace_id));
create policy einvoice_submissions_read on public.einvoice_submissions for select to authenticated using(public.is_workspace_member(workspace_id));
create policy einvoice_events_read on public.einvoice_events for select to authenticated using(public.is_workspace_member(workspace_id));
create policy einvoice_inbox_read on public.einvoice_inbox for select to authenticated using(public.is_workspace_member(workspace_id));
revoke all on public.einvoice_settings,public.einvoice_document_metadata,public.einvoice_submissions,public.einvoice_events,public.einvoice_inbox from anon,authenticated;
grant select on public.einvoice_settings,public.einvoice_document_metadata,public.einvoice_submissions,public.einvoice_events,public.einvoice_inbox to authenticated;
grant all on public.einvoice_settings,public.einvoice_document_metadata,public.einvoice_submissions,public.einvoice_events,public.einvoice_inbox to service_role;
create index einvoice_submissions_workspace on public.einvoice_submissions(workspace_id,created_at desc);
create index einvoice_inbox_workspace on public.einvoice_inbox(workspace_id,received_at desc);

create function public.save_einvoice_settings(p_workspace_id uuid,p_settings jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not coalesce(public.can_write(p_workspace_id),false) then raise exception 'Not authorized'; end if;
 if not exists(select 1 from public.workspaces where id=p_workspace_id and country='AE') then raise exception 'UAE company required'; end if;
 insert into public.einvoice_settings(workspace_id,vat_registered,tin,target_date,revenue_band,updated_by)
 values(p_workspace_id,coalesce((p_settings->>'vat_registered')::boolean,false),nullif(trim(p_settings->>'tin'),''),nullif(p_settings->>'target_date','')::date,coalesce(p_settings->>'revenue_band','unconfirmed'),auth.uid())
 on conflict(workspace_id) do update set vat_registered=excluded.vat_registered,tin=excluded.tin,target_date=excluded.target_date,revenue_band=excluded.revenue_band,updated_at=now(),updated_by=auth.uid();
 insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)
 values(p_workspace_id,'einvoicing',p_workspace_id,'preparation_settings_saved',auth.uid(),jsonb_build_object('mode','preparation'));
end $$;

create function public.save_einvoice_metadata(p_document_id uuid,p_metadata jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype;
begin
 select * into d from public.sales_documents where id=p_document_id for update;
 if not found then raise exception 'Invoice not found'; end if;
 if auth.uid() is null or not coalesce(public.can_write(d.workspace_id),false) then raise exception 'Not authorized'; end if;
 if d.document_type not in('invoice','credit_note') or not exists(select 1 from public.workspaces where id=d.workspace_id and country='AE') then raise exception 'UAE invoice or credit note required'; end if;
 if exists(select 1 from public.einvoice_submissions where document_id=d.id and environment='production') then raise exception 'Submitted records are immutable; use the credit-note workflow'; end if;
 insert into public.einvoice_document_metadata(document_id,workspace_id,buyer,supply_date,payment_means,transaction_type,exchange_rate,credit_reason,lines,updated_by)
 values(d.id,d.workspace_id,coalesce(p_metadata->'buyer','{}'),nullif(p_metadata->>'supply_date','')::date,nullif(p_metadata->>'payment_means',''),nullif(p_metadata->>'transaction_type',''),nullif(p_metadata->>'exchange_rate','')::numeric,nullif(trim(p_metadata->>'credit_reason'),''),coalesce(p_metadata->'lines','{}'),auth.uid())
 on conflict(document_id) do update set buyer=excluded.buyer,supply_date=excluded.supply_date,payment_means=excluded.payment_means,transaction_type=excluded.transaction_type,exchange_rate=excluded.exchange_rate,credit_reason=excluded.credit_reason,lines=excluded.lines,updated_at=now(),updated_by=auth.uid();
 insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)
 values(d.workspace_id,'invoice',d.id,'einvoice_preparation_saved',auth.uid(),'{}');
end $$;

create function public.einvoice_preparation_context(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype; result jsonb;
begin
 select * into d from public.sales_documents where id=p_document_id;
 if not found or auth.uid() is null or not coalesce(public.is_workspace_member(d.workspace_id),false) then raise exception 'Not authorized'; end if;
 select jsonb_build_object(
  'workspace',to_jsonb(w),'profile',coalesce(to_jsonb(p),'{}'),'settings',coalesce(to_jsonb(s),'{"mode":"preparation"}'),
  'document',to_jsonb(d),'customer',coalesce(to_jsonb(c),'{}'),
  'metadata',coalesce((select to_jsonb(m) from public.einvoice_document_metadata m where m.document_id=d.id),'{}'),
  'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('vat_code',to_jsonb(v)) order by l.line_no) from public.sales_document_lines l left join public.vat_codes v on v.id=l.vat_code_id and v.workspace_id=d.workspace_id where l.document_id=d.id and l.workspace_id=d.workspace_id),'[]'),
  'preceding',(select jsonb_build_object('id',original.id,'document_number',original.document_number,'workspace_id',original.workspace_id) from public.sales_document_links link join public.sales_documents original on original.id=link.source_document_id and original.workspace_id=d.workspace_id where link.target_document_id=d.id and link.workspace_id=d.workspace_id and link.link_type='invoice_to_credit_note' limit 1)
 ) into result from public.workspaces w left join public.company_legal_profiles p on p.workspace_id=w.id left join public.einvoice_settings s on s.workspace_id=w.id left join public.counterparties c on c.id=d.customer_id and c.workspace_id=w.id where w.id=d.workspace_id;
 return result;
end $$;

-- Prevent a mismatched entity on trusted adapter writes too.
create function public.check_einvoice_entity() returns trigger language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from public.sales_documents where id=new.document_id and workspace_id=new.workspace_id) then raise exception 'Document/company mismatch'; end if;
 return new;
end $$;
create trigger einvoice_submission_entity before insert or update on public.einvoice_submissions for each row execute function public.check_einvoice_entity();
create trigger einvoice_metadata_entity before insert or update on public.einvoice_document_metadata for each row execute function public.check_einvoice_entity();

-- Preserve business content after production submission, including legacy correction/void RPCs.
create function public.guard_submitted_einvoice() returns trigger language plpgsql security definer set search_path=public as $$
declare doc_id uuid;
begin
 doc_id:=case when TG_TABLE_NAME='sales_documents' then (to_jsonb(old)->>'id')::uuid else (to_jsonb(old)->>'document_id')::uuid end;
 if TG_TABLE_NAME='sales_document_lines' and TG_OP='UPDATE' then
  if exists(select 1 from public.einvoice_submissions where document_id=(to_jsonb(new)->>'document_id')::uuid and environment='production') then raise exception 'Cannot move lines into a submitted e-invoice'; end if;
 end if;
 if exists(select 1 from public.einvoice_submissions where document_id=doc_id and environment='production') then
  if TG_OP='DELETE' or TG_TABLE_NAME='sales_document_lines' then raise exception 'Submitted e-invoices cannot be changed or deleted'; end if;
  if (to_jsonb(new)-array['status','amount_paid','sent_at','updated_at']) is distinct from (to_jsonb(old)-array['status','amount_paid','sent_at','updated_at']) or (to_jsonb(new)->>'status')='void' then
   raise exception 'Submitted e-invoices require a linked credit note instead of correction or void';
  end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create trigger guard_submitted_einvoice_document before update or delete on public.sales_documents for each row execute function public.guard_submitted_einvoice();
create trigger guard_submitted_einvoice_line before update or delete on public.sales_document_lines for each row execute function public.guard_submitted_einvoice();
create function public.guard_submitted_einvoice_line_insert() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.einvoice_submissions where document_id=new.document_id and environment='production') then raise exception 'Cannot add lines to a submitted e-invoice'; end if;
 return new;
end $$;
create trigger guard_submitted_einvoice_line_insert before insert on public.sales_document_lines for each row execute function public.guard_submitted_einvoice_line_insert();

create function public.guard_einvoice_evidence() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='DELETE' then raise exception 'Electronic invoice evidence cannot be deleted'; end if;
 if TG_TABLE_NAME='einvoice_events' or TG_TABLE_NAME='einvoice_inbox' then
  if TG_TABLE_NAME='einvoice_inbox' and (to_jsonb(new)-'supplier_invoice_id')=(to_jsonb(old)-'supplier_invoice_id') then return new; end if;
  raise exception 'Electronic invoice evidence is immutable';
 end if;
 if (to_jsonb(new)-array['provider_document_id','exchange_status','reporting_status']) is distinct from (to_jsonb(old)-array['provider_document_id','exchange_status','reporting_status']) then raise exception 'Submission identity and payload are immutable'; end if;
 if old.provider_document_id is not null and new.provider_document_id is distinct from old.provider_document_id then raise exception 'Provider document identity is immutable'; end if;
 return new;
end $$;
create trigger guard_einvoice_submission_evidence before update or delete on public.einvoice_submissions for each row execute function public.guard_einvoice_evidence();
create trigger guard_einvoice_event_evidence before update or delete on public.einvoice_events for each row execute function public.guard_einvoice_evidence();
create trigger guard_einvoice_inbox_evidence before update or delete on public.einvoice_inbox for each row execute function public.guard_einvoice_evidence();

revoke all on function public.save_einvoice_settings(uuid,jsonb),public.save_einvoice_metadata(uuid,jsonb),public.einvoice_preparation_context(uuid) from public,anon;
grant execute on function public.save_einvoice_settings(uuid,jsonb),public.save_einvoice_metadata(uuid,jsonb),public.einvoice_preparation_context(uuid) to authenticated;
commit;
