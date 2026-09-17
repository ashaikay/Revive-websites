-- Guarded rollback for Phase 4G.2A-S semantic email idempotency hardening.
-- Once SEND_APPROVED_EMAIL execution evidence exists, disable execution and forward-fix.

do $$
begin
  if exists (
    select 1 from public.rev_action_executions
    where capability = 'SEND_APPROVED_EMAIL' or provider_outcome is not null
  ) then
    raise exception 'Phase 4G.2A-S email execution evidence exists: disable execution and forward-fix';
  end if;
end;
$$;

drop function if exists public.record_email_execution_result(uuid, text, text, text, jsonb);
drop function if exists public.claim_rev_action_provider_attempt(uuid, text);
drop index if exists public.rev_action_executions_send_email_semantic_unique;
alter table public.rev_action_executions
  drop constraint if exists rev_action_executions_provider_outcome_check;
alter table public.rev_action_executions drop column if exists provider_outcome;

-- Restore the Phase 4C preparation function exactly.
create or replace function public.prepare_rev_action_execution(
  target_workspace_id uuid,
  target_action_id uuid,
  target_idempotency_key text,
  target_request_fingerprint text,
  target_correlation_id uuid,
  target_capability text,
  target_risk_class text,
  target_jurisdiction text,
  target_estimated_provider_cost numeric,
  target_provider_key text default null
)
returns public.rev_action_executions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  policy public.workspace_execution_policies;
  locked_action public.rev_actions;
  bound_approval public.approvals;
  existing_attempt public.rev_action_executions;
  current_fingerprint text;
  monthly_committed numeric(12, 4);
  created_attempt public.rev_action_executions;
begin
  actor_id := auth.uid();
  if actor_id is null then raise exception 'authenticated user required'; end if;
  if not public.has_workspace_role(target_workspace_id, array['owner', 'admin']) then
    raise exception 'active owner or admin role required';
  end if;
  if target_idempotency_key is null or pg_catalog.char_length(target_idempotency_key) not between 1 and 200 then
    raise exception 'valid idempotency key required';
  end if;
  if target_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'valid request fingerprint required'; end if;
  if target_estimated_provider_cost < 0 then raise exception 'estimated provider cost cannot be negative'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_workspace_id::text || ':' || target_idempotency_key, 0)
  );

  select * into existing_attempt
  from public.rev_action_executions
  where workspace_id = target_workspace_id and idempotency_key = target_idempotency_key;
  if found then
    if existing_attempt.request_fingerprint <> target_request_fingerprint then
      raise exception 'idempotency key conflict';
    end if;
    return existing_attempt;
  end if;

  select * into policy
  from public.workspace_execution_policies
  where workspace_id = target_workspace_id
  for update;
  if not found or not policy.execution_enabled or policy.autonomy_mode <> 'always_ask' then
    raise exception 'workspace execution is disabled';
  end if;
  if target_capability = any(policy.disabled_capabilities) then
    raise exception 'capability is disabled for workspace';
  end if;
  if target_estimated_provider_cost > policy.per_attempt_provider_cost_ceiling then
    raise exception 'per-attempt provider cost ceiling exceeded';
  end if;

  select * into locked_action
  from public.rev_actions
  where workspace_id = target_workspace_id and id = target_action_id
  for update;
  if not found then raise exception 'REV action not found'; end if;
  if locked_action.status <> 'approved' or locked_action.execution_status <> 'not_executed' then
    raise exception 'REV action is not approved for preparation';
  end if;

  current_fingerprint := public.rev_action_material_fingerprint(locked_action);
  select * into bound_approval
  from public.approvals
  where workspace_id = target_workspace_id
    and rev_action_id = locked_action.id
    and decision = 'approved'
    and action_version = locked_action.action_version
    and action_fingerprint = current_fingerprint
  order by decided_at desc
  limit 1
  for update;
  if not found then raise exception 'fresh bound approval required'; end if;

  select coalesce(pg_catalog.sum(provider_usage_events.actual_provider_cost), 0)
    + coalesce((
      select pg_catalog.sum(rev_action_executions.estimated_provider_cost)
      from public.rev_action_executions
      where rev_action_executions.workspace_id = target_workspace_id
        and rev_action_executions.status in ('prepared', 'in_progress')
        and rev_action_executions.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
    ), 0)
  into monthly_committed
  from public.provider_usage_events
  where provider_usage_events.workspace_id = target_workspace_id
    and provider_usage_events.occurred_at >= pg_catalog.date_trunc('month', pg_catalog.now());

  if monthly_committed + target_estimated_provider_cost > policy.monthly_provider_cost_ceiling then
    raise exception 'monthly provider cost ceiling exceeded';
  end if;

  insert into public.rev_action_executions (
    workspace_id, action_id, approval_id, requested_by, capability, risk_class, mode, status,
    correlation_id, idempotency_key, request_fingerprint, action_version, approval_fingerprint,
    workspace_policy_version, jurisdiction, estimated_provider_cost, provider_key
  ) values (
    target_workspace_id, locked_action.id, bound_approval.id, actor_id, target_capability,
    target_risk_class, 'dry_run', 'prepared', target_correlation_id, target_idempotency_key,
    target_request_fingerprint, locked_action.action_version, current_fingerprint,
    policy.version, target_jurisdiction, target_estimated_provider_cost, target_provider_key
  ) returning * into created_attempt;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    target_workspace_id, actor_id, 'user', 'execution.prepared', 'rev_action_execution',
    created_attempt.id, pg_catalog.jsonb_build_object(
      'rev_action_id', locked_action.id,
      'capability', target_capability,
      'mode', 'dry_run',
      'correlation_id', target_correlation_id
    )
  );

  return created_attempt;
