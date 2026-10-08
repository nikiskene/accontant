-- The deployed workspace table predates the timestamp used by
-- save_company_legal_profile. Restore the column from the base schema.
begin;
alter table public.workspaces
  add column if not exists updated_at timestamptz default now();
notify pgrst, 'reload schema';
commit;
