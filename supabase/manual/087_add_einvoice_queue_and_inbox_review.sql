begin;
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
commit;
