-- Import the authoritative 2026 FZCO invoice PDF (32 pages, invoices 1176-1204).
-- Run only after 032_delete_fzco_sales_test_data.sql reports zero documents.
begin;

alter table public.document_sequences
  add column if not exists include_fiscal_year boolean not null default true;

create or replace function public.next_document_number(
  p_workspace_id uuid,p_document_type text,p_issue_date date
) returns text language plpgsql security definer set search_path=public as $$
declare v_sequence public.document_sequences%rowtype;v_result text;
begin
  if not public.can_write(p_workspace_id) then raise exception 'Not authorized';end if;
  if p_document_type not in('quote','invoice','credit_note')then raise exception 'Invalid document type';end if;
  insert into public.document_sequences(workspace_id,document_type,fiscal_year,prefix)
  values(p_workspace_id,p_document_type,extract(year from p_issue_date)::integer,
    case p_document_type when'quote'then'Q-'when'invoice'then'INV-'else'CN-'end)
  on conflict do nothing;
  select*into v_sequence from public.document_sequences where workspace_id=p_workspace_id
    and document_type=p_document_type and fiscal_year=extract(year from p_issue_date)::integer for update;
  v_result:=case when v_sequence.include_fiscal_year
    then v_sequence.prefix||v_sequence.fiscal_year::text||'-'||lpad(v_sequence.next_number::text,v_sequence.padding,'0')
    else v_sequence.prefix||lpad(v_sequence.next_number::text,v_sequence.padding,'0')end;
  update public.document_sequences set next_number=next_number+1 where workspace_id=p_workspace_id
    and document_type=p_document_type and fiscal_year=v_sequence.fiscal_year;
  return v_result;
end$$;
revoke all on function public.next_document_number(uuid,text,date)from public;
grant execute on function public.next_document_number(uuid,text,date)to authenticated;

do $$begin
  if not exists(select 1 from public.workspaces where id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'
    and legal_name='IACy International FZCO'and country='AE')then raise exception'Exact FZCO workspace not found';end if;
  if exists(select 1 from public.sales_documents where workspace_id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'
    and document_type='invoice'and document_number~'^(117[6-9]|11[89][0-9]|120[0-4])$')then
    raise exception'One or more target invoice numbers already exist; import stopped';end if;
end$$;

create temporary table pdf_customers on commit drop as
select*from jsonb_to_recordset($data$[
 {"key":"johann_stan","company_name":"Johann Stan","alias":"Johann Stan"},
 {"key":"asma_aljassmi","company_name":"Asma Aljassmi","alias":"Asma Aljassmi"},
 {"key":"wexelerate","company_name":"weXelerate GmbH","alias":"Mr. Awi Lifshitz","street_address":"Praterstraße 1","zip":"1020","city":"Vienna","country":"Austria","vat_trn":"ATU71593046"},
 {"key":"teleportec","company_name":"Teleportec LLC","alias":"Lene R Andersen"},
 {"key":"in5","company_name":"In5 FZ-LLC","alias":"In5 FZ-LLC","street_address":"Finance Department, Commercial Building 1, 4th Floor, P.O. Box 73000","zip":"00000","city":"Dubai","state":"Dubai Studio City","country":"United Arab Emirates"},
 {"key":"richard_osei","company_name":"Richard Osei-Anim","alias":"Richard Osei-Anim"},
 {"key":"perform_globally","company_name":"PerformGlobally GmbH","alias":"Magdalena Pertgen","street_address":"Hauffstraße 7","zip":"71672","city":"Marbach a.N.","country":"Germany"},
 {"key":"juliane_dietz","company_name":"Juliane Dietz direct impact","alias":"Juliane Dietz","street_address":"Gartenstr 107","zip":"60596","city":"Frankfurt","country":"Germany"},
 {"key":"andreas_jung","company_name":"Andreas Jung","alias":"Andreas Jung","street_address":"Gartenstr 107","zip":"60596","city":"Frankfurt","country":"Germany"},
 {"key":"c9_ventures","company_name":"“C9 Ventures”, a trading name of NORTHBRIGHT CAPITAL LIMITED","alias":"Karima Serageldin","street_address":"101 New Cavendish Street, 1st Floor South","zip":"W1W 6XH","city":"London","country":"United Kingdom"},
 {"key":"red_onion","company_name":"red onion GmbH","alias":"Stephan Balzer","street_address":"Alexanderstrasse 7","zip":"10178","city":"Berlin","country":"Germany","vat_trn":"DE812866010"},
 {"key":"bts","company_name":"BTS Bow Tie Sales Corp","alias":"Damir Buljubasic"},
 {"key":"lx_neumayer","company_name":"LX Neumayer Management e.U.","alias":"Alex Neumayer","street_address":"Ahornstraße 12","zip":"3465","city":"Königsbrunn am Wagram","country":"Austria","vat_trn":"ATU57578213"},
 {"key":"neil_redding","company_name":"Neil Redding","alias":"Neil Redding"},
 {"key":"storsendigital","company_name":"STORSENDIGITAL S.R.O.","alias":"Tarik Altumbabic","street_address":"Dlouha 730/35","zip":"110 000","city":"Praha 1","country":"Czechia","vat_trn":"CZ10696130"}
]$data$::jsonb)as x(key text,company_name text,alias text,street_address text,zip text,city text,state text,country text,vat_trn text);

