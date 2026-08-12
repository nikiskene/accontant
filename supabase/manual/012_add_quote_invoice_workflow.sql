-- Atomic numbering and quote-to-invoice conversion.

create or replace function public.next_document_number(
  p_workspace_id uuid, p_document_type text, p_issue_date date
) returns text
language plpgsql security definer set search_path = public
as $$
declare v_sequence public.document_sequences%rowtype; v_result text;
begin
  if not public.can_write(p_workspace_id) then raise exception 'Not authorized'; end if;
  if p_document_type not in ('quote', 'invoice', 'credit_note') then raise exception 'Invalid document type'; end if;

  insert into public.document_sequences (workspace_id, document_type, fiscal_year, prefix)
  values (
    p_workspace_id, p_document_type, extract(year from p_issue_date)::integer,
    case p_document_type when 'quote' then 'Q-' when 'invoice' then 'INV-' else 'CN-' end
  ) on conflict do nothing;

  select * into v_sequence from public.document_sequences
  where workspace_id = p_workspace_id and document_type = p_document_type
    and fiscal_year = extract(year from p_issue_date)::integer
  for update;

  v_result := v_sequence.prefix || v_sequence.fiscal_year::text || '-'
    || lpad(v_sequence.next_number::text, v_sequence.padding, '0');
  update public.document_sequences set next_number = next_number + 1
  where workspace_id = p_workspace_id and document_type = p_document_type
    and fiscal_year = v_sequence.fiscal_year;
  return v_result;
end $$;

create or replace function public.convert_quote_to_invoice(
  p_quote_id uuid, p_fraction numeric default 1,
  p_issue_date date default current_date, p_due_date date default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_quote public.sales_documents%rowtype; v_invoice uuid; v_used numeric; v_number text;
begin
  select * into v_quote from public.sales_documents where id = p_quote_id for update;
  if not found or v_quote.document_type <> 'quote' then raise exception 'Quote not found'; end if;
  if not public.can_write(v_quote.workspace_id) then raise exception 'Not authorized'; end if;
  if v_quote.status not in ('accepted', 'partially_invoiced') then raise exception 'Quote must be accepted'; end if;
  if p_fraction <= 0 or p_fraction > 1 then raise exception 'Fraction must be between 0 and 1'; end if;

  select coalesce(sum(fraction), 0) into v_used from public.sales_document_links
  where source_document_id = p_quote_id and link_type = 'quote_to_invoice';
  if v_used + p_fraction > 1.000001 then raise exception 'Invoice fraction exceeds remaining quote value'; end if;

  v_number := public.next_document_number(v_quote.workspace_id, 'invoice', p_issue_date);
  insert into public.sales_documents (
    workspace_id, document_type, document_number, customer_id, template_id,
    issue_date, due_date, currency, status, customer_reference, introduction,
    notes, terms_text, subtotal, tax_total, total, created_by
  ) values (
    v_quote.workspace_id, 'invoice', v_number, v_quote.customer_id,
    (select id from public.document_templates where workspace_id = v_quote.workspace_id
      and document_type = 'invoice' and is_default order by created_at limit 1),
    p_issue_date, coalesce(p_due_date, p_issue_date + 14), v_quote.currency, 'draft',
    v_quote.customer_reference, v_quote.introduction, v_quote.notes, v_quote.terms_text,
    round(v_quote.subtotal * p_fraction, 2), round(v_quote.tax_total * p_fraction, 2),
    round(v_quote.total * p_fraction, 2), auth.uid()
  ) returning id into v_invoice;

  insert into public.sales_document_lines (
    workspace_id, document_id, line_no, product_service_id, description,
    quantity, unit, unit_price, discount_percent, vat_code_id, vat_rate,
    net_amount, vat_amount, gross_amount, revenue_account_id
  ) select workspace_id, v_invoice, line_no, product_service_id, description,
    quantity * p_fraction, unit, unit_price, discount_percent, vat_code_id, vat_rate,
    round(net_amount * p_fraction, 2), round(vat_amount * p_fraction, 2),
    round(gross_amount * p_fraction, 2), revenue_account_id
  from public.sales_document_lines where document_id = p_quote_id order by line_no;

  insert into public.sales_document_links (
    workspace_id, source_document_id, target_document_id, link_type, fraction
  ) values (v_quote.workspace_id, p_quote_id, v_invoice, 'quote_to_invoice', p_fraction);

  update public.sales_documents set status = case
    when v_used + p_fraction >= 0.999999 then 'invoiced' else 'partially_invoiced' end,
    updated_at = now() where id = p_quote_id;
  insert into public.audit_events (workspace_id, entity_type, entity_id, action, details, created_by)
  values (v_quote.workspace_id, 'quote', p_quote_id, 'converted_to_invoice',
    jsonb_build_object('invoice_id', v_invoice, 'fraction', p_fraction), auth.uid());
  return v_invoice;
end $$;

revoke all on function public.next_document_number(uuid, text, date) from public;
revoke all on function public.convert_quote_to_invoice(uuid, numeric, date, date) from public;
grant execute on function public.next_document_number(uuid, text, date) to authenticated;
grant execute on function public.convert_quote_to_invoice(uuid, numeric, date, date) to authenticated;

select p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('next_document_number', 'convert_quote_to_invoice')
order by p.proname;
