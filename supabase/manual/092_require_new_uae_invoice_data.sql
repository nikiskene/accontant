begin;
alter table public.sales_documents add column einvoice_data_required boolean not null default false;
alter table public.sales_documents add column einvoice_data_snapshot jsonb;
-- A completeness check, not provider certification. No network or credential access.
create function public.check_uae_invoice_data(c jsonb) returns jsonb language plpgsql immutable set search_path=public as $$
declare w jsonb:=c->'workspace';p jsonb:=c->'profile';s jsonb:=c->'settings';d jsonb:=c->'document';b jsonb:=c->'customer';m jsonb:=coalesce(c->'metadata','{}');bp jsonb;f jsonb:='[]';l jsonb;v jsonb;meta jsonb;key text;label text;country text;unit text;category text;net numeric:=0;tax numeric:=0;gross numeric:=0;n numeric;t numeric;g numeric;qty numeric;price numeric;discount numeric;rate numeric;idx integer:=0;bank jsonb;vat_status text;
begin
 if w->>'country'<>'AE' then return f;end if;
 vat_status:=coalesce(s->>'vat_status','unconfirmed');
 if vat_status not in('registered','not_registered') then f:=f||jsonb_build_object('field','company.vat_status','message','Confirm the company VAT status in E-invoicing.');end if;
 if coalesce(s->>'tin','')!~'^[0-9]{10}$' then f:=f||jsonb_build_object('field','company.tin','message','Complete the company 10-digit TIN in E-invoicing.');end if;
 foreach key in array array['legal_name'] loop if nullif(trim(w->>key),'') is null then f:=f||jsonb_build_object('field','company.'||key,'message','Complete the company registered name.');end if;end loop;
 foreach key in array array['address_line_1','city','state_region'] loop if nullif(trim(p->>key),'') is null then f:=f||jsonb_build_object('field','company.'||key,'message','Complete company '||replace(key,'_',' ')||' in Company credentials.');end if;end loop;
 if coalesce(s->>'registration_type','TL')='TL' then
  foreach key in array array['trade_licence_number','licensing_authority'] loop if nullif(trim(p->>key),'') is null then f:=f||jsonb_build_object('field','company.'||key,'message','Complete company '||replace(key,'_',' ')||' in Company credentials.');end if;end loop;
 else f:=f||jsonb_build_object('field','company.registration_type','message','This registration type needs its additional identity fields and provider review before issuance.');end if;
 if vat_status='registered' and coalesce(p->>'vat_number','')!~'^[0-9]{15}$' then f:=f||jsonb_build_object('field','company.vat_number','message','Complete the company VAT TRN.');end if;
 bp:=coalesce(b->'einvoice_profile','{}')||jsonb_strip_nulls(coalesce(m->'buyer','{}'));
 -- Blank per-invoice overrides must not erase a reusable customer identity.
 for key in select jsonb_object_keys(coalesce(m->'buyer','{}')) loop if nullif(trim(m#>>array['buyer',key]),'') is null and b->'einvoice_profile' ? key then bp:=jsonb_set(bp,array[key],b#>array['einvoice_profile',key]);end if;end loop;
 if nullif(trim(coalesce(b->>'company_name',b->>'name')),'') is null then f:=f||jsonb_build_object('field','customer.name','message','Complete the customer legal name.');end if;
 foreach key in array array['street_address','city'] loop if nullif(trim(b->>key),'') is null then f:=f||jsonb_build_object('field','customer.'||key,'message','Complete customer '||replace(key,'_',' ')||' in the customer record.');end if;end loop;
 country:=upper(coalesce(nullif(bp->>'country',''),b->>'country',''));
 if country!~'^[A-Z]{2}$' then f:=f||jsonb_build_object('field','customer.country','message','Use a two-letter customer country code, such as AE or AT.');end if;
 if bp->>'type' is distinct from 'business' then f:=f||jsonb_build_object('field','customer.type','message','Confirm the business customer type. Consumer invoices need a separate scope review.');end if;
 if vat_status='not_registered' then
  foreach key in array array['registration_number','registration_type'] loop if nullif(trim(bp->>key),'') is null then f:=f||jsonb_build_object('field','customer.'||key,'message','Complete the customer legal '||replace(key,'_',' ')||' in Electronic invoice details.');end if;end loop;
 end if;
 if country='AE' then
  if nullif(trim(b->>'state'),'') is null then f:=f||jsonb_build_object('field','customer.state','message','Complete the customer emirate.');end if;
  if coalesce(bp->>'tin','')!~'^[0-9]{10}$' then f:=f||jsonb_build_object('field','customer.tin','message','Complete the UAE customer TIN.');end if;
  if bp->>'scheme' is distinct from '0235' or bp->>'electronic_address' is distinct from bp->>'tin' then f:=f||jsonb_build_object('field','customer.endpoint','message','Confirm the UAE customer electronic address using its TIN and scheme 0235.');end if;
 elsif country ~ '^[A-Z]{2}$' then
  if coalesce(bp->>'routing','')='peppol' then
   if nullif(bp->>'electronic_address','') is null or nullif(bp->>'scheme','') is null then f:=f||jsonb_build_object('field','customer.endpoint','message','Complete the foreign customer Peppol address and scheme.');end if;
  elsif coalesce(bp->>'routing','')<>'export_fallback' then f:=f||jsonb_build_object('field','customer.routing','message','Confirm whether the foreign customer receives Peppol invoices, or requires the export fallback route.');end if;
 end if;
 if vat_status='registered' and country='AE' and coalesce(b->>'vat_trn','')!~'^[0-9]{15}$' then f:=f||jsonb_build_object('field','customer.vat_trn','message','Complete the buyer VAT identity, or use the separately reviewed non-VAT buyer route.');end if;
 if nullif(m->>'supply_date','') is null then f:=f||jsonb_build_object('field','supply_date','message','Enter an exact supply date for the invoice.');end if;
 if d->>'document_type'='invoice' and nullif(d->>'due_date','') is null then f:=f||jsonb_build_object('field','due_date','message','Enter the payment due date.');end if;
 if coalesce(d->>'currency','')!~'^[A-Z]{3}$' then f:=f||jsonb_build_object('field','currency','message','Choose a three-letter invoice currency.');end if;
 if d->>'currency'<>'AED' and (nullif(m->>'exchange_rate','') is null or coalesce((m->>'exchange_rate')::numeric,0)<=0) then f:=f||jsonb_build_object('field','exchange_rate','message','Enter the verified exchange rate to AED.');end if;
 if coalesce(m->>'transaction_type','')!~'^[01]{8}$' then f:=f||jsonb_build_object('field','transaction_type','message','Confirm the invoice transaction scenario.');end if;
 if country<>'AE' and coalesce(m->>'transaction_type','')~'^[01]{8}$' and right(m->>'transaction_type',1)<>'1' then f:=f||jsonb_build_object('field','transaction_type','message','Confirm the export flag for this foreign buyer.');end if;
 if nullif(trim(m->>'buyer_reference'),'') is null and nullif(trim(m->>'purchase_order'),'') is null then f:=f||jsonb_build_object('field','buyer_reference','message','Enter the buyer routing reference or the customer purchase-order number.');end if;
 if coalesce(m->>'payment_means','') not in('10','30','42','58') then f:=f||jsonb_build_object('field','payment_means','message','Choose bank transfer or cash. Other payment methods need their additional provider fields.');end if;
 if coalesce(m->>'payment_means','') in('30','42','58') then
  bank:=c->'bank';
  if nullif(trim(coalesce(nullif(bank->>'iban',''),bank->>'account_number')),'') is null or nullif(trim(bank->>'account_name'),'') is null then f:=f||jsonb_build_object('field','bank','message','Complete a default company bank account, including account holder and IBAN/account number.');end if;
 end if;
 if jsonb_array_length(coalesce(c->'lines','[]'))=0 then f:=f||jsonb_build_object('field','lines','message','Add at least one invoice line.');end if;
 for l in select value from jsonb_array_elements(coalesce(c->'lines','[]')) loop
  idx:=idx+1;label:='Line '||idx||': ';v:=coalesce(l->'vat_code','{}');meta:=coalesce(m#>array['lines',l->>'id'],'{}');
  if nullif(trim(l->>'description'),'') is null then f:=f||jsonb_build_object('field','lines.'||idx||'.description','message',label||'enter an item description.');end if;
  unit:=coalesce(nullif(meta->>'unit_code',''),l->>'unit');
  if lower(unit) not in('each','unit','hour','hours','day','days','kg','c62','h87','hur','day','kgm') or unit is null then f:=f||jsonb_build_object('field','lines.'||idx||'.unit','message',label||'choose a supported unit: each, hours, days or kg.');end if;
  n:=(l->>'net_amount')::numeric;t:=(l->>'vat_amount')::numeric;g:=(l->>'gross_amount')::numeric;qty:=(l->>'quantity')::numeric;price:=(l->>'unit_price')::numeric;discount:=coalesce((l->>'discount_percent')::numeric,0);rate:=(l->>'vat_rate')::numeric;
  if qty=0 or price<0 or n+t<>g or abs(n)<>round(abs(qty)*price*(1-discount/100),2) or abs(t)<>round(abs(n)*rate,2) then f:=f||jsonb_build_object('field','lines.'||idx||'.amounts','message',label||'quantity, price, discount and rounded tax amounts must reconcile.');end if;
  if vat_status='not_registered' then
   if rate<>0 or t<>0 then f:=f||jsonb_build_object('field','lines.'||idx||'.vat','message',label||'a non-VAT-registered seller cannot charge VAT.');end if;
  else
   category:=coalesce(nullif(meta->>'tax_category',''),v->>'category');
   if coalesce(category,'') not in('standard','zero','exempt','out_of_scope') then f:=f||jsonb_build_object('field','lines.'||idx||'.tax_category','message',label||'confirm the VAT category; a zero rate alone is not sufficient.');end if;
   if category='standard' and rate<>0.05 then f:=f||jsonb_build_object('field','lines.'||idx||'.rate','message',label||'the standard UAE VAT rate must be 5%.');end if;
   if category in('zero','exempt','out_of_scope') and (rate<>0 or nullif(trim(meta->>'tax_reason'),'') is null) then f:=f||jsonb_build_object('field','lines.'||idx||'.tax_reason','message',label||'record the zero-VAT treatment and its reason.');end if;
   if category='exempt' and nullif(trim(meta->>'tax_reason_code'),'') is null then f:=f||jsonb_build_object('field','lines.'||idx||'.tax_reason_code','message',label||'record the exemption code.');end if;
  end if;
  net:=net+n;tax:=tax+t;gross:=gross+g;
 end loop;
 if net is distinct from (d->>'subtotal')::numeric or tax is distinct from (d->>'tax_total')::numeric or gross is distinct from (d->>'total')::numeric then f:=f||jsonb_build_object('field','totals','message','Invoice totals must reconcile with the rounded line amounts.');end if;
 if d->>'document_type'='credit_note' and (nullif(m->>'credit_reason','') is null or c->'preceding' is null or c->'preceding'='null'::jsonb) then f:=f||jsonb_build_object('field','credit_reason','message','Record the credit reason and reference the original invoice.');end if;
 return f;
end $$;
create function public.einvoice_issue_readiness(p_document_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare c jsonb;f jsonb;bank jsonb;needed boolean;
begin
 c:=public.einvoice_preparation_context(p_document_id);
 select einvoice_data_required into needed from public.sales_documents where id=p_document_id;
 select to_jsonb(b) into bank from public.company_bank_accounts b where b.workspace_id=(c#>>'{workspace,id}')::uuid and b.is_active order by b.is_default desc,b.created_at limit 1;
 c:=c||jsonb_build_object('bank',bank);
 f:=public.check_uae_invoice_data(c);
 return jsonb_build_object('required',needed,'ready',jsonb_array_length(f)=0,'findings',f,'provider_validated',false);
end $$;
create function public.guard_new_uae_invoice_data() returns trigger language plpgsql security definer set search_path=public as $$
declare ae boolean;result jsonb;messages text;
begin
 select country='AE' into ae from public.workspaces where id=new.workspace_id;
 if TG_OP='INSERT' then
  new.einvoice_data_required:=coalesce(ae,false) and new.document_type in('invoice','credit_note');
  new.einvoice_data_snapshot:=null;
  if new.einvoice_data_required and new.status<>'draft' then raise exception 'Create the UAE invoice as a draft, then issue it after completing its required data';end if;
 else
  new.einvoice_data_required:=old.einvoice_data_required or ((new.workspace_id<>old.workspace_id or new.document_type<>old.document_type) and coalesce(ae,false) and new.document_type in('invoice','credit_note'));
  new.einvoice_data_snapshot:=old.einvoice_data_snapshot;
  if old.einvoice_data_snapshot is not null and old.status<>'draft' then
   if new.status in('draft','void') or (to_jsonb(new)-array['status','amount_paid','sent_at','updated_at','correction_pending_resend','revision_number']) is distinct from (to_jsonb(old)-array['status','amount_paid','sent_at','updated_at','correction_pending_resend','revision_number']) then raise exception 'Issued UAE invoice data is frozen; create a linked credit note to correct it';end if;
  end if;
  if coalesce(ae,false) and new.einvoice_data_required and old.status='draft' and new.status<>'draft' and new.status<>'void' then
   if (to_jsonb(new)-array['document_number','issuer_snapshot','customer_snapshot','bank_snapshot','status','issued_at','sent_at','updated_at','einvoice_data_snapshot']) is distinct from (to_jsonb(old)-array['document_number','issuer_snapshot','customer_snapshot','bank_snapshot','status','issued_at','sent_at','updated_at','einvoice_data_snapshot']) then raise exception 'Save invoice changes before issuing so the required data can be checked';end if;
   result:=public.einvoice_issue_readiness(old.id);
   if not (result->>'ready')::boolean then
    select string_agg(value->>'message',' ') into messages from jsonb_array_elements(result->'findings');
    raise exception 'Complete UAE invoice details before issuing: %',messages;
   end if;
   if nullif(new.document_number,'') is null or new.issuer_snapshot is null or new.customer_snapshot is null then raise exception 'Issue this invoice through the standard issuance action to freeze its identity';end if;
   new.einvoice_data_snapshot:=jsonb_build_object('version','ae-2027-v1','checked_at',now(),'provider_validated',false,'metadata',(select to_jsonb(m) from public.einvoice_document_metadata m where m.document_id=old.id));
  end if;
 end if;
 return new;
end $$;
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
  if v_profile.address_line_1 is null or v_profile.city is null or coalesce(v_profile.vat_number,v_profile.uid_number,v_profile.tax_identification_number,v_profile.corporate_tax_number) is null then raise exception 'Complete company address and tax credentials before issuing'; end if;
  select * into v_customer from public.counterparties where id=v_doc.customer_id and workspace_id=v_doc.workspace_id;
  if not found then raise exception 'Customer not found in this company'; end if;
  select * into v_bank from public.company_bank_accounts where workspace_id=v_doc.workspace_id and is_active order by is_default desc,created_at limit 1;
  update public.sales_documents set document_number=coalesce(document_number,public.next_document_number(v_doc.workspace_id,v_doc.document_type,v_doc.issue_date)),issuer_snapshot=case when v_doc.document_type='credit_note' and v_doc.issuer_snapshot is not null then v_doc.issuer_snapshot else jsonb_build_object('legal_name',(select legal_name from public.workspaces where id=v_doc.workspace_id),'profile',to_jsonb(v_profile),'einvoice_settings',(select to_jsonb(es) from public.einvoice_settings es where es.workspace_id=v_doc.workspace_id)) end,customer_snapshot=case when v_doc.document_type='credit_note' and v_doc.customer_snapshot is not null then v_doc.customer_snapshot else to_jsonb(v_customer) end,bank_snapshot=case when v_bank.id is null then null else to_jsonb(v_bank) end,status='sent',issued_at=now(),sent_at=now(),updated_at=now() where id=p_document_id;
  insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details) values(v_doc.workspace_id,v_doc.document_type,p_document_id,'issued',auth.uid(),jsonb_build_object('snapshot_frozen',true));
end $$;


create or replace function public.einvoice_preparation_context(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype; result jsonb;
begin
 select * into d from public.sales_documents where id=p_document_id;
 if not found or auth.uid() is null or not coalesce(public.is_workspace_member(d.workspace_id),false) then raise exception 'Not authorized'; end if;
 select jsonb_build_object(
  'workspace',to_jsonb(w),'profile',coalesce(to_jsonb(p),'{}'),'settings',coalesce(to_jsonb(s),'{"mode":"preparation"}'),
  'document',to_jsonb(d),'customer',coalesce(to_jsonb(c),'{}'),
  'metadata',case when d.einvoice_data_snapshot is not null and d.status<>'draft' then coalesce(d.einvoice_data_snapshot->'metadata','{}') else coalesce((select to_jsonb(m) from public.einvoice_document_metadata m where m.document_id=d.id),'{}') end,
  'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('vat_code',to_jsonb(v)) order by l.line_no) from public.sales_document_lines l left join public.vat_codes v on v.id=l.vat_code_id and v.workspace_id=d.workspace_id where l.document_id=d.id and l.workspace_id=d.workspace_id),'[]'),
  'preceding',(select jsonb_build_object('id',original.id,'document_number',original.document_number,'workspace_id',original.workspace_id) from public.sales_document_links link join public.sales_documents original on original.id=link.source_document_id and original.workspace_id=d.workspace_id where link.target_document_id=d.id and link.workspace_id=d.workspace_id and link.link_type='invoice_to_credit_note' limit 1)
 ) into result from public.workspaces w left join public.company_legal_profiles p on p.workspace_id=w.id left join public.einvoice_settings s on s.workspace_id=w.id left join public.counterparties c on c.id=d.customer_id and c.workspace_id=w.id where w.id=d.workspace_id;
 return result;
end $$;
create trigger require_new_uae_invoice_data before insert or update on public.sales_documents for each row execute function public.guard_new_uae_invoice_data();
create function public.guard_frozen_uae_invoice_lines() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_OP<>'INSERT' and exists(select 1 from public.sales_documents where id=old.document_id and einvoice_data_snapshot is not null) then raise exception 'Issued UAE invoice lines are frozen; create a linked credit note';end if;
 if TG_OP<>'DELETE' and exists(select 1 from public.sales_documents where id=new.document_id and einvoice_data_snapshot is not null) then raise exception 'Issued UAE invoice lines are frozen; create a linked credit note';end if;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
create trigger freeze_new_uae_invoice_lines before insert or update or delete on public.sales_document_lines for each row execute function public.guard_frozen_uae_invoice_lines();
create function public.guard_frozen_uae_invoice_metadata() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_OP<>'INSERT' and exists(select 1 from public.sales_documents where id=old.document_id and einvoice_data_snapshot is not null) then raise exception 'Issued UAE invoice metadata is frozen; create a linked credit note';end if;
 if TG_OP<>'DELETE' and exists(select 1 from public.sales_documents where id=new.document_id and einvoice_data_snapshot is not null) then raise exception 'Issued UAE invoice metadata is frozen; create a linked credit note';end if;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
create trigger freeze_new_uae_invoice_metadata before insert or update or delete on public.einvoice_document_metadata for each row execute function public.guard_frozen_uae_invoice_metadata();
revoke all on function public.check_uae_invoice_data(jsonb),public.einvoice_issue_readiness(uuid),public.guard_new_uae_invoice_data() from public,anon;
grant execute on function public.einvoice_issue_readiness(uuid) to authenticated;
commit;