create temporary table pdf_customer_map(key text primary key,customer_id uuid not null)on commit drop;
do $$declare c record;v_id uuid;v_ws constant uuid:='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9';begin
 for c in select*from pdf_customers loop
  select id into v_id from public.counterparties where workspace_id=v_ws and(
    lower(trim(regexp_replace(coalesce(company_name,''),'\s*\(EUR\)\s*$','','i')))=lower(trim(c.company_name))or
    lower(trim(coalesce(company_name,'')))=lower(trim(c.alias))or
    lower(trim(coalesce(alias,'')))=lower(trim(c.company_name))or
    lower(trim(coalesce(alias,'')))=lower(trim(c.alias)))
    order by(case when lower(trim(coalesce(company_name,'')))=lower(trim(c.company_name))then 0 else 1 end),created_at limit 1;
  if v_id is null then
   insert into public.counterparties(workspace_id,kind,company_name,alias,street_address,zip,city,state,country,vat_trn)
   values(v_ws,'customer',c.company_name,c.alias,c.street_address,c.zip,c.city,c.state,c.country,c.vat_trn)returning id into v_id;
  else
   update public.counterparties set kind=case when kind='vendor'then'both'else coalesce(kind,'customer')end,
    company_name=c.company_name,alias=coalesce(nullif(alias,''),c.alias),
    street_address=coalesce(nullif(street_address,''),c.street_address),zip=coalesce(nullif(zip,''),c.zip),
    city=coalesce(nullif(city,''),c.city),state=coalesce(nullif(state,''),c.state),
    country=coalesce(nullif(country,''),c.country),vat_trn=coalesce(nullif(vat_trn,''),c.vat_trn),updated_at=now()where id=v_id;
  end if;
  insert into pdf_customer_map values(c.key,v_id);
 end loop;
end$$;

