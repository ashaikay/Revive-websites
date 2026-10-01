-- Explicit daily daytime sessions. No inferred overnight cover, assignment or sending.
-- Existing continuous jobs remain unchanged. New batches reuse the existing job table.
create table rev_scheduling_private.daily_job_requests (
 request_id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 actor_user_id uuid not null,
 input jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
revoke all on rev_scheduling_private.daily_job_requests from public,anon,authenticated,service_role;

create function public.create_rev_daily_job_sessions(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,
 target_title text,target_timezone text,target_location text,
 target_required_skills text[],target_staffing_count integer,
 target_first_day date,target_last_day date,target_working_days smallint[],
 target_start_local text,target_end_local text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 previous rev_scheduling_private.daily_job_requests;
 canonical_days smallint[]; canonical_skills text[]; request_input jsonb;
 day date; starts timestamptz; finishes timestamptz;
 planned jsonb='[]'::jsonb; session jsonb; jobs jsonb='[]'::jsonb;
 saved public.scheduling_jobs; result jsonb;
begin
 if target_request_id is null or target_title is null
 or length(target_title) not between 1 and 160 or target_title<>trim(target_title)
 or target_location is null or length(target_location) not between 1 and 300 or target_location<>trim(target_location)
 or target_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=target_timezone)
 or not rev_scheduling_private.valid_tags(target_required_skills)
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
 perform 1 from public.workspace_members m
 where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id
 and m.status='active' and m.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 select array_agg(d order by d) into canonical_days from unnest(target_working_days) d;
 select coalesce(array_agg(t order by t),'{}'::text[]) into canonical_skills from unnest(target_required_skills) t;
 request_input=pg_catalog.jsonb_build_object(
 'title',target_title,'timezone',target_timezone,'location',target_location,
 'required_skills',canonical_skills,'staffing_count',target_staffing_count,
 'first_day',target_first_day,'last_day',target_last_day,'working_days',canonical_days,
 'start_local',target_start_local,'end_local',target_end_local);
 select r.* into previous from rev_scheduling_private.daily_job_requests r where r.request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id
  or previous.input<>request_input then raise exception 'Daily schedule request unavailable';end if;
  return previous.result;
 end if;

 -- Validate every local session before inserting any job. DST gaps/folds refuse the batch.
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
  insert into public.scheduling_jobs(
   workspace_id,title,start_at,end_at,timezone,location,required_skills,staffing_count,
   status,created_by_user_id,updated_by_user_id)
  values(target_workspace_id,target_title,(session->>'start_at')::timestamptz,
   (session->>'end_at')::timestamptz,target_timezone,target_location,canonical_skills,
   target_staffing_count,'open',initiating_user_id,initiating_user_id) returning * into saved;
  jobs=jobs||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
   'job_id',saved.id,'workspace_id',saved.workspace_id,'title',saved.title,
   'start_at',saved.start_at,'end_at',saved.end_at,'timezone',saved.timezone,'location',saved.location,
   'required_skills',saved.required_skills,'staffing_count',saved.staffing_count,'status',saved.status,'version',saved.version));
  insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
  values(target_workspace_id,initiating_user_id,'user','scheduling.job.created','scheduling_job',saved.id,
   pg_catalog.jsonb_build_object('request_id',target_request_id,'schedule_type','daily_daytime','version',saved.version));
 end loop;
 result=pg_catalog.jsonb_build_object('request_id',target_request_id,'workspace_id',target_workspace_id,
  'schedule_type','daily_daytime','jobs',jobs);
 insert into rev_scheduling_private.daily_job_requests(request_id,workspace_id,actor_user_id,input,result)
 values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;
revoke all on function public.create_rev_daily_job_sessions(uuid,uuid,uuid,text,text,text,text[],integer,date,date,smallint[],text,text) from public,anon,authenticated;
grant execute on function public.create_rev_daily_job_sessions(uuid,uuid,uuid,text,text,text,text[],integer,date,date,smallint[],text,text) to service_role;
