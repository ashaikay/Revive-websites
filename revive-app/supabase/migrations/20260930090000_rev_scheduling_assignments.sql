-- Internal, manager-controlled allocation. No external effects.
create table public.scheduling_assignments (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 worker_id uuid not null,job_id uuid not null,
 start_at timestamptz not null check(isfinite(start_at)),end_at timestamptz not null check(isfinite(end_at) and end_at>start_at),
 status text not null check(status in ('active','cancelled')),version bigint not null default 1 check(version>=1),
 created_by_user_id uuid not null,updated_by_user_id uuid not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workspace_id,id),
 foreign key(workspace_id,worker_id) references public.scheduling_workers(workspace_id,id),
 foreign key(workspace_id,job_id) references public.scheduling_jobs(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id),
 foreign key(workspace_id,updated_by_user_id) references public.workspace_members(workspace_id,user_id)
);
create index scheduling_assignments_worker_time_idx on public.scheduling_assignments(workspace_id,worker_id,start_at) where status='active';
create index scheduling_assignments_job_idx on public.scheduling_assignments(workspace_id,job_id) where status='active';
alter table public.scheduling_assignments enable row level security;
revoke all on public.scheduling_assignments from public,anon,authenticated,service_role;
grant select on public.scheduling_assignments to authenticated,service_role;
create policy scheduling_assignments_managers_read on public.scheduling_assignments for select to authenticated using(public.has_workspace_role(workspace_id,array['owner','admin']));
create table rev_scheduling_private.assignment_requests (
 request_id uuid primary key,workspace_id uuid not null references public.workspaces(id),actor_user_id uuid not null,
 input jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
revoke all on rev_scheduling_private.assignment_requests from public,anon,authenticated,service_role;

-- Refuse ambiguous or nonexistent local times rather than assuming an offset.
create function rev_scheduling_private.unique_local_instant(local_time timestamp,zone text)
returns timestamptz language plpgsql stable set search_path='' as $$
declare result timestamptz;matches integer;
begin
 if not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=zone) then raise exception 'Timezone unavailable';end if;
 with probes as(select (local_time at time zone 'UTC')+s*interval '1 hour' as instant from generate_series(-48,48,6) s),
 offsets as(select distinct (instant at time zone zone)-(instant at time zone 'UTC') as delta from probes),
 candidates as(select (local_time-delta) at time zone 'UTC' as instant from offsets)
 select count(*),min(instant) into matches,result from candidates where instant at time zone zone=local_time;
 if matches<>1 then raise exception 'Local time is ambiguous or nonexistent';end if;
 return result;
end $$;
revoke all on function rev_scheduling_private.unique_local_instant(timestamp,text) from public,anon,authenticated,service_role;

create function rev_scheduling_private.pattern_covers(
 zone text,days smallint[],opens text,closes text,from_date date,until_date date,start_instant timestamptz,end_instant timestamptz
) returns boolean language plpgsql stable set search_path='' as $$
declare local_start timestamp;local_end timestamp;day date;opening timestamptz;closing timestamptz;
begin
 if zone is null or start_instant is null or end_instant is null or start_instant>=end_instant then return false;end if;
 local_start=start_instant at time zone zone;local_end=end_instant at time zone zone;day=local_start::date;
 if local_end::date<>day or day<from_date or (until_date is not null and day>until_date) or not(extract(isodow from day)::smallint=any(days)) then return false;end if;
 opening=rev_scheduling_private.unique_local_instant(day+opens::time,zone);
 closing=rev_scheduling_private.unique_local_instant(day+closes::time,zone);
 if rev_scheduling_private.unique_local_instant(local_start,zone)<>start_instant or rev_scheduling_private.unique_local_instant(local_end,zone)<>end_instant then return false;end if;
 return start_instant>=opening and end_instant<=closing and opening<closing;
 exception when raise_exception then return false;
