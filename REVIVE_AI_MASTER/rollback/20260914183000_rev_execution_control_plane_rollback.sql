-- Reviewed rollback companion for 20260914183000_rev_execution_control_plane.sql.
-- Use only before production activation and only when the guard below confirms that no
-- Phase 4C policy, approval binding, versioned edit, execution, or provider evidence exists.
-- Once real evidence exists, disable execution and forward-fix; never drop audit evidence.

do $$
begin
  if exists (select 1 from public.workspace_execution_policies)
    or exists (select 1 from public.rev_action_executions)
    or exists (select 1 from public.provider_usage_events)
    or exists (
      select 1 from public.approvals
      where action_version is not null or action_fingerprint is not null
    )
    or exists (select 1 from public.rev_actions where action_version <> 1) then
    raise exception 'Phase 4C data exists: disable execution and forward-fix instead of dropping evidence';
  end if;
end;
$$;

drop trigger if exists rev_actions_material_and_transition_guard on public.rev_actions;
drop trigger if exists approvals_decision_immutable on public.approvals;
drop trigger if exists audit_log_append_only on public.audit_log;
drop trigger if exists provider_usage_events_append_only on public.provider_usage_events;
drop trigger if exists workspace_execution_policy_update_guard on public.workspace_execution_policies;

drop policy if exists provider_usage_events_select on public.provider_usage_events;
drop policy if exists rev_action_executions_select on public.rev_action_executions;
drop policy if exists workspace_execution_policies_update on public.workspace_execution_policies;
drop policy if exists workspace_execution_policies_insert on public.workspace_execution_policies;
drop policy if exists workspace_execution_policies_select on public.workspace_execution_policies;

drop function if exists public.record_rev_action_execution_result(uuid, text, text, text, jsonb);
drop function if exists public.prepare_rev_action_execution(uuid, uuid, text, text, uuid, text, text, text, numeric, text);
drop function if exists public.decide_rev_action_approval(uuid, bigint, text, text, text);
drop function if exists public.protect_workspace_execution_policy();
drop function if exists public.prevent_append_only_evidence_mutation();

drop table if exists public.provider_usage_events;
drop table if exists public.rev_action_executions;
drop table if exists public.workspace_execution_policies;

drop function if exists public.protect_rev_action_material_changes();
drop function if exists public.rev_action_material_fingerprint(public.rev_actions);

drop policy if exists approvals_insert_pending on public.approvals;
drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals for select
  using (public.is_active_workspace_member(workspace_id));
create policy approvals_insert_pending on public.approvals for insert
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
    and decision is null and decided_at is null and decided_by is null
  );

drop policy if exists rev_actions_update_proposal on public.rev_actions;
drop policy if exists rev_actions_insert on public.rev_actions;
drop policy if exists rev_actions_select on public.rev_actions;
create policy rev_actions_select on public.rev_actions for select
  using (public.is_active_workspace_member(workspace_id));
create policy rev_actions_insert on public.rev_actions for insert
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
    and status in ('proposed', 'awaiting_approval')
    and execution_status in ('not_started', 'not_executed')
    and approved_at is null and executed_at is null and outcome_summary is null
  );
create policy rev_actions_update_proposal on public.rev_actions for update
  using (
    public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
    and status in ('proposed', 'awaiting_approval')
    and execution_status in ('not_started', 'not_executed')
  )
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
    and status in ('proposed', 'awaiting_approval', 'cancelled')
    and execution_status in ('not_started', 'not_executed')
    and approved_at is null and executed_at is null and outcome_summary is null
  );

alter table public.approvals drop constraint if exists approvals_workspace_action_id_key;
alter table public.approvals drop constraint if exists approvals_action_binding_shape_check;
alter table public.approvals drop column if exists action_fingerprint;
alter table public.approvals drop column if exists action_version;
alter table public.rev_actions alter column execution_status set default 'not_started';
alter table public.rev_actions drop column if exists action_version;

-- Keep the safer Phase 4C role-specific policies and exact ACLs. Do not restore the former
-- broad active-member FOR ALL policies or authenticated audit insertion during rollback.
