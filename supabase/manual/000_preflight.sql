-- READ ONLY. Expected project: ndktajhxihahgfdcsuij.
-- Stop if the workspace or counts differ unexpectedly.

select
  w.id,
  w.legal_name,
  w.country,
  w.base_currency,
  (select count(*) from transactions t where t.workspace_id = w.id) as transactions,
  (select count(*) from transaction_lines l where l.workspace_id = w.id) as transaction_lines,
  (select count(*) from trip_expenses e where e.workspace_id = w.id) as trip_expenses,
  (select count(*) from workspace_members m where m.workspace_id = w.id) as members
from workspaces w
order by w.legal_name;
