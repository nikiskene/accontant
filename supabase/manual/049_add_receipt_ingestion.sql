-- Additive receipt staging and controlled booking. Existing ledger rows are untouched.
begin;
create table public.receipt_mailboxes (
 id uuid primary key default gen_random_uuid(), mailbox text not null unique,
 enabled boolean not null default false, ai_enabled boolean not null default false,
 auto_book boolean not null default false, confidence_threshold numeric not null default .98 check(confidence_threshold between 0 and 1),
 start_at timestamptz not null default now(), delta_url text, lease_until timestamptz,
 last_attempt timestamptz, last_success timestamptz, last_error text
);
create table public.receipt_mailbox_members (
 mailbox_id uuid references public.receipt_mailboxes(id), user_id uuid references auth.users(id),
 primary key(mailbox_id,user_id)
);
create function public.can_review_receipt_mailbox(p_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from receipt_mailbox_members where mailbox_id=p_id and user_id=auth.uid());
$$;
create table public.receipt_aliases (
 alias text primary key check(alias=lower(alias)), mailbox_id uuid not null references public.receipt_mailboxes(id),
 workspace_id uuid not null references public.workspaces(id)
);
create table public.receipt_emails (
 id uuid primary key default gen_random_uuid(), mailbox_id uuid not null references public.receipt_mailboxes(id),
 graph_id text not null, internet_message_id text, sender text, subject text, received_at timestamptz,
 recipients jsonb not null default '[]', headers jsonb not null default '[]', body_text text,
 status text not null default 'received' check(status in('received','processing','processed','failed')),
 error text, attempts integer not null default 0, unique(mailbox_id,graph_id)
);
create table public.receipt_candidates (
 id uuid primary key default gen_random_uuid(), email_id uuid references public.receipt_emails(id),
 workspace_id uuid references public.workspaces(id), receiving_alias text, entity_evidence jsonb not null default '{}',
 source_key text not null, file_path text, filename text, mime_type text, file_hash text,
 vendor text, invoice_number text, document_date date, due_date date, currency text,
 gross_amount numeric(15,2), description text not null default '',
 extraction jsonb not null default '{}', extraction_method text, confidence jsonb not null default '{}',
 status text not null default 'received' check(status in('received','extracting','needs_review','booked','duplicate','ignored','failed')),
 duplicate_status text not null default 'none' check(duplicate_status in('none','possible_duplicate','confirmed_duplicate')),
 duplicate_of uuid references public.receipt_candidates(id), review_reasons text[] not null default '{}',
 booking jsonb not null default '{}', transaction_id uuid references public.transactions(id),
 revision integer not null default 0, failure_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(email_id,source_key)
);
create index receipt_candidates_hash on public.receipt_candidates(file_hash);
create index receipt_candidates_queue on public.receipt_candidates(workspace_id,status,created_at);
create table public.receipt_revisions (
 id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.receipt_candidates(id),
 workspace_id uuid references public.workspaces(id), revision integer not null, snapshot jsonb not null, reason text not null,
 actor uuid references auth.users(id), created_at timestamptz not null default now(), unique(receipt_id,revision)
);
create table public.receipt_vendor_rules (
 workspace_id uuid not null references public.workspaces(id), vendor_normalized text not null,
 account_id uuid not null references public.accounts(id), confirmations integer not null default 1,
 enabled boolean not null default false, last_confirmed timestamptz not null default now(),
 primary key(workspace_id,vendor_normalized)
);
create table public.receipt_processing_events (
 id uuid primary key default gen_random_uuid(), receipt_id uuid references public.receipt_candidates(id),
 email_id uuid references public.receipt_emails(id), event text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.receipt_ai_usage (
 id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.receipt_candidates(id),
 task text not null, model text not null, input_tokens integer, output_tokens integer, created_at timestamptz not null default now()
);
create function public.can_read_receipt(p_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from receipt_candidates r left join receipt_emails e on e.id=r.email_id where r.id=p_id
 and (public.is_workspace_member(r.workspace_id) or public.can_review_receipt_mailbox(e.mailbox_id)));
$$;
do $$ declare t text; begin
 foreach t in array array['receipt_mailboxes','receipt_mailbox_members','receipt_aliases','receipt_emails','receipt_candidates','receipt_revisions','receipt_vendor_rules','receipt_processing_events','receipt_ai_usage'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create policy receipt_mailboxes_read on public.receipt_mailboxes for select to authenticated using(can_review_receipt_mailbox(id));
create policy receipt_members_read on public.receipt_mailbox_members for select to authenticated using(user_id=auth.uid());
create policy receipt_alias_read on public.receipt_aliases for select to authenticated using(can_review_receipt_mailbox(mailbox_id));
create policy receipt_email_read on public.receipt_emails for select to authenticated using(can_review_receipt_mailbox(mailbox_id));
create policy receipt_candidate_read on public.receipt_candidates for select to authenticated using(can_read_receipt(id));
create policy receipt_revision_read on public.receipt_revisions for select to authenticated using(can_read_receipt(receipt_id) and (workspace_id is null or is_workspace_member(workspace_id)));
create policy receipt_rules_read on public.receipt_vendor_rules for select to authenticated using(is_workspace_member(workspace_id));
create policy receipt_event_read on public.receipt_processing_events for select to authenticated using(can_read_receipt(receipt_id));
create policy receipt_usage_read on public.receipt_ai_usage for select to authenticated using(can_read_receipt(receipt_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('receipt-originals','receipt-originals',false,20971520,array['application/pdf','image/jpeg','image/png','image/heic','text/plain']) on conflict(id) do nothing;
create policy receipt_original_read on storage.objects for select to authenticated using(bucket_id='receipt-originals' and exists(select 1 from public.receipt_candidates r where r.file_path=name and public.can_read_receipt(r.id)));

-- Lets an authorized mailbox reviewer enable/disable ingestion and maintain
-- alias-to-company mappings. It never accepts or returns credentials.
create function public.configure_receipt_mailbox(p_id uuid,p_enabled boolean,p_ai_enabled boolean,p_aliases jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare a jsonb; begin
 if not can_review_receipt_mailbox(p_id) then raise exception 'Not authorized'; end if;
 if jsonb_typeof(p_aliases) is distinct from 'array' then raise exception 'Aliases must be an array'; end if;
 if exists(select 1 from jsonb_array_elements(p_aliases) x where nullif(trim(x->>'alias'),'') is null or nullif(x->>'workspace_id','') is null or not can_write((x->>'workspace_id')::uuid)) then raise exception 'Each alias must target a company you can write to'; end if;
 update receipt_mailboxes set enabled=p_enabled,ai_enabled=p_ai_enabled,last_error=null where id=p_id;
 delete from receipt_aliases where mailbox_id=p_id;
 for a in select value from jsonb_array_elements(p_aliases) loop
   insert into receipt_aliases(alias,mailbox_id,workspace_id)
   values(lower(trim(a->>'alias')),p_id,(a->>'workspace_id')::uuid);
 end loop;
end $$;

-- A short lease prevents a scheduled sync and a manual sync from processing
-- the same Graph delta page simultaneously.
create function public.claim_receipt_mailbox(p_id uuid) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 update receipt_mailboxes set lease_until=now()+interval '5 minutes',last_attempt=now()
 where id=p_id and enabled=true and (lease_until is null or lease_until<now());
 return found;
end $$;

create function public.save_receipt(p_id uuid,p_revision integer,p_data jsonb,p_reason text) returns integer
language plpgsql security definer set search_path=public as $$
declare r receipt_candidates%rowtype; w uuid; e uuid; begin
 select * into r from receipt_candidates where id=p_id for update;
 if not found or not can_read_receipt(p_id) then raise exception 'Receipt not accessible'; end if;
 select mailbox_id into e from receipt_emails where id=r.email_id;
 if not coalesce(can_write(r.workspace_id),false) and not coalesce(can_review_receipt_mailbox(e),false) then raise exception 'Not authorized'; end if;
 if r.revision<>p_revision then raise exception 'Receipt changed; reload before saving';end if;
 if r.status='booked' then raise exception 'Use Correct booking to reverse and replace a posted receipt';end if;
 w:=nullif(p_data->>'workspace_id','')::uuid;
 if w is not null and not coalesce(can_write(w),false) then raise exception 'No write access to selected company';end if;
 if nullif(trim(p_reason),'') is null then raise exception 'A change reason is required';end if;
 insert into receipt_revisions(receipt_id,workspace_id,revision,snapshot,reason,actor) values(r.id,r.workspace_id,r.revision,to_jsonb(r),p_reason,auth.uid());
 update receipt_candidates set workspace_id=w,vendor=nullif(trim(p_data->>'vendor'),''),invoice_number=nullif(trim(p_data->>'invoice_number'),''),
 document_date=nullif(p_data->>'document_date','')::date,due_date=nullif(p_data->>'due_date','')::date,currency=upper(nullif(p_data->>'currency','')),
 gross_amount=nullif(p_data->>'gross_amount','')::numeric,description=coalesce(p_data->>'description',''),booking=coalesce(p_data->'booking','{}'),
 status='needs_review',revision=revision+1,updated_at=now() where id=p_id;
 return r.revision+1;
end $$;

create function public.book_receipt(p_id uuid,p_revision integer,p_reason text default 'Reviewed and booked') returns uuid
language plpgsql security definer set search_path=public as $$
declare r receipt_candidates%rowtype; t uuid; l jsonb; n integer:=0; total numeric:=0; gross numeric; tax numeric; private_amount numeric; recovery numeric; expense numeric; deductible numeric; private_pct numeric; deduct_pct numeric; recovery_pct numeric; a uuid; contra uuid; vat_a uuid; private_a uuid; nondeduct_a uuid; vcode uuid; fx numeric; base text; yr uuid;
begin
 select * into r from receipt_candidates where id=p_id for update;
 if not found or not coalesce(can_write(r.workspace_id),false) then raise exception 'Not authorized';end if;
 if r.status='booked' then return r.transaction_id;end if;
 if r.revision<>p_revision then raise exception 'Receipt changed; reload';end if;
 if r.status<>'needs_review' or r.duplicate_status='confirmed_duplicate' then raise exception 'Receipt is not bookable';end if;
 if r.duplicate_status='possible_duplicate' and nullif(trim(r.booking->>'duplicate_override_reason'),'') is null then raise exception 'Resolve possible duplicate with a reason';end if;
 if r.vendor is null or r.document_date is null or r.currency !~ '^[A-Z]{3}$' or r.currency is null or r.gross_amount is null or r.gross_amount<=0 then raise exception 'Company, vendor, date, currency and positive total are required';end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(r.file_hash,r.vendor||coalesce(r.invoice_number,'')||r.document_date::text||r.gross_amount::text),0));
 if exists(select 1 from receipt_candidates x where x.id<>r.id and x.status='booked' and ((r.file_hash is not null and x.file_hash=r.file_hash) or (x.workspace_id=r.workspace_id and lower(x.vendor)=lower(r.vendor) and r.invoice_number is not null and x.invoice_number=r.invoice_number))) then raise exception 'Already booked: duplicate document';end if;
 if exists(select 1 from accounting_periods where workspace_id=r.workspace_id and r.document_date between period_start and period_end and status='locked') then raise exception 'Accounting period is locked';end if;
 select id into yr from tax_years where workspace_id=r.workspace_id and r.document_date between start_date and end_date and status='open';
 if yr is null then raise exception 'Open tax year required';end if;
 select base_currency into base from workspaces where id=r.workspace_id;
 fx:=nullif(r.booking->>'fx_rate','')::numeric;
 if r.currency=base then fx:=1;end if;
 if fx is null or fx<=0 then raise exception 'Enter a verified exchange rate to company currency';end if;
 contra:=nullif(r.booking->>'counter_account_id','')::uuid;
 vat_a:=nullif(r.booking->>'vat_account_id','')::uuid;
 private_a:=nullif(r.booking->>'private_account_id','')::uuid;
 nondeduct_a:=nullif(r.booking->>'nondeductible_account_id','')::uuid;
 if not exists(select 1 from accounts where id=contra and workspace_id=r.workspace_id and is_active and type in('asset','liability','equity')) then raise exception 'Select payment, payable or clearing account in this company';end if;
 if jsonb_typeof(r.booking->'lines') is distinct from 'array' or jsonb_array_length(r.booking->'lines')=0 then raise exception 'At least one allocation is required';end if;
 insert into transactions(workspace_id,txn_date,txn_type,description,currency,status,tax_year_id,source,invoice_number)
 values(r.workspace_id,r.document_date,'purchase',r.description,base,'draft',yr,'email_receipt',r.invoice_number) returning id into t;
 for l in select value from jsonb_array_elements(r.booking->'lines') loop
 a:=nullif(l->>'account_id','')::uuid; vcode:=nullif(l->>'vat_code_id','')::uuid;
 gross:=(l->>'gross')::numeric;tax:=(l->>'tax')::numeric;
 private_pct:=(l->>'private_percent')::numeric;deduct_pct:=(l->>'deductible_percent')::numeric;recovery_pct:=(l->>'vat_recovery_percent')::numeric;
 if gross is null or tax is null or gross<=0 or tax<0 or tax>gross or private_pct is null or private_pct not between 0 and 100 or deduct_pct is null or deduct_pct not between 0 and 100 or recovery_pct is null or recovery_pct not between 0 and 100 then raise exception 'Invalid amounts or allocation percentages';end if;
 if not exists(select 1 from accounts where id=a and workspace_id=r.workspace_id and is_active and type in('expense','cogs','asset')) then raise exception 'Invalid booking account for company';end if;
 if vcode is not null and not exists(select 1 from vat_codes where id=vcode and workspace_id=r.workspace_id and applies_to in('purchases','both')) then raise exception 'VAT code belongs to another company or is not for purchases';end if;
 if (tax>0 or private_pct>0 or deduct_pct<100) and nullif(trim(r.booking->>'tax_reason'),'') is null then raise exception 'Document tax treatment and business purpose';end if;
 total:=total+gross;
 private_amount:=round(gross*fx*private_pct/100,2);
 recovery:=round(tax*fx*(1-private_pct/100)*recovery_pct/100,2);
 expense:=round(gross*fx,2)-private_amount-recovery;
 deductible:=round(expense*deduct_pct/100,2);
 if deductible>0 then n:=n+1;insert into transaction_lines(workspace_id,transaction_id,line_no,account_id,amount,net_amount,vat_amount,vat_code_id,memo) values(r.workspace_id,t,n,a,deductible,round((gross-tax)*fx*(1-private_pct/100),2),recovery,vcode,coalesce(l->>'description',r.description));end if;
 if expense-deductible>0 then
 if not exists(select 1 from accounts where id=nondeduct_a and workspace_id=r.workspace_id and is_active and type='expense') then raise exception 'Select non-deductible expense account';end if;
 n:=n+1;insert into transaction_lines(workspace_id,transaction_id,line_no,account_id,amount,memo)values(r.workspace_id,t,n,nondeduct_a,expense-deductible,'Non-deductible business expense');end if;
 if private_amount>0 then
 if not exists(select 1 from accounts where id=private_a and workspace_id=r.workspace_id and is_active and type in('equity','asset','liability')) then raise exception 'Select private / shareholder clearing account';end if;
 n:=n+1;insert into transaction_lines(workspace_id,transaction_id,line_no,account_id,amount,memo)values(r.workspace_id,t,n,private_a,private_amount,'Private share');end if;
 if recovery>0 then
 if not exists(select 1 from accounts where id=vat_a and workspace_id=r.workspace_id and is_active and type='asset') then raise exception 'Select input VAT account';end if;
 n:=n+1;insert into transaction_lines(workspace_id,transaction_id,line_no,account_id,amount,memo)values(r.workspace_id,t,n,vat_a,recovery,'Recoverable input VAT');end if;
 end loop;
 if round(total,2)<>r.gross_amount then raise exception 'Allocation total must equal receipt gross';end if;
 n:=n+1;insert into transaction_lines(workspace_id,transaction_id,line_no,account_id,amount,memo) select r.workspace_id,t,n,contra,-sum(amount),'Payment / payable' from transaction_lines where transaction_id=t;
 perform post_transaction(t,auth.uid());
 insert into receipt_revisions(receipt_id,workspace_id,revision,snapshot,reason,actor) values(r.id,r.workspace_id,r.revision,to_jsonb(r),p_reason,auth.uid());
 update receipt_candidates set status='booked',transaction_id=t,revision=revision+1,updated_at=now() where id=r.id;
 insert into audit_events(workspace_id,entity_type,entity_id,action,created_by,details) values(r.workspace_id,'receipt',r.id,'booked',auth.uid(),jsonb_build_object('transaction_id',t,'source_currency',r.currency,'fx_rate',fx));
 return t;
end $$;

create function public.correct_receipt(p_id uuid,p_revision integer,p_data jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path=public as $$
declare r receipt_candidates%rowtype; rev uuid; v integer; begin
 select * into r from receipt_candidates where id=p_id for update;
 if not found or not coalesce(can_write(r.workspace_id),false) or not coalesce(can_write(nullif(p_data->>'workspace_id','')::uuid),false) then raise exception 'Write permission required in both companies';end if;
 if r.status<>'booked' or r.revision<>p_revision then raise exception 'Reload the booked receipt';end if;
 if nullif(trim(p_reason),'') is null then raise exception 'Correction reason is required';end if;
 if exists(select 1 from accounting_periods where workspace_id=r.workspace_id and current_date between period_start and period_end and status='locked') then raise exception 'Reversal period is locked';end if;
 rev:=reverse_transaction(r.transaction_id,auth.uid(),p_reason);perform post_transaction(rev,auth.uid());
 update receipt_candidates set status='needs_review' where id=p_id;
 v:=save_receipt(p_id,p_revision,p_data,p_reason);
 insert into receipt_processing_events(receipt_id,event,details) values(p_id,'booking_reversed',jsonb_build_object('original_transaction',r.transaction_id,'reversal_transaction',rev));
 return book_receipt(p_id,v,p_reason);
end $$;

create function public.receipt_action(p_id uuid,p_revision integer,p_action text,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
declare r receipt_candidates%rowtype; begin
 select * into r from receipt_candidates where id=p_id for update;
 if not found or not can_read_receipt(p_id) or not (coalesce(can_write(r.workspace_id),false) or exists(select 1 from receipt_emails e where e.id=r.email_id and can_review_receipt_mailbox(e.mailbox_id))) then raise exception 'Not authorized';end if;
 if r.revision<>p_revision or r.status='booked' then raise exception 'Reload receipt; booked receipts require correction';end if;
 if p_action not in('duplicate','ignored','retry') or nullif(trim(p_reason),'') is null then raise exception 'Action and reason required';end if;
 insert into receipt_revisions(receipt_id,workspace_id,revision,snapshot,reason,actor)values(r.id,r.workspace_id,r.revision,to_jsonb(r),p_reason,auth.uid());
 update receipt_candidates set status=case when p_action='retry' then 'received' else p_action end,duplicate_status=case when p_action='duplicate' then 'confirmed_duplicate' else duplicate_status end,revision=revision+1,failure_reason=null,updated_at=now() where id=p_id;
end $$;

create function public.confirm_receipt_vendor_rule(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare r receipt_candidates%rowtype; a uuid; v text; begin
 select * into r from receipt_candidates where id=p_id;
 if r.status<>'booked' or not coalesce(can_write(r.workspace_id),false) then raise exception 'Book and confirm receipt first';end if;
 a:=(r.booking->'lines'->0->>'account_id')::uuid;v:=lower(trim(r.vendor));
 insert into receipt_vendor_rules(workspace_id,vendor_normalized,account_id)values(r.workspace_id,v,a)
 on conflict(workspace_id,vendor_normalized) do update set confirmations=case when receipt_vendor_rules.account_id=excluded.account_id then receipt_vendor_rules.confirmations+1 else 1 end,account_id=excluded.account_id,enabled=case when receipt_vendor_rules.account_id=excluded.account_id then receipt_vendor_rules.confirmations+1>=3 else false end,last_confirmed=now();
end $$;
revoke all on function public.save_receipt(uuid,integer,jsonb,text),public.book_receipt(uuid,integer,text),public.correct_receipt(uuid,integer,jsonb,text),public.receipt_action(uuid,integer,text,text),public.confirm_receipt_vendor_rule(uuid) from public;
grant execute on function public.save_receipt(uuid,integer,jsonb,text),public.book_receipt(uuid,integer,text),public.correct_receipt(uuid,integer,jsonb,text),public.receipt_action(uuid,integer,text,text),public.confirm_receipt_vendor_rule(uuid) to authenticated;
revoke all on function public.configure_receipt_mailbox(uuid,boolean,boolean,jsonb),public.claim_receipt_mailbox(uuid) from public;
grant execute on function public.configure_receipt_mailbox(uuid,boolean,boolean,jsonb) to authenticated;
grant execute on function public.claim_receipt_mailbox(uuid) to service_role;
commit;
