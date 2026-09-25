-- Phase 5P: meeting-only durable reservation. No calendar event, invitation, provider claim or deployment.
-- Forward migration after Phase 5J and the Phase 4G.2A-S email semantic migration.
-- A trusted service must provision a binding and workspace policy separately; defaults fail closed.

create table public.rev_meeting_calendar_bindings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  provider_key text not null check (provider_key = 'microsoft_graph'),
  calendar_reference text not null check (pg_catalog.length(pg_catalog.btrim(calendar_reference)) > 0),
  timezone text not null check (pg_catalog.length(pg_catalog.btrim(timezone)) > 0),
  enabled boolean not null default false,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
alter table public.rev_meeting_calendar_bindings enable row level security;
revoke all on table public.rev_meeting_calendar_bindings from public, anon, authenticated;
grant select, insert, update on table public.rev_meeting_calendar_bindings to service_role;
-- No client RLS policy, read or write grant. Provision only through reviewed trusted operations.

do $$
begin
  if exists (select 1 from public.rev_action_executions where capability = 'CREATE_APPROVED_MEETING_EVENT') then
    raise exception 'Existing meeting execution evidence requires manual review before migration';
  end if;
end;
$$;

alter table public.rev_action_executions drop constraint rev_action_executions_provider_outcome_check;
alter table public.rev_action_executions add constraint rev_action_executions_provider_outcome_check check (
  (capability not in ('SEND_APPROVED_EMAIL', 'CREATE_APPROVED_MEETING_EVENT') and provider_outcome is null)
  or (capability = 'CREATE_APPROVED_MEETING_EVENT' and provider_outcome = 'provider_not_invoked' and status = 'prepared' and mode = 'dry_run')
  or (capability = 'SEND_APPROVED_EMAIL' and (
    (provider_outcome = 'provider_not_invoked' and status = 'prepared')
    or (provider_outcome = 'provider_attempt_claimed' and status = 'in_progress')
    or (provider_outcome = 'accepted_by_provider' and status = 'succeeded')
    or (provider_outcome in ('rejected_by_provider', 'provider_outcome_unknown') and status = 'failed')
  ))
);
create unique index rev_action_executions_meeting_semantic_unique
  on public.rev_action_executions(workspace_id, action_id, action_version, capability)
  where capability = 'CREATE_APPROVED_MEETING_EVENT';

