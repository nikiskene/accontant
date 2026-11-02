-- January 2027 preparation; no production activation or invoice transmission.
begin;
-- Provider-independent preparation only. Does not activate or submit e-invoices.
-- Apply after 084; reconcile live migration history before deploying.

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

-- Fix signed credit-note issuance and prevent cumulative over-crediting.

create or replace function public.issue_sales_document(p_document_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_doc public.sales_documents%rowtype; v_profile public.company_legal_profiles%rowtype; v_customer public.counterparties%rowtype; v_bank public.company_bank_accounts%rowtype; v_original public.sales_documents%rowtype; v_credited numeric;
begin
  select * into v_doc from public.sales_documents where id=p_document_id for update;
  if not found then raise exception 'Document not found'; end if;
  if auth.uid() is null or not coalesce(public.can_write(v_doc.workspace_id),false) then raise exception 'Not authorized'; end if;
  if v_doc.status<>'draft' then raise exception 'Only draft documents can be issued'; end if;
  if v_doc.document_type='invoice' then perform public.samly_assert_free_setup_capacity(v_doc.workspace_id,'invoice'); end if;
  if not exists(select 1 from public.sales_document_lines where document_id=p_document_id) then raise exception 'Document requires at least one line'; end if;
  if v_doc.document_type='credit_note' then
    select original.* into v_original from public.sales_document_links l join public.sales_documents original on original.id=l.source_document_id and original.workspace_id=v_doc.workspace_id where l.target_document_id=v_doc.id and l.link_type='invoice_to_credit_note' for update of original;
    if v_original.id is null then raise exception 'Original invoice not found'; end if;
    select coalesce(sum(abs(c.total)),0) into v_credited from public.sales_document_links l join public.sales_documents c on c.id=l.target_document_id and c.workspace_id=v_doc.workspace_id where l.source_document_id=v_original.id and l.link_type='invoice_to_credit_note' and c.status<>'void' and c.id<>v_doc.id;
    if v_credited+abs(v_doc.total)>v_original.total then raise exception 'Credit exceeds the remaining invoice amount'; end if;
    if v_doc.subtotal<>(select coalesce(sum(net_amount),0) from public.sales_document_lines where document_id=v_doc.id) or v_doc.tax_total<>(select coalesce(sum(vat_amount),0) from public.sales_document_lines where document_id=v_doc.id) or v_doc.total<>v_doc.subtotal+v_doc.tax_total then raise exception 'Credit totals must reconcile with lines'; end if;
    if v_doc.total>=0 then raise exception 'Credit note must have a negative accounting total'; end if;
    if not exists(select 1 from public.sales_document_links l join public.sales_documents original on original.id=l.source_document_id and original.workspace_id=v_doc.workspace_id where l.target_document_id=v_doc.id and l.link_type='invoice_to_credit_note' and original.status not in('draft','void')) then raise exception 'Credit note must reference an issued invoice in this company'; end if;
  elsif v_doc.total<=0 then raise exception 'Document requires a positive total'; end if;
  if exists(select 1 from public.sales_document_lines where document_id=p_document_id and workspace_id<>v_doc.workspace_id) then raise exception 'Invoice line belongs to another company'; end if;
  if v_doc.document_type='credit_note' and exists(select 1 from public.sales_document_lines where document_id=p_document_id and (quantity>=0 or net_amount>0 or vat_amount>0 or gross_amount>0)) then raise exception 'Credit-note line signs are invalid'; end if;
  select * into v_profile from public.company_legal_profiles where workspace_id=v_doc.workspace_id;
  if v_profile.address_line_1 is null or v_profile.city is null or coalesce(v_profile.vat_number,v_profile.uid_number,v_profile.tax_identification_number) is null then raise exception 'Complete company address and tax credentials before issuing'; end if;
  select * into v_customer from public.counterparties where id=v_doc.customer_id and workspace_id=v_doc.workspace_id;
  if not found then raise exception 'Customer not found in this company'; end if;
  select * into v_bank from public.company_bank_accounts where workspace_id=v_doc.workspace_id and is_active order by is_default desc,created_at limit 1;
  update public.sales_documents set document_number=coalesce(document_number,public.next_document_number(v_doc.workspace_id,v_doc.document_type,v_doc.issue_date)),issuer_snapshot=case when v_doc.document_type='credit_note' and v_doc.issuer_snapshot is not null then v_doc.issuer_snapshot else jsonb_build_object('legal_name',(select legal_name from public.workspaces where id=v_doc.workspace_id),'profile',to_jsonb(v_profile),'einvoice_settings',(select to_jsonb(es) from public.einvoice_settings es where es.workspace_id=v_doc.workspace_id)) end,customer_snapshot=case when v_doc.document_type='credit_note' and v_doc.customer_snapshot is not null then v_doc.customer_snapshot else to_jsonb(v_customer) end,bank_snapshot=case when v_bank.id is null then null else to_jsonb(v_bank) end,status='sent',issued_at=now(),sent_at=now(),updated_at=now() where id=p_document_id;
  insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details) values(v_doc.workspace_id,v_doc.document_type,p_document_id,'issued',auth.uid(),jsonb_build_object('snapshot_frozen',true));
