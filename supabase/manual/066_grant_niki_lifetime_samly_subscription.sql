-- One-time lifetime Samly entitlement for the existing Niki account.
-- Safe to rerun. It intentionally does not create a Samly workspace or attach
-- any existing IACy/Nikolaus SKENE workspace to the public Samly account.

begin;

alter table public.samly_accounts
  drop constraint if exists samly_accounts_plan_code_check;
alter table public.samly_accounts
  add constraint samly_accounts_plan_code_check
  check (plan_code in ('pending', 'monthly', 'annual', 'lifetime'));

do $$
begin
  if not exists (
    select 1
    from public.samly_accounts
    where owner_user_id = 'c0a1df38-31e5-4feb-9c31-82ad11cc9af0'::uuid
  ) then
    raise exception 'No Samly account exists for this user yet. Complete Samly account setup first; no workspace was created or changed.';
  end if;
end $$;

update public.samly_accounts
set plan_code = 'lifetime',
    subscription_status = 'active',
    stripe_subscription_id = null,
    stripe_price_id = null,
    subscription_current_period_end = null,
    updated_at = now()
where owner_user_id = 'c0a1df38-31e5-4feb-9c31-82ad11cc9af0'::uuid;

commit;

select display_name, billing_email, plan_code, subscription_status,
       subscription_current_period_end, stripe_customer_id, stripe_subscription_id
from public.samly_accounts
where owner_user_id = 'c0a1df38-31e5-4feb-9c31-82ad11cc9af0'::uuid;
