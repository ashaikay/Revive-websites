-- Phase 4G.2A-S semantic idempotency hardening for SEND_APPROVED_EMAIL.
-- This migration does not enable platform/workspace execution or invoke a provider.

do $$
begin
  if exists (
    select 1
    from public.rev_action_executions
    where capability = 'SEND_APPROVED_EMAIL'
    group by workspace_id, action_id, action_version, capability
    having count(*) > 1
  ) then
    raise exception 'SEND_APPROVED_EMAIL semantic duplicates exist; review evidence before migration';
  end if;
  if exists (
    select 1
    from public.rev_action_executions execution
    where execution.capability = 'SEND_APPROVED_EMAIL'
      and (
        execution.status <> 'prepared'
        or execution.started_at is not null
        or execution.completed_at is not null
        or exists (
          select 1 from public.provider_usage_events usage
          where usage.workspace_id = execution.workspace_id and usage.execution_id = execution.id
        )
      )
  ) then
    raise exception 'SEND_APPROVED_EMAIL provider evidence exists; review evidence before migration';
  end if;
end;
$$;

alter table public.rev_action_executions
  add column provider_outcome text;

update public.rev_action_executions
set provider_outcome = 'provider_not_invoked'
where capability = 'SEND_APPROVED_EMAIL';

alter table public.rev_action_executions
  add constraint rev_action_executions_provider_outcome_check check (
    (capability <> 'SEND_APPROVED_EMAIL' and provider_outcome is null)
    or (
      capability = 'SEND_APPROVED_EMAIL'
      and (
        (provider_outcome = 'provider_not_invoked' and status = 'prepared')
        or (provider_outcome = 'provider_attempt_claimed' and status = 'in_progress')
        or (provider_outcome = 'accepted_by_provider' and status = 'succeeded')
        or (provider_outcome in ('rejected_by_provider', 'provider_outcome_unknown') and status = 'failed')
      )
    )
  );

create unique index rev_action_executions_send_email_semantic_unique
  on public.rev_action_executions(workspace_id, action_id, action_version, capability)
  where capability = 'SEND_APPROVED_EMAIL';

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
  effective_idempotency_key text;
  is_email_execution boolean := target_capability = 'SEND_APPROVED_EMAIL';
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

  if not is_email_execution then
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

  if is_email_execution then
    if locked_action.action_type <> 'prepare_follow_up' then
      raise exception 'SEND_APPROVED_EMAIL requires a PREPARE_FOLLOW_UP action';
    end if;
    if target_risk_class <> 'external_communication' then
      raise exception 'SEND_APPROVED_EMAIL requires external_communication risk class';
    end if;
    if target_provider_key is null or pg_catalog.btrim(target_provider_key) = '' then
      raise exception 'SEND_APPROVED_EMAIL requires a provider key';
    end if;
    effective_idempotency_key := 'send-approved-email:' || locked_action.id::text || ':v' || locked_action.action_version::text;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        target_workspace_id::text || ':' || locked_action.id::text || ':'
          || locked_action.action_version::text || ':SEND_APPROVED_EMAIL',
        0
      )
    );
    select * into existing_attempt
    from public.rev_action_executions
    where workspace_id = target_workspace_id
      and action_id = locked_action.id
      and action_version = locked_action.action_version
      and capability = 'SEND_APPROVED_EMAIL';
    if found then
      if existing_attempt.request_fingerprint <> target_request_fingerprint then
        raise exception 'semantic execution conflict';
      end if;
      return existing_attempt;
    end if;
  else
    effective_idempotency_key := target_idempotency_key;
  end if;

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
    workspace_policy_version, jurisdiction, estimated_provider_cost, provider_key, provider_outcome
  ) values (
    target_workspace_id, locked_action.id, bound_approval.id, actor_id, target_capability,
    target_risk_class, 'dry_run', 'prepared', target_correlation_id, effective_idempotency_key,
    target_request_fingerprint, locked_action.action_version, current_fingerprint,
    policy.version, target_jurisdiction, target_estimated_provider_cost, target_provider_key,
    case when is_email_execution then 'provider_not_invoked' else null end
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
  if locked_execution.capability = 'SEND_APPROVED_EMAIL' then
    raise exception 'email provider outcome must use record_email_execution_result';
  end if;
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
      locked_execution.workspace_id, locked_execution.id, event->>'provider_key', event->>'operation',
      event->>'usage_event_key', coalesce((event->>'units')::numeric, 0),
      coalesce((event->>'estimated_provider_cost')::numeric, 0), (event->>'actual_provider_cost')::numeric,
      coalesce(event->>'currency', 'GBP'), event->>'provider_reference', locked_execution.correlation_id,
      coalesce(event->>'status', 'succeeded'), coalesce((event->>'occurred_at')::timestamptz, pg_catalog.now())
    );
  end loop;

  update public.rev_action_executions
  set status = target_status, started_at = coalesce(started_at, pg_catalog.now()),
      completed_at = pg_catalog.now(), result_summary = target_result_summary, failure_code = target_failure_code
  where id = locked_execution.id
  returning * into updated_execution;

  update public.rev_actions
  set status = case when target_status = 'succeeded' then 'completed' else 'failed' end,
      execution_status = case when target_status = 'succeeded' then 'succeeded' else 'failed' end,
      executed_at = pg_catalog.now(), outcome_summary = target_result_summary
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

