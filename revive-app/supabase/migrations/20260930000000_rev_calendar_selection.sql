-- Selection metadata only. No meeting binding or provider activation changes.
create function public.select_rev_workspace_calendar(target_workspace_id uuid,target_calendar_id uuid,initiating_user_id uuid)
returns table(calendar_id uuid,connection_id uuid,is_selected boolean)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare target public.workspace_calendars; connected public.workspace_calendar_connections;
begin
  perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'Active owner or admin required'; end if;
  -- Serialize selection across all connections in this workspace.
  perform 1 from public.workspaces w where w.id=target_workspace_id for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  select c.* into target from public.workspace_calendars c where c.workspace_id=target_workspace_id and c.id=target_calendar_id;
  if not found then raise exception 'Calendar unavailable'; end if;
  -- Lock connection before calendar, matching the existing revocation lock order.
  select c.* into connected from public.workspace_calendar_connections c where c.workspace_id=target_workspace_id and c.id=target.connection_id and c.provider_key='microsoft_graph' and c.connection_status='connected' and c.revoked_at is null for update;
  if not found then raise exception 'Connected calendar required'; end if;
  perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=connected.authorized_by_user_id and m.status='active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'Connection authorizer unavailable'; end if;
  perform 1 from rev_calendar_private.credentials c where c.workspace_id=target_workspace_id and c.connection_id=connected.id and c.id::text=connected.credential_reference;
  if not found then raise exception 'Connection credential unavailable'; end if;
  select c.* into target from public.workspace_calendars c where c.workspace_id=target_workspace_id and c.id=target_calendar_id and c.connection_id=connected.id and c.active=true for update;
  if not found then raise exception 'Active calendar required'; end if;
  update public.workspace_calendars set is_selected=false,updated_at=now() where workspace_id=target_workspace_id and is_selected=true and id<>target_calendar_id;
  update public.workspace_calendars set is_selected=true,updated_at=now() where workspace_id=target_workspace_id and id=target_calendar_id;
  return query select target.id,connected.id,true;
end $$;
revoke all on function public.select_rev_workspace_calendar(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.select_rev_workspace_calendar(uuid,uuid,uuid) to service_role;