create temporary table pdf_invoices on commit drop as
select*from jsonb_to_recordset($invoices$[
 {"number":"1176","page":2,"customer_key":"johann_stan","issue_date":"2026-01-13","due_date":"2026-01-13","currency":"EUR","status":"paid","total":3750,"lines":[{"description":"Silicon Valley Inspiration Tour Aug 17-21, 2026. Participant: Johann Stan. 1st partial payment (50% - rest due in July)","quantity":0.5,"unit_price":7500,"net":3750,"vat":0,"gross":3750,"vat_code":"ZR0"}]},
 {"number":"1177","page":3,"customer_key":"johann_stan","issue_date":"2026-01-15","due_date":"2026-01-15","currency":"EUR","status":"paid","total":4250,"lines":[{"description":"China Inspiration Tour: Shenzhen & Hongkong, March 23-27, 2026. Participant: Johann Stan","quantity":0,"unit_price":8500,"net":0,"vat":0,"gross":0,"vat_code":"ZR0"},{"description":"China Inspiration Tour: Shenzhen & Hongkong, March 23-27, 2026. Participant: Abigél Anna András","quantity":0.5,"unit_price":8500,"net":4250,"vat":0,"gross":4250,"vat_code":"ZR0"}]},
 {"number":"1178","page":28,"customer_key":"asma_aljassmi","issue_date":"2026-01-17","due_date":"2026-02-04","currency":"USD","status":"void","total":0,"lines":[{"description":"VOIDED - China Inspiration Tour: Shenzhen & Hongkong, March 23-27, 2026. Participant: Asma Aljassmi. Planned participation USD 8,500; payment plan 8x1,000 and 1x500.","quantity":0,"unit_price":0,"net":0,"vat":0,"gross":0,"vat_code":"ZR0"}]},
 {"number":"1179","page":4,"customer_key":"wexelerate","issue_date":"2026-01-26","due_date":"2026-01-26","currency":"EUR","status":"paid","total":5500,"lines":[{"description":"Monthly Fee Feb 26","quantity":1,"unit_price":5500,"net":5500,"vat":0,"gross":5500,"vat_code":"ZR0"}]},
 {"number":"1180","page":5,"customer_key":"teleportec","issue_date":"2026-01-29","due_date":"2026-01-29","currency":"USD","status":"paid","total":5000,"lines":[{"description":"Introduction/Tour at Frontier Tower / Zan Lowe","quantity":1,"unit_price":5000,"net":5000,"vat":0,"gross":5000,"vat_code":"OOS"}]},
 {"number":"1181","page":6,"customer_key":"teleportec","issue_date":"2026-02-04","due_date":"2026-02-04","currency":"USD","status":"paid","total":6500,"lines":[{"description":"2 Meetings: Feb 3 (Computer History Museum), Feb 5 (San Francisco)","quantity":2,"unit_price":5000,"net":10000,"vat":0,"gross":10000,"vat_code":"OOS"},{"description":"Special discount","quantity":-1,"unit_price":3500,"net":-3500,"vat":0,"gross":-3500,"vat_code":"OOS"}]},
 {"number":"1182","page":7,"customer_key":"in5","issue_date":"2026-02-09","due_date":"2026-02-09","currency":"AED","status":"paid","total":8400,"header_text":"TEF-PO-00008492 (1)","lines":[{"description":"Speakercoaching - 5 sessions for Mr Saeed Alnofeli","quantity":5,"unit_price":1600,"net":8000,"vat":400,"gross":8400,"vat_code":"SR5"}]},
 {"number":"1183","page":9,"customer_key":"wexelerate","issue_date":"2026-02-19","due_date":"2026-02-19","currency":"EUR","status":"paid","total":5500,"lines":[{"description":"Following the 2025/2026 agreement. March 2026","quantity":1,"unit_price":5500,"net":5500,"vat":0,"gross":5500,"vat_code":"ZR0"}]},
 {"number":"1184","page":30,"customer_key":"richard_osei","issue_date":"2026-02-20","due_date":"2026-03-18","currency":"USD","status":"void","total":0,"lines":[{"description":"VOIDED - Dubai Inspiration Tour Apr 08-10. Participant: Richard Osei-Anim. Planned payment: USD 1,000 Mar 5; USD 1,000 Mar 18; USD 500 Apr 3.","quantity":0,"unit_price":0,"net":0,"vat":0,"gross":0,"vat_code":"SR5"}]},
 {"number":"1185","page":10,"customer_key":"wexelerate","issue_date":"2026-03-19","due_date":"2026-04-01","currency":"EUR","status":"paid","total":5500,"lines":[{"description":"Following the 2025/2026 agreement. April 2026","quantity":1,"unit_price":5500,"net":5500,"vat":0,"gross":5500,"vat_code":"ZR0"}]},
 {"number":"1186","page":11,"customer_key":"perform_globally","issue_date":"2026-04-20","due_date":"2026-04-20","currency":"EUR","status":"paid","total":3500,"lines":[{"description":"China Inspiration Tour: Shenzhen & Hongkong, November 23-27, 2026. Participant: Magdalena Pertgen","quantity":1,"unit_price":3500,"net":3500,"vat":0,"gross":3500,"vat_code":"ZR0"}]},
 {"number":"1187","page":12,"customer_key":"juliane_dietz","issue_date":"2026-04-20","due_date":"2026-04-20","currency":"EUR","status":"paid","total":3500,"lines":[{"description":"China Inspiration Tour: Shenzhen & Hongkong, November 23-27, 2026. Participant: Juliane Dietz","quantity":1,"unit_price":3500,"net":3500,"vat":0,"gross":3500,"vat_code":"ZR0"}]},
 {"number":"1188","page":13,"customer_key":"andreas_jung","issue_date":"2026-04-20","due_date":"2026-04-20","currency":"EUR","status":"paid","total":3500,"lines":[{"description":"China Inspiration Tour: Shenzhen & Hongkong, November 23-27, 2026. Participant: Andreas Jung","quantity":1,"unit_price":3500,"net":3500,"vat":0,"gross":3500,"vat_code":"ZR0"}]},
 {"number":"1189","page":14,"customer_key":"perform_globally","issue_date":"2026-04-21","due_date":"2026-04-21","currency":"EUR","status":"paid","total":3150,"lines":[{"description":"10% discount","quantity":-0.1,"unit_price":3500,"net":-350,"vat":0,"gross":-350,"vat_code":"ZR0"},{"description":"China Inspiration Tour: Shenzhen & Hongkong, November 23-27, 2026. Participant: Anette Grimmelsmann","quantity":1,"unit_price":3500,"net":3500,"vat":0,"gross":3500,"vat_code":"ZR0"}]},
 {"number":"1190","page":15,"customer_key":"c9_ventures","issue_date":"2026-04-22","due_date":"2026-04-22","currency":"EUR","status":"paid","total":5000,"lines":[{"description":"London Inspiration Tour - Friday, 24 April 2026. 2nd Payment","quantity":0.5,"unit_price":10000,"net":5000,"vat":0,"gross":5000,"vat_code":"ZR0"}]},
 {"number":"1191","page":16,"customer_key":"wexelerate","issue_date":"2026-04-28","due_date":"2026-04-27","currency":"EUR","status":"paid","total":5500,"lines":[{"description":"Following the 2025/2026 agreement. May 2026","quantity":1,"unit_price":5500,"net":5500,"vat":0,"gross":5500,"vat_code":"ZR0"}]},
 {"number":"1192","page":17,"customer_key":"red_onion","issue_date":"2026-05-06","due_date":"2026-05-06","currency":"EUR","status":"paid","total":2100,"lines":[{"description":"Daniele Quercia","quantity":1,"unit_price":700,"net":700,"vat":0,"gross":700,"vat_code":"ZR0"},{"description":"Alexander Woellwarth","quantity":1,"unit_price":700,"net":700,"vat":0,"gross":700,"vat_code":"ZR0"},{"description":"Speakercoaching - Marko Gentile","quantity":1,"unit_price":700,"net":700,"vat":0,"gross":700,"vat_code":"ZR0"}]},
 {"number":"1193","page":18,"customer_key":"red_onion","issue_date":"2026-05-13","due_date":"2026-05-13","currency":"EUR","status":"paid","total":2100,"lines":[{"description":"Alex Garfin","quantity":1,"unit_price":700,"net":700,"vat":0,"gross":700,"vat_code":"ZR0"},{"description":"Martin Rehak","quantity":1,"unit_price":700,"net":700,"vat":0,"gross":700,"vat_code":"ZR0"},{"description":"Speakercoaching - Alvin Graylin","quantity":1,"unit_price":700,"net":700,"vat":0,"gross":700,"vat_code":"ZR0"}]},
 {"number":"1194","page":25,"customer_key":"wexelerate","issue_date":"2026-05-19","due_date":"2026-05-19","currency":"EUR","status":"paid","total":5500,"lines":[{"description":"Following the 2025/2026 agreement. June 2026","quantity":1,"unit_price":5500,"net":5500,"vat":0,"gross":5500,"vat_code":"ZR0"}]},
 {"number":"1195","page":32,"customer_key":"storsendigital","issue_date":"2026-05-21","due_date":"2026-05-21","currency":"EUR","status":"void","total":0,"lines":[{"description":"VOIDED - Big Goals Silicon Valley Inspiration Tour, June 16-17, 2026. Included: curation, Waymo ride and tour transport.","quantity":0,"unit_price":0,"net":0,"vat":0,"gross":0,"vat_code":"ZR0"}]},
 {"number":"1196","page":26,"customer_key":"bts","issue_date":"2026-05-22","due_date":"2026-05-22","currency":"EUR","status":"paid","total":1500,"lines":[{"description":"Discount","quantity":-1,"unit_price":500,"net":-500,"vat":0,"gross":-500,"vat_code":"ZR0"},{"description":"Big Goals Silicon Valley Inspiration Tour, June 16-17, 2026","quantity":1,"unit_price":2000,"net":2000,"vat":0,"gross":2000,"vat_code":"ZR0"}]},
 {"number":"1197","page":19,"customer_key":"lx_neumayer","issue_date":"2026-05-22","due_date":"2026-05-22","currency":"EUR","status":"paid","total":2000,"lines":[{"description":"Big Goals Silicon Valley Inspiration Tour, June 16-17, 2026","quantity":1,"unit_price":2000,"net":2000,"vat":0,"gross":2000,"vat_code":"ZR0"}]},
 {"number":"1198","page":27,"customer_key":"red_onion","issue_date":"2026-05-27","due_date":"2026-05-27","currency":"EUR","status":"paid","total":250,"lines":[{"description":"Reisekosten: Flug VIE-BER","quantity":1,"unit_price":250,"net":250,"vat":0,"gross":250,"vat_code":"ZR0"}]},
 {"number":"1199","page":1,"customer_key":"bts","issue_date":"2026-06-03","due_date":"2026-06-03","currency":"EUR","status":"overdue","total":3500,"lines":[{"description":"Discount 2026","quantity":-1,"unit_price":5000,"net":-5000,"vat":0,"gross":-5000,"vat_code":"ZR0"},{"description":"China Inspiration Tour: Shenzhen & Hongkong, November 23-27, 2026. Participant: Damir Buljubasic","quantity":1,"unit_price":8500,"net":8500,"vat":0,"gross":8500,"vat_code":"ZR0"}]},
 {"number":"1200","page":20,"customer_key":"johann_stan","issue_date":"2026-06-07","due_date":"2026-06-07","currency":"EUR","status":"paid","total":1000,"lines":[{"description":"Big Goals Silicon Valley Inspiration Tour, June 16-17, 2026","quantity":1,"unit_price":2000,"net":2000,"vat":0,"gross":2000,"vat_code":"ZR0"},{"description":"Big Goals Silicon Valley Inspiration Tour discount","quantity":-1,"unit_price":1000,"net":-1000,"vat":0,"gross":-1000,"vat_code":"ZR0"}]},
 {"number":"1201","page":21,"customer_key":"wexelerate","issue_date":"2026-06-19","due_date":"2026-06-19","currency":"EUR","status":"paid","total":5500,"lines":[{"description":"Following the 2025/2026 agreement. July 2026","quantity":1,"unit_price":5500,"net":5500,"vat":0,"gross":5500,"vat_code":"ZR0"}]},
 {"number":"1202","page":22,"customer_key":"neil_redding","issue_date":"2026-07-16","due_date":"2026-07-16","currency":"USD","status":"paid","total":400,"lines":[{"description":"Speakercoaching session Jul 17","quantity":1,"unit_price":400,"net":400,"vat":0,"gross":400,"vat_code":"OOS"}]},
 {"number":"1203","page":23,"customer_key":"neil_redding","issue_date":"2026-07-21","due_date":"2026-07-21","currency":"USD","status":"paid","total":2000,"lines":[{"description":"Speakercoaching package - 5 sessions","quantity":1,"unit_price":2000,"net":2000,"vat":0,"gross":2000,"vat_code":"OOS"},{"description":"Bonus session","quantity":1,"unit_price":0,"net":0,"vat":0,"gross":0,"vat_code":"OOS"}]},
 {"number":"1204","page":24,"customer_key":"wexelerate","issue_date":"2026-07-23","due_date":"2026-07-23","currency":"EUR","status":"paid","total":8000,"lines":[{"description":"Following the 2025/2026 agreement. August 2026","quantity":1,"unit_price":5500,"net":5500,"vat":0,"gross":5500,"vat_code":"ZR0"},{"description":"Konzept futureforward 2026","quantity":1,"unit_price":2500,"net":2500,"vat":0,"gross":2500,"vat_code":"ZR0"}]}
]$invoices$::jsonb)as x(number text,page integer,customer_key text,issue_date date,due_date date,currency text,status text,total numeric,header_text text,lines jsonb);

