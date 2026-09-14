# Workspace Bootstrap Security

**Phase:** 2D.0.2 — Workspace Bootstrap Design and Controlled Live RLS Test Plan
**Status:** Implemented in the local forward migration only; no remote schema change

## Bootstrap Decision

Use a tightly controlled `SECURITY DEFINER` RPC named `public.create_workspace_with_owner(workspace_name text, workspace_slug text)` in a future approved migration.

The browser must call the RPC; it must never insert directly into `workspaces` and `workspace_members` to bootstrap ownership.

The current local migration implements this RPC but intentionally provides no normal authenticated `workspaces` INSERT policy and no tenant membership write policy. The RPC body, owner, ACL, and integration behavior still require review before remote deployment.

## Required Behavior

1. Reject callers where `auth.uid()` is null.
2. Validate name and slug length/format inside the function.
3. Derive `creator_user_id` exclusively from `auth.uid()`.
4. Ignore/reject any client-supplied owner ID, role, workspace ID, or membership status.
5. Insert the workspace with `created_by = auth.uid()`.
6. Insert exactly one membership row with the new workspace ID, creator ID, role `owner`, and status `active`.
7. Optionally insert a `workspace.created` audit event after the membership exists.
8. Return only the new workspace ID and safe display fields.
9. Rely on PostgreSQL function atomicity: any failure rolls back both inserts and the audit event.

Conceptual body, not executable migration SQL:

```sql
begin
  creator_user_id := auth.uid();
  if creator_user_id is null then
    raise exception 'authenticated user required';
  end if;

  insert into public.workspaces (name, slug, created_by)
    values (workspace_name, workspace_slug, creator_user_id)
    returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role, status)
    values (new_workspace_id, creator_user_id, 'owner', 'active');

  insert into public.audit_log (...)
    values (..., 'workspace.created', ..., creator_user_id);

  return new_workspace_id;
end;
```

The final function must use schema-qualified names, `auth.uid()` as authority, no dynamic SQL, and no caller-controlled role/owner fields.

## Function Security

- Owner: migration/database owner, not the calling user.
- Mode: `SECURITY DEFINER`, because the first authenticated user has no existing membership and therefore cannot satisfy normal membership RLS for both inserts.
- Search path: `SET search_path = ''`.
- References: explicitly qualify `public.workspaces`, `public.workspace_members`, `public.audit_log`, and `auth.uid()`.
- Execute: grant only to `authenticated`; revoke from `PUBLIC` and do not grant to `anon`.
- Return data: new workspace identifier/name only; never return another user's data.
- No dynamic SQL, elevated arbitrary table access, or caller-supplied owner identity.
- Function must be created after the referenced tables exist and reviewed for owner/execute grants.

## Membership and Invitations

Tenant users have no direct INSERT, UPDATE, or DELETE policy on `workspace_members` in the hardened local migration. This prevents self-promotion, identity replacement, workspace reassignment, and role escalation through client-supplied rows.

Future controlled operations:

- Owner may invite admins, members, or viewers and may create another owner only through an explicit owner-only operation.
- Admin may invite members/viewers; admin cannot create owners or admins.
- Member cannot invite, change roles, or remove members.
- Invitations are workspace-scoped, single-use, expiring, and tied to the invited Auth identity/email after acceptance.
- Activation creates the membership with a server-selected role; the invitee cannot choose it.
- Revoked, suspended, or expired memberships fail all tenant access helpers.
- Role changes and removals are audited and must not permit changing `workspace_id` or `user_id` through a general update endpoint.

## V1 Role Model

| Capability | Owner | Admin | Member |
| --- | ---: | ---: | ---: |
| View workspace | Yes | Yes | Yes |
| Modify business profile/services | Yes | Yes | Yes, subject to product policy |
| Manage goals/contacts | Yes | Yes | Yes |
| Manage REV actions | Yes | Yes | Yes |
| Approve REV actions | Yes | Yes | Yes, if approval policy permits |
| View Business Memory | Yes | Yes | Yes |
| View audit log | Yes | Yes | No by default; expose only approved operational views |
| Invite members | Yes | Members/viewers only | No |
| Change roles | All roles | Members/viewers only | No |
| Remove members | Yes, protected owner rules | Members/viewers only | No |
| Delete workspace | Yes, explicit confirmation | No | No |

The existing `viewer` database role remains a read-only compatibility role. It is not expanded into a larger RBAC system during V1.

## Local Implementation Contract

- Function: `public.create_workspace_with_owner(text, text)`
- Returns: created workspace ID, name, and slug only
- Local grants: `authenticated` only; `PUBLIC` revoked; `anon` not granted
- Local rollback: `drop function if exists public.create_workspace_with_owner(text, text)`
- Remote status: not deployed

## Controlled Test Preconditions

- Use only temporary Auth identities and workspaces named `RLS_TEST_WORKSPACE_A` and `RLS_TEST_WORKSPACE_B`.
- Do not use real customer data or the production quote workflow.
- Create users/workspaces only after explicit migration approval in a controlled environment.
- Cleanup must target only tagged test IDs and must never delete from `public.quotes`.
