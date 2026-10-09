-- Bind dry-run meeting reservations to the current, consented Outlook calendar.
-- The provider gate and CREATE_CALENDAR_EVENT capability remain disabled.

alter table public.workspace_calendar_connections
  add column calendar_write_consent_version bigint not null default 0
    check (calendar_write_consent_version >= 0);

create function rev_calendar_private.advance_write_consent_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.calendar_write_consent_at is not null
    and new.calendar_write_consent_at is distinct from old.calendar_write_consent_at then
    new.calendar_write_consent_version := old.calendar_write_consent_version + 1;
  end if;
  return new;
end $$;
revoke all on function rev_calendar_private.advance_write_consent_version() from public,anon,authenticated,service_role;
create trigger workspace_calendar_write_consent_version
  before update of calendar_write_consent_at on public.workspace_calendar_connections
  for each row execute function rev_calendar_private.advance_write_consent_version();

create table public.rev_meeting_execution_calendar_targets (
  execution_id uuid primary key references public.rev_action_executions(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  calendar_id uuid not null,
  connection_id uuid not null,
  credential_reference uuid not null,
  credential_revision bigint not null check (credential_revision > 0),
  provider_account_reference text not null,
  provider_calendar_reference text not null,
  timezone text not null,
  consent_version bigint not null check (consent_version > 0),
  consent_at timestamptz not null,
  consent_by_user_id uuid not null,
  workspace_binding_version bigint not null check (workspace_binding_version > 0),
  target_fingerprint text not null check (target_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.now(),
  foreign key (workspace_id, calendar_id)
    references public.workspace_calendars(workspace_id, id),
  foreign key (workspace_id, connection_id)
    references public.workspace_calendar_connections(workspace_id, id),
  foreign key (workspace_id, consent_by_user_id)
    references public.workspace_members(workspace_id, user_id)
);
alter table public.rev_meeting_execution_calendar_targets enable row level security;
revoke all on public.rev_meeting_execution_calendar_targets from public,anon,authenticated,service_role;

create function public.reserve_rev_meeting_event_execution_selected(
  target_request_id uuid,
  target_workspace_id uuid,
  target_action_id uuid
) returns public.rev_action_executions
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  policy public.workspace_execution_policies;
  action public.rev_actions;
  proposal public.meeting_proposals;
  binding public.rev_meeting_calendar_bindings;
  selected public.workspace_calendars;
  connected public.workspace_calendar_connections;
  credential rev_calendar_private.credentials;
  reserved public.rev_action_executions;
  prior_target public.rev_meeting_execution_calendar_targets;
  target_fingerprint text;
begin
  if actor_id is null or target_request_id is null or target_workspace_id is null or target_action_id is null then
    raise exception 'authenticated request and identifiers required';
  end if;
  perform 1 from public.workspaces where id = target_workspace_id for update;
  if not found then raise exception 'workspace unavailable'; end if;
  if not public.has_workspace_role(target_workspace_id, array['owner','admin']) then
    raise exception 'active owner or admin role required';
  end if;
  select * into policy from public.workspace_execution_policies
    where workspace_id = target_workspace_id for update;
  if not found then raise exception 'meeting execution policy unavailable'; end if;
  select * into action from public.rev_actions
    where workspace_id = target_workspace_id and id = target_action_id for update;
  if not found then raise exception 'meeting action unavailable'; end if;
  select * into proposal from public.meeting_proposals
    where workspace_id = target_workspace_id and rev_action_id = target_action_id for update;
  if not found then raise exception 'meeting proposal unavailable'; end if;
  select * into binding from public.rev_meeting_calendar_bindings
    where workspace_id = target_workspace_id for update;
  if not found or not binding.enabled or binding.provider_key <> 'microsoft_graph' then
    raise exception 'trusted meeting workspace binding unavailable';
  end if;

  select c.* into selected from public.workspace_calendars c
    where c.workspace_id = target_workspace_id and c.is_selected and c.active
    for update;
  if not found or selected.timezone <> proposal.proposal_payload->>'timezone' then
    raise exception 'selected Outlook calendar unavailable';
  end if;
  select c.* into connected from public.workspace_calendar_connections c
    where c.workspace_id = target_workspace_id and c.id = selected.connection_id
      and c.provider_key = 'microsoft_graph' and c.connection_status = 'connected'
      and c.revoked_at is null and c.calendar_write_consent_at is not null
      and c.calendar_write_consent_version > 0
    for update;
  if not found then raise exception 'verified Outlook write consent required'; end if;
  perform 1 from public.workspace_members authorizer
    where authorizer.workspace_id = target_workspace_id
      and authorizer.user_id = connected.authorized_by_user_id
      and authorizer.status = 'active' and authorizer.role in ('owner','admin') for share;
  if not found then raise exception 'verified Outlook connection unavailable'; end if;
  perform 1 from public.workspace_members m where m.workspace_id = target_workspace_id
    and m.user_id = connected.calendar_write_consent_by_user_id
    and m.status = 'active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'verified Outlook write consent required'; end if;
  select c.* into credential from rev_calendar_private.credentials c
    where c.workspace_id = target_workspace_id and c.connection_id = connected.id
      and c.id::text = connected.credential_reference
      and c.granted_calendar_scopes @> array['https://graph.microsoft.com/calendars.readwrite']::text[]
    for share;
  if not found or connected.provider_account_reference is null
    or binding.calendar_reference <> connected.provider_account_reference
    or binding.timezone <> selected.timezone then
    raise exception 'selected Outlook calendar does not match workspace binding';
  end if;

  target_fingerprint := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'workspaceId',target_workspace_id,'calendarId',selected.id,'connectionId',connected.id,
      'credentialReference',credential.id,
      'providerAccountReference',connected.provider_account_reference,
      'providerCalendarReference',selected.provider_calendar_reference,'timezone',selected.timezone,
      'consentVersion',connected.calendar_write_consent_version,
      'consentAt',connected.calendar_write_consent_at,
      'consentBy',connected.calendar_write_consent_by_user_id,
      'workspaceBindingVersion',binding.version
    )::text,'UTF8'),'sha256'),'hex');

  select target.* into prior_target from public.rev_action_executions e
    join public.rev_meeting_execution_calendar_targets target on target.execution_id = e.id
    where e.workspace_id = target_workspace_id and e.action_id = target_action_id
      and e.action_version = action.action_version
      and e.capability = 'CREATE_APPROVED_MEETING_EVENT' for update of target;
  if found and prior_target.target_fingerprint <> target_fingerprint then
    raise exception 'selected Outlook calendar changed for reserved meeting';
  end if;

  reserved := public.reserve_rev_meeting_event_execution_bound(
    target_request_id,target_workspace_id,target_action_id,
    binding.calendar_reference,binding.timezone,binding.version
  );
  if reserved.id is null then raise exception 'meeting reservation unavailable'; end if;
  if prior_target.execution_id is null then
    insert into public.rev_meeting_execution_calendar_targets(
      execution_id,workspace_id,calendar_id,connection_id,credential_reference,credential_revision,
      provider_account_reference,provider_calendar_reference,timezone,consent_version,consent_at,
      consent_by_user_id,workspace_binding_version,target_fingerprint
    ) values (
      reserved.id,target_workspace_id,selected.id,connected.id,credential.id,credential.revision,
      connected.provider_account_reference,selected.provider_calendar_reference,selected.timezone,
      connected.calendar_write_consent_version,connected.calendar_write_consent_at,
      connected.calendar_write_consent_by_user_id,binding.version,target_fingerprint
    );
  end if;
  return reserved;
