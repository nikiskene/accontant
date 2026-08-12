-- Classify the 33 reviewed legacy 2025 trip expenses.
-- This does not post, void, delete, or change any trip status.

with proposed(expense_id, account_code) as (values
  -- Silicon Valley: transport
  ('4a70efcd-c8d8-47b0-a914-12b6f13c9f1b', '6420'),
  ('fb0a671e-59e0-4be8-98c8-458f559d5155', '6420'),
  ('9144af9f-b691-4750-9113-12f00bfb9834', '6420'),
  ('26f8b2ce-be37-48df-b83e-84d4abfb5ecc', '6420'),
  ('21a2e85f-c1d5-49da-be9d-131a8d9f9119', '6420'),
  ('997083de-2785-4788-8c76-af13375f714f', '6420'),
  ('fe883fce-8bbb-47c7-8f93-aa2983787719', '6420'),
  ('fc63e3b0-1a4d-4990-bdc8-379cc8cbf329', '6420'),
  ('8ab84b1a-3d3e-4cf7-8359-db20e1254f0e', '6420'),
  ('37508b3d-97b2-4534-8aea-af75aafba3e9', '6420'),
  -- Silicon Valley: meals, participant materials, and office costs
  ('30e00a6e-2491-4482-aeb9-085a8090eb94', '6430'),
  ('45eb451e-a4e6-4d1a-b6e7-9e8e402bd686', '6430'),
  ('af895625-515e-4995-8a37-797f2e402cbf', '5050'),
  ('f36e3798-2f2c-4a5f-a3ac-48b72449ba03', '6170'),
  ('8e86d25a-536b-43f7-ae44-3c38fd6f56ce', '6170'),
  ('efd9c41d-cc5a-440d-8866-8c8d5942daf7', '6170'),
  -- TEDx Berlin
  ('50312bde-2f91-406f-a240-fcc018b7bda5', '6430'),
  ('62a7577c-423f-4ca0-ac95-ced4d1d2c0a3', '6430'),
  ('1e3fbb0f-260c-4d46-b59c-2468c6f7ca3e', '6430'),
  ('234f1236-6e13-44ff-96ae-12d70de16bc0', '6430'),
  ('f0948945-c342-4257-ab79-a5452ce5a91f', '6420'),
  ('37acaee8-12f5-411b-a412-4910cf18a751', '6420'),
  ('f1371f9c-ed4e-4eef-ac9c-320543e1d349', '6420'),
  -- Hong Kong and Shenzhen
  ('9844815e-5580-43fd-86d3-605701ab7dc4', '6400'),
  ('36112b13-307c-4451-90dd-7356d2bbd384', '6410'),
  ('78bf8191-ba99-43a5-bd5a-24c2a8985108', '6150'),
  ('829d4b07-7f25-48d9-a260-a2332f0bb75a', '6150'),
  ('9e3750ed-d3cb-439b-adf8-09eb62439afb', '6150'),
  ('af4a236b-2de6-4dc1-988f-878a4e53e669', '5050'),
  ('35618bad-55f0-49b2-bbcd-a7ccbd7cb3ef', '6420'),
  ('b0cffc41-0a93-4ddd-9a37-cf87bff7e409', '6420'),
  ('2c37f475-b013-4fae-b880-4612969e71ba', '6100'),
  ('4e9fa902-4c4c-4290-b8b0-99f5bd0479e0', '6100')
), resolved as (
  select
    p.expense_id::uuid as expense_id,
    a.id as account_id,
    v.id as vat_code_id
  from proposed p
  join trip_expenses te
    on te.id = p.expense_id::uuid
   and te.workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'
  join accounts a
    on a.workspace_id = te.workspace_id
   and a.code = p.account_code
   and a.is_active
  join vat_codes v
    on v.workspace_id = te.workspace_id
   and v.code = 'OOS'
), guard as (
  select count(*) as resolved_count from resolved
), updated as (
  update trip_expenses te
  set account_id = r.account_id,
      vat_code_id = r.vat_code_id
  from resolved r
  where te.id = r.expense_id
    and (select resolved_count from guard) = 33
    and (te.account_id is distinct from r.account_id
      or te.vat_code_id is distinct from r.vat_code_id)
  returning te.id
)
select
  (select resolved_count from guard) as resolved_expenses,
  (select count(*) from updated) as changed_expenses,
  case
    when (select resolved_count from guard) = 33 then 'classification complete'
    else 'nothing changed: expected 33 resolved expenses'
  end as result;

select
  t.name as trip_name,
  a.code as account_code,
  a.name as account_name,
  v.code as vat_code,
  count(*) as expenses,
  round(sum(te.amount_aed), 2) as total_aed
from trip_expenses te
join trips t on t.id = te.trip_id
join accounts a on a.id = te.account_id
join vat_codes v on v.id = te.vat_code_id
where te.workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'
group by t.name, a.code, a.name, v.code
order by t.name, a.code;