do $$declare i record;l record;v_doc uuid;v_customer uuid;v_line integer;v_revenue uuid;v_vat uuid;
 v_ws constant uuid:='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9';v_profile jsonb;v_bank jsonb;begin
 select coalesce((select default_revenue_account_id from public.workspace_settings where workspace_id=v_ws),
  (select id from public.accounts where workspace_id=v_ws and type='income'and is_active order by code limit 1))into v_revenue;
 if v_revenue is null then raise exception'No FZCO revenue account is configured';end if;
 select jsonb_build_object('legal_name',w.legal_name,'profile',to_jsonb(p))into v_profile from public.workspaces w
  left join public.company_legal_profiles p on p.workspace_id=w.id where w.id=v_ws;
 select to_jsonb(b)into v_bank from public.company_bank_accounts b where b.workspace_id=v_ws and b.is_active order by b.is_default desc,b.created_at limit 1;
 for i in select*from pdf_invoices order by number::integer loop
  select customer_id into v_customer from pdf_customer_map where key=i.customer_key;
  insert into public.sales_documents(workspace_id,document_type,document_number,customer_id,template_id,issue_date,due_date,
   currency,status,header_text,terms_text,notes,subtotal,tax_total,total,amount_paid,issuer_snapshot,customer_snapshot,bank_snapshot,
   issued_at,sent_at,created_by,created_at,updated_at)
  values(v_ws,'invoice',i.number,v_customer,(select id from public.document_templates where workspace_id=v_ws and document_type='invoice'and is_default order by updated_at desc limit 1),
   i.issue_date,i.due_date,i.currency,i.status,i.header_text,'Due on receipt',format('Imported from authoritative PDF page %s on 2026-08-13. PDF confirms %s status; payment date not supplied.',i.page,i.status),
   (select coalesce(sum((value->>'net')::numeric),0)from jsonb_array_elements(i.lines)),
   (select coalesce(sum((value->>'vat')::numeric),0)from jsonb_array_elements(i.lines)),i.total,case when i.status='paid'then i.total else 0 end,
   v_profile,(select to_jsonb(c)from public.counterparties c where c.id=v_customer),v_bank,i.issue_date::timestamptz,
   case when i.status in('paid','overdue')then i.issue_date::timestamptz else null end,auth.uid(),i.issue_date::timestamptz,now())returning id into v_doc;
  v_line:=0;
  for l in select*from jsonb_to_recordset(i.lines)as z(description text,quantity numeric,unit_price numeric,net numeric,vat numeric,gross numeric,vat_code text)loop
   v_line:=v_line+1;select id into v_vat from public.vat_codes where workspace_id=v_ws and code=l.vat_code limit 1;
   if v_vat is null then raise exception'VAT code % missing for invoice %',l.vat_code,i.number;end if;
   insert into public.sales_document_lines(workspace_id,document_id,line_no,description,quantity,unit,unit_price,discount_percent,
    vat_code_id,vat_rate,net_amount,vat_amount,gross_amount,revenue_account_id)
   values(v_ws,v_doc,v_line,l.description,l.quantity,'each',l.unit_price,0,v_vat,case when l.net=0 then 0 else l.vat/l.net end,l.net,l.vat,l.gross,v_revenue);
  end loop;
  if abs((select coalesce(sum(gross_amount),0)from public.sales_document_lines where document_id=v_doc)-i.total)>0.01 then
   raise exception'Invoice % line total does not reconcile',i.number;end if;
  insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)
  values(v_ws,'invoice',v_doc,'import_from_authoritative_pdf',auth.uid(),jsonb_build_object('invoice_number',i.number,'pdf_page',i.page,'status',i.status));
 end loop;