end;
$$;

-- Restore the Phase 4C generic result recorder exactly.
create or replace function public.record_rev_action_execution_result(
  target_execution_id uuid,
  target_status text,
  target_result_summary text,
  target_failure_code text,
  usage_events jsonb default '[]'::jsonb
)
returns public.rev_action_executions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_execution public.rev_action_executions;
  event jsonb;
  updated_execution public.rev_action_executions;
begin
  if target_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'terminal execution status required';
  end if;
  if pg_catalog.jsonb_typeof(usage_events) <> 'array' then raise exception 'usage_events must be an array'; end if;

  select * into locked_execution
  from public.rev_action_executions
  where id = target_execution_id
  for update;
  if not found then raise exception 'execution not found'; end if;
  if locked_execution.status not in ('prepared', 'in_progress') then
    raise exception 'execution is already terminal';
  end if;

  for event in select value from pg_catalog.jsonb_array_elements(usage_events)
  loop
    insert into public.provider_usage_events (
      workspace_id, execution_id, provider_key, operation, usage_event_key, units,
      estimated_provider_cost, actual_provider_cost, currency, provider_reference,
      correlation_id, status, occurred_at
    ) values (
      locked_execution.workspace_id,
      locked_execution.id,
      event->>'provider_key',
      event->>'operation',
      event->>'usage_event_key',
      coalesce((event->>'units')::numeric, 0),
      coalesce((event->>'estimated_provider_cost')::numeric, 0),
      (event->>'actual_provider_cost')::numeric,
      coalesce(event->>'currency', 'GBP'),
      event->>'provider_reference',
      locked_execution.correlation_id,
      coalesce(event->>'status', 'succeeded'),
      coalesce((event->>'occurred_at')::timestamptz, pg_catalog.now())
    );
  end loop;

  update public.rev_action_executions
  set status = target_status,
      started_at = coalesce(started_at, pg_catalog.now()),
      completed_at = pg_catalog.now(),
      result_summary = target_result_summary,
      failure_code = target_failure_code
  where id = locked_execution.id
  returning * into updated_execution;

  update public.rev_actions
  set status = case when target_status = 'succeeded' then 'completed' else 'failed' end,
      execution_status = case when target_status = 'succeeded' then 'succeeded' else 'failed' end,
      executed_at = pg_catalog.now(),
      outcome_summary = target_result_summary
  where workspace_id = locked_execution.workspace_id and id = locked_execution.action_id;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    locked_execution.workspace_id, null, 'system', 'execution.' || target_status,
    'rev_action_execution', locked_execution.id,
    pg_catalog.jsonb_build_object(
      'rev_action_id', locked_execution.action_id,
      'correlation_id', locked_execution.correlation_id,
      'failure_code', target_failure_code
    )
  );

  return updated_execution;
end;
$$;

revoke all on function public.prepare_rev_action_execution(uuid, uuid, text, text, uuid, text, text, text, numeric, text) from public, anon;
grant execute on function public.prepare_rev_action_execution(uuid, uuid, text, text, uuid, text, text, text, numeric, text) to authenticated;
revoke all on function public.record_rev_action_execution_result(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_rev_action_execution_result(uuid, text, text, text, jsonb) to service_role;
