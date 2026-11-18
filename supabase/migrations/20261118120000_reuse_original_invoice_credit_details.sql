begin;

create function public.normalize_invoice_country(p_country text)
returns text language sql immutable set search_path=public as $$
  select case upper(trim(coalesce(p_country,'')))
    when 'AUSTRIA' then 'AT' when 'ÖSTERREICH' then 'AT'
    when 'UNITED ARAB EMIRATES' then 'AE' when 'UAE' then 'AE'
    else upper(trim(coalesce(p_country,''))) end
$$;

create or replace function public.check_uae_invoice_conditions(c jsonb) returns jsonb language plpgsql immutable set search_path=public as $$
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
 if coalesce(x->'delivery','{}')<>'{}'::jsonb and public.normalize_invoice_country(x#>>'{delivery,countryCode}')!~'^[A-Z]{2}$' then f:=f||jsonb_build_object('field','delivery.countryCode','message','Enter a two-letter delivery country code.');end if;
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
 country:=public.normalize_invoice_country(coalesce(nullif(trim(bp->>'country'),''),b->>'country'));
 if country!~'^[A-Z]{2}$' then f:=f||jsonb_build_object('field','customer.country','message','Use a two-letter buyer country code, such as AE or AT.');end if;
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
  if discount<0 or discount>100 or qty=0 or price<0 or n+t<>g or n<>round(qty*price*(1-discount/100),2) or t<>round(n*rate,2) then f:=f||jsonb_build_object('field','lines.'||idx||'.amounts','message',label||'quantity, price, discount and rounded tax amounts must reconcile.');end if;
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

create function public.prepare_linked_credit_note(p_document_id uuid, p_reason_code text, p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare
  credit public.sales_documents%rowtype;
  original public.sales_documents%rowtype;
  source jsonb;
  saved jsonb;
  copied_lines jsonb;
begin
  select * into credit from public.sales_documents
  where id=p_document_id and document_type='credit_note' and status='draft' for update;
  if not found then raise exception 'Credit note draft not found'; end if;
  if auth.uid() is null or not coalesce(public.can_write(credit.workspace_id),false) then raise exception 'Not authorized'; end if;
  if not credit.einvoice_data_required then return; end if;
  if p_reason_code is null or p_reason_code not in ('DL8.61.1.A','DL8.61.1.B','DL8.61.1.C','DL8.61.1.D','DL8.61.1.E') or nullif(trim(p_reason),'') is null then
    raise exception 'Choose a reason and enter a short explanation for the credit note';
  end if;

  select invoice.* into strict original from public.sales_document_links link
  join public.sales_documents invoice on invoice.id=link.source_document_id and invoice.workspace_id=link.workspace_id
  where link.target_document_id=credit.id and link.workspace_id=credit.workspace_id
    and link.link_type='invoice_to_credit_note' and invoice.document_type='invoice' and invoice.customer_id=credit.customer_id
    and invoice.status not in ('draft','void');
  source:=coalesce(original.einvoice_data_snapshot->'metadata',
    (select to_jsonb(m) from public.einvoice_document_metadata m where m.document_id=original.id),'{}');
  saved:=coalesce((select to_jsonb(m) from public.einvoice_document_metadata m where m.document_id=credit.id),'{}');

  -- Old invoices may contain empty placeholder rows that cannot be sent as fiscal lines.
  delete from public.sales_document_lines
  where document_id=credit.id and workspace_id=credit.workspace_id
    and quantity=0 and net_amount=0 and vat_amount=0 and gross_amount=0;

  select coalesce(jsonb_object_agg(target.id::text, source#>array['lines',prior.id::text]),'{}')
    into copied_lines
  from public.sales_document_lines target
  join public.sales_document_lines prior on prior.document_id=original.id
    and prior.workspace_id=credit.workspace_id and prior.line_no=target.line_no
  where target.document_id=credit.id and target.workspace_id=credit.workspace_id
    and source#>array['lines',prior.id::text] is not null;

  perform public.save_einvoice_metadata(credit.id,
    jsonb_strip_nulls(source) || jsonb_strip_nulls(saved) || jsonb_build_object(
      'buyer',coalesce(source->'buyer','{}')||coalesce(saved->'buyer','{}'),
      'lines',copied_lines||coalesce(saved->'lines','{}'),
      'details',((coalesce(source->'details','{}')||coalesce(saved->'details','{}'))-'tax_point_date')
        ||jsonb_build_object(
          'credit_reason_code',p_reason_code,
          'delivery',coalesce(source#>'{details,delivery}','{}') ||
            coalesce((select jsonb_object_agg(key,value) from jsonb_each_text(coalesce(saved#>'{details,delivery}','{}'))
              where nullif(trim(value),'') is not null),'{}')
        ),
      'credit_reason',trim(p_reason)
    )
  );
  update public.sales_documents set header_text=coalesce(nullif(header_text,''),
    'Credits invoice '||original.document_number||' dated '||original.issue_date::text)
  where id=credit.id;
end $$;
revoke all on function public.prepare_linked_credit_note(uuid,text,text) from public,anon;
grant execute on function public.prepare_linked_credit_note(uuid,text,text) to authenticated;
create or replace function public.duplicate_invoice_as_draft(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.sales_documents%rowtype;v_new uuid;v_term integer; source jsonb; copied_lines jsonb;
begin
 select*into d from public.sales_documents where id=p_invoice_id and document_type='invoice';
 if d.id is null then raise exception'Invoice not found';end if;
 if auth.uid() is null or not coalesce(public.can_write(d.workspace_id),false)then raise exception'Not authorized';end if;
 v_term:=case when d.due_date is not null then greatest(d.due_date-d.issue_date,0)else 14 end;
 insert into public.sales_documents(workspace_id,document_type,document_number,customer_id,template_id,issue_date,due_date,currency,status,
  customer_reference,header_text,introduction,notes,terms_text,subtotal,tax_total,total,amount_paid,created_by)
 values(d.workspace_id,'invoice',null,d.customer_id,d.template_id,current_date,current_date+v_term,d.currency,'draft',
  d.customer_reference,d.header_text,d.introduction,null,d.terms_text,d.subtotal,d.tax_total,d.total,0,auth.uid())returning id into v_new;
 insert into public.sales_document_lines(workspace_id,document_id,line_no,product_service_id,description,quantity,unit,unit_price,
  discount_percent,vat_code_id,vat_rate,net_amount,vat_amount,gross_amount,revenue_account_id,deduction_invoice_id)
 select workspace_id,v_new,line_no,product_service_id,description,quantity,unit,unit_price,discount_percent,vat_code_id,vat_rate,
  net_amount,vat_amount,gross_amount,revenue_account_id,deduction_invoice_id from public.sales_document_lines where document_id=d.id order by line_no;
 if exists(select 1 from public.workspaces where id=d.workspace_id and country='AE') then
   source:=coalesce(d.einvoice_data_snapshot->'metadata',
     (select to_jsonb(m) from public.einvoice_document_metadata m where m.document_id=d.id),'{}');
   select coalesce(jsonb_object_agg(target.id::text,source#>array['lines',prior.id::text]),'{}')
     into copied_lines
   from public.sales_document_lines target join public.sales_document_lines prior
     on prior.document_id=d.id and prior.workspace_id=d.workspace_id and prior.line_no=target.line_no
   where target.document_id=v_new and source#>array['lines',prior.id::text] is not null;
   perform public.save_einvoice_metadata(v_new,
     (source - array['supply_date','exchange_rate','credit_reason']) || jsonb_build_object(
       'lines',copied_lines,
       'details',coalesce(source->'details','{}') - array['tax_point_date','period_start','period_end','card_last_digits','mandate_reference']
     )
   );
 end if;
 insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)
 values(d.workspace_id,'invoice',v_new,'duplicated_as_draft',auth.uid(),jsonb_build_object('source_invoice_id',d.id,'source_invoice_number',d.document_number));
 return v_new;
end $$;

revoke all on function public.duplicate_invoice_as_draft(uuid) from public,anon;
grant execute on function public.duplicate_invoice_as_draft(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
