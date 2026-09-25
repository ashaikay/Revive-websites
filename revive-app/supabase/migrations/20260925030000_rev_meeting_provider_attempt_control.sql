-- Phase 5W: durable meeting provider attempt lifecycle. Gate defaults OFF.
-- No Edge Function invokes these service-role-only RPCs in this phase.
create table public.rev_meeting_provider_gate (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default pg_catalog.now()
);
insert into public.rev_meeting_provider_gate (singleton, enabled) values (true, false);
alter table public.rev_meeting_provider_gate enable row level security;
revoke all on public.rev_meeting_provider_gate from public, anon, authenticated;
grant select on public.rev_meeting_provider_gate to service_role;

alter table public.rev_action_executions drop constraint rev_action_executions_provider_outcome_check;
alter table public.rev_action_executions add constraint rev_action_executions_provider_outcome_check check (
  (capability not in ('SEND_APPROVED_EMAIL', 'CREATE_APPROVED_MEETING_EVENT') and provider_outcome is null)
  or (capability in ('SEND_APPROVED_EMAIL', 'CREATE_APPROVED_MEETING_EVENT') and (
    (provider_outcome = 'provider_not_invoked' and status = 'prepared' and mode = 'dry_run')
    or (provider_outcome = 'provider_attempt_claimed' and status = 'in_progress' and mode = 'live')
    or (provider_outcome = 'accepted_by_provider' and status = 'succeeded' and mode = 'live')
    or (provider_outcome in ('rejected_by_provider', 'provider_outcome_unknown') and status = 'failed' and mode = 'live')
  ))
);

create function public.claim_rev_meeting_provider_attempt(
  target_execution_id uuid, expected_request_fingerprint text, expected_binding_version bigint
)
returns public.rev_action_executions
language plpgsql security invoker set search_path = '' as $$
declare
  snapshot public.rev_action_executions;
  policy public.workspace_execution_policies;
  action public.rev_actions;
  proposal public.meeting_proposals;
  binding public.rev_meeting_calendar_bindings;
  approval public.approvals;
  execution public.rev_action_executions;
  claimed public.rev_action_executions;
  fingerprint text;
begin
  if current_user <> 'service_role' then raise exception 'trusted backend role required'; end if;
  if target_execution_id is null or expected_request_fingerprint !~ '^[0-9a-f]{64}$'
    or expected_binding_version is null or expected_binding_version < 1 then
    raise exception 'valid trusted meeting claim required';
  end if;
  if not exists (select 1 from public.rev_meeting_provider_gate where singleton and enabled for share) then
    raise exception 'meeting provider gateway is disabled';
  end if;
  -- Discover lock keys without locking, then lock in reservation order.
  select * into snapshot from public.rev_action_executions where id = target_execution_id;
  if not found or snapshot.capability <> 'CREATE_APPROVED_MEETING_EVENT' then
    raise exception 'meeting execution required';
  end if;
  select * into policy from public.workspace_execution_policies
    where workspace_id = snapshot.workspace_id for update;
  if not found or not policy.execution_enabled or policy.autonomy_mode <> 'always_ask'
    or 'CREATE_APPROVED_MEETING_EVENT' = any(policy.disabled_capabilities) then
    raise exception 'meeting execution policy is disabled';
  end if;
  select * into action from public.rev_actions
    where workspace_id = snapshot.workspace_id and id = snapshot.action_id for update;
  if not found or action.action_type <> 'meeting_proposal' or action.status <> 'approved'
    or action.execution_status <> 'not_executed' or action.action_version <> snapshot.action_version then
    raise exception 'approved meeting action required';
  end if;
  select * into proposal from public.meeting_proposals
    where workspace_id = snapshot.workspace_id and rev_action_id = action.id for update;
  if not found or proposal.proposal_version <> action.action_version then
    raise exception 'current meeting proposal required';
  end if;
  if (proposal.proposal_payload->>'startAt')::timestamptz <= pg_catalog.now()
    or (proposal.proposal_payload->>'endAt')::timestamptz <= (proposal.proposal_payload->>'startAt')::timestamptz then
    raise exception 'meeting interval is no longer valid';
  end if;
  select * into binding from public.rev_meeting_calendar_bindings
    where workspace_id = snapshot.workspace_id for update;
  if not found or not binding.enabled or binding.provider_key <> 'microsoft_graph'
    or binding.version <> expected_binding_version
    or binding.timezone <> proposal.proposal_payload->>'timezone' then
    raise exception 'trusted meeting binding changed';
  end if;
  select * into approval from public.approvals
    where workspace_id = snapshot.workspace_id and id = snapshot.approval_id
      and rev_action_id = action.id and decision = 'approved'
      and action_version = action.action_version
      and action_fingerprint = public.rev_action_material_fingerprint(action) for update;
  if not found then raise exception 'fresh bound approval required'; end if;
  select * into execution from public.rev_action_executions
    where id = target_execution_id for update;
  if not found or execution.workspace_id <> snapshot.workspace_id or execution.action_id <> action.id
    or execution.status <> 'prepared' or execution.mode <> 'dry_run'
    or execution.provider_outcome <> 'provider_not_invoked'
    or execution.request_fingerprint <> expected_request_fingerprint
    or execution.approval_fingerprint <> public.rev_action_material_fingerprint(action)
    or execution.provider_key <> binding.provider_key then
    raise exception 'meeting provider attempt is not claimable';
  end if;
  fingerprint := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'workspaceId', snapshot.workspace_id, 'actionId', action.id,
      'actionVersion', action.action_version, 'actionFingerprint', execution.approval_fingerprint,
      'proposalVersion', proposal.proposal_version, 'proposal', proposal.proposal_payload,
      'calendarReference', binding.calendar_reference, 'calendarBindingVersion', binding.version,
      'provider', binding.provider_key
    )::text, 'UTF8'), 'sha256'), 'hex');
  if fingerprint <> execution.request_fingerprint then raise exception 'meeting snapshot changed'; end if;
  update public.rev_action_executions set mode = 'live', status = 'in_progress',
    provider_outcome = 'provider_attempt_claimed', started_at = pg_catalog.now()
    where id = execution.id returning * into claimed;
  insert into public.audit_log (workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata)
    values (execution.workspace_id, null, 'system', 'meeting_execution.provider_attempt_claimed',
      'rev_action_execution', execution.id,
      pg_catalog.jsonb_build_object('action_id', action.id, 'correlation_id', execution.correlation_id));
  return claimed;
