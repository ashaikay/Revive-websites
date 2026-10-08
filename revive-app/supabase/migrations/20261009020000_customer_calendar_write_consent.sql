-- Store only the verified delegated Graph calendar permission; existing credentials stay read-only.
alter table rev_calendar_private.credentials
  add column granted_calendar_scopes text[] not null
    default array['https://graph.microsoft.com/calendars.read']::text[];

alter table rev_calendar_private.oauth_transactions
  add column requested_access_mode text not null default 'read'
    check (requested_access_mode in ('read', 'write')),
  add column expected_credential_revision bigint not null default 0
    check (expected_credential_revision >= 0);

alter table public.workspace_calendar_connections
  add column calendar_write_consent_at timestamptz,
  add column calendar_write_consent_by_user_id uuid,
  add constraint workspace_calendar_write_consent_actor_fk
    foreign key (workspace_id, calendar_write_consent_by_user_id)
    references public.workspace_members(workspace_id, user_id)
    on delete set null (calendar_write_consent_by_user_id);

grant select (calendar_write_consent_at)
  on public.workspace_calendar_connections to authenticated;

create function rev_calendar_private.clear_calendar_write_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.connection_status <> 'connected' or new.revoked_at is not null then
    new.calendar_write_consent_at := null;
    new.calendar_write_consent_by_user_id := null;
  end if;
  return new;
end $$;
revoke all on function rev_calendar_private.clear_calendar_write_consent() from public,anon,authenticated,service_role;
create trigger workspace_calendar_clear_write_consent
  before update of connection_status,revoked_at on public.workspace_calendar_connections
  for each row execute function rev_calendar_private.clear_calendar_write_consent();

