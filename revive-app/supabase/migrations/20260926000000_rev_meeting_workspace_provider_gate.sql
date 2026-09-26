-- Scope the previously global meeting provider gate to exactly one workspace.
-- Fail closed on migration even if a local/global gate had previously been enabled.
alter table public.rev_meeting_provider_gate add column allowed_workspace_id uuid;
update public.rev_meeting_provider_gate set enabled = false, allowed_workspace_id = null where singleton;
alter table public.rev_meeting_provider_gate add constraint rev_meeting_provider_gate_scoped_check
  check (not enabled or allowed_workspace_id is not null);

create or replace function public.claim_rev_meeting_provider_attempt(
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
  -- Discover lock keys without locking, then lock in reservation order.
  select * into snapshot from public.rev_action_executions where id = target_execution_id;
  if not found or snapshot.capability <> 'CREATE_APPROVED_MEETING_EVENT' then
    raise exception 'meeting execution required';
  end if;
  -- Lock the gate for this claim transaction and restrict it to this execution's workspace.
  if not exists (select 1 from public.rev_meeting_provider_gate
    where singleton and enabled and allowed_workspace_id = snapshot.workspace_id for share) then
    raise exception 'meeting provider gateway is disabled for workspace';
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

revoke all on function public.claim_rev_meeting_provider_attempt(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.claim_rev_meeting_provider_attempt(uuid, text, bigint) to service_role;
