-- Phase 5E: manual, explicitly approved meeting-reminder email delivery.
-- The provider capability remains disabled by default in the trusted Edge Function.

create table public.meeting_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  meeting_proposal_id uuid not null,
  reminder_draft_id uuid not null,
  approved_draft_version bigint not null check (approved_draft_version > 0),
  approved_draft_fingerprint text not null check (approved_draft_fingerprint ~ '^[0-9a-f]{64}$'),
  capability text not null default 'SEND_MEETING_REMINDER_EMAIL'
    check (capability = 'SEND_MEETING_REMINDER_EMAIL'),
  status text not null default 'approved_not_sent' check (
    status in (
      'approved_not_sent',
      'provider_attempt_claimed',
      'accepted_by_provider',
      'rejected_by_provider',
      'provider_outcome_unknown'
    )
  ),
  approved_by_user_id uuid not null,
  approved_at timestamptz not null default now(),
  send_authorized_by_user_id uuid,
  send_authorized_at timestamptz,
  provider_key text,
  request_fingerprint text check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_reference text,
  result_summary text,
  failure_code text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, meeting_proposal_id),
  foreign key (workspace_id, meeting_proposal_id)
    references public.meeting_proposals(workspace_id, id) on delete cascade,
  foreign key (workspace_id, reminder_draft_id)
    references public.meeting_reminder_drafts(workspace_id, id),
  foreign key (workspace_id, approved_by_user_id)
    references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, send_authorized_by_user_id)
    references public.workspace_members(workspace_id, user_id),
  check (
    (
      status = 'approved_not_sent'
      and send_authorized_by_user_id is null
      and send_authorized_at is null
      and provider_key is null
      and request_fingerprint is null
      and result_summary is null
      and failure_code is null
    )
    or (
      status = 'provider_attempt_claimed'
      and send_authorized_by_user_id is not null
      and send_authorized_at is not null
      and provider_key = 'microsoft_graph'
      and request_fingerprint is not null
      and result_summary is null
      and failure_code is null
    )
    or (
      status = 'accepted_by_provider'
      and send_authorized_by_user_id is not null
      and send_authorized_at is not null
      and provider_key = 'microsoft_graph'
      and request_fingerprint is not null
      and result_summary is not null
      and failure_code is null
    )
    or (
      status in ('rejected_by_provider', 'provider_outcome_unknown')
      and send_authorized_by_user_id is not null
      and send_authorized_at is not null
      and provider_key = 'microsoft_graph'
      and request_fingerprint is not null
      and result_summary is not null
      and failure_code is not null
    )
  )
);

create index meeting_reminder_deliveries_workspace_time_idx
  on public.meeting_reminder_deliveries(workspace_id, updated_at desc);

alter table public.meeting_reminder_deliveries enable row level security;
revoke all on public.meeting_reminder_deliveries from public, anon, authenticated;
grant select on public.meeting_reminder_deliveries to authenticated;
grant select, insert, update on public.meeting_reminder_deliveries to service_role;

create policy meeting_reminder_deliveries_workspace_read
on public.meeting_reminder_deliveries
for select
to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create table rev_meeting_private.reminder_delivery_approval_requests (
  request_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, actor_user_id)
    references public.workspace_members(workspace_id, user_id)
);

create table rev_meeting_private.reminder_delivery_send_requests (
  request_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null,
  delivery_id uuid not null,
  input jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, actor_user_id)
    references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, delivery_id)
    references public.meeting_reminder_deliveries(workspace_id, id)
);

revoke all on rev_meeting_private.reminder_delivery_approval_requests
  from public, anon, authenticated, service_role;
revoke all on rev_meeting_private.reminder_delivery_send_requests
  from public, anon, authenticated, service_role;

