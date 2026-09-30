-- Internal scheduling exceptions only. No medical notes, invitations or external effects.
create table public.scheduling_worker_unavailability (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 worker_id uuid not null,
 start_at timestamptz not null,
 end_at timestamptz not null,
 category text not null check(category in ('leave','unavailable')),
 status text not null default 'active' check(status in ('active','cancelled')),
 version bigint not null default 1 check(version>=1),
 created_by_user_id uuid not null,
 updated_by_user_id uuid not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),
 foreign key(workspace_id,worker_id) references public.scheduling_workers(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id),
 foreign key(workspace_id,updated_by_user_id) references public.workspace_members(workspace_id,user_id),
 check(isfinite(start_at) and isfinite(end_at) and start_at<end_at)
);
create index scheduling_worker_unavailability_worker_idx on public.scheduling_worker_unavailability(workspace_id,worker_id,start_at) where status='active';
alter table public.scheduling_worker_unavailability enable row level security;
revoke all on public.scheduling_worker_unavailability from public,anon,authenticated;
grant select on public.scheduling_worker_unavailability to authenticated;
grant select,insert,update on public.scheduling_worker_unavailability to service_role;
create policy worker_unavailability_managers_read on public.scheduling_worker_unavailability for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));
create table rev_scheduling_private.unavailability_requests (
 request_id uuid primary key,workspace_id uuid not null references public.workspaces(id),actor_user_id uuid not null,
 input jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
revoke all on rev_scheduling_private.unavailability_requests from public,anon,authenticated,service_role;

create function public.save_rev_worker_unavailability(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_worker_id uuid,target_unavailability_id uuid,
 target_start_at timestamptz,target_end_at timestamptz,target_category text,target_status text,expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.scheduling_worker_unavailability;existing public.scheduling_worker_unavailability;
 previous rev_scheduling_private.unavailability_requests;worker_active boolean;request_input jsonb;result jsonb;
begin
 if target_request_id is null or target_worker_id is null or expected_version is null or expected_version<0
 or (target_unavailability_id is null and (expected_version<>0 or target_status is distinct from 'active'))
 or (target_unavailability_id is not null and expected_version=0)
 or target_start_at is null or target_end_at is null or not isfinite(target_start_at) or not isfinite(target_end_at) or target_start_at>=target_end_at
 or target_category is null or target_category not in ('leave','unavailable') or target_status is null or target_status not in ('active','cancelled')
 then raise exception 'Valid unavailable period required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces w where w.id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and m.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 request_input=pg_catalog.jsonb_build_object('worker_id',target_worker_id,'unavailability_id',target_unavailability_id,'start_at',target_start_at,'end_at',target_end_at,'category',target_category,'status',target_status,'expected_version',expected_version);
 select r.* into previous from rev_scheduling_private.unavailability_requests r where r.request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Unavailable period request unavailable';end if;
  return previous.result;
 end if;
 select w.active into worker_active from public.scheduling_workers w where w.workspace_id=target_workspace_id and w.id=target_worker_id for update;
 if not found or (target_status='active' and worker_active is not true) then raise exception 'Worker unavailable';end if;
 if target_unavailability_id is null then
  insert into public.scheduling_worker_unavailability(workspace_id,worker_id,start_at,end_at,category,status,created_by_user_id,updated_by_user_id)
   values(target_workspace_id,target_worker_id,target_start_at,target_end_at,target_category,'active',initiating_user_id,initiating_user_id) returning * into saved;
 else
  select u.* into existing from public.scheduling_worker_unavailability u where u.workspace_id=target_workspace_id and u.worker_id=target_worker_id and u.id=target_unavailability_id for update;
  if not found or existing.version<>expected_version then raise exception 'Unavailable period changed';end if;
  -- Cancellation is terminal; cancelled periods cannot be reactivated or edited.
  if existing.status<>'active' then raise exception 'Unavailable period already cancelled';end if;
  if target_status='cancelled' and (existing.start_at<>target_start_at or existing.end_at<>target_end_at or existing.category<>target_category) then raise exception 'Cancellation must retain the saved interval';end if;
  update public.scheduling_worker_unavailability u set start_at=target_start_at,end_at=target_end_at,category=target_category,status=target_status,version=u.version+1,updated_by_user_id=initiating_user_id,updated_at=now()
   where u.workspace_id=target_workspace_id and u.id=target_unavailability_id returning u.* into saved;
 end if;
 result=pg_catalog.jsonb_build_object('unavailability_id',saved.id,'workspace_id',saved.workspace_id,'worker_id',saved.worker_id,'start_at',saved.start_at,'end_at',saved.end_at,'category',saved.category,'status',saved.status,'version',saved.version);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
  values(target_workspace_id,initiating_user_id,'user',case when target_status='cancelled' then 'scheduling.unavailability.cancelled' else 'scheduling.unavailability.saved' end,'scheduling_worker_unavailability',saved.id,
   pg_catalog.jsonb_build_object('worker_id',target_worker_id,'request_id',target_request_id,'previous_version',expected_version,'version',saved.version,'status',saved.status));
 insert into rev_scheduling_private.unavailability_requests(request_id,workspace_id,actor_user_id,input,result) values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;
revoke all on function public.save_rev_worker_unavailability(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,bigint) from public,anon,authenticated;
grant execute on function public.save_rev_worker_unavailability(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,bigint) to service_role;
