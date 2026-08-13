-- Import authoritative Nikolaus Skene 2026 invoices 10084 and 10086.
-- Both are paid Austrian domestic sales at 20% VAT.
-- The PDF conflicts on IBAN (AT30... vs AT90...), so existing Supabase bank data is retained.
begin;

do $$
declare
 v_ws constant uuid:='d621017c-e9bd-4334-a07f-5e7b6d31ef6e';
 v_customer uuid;v_revenue uuid;v_vat uuid;v_doc uuid;v_profile jsonb;v_bank jsonb;
 i record;l record;v_line integer;
begin
 if not exists(select 1 from public.workspaces where id=v_ws and country='AT')then
  raise exception'Exact Austrian workspace not found';end if;
 if exists(select 1 from public.sales_documents where workspace_id=v_ws and document_type='invoice'and document_number in('10084','10086'))then
  raise exception'Invoice 10084 or 10086 already exists; import stopped';end if;

 select id into v_revenue from public.accounts where workspace_id=v_ws and code='4000'and type='income'and is_active limit 1;
 if v_revenue is null then raise exception'Active Austrian revenue account 4000 is missing';end if;
 select id into v_vat from public.vat_codes where workspace_id=v_ws and code='AT-U20'and vat_rate=.20 limit 1;
 if v_vat is null then raise exception'Austrian sales VAT code AT-U20 at 20%% is missing';end if;

 select id into v_customer from public.counterparties where workspace_id=v_ws and(
  upper(regexp_replace(coalesce(vat_trn,''),'\s+','','g'))='ATU14704505'or lower(trim(coalesce(company_name,'')))='evn ag')
 order by case when upper(regexp_replace(coalesce(vat_trn,''),'\s+','','g'))='ATU14704505'then 0 else 1 end,created_at limit 1;
 if v_customer is null then
  insert into public.counterparties(workspace_id,kind,company_name,alias,street_address,zip,city,country,vat_trn)
  values(v_ws,'customer','EVN AG','EVN AG','EVN Platz','2344','Maria Enzersdorf','Austria','ATU14704505')returning id into v_customer;
 else
  update public.counterparties set kind=case when kind='vendor'then'both'else coalesce(kind,'customer')end,
   company_name='EVN AG',alias=coalesce(nullif(alias,''),'EVN AG'),street_address=coalesce(nullif(street_address,''),'EVN Platz'),
   zip=coalesce(nullif(zip,''),'2344'),city=coalesce(nullif(city,''),'Maria Enzersdorf'),country=coalesce(nullif(country,''),'Austria'),
   vat_trn=coalesce(nullif(vat_trn,''),'ATU14704505')where id=v_customer;
 end if;

 select jsonb_build_object('legal_name',w.legal_name,'profile',to_jsonb(p))into v_profile from public.workspaces w
 left join public.company_legal_profiles p on p.workspace_id=w.id where w.id=v_ws;
 select to_jsonb(b)into v_bank from public.company_bank_accounts b where b.workspace_id=v_ws and b.is_active
 order by b.is_default desc,b.created_at limit 1;

 for i in select*from jsonb_to_recordset($invoices$[
  {"number":"10084","page":1,"issue_date":"2026-05-18","due_date":"2026-05-18","customer_reference":"4590007301","total":5280,"lines":[
   {"description":"Coaching/Pitchtraining - Speakercoaching 3 Teams, 2 Sessions pro Team","quantity":6,"unit_price":600,"net":3600,"vat":720,"gross":4320},
   {"description":"EXO-ONE Lifetime Membership - Speakercoaching Wanda Rossi","quantity":2,"unit_price":400,"net":800,"vat":160,"gross":960}]},
  {"number":"10086","page":2,"issue_date":"2026-07-01","due_date":"2026-07-01","customer_reference":"4590008847","total":8400,"lines":[
   {"description":"Coaching/Pitchtraining - Pitchtraining während der Hackathon-Woche","quantity":0.5,"unit_price":14000,"net":7000,"vat":1400,"gross":8400}]}
 ]$invoices$::jsonb)as x(number text,page integer,issue_date date,due_date date,customer_reference text,total numeric,lines jsonb)
 order by number::integer loop
  insert into public.sales_documents(workspace_id,document_type,document_number,customer_id,template_id,issue_date,due_date,currency,status,
   customer_reference,header_text,terms_text,notes,subtotal,tax_total,total,amount_paid,issuer_snapshot,customer_snapshot,bank_snapshot,
   issued_at,sent_at,created_by,created_at,updated_at)
  values(v_ws,'invoice',i.number,v_customer,(select id from public.document_templates where workspace_id=v_ws and document_type='invoice'and is_default order by updated_at desc limit 1),
   i.issue_date,i.due_date,'EUR','paid',i.customer_reference,'Ihre Bestellnummer: '||i.customer_reference,'Due on receipt',
   format('Imported from authoritative PDF page %s on 2026-08-13. PDF confirms paid status; payment date not supplied. Source PDF contains conflicting IBANs, so existing Supabase bank data was retained.',i.page),
   (select sum((value->>'net')::numeric)from jsonb_array_elements(i.lines)),(select sum((value->>'vat')::numeric)from jsonb_array_elements(i.lines)),
   i.total,i.total,v_profile,(select to_jsonb(c)from public.counterparties c where c.id=v_customer),v_bank,
   i.issue_date::timestamptz,i.issue_date::timestamptz,auth.uid(),i.issue_date::timestamptz,now())returning id into v_doc;
  v_line:=0;
  for l in select*from jsonb_to_recordset(i.lines)as z(description text,quantity numeric,unit_price numeric,net numeric,vat numeric,gross numeric)loop
   v_line:=v_line+1;
   insert into public.sales_document_lines(workspace_id,document_id,line_no,description,quantity,unit,unit_price,discount_percent,
    vat_code_id,vat_rate,net_amount,vat_amount,gross_amount,revenue_account_id)
   values(v_ws,v_doc,v_line,l.description,l.quantity,'each',l.unit_price,0,v_vat,.20,l.net,l.vat,l.gross,v_revenue);
  end loop;
  if abs((select coalesce(sum(gross_amount),0)from public.sales_document_lines where document_id=v_doc)-i.total)>.01 then
   raise exception'Invoice % line total does not reconcile',i.number;end if;
  insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)
  values(v_ws,'invoice',v_doc,'import_from_authoritative_pdf',auth.uid(),jsonb_build_object('invoice_number',i.number,'pdf_page',i.page,'status','paid'));
 end loop;
