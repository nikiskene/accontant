begin;
alter table public.docflow_validations drop constraint docflow_validations_validation_verified_check;
insert into supabase_migrations.schema_migrations(version,name)values('20261102140000','recognize_docflow_validation_evidence');
notify pgrst, 'reload schema';
commit;
