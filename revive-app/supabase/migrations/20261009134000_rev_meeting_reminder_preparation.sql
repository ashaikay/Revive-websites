-- Phase 5E: manual internal meeting-reminder draft preparation only.
-- This migration does not schedule or deliver reminders, call providers, or change execution gates.

create table public.meeting_reminder_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  meeting_proposal_id uuid not null,
  body text not null check (char_length(body) between 1 and 2000 and body = btrim(body)),
  prepared_by_user_id uuid not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, meeting_proposal_id),
  foreign key (workspace_id, meeting_proposal_id)
    references public.meeting_proposals(workspace_id, id) on delete cascade,
  foreign key (workspace_id, prepared_by_user_id)
    references public.workspace_members(workspace_id, user_id)
);

create index meeting_reminder_drafts_workspace_time_idx
  on public.meeting_reminder_drafts(workspace_id, updated_at desc);

alter table public.meeting_reminder_drafts enable row level security;
revoke all on public.meeting_reminder_drafts from public, anon, authenticated;
grant select on public.meeting_reminder_drafts to authenticated;
grant select, insert, update on public.meeting_reminder_drafts to service_role;

create policy meeting_reminder_drafts_workspace_read
on public.meeting_reminder_drafts
for select
to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create table rev_meeting_private.reminder_draft_requests (
  request_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, actor_user_id)
    references public.workspace_members(workspace_id, user_id)
);

revoke all on rev_meeting_private.reminder_draft_requests
  from public, anon, authenticated, service_role;

create function public.save_rev_meeting_reminder_draft(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_meeting_proposal_id uuid,
  target_body text,
  expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.meeting_proposals;
  existing public.meeting_reminder_drafts;
  saved public.meeting_reminder_drafts;
  previous_request rev_meeting_private.reminder_draft_requests;
  request_input jsonb;
  result jsonb;
  created_result boolean := false;
  corrected_result boolean := false;
begin
  if target_workspace_id is null
    or initiating_user_id is null
    or target_request_id is null
    or target_meeting_proposal_id is null
    or target_body is null
    or char_length(target_body) not between 1 and 2000
    or target_body <> btrim(target_body)
    or expected_version is null
    or expected_version < 0
  then
    raise exception 'Valid meeting reminder draft required';
  end if;

  request_input := pg_catalog.jsonb_build_object(
    'meeting_proposal_id', target_meeting_proposal_id,
    'body', target_body,
    'expected_version', expected_version
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_request_id::text, 0)
  );
  select request.* into previous_request
  from rev_meeting_private.reminder_draft_requests request
  where request.request_id = target_request_id;
  if found then
    if previous_request.workspace_id <> target_workspace_id
      or previous_request.actor_user_id <> initiating_user_id
      or previous_request.input <> request_input
    then
      raise exception 'Meeting reminder request unavailable';
    end if;
    return previous_request.result;
  end if;

  perform 1
  from public.workspace_members member
  where member.workspace_id = target_workspace_id
    and member.user_id = initiating_user_id
    and member.status = 'active'
    and member.role in ('owner', 'admin')
  for share;
  if not found then
    raise exception 'Active owner or admin required';
  end if;

  select meeting.* into proposal
  from public.meeting_proposals meeting
  where meeting.workspace_id = target_workspace_id
    and meeting.id = target_meeting_proposal_id
  for share;
  if not found then
    raise exception 'Meeting proposal unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_workspace_id::text || ':' || target_meeting_proposal_id::text,
      0
    )
  );

  if (proposal.proposal_payload ->> 'startAt')::timestamptz <= now() then
    raise exception 'Meeting reminder editing is unavailable';
  end if;

  if exists (
    select 1
    from public.meeting_outcomes outcome
    where outcome.workspace_id = target_workspace_id
      and outcome.meeting_proposal_id = target_meeting_proposal_id
  ) then
    raise exception 'Meeting reminder editing is unavailable';
  end if;

  if not exists (
    select 1
    from public.rev_action_executions execution
    where execution.workspace_id = target_workspace_id
      and execution.action_id = proposal.rev_action_id
      and execution.capability = 'CREATE_APPROVED_MEETING_EVENT'
      and execution.mode = 'live'
      and execution.status = 'succeeded'
      and execution.provider_outcome = 'accepted_by_provider'
  ) then
    raise exception 'Provider-accepted meeting required';
  end if;

  select draft.* into existing
  from public.meeting_reminder_drafts draft
  where draft.workspace_id = target_workspace_id
    and draft.meeting_proposal_id = target_meeting_proposal_id
  for update;

  if not found then
    if expected_version <> 0 then
      raise exception 'Meeting reminder draft unavailable or changed';
    end if;
    insert into public.meeting_reminder_drafts (
      workspace_id,
      meeting_proposal_id,
      body,
      prepared_by_user_id
    )
    values (
      target_workspace_id,
      target_meeting_proposal_id,
      target_body,
      initiating_user_id
    )
    returning * into saved;
    created_result := true;
  elsif existing.body = target_body then
    saved := existing;
  else
    if existing.version <> expected_version then
      raise exception 'Meeting reminder draft unavailable or changed';
    end if;
    update public.meeting_reminder_drafts draft
    set body = target_body,
        prepared_by_user_id = initiating_user_id,
        version = draft.version + 1,
        updated_at = now()
    where draft.workspace_id = target_workspace_id
      and draft.id = existing.id
    returning * into saved;
    corrected_result := true;
  end if;

  result := pg_catalog.jsonb_build_object(
    'id', saved.id,
    'workspace_id', saved.workspace_id,
    'meeting_proposal_id', saved.meeting_proposal_id,
    'body', saved.body,
    'prepared_by_user_id', saved.prepared_by_user_id,
    'version', saved.version,
    'created_at', saved.created_at,
    'updated_at', saved.updated_at,
    'created', created_result,
    'corrected', corrected_result
  );

  if created_result or corrected_result then
    insert into public.audit_log (
      workspace_id,
      actor_user_id,
      actor_type,
      action,
      resource_type,
      resource_id,
      metadata
    )
    values (
      target_workspace_id,
      initiating_user_id,
      'user',
      case when created_result
        then 'meeting_reminder_draft.prepared'
        else 'meeting_reminder_draft.corrected'
      end,
      'meeting_reminder_draft',
      saved.id,
      pg_catalog.jsonb_build_object(
        'meeting_proposal_id', target_meeting_proposal_id,
        'version', saved.version
      )
    );
  end if;

  insert into rev_meeting_private.reminder_draft_requests (
    request_id,
    workspace_id,
    actor_user_id,
    input,
    result
  )
  values (
    target_request_id,
    target_workspace_id,
    initiating_user_id,
    request_input,
    result
  );

  return result;
end;
$$;

revoke all on function public.save_rev_meeting_reminder_draft(
  uuid, uuid, uuid, uuid, text, bigint
) from public, anon, authenticated;
grant execute on function public.save_rev_meeting_reminder_draft(
  uuid, uuid, uuid, uuid, text, bigint
) to service_role;
