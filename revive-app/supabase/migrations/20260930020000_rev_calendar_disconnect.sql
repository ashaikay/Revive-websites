-- Owner/admin-managed removal of REV's stored access. No Microsoft grant revocation or event changes.
create function public.disconnect_rev_workspace_calendar(target_workspace_id uuid,target_connection_id uuid,initiating_user_id uuid)
returns table(connection_id uuid,connection_status text)
language plpgsql security definer set search_path='' as $$
declare connected public.workspace_calendar_connections;
begin
  -- Serialize with selection and selected-token rotation.
  perform 1 from public.workspaces w where w.id=target_workspace_id for update;
  if not found then raise exception 'Calendar connection unavailable'; end if;
  perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'Active owner or admin required'; end if;
  select c.* into connected from public.workspace_calendar_connections c where c.workspace_id=target_workspace_id and c.id=target_connection_id and c.provider_key='microsoft_graph' for update;
  if not found then raise exception 'Calendar connection unavailable'; end if;
  -- Repeated calls are harmless. Always purge lingering pending/private material as well.
  perform public.revoke_rev_calendar_credential(target_workspace_id,target_connection_id);
  if exists(select 1 from rev_calendar_private.credentials c where c.workspace_id=target_workspace_id and c.connection_id=target_connection_id)
    or exists(select 1 from rev_calendar_private.oauth_transactions t where t.workspace_id=target_workspace_id and t.connection_id=target_connection_id)
    or exists(select 1 from public.workspace_calendars c where c.workspace_id=target_workspace_id and c.connection_id=target_connection_id and (c.active or c.is_selected)) then raise exception 'Calendar disconnect unavailable'; end if;
  return query select connected.id,'revoked'::text;
end $$;
revoke all on function public.disconnect_rev_workspace_calendar(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.disconnect_rev_workspace_calendar(uuid,uuid,uuid) to service_role;
