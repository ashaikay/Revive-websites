-- Reset an existing inactive connection for fresh consent. Connected accounts require explicit disconnect first.
create function public.prepare_rev_calendar_reconnect(target_workspace_id uuid,target_connection_id uuid,initiating_user_id uuid)
returns table(connection_id uuid,connection_status text)
language plpgsql security definer set search_path='' as $$
declare connected public.workspace_calendar_connections;
begin
  perform 1 from public.workspaces w where w.id=target_workspace_id for update;
  if not found then raise exception 'Calendar connection unavailable'; end if;
  perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'Active owner or admin required'; end if;
  select c.* into connected from public.workspace_calendar_connections c where c.workspace_id=target_workspace_id and c.id=target_connection_id and c.provider_key='microsoft_graph' for update;
  if not found or connected.connection_status not in ('revoked','expired','error','disconnected') then raise exception 'Inactive calendar connection required'; end if;
  -- Purge old tokens, state and PKCE secrets before starting a new authorization attempt.
  perform public.revoke_rev_calendar_credential(target_workspace_id,target_connection_id);
  update public.workspace_calendar_connections c set connection_status='disconnected',credential_reference=null,revoked_at=null,authorized_by_user_id=initiating_user_id,authorized_at=null,last_verified_at=null,updated_at=now() where c.workspace_id=target_workspace_id and c.id=target_connection_id;
  -- Retain account reference and calendar IDs; discovery revalidates ownership and activates rows unselected.
  return query select connected.id,'disconnected'::text;
end $$;
revoke all on function public.prepare_rev_calendar_reconnect(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_rev_calendar_reconnect(uuid,uuid,uuid) to service_role;
