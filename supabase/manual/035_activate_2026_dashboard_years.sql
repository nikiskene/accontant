-- Ensure the imported 2026 invoices are visible in the default dashboard period.
begin;

insert into public.tax_years(workspace_id,label,start_date,end_date,status,is_default)
select w.id,'2026','2026-01-01','2026-12-31','open',true
from public.workspaces w
where w.id in(
 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9',
 'd621017c-e9bd-4334-a07f-5e7b6d31ef6e'
)
and not exists(select 1 from public.tax_years y where y.workspace_id=w.id and y.label='2026');

update public.tax_years set is_default=(label='2026')
where workspace_id in(
 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9',
 'd621017c-e9bd-4334-a07f-5e7b6d31ef6e'
);

commit;

select workspace_id,label,start_date,end_date,is_default
from public.tax_years
where workspace_id in(
 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9',
 'd621017c-e9bd-4334-a07f-5e7b6d31ef6e'
)
order by workspace_id,label;
