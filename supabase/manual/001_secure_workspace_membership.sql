-- Removes the privilege-escalation path that lets a user join a known workspace.
-- Existing memberships are not changed.

begin;

drop policy if exists "insert own workspace membership" on public.workspace_members;

drop policy if exists "admins add workspace members" on public.workspace_members;
create policy "admins add workspace members"
on public.workspace_members
for insert
to authenticated
with check (
  public.can_admin(workspace_id)
  and role in ('admin', 'writer', 'viewer', 'accountant')
);

commit;

-- Verify: exactly one INSERT policy should remain and it should call can_admin().
select policyname, cmd, roles, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'workspace_members'
order by policyname;
