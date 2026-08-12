-- Controlled supplier invoice approval. Ledger posting stays deferred until the
-- exact AP and VAT account mapping is confirmed per company.
create or replace function public.approve_supplier_invoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare d public.supplier_invoices%rowtype;v_lines int;v_total numeric;
begin select * into d from public.supplier_invoices where id=p_invoice_id for update;if not found then raise exception 'Supplier invoice not found';end if;
if not public.can_write(d.workspace_id) then raise exception 'Not authorized';end if;if d.status<>'draft' then raise exception 'Only draft invoices can be approved';end if;
select count(*),coalesce(sum(gross_amount),0) into v_lines,v_total from public.supplier_invoice_lines where supplier_invoice_id=p_invoice_id;
if v_lines=0 or round(v_total,2)<>round(d.total,2) then raise exception 'Lines (%) total % does not match invoice total %',v_lines,v_total,d.total;end if;
update public.supplier_invoices set status='approved' where id=p_invoice_id;
insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)values(d.workspace_id,'supplier_invoice',p_invoice_id,'approved',auth.uid(),jsonb_build_object('line_count',v_lines,'total',v_total));end$$;
revoke all on function public.approve_supplier_invoice(uuid) from public;grant execute on function public.approve_supplier_invoice(uuid) to authenticated;
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='approve_supplier_invoice';