end $$;


create or replace function public.create_credit_note(p_invoice_id uuid,p_fraction numeric default 1,p_issue_date date default current_date)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype;v_id uuid;v_number text;v_existing numeric;
begin select * into d from public.sales_documents where id=p_invoice_id and document_type='invoice' and status not in('draft','void') for update;if not found then raise exception 'Invoice not found';end if;
if auth.uid() is null or not coalesce(public.can_write(d.workspace_id),false) then raise exception 'Not authorized';end if;if p_fraction is null or p_fraction<=0 or p_fraction>1 then raise exception 'Fraction must be between 0 and 1';end if;
select coalesce(sum(abs(c.total)),0) into v_existing from public.sales_document_links l join public.sales_documents c on c.id=l.target_document_id and c.workspace_id=d.workspace_id where l.source_document_id=d.id and l.link_type='invoice_to_credit_note' and c.status<>'void';
if p_issue_date is null or p_issue_date<d.issue_date then raise exception 'Credit note date cannot precede the original invoice'; end if;
if round(d.total*p_fraction,2)<=0 or v_existing+round(d.total*p_fraction,2)>d.total then raise exception 'Credit exceeds the remaining invoice amount'; end if;
v_number:=public.next_document_number(d.workspace_id,'credit_note',p_issue_date);
insert into public.sales_documents(workspace_id,document_type,document_number,customer_id,issue_date,currency,status,subtotal,tax_total,total,created_by,issuer_snapshot,customer_snapshot,bank_snapshot)
values(d.workspace_id,'credit_note',v_number,d.customer_id,p_issue_date,d.currency,'draft',-round(d.subtotal*p_fraction,2),-round(d.tax_total*p_fraction,2),-round(d.total*p_fraction,2),auth.uid(),d.issuer_snapshot,d.customer_snapshot,d.bank_snapshot)returning id into v_id;
insert into public.sales_document_lines(workspace_id,document_id,line_no,product_service_id,description,quantity,unit,unit_price,discount_percent,vat_code_id,vat_rate,net_amount,vat_amount,gross_amount,revenue_account_id)
select workspace_id,v_id,line_no,product_service_id,'Credit: '||description,-quantity*p_fraction,unit,unit_price,discount_percent,vat_code_id,vat_rate,-round(net_amount*p_fraction,2),-round(vat_amount*p_fraction,2),-round(net_amount*p_fraction,2)-round(vat_amount*p_fraction,2),revenue_account_id from public.sales_document_lines where document_id=p_invoice_id;
update public.sales_documents set subtotal=(select sum(net_amount) from public.sales_document_lines where document_id=v_id),tax_total=(select sum(vat_amount) from public.sales_document_lines where document_id=v_id),total=(select sum(gross_amount) from public.sales_document_lines where document_id=v_id) where id=v_id;
if (select abs(total) from public.sales_documents where id=v_id)+v_existing>d.total then raise exception 'Rounded credit exceeds remaining amount'; end if;
insert into public.sales_document_links(workspace_id,source_document_id,target_document_id,link_type,fraction)values(d.workspace_id,p_invoice_id,v_id,'invoice_to_credit_note',p_fraction);return v_id;end$$;

revoke all on function public.issue_sales_document(uuid), public.create_credit_note(uuid,numeric,date) from public,anon;
grant execute on function public.issue_sales_document(uuid), public.create_credit_note(uuid,numeric,date) to authenticated;


