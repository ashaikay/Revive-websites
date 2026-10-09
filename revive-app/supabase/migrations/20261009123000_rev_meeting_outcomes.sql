-- Phase 5E.1: manually recorded meeting outcomes only.
-- This migration does not call a provider, alter booking state, or update commercial records.

create schema if not exists rev_meeting_private;
revoke all on schema rev_meeting_private from public, anon, authenticated;

create table public.meeting_outcomes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  meeting_proposal_id uuid not null,
  outcome_type text not null check (outcome_type in ('held', 'no_show', 'cancelled')),
  summary text not null check (char_length(summary) between 1 and 1000 and summary = btrim(summary)),
  occurred_at timestamptz not null check (isfinite(occurred_at)),
  recorded_by_user_id uuid not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, meeting_proposal_id),
  foreign key (workspace_id, meeting_proposal_id)
    references public.meeting_proposals(workspace_id, id) on delete cascade,
  foreign key (workspace_id, recorded_by_user_id)
    references public.workspace_members(workspace_id, user_id)
);

create index meeting_outcomes_workspace_time_idx
  on public.meeting_outcomes(workspace_id, occurred_at desc);

alter table public.meeting_outcomes enable row level security;
revoke all on public.meeting_outcomes from public, anon, authenticated;
grant select on public.meeting_outcomes to authenticated;
grant select, insert, update on public.meeting_outcomes to service_role;

create policy meeting_outcomes_workspace_read
on public.meeting_outcomes
for select
to authenticated
using (public.is_active_workspace_member(workspace_id));

create table rev_meeting_private.outcome_requests (
  request_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, actor_user_id)
    references public.workspace_members(workspace_id, user_id)
);

revoke all on rev_meeting_private.outcome_requests from public, anon, authenticated, service_role;

create function public.save_rev_meeting_outcome(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_meeting_proposal_id uuid,
  target_outcome_type text,
  target_summary text,
  target_occurred_at timestamptz,
  expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.meeting_proposals;
  existing public.meeting_outcomes;
  saved public.meeting_outcomes;
  previous_request rev_meeting_private.outcome_requests;
  proposal_start_at timestamptz;
  proposal_end_at timestamptz;
  request_input jsonb;
  result jsonb;
  created_result boolean := false;
  corrected_result boolean := false;
begin
  if target_workspace_id is null
    or initiating_user_id is null
    or target_request_id is null
    or target_meeting_proposal_id is null
    or target_outcome_type not in ('held', 'no_show', 'cancelled')
    or target_summary is null
    or char_length(target_summary) not between 1 and 1000
    or target_summary <> btrim(target_summary)
    or target_occurred_at is null
    or not isfinite(target_occurred_at)
    or target_occurred_at > now()
    or expected_version is null
    or expected_version < 0
  then
    raise exception 'Valid meeting outcome required';
  end if;

  request_input := pg_catalog.jsonb_build_object(
    'meeting_proposal_id', target_meeting_proposal_id,
    'outcome_type', target_outcome_type,
    'summary', target_summary,
    'occurred_at', target_occurred_at,
    'expected_version', expected_version
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_request_id::text, 0)
  );
  select request.* into previous_request
  from rev_meeting_private.outcome_requests request
  where request.request_id = target_request_id;
  if found then
    if previous_request.workspace_id <> target_workspace_id
      or previous_request.actor_user_id <> initiating_user_id
      or previous_request.input <> request_input
    then
      raise exception 'Meeting outcome request unavailable';
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

  proposal_start_at := (proposal.proposal_payload ->> 'startAt')::timestamptz;
  proposal_end_at := (proposal.proposal_payload ->> 'endAt')::timestamptz;
  if target_outcome_type in ('held', 'no_show')
    and (
      proposal_end_at > now()
      or target_occurred_at < proposal_start_at
    )
  then
    raise exception 'Meeting has not occurred';
  end if;
  if target_outcome_type = 'cancelled' and target_occurred_at < proposal.created_at then
    raise exception 'Cancellation time is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_workspace_id::text || ':' || target_meeting_proposal_id::text,
      0
    )
  );
  select outcome.* into existing
  from public.meeting_outcomes outcome
  where outcome.workspace_id = target_workspace_id
    and outcome.meeting_proposal_id = target_meeting_proposal_id
  for update;

  if not found then
    if expected_version <> 0 then
      raise exception 'Meeting outcome unavailable or changed';
    end if;
    insert into public.meeting_outcomes (
      workspace_id,
      meeting_proposal_id,
      outcome_type,
      summary,
      occurred_at,
      recorded_by_user_id
    )
    values (
      target_workspace_id,
      target_meeting_proposal_id,
      target_outcome_type,
      target_summary,
      target_occurred_at,
      initiating_user_id
    )
    returning * into saved;
    created_result := true;
  elsif existing.outcome_type = target_outcome_type
    and existing.summary = target_summary
    and existing.occurred_at = target_occurred_at
  then
    saved := existing;
  else
    if existing.version <> expected_version then
      raise exception 'Meeting outcome unavailable or changed';
    end if;
    update public.meeting_outcomes outcome
    set outcome_type = target_outcome_type,
        summary = target_summary,
        occurred_at = target_occurred_at,
        recorded_by_user_id = initiating_user_id,
        version = outcome.version + 1,
        updated_at = now()
    where outcome.workspace_id = target_workspace_id
      and outcome.id = existing.id
    returning * into saved;
    corrected_result := true;
  end if;

  result := pg_catalog.jsonb_build_object(
    'id', saved.id,
    'workspace_id', saved.workspace_id,
    'meeting_proposal_id', saved.meeting_proposal_id,
    'outcome_type', saved.outcome_type,
    'summary', saved.summary,
    'occurred_at', saved.occurred_at,
    'recorded_by_user_id', saved.recorded_by_user_id,
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
        then 'meeting_outcome.recorded'
        else 'meeting_outcome.corrected'
      end,
      'meeting_outcome',
      saved.id,
      pg_catalog.jsonb_build_object(
        'request_id', target_request_id,
        'meeting_proposal_id', target_meeting_proposal_id,
        'outcome_type', target_outcome_type,
        'previous_version', expected_version,
        'version', saved.version
      )
    );
  end if;

  insert into rev_meeting_private.outcome_requests (
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

revoke all on function public.save_rev_meeting_outcome(
  uuid, uuid, uuid, uuid, text, text, timestamptz, bigint
) from public, anon, authenticated;
grant execute on function public.save_rev_meeting_outcome(
  uuid, uuid, uuid, uuid, text, text, timestamptz, bigint
) to service_role;
