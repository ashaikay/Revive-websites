-- Service-only selected-calendar read authority. Does not activate availability or bookings.
create function public.load_rev_selected_calendar_credential(target_workspace_id uuid, requesting_user_id uuid)
returns table(calendar_id uuid,connection_id uuid,provider_calendar_reference text,timezone text,provider_account_reference text,credential_reference uuid,revision bigint,refresh_token text)
language plpgsql security definer set search_path='' as $$
declare selected public.workspace_calendars; connected public.workspace_calendar_connections; credential rev_calendar_private.credentials; token text;
begin
  perform 1 from public.workspaces w where w.id=target_workspace_id for share;
  if not found then raise exception 'Selected calendar unavailable'; end if;
  perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=requesting_user_id and m.status='active' for share;
  if not found then raise exception 'Selected calendar unavailable'; end if;
  select c.* into selected from public.workspace_calendars c where c.workspace_id=target_workspace_id and c.is_selected and c.active;
  if not found then raise exception 'Selected calendar unavailable'; end if;
  select c.* into connected from public.workspace_calendar_connections c where c.workspace_id=target_workspace_id and c.id=selected.connection_id and c.provider_key='microsoft_graph' and c.connection_status='connected' and c.revoked_at is null for share;
  if not found then raise exception 'Selected calendar unavailable'; end if;
  perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=connected.authorized_by_user_id and m.status='active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'Selected calendar unavailable'; end if;
  select c.* into selected from public.workspace_calendars c where c.workspace_id=target_workspace_id and c.id=selected.id and c.connection_id=connected.id and c.is_selected and c.active for share;
  if not found then raise exception 'Selected calendar unavailable'; end if;
  select c.* into credential from rev_calendar_private.credentials c where c.workspace_id=target_workspace_id and c.connection_id=connected.id and c.id::text=connected.credential_reference for share;
  if not found then raise exception 'Selected calendar unavailable'; end if;
  select s.decrypted_secret into token from vault.decrypted_secrets s where s.id=credential.secret_id;
  if token is null or length(token)=0 or connected.provider_account_reference is null then raise exception 'Selected calendar unavailable'; end if;
  return query select selected.id,connected.id,selected.provider_calendar_reference,selected.timezone,connected.provider_account_reference,credential.id,credential.revision,token;
end $$;
revoke all on function public.load_rev_selected_calendar_credential(uuid,uuid) from public,anon,authenticated;
grant execute on function public.load_rev_selected_calendar_credential(uuid,uuid) to service_role;

create function public.rotate_rev_selected_calendar_credential(target_workspace_id uuid,requesting_user_id uuid,target_calendar_id uuid,target_connection_id uuid,target_credential_reference uuid,expected_revision bigint,refresh_token text)
returns table(credential_reference uuid,revision bigint)
language plpgsql security definer set search_path='' as $$
declare snapshot record; authorizer uuid;
begin
  -- Same workspace serialization as calendar selection; connection locks also exclude revocation.
  perform 1 from public.workspaces w where w.id=target_workspace_id for update;
  if not found then raise exception 'Selected calendar unavailable'; end if;
  select * into snapshot from public.load_rev_selected_calendar_credential(target_workspace_id,requesting_user_id);
  if target_calendar_id is distinct from snapshot.calendar_id or target_connection_id is distinct from snapshot.connection_id or target_credential_reference is distinct from snapshot.credential_reference or expected_revision is distinct from snapshot.revision then raise exception 'Selected calendar changed'; end if;
  select c.authorized_by_user_id into authorizer from public.workspace_calendar_connections c where c.workspace_id=target_workspace_id and c.id=target_connection_id;
  return query select r.credential_reference,r.revision from public.store_rev_calendar_credential(target_workspace_id,target_connection_id,authorizer,refresh_token,expected_revision) r;
end $$;
revoke all on function public.rotate_rev_selected_calendar_credential(uuid,uuid,uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.rotate_rev_selected_calendar_credential(uuid,uuid,uuid,uuid,uuid,bigint,text) to service_role;