end $$;

revoke all on function public.reserve_rev_meeting_event_execution_selected(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.reserve_rev_meeting_event_execution_selected(uuid,uuid,uuid)
  to authenticated;
revoke all on function public.reserve_rev_meeting_event_execution_bound(uuid,uuid,uuid,text,text,bigint)
  from authenticated;

create function rev_calendar_private.guard_meeting_calendar_target()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  execution public.rev_action_executions;
  target public.rev_meeting_execution_calendar_targets;
  selected public.workspace_calendars;
  connected public.workspace_calendar_connections;
  credential rev_calendar_private.credentials;
  binding public.rev_meeting_calendar_bindings;
begin
  if new.capability <> 'CREATE_APPROVED_MEETING_EVENT' or new.mode <> 'live' then return new; end if;
  select * into execution from public.rev_action_executions where id = new.id;
  if not found then return new; end if;
  select * into target from public.rev_meeting_execution_calendar_targets
    where execution_id = execution.id and workspace_id = execution.workspace_id;
  if not found then raise exception 'selected Outlook calendar target unavailable'; end if;
  select * into selected from public.workspace_calendars c where c.workspace_id = target.workspace_id
    and c.id = target.calendar_id and c.connection_id = target.connection_id
    and c.provider_calendar_reference = target.provider_calendar_reference
    and c.timezone = target.timezone and c.is_selected and c.active for share;
  if not found then raise exception 'selected Outlook calendar changed'; end if;
  select * into connected from public.workspace_calendar_connections c
    where c.workspace_id = target.workspace_id and c.id = target.connection_id
      and c.provider_key = 'microsoft_graph' and c.connection_status = 'connected'
      and c.revoked_at is null and c.credential_reference = target.credential_reference::text
      and c.provider_account_reference = target.provider_account_reference
      and c.calendar_write_consent_at = target.consent_at
      and c.calendar_write_consent_version = target.consent_version
      and c.calendar_write_consent_by_user_id = target.consent_by_user_id for share;
  if not found then raise exception 'Outlook write consent changed'; end if;
  perform 1 from public.workspace_members authorizer
    where authorizer.workspace_id = target.workspace_id
      and authorizer.user_id = connected.authorized_by_user_id
      and authorizer.status = 'active' and authorizer.role in ('owner','admin') for share;
  if not found then raise exception 'Outlook connection unavailable'; end if;
  perform 1 from public.workspace_members m where m.workspace_id = target.workspace_id
    and m.user_id = target.consent_by_user_id and m.status = 'active'
    and m.role in ('owner','admin') for share;
  if not found then raise exception 'Outlook write consent unavailable'; end if;
  select * into credential from rev_calendar_private.credentials c
    where c.workspace_id = target.workspace_id and c.connection_id = target.connection_id
      and c.id = target.credential_reference
      and c.revision = target.credential_revision
      and c.granted_calendar_scopes @> array['https://graph.microsoft.com/calendars.readwrite']::text[]
    for share;
  if not found then raise exception 'Outlook write credential unavailable'; end if;
  select * into binding from public.rev_meeting_calendar_bindings b
    where b.workspace_id = target.workspace_id and b.enabled
      and b.provider_key = 'microsoft_graph'
      and b.calendar_reference = target.provider_account_reference
      and b.timezone = target.timezone
      and b.version = target.workspace_binding_version for share;
  if not found then raise exception 'workspace meeting binding changed'; end if;
  return new;
end $$;
revoke all on function rev_calendar_private.guard_meeting_calendar_target() from public,anon,authenticated,service_role;
create trigger rev_meeting_calendar_target_claim_guard
  before update of mode,status,provider_outcome on public.rev_action_executions
  for each row execute function rev_calendar_private.guard_meeting_calendar_target();

create function public.load_rev_meeting_execution_calendar_target(target_execution_id uuid)
returns table(
  execution_id uuid,workspace_id uuid,calendar_id uuid,connection_id uuid,
  credential_reference uuid,credential_revision bigint,provider_account_reference text,
  provider_calendar_reference text,timezone text,consent_version bigint,
  workspace_binding_version bigint,target_fingerprint text
)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'trusted backend role required'; end if;
  return query
    select target.execution_id,target.workspace_id,target.calendar_id,target.connection_id,
      target.credential_reference,target.credential_revision,target.provider_account_reference,
      target.provider_calendar_reference,target.timezone,target.consent_version,
      target.workspace_binding_version,target.target_fingerprint
    from public.rev_meeting_execution_calendar_targets target
    join public.rev_action_executions execution on execution.id = target.execution_id
      and execution.workspace_id = target.workspace_id
      and execution.capability = 'CREATE_APPROVED_MEETING_EVENT'
      and execution.status = 'prepared' and execution.mode = 'dry_run'
      and execution.provider_outcome = 'provider_not_invoked'
    join public.workspace_calendars calendar on calendar.workspace_id = target.workspace_id
      and calendar.id = target.calendar_id and calendar.connection_id = target.connection_id
      and calendar.provider_calendar_reference = target.provider_calendar_reference
      and calendar.timezone = target.timezone and calendar.is_selected and calendar.active
    join public.workspace_calendar_connections connection on connection.workspace_id = target.workspace_id
      and connection.id = target.connection_id and connection.connection_status = 'connected'
      and connection.revoked_at is null and connection.credential_reference = target.credential_reference::text
      and connection.provider_account_reference = target.provider_account_reference
      and connection.calendar_write_consent_at = target.consent_at
      and connection.calendar_write_consent_version = target.consent_version
      and connection.calendar_write_consent_by_user_id = target.consent_by_user_id
    join public.workspace_members connection_authorizer on connection_authorizer.workspace_id = target.workspace_id
      and connection_authorizer.user_id = connection.authorized_by_user_id
      and connection_authorizer.status = 'active' and connection_authorizer.role in ('owner','admin')
    join public.workspace_members consent_actor on consent_actor.workspace_id = target.workspace_id
      and consent_actor.user_id = target.consent_by_user_id
      and consent_actor.status = 'active' and consent_actor.role in ('owner','admin')
    join rev_calendar_private.credentials credential on credential.workspace_id = target.workspace_id
      and credential.connection_id = target.connection_id and credential.id = target.credential_reference
      and credential.revision = target.credential_revision
      and credential.granted_calendar_scopes @> array['https://graph.microsoft.com/calendars.readwrite']::text[]
    join public.rev_meeting_calendar_bindings binding on binding.workspace_id = target.workspace_id
      and binding.enabled and binding.provider_key = 'microsoft_graph'
      and binding.calendar_reference = target.provider_account_reference
      and binding.timezone = target.timezone and binding.version = target.workspace_binding_version
    where target.execution_id = target_execution_id;
  if not found then raise exception 'selected Outlook calendar target unavailable'; end if;
end $$;
revoke all on function public.load_rev_meeting_execution_calendar_target(uuid) from public,anon,authenticated;
grant execute on function public.load_rev_meeting_execution_calendar_target(uuid) to service_role;
