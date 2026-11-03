-- Adds scenario data without rewriting historical invoices or activating transmission.
begin;
alter table public.einvoice_document_metadata add column details jsonb not null default '{}' check(jsonb_typeof(details)='object');
alter table public.docflow_connections add column vat_registered boolean not null default true;
alter table public.docflow_connections alter column vat_trn drop not null;
alter table public.docflow_connections add constraint docflow_connection_vat_identity check((vat_registered and vat_trn is not null and vat_trn ~ '^[0-9]{15}$') or (not vat_registered and vat_trn is null));
create function public.check_uae_invoice_conditions(c jsonb) returns jsonb language plpgsql immutable set search_path=public as $$
declare m jsonb:=coalesce(c->'metadata','{}');x jsonb:=coalesce(c#>'{metadata,details}','{}');flags text:=coalesce(c#>>'{metadata,transaction_type}','');f jsonb:='[]';key text;credit boolean:=c#>>'{document,document_type}'='credit_note';
begin
 if flags ~ '^[01]{8}$' then
  if substring(flags,2,3) like '%1%' or substring(flags,6,1)='1' then f:=f||jsonb_build_object('field','transaction_type','message','Deemed supply, margin schemes, summary invoices and agent billing need a separate supported workflow.');end if;
  if left(flags,1)='1' and coalesce(x->>'beneficiary_id','')!~'^([0-9]{10}|[0-9]{15})$' then f:=f||jsonb_build_object('field','beneficiary_id','message','Enter the free-zone beneficiary TIN or TRN.');end if;
  if substring(flags,5,1)='1' then
   if coalesce(x->>'billing_frequency','') not in('DLY','WKY','Q15','MTH','Q45','Q60','QTR','YRL','HYR','OTH') then f:=f||jsonb_build_object('field','billing_frequency','message','Choose a continuous-supply billing frequency.');end if;
   if nullif(x->>'period_start','') is null or nullif(x->>'period_end','') is null then f:=f||jsonb_build_object('field','invoice_period','message','Enter the continuous-supply period start and end.');end if;
   if x->>'billing_frequency'='OTH' and nullif(trim(x->>'note'),'') is null then f:=f||jsonb_build_object('field','note','message','Explain the other billing frequency.');end if;
  end if;
  if substring(flags,7,1)='1' or right(flags,1)='1' then
   foreach key in array array['line1','city','countrySubdivision','countryCode'] loop if nullif(trim(x#>>array['delivery',key]),'') is null then f:=f||jsonb_build_object('field','delivery.'||key,'message','Complete the delivery street, city, region and country for export or e-commerce.');end if;end loop;
  end if;
 end if;
 if nullif(x->>'period_start','') is not null or nullif(x->>'period_end','') is not null then
  if nullif(x->>'period_start','') is null or nullif(x->>'period_end','') is null or (x->>'period_end')::date<(x->>'period_start')::date then f:=f||jsonb_build_object('field','invoice_period','message','Enter a valid supply period.');end if;
 end if;
 if nullif(x->>'tax_point_date','') is not null and (credit or (x->>'tax_point_date')::date>=(c#>>'{document,issue_date}')::date) then f:=f||jsonb_build_object('field','tax_point_date','message','The separate VAT point date must precede issue and cannot appear on a credit note.');end if;
 if coalesce(x->'delivery','{}')<>'{}'::jsonb and coalesce(x#>>'{delivery,countryCode}','')!~'^[A-Z]{2}$' then f:=f||jsonb_build_object('field','delivery.countryCode','message','Enter a two-letter delivery country code.');end if;
 if credit and coalesce(x->>'credit_reason_code','') not in('DL8.61.1.A','DL8.61.1.B','DL8.61.1.C','DL8.61.1.D','DL8.61.1.E') then f:=f||jsonb_build_object('field','credit_reason_code','message','Choose the legal reason for this linked credit note.');end if;
 if m->>'payment_means' in('54','55') and coalesce(x->>'card_last_digits','')!~'^[0-9]{4,6}$' then f:=f||jsonb_build_object('field','card_last_digits','message','Store only the final four to six card digits.');end if;
 if m->>'payment_means'='49' and nullif(trim(x->>'mandate_reference'),'') is null then f:=f||jsonb_build_object('field','mandate_reference','message','Enter the direct-debit mandate reference.');end if;
 return f;
end $$;
create or replace function public.check_uae_invoice_data(c jsonb) returns jsonb language plpgsql immutable set search_path=public as $$
declare w jsonb:=c->'workspace';p jsonb:=c->'profile';s jsonb:=c->'settings';d jsonb:=c->'document';b jsonb:=c->'customer';m jsonb:=coalesce(c->'metadata','{}');bp jsonb;f jsonb:='[]';l jsonb;v jsonb;meta jsonb;key text;label text;country text;unit text;category text;net numeric:=0;tax numeric:=0;gross numeric:=0;n numeric;t numeric;g numeric;qty numeric;price numeric;discount numeric;rate numeric;idx integer:=0;bank jsonb;vat_status text;
begin
 if w->>'country'<>'AE' then return f;end if;
 vat_status:=coalesce(s->>'vat_status','unconfirmed');
 if vat_status not in('registered','not_registered') then f:=f||jsonb_build_object('field','company.vat_status','message','Confirm the company VAT status in E-invoicing.');end if;
 if coalesce(s->>'tin','')!~'^1[0-9]{9}$' then f:=f||jsonb_build_object('field','company.tin','message','Complete the company 10-digit TIN in E-invoicing.');end if;
 foreach key in array array['legal_name'] loop if nullif(trim(w->>key),'') is null then f:=f||jsonb_build_object('field','company.'||key,'message','Complete the company registered name.');end if;end loop;
 foreach key in array array['address_line_1','city','state_region'] loop if nullif(trim(p->>key),'') is null then f:=f||jsonb_build_object('field','company.'||key,'message','Complete company '||replace(key,'_',' ')||' in Company credentials.');end if;end loop;
 if coalesce(s->>'registration_type','TL')='TL' then
  foreach key in array array['trade_licence_number','licensing_authority'] loop if nullif(trim(p->>key),'') is null then f:=f||jsonb_build_object('field','company.'||key,'message','Complete company '||replace(key,'_',' ')||' in Company credentials.');end if;end loop;
 else f:=f||jsonb_build_object('field','company.registration_type','message','This registration type needs its additional identity fields and provider review before issuance.');end if;
 if vat_status='registered' and coalesce(p->>'vat_number','')!~'^1[0-9]{12}03$' then f:=f||jsonb_build_object('field','company.vat_number','message','Complete the company VAT TRN.');end if;
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
  if bp->>'routing'='uae_fallback' then
   if nullif(trim(b->>'vat_trn'),'') is null and nullif(trim(bp->>'registration_number'),'') is null then f:=f||jsonb_build_object('field','customer.identity','message','Provide VAT or legal registration identity for the buyer not yet on e-invoicing.');end if;
  else
  if coalesce(bp->>'tin','')!~'^1[0-9]{9}$' then f:=f||jsonb_build_object('field','customer.tin','message','Complete the UAE customer TIN.');end if;
  if bp->>'scheme' is distinct from '0235' or bp->>'electronic_address' is distinct from bp->>'tin' then f:=f||jsonb_build_object('field','customer.endpoint','message','Confirm the UAE customer electronic address using its TIN and scheme 0235.');end if;
  end if;
 elsif country ~ '^[A-Z]{2}$' then
  if coalesce(bp->>'routing','')='peppol' then
   if nullif(bp->>'electronic_address','') is null or nullif(bp->>'scheme','') is null then f:=f||jsonb_build_object('field','customer.endpoint','message','Complete the foreign customer Peppol address and scheme.');end if;
  elsif coalesce(bp->>'routing','')<>'export_fallback' then f:=f||jsonb_build_object('field','customer.routing','message','Confirm whether the foreign customer receives Peppol invoices, or requires the export fallback route.');end if;
 end if;
 if nullif(b->>'vat_trn','') is not null and country='AE' and coalesce(b->>'vat_trn','')!~'^1[0-9]{12}03$' then f:=f||jsonb_build_object('field','customer.vat_trn','message','Complete the buyer VAT identity, or use the separately reviewed non-VAT buyer route.');end if;
 if nullif(m->>'supply_date','') is null then f:=f||jsonb_build_object('field','supply_date','message','Enter an exact supply date for the invoice.');end if;
 if d->>'document_type'='invoice' and nullif(d->>'due_date','') is null then f:=f||jsonb_build_object('field','due_date','message','Enter the payment due date.');end if;
 if coalesce(d->>'currency','')!~'^[A-Z]{3}$' then f:=f||jsonb_build_object('field','currency','message','Choose a three-letter invoice currency.');end if;
 if d->>'currency'<>'AED' and (nullif(m->>'exchange_rate','') is null or coalesce((m->>'exchange_rate')::numeric,0)<=0) then f:=f||jsonb_build_object('field','exchange_rate','message','Enter the verified exchange rate to AED.');end if;
 if coalesce(m->>'transaction_type','')!~'^[01]{8}$' then f:=f||jsonb_build_object('field','transaction_type','message','Confirm the invoice transaction scenario.');end if;
 if country<>'AE' and coalesce(m->>'transaction_type','')~'^[01]{8}$' and right(m->>'transaction_type',1)<>'1' then f:=f||jsonb_build_object('field','transaction_type','message','Confirm the export flag for this foreign buyer.');end if;
 if nullif(trim(m->>'buyer_reference'),'') is null and nullif(trim(m->>'purchase_order'),'') is null then f:=f||jsonb_build_object('field','buyer_reference','message','Enter the buyer routing reference or the customer purchase-order number.');end if;
 if coalesce(m->>'payment_means','') not in('10','30','49','54','55','68') then f:=f||jsonb_build_object('field','payment_means','message','Choose a supported payment method.');end if;
 if coalesce(m->>'payment_means','') in('30') then
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
  if discount<0 or discount>100 or qty=0 or price<0 or n+t<>g or abs(n)<>round(abs(qty)*price*(1-discount/100),2) or abs(t)<>round(abs(n)*rate,2) then f:=f||jsonb_build_object('field','lines.'||idx||'.amounts','message',label||'quantity, price, discount and rounded tax amounts must reconcile.');end if;
  if vat_status='not_registered' then
   if rate<>0 or t<>0 then f:=f||jsonb_build_object('field','lines.'||idx||'.vat','message',label||'a non-VAT-registered seller cannot charge VAT.');end if;
  else
   category:=coalesce(nullif(meta->>'tax_category',''),v->>'category');
   if coalesce(category,'') not in('standard','zero','exempt','out_of_scope') then f:=f||jsonb_build_object('field','lines.'||idx||'.tax_category','message',label||'confirm the VAT category; a zero rate alone is not sufficient.');end if;
   if category='standard' and rate<>0.05 then f:=f||jsonb_build_object('field','lines.'||idx||'.rate','message',label||'the standard UAE VAT rate must be 5%.');end if;
   if category in('zero','exempt','out_of_scope') and (rate<>0 or nullif(trim(meta->>'tax_reason'),'') is null) then f:=f||jsonb_build_object('field','lines.'||idx||'.tax_reason','message',label||'record the zero-VAT treatment and its reason.');end if;
   if category='exempt' and coalesce(meta->>'tax_reason_code','') not in('DL8.46.1','DL8.46.2','DL8.46.3','DL8.46.4') then f:=f||jsonb_build_object('field','lines.'||idx||'.tax_reason_code','message',label||'record the exemption code.');end if;
  end if;
  net:=net+n;tax:=tax+t;gross:=gross+g;
 end loop;
 if net is distinct from (d->>'subtotal')::numeric or tax is distinct from (d->>'tax_total')::numeric or gross is distinct from (d->>'total')::numeric then f:=f||jsonb_build_object('field','totals','message','Invoice totals must reconcile with the rounded line amounts.');end if;
 if d->>'document_type'='credit_note' and (nullif(m->>'credit_reason','') is null or c->'preceding' is null or c->'preceding'='null'::jsonb) then f:=f||jsonb_build_object('field','credit_reason','message','Record the credit reason and reference the original invoice.');end if;

 if d->>'currency'<>'AED' and nullif(m->>'exchange_rate','') is not null and (m->>'exchange_rate')::numeric<>round((m->>'exchange_rate')::numeric,6) then f:=f||jsonb_build_object('field','exchange_rate','message','Docflow accepts exchange rates with at most six decimal places.');end if;
 if country='AE' and upper(trim(b->>'state')) not in('DXB','DUBAI','AUH','ABU DHABI','SHJ','SHARJAH','AJM','AJMAN','RAK','RAS AL KHAIMAH','FUJ','FUJAIRAH','UAQ','UMM AL QUWAIN') then f:=f||jsonb_build_object('field','customer.state','message','Choose a recognized customer emirate.');end if;
 if upper(trim(p->>'state_region')) not in('DXB','DUBAI','AUH','ABU DHABI','SHJ','SHARJAH','AJM','AJMAN','RAK','RAS AL KHAIMAH','FUJ','FUJAIRAH','UAQ','UMM AL QUWAIN') then f:=f||jsonb_build_object('field','company.state_region','message','Choose a recognized company emirate.');end if;
 if vat_status='not_registered' or nullif(bp->>'registration_number','') is not null then
  if country='AE' and coalesce(bp->>'registration_type','') not in('TL','EID','PAS','CD') then f:=f||jsonb_build_object('field','customer.registration_type','message','Choose the UAE buyer legal registration type.');end if;
  if bp->>'registration_type'='TL' and nullif(trim(bp->>'registration_authority'),'') is null then f:=f||jsonb_build_object('field','customer.registration_authority','message','Enter the buyer trade licence issuing authority.');end if;
  if bp->>'registration_type'='PAS' and coalesce(bp->>'passport_country','')!~'^[A-Z]{2}$' then f:=f||jsonb_build_object('field','customer.passport_country','message','Enter the passport issuing country code.');end if;
 end if;
 f:=f||public.check_uae_invoice_conditions(c);
 return f;
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
 if jsonb_typeof(coalesce(p_metadata->'details','{}'))<>'object' then raise exception 'Invoice details must be an object';end if;
 insert into public.einvoice_document_metadata(document_id,workspace_id,buyer,supply_date,payment_means,transaction_type,exchange_rate,credit_reason,lines,buyer_reference,purchase_order,details,updated_by)
 values(d.id,d.workspace_id,coalesce(p_metadata->'buyer','{}'),nullif(p_metadata->>'supply_date','')::date,nullif(p_metadata->>'payment_means',''),nullif(p_metadata->>'transaction_type',''),nullif(p_metadata->>'exchange_rate','')::numeric,nullif(trim(p_metadata->>'credit_reason'),''),coalesce(p_metadata->'lines','{}'),nullif(trim(p_metadata->>'buyer_reference'),''),nullif(trim(p_metadata->>'purchase_order'),''),coalesce(p_metadata->'details','{}'),auth.uid())
 on conflict(document_id) do update set buyer=excluded.buyer,supply_date=excluded.supply_date,payment_means=excluded.payment_means,transaction_type=excluded.transaction_type,exchange_rate=excluded.exchange_rate,credit_reason=excluded.credit_reason,lines=excluded.lines,buyer_reference=excluded.buyer_reference,purchase_order=excluded.purchase_order,details=excluded.details,updated_at=now(),updated_by=auth.uid();
 insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details) values(d.workspace_id,'invoice',d.id,'einvoice_preparation_saved',auth.uid(),'{}');
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
  'preceding',(select jsonb_build_object('id',original.id,'document_number',original.document_number,'workspace_id',original.workspace_id,'issue_date',original.issue_date) from public.sales_document_links link join public.sales_documents original on original.id=link.source_document_id and original.workspace_id=d.workspace_id where link.target_document_id=d.id and link.workspace_id=d.workspace_id and link.link_type='invoice_to_credit_note' limit 1)
 ) into result from public.workspaces w left join public.company_legal_profiles p on p.workspace_id=w.id left join public.einvoice_settings s on s.workspace_id=w.id left join public.counterparties c on c.id=d.customer_id and c.workspace_id=w.id where w.id=d.workspace_id;
 return result;
end $$;
revoke all on function public.check_uae_invoice_conditions(jsonb) from public,anon;
grant execute on function public.check_uae_invoice_conditions(jsonb) to authenticated,service_role;
notify pgrst, 'reload schema';
commit;
