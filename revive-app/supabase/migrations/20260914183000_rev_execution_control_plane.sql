-- REV Phase 4C durable execution control-plane foundation.
-- Local rehearsal only until a separately approved production migration procedure.
-- This migration does not enable platform execution or call any provider.

create table if not exists public.workspace_execution_policies (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  execution_enabled boolean not null default false,
  autonomy_mode text not null default 'always_ask'
    check (autonomy_mode in ('always_ask', 'trusted_routine_actions', 'ask_above_threshold', 'disabled')),
  per_attempt_provider_cost_ceiling numeric(12, 4) not null default 0
    check (per_attempt_provider_cost_ceiling >= 0),
  monthly_provider_cost_ceiling numeric(12, 4) not null default 0
    check (monthly_provider_cost_ceiling >= 0),
  approval_cost_threshold numeric(12, 4) not null default 0
    check (approval_cost_threshold >= 0),
  disabled_capabilities text[] not null default '{}'::text[],
  version bigint not null default 1 check (version > 0),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rev_actions
  add column if not exists action_version bigint not null default 1
  check (action_version > 0);

update public.rev_actions
set execution_status = 'not_executed'
where execution_status = 'not_started';

alter table public.rev_actions
  alter column execution_status set default 'not_executed';

alter table public.approvals
  add column if not exists action_version bigint,
  add column if not exists action_fingerprint text;

alter table public.approvals
  drop constraint if exists approvals_action_binding_shape_check;
alter table public.approvals
  add constraint approvals_action_binding_shape_check check (
    (action_version is null and action_fingerprint is null)
    or (action_version is not null and action_version > 0 and action_fingerprint ~ '^[0-9a-f]{64}$')
  );

alter table public.approvals
  drop constraint if exists approvals_workspace_action_id_key;
alter table public.approvals
  add constraint approvals_workspace_action_id_key unique (workspace_id, rev_action_id, id);

create table if not exists public.rev_action_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  action_id uuid not null,
  approval_id uuid,
  requested_by uuid not null references auth.users(id),
  capability text not null,
  risk_class text not null
    check (risk_class in ('read_only', 'prepare_only', 'internal_write', 'external_communication', 'financial', 'high_risk')),
  mode text not null default 'dry_run' check (mode in ('dry_run', 'live')),
  status text not null default 'prepared'
    check (status in ('prepared', 'in_progress', 'succeeded', 'failed', 'cancelled')),
  correlation_id uuid not null default gen_random_uuid(),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  action_version bigint not null check (action_version > 0),
  approval_fingerprint text,
  workspace_policy_version bigint not null check (workspace_policy_version > 0),
  jurisdiction text,
  estimated_provider_cost numeric(12, 4) not null default 0 check (estimated_provider_cost >= 0),
  provider_key text,
  started_at timestamptz,
  completed_at timestamptz,
  result_summary text,
  failure_code text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, correlation_id),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, action_id) references public.rev_actions(workspace_id, id),
  foreign key (workspace_id, action_id, approval_id)
    references public.approvals(workspace_id, rev_action_id, id),
  check (approval_fingerprint is null or approval_fingerprint ~ '^[0-9a-f]{64}$'),
  check (
    (status = 'prepared' and started_at is null and completed_at is null)
    or (status = 'in_progress' and started_at is not null and completed_at is null)
    or (status in ('succeeded', 'failed', 'cancelled') and completed_at is not null)
  )
);

create table if not exists public.provider_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  execution_id uuid,
  provider_key text not null,
  operation text not null,
  usage_event_key text not null check (char_length(usage_event_key) between 1 and 200),
  units numeric(14, 4) not null default 0 check (units >= 0),
  estimated_provider_cost numeric(12, 4) not null default 0 check (estimated_provider_cost >= 0),
  actual_provider_cost numeric(12, 4) check (actual_provider_cost is null or actual_provider_cost >= 0),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  provider_reference text,
  correlation_id uuid not null,
  status text not null check (status in ('estimated', 'succeeded', 'failed', 'ambiguous')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, provider_key, usage_event_key),
  foreign key (workspace_id, execution_id)
    references public.rev_action_executions(workspace_id, id)
);

create index if not exists rev_action_executions_action_idx
  on public.rev_action_executions(workspace_id, action_id, created_at desc);
create index if not exists rev_action_executions_status_idx
  on public.rev_action_executions(workspace_id, status, created_at);
create index if not exists provider_usage_workspace_time_idx
  on public.provider_usage_events(workspace_id, occurred_at desc);
create index if not exists provider_usage_execution_idx
  on public.provider_usage_events(workspace_id, execution_id);

