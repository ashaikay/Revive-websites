-- Phase 5J: durable, approval-required meeting proposals only. No provider event exists.
create table public.meeting_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rev_action_id uuid not null,
  approval_id uuid not null,
  submitted_by uuid not null references auth.users(id),
  proposal_version bigint not null default 1 check (proposal_version > 0),
  semantic_fingerprint text not null check (semantic_fingerprint ~ '^[0-9a-f]{64}$'),
  proposal_payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, rev_action_id),
  unique (workspace_id, semantic_fingerprint),
  foreign key (workspace_id, rev_action_id) references public.rev_actions(workspace_id, id),
  foreign key (workspace_id, rev_action_id, approval_id) references public.approvals(workspace_id, rev_action_id, id),
  check (jsonb_typeof(proposal_payload) = 'object')
);

alter table public.meeting_proposals enable row level security;
create policy meeting_proposals_select on public.meeting_proposals for select
  using (
    public.is_active_workspace_member(workspace_id)
    and (
      submitted_by = auth.uid()
      or public.has_workspace_role(workspace_id, array['owner', 'admin'])
    )
  );
revoke all on table public.meeting_proposals from anon, authenticated;
grant select on table public.meeting_proposals to authenticated;

-- The legacy generic rev_actions policies allow active members to create and
-- update ordinary proposals. Meeting proposals carry attendee PII and must be
-- created only by the trusted SECURITY DEFINER RPC below.
create policy rev_actions_meeting_proposal_insert_restrict
on public.rev_actions
as restrictive
for insert
to authenticated
with check (action_type <> 'meeting_proposal');

create policy rev_actions_meeting_proposal_update_restrict
on public.rev_actions
as restrictive
for update
to authenticated
using (action_type <> 'meeting_proposal')
with check (action_type <> 'meeting_proposal');

-- Preserve existing visibility for every other action type. A meeting
-- proposal is visible only to its submitter or a workspace owner/admin.
create policy rev_actions_meeting_proposal_select_restrict
on public.rev_actions
as restrictive
for select
to authenticated
using (
  action_type <> 'meeting_proposal'
  or public.has_workspace_role(workspace_id, array['owner', 'admin'])
  or exists (
    select 1
    from public.meeting_proposals mp
    where mp.workspace_id = rev_actions.workspace_id
      and mp.rev_action_id = rev_actions.id
      and mp.submitted_by = auth.uid()
  )
);

create or replace function public.submit_meeting_proposal(
  target_workspace_id uuid,
  target_submitted_by uuid,
  target_title text,
  target_attendee_email text,
  target_start_at timestamptz,
  target_end_at timestamptz,
  target_timezone text,
  target_meeting_method text,
  target_location_details text,
  target_notes text,
  target_semantic_fingerprint text
)
returns table (action_id uuid, approval_id uuid, action_status text, execution_status text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.meeting_proposals%rowtype;
  existing_action public.rev_actions%rowtype;
  existing_approval public.approvals%rowtype;
  new_action public.rev_actions%rowtype;
  new_approval public.approvals%rowtype;
  action_fingerprint text;
  payload jsonb;
begin
  if target_workspace_id is null or target_submitted_by is null then raise exception 'valid workspace and actor required'; end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = target_submitted_by
      and status = 'active'
  ) then raise exception 'active workspace membership required'; end if;
  if target_title is null or char_length(btrim(target_title)) not between 1 and 120 then raise exception 'valid title required'; end if;
  if target_attendee_email is null or btrim(target_attendee_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'valid attendee email required'; end if;
  if target_start_at is null or target_end_at is null or target_start_at >= target_end_at or target_start_at <= now() then raise exception 'valid future interval required'; end if;
  if extract(epoch from (target_end_at - target_start_at)) / 60 not in (30, 60) then raise exception 'valid meeting duration required'; end if;
  if target_timezone is null or char_length(btrim(target_timezone)) = 0 then raise exception 'valid timezone required'; end if;
  if target_meeting_method not in ('online', 'phone', 'in_person') then raise exception 'valid meeting method required'; end if;
  if coalesce(char_length(btrim(target_location_details)), 0) > 240 or coalesce(char_length(btrim(target_notes)), 0) > 1000 then raise exception 'proposal text is too long'; end if;
  if target_semantic_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'valid semantic fingerprint required'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_workspace_id::text || ':' || target_semantic_fingerprint, 0));
  select * into existing from public.meeting_proposals
  where workspace_id = target_workspace_id and semantic_fingerprint = target_semantic_fingerprint;
  if found then
    select * into existing_action from public.rev_actions
    where workspace_id = target_workspace_id and id = existing.rev_action_id;
    select * into existing_approval from public.approvals
    where workspace_id = target_workspace_id and rev_action_id = existing.rev_action_id and id = existing.approval_id;
    if not found or existing_action.workspace_id is null then raise exception 'existing meeting proposal binding is invalid'; end if;
    return query select existing_action.id, existing_approval.id, existing_action.status, existing_action.execution_status, false;
    return;
  end if;

  payload := jsonb_build_object(
    'version', 1, 'title', btrim(target_title), 'attendeeEmail', lower(btrim(target_attendee_email)),
    'startAt', to_char(target_start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endAt', to_char(target_end_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'timezone', btrim(target_timezone), 'meetingMethod', target_meeting_method,
    'locationDetails', btrim(coalesce(target_location_details, '')), 'notes', btrim(coalesce(target_notes, ''))
  );
  insert into public.rev_actions (workspace_id, action_type, title, description, rationale, requires_approval, status, execution_status, action_version)
  values (target_workspace_id, 'meeting_proposal', btrim(target_title), 'Meeting proposal awaiting owner approval.', 'meeting-proposal:v1:' || target_semantic_fingerprint, true, 'awaiting_approval', 'not_executed', 1)
  returning * into new_action;
  action_fingerprint := public.rev_action_material_fingerprint(new_action);
  insert into public.approvals (workspace_id, rev_action_id, action_version, action_fingerprint)
  values (target_workspace_id, new_action.id, new_action.action_version, action_fingerprint)
  returning * into new_approval;
  insert into public.meeting_proposals (workspace_id, rev_action_id, approval_id, submitted_by, proposal_version, semantic_fingerprint, proposal_payload)
  values (target_workspace_id, new_action.id, new_approval.id, target_submitted_by, 1, target_semantic_fingerprint, payload);
  insert into public.audit_log (workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata)
  values (target_workspace_id, target_submitted_by, 'user', 'meeting_proposal.submitted', 'meeting_proposal', new_action.id, jsonb_build_object('proposal_version', 1));
  return query select new_action.id, new_approval.id, new_action.status, new_action.execution_status, true;
end;
$$;

revoke all on function public.submit_meeting_proposal(uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_meeting_proposal(uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text, text) to service_role;