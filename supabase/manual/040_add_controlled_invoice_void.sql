-- Allow an unpaid issued invoice to be voided without rewriting or deleting history.
create or replace function public.void_unpaid_invoice(p_invoice_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype;
begin
 select*into d from public.sales_documents where id=p_invoice_id and document_type='invoice'for update;
 if d.id is null then raise exception'Invoice not found';end if;
 if not public.can_write(d.workspace_id)then raise exception'Not authorized';end if;
 if d.status in('paid','void')or d.amount_paid<>0 then raise exception'Only an unpaid, non-void invoice can be voided';end if;
 if coalesce(trim(p_reason),'')=''then raise exception'A void reason is required';end if;
 update public.sales_documents set status='void',notes=concat_ws(E'\n',nullif(notes,''),'VOID: '||trim(p_reason)),updated_at=now()where id=d.id;
 insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)
 values(d.workspace_id,'invoice',d.id,'invoice_voided',auth.uid(),jsonb_build_object('reason',trim(p_reason),'previous_status',d.status));
end $$;
revoke all on function public.void_unpaid_invoice(uuid,text)from public;
grant execute on function public.void_unpaid_invoice(uuid,text)to authenticated;

select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname='void_unpaid_invoice')as verification;
