alter table public.scheduling_jobs
 add column skill_requirement_mode text not null default 'all'
 check(skill_requirement_mode in ('all','any'));

create function rev_scheduling_private.skills_satisfy(required text[],held text[],mode text)
returns boolean language sql immutable set search_path='' as $$
 select case
  when coalesce(pg_catalog.cardinality(required),0)=0 then true
  when mode='any' then exists(
   select 1 from pg_catalog.unnest(coalesce(required,'{}'::text[])) r
   where exists(select 1 from pg_catalog.unnest(coalesce(held,'{}'::text[])) h where rev_scheduling_private.skill_key(h)=rev_scheduling_private.skill_key(r)))
  when mode='all' then rev_scheduling_private.skills_cover(required,held)
  else false
 end;
$$;
revoke all on function rev_scheduling_private.skills_satisfy(text[],text[],text) from public,anon,authenticated,service_role;

create or replace function rev_scheduling_private.guard_assignment() returns trigger language plpgsql security definer set search_path='' as $$
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
 if not rev_scheduling_private.skills_satisfy(job.required_skills,worker.skill_tags,job.skill_requirement_mode) then raise exception 'Required skills missing';end if;
 select p.* into pattern from public.scheduling_worker_patterns p where p.workspace_id=new.workspace_id and p.worker_id=new.worker_id;
 if not found or not rev_scheduling_private.pattern_covers(pattern.timezone,pattern.working_days,pattern.start_local,pattern.end_local,pattern.effective_from,pattern.effective_until,new.start_at,new.end_at) then raise exception 'Recorded working availability required';end if;
 if exists(select 1 from public.scheduling_worker_unavailability u where u.workspace_id=new.workspace_id and u.worker_id=new.worker_id and u.status='active' and u.start_at<new.end_at and new.start_at<u.end_at) then raise exception 'Worker unavailable';end if;
 if exists(select 1 from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.worker_id=new.worker_id and a.status='active' and a.start_at<new.end_at and new.start_at<a.end_at) then raise exception 'Worker already assigned';end if;
 if (select count(*) from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.job_id=new.job_id and a.status='active')>=job.staffing_count then raise exception 'Job staffing capacity full';end if;
 return new;
end $$;
revoke all on function rev_scheduling_private.guard_assignment() from public,anon,authenticated,service_role;

create or replace function rev_scheduling_private.guard_scheduling_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.workspace_id<>old.workspace_id then raise exception 'Workspace identity cannot change';end if;
 perform 1 from public.workspaces w where w.id=new.workspace_id for update;
 if tg_table_name='scheduling_workers' then
  if exists(select 1 from public.scheduling_assignments a join public.scheduling_jobs j on j.workspace_id=a.workspace_id and j.id=a.job_id where a.workspace_id=new.workspace_id and a.worker_id=new.id and a.status='active' and (not new.active or not rev_scheduling_private.skills_satisfy(j.required_skills,new.skill_tags,j.skill_requirement_mode))) then raise exception 'Cancel affected assignments before changing worker';end if;
 elsif tg_table_name='scheduling_worker_patterns' then
  if tg_op='UPDATE' and new.worker_id<>old.worker_id then raise exception 'Worker identity cannot change';end if;
  if exists(select 1 from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.worker_id=new.worker_id and a.status='active' and not rev_scheduling_private.pattern_covers(new.timezone,new.working_days,new.start_local,new.end_local,new.effective_from,new.effective_until,a.start_at,a.end_at)) then raise exception 'Cancel affected assignments before changing availability';end if;
 elsif tg_table_name='scheduling_worker_unavailability' then
  if tg_op='UPDATE' and new.worker_id<>old.worker_id then raise exception 'Worker identity cannot change';end if;
  if new.status='active' and exists(select 1 from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.worker_id=new.worker_id and a.status='active' and a.start_at<new.end_at and new.start_at<a.end_at) then raise exception 'Cancel affected assignments before adding unavailability';end if;
 elsif tg_table_name='scheduling_jobs' then
  if exists(select 1 from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.job_id=new.id and a.status='active') then
   if new.status<>'open' or new.start_at<>old.start_at or new.end_at<>old.end_at or new.timezone<>old.timezone or new.location<>old.location or new.required_skills<>old.required_skills or new.skill_requirement_mode<>old.skill_requirement_mode or new.staffing_count<(select count(*) from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.job_id=new.id and a.status='active') then raise exception 'Cancel affected assignments before changing job';end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function rev_scheduling_private.guard_scheduling_change() from public,anon,authenticated,service_role;

