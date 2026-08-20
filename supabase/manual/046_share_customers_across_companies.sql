begin;

alter table public.counterparties add column if not exists shared_customer_id uuid;

-- If an earlier copy of this migration was run, undo its automatic role change
-- and remove only unused mirror rows it created. Roles are always explicit.
do $$declare v_shared uuid;begin
  select shared_customer_id into v_shared from public.counterparties where id='53c640bf-c298-454d-9d6d-105a718c22e6';
  update public.counterparties set kind='vendor',shared_customer_id=null
  where id='53c640bf-c298-454d-9d6d-105a718c22e6'and kind='both'
    and not exists(select 1 from public.sales_documents where customer_id='53c640bf-c298-454d-9d6d-105a718c22e6');
  if v_shared is not null then
    delete from public.counterparties c where c.shared_customer_id=v_shared and c.id<>'53c640bf-c298-454d-9d6d-105a718c22e6'
      and c.kind='customer'and not exists(select 1 from public.sales_documents d where d.customer_id=c.id)
      and not exists(select 1 from public.transactions t where t.counterparty_id=c.id);
  end if;
end$$;
alter table public.counterparties drop constraint if exists uniq_counterparty_name_per_workspace;
drop index if exists public.uniq_counterparty_name_per_workspace;
alter table public.counterparties drop constraint if exists counterparties_workspace_email_uq;
drop index if exists public.counterparties_workspace_email_uq;

-- Link matching existing customers owned by the same account. Name plus email is
-- used only for this one-time backfill; future identity uses the UUID.
create temporary table shared_customer_groups on commit drop as
select owner_user_id,lower(trim(coalesce(c.company_name,c.alias,'')))name_key,
  lower(trim(coalesce(c.email,'')))email_key,gen_random_uuid()shared_id
from public.counterparties c join public.workspaces w on w.id=c.workspace_id
where c.kind in('customer','both')
group by owner_user_id,lower(trim(coalesce(c.company_name,c.alias,''))),lower(trim(coalesce(c.email,'')));

update public.counterparties c set shared_customer_id=g.shared_id
from public.workspaces w,shared_customer_groups g
where w.id=c.workspace_id and w.owner_user_id=g.owner_user_id and c.kind in('customer','both')
  and lower(trim(coalesce(c.company_name,c.alias,'')))=g.name_key
  and lower(trim(coalesce(c.email,'')))=g.email_key and c.shared_customer_id is null;

-- A company may already contain separate records with the same normalized name
-- and email. Preserve them as separate identities instead of guessing which
-- accounting references should be merged.
with ranked as(
  select id,row_number()over(
    partition by workspace_id,shared_customer_id order by created_at,id
  )position
  from public.counterparties where shared_customer_id is not null
)
update public.counterparties c set shared_customer_id=gen_random_uuid()
from ranked r where c.id=r.id and r.position>1;

create unique index if not exists counterparties_workspace_shared_customer_uidx
  on public.counterparties(workspace_id,shared_customer_id)where shared_customer_id is not null;
create index if not exists counterparties_shared_customer_idx
  on public.counterparties(shared_customer_id)where shared_customer_id is not null;

-- Give every company owned by the same account a local accounting link to each
-- shared customer. Historical document and transaction FKs remain unchanged.
with canonical as(
  select distinct on(c.shared_customer_id)c.*,w.owner_user_id
  from public.counterparties c join public.workspaces w on w.id=c.workspace_id
  where c.shared_customer_id is not null order by c.shared_customer_id,c.created_at,c.id
)
insert into public.counterparties(workspace_id,kind,company_name,alias,street_address,zip,city,state,country,phone,email,vat_trn,shared_customer_id,open_balance)
select w.id,'customer',c.company_name,c.alias,c.street_address,c.zip,c.city,c.state,c.country,c.phone,c.email,c.vat_trn,c.shared_customer_id,0
from canonical c join public.workspaces w on w.owner_user_id=c.owner_user_id
where not exists(select 1 from public.counterparties x where x.workspace_id=w.id and x.shared_customer_id=c.shared_customer_id);

create or replace function public.prepare_shared_customer_id()returns trigger language plpgsql set search_path=public as $$
begin
  if new.kind in('customer','both')and new.shared_customer_id is null then new.shared_customer_id:=gen_random_uuid();end if;
  return new;
end$$;
drop trigger if exists counterparties_prepare_shared_customer on public.counterparties;
create trigger counterparties_prepare_shared_customer before insert or update of kind on public.counterparties
for each row execute function public.prepare_shared_customer_id();

create or replace function public.sync_shared_customer()returns trigger language plpgsql security definer set search_path=public as $$
declare v_owner uuid;
begin
  if new.shared_customer_id is null or pg_trigger_depth()>1 then return new;end if;
  select owner_user_id into v_owner from public.workspaces where id=new.workspace_id;
  update public.counterparties set company_name=new.company_name,alias=new.alias,street_address=new.street_address,
    zip=new.zip,city=new.city,state=new.state,country=new.country,phone=new.phone,email=new.email,vat_trn=new.vat_trn
  where shared_customer_id=new.shared_customer_id and id<>new.id;
  insert into public.counterparties(workspace_id,kind,company_name,alias,street_address,zip,city,state,country,phone,email,vat_trn,shared_customer_id,open_balance)
  select w.id,'customer',new.company_name,new.alias,new.street_address,new.zip,new.city,new.state,new.country,new.phone,new.email,new.vat_trn,new.shared_customer_id,0
  from public.workspaces w where w.owner_user_id=v_owner and not exists(
    select 1 from public.counterparties c where c.workspace_id=w.id and c.shared_customer_id=new.shared_customer_id
  );
  return new;
end$$;
drop trigger if exists counterparties_sync_shared_customer on public.counterparties;
create trigger counterparties_sync_shared_customer after insert or update of company_name,alias,street_address,zip,city,state,country,phone,email,vat_trn
on public.counterparties for each row execute function public.sync_shared_customer();

commit;

select jsonb_build_object(
  'julian_remains_vendor',exists(select 1 from public.counterparties where id='53c640bf-c298-454d-9d6d-105a718c22e6'and kind='vendor'),
  'shared_customer_column',exists(select 1 from information_schema.columns where table_schema='public'and table_name='counterparties'and column_name='shared_customer_id'),
  'shared_customer_links',(select count(*)from public.counterparties where shared_customer_id is not null),
  'unlinked_customers',(select count(*)from public.counterparties where kind in('customer','both')and shared_customer_id is null),
  'same_workspace_shared_duplicates',(select count(*)from(select workspace_id,shared_customer_id from public.counterparties where shared_customer_id is not null group by workspace_id,shared_customer_id having count(*)>1)x),
  'sync_trigger',exists(select 1 from pg_trigger where tgname='counterparties_sync_shared_customer'and not tgisinternal)
)as verification;
