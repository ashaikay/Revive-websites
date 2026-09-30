-- Internal work records only; no assignment or external provider operation.
create table public.scheduling_jobs (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 title text not null check(length(title) between 1 and 160 and title=trim(title)),
 start_at timestamptz not null check(isfinite(start_at)),
 end_at timestamptz not null check(isfinite(end_at) and end_at>start_at),
 timezone text not null check(length(timezone) between 1 and 100 and timezone=trim(timezone)),
 location text not null check(length(location) between 1 and 300 and location=trim(location)),
 required_skills text[] not null default '{}' check(rev_scheduling_private.valid_tags(required_skills)),
 staffing_count integer not null check(staffing_count between 1 and 100),
 status text not null default 'open' check(status in ('open','cancelled')),
 version bigint not null default 1 check(version>=1),
 created_by_user_id uuid not null,
 updated_by_user_id uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id),
 foreign key(workspace_id,updated_by_user_id) references public.workspace_members(workspace_id,user_id)
);
create index scheduling_jobs_workspace_time_idx on public.scheduling_jobs(workspace_id,start_at);
alter table public.scheduling_jobs enable row level security;
revoke all on public.scheduling_jobs from public,anon,authenticated;
grant select on public.scheduling_jobs to authenticated;
grant select,insert,update on public.scheduling_jobs to service_role;
create policy scheduling_jobs_managers_read on public.scheduling_jobs for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));
create table rev_scheduling_private.job_requests (
 request_id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 actor_user_id uuid not null,
 input jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
revoke all on rev_scheduling_private.job_requests from public,anon,authenticated,service_role;
create function public.save_rev_scheduling_job(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_job_id uuid,
 target_title text,target_start_at timestamptz,target_end_at timestamptz,target_timezone text,
 target_location text,target_required_skills text[],target_staffing_count integer,target_status text,expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.scheduling_jobs; existing public.scheduling_jobs; previous rev_scheduling_private.job_requests;
 canonical_skills text[];request_input jsonb;result jsonb;
begin
 if target_request_id is null or expected_version is null or expected_version<0
 or (target_job_id is null and (expected_version<>0 or target_status is distinct from 'open'))
 or (target_job_id is not null and expected_version=0)
 or target_title is null or length(target_title) not between 1 and 160 or target_title<>trim(target_title)
 or target_start_at is null or target_end_at is null or not isfinite(target_start_at) or not isfinite(target_end_at) or target_start_at>=target_end_at
 or target_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=target_timezone)
 or target_location is null or length(target_location) not between 1 and 300 or target_location<>trim(target_location)
 or not rev_scheduling_private.valid_tags(target_required_skills)
 or target_staffing_count is null or target_staffing_count not between 1 and 100
 or target_status is null or target_status not in ('open','cancelled')
 then raise exception 'Valid job details required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces w where w.id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and m.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 select coalesce(array_agg(t order by t),'{}'::text[]) into canonical_skills from unnest(target_required_skills) t;
 request_input=pg_catalog.jsonb_build_object('job_id',target_job_id,'title',target_title,'start_at',target_start_at,'end_at',target_end_at,'timezone',target_timezone,'location',target_location,'required_skills',canonical_skills,'staffing_count',target_staffing_count,'status',target_status,'expected_version',expected_version);
 select r.* into previous from rev_scheduling_private.job_requests r where r.request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Job request unavailable';end if;
  return previous.result;
 end if;
 if target_job_id is null then
  insert into public.scheduling_jobs(workspace_id,title,start_at,end_at,timezone,location,required_skills,staffing_count,status,created_by_user_id,updated_by_user_id)
   values(target_workspace_id,target_title,target_start_at,target_end_at,target_timezone,target_location,canonical_skills,target_staffing_count,target_status,initiating_user_id,initiating_user_id) returning * into saved;
 else
  select j.* into existing from public.scheduling_jobs j where j.workspace_id=target_workspace_id and j.id=target_job_id for update;
  if not found or existing.version<>expected_version or existing.status='cancelled' then raise exception 'Job unavailable or changed';end if;
  if target_status='cancelled' and (existing.title<>target_title or existing.start_at<>target_start_at or existing.end_at<>target_end_at or existing.timezone<>target_timezone or existing.location<>target_location or existing.required_skills<>canonical_skills or existing.staffing_count<>target_staffing_count) then raise exception 'Cancellation must preserve job details';end if;
  update public.scheduling_jobs j set title=target_title,start_at=target_start_at,end_at=target_end_at,timezone=target_timezone,location=target_location,required_skills=canonical_skills,staffing_count=target_staffing_count,status=target_status,version=j.version+1,updated_by_user_id=initiating_user_id,updated_at=now()
   where j.workspace_id=target_workspace_id and j.id=target_job_id returning j.* into saved;
 end if;
 result=pg_catalog.jsonb_build_object('job_id',saved.id,'workspace_id',saved.workspace_id,'title',saved.title,'start_at',saved.start_at,'end_at',saved.end_at,'timezone',saved.timezone,'location',saved.location,'required_skills',saved.required_skills,'staffing_count',saved.staffing_count,'status',saved.status,'version',saved.version);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
 values(target_workspace_id,initiating_user_id,'user',case when target_status='cancelled' then 'scheduling.job.cancelled' when target_job_id is null then 'scheduling.job.created' else 'scheduling.job.updated' end,'scheduling_job',saved.id,
 pg_catalog.jsonb_build_object('request_id',target_request_id,'previous_version',expected_version,'version',saved.version,'status',saved.status));
 insert into rev_scheduling_private.job_requests(request_id,workspace_id,actor_user_id,input,result) values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;
revoke all on function public.save_rev_scheduling_job(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,text[],integer,text,bigint) from public,anon,authenticated;
grant execute on function public.save_rev_scheduling_job(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,text[],integer,text,bigint) to service_role;