create function public.approve_rev_meeting_reminder_delivery(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_meeting_proposal_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.meeting_proposals;
  draft public.meeting_reminder_drafts;
  existing public.meeting_reminder_deliveries;
  saved public.meeting_reminder_deliveries;
  previous_request rev_meeting_private.reminder_delivery_approval_requests;
  request_input jsonb;
  draft_fingerprint text;
  result jsonb;
  audit_action text;
begin
  if target_workspace_id is null or initiating_user_id is null
    or target_request_id is null or target_meeting_proposal_id is null
  then raise exception 'Valid reminder approval required'; end if;

  request_input := pg_catalog.jsonb_build_object(
    'meeting_proposal_id', target_meeting_proposal_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_request_id::text, 0)
  );
  select request.* into previous_request
  from rev_meeting_private.reminder_delivery_approval_requests request
  where request.request_id = target_request_id;
  if found then
    if previous_request.workspace_id <> target_workspace_id
      or previous_request.actor_user_id <> initiating_user_id
      or previous_request.input <> request_input
    then raise exception 'Reminder approval request unavailable'; end if;
    return previous_request.result;
  end if;

  perform 1 from public.workspace_members member
  where member.workspace_id = target_workspace_id
    and member.user_id = initiating_user_id
    and member.status = 'active'
    and member.role in ('owner', 'admin')
  for share;
  if not found then raise exception 'Active owner or admin required'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_workspace_id::text || ':' || target_meeting_proposal_id::text || ':reminder-delivery',
      0
    )
  );
  select meeting.* into proposal from public.meeting_proposals meeting
  where meeting.workspace_id = target_workspace_id
    and meeting.id = target_meeting_proposal_id
  for share;
  if not found then raise exception 'Meeting proposal unavailable'; end if;
  if (proposal.proposal_payload ->> 'startAt')::timestamptz <= pg_catalog.now() then
    raise exception 'Future meeting required';
  end if;
  if exists (
    select 1 from public.meeting_outcomes outcome
    where outcome.workspace_id = target_workspace_id
      and outcome.meeting_proposal_id = target_meeting_proposal_id
  ) then raise exception 'Meeting outcome prevents reminder delivery'; end if;
  if not exists (
    select 1 from public.rev_action_executions execution
    where execution.workspace_id = target_workspace_id
      and execution.action_id = proposal.rev_action_id
      and execution.capability = 'CREATE_APPROVED_MEETING_EVENT'
      and execution.mode = 'live'
      and execution.status = 'succeeded'
      and execution.provider_outcome = 'accepted_by_provider'
  ) then raise exception 'Provider-accepted meeting required'; end if;

  select reminder.* into draft from public.meeting_reminder_drafts reminder
  where reminder.workspace_id = target_workspace_id
    and reminder.meeting_proposal_id = target_meeting_proposal_id
  for share;
  if not found then raise exception 'Meeting reminder draft required'; end if;
  draft_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'workspace_id', target_workspace_id,
          'meeting_proposal_id', target_meeting_proposal_id,
          'reminder_draft_id', draft.id,
          'draft_version', draft.version,
          'body', draft.body
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select delivery.* into existing from public.meeting_reminder_deliveries delivery
  where delivery.workspace_id = target_workspace_id
    and delivery.meeting_proposal_id = target_meeting_proposal_id
  for update;
  if not found then
    insert into public.meeting_reminder_deliveries (
      workspace_id, meeting_proposal_id, reminder_draft_id,
      approved_draft_version, approved_draft_fingerprint,
      approved_by_user_id
    ) values (
      target_workspace_id, target_meeting_proposal_id, draft.id,
      draft.version, draft_fingerprint, initiating_user_id
    ) returning * into saved;
    audit_action := 'meeting_reminder_delivery.approved';
  elsif existing.status <> 'approved_not_sent' then
    raise exception 'Reminder provider attempt already exists';
  elsif existing.reminder_draft_id = draft.id
    and existing.approved_draft_version = draft.version
    and existing.approved_draft_fingerprint = draft_fingerprint
  then
    saved := existing;
  else
    update public.meeting_reminder_deliveries delivery
    set reminder_draft_id = draft.id,
        approved_draft_version = draft.version,
        approved_draft_fingerprint = draft_fingerprint,
        approved_by_user_id = initiating_user_id,
        approved_at = pg_catalog.now(),
        version = delivery.version + 1,
        updated_at = pg_catalog.now()
    where delivery.id = existing.id
    returning * into saved;
    audit_action := 'meeting_reminder_delivery.reapproved';
  end if;

  result := pg_catalog.to_jsonb(saved);
  if audit_action is not null then
    insert into public.audit_log (
      workspace_id, actor_user_id, actor_type, action,
      resource_type, resource_id, metadata
    ) values (
      target_workspace_id, initiating_user_id, 'user', audit_action,
      'meeting_reminder_delivery', saved.id,
      pg_catalog.jsonb_build_object(
        'meeting_proposal_id', target_meeting_proposal_id,
        'reminder_draft_id', draft.id,
        'approved_draft_version', draft.version,
        'delivery_version', saved.version
      )
    );
  end if;
  insert into rev_meeting_private.reminder_delivery_approval_requests (
    request_id, workspace_id, actor_user_id, input, result
  ) values (
    target_request_id, target_workspace_id, initiating_user_id, request_input, result
  );
  return result;