end;
$$;

create function public.record_rev_meeting_provider_result(
  target_execution_id uuid, target_provider_outcome text, target_provider_reference text default null
)
returns public.rev_action_executions
language plpgsql security invoker set search_path = '' as $$
declare
  snapshot public.rev_action_executions;
  action public.rev_actions;
  execution public.rev_action_executions;
  recorded public.rev_action_executions;
  terminal_status text;
  safe_summary text;
begin
  if current_user <> 'service_role' then raise exception 'trusted backend role required'; end if;
  if target_provider_outcome not in ('accepted_by_provider', 'rejected_by_provider', 'provider_outcome_unknown') then
    raise exception 'terminal meeting outcome required';
  end if;
  if target_provider_reference is not null and pg_catalog.length(target_provider_reference) > 300 then
    raise exception 'invalid provider reference';
  end if;
  if target_provider_outcome = 'accepted_by_provider' and pg_catalog.btrim(coalesce(target_provider_reference, '')) = '' then
    raise exception 'accepted provider event reference required';
  end if;
  select * into snapshot from public.rev_action_executions where id = target_execution_id;
  if not found or snapshot.capability <> 'CREATE_APPROVED_MEETING_EVENT' then
    raise exception 'meeting execution required';
  end if;
  -- Same action -> execution lock order as claim; no claim/result inversion.
  select * into action from public.rev_actions
    where workspace_id = snapshot.workspace_id and id = snapshot.action_id for update;
  if not found then raise exception 'meeting action unavailable'; end if;
  select * into execution from public.rev_action_executions where id = target_execution_id for update;
  if not found or execution.workspace_id <> snapshot.workspace_id or execution.action_id <> action.id
    or execution.status <> 'in_progress' or execution.mode <> 'live'
    or execution.provider_outcome <> 'provider_attempt_claimed' then
    raise exception 'meeting provider attempt is not awaiting result';
  end if;
  terminal_status := case when target_provider_outcome = 'accepted_by_provider' then 'succeeded' else 'failed' end;
  safe_summary := case target_provider_outcome
    when 'accepted_by_provider' then 'Calendar event accepted by provider; attendee delivery not confirmed.'
    when 'rejected_by_provider' then 'Calendar event rejected by provider.'
    else 'Calendar event outcome unknown; automatic retry prohibited.' end;
  insert into public.provider_usage_events (
    workspace_id, execution_id, provider_key, operation, usage_event_key, units,
    estimated_provider_cost, actual_provider_cost, currency, provider_reference,
    correlation_id, status
  ) values (
    execution.workspace_id, execution.id, execution.provider_key, 'create_calendar_event',
    'create-meeting-event:' || execution.id::text, 1, execution.estimated_provider_cost, null,
    'GBP', target_provider_reference, execution.correlation_id,
    case target_provider_outcome when 'accepted_by_provider' then 'succeeded'
      when 'rejected_by_provider' then 'failed' else 'ambiguous' end
  );
  update public.rev_action_executions set status = terminal_status,
    provider_outcome = target_provider_outcome, completed_at = pg_catalog.now(),
    result_summary = safe_summary,
    failure_code = case when target_provider_outcome = 'accepted_by_provider' then null
      else target_provider_outcome end
    where id = execution.id returning * into recorded;
  update public.rev_actions set status = case when terminal_status = 'succeeded' then 'completed' else 'failed' end,
    execution_status = terminal_status, executed_at = pg_catalog.now(), outcome_summary = safe_summary
    where workspace_id = execution.workspace_id and id = execution.action_id;
  insert into public.audit_log (workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata)
    values (execution.workspace_id, null, 'system', 'meeting_execution.' || target_provider_outcome,
      'rev_action_execution', execution.id,
      pg_catalog.jsonb_build_object('action_id', execution.action_id,
        'correlation_id', execution.correlation_id, 'provider_outcome', target_provider_outcome));
  return recorded;
end;
$$;

revoke all on function public.claim_rev_meeting_provider_attempt(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.claim_rev_meeting_provider_attempt(uuid, text, bigint) to service_role;
revoke all on function public.record_rev_meeting_provider_result(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_rev_meeting_provider_result(uuid, text, text) to service_role;