end $$;
revoke all on function rev_scheduling_private.pattern_covers(text,smallint[],text,text,date,date,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function rev_scheduling_private.guard_assignment() returns trigger language plpgsql security definer set search_path='' as $$
declare worker public.scheduling_workers;job public.scheduling_jobs;pattern public.scheduling_worker_patterns;
begin
 perform 1 from public.workspaces w where w.id=new.workspace_id for update;
 if tg_op='UPDATE' then
  if new.workspace_id<>old.workspace_id or new.worker_id<>old.worker_id or new.job_id<>old.job_id or new.start_at<>old.start_at or new.end_at<>old.end_at or old.status='cancelled' or new.status<>'cancelled' then raise exception 'Assignment changes require cancellation and fresh allocation';end if;
  return new;
 end if;
 if new.status<>'active' then raise exception 'New assignment must be active';end if;
 select w.* into worker from public.scheduling_workers w where w.workspace_id=new.workspace_id and w.id=new.worker_id;
 if not found or not worker.active then raise exception 'Active worker required';end if;
 select j.* into job from public.scheduling_jobs j where j.workspace_id=new.workspace_id and j.id=new.job_id;
 if not found or job.status<>'open' or new.start_at<>job.start_at or new.end_at<>job.end_at then raise exception 'Open job and exact interval required';end if;
 if not(job.required_skills<@worker.skill_tags) then raise exception 'Required skills missing';end if;
 select p.* into pattern from public.scheduling_worker_patterns p where p.workspace_id=new.workspace_id and p.worker_id=new.worker_id;
 if not found or not rev_scheduling_private.pattern_covers(pattern.timezone,pattern.working_days,pattern.start_local,pattern.end_local,pattern.effective_from,pattern.effective_until,new.start_at,new.end_at) then raise exception 'Recorded working availability required';end if;
 if exists(select 1 from public.scheduling_worker_unavailability u where u.workspace_id=new.workspace_id and u.worker_id=new.worker_id and u.status='active' and u.start_at<new.end_at and new.start_at<u.end_at) then raise exception 'Worker unavailable';end if;
 if exists(select 1 from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.worker_id=new.worker_id and a.status='active' and a.start_at<new.end_at and new.start_at<a.end_at) then raise exception 'Worker already assigned';end if;
 if (select count(*) from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.job_id=new.job_id and a.status='active')>=job.staffing_count then raise exception 'Job staffing capacity full';end if;
 return new;
end $$;
revoke all on function rev_scheduling_private.guard_assignment() from public,anon,authenticated,service_role;
create trigger scheduling_assignment_guard before insert or update on public.scheduling_assignments for each row execute function rev_scheduling_private.guard_assignment();

-- Protect active assignments when existing management RPCs change their inputs.
create function rev_scheduling_private.guard_scheduling_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.workspace_id<>old.workspace_id then raise exception 'Workspace identity cannot change';end if;
 perform 1 from public.workspaces w where w.id=new.workspace_id for update;
 if tg_table_name='scheduling_workers' then
  if exists(select 1 from public.scheduling_assignments a join public.scheduling_jobs j on j.workspace_id=a.workspace_id and j.id=a.job_id where a.workspace_id=new.workspace_id and a.worker_id=new.id and a.status='active' and (not new.active or not(j.required_skills<@new.skill_tags))) then raise exception 'Cancel affected assignments before changing worker';end if;
 elsif tg_table_name='scheduling_worker_patterns' then
  if tg_op='UPDATE' and new.worker_id<>old.worker_id then raise exception 'Worker identity cannot change';end if;
  if exists(select 1 from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.worker_id=new.worker_id and a.status='active' and not rev_scheduling_private.pattern_covers(new.timezone,new.working_days,new.start_local,new.end_local,new.effective_from,new.effective_until,a.start_at,a.end_at)) then raise exception 'Cancel affected assignments before changing availability';end if;
 elsif tg_table_name='scheduling_worker_unavailability' then
  if tg_op='UPDATE' and new.worker_id<>old.worker_id then raise exception 'Worker identity cannot change';end if;
  if new.status='active' and exists(select 1 from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.worker_id=new.worker_id and a.status='active' and a.start_at<new.end_at and new.start_at<a.end_at) then raise exception 'Cancel affected assignments before adding unavailability';end if;
 elsif tg_table_name='scheduling_jobs' then
  if exists(select 1 from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.job_id=new.id and a.status='active') then
   if new.status<>'open' or new.start_at<>old.start_at or new.end_at<>old.end_at or new.timezone<>old.timezone or new.location<>old.location or new.required_skills<>old.required_skills or new.staffing_count<(select count(*) from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.job_id=new.id and a.status='active') then raise exception 'Cancel affected assignments before changing job';end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function rev_scheduling_private.guard_scheduling_change() from public,anon,authenticated,service_role;
create trigger scheduling_worker_allocation_guard before update on public.scheduling_workers for each row execute function rev_scheduling_private.guard_scheduling_change();
create trigger scheduling_pattern_allocation_guard before insert or update on public.scheduling_worker_patterns for each row execute function rev_scheduling_private.guard_scheduling_change();
create trigger scheduling_leave_allocation_guard before insert or update on public.scheduling_worker_unavailability for each row execute function rev_scheduling_private.guard_scheduling_change();
create trigger scheduling_job_allocation_guard before update on public.scheduling_jobs for each row execute function rev_scheduling_private.guard_scheduling_change();

create function public.save_rev_scheduling_assignment(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_assignment_id uuid,
 target_worker_id uuid,target_job_id uuid,target_status text,expected_version bigint,
 expected_worker_version bigint,expected_job_version bigint,expected_pattern_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous rev_scheduling_private.assignment_requests;saved public.scheduling_assignments;existing public.scheduling_assignments;
 job public.scheduling_jobs;worker public.scheduling_workers;pattern public.scheduling_worker_patterns;request_input jsonb;result jsonb;
begin
 if target_request_id is null or target_worker_id is null or target_job_id is null or expected_version is null or expected_version<0
 or target_status is null or target_status not in ('active','cancelled')
 or (target_assignment_id is null and (expected_version<>0 or target_status<>'active' or expected_worker_version is null or expected_worker_version<1 or expected_job_version is null or expected_job_version<1 or expected_pattern_version is null or expected_pattern_version<1))
 or (target_assignment_id is not null and (expected_version<1 or target_status<>'cancelled' or expected_worker_version is not null or expected_job_version is not null or expected_pattern_version is not null)) then raise exception 'Valid allocation request required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces w where w.id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and m.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 request_input=pg_catalog.jsonb_build_object('assignment_id',target_assignment_id,'worker_id',target_worker_id,'job_id',target_job_id,'status',target_status,'expected_version',expected_version,'worker_version',expected_worker_version,'job_version',expected_job_version,'pattern_version',expected_pattern_version);
 select r.* into previous from rev_scheduling_private.assignment_requests r where r.request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Assignment request unavailable';end if;
  return previous.result;
 end if;
 if target_assignment_id is null then
  select w.* into worker from public.scheduling_workers w where w.workspace_id=target_workspace_id and w.id=target_worker_id;
  if not found or worker.version<>expected_worker_version then raise exception 'Worker changed';end if;
  select j.* into job from public.scheduling_jobs j where j.workspace_id=target_workspace_id and j.id=target_job_id;
  if not found or job.version<>expected_job_version then raise exception 'Job changed';end if;
  select p.* into pattern from public.scheduling_worker_patterns p where p.workspace_id=target_workspace_id and p.worker_id=target_worker_id;
  if not found or pattern.version<>expected_pattern_version then raise exception 'Working pattern changed';end if;
  insert into public.scheduling_assignments(workspace_id,worker_id,job_id,start_at,end_at,status,created_by_user_id,updated_by_user_id)
   values(target_workspace_id,target_worker_id,target_job_id,job.start_at,job.end_at,'active',initiating_user_id,initiating_user_id) returning * into saved;
 else
  select a.* into existing from public.scheduling_assignments a where a.workspace_id=target_workspace_id and a.id=target_assignment_id for update;
  if not found or existing.worker_id<>target_worker_id or existing.job_id<>target_job_id or existing.version<>expected_version or existing.status<>'active' then raise exception 'Assignment unavailable or changed';end if;
  update public.scheduling_assignments a set status='cancelled',version=a.version+1,updated_by_user_id=initiating_user_id,updated_at=now() where a.workspace_id=target_workspace_id and a.id=target_assignment_id returning a.* into saved;
 end if;
 result=pg_catalog.jsonb_build_object('assignment_id',saved.id,'workspace_id',saved.workspace_id,'worker_id',saved.worker_id,'job_id',saved.job_id,'start_at',saved.start_at,'end_at',saved.end_at,'status',saved.status,'version',saved.version);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata) values(target_workspace_id,initiating_user_id,'user',case when target_status='active' then 'scheduling.assignment.created' else 'scheduling.assignment.cancelled' end,'scheduling_assignment',saved.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'worker_id',target_worker_id,'job_id',target_job_id,'previous_version',expected_version,'version',saved.version));
 insert into rev_scheduling_private.assignment_requests(request_id,workspace_id,actor_user_id,input,result) values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;
revoke all on function public.save_rev_scheduling_assignment(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.save_rev_scheduling_assignment(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,bigint,bigint,bigint) to service_role;
-- Normal management retains history; prevent service clients deleting availability behind allocations.
revoke delete on public.scheduling_workers,public.scheduling_worker_patterns,public.scheduling_worker_unavailability,public.scheduling_jobs from service_role;
