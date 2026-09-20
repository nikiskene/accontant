-- Public Samly downpayment tracker. Completely separate from private insolvency.
begin;
create table public.samly_downpayment_plans(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
 creditor_name text not null check(char_length(trim(creditor_name)) between 1 and 180), creditor_reference text, creditor_email text, creditor_phone text, notes text,
 currency text not null check(currency ~ '^[A-Z]{3}$'), installment_amount numeric(15,2) not null check(installment_amount>0), installment_count integer not null check(installment_count between 1 and 600), first_due_date date not null, due_day integer not null check(due_day between 1 and 31), active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.samly_downpayment_installments(
 id uuid primary key default gen_random_uuid(), plan_id uuid not null references public.samly_downpayment_plans(id) on delete cascade, installment_no integer not null check(installment_no>0), due_date date not null, amount_due numeric(15,2) not null check(amount_due>0), created_at timestamptz not null default now(), unique(plan_id,installment_no)
);
create table public.samly_downpayment_payments(
 id uuid primary key default gen_random_uuid(), installment_id uuid not null references public.samly_downpayment_installments(id) on delete restrict, paid_date date not null, amount numeric(15,2) not null check(amount>0), reference text, note text, created_at timestamptz not null default now(), created_by uuid references auth.users(id)
);
create index samly_downpayment_installments_due_idx on public.samly_downpayment_installments(plan_id,due_date);
create index samly_downpayment_payments_installment_idx on public.samly_downpayment_payments(installment_id);

alter table public.samly_downpayment_plans enable row level security; alter table public.samly_downpayment_installments enable row level security; alter table public.samly_downpayment_payments enable row level security;
revoke all on public.samly_downpayment_plans,public.samly_downpayment_installments,public.samly_downpayment_payments from anon,authenticated;
grant select on public.samly_downpayment_plans,public.samly_downpayment_installments,public.samly_downpayment_payments to authenticated;
grant all on public.samly_downpayment_plans,public.samly_downpayment_installments,public.samly_downpayment_payments to service_role;
create policy samly_downpayment_plan_read on public.samly_downpayment_plans for select to authenticated using(public.is_samly_workspace_owner(workspace_id));
create policy samly_downpayment_installment_read on public.samly_downpayment_installments for select to authenticated using(exists(select 1 from public.samly_downpayment_plans p where p.id=plan_id and public.is_samly_workspace_owner(p.workspace_id)));
create policy samly_downpayment_payment_read on public.samly_downpayment_payments for select to authenticated using(exists(select 1 from public.samly_downpayment_installments i join public.samly_downpayment_plans p on p.id=i.plan_id where i.id=installment_id and public.is_samly_workspace_owner(p.workspace_id)));

create or replace function public.save_samly_downpayment_plan(p_plan_id uuid,p_workspace_id uuid,p_creditor_name text,p_creditor_reference text,p_creditor_email text,p_creditor_phone text,p_notes text,p_currency text,p_installment_amount numeric,p_installment_count integer,p_first_due_date date,p_due_day integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_plan uuid; v_paid boolean;
begin
 if not public.is_samly_workspace_owner(p_workspace_id) or not public.can_write(p_workspace_id) then raise exception 'Samly workspace write access required'; end if;
 if nullif(trim(p_creditor_name),'') is null or p_installment_amount<=0 or p_installment_count not between 1 and 600 or p_due_day not between 1 and 31 or p_first_due_date is null or upper(coalesce(p_currency,'')) !~ '^[A-Z]{3}$' then raise exception 'Complete creditor, amount, instalments, first due date, due day and currency'; end if;
 if p_plan_id is not null then
   select p.id into v_plan from public.samly_downpayment_plans p where p.id=p_plan_id and p.workspace_id=p_workspace_id for update;
   if not found then raise exception 'Plan not found'; end if;
   select exists(select 1 from public.samly_downpayment_payments pay join public.samly_downpayment_installments i on i.id=pay.installment_id where i.plan_id=v_plan) into v_paid;
   if v_paid and exists(select 1 from public.samly_downpayment_plans p where p.id=v_plan and (p.installment_amount is distinct from p_installment_amount or p.installment_count is distinct from p_installment_count or p.first_due_date is distinct from p_first_due_date or p.due_day is distinct from p_due_day)) then raise exception 'Payment terms cannot change after payments are recorded; add a new plan for revised terms'; end if;
   update public.samly_downpayment_plans set creditor_name=trim(p_creditor_name),creditor_reference=nullif(trim(p_creditor_reference),''),creditor_email=nullif(trim(p_creditor_email),''),creditor_phone=nullif(trim(p_creditor_phone),''),notes=nullif(trim(p_notes),''),currency=upper(p_currency),installment_amount=p_installment_amount,installment_count=p_installment_count,first_due_date=p_first_due_date,due_day=p_due_day,updated_at=now() where id=v_plan;
   if not v_paid then delete from public.samly_downpayment_installments where plan_id=v_plan; end if;
 else
   insert into public.samly_downpayment_plans(workspace_id,creditor_name,creditor_reference,creditor_email,creditor_phone,notes,currency,installment_amount,installment_count,first_due_date,due_day) values(p_workspace_id,trim(p_creditor_name),nullif(trim(p_creditor_reference),''),nullif(trim(p_creditor_email),''),nullif(trim(p_creditor_phone),''),nullif(trim(p_notes),''),upper(p_currency),p_installment_amount,p_installment_count,p_first_due_date,p_due_day) returning id into v_plan;
 end if;
 if not coalesce(v_paid,false) then
   insert into public.samly_downpayment_installments(plan_id,installment_no,due_date,amount_due)
   select v_plan,n,least((date_trunc('month',p_first_due_date)::date + (n-1)*interval '1 month' + (least(p_due_day,extract(day from ((date_trunc('month',p_first_due_date)::date + n*interval '1 month') - interval '1 day'))::integer)-1)*interval '1 day')::date,(date_trunc('month',p_first_due_date)::date + n*interval '1 month' - interval '1 day')::date),p_installment_amount from generate_series(1,p_installment_count)n;
 end if;
 return v_plan;
end $$;
create or replace function public.record_samly_downpayment_payment(p_installment_id uuid,p_amount numeric,p_paid_date date,p_reference text default null,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_due numeric; v_paid numeric; v_workspace uuid;
begin
 select i.amount_due,coalesce(sum(pay.amount),0),p.workspace_id into v_due,v_paid,v_workspace from public.samly_downpayment_installments i join public.samly_downpayment_plans p on p.id=i.plan_id left join public.samly_downpayment_payments pay on pay.installment_id=i.id where i.id=p_installment_id group by i.amount_due,p.workspace_id;
 if v_workspace is null or not public.is_samly_workspace_owner(v_workspace) or not public.can_write(v_workspace) then raise exception 'Plan not accessible'; end if;
 if p_amount<=0 or v_paid+p_amount>v_due+.01 then raise exception 'Payment cannot exceed the remaining instalment balance'; end if;
 insert into public.samly_downpayment_payments(installment_id,paid_date,amount,reference,note,created_by) values(p_installment_id,p_paid_date,p_amount,nullif(trim(p_reference),''),nullif(trim(p_note),''),auth.uid());
end $$;
create or replace view public.v_samly_downpayment_schedule with (security_invoker=true) as
select p.workspace_id,p.id plan_id,p.creditor_name,p.creditor_reference,p.creditor_email,p.creditor_phone,p.notes,p.currency,p.installment_amount,p.installment_count,p.first_due_date,p.due_day,i.id installment_id,i.installment_no,i.due_date,i.amount_due,coalesce(sum(pay.amount),0)::numeric amount_paid,greatest(i.amount_due-coalesce(sum(pay.amount),0),0)::numeric balance,case when coalesce(sum(pay.amount),0)>=i.amount_due then 'paid' when i.due_date<current_date then 'overdue' else 'due' end status
from public.samly_downpayment_plans p join public.samly_downpayment_installments i on i.plan_id=p.id left join public.samly_downpayment_payments pay on pay.installment_id=i.id group by p.id,i.id;
revoke all on function public.save_samly_downpayment_plan(uuid,uuid,text,text,text,text,text,text,numeric,integer,date,integer),public.record_samly_downpayment_payment(uuid,numeric,date,text,text) from public;
grant execute on function public.save_samly_downpayment_plan(uuid,uuid,text,text,text,text,text,text,numeric,integer,date,integer),public.record_samly_downpayment_payment(uuid,numeric,date,text,text) to authenticated;
commit;
select jsonb_build_object('separate_from_private_insolvency',to_regclass('public.samly_downpayment_plans')is not null and to_regclass('public.private_insolvency_cases')is not null,'plan_rpc',to_regprocedure('public.save_samly_downpayment_plan(uuid,uuid,text,text,text,text,text,text,numeric,integer,date,integer)')is not null,'payment_rpc',to_regprocedure('public.record_samly_downpayment_payment(uuid,numeric,date,text,text)')is not null,'workspace_scoped_rls',(select relrowsecurity from pg_class where oid='public.samly_downpayment_plans'::regclass)) as samly_downpayment_tracker_verification;
