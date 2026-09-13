-- Run only after 049_add_receipt_ingestion.sql has committed successfully.
-- This installation's existing Accontant owner may view billing@iacy.com
-- receipt evidence. Leave ingestion disabled until Microsoft Graph Mail.Read
-- has been scoped and tested.
begin;

do $$
begin
  if (select count(*) from auth.users where lower(email)=lower('ns@iacy.com')) <> 1 then
    raise exception 'Expected exactly one existing Accontant owner email';
  end if;
  if (select count(*) from public.workspaces where country='AT' and legal_name='Nikolaus SKENE') <> 1 then
    raise exception 'Expected exactly one EU workspace named Nikolaus SKENE';
  end if;
  if (select count(*) from public.workspaces where country='AE' and legal_name='IACy International FZCO') <> 1 then
    raise exception 'Expected exactly one FZCO workspace named IACy International FZCO';
  end if;
end $$;

insert into public.receipt_mailboxes (mailbox, enabled, ai_enabled, auto_book, start_at)
values ('billing@iacy.com', false, false, false, now())
on conflict (mailbox) do update set enabled=false, ai_enabled=false, auto_book=false
returning id;

insert into public.receipt_mailbox_members (mailbox_id, user_id)
select m.id, u.id
from public.receipt_mailboxes m
join auth.users u on lower(u.email) = lower('ns@iacy.com')
where m.mailbox='billing@iacy.com'
on conflict do nothing;

-- These mappings are configuration, not application constants. The checks above
-- deliberately fail if the expected legal entity is absent or duplicated.
insert into public.receipt_aliases (alias, mailbox_id, workspace_id)
select 'eu@iacy.com', m.id, w.id
from public.receipt_mailboxes m
cross join lateral (
  select id from public.workspaces where country='AT' and legal_name='Nikolaus SKENE'
) w
where m.mailbox='billing@iacy.com'
on conflict (alias) do update set mailbox_id=excluded.mailbox_id, workspace_id=excluded.workspace_id;

insert into public.receipt_aliases (alias, mailbox_id, workspace_id)
select 'fzco@iacy.com', m.id, w.id
from public.receipt_mailboxes m
cross join lateral (
  select id from public.workspaces where country='AE' and legal_name='IACy International FZCO'
) w
where m.mailbox='billing@iacy.com'
on conflict (alias) do update set mailbox_id=excluded.mailbox_id, workspace_id=excluded.workspace_id;

commit;

-- Expected: one mailbox, two aliases, and one or more explicitly authorized reviewers.
select m.mailbox, m.enabled, m.ai_enabled, m.auto_book,
       a.alias, w.legal_name as company,
       (select count(*) from public.receipt_mailbox_members mm where mm.mailbox_id=m.id) as reviewer_count
from public.receipt_mailboxes m
left join public.receipt_aliases a on a.mailbox_id=m.id
left join public.workspaces w on w.id=a.workspace_id
where m.mailbox='billing@iacy.com'
order by a.alias;