create or replace function public.rev_action_material_fingerprint(target_action public.rev_actions)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'id', target_action.id,
          'workspace_id', target_action.workspace_id,
          'goal_id', target_action.goal_id,
          'contact_id', target_action.contact_id,
          'opportunity_id', target_action.opportunity_id,
          'action_type', target_action.action_type,
          'title', target_action.title,
          'description', target_action.description,
          'rationale', target_action.rationale,
          'requires_approval', target_action.requires_approval,
          'action_version', target_action.action_version
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.protect_rev_action_material_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  trusted_actor boolean := current_user in ('postgres', 'service_role');
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.id is distinct from old.id
    or new.proposed_at is distinct from old.proposed_at then
    raise exception 'REV action identity is immutable';
  end if;

  if not trusted_actor and (
    new.execution_status is distinct from old.execution_status
    or new.executed_at is distinct from old.executed_at
    or new.outcome_summary is distinct from old.outcome_summary
  ) then
    raise exception 'REV action execution evidence is trusted-backend-only';
  end if;

  if new.goal_id is distinct from old.goal_id
    or new.contact_id is distinct from old.contact_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.action_type is distinct from old.action_type
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.rationale is distinct from old.rationale
    or new.requires_approval is distinct from old.requires_approval then
    if old.execution_status in ('in_progress', 'succeeded') then
      raise exception 'Material action fields cannot change after execution starts';
    end if;
    new.action_version := old.action_version + 1;
    new.status := case when new.requires_approval then 'awaiting_approval' else 'proposed' end;
    new.approved_at := null;
  elsif new.action_version is distinct from old.action_version then
    raise exception 'action_version is managed by the database';
  end if;

  if not trusted_actor and new.status is distinct from old.status then
    if new.status not in ('proposed', 'awaiting_approval', 'cancelled') then
      raise exception 'Authoritative REV action transitions require a trusted transaction';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_workspace_execution_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Workspace execution policy identity is immutable';
  end if;
  new.version := old.version + 1;
  new.updated_by := auth.uid();
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function public.prevent_append_only_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create or replace function public.decide_rev_action_approval(
  target_approval_id uuid,
  expected_action_version bigint,
  expected_action_fingerprint text,
  approval_decision text,
  decision_notes text default null
)
returns public.approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  locked_approval public.approvals;
  locked_action public.rev_actions;
  computed_fingerprint text;
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'authenticated user required';
  end if;
  if approval_decision not in ('approved', 'rejected') then
    raise exception 'approval decision must be approved or rejected';
  end if;

  select * into locked_approval
  from public.approvals
  where id = target_approval_id
  for update;
  if not found then raise exception 'approval not found'; end if;

  if not public.has_workspace_role(locked_approval.workspace_id, array['owner', 'admin']) then
    raise exception 'active owner or admin role required';
  end if;

  select * into locked_action
  from public.rev_actions
  where workspace_id = locked_approval.workspace_id
    and id = locked_approval.rev_action_id
  for update;
  if not found then raise exception 'REV action not found'; end if;

  if locked_approval.decision is not null or locked_approval.decided_at is not null then
    raise exception 'approval is already decided';
  end if;
  if locked_action.status <> 'awaiting_approval' or locked_action.execution_status <> 'not_executed' then
    raise exception 'REV action is not pending approval';
  end if;

  computed_fingerprint := public.rev_action_material_fingerprint(locked_action);
  if locked_action.action_version <> expected_action_version
    or computed_fingerprint <> expected_action_fingerprint then
    raise exception 'stale approval review';
  end if;

  update public.approvals
  set decision = approval_decision,
      decided_at = pg_catalog.now(),
      decided_by = actor_id,
      notes = decision_notes,
      action_version = locked_action.action_version,
      action_fingerprint = computed_fingerprint
  where id = locked_approval.id
  returning * into locked_approval;

  update public.rev_actions
  set status = case when approval_decision = 'approved' then 'approved' else 'rejected' end,
      approved_at = case when approval_decision = 'approved' then pg_catalog.now() else null end
  where workspace_id = locked_action.workspace_id and id = locked_action.id;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    locked_action.workspace_id,
    actor_id,
    'user',
    'approval.' || approval_decision,
    'approval',
    locked_approval.id,
    pg_catalog.jsonb_build_object(
      'rev_action_id', locked_action.id,
      'action_version', locked_action.action_version,
      'action_fingerprint', computed_fingerprint
    )
  );

  return locked_approval;
end;
$$;

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

create trigger rev_actions_material_and_transition_guard
  before update on public.rev_actions
  for each row execute function public.protect_rev_action_material_changes();
create trigger workspace_execution_policy_update_guard
  before update on public.workspace_execution_policies
  for each row execute function public.protect_workspace_execution_policy();
create trigger provider_usage_events_append_only
  before update or delete on public.provider_usage_events
  for each row execute function public.prevent_append_only_evidence_mutation();
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.prevent_append_only_evidence_mutation();
create trigger approvals_decision_immutable
  before update or delete on public.approvals
  for each row
  when (old.decision is not null)
  execute function public.prevent_append_only_evidence_mutation();

alter table public.workspace_execution_policies enable row level security;
alter table public.rev_action_executions enable row level security;
alter table public.provider_usage_events enable row level security;

