-- Accontant receipt-learning rules
-- Run after 049_add_receipt_ingestion.sql. This creates review-only learning:
-- a confirmed booking becomes a reusable example; it never books a later receipt.

alter table public.receipt_candidates
  add column if not exists source_signature text;

create table if not exists public.receipt_learning_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  source_receipt_id uuid not null unique references public.receipt_candidates(id) on delete cascade,
  source_signature text not null,
  vendor_template text,
  description_template text not null default '',
  booking_template jsonb not null,
  similarity_threshold numeric not null default 0.75 check (similarity_threshold between 0.50 and 1.00),
  enabled boolean not null default true,
  last_confirmed timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists receipt_learning_rules_match
  on public.receipt_learning_rules(workspace_id, enabled, last_confirmed desc);

alter table public.receipt_learning_rules enable row level security;
revoke all on public.receipt_learning_rules from anon, authenticated;
grant select on public.receipt_learning_rules to authenticated;
grant all on public.receipt_learning_rules to service_role;

drop policy if exists receipt_learning_rules_read on public.receipt_learning_rules;
create policy receipt_learning_rules_read on public.receipt_learning_rules
  for select to authenticated using (public.is_workspace_member(workspace_id));

create or replace function public.capture_receipt_learning_rule()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status is distinct from 'booked' and new.status = 'booked'
     and new.workspace_id is not null and nullif(trim(new.source_signature), '') is not null then
    insert into public.receipt_learning_rules(
      workspace_id, source_receipt_id, source_signature, vendor_template,
      description_template, booking_template, last_confirmed
    ) values (
      new.workspace_id, new.id, new.source_signature, new.vendor,
      coalesce(new.description, ''), new.booking, now()
    )
    on conflict (source_receipt_id) do update set
      workspace_id = excluded.workspace_id,
      source_signature = excluded.source_signature,
      vendor_template = excluded.vendor_template,
      description_template = excluded.description_template,
      booking_template = excluded.booking_template,
      last_confirmed = now(),
      enabled = true;
  end if;
  return new;
end $$;

drop trigger if exists receipt_capture_learning_rule on public.receipt_candidates;
create trigger receipt_capture_learning_rule
  after update of status on public.receipt_candidates
  for each row execute function public.capture_receipt_learning_rule();

-- The service role writes source signatures during extraction; users cannot.
