-- Phase 4G.2B-S
-- Atomic contact-suppression enforcement at the irreversible
-- SEND_APPROVED_EMAIL provider-claim boundary.
--
-- Fail closed: a missing contact or an existing suppression prevents
-- provider_attempt_claimed from being established.
create or replace function public.claim_rev_action_provider_attempt(
  target_execution_id uuid,
  expected_request_fingerprint text
)
returns public.rev_action_executions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_execution public.rev_action_executions;
  locked_action public.rev_actions;
  bound_approval public.approvals;
  policy public.workspace_execution_policies;
  current_fingerprint text;
  monthly_committed numeric(12, 4);
  claimed_execution public.rev_action_executions;
begin
  if current_user <> 'service_role' then raise exception 'trusted backend role required'; end if;
  if expected_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'valid request fingerprint required'; end if;

  select * into locked_execution
  from public.rev_action_executions
  where id = target_execution_id
  for update;
  if not found then raise exception 'execution not found'; end if;
  if locked_execution.capability <> 'SEND_APPROVED_EMAIL' then raise exception 'email execution required'; end if;
  if locked_execution.request_fingerprint <> expected_request_fingerprint then raise exception 'request fingerprint mismatch'; end if;
  if locked_execution.status <> 'prepared' or locked_execution.provider_outcome <> 'provider_not_invoked' then
    raise exception 'provider attempt is not claimable';
  end if;

  select * into policy
  from public.workspace_execution_policies
  where workspace_id = locked_execution.workspace_id
  for update;
  if not found or not policy.execution_enabled or policy.autonomy_mode <> 'always_ask' then
    raise exception 'workspace execution is disabled';
  end if;
  if locked_execution.capability = any(policy.disabled_capabilities) then
    raise exception 'capability is disabled for workspace';
  end if;
  if locked_execution.estimated_provider_cost > policy.per_attempt_provider_cost_ceiling then
    raise exception 'per-attempt provider cost ceiling exceeded';
  end if;
  select coalesce(pg_catalog.sum(provider_usage_events.actual_provider_cost), 0)
    + coalesce((
      select pg_catalog.sum(rev_action_executions.estimated_provider_cost)
      from public.rev_action_executions
      where rev_action_executions.workspace_id = locked_execution.workspace_id
        and rev_action_executions.status in ('prepared', 'in_progress')
        and rev_action_executions.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
    ), 0)
  into monthly_committed
  from public.provider_usage_events
  where provider_usage_events.workspace_id = locked_execution.workspace_id
    and provider_usage_events.occurred_at >= pg_catalog.date_trunc('month', pg_catalog.now());
  if monthly_committed > policy.monthly_provider_cost_ceiling then
    raise exception 'monthly provider cost ceiling exceeded';
  end if;

  select * into locked_action
  from public.rev_actions
  where workspace_id = locked_execution.workspace_id and id = locked_execution.action_id
  for update;
  if not found then raise exception 'REV action not found'; end if;
  if locked_action.action_type <> 'prepare_follow_up'
    or locked_action.status <> 'approved'
    or locked_action.execution_status <> 'not_executed'
    or locked_action.action_version <> locked_execution.action_version then
    raise exception 'REV action is no longer eligible for provider execution';
  end if;

  -- Phase 4G.2B-S: fail closed inside the same transaction that
  -- claims the irreversible provider attempt.
  if locked_action.contact_id is null then
    raise exception 'email execution requires a workspace contact';
  end if;

  perform 1
  from public.contact_suppressions
  where workspace_id = locked_execution.workspace_id
    and contact_id = locked_action.contact_id
  for share;

  if found then
    raise exception 'contact is suppressed from outreach';
  end if;

  current_fingerprint := public.rev_action_material_fingerprint(locked_action);
  if current_fingerprint <> locked_execution.approval_fingerprint then
    raise exception 'execution approval fingerprint is stale';
  end if;
  select * into bound_approval
  from public.approvals
  where workspace_id = locked_execution.workspace_id
    and id = locked_execution.approval_id
    and rev_action_id = locked_action.id
    and decision = 'approved'
    and action_version = locked_action.action_version
    and action_fingerprint = current_fingerprint
  for update;
  if not found then raise exception 'fresh bound approval required'; end if;

  update public.rev_action_executions
  set mode = 'live', status = 'in_progress', provider_outcome = 'provider_attempt_claimed',
      started_at = pg_catalog.now()
  where id = locked_execution.id
  returning * into claimed_execution;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    locked_execution.workspace_id, null, 'system', 'execution.provider_attempt_claimed',
    'rev_action_execution', locked_execution.id,
    pg_catalog.jsonb_build_object(
      'rev_action_id', locked_execution.action_id,
      'capability', locked_execution.capability,
      'correlation_id', locked_execution.correlation_id
    )
  );

  return claimed_execution;
end;
$$;

-- Preserve the trusted-backend-only execution boundary.
revoke all on function public.claim_rev_action_provider_attempt(uuid, text)
  from public, anon, authenticated;

grant execute on function public.claim_rev_action_provider_attempt(uuid, text)
  to service_role;
