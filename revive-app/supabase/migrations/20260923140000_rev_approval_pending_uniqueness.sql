-- Preserve approval history while allowing only one pending review
-- per REV action.

create unique index if not exists approvals_one_pending_per_action_idx
  on public.approvals (workspace_id, rev_action_id)
  where decision is null;

drop index if exists public.approvals_workspace_rev_action_unique_idx;