end;
$$;

create function public.claim_rev_meeting_reminder_delivery(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_meeting_proposal_id uuid,
  target_send_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.meeting_proposals;
  draft public.meeting_reminder_drafts;
  delivery public.meeting_reminder_deliveries;
  saved public.meeting_reminder_deliveries;
  previous_request rev_meeting_private.reminder_delivery_send_requests;
  policy public.workspace_execution_policies;
  request_input jsonb;
  current_draft_fingerprint text;
  send_fingerprint text;
  recipient text;
  subject text;
begin
  if target_workspace_id is null or initiating_user_id is null
    or target_request_id is null or target_meeting_proposal_id is null
    or target_send_consent is distinct from true
  then raise exception 'Explicit reminder sending consent required'; end if;

  request_input := pg_catalog.jsonb_build_object(
    'meeting_proposal_id', target_meeting_proposal_id,
    'send_consent', true
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_request_id::text, 0)
  );
  select request.* into previous_request
  from rev_meeting_private.reminder_delivery_send_requests request
  where request.request_id = target_request_id;
  if found then
    if previous_request.workspace_id <> target_workspace_id
      or previous_request.actor_user_id <> initiating_user_id
      or previous_request.input <> request_input
    then raise exception 'Reminder send request unavailable'; end if;
    select current.* into saved from public.meeting_reminder_deliveries current
    where current.workspace_id = target_workspace_id
      and current.id = previous_request.delivery_id;
    return pg_catalog.to_jsonb(saved) || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  perform 1 from public.workspace_members member
  where member.workspace_id = target_workspace_id
    and member.user_id = initiating_user_id
    and member.status = 'active'
    and member.role in ('owner', 'admin')
  for share;
  if not found then raise exception 'Active owner or admin required'; end if;

  select current.* into policy from public.workspace_execution_policies current
  where current.workspace_id = target_workspace_id
  for share;
  if not found
    or not policy.execution_enabled
    or policy.autonomy_mode <> 'always_ask'
    or 'SEND_MEETING_REMINDER_EMAIL' = any(policy.disabled_capabilities)
  then raise exception 'Meeting reminder email capability is disabled'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_workspace_id::text || ':' || target_meeting_proposal_id::text || ':reminder-delivery',
      0
    )
  );
  select meeting.* into proposal from public.meeting_proposals meeting
  where meeting.workspace_id = target_workspace_id
    and meeting.id = target_meeting_proposal_id
  for share;
  if not found then raise exception 'Meeting proposal unavailable'; end if;
  if (proposal.proposal_payload ->> 'startAt')::timestamptz <= pg_catalog.now() then
    raise exception 'Future meeting required';
  end if;
  if exists (
    select 1 from public.meeting_outcomes outcome
    where outcome.workspace_id = target_workspace_id
      and outcome.meeting_proposal_id = target_meeting_proposal_id
  ) then raise exception 'Meeting outcome prevents reminder delivery'; end if;
  if not exists (
    select 1 from public.rev_action_executions execution
    where execution.workspace_id = target_workspace_id
      and execution.action_id = proposal.rev_action_id
      and execution.capability = 'CREATE_APPROVED_MEETING_EVENT'
      and execution.mode = 'live'
      and execution.status = 'succeeded'
      and execution.provider_outcome = 'accepted_by_provider'
  ) then raise exception 'Provider-accepted meeting required'; end if;

  select reminder.* into draft from public.meeting_reminder_drafts reminder
  where reminder.workspace_id = target_workspace_id
    and reminder.meeting_proposal_id = target_meeting_proposal_id
  for share;
  if not found then raise exception 'Meeting reminder draft required'; end if;
  select current.* into delivery from public.meeting_reminder_deliveries current
  where current.workspace_id = target_workspace_id
    and current.meeting_proposal_id = target_meeting_proposal_id
  for update;
  if not found or delivery.status <> 'approved_not_sent' then
    raise exception 'Current approved reminder required';
  end if;

  current_draft_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'workspace_id', target_workspace_id,
          'meeting_proposal_id', target_meeting_proposal_id,
          'reminder_draft_id', draft.id,
          'draft_version', draft.version,
          'body', draft.body
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if delivery.reminder_draft_id <> draft.id
    or delivery.approved_draft_version <> draft.version
    or delivery.approved_draft_fingerprint <> current_draft_fingerprint
  then raise exception 'Reminder approval is stale'; end if;

  recipient := pg_catalog.lower(pg_catalog.btrim(proposal.proposal_payload ->> 'attendeeEmail'));
  subject := 'Reminder: ' || pg_catalog.btrim(proposal.proposal_payload ->> 'title');
  if recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or pg_catalog.char_length(subject) not between 11 and 131
  then raise exception 'Trusted reminder email unavailable'; end if;
  send_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'workspace_id', target_workspace_id,
          'meeting_proposal_id', target_meeting_proposal_id,
          'delivery_id', delivery.id,
          'approved_draft_version', delivery.approved_draft_version,
          'recipient', recipient,
          'subject', subject,
          'body', draft.body,
          'capability', 'SEND_MEETING_REMINDER_EMAIL',
          'provider_key', 'microsoft_graph'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  update public.meeting_reminder_deliveries current
  set status = 'provider_attempt_claimed',
      send_authorized_by_user_id = initiating_user_id,
      send_authorized_at = pg_catalog.now(),
      provider_key = 'microsoft_graph',
      request_fingerprint = send_fingerprint,
      version = current.version + 1,
      updated_at = pg_catalog.now()
  where current.id = delivery.id
  returning * into saved;

  insert into rev_meeting_private.reminder_delivery_send_requests (
    request_id, workspace_id, actor_user_id, delivery_id, input
  ) values (
    target_request_id, target_workspace_id, initiating_user_id,
    saved.id, request_input
  );
  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action,
    resource_type, resource_id, metadata
  ) values
  (
    target_workspace_id, initiating_user_id, 'user',
    'meeting_reminder_delivery.send_authorized',
    'meeting_reminder_delivery', saved.id,
    pg_catalog.jsonb_build_object(
      'meeting_proposal_id', target_meeting_proposal_id,
      'approved_draft_version', saved.approved_draft_version,
      'channel', 'email'
    )
  ),
  (
    target_workspace_id, null, 'system',
    'meeting_reminder_delivery.provider_attempt_claimed',
    'meeting_reminder_delivery', saved.id,
    pg_catalog.jsonb_build_object(
      'meeting_proposal_id', target_meeting_proposal_id,
      'capability', 'SEND_MEETING_REMINDER_EMAIL',
      'provider_key', 'microsoft_graph',
      'channel', 'email'
    )
  );

  return pg_catalog.to_jsonb(saved) || pg_catalog.jsonb_build_object(
    'replayed', false,
    'recipient', recipient,
    'subject', subject,
    'body', draft.body
  );
