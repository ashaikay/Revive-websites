-- Phase 5R: atomically bind the server-resolved availability calendar to the
-- Phase 5P durable reservation. No provider claim, event creation or gateway enablement.

create function public.reserve_rev_meeting_event_execution_bound(
  target_request_id uuid,
  target_workspace_id uuid,
  target_action_id uuid,
  expected_calendar_reference text,
  expected_timezone text,
  expected_binding_version bigint
)
returns public.rev_action_executions
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy public.workspace_execution_policies;
  locked_action public.rev_actions;
  proposal public.meeting_proposals;
  binding public.rev_meeting_calendar_bindings;
  reserved public.rev_action_executions;
begin
  if auth.uid() is null or target_request_id is null or target_workspace_id is null
    or target_action_id is null or expected_calendar_reference is null
    or expected_timezone is null or expected_binding_version is null then
    raise exception 'authenticated meeting reservation and binding required';
  end if;
  if not public.has_workspace_role(target_workspace_id, array['owner', 'admin']) then
    raise exception 'active owner or admin role required';
  end if;
  -- Match Phase 5P's lock order to avoid a binding-first lock inversion.
  select * into policy from public.workspace_execution_policies
    where workspace_id = target_workspace_id for update;
  if not found then raise exception 'meeting execution policy unavailable'; end if;
  select * into locked_action from public.rev_actions
    where workspace_id = target_workspace_id and id = target_action_id for update;
  if not found then raise exception 'meeting action unavailable'; end if;
  select * into proposal from public.meeting_proposals
    where workspace_id = target_workspace_id and rev_action_id = target_action_id for update;
  if not found then raise exception 'meeting proposal unavailable'; end if;
  -- Lock persists for this whole RPC transaction. Trusted binding updates wait;
  -- Phase 5P rechecks policy, action, proposal, binding and approval.
  select * into binding from public.rev_meeting_calendar_bindings
    where workspace_id = target_workspace_id for update;
  if not found or not binding.enabled or binding.provider_key <> 'microsoft_graph'
    or binding.calendar_reference <> expected_calendar_reference
    or binding.timezone <> expected_timezone
    or binding.version <> expected_binding_version then
    raise exception 'trusted calendar binding changed';
  end if;
  reserved := public.reserve_rev_meeting_event_execution(
    target_request_id, target_workspace_id, target_action_id
  );
  if reserved.capability <> 'CREATE_APPROVED_MEETING_EVENT'
    or reserved.provider_outcome <> 'provider_not_invoked'
    or reserved.status <> 'prepared' or reserved.mode <> 'dry_run' then
    raise exception 'meeting reservation outcome is invalid';
  end if;
  return reserved;
end;
$$;

-- Existing three-ID function is an internal implementation detail after 5R.
-- Do not leave an authenticated RPC path around the expected-binding check.
revoke all on function public.reserve_rev_meeting_event_execution(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reserve_rev_meeting_event_execution_bound(uuid, uuid, uuid, text, text, bigint)
  from public, anon;
grant execute on function public.reserve_rev_meeting_event_execution_bound(uuid, uuid, uuid, text, text, bigint)
  to authenticated;
