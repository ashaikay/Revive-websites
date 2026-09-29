-- Calendar OAuth storage foundation only. No endpoints, provider calls or live activation.
-- Vault must already be installed; do not silently substitute plaintext storage.
do $$ begin
  if pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault is required for calendar OAuth storage';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT')
    or pg_catalog.has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT') then
    raise exception 'Browser roles must not have Vault decryption privileges';
  end if;
end $$;

create schema rev_calendar_private;
revoke all on schema rev_calendar_private from public, anon, authenticated, service_role;

create table rev_calendar_private.oauth_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  connection_id uuid not null,
  initiating_user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  pkce_secret_id uuid references vault.secrets(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  foreign key (workspace_id, connection_id)
    references public.workspace_calendar_connections(workspace_id, id) on delete cascade,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check ((consumed_at is null and pkce_secret_id is not null)
    or (consumed_at is not null and pkce_secret_id is null))
);
create index rev_calendar_oauth_expiry_idx on rev_calendar_private.oauth_transactions(expires_at);

create table rev_calendar_private.credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  connection_id uuid not null,
  secret_id uuid not null references vault.secrets(id),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  unique (workspace_id, connection_id),
  foreign key (workspace_id, connection_id)
    references public.workspace_calendar_connections(workspace_id, id) on delete cascade
);
alter table rev_calendar_private.oauth_transactions enable row level security;
alter table rev_calendar_private.credentials enable row level security;
revoke all on all tables in schema rev_calendar_private from public, anon, authenticated, service_role;

-- Remove only secrets owned by these records, including on workspace/connection deletion.
create function rev_calendar_private.delete_owned_secret()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'oauth_transactions' then
    delete from vault.secrets where id = old.pkce_secret_id;
  else
    delete from vault.secrets where id = old.secret_id;
  end if;
  return old;
end $$;
revoke all on function rev_calendar_private.delete_owned_secret() from public, anon, authenticated, service_role;
create trigger rev_calendar_oauth_secret_cleanup after delete on rev_calendar_private.oauth_transactions
  for each row execute function rev_calendar_private.delete_owned_secret();
create trigger rev_calendar_credential_secret_cleanup after delete on rev_calendar_private.credentials
  for each row execute function rev_calendar_private.delete_owned_secret();

