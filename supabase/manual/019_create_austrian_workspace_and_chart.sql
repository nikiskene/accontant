-- Create the Austrian entity with the exact 39 accounts found in the 2025
-- FreeFinance Buchungsjournal. No generic or UAE accounts are copied.
begin;
do $$declare v_ws uuid;v_owner constant uuid:='c0a1df38-31e5-4feb-9c31-82ad11cc9af0';begin
select id into v_ws from public.workspaces where legal_name='IACy | Nikolaus SKENE' and country='AT';
if v_ws is null then
  insert into public.workspaces(
    legal_name,trade_name,country,base_currency,owner_user_id
  ) values (
    'IACy | Nikolaus SKENE','IACy','AT','EUR',v_owner
  ) returning id into v_ws;
end if;
insert into public.workspace_members(workspace_id,user_id,role)values(v_ws,v_owner,'owner')on conflict do nothing;
insert into public.workspace_settings(workspace_id)values(v_ws)on conflict(workspace_id)do nothing;
insert into public.tax_years(workspace_id,label,start_date,end_date,status,is_default)values(v_ws,'2025','2025-01-01','2025-12-31','open',true)on conflict do nothing;
insert into public.company_legal_profiles(workspace_id,country_code,billing_email)values(v_ws,'AT','billing@iacy.com')on conflict(workspace_id)do nothing;
create temporary table at_chart(code text,name text,type text)on commit drop;
insert into at_chart values
('0120','EDV-Programme','asset'),('0600','Betriebs- und Geschäftsausstattung','asset'),('0620','Büromaschinen, EDV-Anlagen','asset'),('0630','PKW und Kombi (nicht vst-abzugsfähig, Brutto Betrag)','asset'),
('2500','Vorsteuer','asset'),('2700','Kassa (Bar)','asset'),('2790','Kreditkarte','liability'),('2800','Bank','asset'),('3390','Verrechnungskonto Finanzamt','liability'),('3500','Umsatzsteuer','liability'),('3520','UST Zahllast','liability'),('4000','Einnahmen (Erlöse)','income'),
('6580','Eigene Versicherungsbeiträge an die Sozialversicherung der Selbständigen (SVS)','expense'),('7010','Abschreibung von Sachanlagen (automatische Buchung)','expense'),('7230','Energie (Strom, Heizung, Gas) und Wasser (Betriebskosten)','expense'),('7320','KFZ-Aufwand PKW und Kombi (nicht vorsteuerabzugsfähig)','expense'),('7340','Inlandsreiseaufwand','expense'),('7341','Auslandsreiseaufwand','expense'),('7380','Telefon-, Telex-, Telefax- und Telegrammgebühren','expense'),('7381','Internetgebühren','expense'),('7390','Portogebühren','expense'),('7400','Miet- und Pachtaufwand','expense'),('7480','Lizenzaufwand','expense'),('7500','Fremdpersonal, beigestelltes Personal','cogs'),('7600','Büromaterial (Büroaufwand, Bürobedarf, Kopien, Druckkosten)','expense'),('7630','Fachliteratur und Zeitungen','expense'),('7650','Werbe- und Repräsentationsaufwand','expense'),('7690','Spenden und Trinkgelder','expense'),('7700','Versicherungsaufwand','expense'),('7770','Aus- und Weiterbildung','expense'),('7780','Kammerumlage','expense'),('7785','Sonstige Gebühren und (Mitglieds-) Beiträge','expense'),('7790','Spesen des Geldverkehrs sowie sonstige Bankspesen','expense'),('7820','Buchwert abgegangener Anlagen (Aufwand)','expense'),('7850','Sonstige betriebliche Aufwendungen','expense'),('7900','Nicht abzugsfähige Aufwände (Privatanteil)','expense'),('8295','Sonstiger Zinsaufwand','expense'),('8301','Mahnspesen','expense'),('9600','Privat','equity');
if(select count(*)from at_chart)<>39 then raise exception 'Expected 39 FreeFinance accounts';end if;
insert into public.accounts(workspace_id,code,name,type,is_active)select v_ws,code,name,type,true from at_chart on conflict(workspace_id,code)do update set name=excluded.name,type=excluded.type;
end$$;
commit;
select w.id,w.legal_name,w.country,w.base_currency,count(a.id)accounts from public.workspaces w join public.accounts a on a.workspace_id=w.id where w.legal_name='IACy | Nikolaus SKENE' and w.country='AT' group by w.id;