create or replace function public.record_email_execution_result(
  target_execution_id uuid,
  target_provider_outcome text,
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
  terminal_status text;
  usage_status text;
  safe_summary text;
  updated_execution public.rev_action_executions;
begin
  if current_user <> 'service_role' then raise exception 'trusted backend role required'; end if;
  if target_provider_outcome not in ('accepted_by_provider', 'rejected_by_provider', 'provider_outcome_unknown') then
    raise exception 'terminal email provider outcome required';
  end if;
  if pg_catalog.jsonb_typeof(usage_events) <> 'array' then raise exception 'usage_events must be an array'; end if;
  if pg_catalog.jsonb_array_length(usage_events) <> 1 then
    raise exception 'exactly one email provider usage event required';
  end if;

  select * into locked_execution
  from public.rev_action_executions
  where id = target_execution_id
  for update;
  if not found then raise exception 'execution not found'; end if;
  if locked_execution.capability <> 'SEND_APPROVED_EMAIL'
    or locked_execution.status <> 'in_progress'
    or locked_execution.provider_outcome <> 'provider_attempt_claimed' then
    raise exception 'email provider attempt is not awaiting a result';
  end if;

  terminal_status := case when target_provider_outcome = 'accepted_by_provider' then 'succeeded' else 'failed' end;
  usage_status := case
    when target_provider_outcome = 'accepted_by_provider' then 'succeeded'
    when target_provider_outcome = 'rejected_by_provider' then 'failed'
    else 'ambiguous'
  end;
  safe_summary := case
    when target_provider_outcome = 'accepted_by_provider' then 'Accepted by provider; delivery remains unknown.'
    when target_provider_outcome = 'rejected_by_provider' then coalesce(target_result_summary, 'Rejected by provider; no delivery recorded.')
    else 'Provider outcome unknown; automatic retry prohibited.'
  end;

  for event in select value from pg_catalog.jsonb_array_elements(usage_events)
  loop
    if event->>'provider_key' is distinct from locked_execution.provider_key then
      raise exception 'provider usage key does not match execution';
    end if;
    insert into public.provider_usage_events (
      workspace_id, execution_id, provider_key, operation, usage_event_key, units,
      estimated_provider_cost, actual_provider_cost, currency, provider_reference,
      correlation_id, status, occurred_at
    ) values (
      locked_execution.workspace_id, locked_execution.id, locked_execution.provider_key,
      coalesce(event->>'operation', 'send_email'), event->>'usage_event_key',
      coalesce((event->>'units')::numeric, 0), coalesce((event->>'estimated_provider_cost')::numeric, 0),
      (event->>'actual_provider_cost')::numeric, coalesce(event->>'currency', 'GBP'),
      event->>'provider_reference', locked_execution.correlation_id, usage_status,
      coalesce((event->>'occurred_at')::timestamptz, pg_catalog.now())
    );
  end loop;

  update public.rev_action_executions
  set status = terminal_status, provider_outcome = target_provider_outcome,
      completed_at = pg_catalog.now(), result_summary = safe_summary, failure_code = target_failure_code
  where id = locked_execution.id
  returning * into updated_execution;

  update public.rev_actions
  set status = case when target_provider_outcome = 'accepted_by_provider' then 'completed' else 'failed' end,
      execution_status = case when target_provider_outcome = 'accepted_by_provider' then 'succeeded' else 'failed' end,
      executed_at = pg_catalog.now(), outcome_summary = safe_summary
  where workspace_id = locked_execution.workspace_id and id = locked_execution.action_id;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    locked_execution.workspace_id, null, 'system', 'execution.' || target_provider_outcome,
    'rev_action_execution', locked_execution.id,
    pg_catalog.jsonb_build_object(
      'rev_action_id', locked_execution.action_id,
      'correlation_id', locked_execution.correlation_id,
      'provider_outcome', target_provider_outcome,
      'delivery_confirmed', false,
      'failure_code', target_failure_code
    )
  );
  return updated_execution;
end;
$$;

revoke all on function public.claim_rev_action_provider_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_rev_action_provider_attempt(uuid, text) to service_role;
revoke all on function public.record_email_execution_result(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_email_execution_result(uuid, text, text, text, jsonb) to service_role;

-- Preserve the Phase 4C ACLs on replaced functions.
revoke all on function public.prepare_rev_action_execution(uuid, uuid, text, text, uuid, text, text, text, numeric, text) from public, anon;
grant execute on function public.prepare_rev_action_execution(uuid, uuid, text, text, uuid, text, text, text, numeric, text) to authenticated;
revoke all on function public.record_rev_action_execution_result(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_rev_action_execution_result(uuid, text, text, text, jsonb) to service_role;