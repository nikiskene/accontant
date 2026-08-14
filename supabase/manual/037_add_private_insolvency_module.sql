-- Private insolvency tracker. Deliberately isolated from workspaces and all accounting ledgers.
begin;

create table if not exists public.private_insolvency_cases(
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null references auth.users(id)on delete cascade,
 name text not null default 'Private Insolvency',currency text not null default 'EUR',status text not null default 'active'check(status in('active','completed','archived')),
 notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(owner_user_id,name)
);
create table if not exists public.private_insolvency_creditors(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.private_insolvency_cases(id)on delete cascade,
 legacy_id uuid,name text not null,contact_email text,notes text,created_at timestamptz not null default now(),unique(case_id,name)
);
create table if not exists public.private_insolvency_plans(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.private_insolvency_cases(id)on delete cascade,
 creditor_id uuid not null references public.private_insolvency_creditors(id)on delete restrict,legacy_id uuid,monthly_amount numeric(15,2)not null default 0,
 start_date date not null,months integer not null check(months>0),due_day integer not null default 1 check(due_day between 1 and 31),
 disputed_amount numeric(15,2)not null default 0,repay_percent numeric(9,6)not null default 1 check(repay_percent between 0 and 1),
 repay_total numeric(15,2)not null default 0,active boolean not null default true,notes text,created_at timestamptz not null default now(),unique(case_id,legacy_id)
);
create table if not exists public.private_insolvency_schedule(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.private_insolvency_cases(id)on delete cascade,
 plan_id uuid not null references public.private_insolvency_plans(id)on delete cascade,creditor_id uuid not null references public.private_insolvency_creditors(id)on delete restrict,
 legacy_id uuid,due_date date not null,amount_due numeric(15,2)not null check(amount_due>=0),period_label text,created_at timestamptz not null default now(),
 unique(plan_id,due_date),unique(case_id,legacy_id)
);
create table if not exists public.private_insolvency_payments(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.private_insolvency_cases(id)on delete cascade,
 schedule_id uuid not null references public.private_insolvency_schedule(id)on delete restrict,creditor_id uuid not null references public.private_insolvency_creditors(id)on delete restrict,
 legacy_id uuid,paid_date date not null,amount_paid numeric(15,2)not null check(amount_paid>0),reference text,method text,note text,source text not null default'manual',
 is_voided boolean not null default false,voided_at timestamptz,voided_by uuid references auth.users(id),void_reason text,created_at timestamptz not null default now(),unique(case_id,legacy_id)
);
create table if not exists public.private_insolvency_audit(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.private_insolvency_cases(id)on delete cascade,
 entity_type text not null,entity_id uuid not null,action text not null,details jsonb not null default'{}',created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);

create or replace function public.owns_private_insolvency_case(p_case_id uuid)returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.private_insolvency_cases where id=p_case_id and owner_user_id=auth.uid()) $$;
revoke all on function public.owns_private_insolvency_case(uuid)from public;grant execute on function public.owns_private_insolvency_case(uuid)to authenticated;

alter table public.private_insolvency_cases enable row level security;alter table public.private_insolvency_creditors enable row level security;
alter table public.private_insolvency_plans enable row level security;alter table public.private_insolvency_schedule enable row level security;
alter table public.private_insolvency_payments enable row level security;alter table public.private_insolvency_audit enable row level security;
drop policy if exists private_case_owner on public.private_insolvency_cases;create policy private_case_owner on public.private_insolvency_cases for all to authenticated using(owner_user_id=auth.uid())with check(owner_user_id=auth.uid());
do $$ declare t text;begin foreach t in array array['private_insolvency_creditors','private_insolvency_plans','private_insolvency_schedule','private_insolvency_payments']loop
 execute format('drop policy if exists private_case_owner on public.%I',t);execute format('create policy private_case_owner on public.%I for all to authenticated using(public.owns_private_insolvency_case(case_id))with check(public.owns_private_insolvency_case(case_id))',t);end loop;end $$;
drop policy if exists private_case_owner on public.private_insolvency_audit;create policy private_case_owner on public.private_insolvency_audit for select to authenticated using(public.owns_private_insolvency_case(case_id));

create or replace view public.v_private_insolvency_schedule with (security_invoker=true) as
select s.case_id,s.id schedule_id,s.plan_id,c.name creditor,s.due_date,s.amount_due,
 coalesce(sum(p.amount_paid)filter(where not p.is_voided),0)::numeric(15,2)amount_paid,
 (s.amount_due-coalesce(sum(p.amount_paid)filter(where not p.is_voided),0))::numeric(15,2)balance,
 case when s.amount_due<=coalesce(sum(p.amount_paid)filter(where not p.is_voided),0)then'paid'when s.due_date<current_date then'overdue'else'due'end status
from public.private_insolvency_schedule s join public.private_insolvency_creditors c on c.id=s.creditor_id
left join public.private_insolvency_payments p on p.schedule_id=s.id group by s.id,c.name;
grant select on public.v_private_insolvency_schedule to authenticated;

create or replace function public.record_private_insolvency_payment(p_schedule_id uuid,p_amount numeric,p_paid_date date default current_date,p_note text default null)
returns uuid language plpgsql security definer set search_path=public as $$ declare s public.private_insolvency_schedule%rowtype;v_id uuid;begin
 select*into s from public.private_insolvency_schedule where id=p_schedule_id;if s.id is null or not public.owns_private_insolvency_case(s.case_id)then raise exception'Not authorized';end if;
 if p_amount<=0 then raise exception'Payment must be positive';end if;
 insert into public.private_insolvency_payments(case_id,schedule_id,creditor_id,paid_date,amount_paid,note,source)values(s.case_id,s.id,s.creditor_id,p_paid_date,p_amount,p_note,'manual')returning id into v_id;
 insert into public.private_insolvency_audit(case_id,entity_type,entity_id,action,details,created_by)values(s.case_id,'payment',v_id,'record',jsonb_build_object('schedule_id',s.id,'amount',p_amount,'paid_date',p_paid_date),auth.uid());return v_id;end $$;
grant execute on function public.record_private_insolvency_payment(uuid,numeric,date,text)to authenticated;

create or replace function public.void_private_insolvency_payment(p_payment_id uuid,p_reason text)returns void language plpgsql security definer set search_path=public as $$ declare p public.private_insolvency_payments%rowtype;begin
 select*into p from public.private_insolvency_payments where id=p_payment_id;if p.id is null or not public.owns_private_insolvency_case(p.case_id)then raise exception'Not authorized';end if;
 if coalesce(trim(p_reason),'')=''then raise exception'Reason required';end if;update public.private_insolvency_payments set is_voided=true,voided_at=now(),voided_by=auth.uid(),void_reason=p_reason where id=p.id;
 insert into public.private_insolvency_audit(case_id,entity_type,entity_id,action,details,created_by)values(p.case_id,'payment',p.id,'void',jsonb_build_object('reason',p_reason),auth.uid());end $$;
grant execute on function public.void_private_insolvency_payment(uuid,text)to authenticated;
commit;

select jsonb_build_object('tables',(select count(*)from information_schema.tables where table_schema='public'and table_name like'private_insolvency_%'),'view',to_regclass('public.v_private_insolvency_schedule')is not null,'isolated_from_workspaces',true)verification;