end$$;

insert into public.document_sequences(workspace_id,document_type,fiscal_year,prefix,next_number,padding,include_fiscal_year)
values('d621017c-e9bd-4334-a07f-5e7b6d31ef6e','invoice',2026,'',10087,5,false)
on conflict(workspace_id,document_type,fiscal_year)do update set prefix='',next_number=greatest(public.document_sequences.next_number,10087),padding=5,include_fiscal_year=false;
commit;

select jsonb_build_object(
 'workspace',(select legal_name from public.workspaces where id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'),
 'invoices',(select count(*)from public.sales_documents where workspace_id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'and document_type='invoice'and document_number in('10084','10086')),
 'paid',(select count(*)from public.sales_documents where workspace_id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'and document_number in('10084','10086')and status='paid'),
 'lines',(select count(*)from public.sales_document_lines l join public.sales_documents d on d.id=l.document_id where d.workspace_id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'and d.document_number in('10084','10086')),
 'net_total',(select sum(subtotal)from public.sales_documents where workspace_id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'and document_number in('10084','10086')),
 'vat_total',(select sum(tax_total)from public.sales_documents where workspace_id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'and document_number in('10084','10086')),
 'gross_total',(select sum(total)from public.sales_documents where workspace_id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'and document_number in('10084','10086')),
 'next_invoice_number',(select prefix||lpad(next_number::text,padding,'0')from public.document_sequences where workspace_id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'and document_type='invoice'and fiscal_year=2026)
)as import_verification;
