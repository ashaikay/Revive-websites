-- Resolve and rotate delegated write credentials only for a reserved meeting target.
-- These service-only functions do not enable event creation.

create function public.load_rev_meeting_calendar_credential(target_execution_id uuid)
returns table(
  execution_id uuid,workspace_id uuid,calendar_id uuid,connection_id uuid,
  credential_reference uuid,credential_revision bigint,provider_account_reference text,
  provider_calendar_reference text,timezone text,consent_version bigint,
  workspace_binding_version bigint,target_fingerprint text,consent_by_user_id uuid,
  refresh_token text
)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'trusted backend role required'; end if;
  return query
    select target.execution_id,target.workspace_id,target.calendar_id,target.connection_id,
      target.credential_reference,target.credential_revision,target.provider_account_reference,
      target.provider_calendar_reference,target.timezone,target.consent_version,
      target.workspace_binding_version,target.target_fingerprint,target.consent_by_user_id,
      secret.decrypted_secret
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
    join vault.decrypted_secrets secret on secret.id = credential.secret_id
    join public.rev_meeting_calendar_bindings binding on binding.workspace_id = target.workspace_id
      and binding.enabled and binding.provider_key = 'microsoft_graph'
      and binding.calendar_reference = target.provider_account_reference
      and binding.timezone = target.timezone and binding.version = target.workspace_binding_version
    where target.execution_id = target_execution_id;
  if not found then raise exception 'reserved Outlook credential unavailable'; end if;
end $$;
revoke all on function public.load_rev_meeting_calendar_credential(uuid) from public,anon,authenticated;
grant execute on function public.load_rev_meeting_calendar_credential(uuid) to service_role;

create function public.rotate_rev_meeting_calendar_credential(
  target_execution_id uuid,
  expected_revision bigint,
  target_refresh_token text
) returns table(credential_reference uuid,revision bigint)
language plpgsql security definer set search_path = '' as $$
declare
  target public.rev_meeting_execution_calendar_targets;
  target_workspace_id uuid;
  rotated record;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'trusted backend role required'; end if;
  if target_execution_id is null or expected_revision is null or expected_revision < 1
    or target_refresh_token is null or pg_catalog.length(target_refresh_token) not between 1 and 32768 then
    raise exception 'reserved Outlook credential unavailable';
  end if;
  select t.workspace_id into target_workspace_id
    from public.rev_meeting_execution_calendar_targets t
    where t.execution_id = target_execution_id;
  if not found then raise exception 'reserved Outlook credential unavailable'; end if;
  perform 1 from public.workspaces where id = target_workspace_id for update;
  if not found then raise exception 'reserved Outlook credential unavailable'; end if;
  select t.* into target
    from public.rev_meeting_execution_calendar_targets t
    join public.rev_action_executions execution on execution.id = t.execution_id
      and execution.workspace_id = t.workspace_id
      and execution.capability = 'CREATE_APPROVED_MEETING_EVENT'
      and execution.status = 'prepared' and execution.mode = 'dry_run'
      and execution.provider_outcome = 'provider_not_invoked'
    where t.execution_id = target_execution_id and t.workspace_id = target_workspace_id
      and t.credential_revision = expected_revision
    for update of t;
  if not found then raise exception 'reserved Outlook credential revision changed'; end if;
  perform 1 from public.workspace_calendars calendar
    join public.workspace_calendar_connections connection
      on connection.workspace_id = calendar.workspace_id and connection.id = calendar.connection_id
    join public.workspace_members consent_actor on consent_actor.workspace_id = target.workspace_id
      and consent_actor.user_id = target.consent_by_user_id
      and consent_actor.status = 'active' and consent_actor.role in ('owner','admin')
    join rev_calendar_private.credentials credential on credential.workspace_id = target.workspace_id
      and credential.connection_id = target.connection_id and credential.id = target.credential_reference
      and credential.revision = expected_revision
      and credential.granted_calendar_scopes @> array['https://graph.microsoft.com/calendars.readwrite']::text[]
    join public.rev_meeting_calendar_bindings binding on binding.workspace_id = target.workspace_id
      and binding.enabled and binding.provider_key = 'microsoft_graph'
      and binding.calendar_reference = target.provider_account_reference
      and binding.timezone = target.timezone and binding.version = target.workspace_binding_version
    where calendar.workspace_id = target.workspace_id and calendar.id = target.calendar_id
      and calendar.connection_id = target.connection_id and calendar.is_selected and calendar.active
      and calendar.provider_calendar_reference = target.provider_calendar_reference
      and calendar.timezone = target.timezone
      and connection.connection_status = 'connected' and connection.revoked_at is null
      and connection.credential_reference = target.credential_reference::text
      and connection.provider_account_reference = target.provider_account_reference
      and connection.calendar_write_consent_at = target.consent_at
      and connection.calendar_write_consent_version = target.consent_version
      and connection.calendar_write_consent_by_user_id = target.consent_by_user_id
      and exists (
        select 1 from public.workspace_members connection_authorizer
        where connection_authorizer.workspace_id = target.workspace_id
          and connection_authorizer.user_id = connection.authorized_by_user_id
          and connection_authorizer.status = 'active'
          and connection_authorizer.role in ('owner','admin')
      );
  if not found then raise exception 'reserved Outlook credential unavailable'; end if;

  select result.credential_reference,result.revision into rotated
    from public.rotate_rev_selected_calendar_credential(
      target.workspace_id,target.consent_by_user_id,target.calendar_id,target.connection_id,
      target.credential_reference,expected_revision,target_refresh_token
    ) result;
  if not found or rotated.credential_reference <> target.credential_reference
    or rotated.revision <> expected_revision + 1 then
    raise exception 'reserved Outlook credential rotation failed';
  end if;
  update public.rev_meeting_execution_calendar_targets reservation_target
    set credential_revision = rotated.revision
    from public.rev_action_executions execution
    where reservation_target.execution_id = execution.id
      and reservation_target.workspace_id = target_workspace_id
      and reservation_target.calendar_id = target.calendar_id
      and reservation_target.connection_id = target.connection_id
      and reservation_target.credential_reference = target.credential_reference
      and reservation_target.provider_account_reference = target.provider_account_reference
      and reservation_target.provider_calendar_reference = target.provider_calendar_reference
      and reservation_target.timezone = target.timezone
      and reservation_target.consent_version = target.consent_version
      and reservation_target.consent_at = target.consent_at
      and reservation_target.consent_by_user_id = target.consent_by_user_id
      and reservation_target.workspace_binding_version = target.workspace_binding_version
      and reservation_target.target_fingerprint = target.target_fingerprint
      and reservation_target.credential_revision = expected_revision
      and execution.workspace_id = target_workspace_id
      and execution.status = 'prepared' and execution.mode = 'dry_run'
      and execution.provider_outcome = 'provider_not_invoked';
  if not found then raise exception 'reserved Outlook credential revision changed'; end if;
  return query select rotated.credential_reference,rotated.revision;
end $$;
revoke all on function public.rotate_rev_meeting_calendar_credential(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.rotate_rev_meeting_calendar_credential(uuid,bigint,text) to service_role;