-- Exact signature has only caller identifiers. Every material field is loaded inside this transaction.
create function public.reserve_rev_meeting_event_execution(
  target_request_id uuid,
  target_workspace_id uuid,
  target_action_id uuid
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
  proposal public.meeting_proposals;
  bound_approval public.approvals;
  binding public.rev_meeting_calendar_bindings;
  existing_attempt public.rev_action_executions;
  created_attempt public.rev_action_executions;
  current_fingerprint text;
  request_fingerprint text;
  effective_idempotency_key text;
  monthly_committed numeric(12,4);
  start_at timestamptz;
  end_at timestamptz;
begin
  actor_id := auth.uid();
  if actor_id is null or target_request_id is null or target_workspace_id is null or target_action_id is null then
    raise exception 'authenticated request and identifiers required';
  end if;
  if not public.has_workspace_role(target_workspace_id, array['owner', 'admin']) then
    raise exception 'active owner or admin role required';
  end if;
  select * into policy from public.workspace_execution_policies
    where workspace_id = target_workspace_id for update;
  if not found or not policy.execution_enabled or policy.autonomy_mode <> 'always_ask'
    or 'CREATE_APPROVED_MEETING_EVENT' = any(policy.disabled_capabilities) then
    raise exception 'meeting execution policy is disabled';
  end if;

  select * into locked_action from public.rev_actions
    where workspace_id = target_workspace_id and id = target_action_id for update;
  if not found or locked_action.action_type <> 'meeting_proposal'
    or locked_action.status <> 'approved' or locked_action.execution_status <> 'not_executed' then
    raise exception 'approved meeting action required';
  end if;

  select * into proposal from public.meeting_proposals
    where workspace_id = target_workspace_id and rev_action_id = target_action_id for update;
  if not found or proposal.proposal_version <> locked_action.action_version
    or proposal.proposal_payload->>'version' <> proposal.proposal_version::text then
    raise exception 'current meeting proposal version required';
  end if;
  if proposal.proposal_payload->>'meetingMethod' not in ('online', 'phone', 'in_person')
    or pg_catalog.length(pg_catalog.btrim(coalesce(proposal.proposal_payload->>'title',''))) not between 1 and 120
    or coalesce(proposal.proposal_payload->>'attendeeEmail','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid trusted proposal snapshot';
  end if;
  start_at := (proposal.proposal_payload->>'startAt')::timestamptz;
  end_at := (proposal.proposal_payload->>'endAt')::timestamptz;
  if start_at <= pg_catalog.now() or end_at <= start_at
    or extract(epoch from (end_at-start_at))/60 not in (30,60) then
    raise exception 'meeting interval is no longer valid';
  end if;

  select * into binding from public.rev_meeting_calendar_bindings
    where workspace_id = target_workspace_id for update;
  if not found or not binding.enabled or binding.provider_key <> 'microsoft_graph'
    or proposal.proposal_payload->>'timezone' <> binding.timezone then
    raise exception 'trusted calendar binding unavailable';
  end if;

  current_fingerprint := public.rev_action_material_fingerprint(locked_action);
  select * into bound_approval from public.approvals
    where workspace_id = target_workspace_id and rev_action_id = target_action_id
      and id = proposal.approval_id and decision = 'approved'
      and action_version = locked_action.action_version
      and action_fingerprint = current_fingerprint
    for update;
  if not found then raise exception 'fresh bound meeting approval required'; end if;

  -- Canonical server-side snapshot: request identifiers cannot substitute title, attendee,
  -- interval, timezone, calendar, version or approval material.
  request_fingerprint := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'workspaceId', target_workspace_id, 'actionId', target_action_id,
      'actionVersion', locked_action.action_version, 'actionFingerprint', current_fingerprint,
      'proposalVersion', proposal.proposal_version, 'proposal', proposal.proposal_payload,
      'calendarReference', binding.calendar_reference, 'calendarBindingVersion', binding.version,
      'provider', binding.provider_key
    )::text, 'UTF8'), 'sha256'), 'hex');
  effective_idempotency_key := 'create-approved-meeting-event:' || target_action_id::text || ':v' || locked_action.action_version::text;

  -- Action row lock serializes competing requests for the same action; the unique index
  -- is a second durable safeguard. Replays revalidate all policy/approval/binding above.
  select * into existing_attempt from public.rev_action_executions
    where workspace_id = target_workspace_id and action_id = target_action_id
      and action_version = locked_action.action_version
      and capability = 'CREATE_APPROVED_MEETING_EVENT';
  if found then
    if existing_attempt.request_fingerprint <> request_fingerprint
      or existing_attempt.provider_outcome <> 'provider_not_invoked'
      or existing_attempt.status <> 'prepared' then
      raise exception 'meeting reservation conflict';
    end if;
    return existing_attempt;
  end if;

  select coalesce(pg_catalog.sum(usage.actual_provider_cost), 0) + coalesce((
    select pg_catalog.sum(execution.estimated_provider_cost)
    from public.rev_action_executions execution
    where execution.workspace_id = target_workspace_id
      and execution.status in ('prepared', 'in_progress')
      and execution.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
  ), 0) into monthly_committed from public.provider_usage_events usage
    where usage.workspace_id = target_workspace_id
      and usage.occurred_at >= pg_catalog.date_trunc('month', pg_catalog.now());
  if monthly_committed > policy.monthly_provider_cost_ceiling then
    raise exception 'monthly provider cost ceiling exceeded';
  end if;

  insert into public.rev_action_executions (
    workspace_id, action_id, approval_id, requested_by, capability, risk_class,
    mode, status, correlation_id, idempotency_key, request_fingerprint,
    action_version, approval_fingerprint, workspace_policy_version, jurisdiction,
    estimated_provider_cost, provider_key, provider_outcome
  ) values (
    target_workspace_id, target_action_id, bound_approval.id, actor_id,
    'CREATE_APPROVED_MEETING_EVENT', 'external_communication', 'dry_run', 'prepared',
    target_request_id, effective_idempotency_key, request_fingerprint,
    locked_action.action_version, current_fingerprint, policy.version, 'GB', 0,
    binding.provider_key, 'provider_not_invoked'
  ) returning * into created_attempt;
  insert into public.audit_log (workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata)
  values (target_workspace_id, actor_id, 'user', 'meeting_execution.reserved',
    'rev_action_execution', created_attempt.id,
    pg_catalog.jsonb_build_object('action_id', target_action_id, 'correlation_id', created_attempt.correlation_id,
      'capability', 'CREATE_APPROVED_MEETING_EVENT', 'provider_invoked', false));
  return created_attempt;
end;
$$;
revoke all on function public.reserve_rev_meeting_event_execution(uuid, uuid, uuid) from public, anon;
grant execute on function public.reserve_rev_meeting_event_execution(uuid, uuid, uuid) to authenticated;
