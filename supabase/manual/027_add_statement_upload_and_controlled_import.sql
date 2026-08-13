-- Private evidence storage and controlled statement-to-bank-inbox import.
begin;
alter table public.bank_statement_imports add column if not exists extraction_model text,add column if not exists extraction_response_id text,add column if not exists extracted_row_count integer,add column if not exists extracted_at timestamptz,add column if not exists imported_at timestamptz;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('finance-documents','finance-documents',false,20971520,array['application/pdf','text/csv','application/vnd.ms-excel'])
on conflict(id)do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists finance_documents_read on storage.objects;drop policy if exists finance_documents_insert on storage.objects;drop policy if exists finance_documents_delete on storage.objects;
create policy finance_documents_read on storage.objects for select to authenticated using(bucket_id='finance-documents'and public.is_workspace_member(((storage.foldername(name))[1])::uuid));
create policy finance_documents_insert on storage.objects for insert to authenticated with check(bucket_id='finance-documents'and public.can_write(((storage.foldername(name))[1])::uuid));
create policy finance_documents_delete on storage.objects for delete to authenticated using(bucket_id='finance-documents'and public.can_admin(((storage.foldername(name))[1])::uuid));
commit;

create or replace function public.import_reconciled_bank_statement(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$declare s public.bank_statement_imports%rowtype;v_bank_import uuid;v_count integer;begin
select*into s from public.bank_statement_imports where id=p_import_id for update;
if not found or not public.can_write(s.workspace_id)then raise exception 'Statement not found or unauthorized';end if;
if s.status<>'reconciled'then raise exception 'Statement must reconcile before import';end if;
if s.bank_account_id is null then raise exception 'Bank account is required';end if;
if exists(select 1 from public.bank_statement_rows where statement_import_id=p_import_id and review_status='proposed')then raise exception 'Every row must be reviewed';end if;
insert into public.bank_imports(workspace_id,bank_account_id,source,file_name,imported_at,imported_by)
values(s.workspace_id,s.bank_account_id,'reviewed_statement',s.file_name,now(),auth.uid())returning id into v_bank_import;
insert into public.bank_transactions(workspace_id,bank_account_id,bank_import_id,booked_date,value_date,amount,currency,description,counterparty,reference,hash,status,created_at)
select r.workspace_id,s.bank_account_id,v_bank_import,r.booked_date,r.value_date,r.amount,coalesce(r.currency,s.currency),r.description,r.counterparty,r.reference,
md5(concat_ws('|',r.workspace_id,s.bank_account_id,r.booked_date,r.amount,coalesce(r.currency,s.currency),coalesce(r.description,''),coalesce(r.reference,''))),'unreconciled',now()
from public.bank_statement_rows r where r.statement_import_id=p_import_id and r.review_status in('approved','corrected')
and not exists(select 1 from public.bank_transactions b where b.workspace_id=r.workspace_id and b.bank_account_id=s.bank_account_id and b.hash=md5(concat_ws('|',r.workspace_id,s.bank_account_id,r.booked_date,r.amount,coalesce(r.currency,s.currency),coalesce(r.description,''),coalesce(r.reference,''))));
get diagnostics v_count=row_count;update public.bank_statement_imports set status='imported',imported_at=now()where id=p_import_id;
insert into public.audit_events(workspace_id,entity_type,entity_id,action,created_by,details)values(s.workspace_id,'bank_statement_import',p_import_id,'import',auth.uid(),jsonb_build_object('bank_import_id',v_bank_import,'rows',v_count));
return jsonb_build_object('bank_import_id',v_bank_import,'rows_imported',v_count);end$$;
revoke all on function public.import_reconciled_bank_statement(uuid)from public;grant execute on function public.import_reconciled_bank_statement(uuid)to authenticated;
