create or replace function public.save_rev_calendar_discovery(target_workspace_id uuid,target_connection_id uuid,initiating_user_id uuid,target_credential_reference uuid,expected_revision bigint,target_account_reference text,target_timezone text,discovered_calendars jsonb)
returns table(connection_id uuid,connection_status text,calendar_count integer)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare credential_row rev_calendar_private.credentials; entry jsonb; total integer;
begin
  perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'Active owner or admin required'; end if;
  perform 1 from public.workspace_calendar_connections c where c.workspace_id=target_workspace_id and c.id=target_connection_id and c.provider_key='microsoft_graph' and c.connection_status='disconnected' and c.revoked_at is null and c.authorized_by_user_id=initiating_user_id for update;
  if not found then raise exception 'Pending connection unavailable'; end if;
  select c.* into credential_row from rev_calendar_private.credentials c where c.workspace_id=target_workspace_id and c.connection_id=target_connection_id and c.id=target_credential_reference and c.revision=expected_revision for update;
  if not found then raise exception 'Credential revision conflict'; end if;
  if target_account_reference is null or length(target_account_reference)>320 or target_account_reference!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or target_account_reference<>lower(target_account_reference) then raise exception 'Account reference required'; end if;
  perform 1 from pg_catalog.pg_timezone_names where name=target_timezone;
  if not found then raise exception 'Timezone required'; end if;
  if jsonb_typeof(discovered_calendars) is distinct from 'array' then raise exception 'Calendar metadata required'; end if;
  total:=jsonb_array_length(discovered_calendars);
  if total<1 or total>1000 then raise exception 'Calendar metadata required'; end if;
  for entry in select value from jsonb_array_elements(discovered_calendars) loop
    if jsonb_typeof(entry) is distinct from 'object' or jsonb_typeof(entry->'providerCalendarReference') is distinct from 'string' or jsonb_typeof(entry->'displayName') is distinct from 'string' or jsonb_typeof(entry->'ownerAddress') is distinct from 'string' or jsonb_typeof(entry->'isDefault') is distinct from 'boolean' or length(btrim(entry->>'providerCalendarReference')) not between 1 and 2048 or length(btrim(entry->>'displayName')) not between 1 and 240 or (entry->>'ownerAddress') is distinct from target_account_reference then raise exception 'Invalid calendar metadata'; end if;
  end loop;
  if (select count(distinct value->>'providerCalendarReference') from jsonb_array_elements(discovered_calendars))<>total or (select count(*) from jsonb_array_elements(discovered_calendars) where value->>'isDefault'='true')<>1 then raise exception 'Invalid calendar metadata'; end if;
  update public.workspace_calendars set active=false,is_selected=false,updated_at=now() where workspace_id=target_workspace_id and connection_id=target_connection_id;
  insert into public.workspace_calendars(workspace_id,connection_id,provider_calendar_reference,display_name,timezone,is_selected,active)
    select target_workspace_id,target_connection_id,value->>'providerCalendarReference',value->>'displayName',target_timezone,false,true from jsonb_array_elements(discovered_calendars)
    on conflict(workspace_id,connection_id,provider_calendar_reference) do update set display_name=excluded.display_name,timezone=excluded.timezone,is_selected=false,active=true,updated_at=now();
  update public.workspace_calendar_connections set connection_status='connected',provider_account_reference=target_account_reference,credential_reference=target_credential_reference::text,authorized_at=now(),last_verified_at=now(),updated_at=now() where workspace_id=target_workspace_id and id=target_connection_id;
  return query select target_connection_id,'connected'::text,total;
end $$;