-- A durable provider-neutral queue. Only a trusted, tested adapter may enqueue.
create table public.einvoice_jobs (
 id uuid primary key default gen_random_uuid(),
 submission_id uuid not null unique references public.einvoice_submissions(id) on delete restrict,
 workspace_id uuid not null,
 state text not null default 'queued' check(state in('queued','processing','reconcile','accepted','failed')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 lease_until timestamptz, lease_token uuid,
 last_error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(submission_id,workspace_id) references public.einvoice_submissions(id,workspace_id)
);
alter table public.einvoice_jobs enable row level security;
create policy einvoice_jobs_read on public.einvoice_jobs for select to authenticated using(public.is_workspace_member(workspace_id));
revoke all on public.einvoice_jobs from anon,authenticated;
grant select on public.einvoice_jobs to authenticated;
grant all on public.einvoice_jobs to service_role;
create index einvoice_jobs_due on public.einvoice_jobs(available_at) where state in('queued','reconcile','processing');

create function public.claim_einvoice_job(p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.einvoice_jobs%rowtype; s public.einvoice_submissions%rowtype; prior_state text;
begin
 select * into j from public.einvoice_jobs where (state in('queued','reconcile') and available_at<=now()) or (state='processing' and lease_until<now()) order by available_at,id for update skip locked limit 1;
 if not found then return null; end if;
 prior_state:=j.state;
 update public.einvoice_jobs set state='processing',attempts=attempts+1,lease_until=now()+make_interval(secs=>greatest(10,least(600,p_lease_seconds))),lease_token=gen_random_uuid(),updated_at=now() where id=j.id returning * into j;
 select * into s from public.einvoice_submissions where id=j.submission_id;
 return jsonb_build_object('job',to_jsonb(j),'submission',to_jsonb(s),'must_reconcile',prior_state in('reconcile','processing'));
end $$;
create function public.finish_einvoice_job(p_job_id uuid,p_lease_token uuid,p_outcome text,p_error text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_outcome not in('accepted','reconcile','failed') then raise exception 'Invalid job outcome'; end if;
 update public.einvoice_jobs set state=p_outcome,last_error=left(p_error,2000),available_at=now()+interval '60 seconds',lease_until=null,lease_token=null,updated_at=now()
 where id=p_job_id and lease_token=p_lease_token and state='processing' and lease_until>=now();
 if not found then raise exception 'Job lease is stale'; end if;
end $$;
revoke all on function public.claim_einvoice_job(integer),public.finish_einvoice_job(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_einvoice_job(integer),public.finish_einvoice_job(uuid,uuid,text,text) to service_role;

create function public.import_reviewed_einvoice(p_inbox_id uuid,p_supplier_id uuid,p_coding jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare incoming public.einvoice_inbox%rowtype; v_id uuid; v_existing public.supplier_invoices%rowtype; line jsonb; v_coding jsonb; idx integer:=0; v_net numeric:=0;v_tax numeric:=0;v_total numeric:=0; n numeric;t numeric;g numeric;sgn integer;number text;curr text;invoice_date date;
begin
 select * into incoming from public.einvoice_inbox where id=p_inbox_id for update;
 if not found or auth.uid() is null or not coalesce(public.can_write(incoming.workspace_id),false) then raise exception 'Not authorized'; end if;
 if incoming.environment<>'production' then raise exception 'Sandbox documents cannot enter the accounting records'; end if;
 if incoming.supplier_invoice_id is not null then return incoming.supplier_invoice_id; end if;
 if not exists(select 1 from public.counterparties where id=p_supplier_id and workspace_id=incoming.workspace_id and kind in('vendor','both')) then raise exception 'Select a supplier in this company'; end if;
 if coalesce(incoming.payload->>'documentType','') not in('invoice','credit_note') then raise exception 'Unsupported incoming document type'; end if;
 sgn:=case when incoming.payload->>'documentType'='credit_note' then -1 else 1 end;
 number:=nullif(trim(incoming.payload->>'number'),'');curr:=incoming.payload->>'currency';invoice_date:=(incoming.payload->>'issueDate')::date;
 if number is null or curr is null or curr!~'^[A-Z]{3}$' or invoice_date is null then raise exception 'Incoming document identity is incomplete'; end if;
 if jsonb_typeof(incoming.payload->'lines') is distinct from 'array' or jsonb_array_length(incoming.payload->'lines')=0 then raise exception 'Incoming document has no lines'; end if;
 if jsonb_typeof(p_coding) is distinct from 'array' or jsonb_array_length(p_coding)<>jsonb_array_length(incoming.payload->'lines') then raise exception 'Code every incoming line'; end if;
 for line in select value from jsonb_array_elements(incoming.payload->'lines') loop
  v_coding:=p_coding->idx;
  if not exists(select 1 from public.accounts where id=(v_coding->>'account_id')::uuid and workspace_id=incoming.workspace_id and is_active and type in('expense','cogs','asset')) then raise exception 'Invalid account on line %',idx+1; end if;
  if nullif(v_coding->>'vat_code_id','') is not null and not exists(select 1 from public.vat_codes where id=(v_coding->>'vat_code_id')::uuid and workspace_id=incoming.workspace_id and applies_to in('purchases','both')) then raise exception 'Invalid purchase VAT v_coding'; end if;
  if nullif(trim(line->>'description'),'') is null or coalesce(line->>'net','')!~'^[0-9]+(\.[0-9]{1,2})?$' or coalesce(line->>'tax','')!~'^[0-9]+(\.[0-9]{1,2})?$' or coalesce(line->>'gross','')!~'^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Malformed incoming line'; end if;
  n:=(line->>'net')::numeric;t:=(line->>'tax')::numeric;g:=(line->>'gross')::numeric;
  if n+t<>g then raise exception 'Incoming line amounts do not reconcile'; end if;
  v_net:=v_net+n;v_tax:=v_tax+t;v_total:=v_total+g;idx:=idx+1;
 end loop;
 if v_total<=0 or (incoming.payload#>>'{totals,net}')::numeric is distinct from v_net or (incoming.payload#>>'{totals,tax}')::numeric is distinct from v_tax or (incoming.payload#>>'{totals,gross}')::numeric is distinct from v_total then raise exception 'Incoming totals do not reconcile'; end if;
 -- Serialize duplicate-number imports even when providers assign different delivery IDs.
 perform pg_advisory_xact_lock(hashtextextended(incoming.workspace_id::text||p_supplier_id::text||lower(number),0));
 select * into v_existing from public.supplier_invoices where workspace_id=incoming.workspace_id and supplier_id=p_supplier_id and lower(trim(supplier_invoice_number))=lower(number) for update;
 if found then
  if v_existing.currency<>curr or v_existing.invoice_date<>invoice_date or v_existing.subtotal<>sgn*v_net or v_existing.tax_total<>sgn*v_tax or v_existing.total<>sgn*v_total or v_existing.status='void' then raise exception 'Invoice number already exists with different details; reconcile before importing'; end if;
  if (select jsonb_agg(jsonb_build_object('description',l.description,'net',abs(l.net_amount),'tax',abs(l.vat_amount),'gross',abs(l.gross_amount)) order by l.line_no) from public.supplier_invoice_lines l where l.supplier_invoice_id=v_existing.id)
     is distinct from (select jsonb_agg(jsonb_build_object('description',x.value->>'description','net',(x.value->>'net')::numeric,'tax',(x.value->>'tax')::numeric,'gross',(x.value->>'gross')::numeric) order by x.ordinality) from jsonb_array_elements(incoming.payload->'lines') with ordinality x) then
    raise exception 'Invoice number already exists with different lines; reconcile before importing';
  end if;
  v_id:=v_existing.id;
 else
  insert into public.supplier_invoices(workspace_id,supplier_id,supplier_invoice_number,invoice_date,due_date,currency,subtotal,tax_total,total,status,notes,created_by)
  values(incoming.workspace_id,p_supplier_id,number,invoice_date,nullif(incoming.payload->>'dueDate','')::date,curr,sgn*v_net,sgn*v_tax,sgn*v_total,'draft','Imported from electronic invoice; review before approval.',auth.uid())returning id into v_id;
  idx:=0;
  for line in select value from jsonb_array_elements(incoming.payload->'lines') loop
   v_coding:=p_coding->idx;idx:=idx+1;
   insert into public.supplier_invoice_lines(workspace_id,supplier_invoice_id,line_no,description,account_id,vat_code_id,net_amount,vat_amount,gross_amount)
   values(incoming.workspace_id,v_id,idx,line->>'description',(v_coding->>'account_id')::uuid,nullif(v_coding->>'vat_code_id','')::uuid,sgn*(line->>'net')::numeric,sgn*(line->>'tax')::numeric,sgn*(line->>'gross')::numeric);
  end loop;
 end if;
 update public.einvoice_inbox set supplier_invoice_id=v_id where id=incoming.id;
 insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)values(incoming.workspace_id,'supplier_invoice',v_id,'electronic_invoice_reviewed',auth.uid(),jsonb_build_object('inbox_id',incoming.id,'linked_existing',v_existing.id is not null));
 return v_id;
end $$;
revoke all on function public.import_reviewed_einvoice(uuid,uuid,jsonb) from public,anon;
grant execute on function public.import_reviewed_einvoice(uuid,uuid,jsonb) to authenticated;
-- Linking evidence is one-way and must remain inside the same company.
create function public.check_einvoice_inbox_link() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='UPDATE' and old.supplier_invoice_id is not null and new.supplier_invoice_id is distinct from old.supplier_invoice_id then raise exception 'Incoming invoice link is immutable'; end if;
 if new.supplier_invoice_id is not null and not exists(select 1 from public.supplier_invoices where id=new.supplier_invoice_id and workspace_id=new.workspace_id) then raise exception 'Incoming invoice company mismatch'; end if;
 return new;
end $$;
create trigger check_einvoice_inbox_link before insert or update on public.einvoice_inbox for each row execute function public.check_einvoice_inbox_link();


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

insert into supabase_migrations.schema_migrations(version,name) values('20261102120000','prepare_docflow_january_sandbox');
notify pgrst, 'reload schema';
commit;
