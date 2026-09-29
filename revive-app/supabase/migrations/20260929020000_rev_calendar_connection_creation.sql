-- Browser writes remain denied. The authenticated HTTP boundary supplies the verified actor.
create function public.create_rev_calendar_connection(
  target_workspace_id uuid, initiating_user_id uuid, target_request_id uuid
) returns table(connection_id uuid, connection_status text)
language plpgsql security definer set search_path = '' as $$
declare connection_row public.workspace_calendar_connections;
begin
  if target_workspace_id is null or initiating_user_id is null or target_request_id is null then
    raise exception 'Connection identifiers required';
  end if;
  perform 1 from public.workspace_members m
    where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id
      and m.status='active' and m.role in ('owner','admin') for share;
  if not found then raise exception 'Active workspace owner or admin required'; end if;
  -- Client retry ID becomes the row ID. A collision cannot transfer tenant or actor ownership.
  insert into public.workspace_calendar_connections(id,workspace_id,provider_key,authorized_by_user_id)
    values(target_request_id,target_workspace_id,'microsoft_graph',initiating_user_id)
    on conflict(id) do nothing;
  select c.* into connection_row from public.workspace_calendar_connections c
    where c.id=target_request_id for share;
  if not found or connection_row.workspace_id<>target_workspace_id
    or connection_row.provider_key<>'microsoft_graph'
    or connection_row.authorized_by_user_id is distinct from initiating_user_id then
    raise exception 'Connection request unavailable';
  end if;
  return query select connection_row.id,connection_row.connection_status::text;
end $$;
revoke all on function public.create_rev_calendar_connection(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_rev_calendar_connection(uuid,uuid,uuid) to service_role;