end$$;

insert into public.document_sequences(workspace_id,document_type,fiscal_year,prefix,next_number,padding,include_fiscal_year)
values('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9','invoice',2026,'',1205,4,false)
on conflict(workspace_id,document_type,fiscal_year)do update set prefix='',next_number=greatest(document_sequences.next_number,1205),padding=4,include_fiscal_year=false;

commit;

select jsonb_build_object(
 'invoices',(select count(*)from public.sales_documents where workspace_id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'and document_type='invoice'and issue_date between'2026-01-01'and'2026-12-31'),
 'paid',(select count(*)from public.sales_documents where workspace_id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'and document_type='invoice'and status='paid'),
 'void',(select count(*)from public.sales_documents where workspace_id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'and document_type='invoice'and status='void'),
 'open',(select jsonb_build_object('number',document_number,'currency',currency,'total',total,'amount_paid',amount_paid,'status',status)from public.sales_documents where workspace_id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'and document_number='1199'),
 'number_range',(select jsonb_build_object('min',min(document_number::integer),'max',max(document_number::integer))from public.sales_documents where workspace_id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'and document_number~'^[0-9]+$'),
 'next_invoice_number',(select prefix||lpad(next_number::text,padding,'0')from public.document_sequences where workspace_id='fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'and document_type='invoice'and fiscal_year=2026)
)as import_verification;