-- Replace broad active-member policies with role-specific operations.
drop policy if exists rev_actions_tenant on public.rev_actions;
create policy rev_actions_select on public.rev_actions for select
  using (public.is_active_workspace_member(workspace_id));
create policy rev_actions_insert on public.rev_actions for insert
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
    and status in ('proposed', 'awaiting_approval')
    and execution_status = 'not_executed'
    and action_version = 1
    and approved_at is null and executed_at is null and outcome_summary is null
  );
create policy rev_actions_update_proposal on public.rev_actions for update
  using (
    public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
    and status in ('proposed', 'awaiting_approval')
    and execution_status = 'not_executed'
  )
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
    and status in ('proposed', 'awaiting_approval', 'cancelled')
    and execution_status = 'not_executed'
    and approved_at is null and executed_at is null and outcome_summary is null
  );

drop policy if exists approvals_tenant on public.approvals;
create policy approvals_select on public.approvals for select
  using (public.is_active_workspace_member(workspace_id));
create policy approvals_insert_pending on public.approvals for insert
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
    and decision is null and decided_at is null and decided_by is null
    and action_version is null and action_fingerprint is null
  );

drop policy if exists audit_log_insert on public.audit_log;
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select_owner_admin on public.audit_log for select
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

drop policy if exists memory_events_tenant on public.business_memory_events;
create policy memory_events_select on public.business_memory_events for select
  using (public.is_active_workspace_member(workspace_id));
create policy memory_events_insert_user on public.business_memory_events for insert
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
    and created_by_type = 'user' and created_by_id = auth.uid()
  );

drop policy if exists goals_tenant on public.goals;
create policy goals_select on public.goals for select
  using (public.is_active_workspace_member(workspace_id));
create policy goals_insert on public.goals for insert
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']));
create policy goals_update on public.goals for update
  using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']));

drop policy if exists opportunities_insert on public.opportunities;
drop policy if exists opportunities_update on public.opportunities;
create policy opportunities_insert_role_safe on public.opportunities for insert
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
    and created_by_type = 'user'
  );
create policy opportunities_update_role_safe on public.opportunities for update
  using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']));

create policy workspace_execution_policies_select on public.workspace_execution_policies for select
  using (public.is_active_workspace_member(workspace_id));
create policy workspace_execution_policies_insert on public.workspace_execution_policies for insert
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin'])
    and updated_by = auth.uid()
  );
create policy workspace_execution_policies_update on public.workspace_execution_policies for update
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
  with check (
    public.has_workspace_role(workspace_id, array['owner', 'admin'])
    and updated_by = auth.uid()
  );

create policy rev_action_executions_select on public.rev_action_executions for select
  using (public.is_active_workspace_member(workspace_id));
create policy provider_usage_events_select on public.provider_usage_events for select
  using (public.is_active_workspace_member(workspace_id));

-- Explicit table privileges: RLS is not the only write boundary.
revoke all on table public.workspace_execution_policies from anon, authenticated;
revoke all on table public.rev_action_executions from anon, authenticated;
revoke all on table public.provider_usage_events from anon, authenticated;
revoke all on table public.rev_actions from anon, authenticated;
revoke all on table public.approvals from anon, authenticated;
revoke all on table public.audit_log from anon, authenticated;
grant select on table public.workspace_execution_policies to authenticated;
grant select on table public.rev_action_executions to authenticated;
grant select on table public.provider_usage_events to authenticated;
grant insert, update on table public.workspace_execution_policies to authenticated;
grant select, insert, update on table public.rev_actions to authenticated;
grant select, insert on table public.approvals to authenticated;
grant select on table public.audit_log to authenticated;

revoke insert, update, delete, truncate on table public.business_memory_events from anon;
revoke update, delete, truncate on table public.business_memory_events from authenticated;
revoke delete, truncate on table public.goals from anon, authenticated;
revoke delete, truncate on table public.opportunities from anon, authenticated;

-- Function ACLs are explicit because public-schema default privileges are broad.
revoke all on function public.rev_action_material_fingerprint(public.rev_actions) from public, anon, authenticated;
revoke all on function public.protect_rev_action_material_changes() from public, anon, authenticated;
revoke all on function public.protect_workspace_execution_policy() from public, anon, authenticated;
revoke all on function public.prevent_append_only_evidence_mutation() from public, anon, authenticated;

revoke all on function public.decide_rev_action_approval(uuid, bigint, text, text, text) from public, anon;
grant execute on function public.decide_rev_action_approval(uuid, bigint, text, text, text) to authenticated;
revoke all on function public.prepare_rev_action_execution(uuid, uuid, text, text, uuid, text, text, text, numeric, text) from public, anon;
grant execute on function public.prepare_rev_action_execution(uuid, uuid, text, text, uuid, text, text, text, numeric, text) to authenticated;

revoke all on function public.record_rev_action_execution_result(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_rev_action_execution_result(uuid, text, text, text, jsonb) to service_role;
