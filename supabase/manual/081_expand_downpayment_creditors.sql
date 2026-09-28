-- Expand public and private downpayment creditor records without changing payment history.
begin;
alter table public.samly_downpayment_plans add column if not exists original_amount numeric(15,2);
alter table public.samly_downpayment_plans add column if not exists receiving_company text;
alter table public.samly_downpayment_plans add column if not exists receiving_iban text;
alter table public.samly_downpayment_plans add column if not exists receiving_contact_name text;
update public.samly_downpayment_plans set original_amount=installment_amount*installment_count where original_amount is null;
alter table public.samly_downpayment_plans alter column original_amount set not null;
alter table public.samly_downpayment_plans add constraint samly_downpayment_original_amount_positive check(original_amount>0);

alter table public.private_insolvency_creditors add column if not exists receiving_company text;
alter table public.private_insolvency_creditors add column if not exists receiving_iban text;
alter table public.private_insolvency_creditors add column if not exists payment_reference text;
alter table public.private_insolvency_creditors add column if not exists contact_name text;

create or replace view public.v_samly_downpayment_schedule with (security_invoker=true) as
select p.workspace_id,p.id plan_id,p.creditor_name,p.creditor_reference,p.creditor_email,p.creditor_phone,p.notes,p.currency,p.original_amount,p.receiving_company,p.receiving_iban,p.receiving_contact_name,p.installment_amount,p.installment_count,p.first_due_date,p.due_day,i.id installment_id,i.installment_no,i.due_date,i.amount_due,coalesce(sum(pay.amount),0)::numeric amount_paid,greatest(i.amount_due-coalesce(sum(pay.amount),0),0)::numeric balance,case when coalesce(sum(pay.amount),0)>=i.amount_due then 'paid' when i.due_date<current_date then 'overdue' else 'due' end status
from public.samly_downpayment_plans p join public.samly_downpayment_installments i on i.plan_id=p.id left join public.samly_downpayment_payments pay on pay.installment_id=i.id group by p.id,i.id;

create or replace function public.save_samly_downpayment_credentials(p_plan_id uuid,p_workspace_id uuid,p_creditor_name text,p_original_amount numeric,p_installment_amount numeric,p_creditor_email text,p_creditor_phone text,p_receiving_company text,p_receiving_iban text,p_payment_reference text,p_contact_name text,p_notes text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_samly_workspace_owner(p_workspace_id) or not public.can_write(p_workspace_id) then raise exception 'Samly workspace write access required'; end if;
 if nullif(trim(p_creditor_name),'') is null or p_original_amount<=0 or p_installment_amount<=0 then raise exception 'Enter company, original amount and monthly amount'; end if;
 update public.samly_downpayment_plans set creditor_name=trim(p_creditor_name),original_amount=p_original_amount,installment_amount=p_installment_amount,creditor_email=nullif(trim(p_creditor_email),''),creditor_phone=nullif(trim(p_creditor_phone),''),receiving_company=nullif(trim(p_receiving_company),''),receiving_iban=nullif(trim(p_receiving_iban),''),creditor_reference=nullif(trim(p_payment_reference),''),receiving_contact_name=nullif(trim(p_contact_name),''),notes=nullif(trim(p_notes),''),updated_at=now() where id=p_plan_id and workspace_id=p_workspace_id;
 if not found then raise exception 'Plan not found'; end if;
end $$;

create or replace function public.save_private_insolvency_creditor_credentials(p_creditor_id uuid,p_company text,p_contact_name text,p_email text,p_iban text,p_reference text,p_notes text)
returns void language plpgsql security definer set search_path=public as $$
declare v_case uuid;
begin
 select case_id into v_case from public.private_insolvency_creditors where id=p_creditor_id for update;
 if v_case is null or not public.owns_private_insolvency_case(v_case) then raise exception 'Not authorized'; end if;
 if nullif(trim(p_company),'') is null then raise exception 'Company is required'; end if;
 update public.private_insolvency_creditors set name=trim(p_company),receiving_company=nullif(trim(p_company),''),contact_name=nullif(trim(p_contact_name),''),contact_email=nullif(trim(p_email),''),receiving_iban=nullif(trim(p_iban),''),payment_reference=nullif(trim(p_reference),''),notes=nullif(trim(p_notes),'') where id=p_creditor_id;
end $$;
revoke all on function public.save_samly_downpayment_credentials(uuid,uuid,text,numeric,numeric,text,text,text,text,text,text,text),public.save_private_insolvency_creditor_credentials(uuid,text,text,text,text,text,text) from public;
grant execute on function public.save_samly_downpayment_credentials(uuid,uuid,text,numeric,numeric,text,text,text,text,text,text,text),public.save_private_insolvency_creditor_credentials(uuid,text,text,text,text,text,text) to authenticated;
commit;
select jsonb_build_object('public_credentials_rpc',to_regprocedure('public.save_samly_downpayment_credentials(uuid,uuid,text,numeric,numeric,text,text,text,text,text,text,text)')is not null,'private_credentials_rpc',to_regprocedure('public.save_private_insolvency_creditor_credentials(uuid,text,text,text,text,text,text)')is not null,'private_creditor_fields',exists(select 1 from information_schema.columns where table_schema='public' and table_name='private_insolvency_creditors' and column_name='receiving_iban')) as downpayment_creditor_expansion_verification;
