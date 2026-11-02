-- Recognize only the empirically verified validation response shape.
-- This does not enable production delivery, FTA reporting or activation.
begin;
alter table public.docflow_validations drop constraint docflow_validations_validation_verified_check;
commit;
