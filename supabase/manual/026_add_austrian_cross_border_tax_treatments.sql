-- Austrian cross-border treatments. These codes classify transactions but do
-- not claim complete FinanzOnline/U1 mappings until accountant verification.
begin;
do $$declare v_ws constant uuid:='d621017c-e9bd-4334-a07f-5e7b6d31ef6e';begin
if not exists(select 1 from public.workspaces where id=v_ws and country='AT')then raise exception 'Verified Austrian workspace missing';end if;
insert into public.vat_codes(workspace_id,code,name,vat_rate,category,applies_to,is_default)values
(v_ws,'AT-RC-IN20','Reverse charge: foreign service purchase 20% (mapping unverified)',.20,'standard','purchases',false),
(v_ws,'AT-IG-IN20','Intra-Community goods acquisition 20% (mapping unverified)',.20,'standard','purchases',false),
(v_ws,'AT-RC-OUT','EU B2B service: recipient owes VAT (mapping unverified)',0,'out_of_scope','sales',false)
on conflict(workspace_id,code)do update set name=excluded.name,vat_rate=excluded.vat_rate,category=excluded.category,applies_to=excluded.applies_to;

insert into public.austrian_tax_code_mappings(workspace_id,vat_code_id,transaction_context,status,notes)
select v_ws,v.id,x.context,'unverified',x.notes from(values
('AT-RC-IN20','eu_service_purchase_rc','Foreign service purchase: recognize Austrian output VAT and eligible input VAT; exact U30/U1 Kennzahlen pending verification'),
('AT-IG-IN20','eu_goods_acquisition','Intra-Community acquisition; exact U30/U1 Kennzahlen pending verification'),
('AT-RC-OUT','eu_service_sale','EU B2B service treatment requires customer VAT ID and place-of-supply validation; exact reporting mapping pending verification')
)x(code,context,notes)join public.vat_codes v on v.workspace_id=v_ws and v.code=x.code
where not exists(select 1 from public.austrian_tax_code_mappings m where m.workspace_id=v_ws and m.vat_code_id=v.id and m.transaction_context=x.context and m.form_version_id is null);
end$$;
commit;

select code,name,vat_rate,applies_to from public.vat_codes where workspace_id='d621017c-e9bd-4334-a07f-5e7b6d31ef6e'and code in('AT-RC-IN20','AT-IG-IN20','AT-RC-OUT')order by code;