drop function public.save_rev_scheduling_job(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,text[],integer,text,bigint);
create function public.save_rev_scheduling_job(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_job_id uuid,
 target_title text,target_start_at timestamptz,target_end_at timestamptz,target_timezone text,
 target_location text,target_required_skills text[],target_staffing_count integer,target_status text,expected_version bigint,
 target_skill_requirement_mode text default 'all'
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
 or target_skill_requirement_mode is null or target_skill_requirement_mode not in ('all','any')
 or target_staffing_count is null or target_staffing_count not between 1 and 100
 or target_status is null or target_status not in ('open','cancelled')
 then raise exception 'Valid job details required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces w where w.id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and m.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 select coalesce(array_agg(t order by t),'{}'::text[]) into canonical_skills from unnest(target_required_skills) t;
 request_input=pg_catalog.jsonb_build_object('job_id',target_job_id,'title',target_title,'start_at',target_start_at,'end_at',target_end_at,'timezone',target_timezone,'location',target_location,'required_skills',canonical_skills,'skill_requirement_mode',target_skill_requirement_mode,'staffing_count',target_staffing_count,'status',target_status,'expected_version',expected_version);
 select r.* into previous from rev_scheduling_private.job_requests r where r.request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id
   or (previous.input-'skill_requirement_mode')<>(request_input-'skill_requirement_mode')
   or coalesce(previous.input->>'skill_requirement_mode','all')<>target_skill_requirement_mode then raise exception 'Job request unavailable';end if;
  return previous.result;
 end if;
 if target_job_id is null then
  insert into public.scheduling_jobs(workspace_id,title,start_at,end_at,timezone,location,required_skills,skill_requirement_mode,staffing_count,status,created_by_user_id,updated_by_user_id)
   values(target_workspace_id,target_title,target_start_at,target_end_at,target_timezone,target_location,canonical_skills,target_skill_requirement_mode,target_staffing_count,target_status,initiating_user_id,initiating_user_id) returning * into saved;
 else
  select j.* into existing from public.scheduling_jobs j where j.workspace_id=target_workspace_id and j.id=target_job_id for update;
  if not found or existing.version<>expected_version or existing.status='cancelled' then raise exception 'Job unavailable or changed';end if;
  if target_status='cancelled' and (existing.title<>target_title or existing.start_at<>target_start_at or existing.end_at<>target_end_at or existing.timezone<>target_timezone or existing.location<>target_location or existing.required_skills<>canonical_skills or existing.skill_requirement_mode<>target_skill_requirement_mode or existing.staffing_count<>target_staffing_count) then raise exception 'Cancellation must preserve job details';end if;
  update public.scheduling_jobs j set title=target_title,start_at=target_start_at,end_at=target_end_at,timezone=target_timezone,location=target_location,required_skills=canonical_skills,skill_requirement_mode=target_skill_requirement_mode,staffing_count=target_staffing_count,status=target_status,version=j.version+1,updated_by_user_id=initiating_user_id,updated_at=now()
   where j.workspace_id=target_workspace_id and j.id=target_job_id returning j.* into saved;
 end if;
 result=pg_catalog.jsonb_build_object('job_id',saved.id,'workspace_id',saved.workspace_id,'title',saved.title,'start_at',saved.start_at,'end_at',saved.end_at,'timezone',saved.timezone,'location',saved.location,'required_skills',saved.required_skills,'skill_requirement_mode',saved.skill_requirement_mode,'staffing_count',saved.staffing_count,'status',saved.status,'version',saved.version);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
 values(target_workspace_id,initiating_user_id,'user',case when target_status='cancelled' then 'scheduling.job.cancelled' when target_job_id is null then 'scheduling.job.created' else 'scheduling.job.updated' end,'scheduling_job',saved.id,
 pg_catalog.jsonb_build_object('request_id',target_request_id,'previous_version',expected_version,'version',saved.version,'status',saved.status,'skill_requirement_mode',saved.skill_requirement_mode));
 insert into rev_scheduling_private.job_requests(request_id,workspace_id,actor_user_id,input,result) values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;
revoke all on function public.save_rev_scheduling_job(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,text[],integer,text,bigint,text) from public,anon,authenticated;
grant execute on function public.save_rev_scheduling_job(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,text[],integer,text,bigint,text) to service_role;

drop function public.create_rev_daily_job_sessions(uuid,uuid,uuid,text,text,text,text[],integer,date,date,smallint[],text,text);
create function public.create_rev_daily_job_sessions(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,
 target_title text,target_timezone text,target_location text,
 target_required_skills text[],target_staffing_count integer,
 target_first_day date,target_last_day date,target_working_days smallint[],
 target_start_local text,target_end_local text,target_skill_requirement_mode text default 'all'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous rev_scheduling_private.daily_job_requests;
 canonical_days smallint[];canonical_skills text[];request_input jsonb;
 day date;starts timestamptz;finishes timestamptz;
 planned jsonb='[]'::jsonb;session jsonb;jobs jsonb='[]'::jsonb;
 saved public.scheduling_jobs;result jsonb;
begin
 if target_request_id is null or target_title is null
 or length(target_title) not between 1 and 160 or target_title<>trim(target_title)
 or target_location is null or length(target_location) not between 1 and 300 or target_location<>trim(target_location)
 or target_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=target_timezone)
 or not rev_scheduling_private.valid_tags(target_required_skills)
 or target_skill_requirement_mode is null or target_skill_requirement_mode not in ('all','any')
 or target_staffing_count is null or target_staffing_count not between 1 and 100
 or target_first_day is null or target_last_day is null
 or not pg_catalog.isfinite(target_first_day) or not pg_catalog.isfinite(target_last_day)
 or target_first_day<date '1000-01-01' or target_last_day>date '9999-12-31'
 or target_last_day<target_first_day or target_last_day-target_first_day>30
 or not rev_calendar_private.valid_working_days(target_working_days)
 or target_start_local is null or target_end_local is null
 or target_start_local !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 or target_end_local !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 or target_start_local>=target_end_local
 then raise exception 'Valid daily schedule required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces w where w.id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and m.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 select array_agg(d order by d) into canonical_days from unnest(target_working_days) d;
 select coalesce(array_agg(t order by t),'{}'::text[]) into canonical_skills from unnest(target_required_skills) t;
 request_input=pg_catalog.jsonb_build_object('title',target_title,'timezone',target_timezone,'location',target_location,'required_skills',canonical_skills,'skill_requirement_mode',target_skill_requirement_mode,'staffing_count',target_staffing_count,'first_day',target_first_day,'last_day',target_last_day,'working_days',canonical_days,'start_local',target_start_local,'end_local',target_end_local);
 select r.* into previous from rev_scheduling_private.daily_job_requests r where r.request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id
   or (previous.input-'skill_requirement_mode')<>(request_input-'skill_requirement_mode')
   or coalesce(previous.input->>'skill_requirement_mode','all')<>target_skill_requirement_mode then raise exception 'Daily schedule request unavailable';end if;
  return previous.result;
 end if;
 day=target_first_day;
 while day<=target_last_day loop
  if extract(isodow from day)::smallint=any(canonical_days) then
   starts=rev_scheduling_private.unique_local_instant(day+target_start_local::time,target_timezone);
   finishes=rev_scheduling_private.unique_local_instant(day+target_end_local::time,target_timezone);
   if starts>=finishes then raise exception 'Valid daytime session required';end if;
   planned=planned||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('start_at',starts,'end_at',finishes));
  end if;
  day=day+1;
 end loop;
 if pg_catalog.jsonb_array_length(planned)=0 then raise exception 'Choose at least one scheduled day';end if;
 for session in select value from pg_catalog.jsonb_array_elements(planned) loop
  insert into public.scheduling_jobs(workspace_id,title,start_at,end_at,timezone,location,required_skills,skill_requirement_mode,staffing_count,status,created_by_user_id,updated_by_user_id)
  values(target_workspace_id,target_title,(session->>'start_at')::timestamptz,(session->>'end_at')::timestamptz,target_timezone,target_location,canonical_skills,target_skill_requirement_mode,target_staffing_count,'open',initiating_user_id,initiating_user_id) returning * into saved;
  jobs=jobs||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('job_id',saved.id,'workspace_id',saved.workspace_id,'title',saved.title,'start_at',saved.start_at,'end_at',saved.end_at,'timezone',saved.timezone,'location',saved.location,'required_skills',saved.required_skills,'skill_requirement_mode',saved.skill_requirement_mode,'staffing_count',saved.staffing_count,'status',saved.status,'version',saved.version));
  insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
  values(target_workspace_id,initiating_user_id,'user','scheduling.job.created','scheduling_job',saved.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'schedule_type','daily_daytime','version',saved.version,'skill_requirement_mode',saved.skill_requirement_mode));
 end loop;
 result=pg_catalog.jsonb_build_object('request_id',target_request_id,'workspace_id',target_workspace_id,'schedule_type','daily_daytime','jobs',jobs);
 insert into rev_scheduling_private.daily_job_requests(request_id,workspace_id,actor_user_id,input,result) values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;
revoke all on function public.create_rev_daily_job_sessions(uuid,uuid,uuid,text,text,text,text[],integer,date,date,smallint[],text,text,text) from public,anon,authenticated;
grant execute on function public.create_rev_daily_job_sessions(uuid,uuid,uuid,text,text,text,text[],integer,date,date,smallint[],text,text,text) to service_role;