-- Service calls must supply the independently verified initiating user, never untrusted JSON.
create function public.begin_rev_calendar_oauth(
  target_workspace_id uuid, target_connection_id uuid, initiating_user_id uuid,
  raw_state text, pkce_verifier text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare secret_id uuid; transaction_id uuid;
begin
  if raw_state is null or raw_state !~ '^[A-Za-z0-9_-]{43,128}$'
    or pkce_verifier is null or pkce_verifier !~ '^[A-Za-z0-9._~-]{43,128}$' then
    raise exception 'Valid OAuth state and PKCE verifier required';
  end if;
  perform 1 from public.workspace_members m where m.workspace_id = target_workspace_id
    and m.user_id = initiating_user_id and m.status = 'active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'Active workspace owner or admin required'; end if;
  perform 1 from public.workspace_calendar_connections c where c.workspace_id = target_workspace_id
    and c.id = target_connection_id and c.provider_key = 'microsoft_graph' for share;
  if not found then raise exception 'Workspace calendar connection required'; end if;
  secret_id := vault.create_secret(pkce_verifier);
  insert into rev_calendar_private.oauth_transactions(workspace_id,connection_id,initiating_user_id,state_hash,pkce_secret_id)
    values (target_workspace_id,target_connection_id,initiating_user_id,
      pg_catalog.encode(extensions.digest(raw_state,'sha256'),'hex'),secret_id)
    returning id into transaction_id;
  return transaction_id;
end $$;

create function public.consume_rev_calendar_oauth(
  target_workspace_id uuid, target_connection_id uuid, initiating_user_id uuid, raw_state text
) returns text language plpgsql security definer set search_path = '' as $$
declare transaction_row rev_calendar_private.oauth_transactions; verifier text;
begin
  if raw_state is null or raw_state !~ '^[A-Za-z0-9_-]{43,128}$' then
    raise exception 'OAuth transaction unavailable';
  end if;
  perform 1 from public.workspace_members m where m.workspace_id = target_workspace_id
    and m.user_id = initiating_user_id and m.status = 'active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'OAuth transaction unavailable'; end if;
  select t.* into transaction_row from rev_calendar_private.oauth_transactions t
    where t.workspace_id = target_workspace_id and t.connection_id = target_connection_id
      and t.initiating_user_id = consume_rev_calendar_oauth.initiating_user_id
      and t.state_hash = pg_catalog.encode(extensions.digest(raw_state,'sha256'),'hex') for update;
  if not found or transaction_row.consumed_at is not null or transaction_row.expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'OAuth transaction unavailable';
  end if;
  select s.decrypted_secret into verifier from vault.decrypted_secrets s where s.id = transaction_row.pkce_secret_id;
  if verifier is null then raise exception 'OAuth transaction unavailable'; end if;
  update rev_calendar_private.oauth_transactions set consumed_at = pg_catalog.clock_timestamp(),pkce_secret_id = null
    where id = transaction_row.id;
  delete from vault.secrets where id = transaction_row.pkce_secret_id;
  return verifier;
end $$;

-- Revision compare-and-swap prevents a stale refresh response overwriting a newer token.
-- Storing a credential does not activate a connection or select a calendar.
create function public.store_rev_calendar_credential(
  target_workspace_id uuid, target_connection_id uuid, initiating_user_id uuid,
  refresh_token text, expected_revision bigint
) returns table(credential_reference uuid, revision bigint)
language plpgsql security definer set search_path = '' as $$
declare credential_row rev_calendar_private.credentials; new_secret_id uuid;
begin
  if refresh_token is null or pg_catalog.length(refresh_token) not between 1 and 32768
    or expected_revision is null or expected_revision < 0 then raise exception 'Valid credential material required'; end if;
  perform 1 from public.workspace_members m where m.workspace_id = target_workspace_id
    and m.user_id = initiating_user_id and m.status = 'active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'Active workspace owner or admin required'; end if;
  perform 1 from public.workspace_calendar_connections c where c.workspace_id = target_workspace_id
    and c.id = target_connection_id and c.provider_key = 'microsoft_graph' for update;
  if not found then raise exception 'Workspace calendar connection required'; end if;
  select c.* into credential_row from rev_calendar_private.credentials c
    where c.workspace_id = target_workspace_id and c.connection_id = target_connection_id for update;
  if found then
    if credential_row.revision <> expected_revision then raise exception 'Credential revision conflict'; end if;
    perform vault.update_secret(credential_row.secret_id,refresh_token);
    update rev_calendar_private.credentials c set revision = c.revision+1,updated_at = pg_catalog.now()
      where c.id = credential_row.id returning c.* into credential_row;
  else
    if expected_revision <> 0 then raise exception 'Credential revision conflict'; end if;
    new_secret_id := vault.create_secret(refresh_token);
    insert into rev_calendar_private.credentials(workspace_id,connection_id,secret_id)
      values(target_workspace_id,target_connection_id,new_secret_id) returning * into credential_row;
  end if;
  return query select credential_row.id,credential_row.revision;
end $$;

create function public.load_rev_calendar_credential(
  target_workspace_id uuid, target_connection_id uuid, target_credential_reference uuid
) returns table(refresh_token text, revision bigint)
language plpgsql security definer set search_path = '' as $$
begin
  return query select s.decrypted_secret,c.revision from rev_calendar_private.credentials c
    join public.workspace_calendar_connections connection on connection.workspace_id = c.workspace_id
      and connection.id = c.connection_id
    join vault.decrypted_secrets s on s.id = c.secret_id
    join public.workspace_members m on m.workspace_id = connection.workspace_id
      and m.user_id = connection.authorized_by_user_id and m.status = 'active' and m.role in ('owner','admin')
    where c.workspace_id = target_workspace_id and c.connection_id = target_connection_id
      and c.id = target_credential_reference and connection.provider_key = 'microsoft_graph'
      and connection.connection_status = 'connected' and connection.revoked_at is null
      and connection.credential_reference = c.id::text;
  if not found then raise exception 'Calendar credential unavailable'; end if;
end $$;

-- Local revocation: clears connection material and destroys owned secrets atomically.
-- Provider-side revocation is a separate future endpoint operation.
create function public.revoke_rev_calendar_credential(target_workspace_id uuid,target_connection_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.workspace_calendar_connections c where c.workspace_id = target_workspace_id
    and c.id = target_connection_id for update;
  if not found then raise exception 'Workspace calendar connection required'; end if;
  update public.workspace_calendar_connections set connection_status='revoked',credential_reference=null,
    revoked_at=pg_catalog.now(),updated_at=pg_catalog.now() where workspace_id=target_workspace_id and id=target_connection_id;
  update public.workspace_calendars set is_selected=false,active=false,updated_at=pg_catalog.now()
    where workspace_id=target_workspace_id and connection_id=target_connection_id;
  delete from rev_calendar_private.oauth_transactions where workspace_id=target_workspace_id and connection_id=target_connection_id;
  delete from rev_calendar_private.credentials where workspace_id=target_workspace_id and connection_id=target_connection_id;
end $$;

-- Bounded cleanup for a future trusted scheduler/endpoint. No scheduler is enabled here.
create function public.purge_expired_rev_calendar_oauth(target_workspace_id uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare deleted_count bigint;
begin
  with expired as (
    select id from rev_calendar_private.oauth_transactions
      where workspace_id = target_workspace_id and expires_at <= pg_catalog.clock_timestamp()
      order by expires_at limit 500 for update skip locked
  ) delete from rev_calendar_private.oauth_transactions t using expired e where t.id=e.id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end $$;

revoke all on function public.begin_rev_calendar_oauth(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.consume_rev_calendar_oauth(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.store_rev_calendar_credential(uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.load_rev_calendar_credential(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.revoke_rev_calendar_credential(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_rev_calendar_oauth(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.consume_rev_calendar_oauth(uuid,uuid,uuid,text) to service_role;
grant execute on function public.store_rev_calendar_credential(uuid,uuid,uuid,text,bigint) to service_role;
grant execute on function public.load_rev_calendar_credential(uuid,uuid,uuid) to service_role;
grant execute on function public.revoke_rev_calendar_credential(uuid,uuid) to service_role;
revoke all on function public.purge_expired_rev_calendar_oauth(uuid) from public,anon,authenticated;
grant execute on function public.purge_expired_rev_calendar_oauth(uuid) to service_role;