end;
$$;

create function public.record_rev_meeting_reminder_delivery_result(
  target_delivery_id uuid,
  expected_request_fingerprint text,
  target_provider_outcome text,
  target_result_summary text,
  target_failure_code text,
  target_provider_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.meeting_reminder_deliveries;
  saved public.meeting_reminder_deliveries;
begin
  if target_delivery_id is null
    or expected_request_fingerprint !~ '^[0-9a-f]{64}$'
    or target_provider_outcome not in (
      'accepted_by_provider', 'rejected_by_provider', 'provider_outcome_unknown'
    )
    or target_result_summary is null
    or pg_catalog.char_length(pg_catalog.btrim(target_result_summary)) not between 1 and 500
    or (
      target_provider_outcome = 'accepted_by_provider'
      and target_failure_code is not null
    )
    or (
      target_provider_outcome <> 'accepted_by_provider'
      and (
        target_failure_code is null
        or pg_catalog.char_length(pg_catalog.btrim(target_failure_code)) not between 1 and 120
      )
    )
  then raise exception 'Valid reminder provider result required'; end if;

  select current.* into delivery from public.meeting_reminder_deliveries current
  where current.id = target_delivery_id
  for update;
  if not found then raise exception 'Reminder delivery unavailable'; end if;
  if delivery.request_fingerprint <> expected_request_fingerprint then
    raise exception 'Reminder request fingerprint mismatch';
  end if;
  if delivery.status in (
    'accepted_by_provider', 'rejected_by_provider', 'provider_outcome_unknown'
  ) then
    if delivery.status <> target_provider_outcome
      or delivery.result_summary <> pg_catalog.btrim(target_result_summary)
      or delivery.failure_code is distinct from target_failure_code
    then raise exception 'Reminder provider result conflict'; end if;
    return pg_catalog.to_jsonb(delivery);
  end if;
  if delivery.status <> 'provider_attempt_claimed' then
    raise exception 'Reminder provider attempt is not awaiting a result';
  end if;

  update public.meeting_reminder_deliveries current
  set status = target_provider_outcome,
      result_summary = pg_catalog.btrim(target_result_summary),
      failure_code = target_failure_code,
      provider_reference = target_provider_reference,
      version = current.version + 1,
      updated_at = pg_catalog.now()
  where current.id = delivery.id
  returning * into saved;

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action,
    resource_type, resource_id, metadata
  ) values (
    saved.workspace_id, null, 'system',
    'meeting_reminder_delivery.' || target_provider_outcome,
    'meeting_reminder_delivery', saved.id,
    pg_catalog.jsonb_build_object(
      'meeting_proposal_id', saved.meeting_proposal_id,
      'capability', 'SEND_MEETING_REMINDER_EMAIL',
      'provider_key', saved.provider_key,
      'channel', 'email',
      'failure_code', saved.failure_code
    )
  );
  return pg_catalog.to_jsonb(saved);
end;
$$;

revoke all on function public.approve_rev_meeting_reminder_delivery(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_rev_meeting_reminder_delivery(uuid, uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.record_rev_meeting_reminder_delivery_result(uuid, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.approve_rev_meeting_reminder_delivery(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.claim_rev_meeting_reminder_delivery(uuid, uuid, uuid, uuid, boolean)
  to service_role;
grant execute on function public.record_rev_meeting_reminder_delivery_result(uuid, text, text, text, text, text)
  to service_role;
