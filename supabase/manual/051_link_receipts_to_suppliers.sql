-- Link receipt review and the resulting ledger posting to the canonical vendor record.
-- Run after 049_add_receipt_ingestion.sql.

alter table public.receipt_candidates
  add column if not exists supplier_id uuid references public.counterparties(id) on delete set null;
create index if not exists receipt_candidates_supplier_idx
  on public.receipt_candidates(workspace_id, supplier_id) where supplier_id is not null;

create or replace function public.save_receipt(p_id uuid,p_revision integer,p_data jsonb,p_reason text) returns integer
language plpgsql security definer set search_path=public as $$
declare r receipt_candidates%rowtype; w uuid; e uuid; s uuid;
begin
 select * into r from receipt_candidates where id=p_id for update;
 if not found or not can_read_receipt(p_id) then raise exception 'Receipt not accessible'; end if;
 select mailbox_id into e from receipt_emails where id=r.email_id;
 if not coalesce(can_write(r.workspace_id),false) and not coalesce(can_review_receipt_mailbox(e),false) then raise exception 'Not authorized'; end if;
 if r.revision<>p_revision then raise exception 'Receipt changed; reload before saving'; end if;
 if r.status='booked' then raise exception 'Use Correct booking to reverse and replace a posted receipt'; end if;
 w:=nullif(p_data->>'workspace_id','')::uuid;
 if w is not null and not coalesce(can_write(w),false) then raise exception 'No write access to selected company'; end if;
 s:=nullif(p_data->>'supplier_id','')::uuid;
 if s is not null and not exists(select 1 from counterparties where id=s and workspace_id=w and kind in('vendor','both')) then
   raise exception 'Selected supplier does not belong to this company';
 end if;
 if nullif(trim(p_reason),'') is null then raise exception 'A change reason is required'; end if;
 insert into receipt_revisions(receipt_id,workspace_id,revision,snapshot,reason,actor)
 values(r.id,r.workspace_id,r.revision,to_jsonb(r),p_reason,auth.uid());
 update receipt_candidates set workspace_id=w,supplier_id=s,vendor=nullif(trim(p_data->>'vendor'),''),invoice_number=nullif(trim(p_data->>'invoice_number'),''),
 document_date=nullif(p_data->>'document_date','')::date,due_date=nullif(p_data->>'due_date','')::date,currency=upper(nullif(p_data->>'currency','')),
 gross_amount=nullif(p_data->>'gross_amount','')::numeric,description=coalesce(p_data->>'description',''),booking=coalesce(p_data->'booking','{}'),
 status='needs_review',revision=revision+1,updated_at=now() where id=p_id;
 return r.revision+1;
end $$;

create or replace function public.link_booked_receipt_supplier()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='booked' and new.supplier_id is not null and new.transaction_id is not null then
   update public.transaction_lines
   set counterparty_id=new.supplier_id
   where transaction_id=new.transaction_id;
 end if;
 return new;
end $$;

drop trigger if exists receipt_link_booked_supplier on public.receipt_candidates;
create trigger receipt_link_booked_supplier
  after update of status, supplier_id on public.receipt_candidates
  for each row execute function public.link_booked_receipt_supplier();

revoke all on function public.save_receipt(uuid,integer,jsonb,text) from public;
grant execute on function public.save_receipt(uuid,integer,jsonb,text) to authenticated;
