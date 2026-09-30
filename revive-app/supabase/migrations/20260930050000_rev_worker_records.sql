-- Worker records do not create Auth users or workspace memberships.
create schema if not exists rev_scheduling_private;
revoke all on schema rev_scheduling_private from public,anon,authenticated;
create function rev_scheduling_private.valid_tags(tags text[])
returns boolean language sql immutable set search_path='' as $$
 select tags is not null and cardinality(tags)<=30
 and (cardinality(tags)=0 or array_ndims(tags)=1)
 and not exists(select 1 from unnest(tags) t where t is null or length(t) not between 1 and 80 or t<>trim(t))
 and (select count(distinct t) from unnest(tags) t)=cardinality(tags);
$$;
revoke all on function rev_scheduling_private.valid_tags(text[]) from public,anon,authenticated;

create table public.scheduling_workers (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 display_name text not null check(length(display_name) between 1 and 120 and display_name=trim(display_name)),
 role_labels text[] not null default '{}' check(rev_scheduling_private.valid_tags(role_labels)),
 skill_tags text[] not null default '{}' check(rev_scheduling_private.valid_tags(skill_tags)),
 active boolean not null default true,
 version bigint not null default 1 check(version>=1),
 created_by_user_id uuid not null,
 updated_by_user_id uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id),
 foreign key(workspace_id,updated_by_user_id) references public.workspace_members(workspace_id,user_id)
);
create index scheduling_workers_workspace_idx on public.scheduling_workers(workspace_id,active);
alter table public.scheduling_workers enable row level security;
revoke all on public.scheduling_workers from public,anon,authenticated;
grant select on public.scheduling_workers to authenticated;
grant select,insert,update on public.scheduling_workers to service_role;
create policy scheduling_workers_managers_read on public.scheduling_workers for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));

create table rev_scheduling_private.worker_requests (
 request_id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 actor_user_id uuid not null,
 input jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
revoke all on rev_scheduling_private.worker_requests from public,anon,authenticated,service_role;

create function public.save_rev_scheduling_worker(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_worker_id uuid,
 target_display_name text,target_role_labels text[],target_skill_tags text[],target_active boolean,expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.scheduling_workers; previous rev_scheduling_private.worker_requests;
 canonical_roles text[];canonical_skills text[];request_input jsonb;result jsonb;existing_version bigint;
begin
 if target_request_id is null or expected_version is null or expected_version<0
 or (target_worker_id is null and expected_version<>0) or (target_worker_id is not null and expected_version=0)
 or target_display_name is null or length(target_display_name) not between 1 and 120 or target_display_name<>trim(target_display_name)
 or target_active is null or not rev_scheduling_private.valid_tags(target_role_labels) or not rev_scheduling_private.valid_tags(target_skill_tags)
 then raise exception 'Valid worker details required';end if;
 -- Serialise the request ID even when callers supply different workspaces.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces w where w.id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and m.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 select coalesce(array_agg(t order by t),'{}'::text[]) into canonical_roles from unnest(target_role_labels) t;
 select coalesce(array_agg(t order by t),'{}'::text[]) into canonical_skills from unnest(target_skill_tags) t;
 request_input=pg_catalog.jsonb_build_object('worker_id',target_worker_id,'display_name',target_display_name,'role_labels',canonical_roles,'skill_tags',canonical_skills,'active',target_active,'expected_version',expected_version);
 select r.* into previous from rev_scheduling_private.worker_requests r where r.request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Worker request unavailable';end if;
  return previous.result;
 end if;
 if target_worker_id is null then
  insert into public.scheduling_workers(workspace_id,display_name,role_labels,skill_tags,active,created_by_user_id,updated_by_user_id)
   values(target_workspace_id,target_display_name,canonical_roles,canonical_skills,target_active,initiating_user_id,initiating_user_id) returning * into saved;
 else
  select w.version into existing_version from public.scheduling_workers w where w.workspace_id=target_workspace_id and w.id=target_worker_id for update;
  if not found or existing_version<>expected_version then raise exception 'Worker unavailable or changed';end if;
  update public.scheduling_workers w set display_name=target_display_name,role_labels=canonical_roles,skill_tags=canonical_skills,active=target_active,version=w.version+1,updated_by_user_id=initiating_user_id,updated_at=now()
   where w.workspace_id=target_workspace_id and w.id=target_worker_id returning w.* into saved;
 end if;
 result=pg_catalog.jsonb_build_object('worker_id',saved.id,'workspace_id',saved.workspace_id,'display_name',saved.display_name,'role_labels',saved.role_labels,'skill_tags',saved.skill_tags,'active',saved.active,'version',saved.version);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
  values(target_workspace_id,initiating_user_id,'user',case when target_worker_id is null then 'scheduling.worker.created' else 'scheduling.worker.updated' end,'scheduling_worker',saved.id,
   pg_catalog.jsonb_build_object('request_id',target_request_id,'previous_version',expected_version,'version',saved.version,'active',saved.active));
 insert into rev_scheduling_private.worker_requests(request_id,workspace_id,actor_user_id,input,result)
  values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;
revoke all on function public.save_rev_scheduling_worker(uuid,uuid,uuid,uuid,text,text[],text[],boolean,bigint) from public,anon,authenticated;
grant execute on function public.save_rev_scheduling_worker(uuid,uuid,uuid,uuid,text,text[],text[],boolean,bigint) to service_role;