create function public.begin_rev_calendar_oauth_consent(
  target_workspace_id uuid,
  target_connection_id uuid,
  initiating_user_id uuid,
  raw_state text,
  pkce_verifier text,
  requested_access_mode text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  secret_id uuid;
  transaction_id uuid;
  expected_revision bigint := 0;
  connected public.workspace_calendar_connections;
begin
  if requested_access_mode is distinct from 'write'
    or raw_state is null or raw_state !~ '^[A-Za-z0-9_-]{43,128}$'
    or pkce_verifier is null or pkce_verifier !~ '^[A-Za-z0-9._~-]{43,128}$' then
    raise exception 'Valid write-consent request required';
  end if;
  perform 1 from public.workspaces w where w.id = target_workspace_id for update;
  if not found then raise exception 'Calendar connection unavailable'; end if;
  perform 1 from public.workspace_members m where m.workspace_id = target_workspace_id
    and m.user_id = initiating_user_id and m.status = 'active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'Calendar connection unavailable'; end if;
  select c.* into connected from public.workspace_calendar_connections c
    where c.workspace_id = target_workspace_id and c.id = target_connection_id
      and c.provider_key = 'microsoft_graph' and c.connection_status = 'connected'
    and c.revoked_at is null
    for update;
  if not found then raise exception 'Calendar connection unavailable'; end if;
  perform 1 from public.workspace_calendars c where c.workspace_id = target_workspace_id
    and c.connection_id = target_connection_id and c.is_selected and c.active for share;
  if not found then raise exception 'Selected calendar unavailable'; end if;
  select c.revision into expected_revision from rev_calendar_private.credentials c
    where c.workspace_id = target_workspace_id and c.connection_id = target_connection_id
      and c.id::text = connected.credential_reference for share;
  if not found or expected_revision < 1 then raise exception 'Calendar credential unavailable'; end if;
  secret_id := vault.create_secret(pkce_verifier);
  insert into rev_calendar_private.oauth_transactions(
    workspace_id, connection_id, initiating_user_id, state_hash, pkce_secret_id,
    requested_access_mode, expected_credential_revision
  ) values (
    target_workspace_id, target_connection_id, initiating_user_id,
    pg_catalog.encode(extensions.digest(raw_state,'sha256'),'hex'), secret_id,
    requested_access_mode, expected_revision
  ) returning id into transaction_id;
  return transaction_id;
end $$;

create function public.consume_rev_calendar_oauth_with_consent(
  target_workspace_id uuid,
  target_connection_id uuid,
  initiating_user_id uuid,
  raw_state text
) returns table(pkce_verifier text, requested_access_mode text, expected_credential_revision bigint)
language plpgsql security definer set search_path = '' as $$
declare
  transaction_row rev_calendar_private.oauth_transactions;
  verifier text;
begin
  if raw_state is null or raw_state !~ '^[A-Za-z0-9_-]{43,128}$' then
    raise exception 'OAuth transaction unavailable';
  end if;
  perform 1 from public.workspace_members m where m.workspace_id = target_workspace_id
    and m.user_id = initiating_user_id and m.status = 'active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'OAuth transaction unavailable'; end if;
  select t.* into transaction_row from rev_calendar_private.oauth_transactions t
    where t.workspace_id = target_workspace_id and t.connection_id = target_connection_id
      and t.initiating_user_id = consume_rev_calendar_oauth_with_consent.initiating_user_id
      and t.state_hash = pg_catalog.encode(extensions.digest(raw_state,'sha256'),'hex')
    for update;
  if not found or transaction_row.consumed_at is not null
    or transaction_row.expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'OAuth transaction unavailable';
  end if;
  select s.decrypted_secret into verifier from vault.decrypted_secrets s
    where s.id = transaction_row.pkce_secret_id;
  if verifier is null then raise exception 'OAuth transaction unavailable'; end if;
  update rev_calendar_private.oauth_transactions
    set consumed_at = pg_catalog.clock_timestamp(), pkce_secret_id = null
    where id = transaction_row.id;
  delete from vault.secrets where id = transaction_row.pkce_secret_id;
  return query select verifier, transaction_row.requested_access_mode,
    transaction_row.expected_credential_revision;
end $$;

create function public.store_rev_calendar_credential_with_consent(
  target_workspace_id uuid,
  target_connection_id uuid,
  initiating_user_id uuid,
  refresh_token text,
  expected_revision bigint,
  requested_access_mode text,
  granted_calendar_scopes text[]
) returns table(credential_reference uuid, revision bigint, connection_status text)
language plpgsql security definer set search_path = '' as $$
declare
  normalized_scopes text[];
  stored record;
  connection_state text;
begin
  if (requested_access_mode is distinct from 'read' and requested_access_mode is distinct from 'write')
    or granted_calendar_scopes is null then
    raise exception 'Verified calendar consent required';
  end if;
  select array_agg(distinct lower(btrim(scope)) order by lower(btrim(scope)))
    into normalized_scopes from unnest(granted_calendar_scopes) as scopes(scope)
    where btrim(scope) <> '';
  if normalized_scopes is null
    or not (normalized_scopes <@ array[
      'https://graph.microsoft.com/calendars.read',
      'https://graph.microsoft.com/calendars.readwrite'
    ]::text[]) then
    raise exception 'Verified calendar consent required';
  end if;
  if requested_access_mode = 'read' and (
      not normalized_scopes @> array['https://graph.microsoft.com/calendars.read']::text[]
      or normalized_scopes @> array['https://graph.microsoft.com/calendars.readwrite']::text[]
    ) then raise exception 'Verified calendar consent required'; end if;
  if requested_access_mode = 'write' and
      not normalized_scopes @> array['https://graph.microsoft.com/calendars.readwrite']::text[] then
    raise exception 'Verified calendar consent required';
  end if;
  if requested_access_mode = 'write' then
    perform 1 from public.workspaces w where w.id = target_workspace_id for update;
    if not found then raise exception 'Selected calendar unavailable'; end if;
    perform 1 from public.workspace_calendar_connections c
      where c.workspace_id = target_workspace_id and c.id = target_connection_id
        and c.connection_status = 'connected' and c.revoked_at is null
      for update;
    if not found then raise exception 'Selected calendar unavailable'; end if;
    perform 1 from public.workspace_calendars c
      where c.workspace_id = target_workspace_id and c.connection_id = target_connection_id
        and c.is_selected and c.active for share;
    if not found then raise exception 'Selected calendar unavailable'; end if;
  else
    perform 1 from public.workspace_calendar_connections c
      where c.workspace_id = target_workspace_id and c.id = target_connection_id
        and c.connection_status = 'disconnected' and c.revoked_at is null
      for update;
    if not found then raise exception 'Pending calendar connection unavailable'; end if;
  end if;

  select * into stored from public.store_rev_calendar_credential(
    target_workspace_id, target_connection_id, initiating_user_id, refresh_token, expected_revision
  );
  update rev_calendar_private.credentials c set granted_calendar_scopes = normalized_scopes
    where c.workspace_id = target_workspace_id and c.connection_id = target_connection_id
      and c.id = stored.credential_reference;
  update public.workspace_calendar_connections c
    set calendar_write_consent_at = case when requested_access_mode = 'write' then pg_catalog.now() else null end,
      calendar_write_consent_by_user_id = case when requested_access_mode = 'write' then initiating_user_id else null end
    where c.workspace_id = target_workspace_id and c.id = target_connection_id
    returning c.connection_status into connection_state;
  if connection_state is null then raise exception 'Calendar connection unavailable'; end if;
  return query select stored.credential_reference, stored.revision, connection_state;
end $$;

create function public.require_rev_selected_calendar_write_consent(
  target_workspace_id uuid,
  requesting_user_id uuid,
  target_calendar_id uuid
) returns table(calendar_id uuid, connection_id uuid, credential_reference uuid, revision bigint)
language plpgsql security definer set search_path = '' as $$
declare
  selected public.workspace_calendars;
  connected public.workspace_calendar_connections;
  credential rev_calendar_private.credentials;
begin
  perform 1 from public.workspaces w where w.id = target_workspace_id for share;
  if not found then raise exception 'Write-authorized calendar unavailable'; end if;
  perform 1 from public.workspace_members m where m.workspace_id = target_workspace_id
    and m.user_id = requesting_user_id and m.status = 'active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'Write-authorized calendar unavailable'; end if;
  select c.* into selected from public.workspace_calendars c
    where c.workspace_id = target_workspace_id and c.id = target_calendar_id
      and c.is_selected and c.active for share;
  if not found then raise exception 'Write-authorized calendar unavailable'; end if;
  select c.* into connected from public.workspace_calendar_connections c
    where c.workspace_id = target_workspace_id and c.id = selected.connection_id
      and c.provider_key = 'microsoft_graph' and c.connection_status = 'connected'
      and c.revoked_at is null and c.calendar_write_consent_at is not null for share;
  if not found then raise exception 'Write-authorized calendar unavailable'; end if;
  perform 1 from public.workspace_members m where m.workspace_id = target_workspace_id
    and m.user_id = connected.authorized_by_user_id and m.status = 'active'
    and m.role in ('owner','admin') for share;
  if not found then raise exception 'Write-authorized calendar unavailable'; end if;
  select c.* into credential from rev_calendar_private.credentials c
    where c.workspace_id = target_workspace_id and c.connection_id = connected.id
      and c.id::text = connected.credential_reference
      and c.granted_calendar_scopes @> array[
        'https://graph.microsoft.com/calendars.readwrite'
      ]::text[] for share;
  if not found then raise exception 'Write-authorized calendar unavailable'; end if;
  return query select selected.id, connected.id, credential.id, credential.revision;
end $$;

revoke all on function public.begin_rev_calendar_oauth_consent(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.consume_rev_calendar_oauth_with_consent(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.store_rev_calendar_credential_with_consent(uuid,uuid,uuid,text,bigint,text,text[]) from public,anon,authenticated;
revoke all on function public.require_rev_selected_calendar_write_consent(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_rev_calendar_oauth_consent(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.consume_rev_calendar_oauth_with_consent(uuid,uuid,uuid,text) to service_role;
grant execute on function public.store_rev_calendar_credential_with_consent(uuid,uuid,uuid,text,bigint,text,text[]) to service_role;
grant execute on function public.require_rev_selected_calendar_write_consent(uuid,uuid,uuid) to service_role;
