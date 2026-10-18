-- Scheduling operations permission. No workspace-role promotion or automatic grants.
begin;
create table public.workspace_scheduling_managers (
 workspace_id uuid not null, user_id uuid not null, enabled boolean not null,
 version bigint not null default 1 check(version>0), updated_at timestamptz not null default now(),
 primary key(workspace_id,user_id), foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
alter table public.workspace_scheduling_managers enable row level security;
revoke all on public.workspace_scheduling_managers from public,anon,authenticated;
grant all on public.workspace_scheduling_managers to service_role;
create function public.has_rev_scheduling_management(target_workspace_id uuid,target_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.has_rev_module_access(target_workspace_id,target_user_id,'scheduling') and exists(
 select 1 from public.workspace_members m left join public.workspace_scheduling_managers a
 on a.workspace_id=m.workspace_id and a.user_id=m.user_id
 where m.workspace_id=target_workspace_id and m.user_id=target_user_id and m.status='active'
 and (m.role in ('owner','admin') or (m.role='member' and coalesce(a.enabled,false))));
$$;
revoke all on function public.has_rev_scheduling_management(uuid,uuid) from public,anon,authenticated;
grant execute on function public.has_rev_scheduling_management(uuid,uuid) to service_role;
create function public.can_manage_rev_scheduling(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.has_rev_scheduling_management(target_workspace_id,auth.uid());
$$;
revoke all on function public.can_manage_rev_scheduling(uuid) from public,anon;
grant execute on function public.can_manage_rev_scheduling(uuid) to authenticated;
create function public.get_rev_scheduling_management(target_workspace_id uuid,target_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); subject uuid:=coalesce(target_user_id,auth.uid()); member_role text; saved public.workspace_scheduling_managers;
begin
 if not exists(select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id where m.workspace_id=target_workspace_id and m.user_id=actor and m.status='active' and w.status='active') or (subject<>actor and not public.has_workspace_role(target_workspace_id,array['owner','admin'])) then raise exception 'Access unavailable' using errcode='42501'; end if;
 select role into member_role from public.workspace_members where workspace_id=target_workspace_id and user_id=subject;
 if not found then raise exception 'Member unavailable' using errcode='42501'; end if;
 select * into saved from public.workspace_scheduling_managers where workspace_id=target_workspace_id and user_id=subject;
 return jsonb_build_object('workspaceId',target_workspace_id,'userId',subject,'enabled',coalesce(saved.enabled,false),'canManage',public.has_rev_scheduling_management(target_workspace_id,subject),'version',coalesce(saved.version,0),'managed',member_role in ('owner','admin'));
end;
$$;
create function public.save_rev_scheduling_management(target_workspace_id uuid,target_user_id uuid,target_enabled boolean,expected_version bigint,target_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); member_role text; member_status text; old_version bigint; fingerprint_value bytea; prior rev_workspace_team_private.requests; result_value jsonb;
begin
 perform 1 from public.workspaces where id=target_workspace_id and status='active' for update;
 if not found or not public.has_workspace_role(target_workspace_id,array['owner','admin']) then raise exception 'Manager required' using errcode='42501'; end if;
 if target_request_id is null or target_user_id is null or target_enabled is null or expected_version is null or expected_version<0 then raise exception 'Valid permission required' using errcode='22023'; end if;
 select role,status into member_role,member_status from public.workspace_members where workspace_id=target_workspace_id and user_id=target_user_id for update;
 if not found or member_role<>'member' or target_user_id=actor or member_status not in ('active','suspended') then raise exception 'Protected member' using errcode='42501'; end if;
 if target_enabled and (member_status<>'active' or not public.has_rev_module_access(target_workspace_id,target_user_id,'scheduling')) then raise exception 'Enable Scheduling section access first' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 fingerprint_value:=pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('operation','scheduling_management','userId',target_user_id,'enabled',target_enabled,'expectedVersion',expected_version)::text,'UTF8'));
 select * into prior from rev_workspace_team_private.requests where request_id=target_request_id;
 if found then
  if prior.workspace_id<>target_workspace_id or prior.actor_id<>actor or prior.fingerprint<>fingerprint_value then raise exception 'Request changed' using errcode='40001'; end if;
  return prior.result;
 end if;
 select version into old_version from public.workspace_scheduling_managers where workspace_id=target_workspace_id and user_id=target_user_id;
 if coalesce(old_version,0)<>expected_version then raise exception 'Permission changed; reload' using errcode='40001'; end if;
 insert into public.workspace_scheduling_managers(workspace_id,user_id,enabled) values(target_workspace_id,target_user_id,target_enabled)
 on conflict(workspace_id,user_id) do update set enabled=excluded.enabled,version=public.workspace_scheduling_managers.version+1,updated_at=now();
 result_value:=public.get_rev_scheduling_management(target_workspace_id,target_user_id);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata) values(target_workspace_id,actor,'user','workspace.team.scheduling_management','workspace',target_workspace_id,jsonb_build_object('requestId',target_request_id,'targetUserId',target_user_id,'enabled',target_enabled));
 insert into rev_workspace_team_private.requests(request_id,workspace_id,actor_id,fingerprint,result) values(target_request_id,target_workspace_id,actor,fingerprint_value,result_value);
 return result_value;
end;
$$;
revoke all on function public.get_rev_scheduling_management(uuid,uuid),public.save_rev_scheduling_management(uuid,uuid,boolean,bigint,uuid) from public,anon;
grant execute on function public.get_rev_scheduling_management(uuid,uuid),public.save_rev_scheduling_management(uuid,uuid,boolean,bigint,uuid) to authenticated;
create policy scheduling_delegated_managers_read on public.scheduling_workers for select to authenticated using(public.can_manage_rev_scheduling(workspace_id));
create policy scheduling_delegated_managers_read on public.scheduling_worker_patterns for select to authenticated using(public.can_manage_rev_scheduling(workspace_id));
create policy scheduling_delegated_managers_read on public.scheduling_worker_unavailability for select to authenticated using(public.can_manage_rev_scheduling(workspace_id));
create policy scheduling_delegated_managers_read on public.scheduling_jobs for select to authenticated using(public.can_manage_rev_scheduling(workspace_id));
create policy scheduling_delegated_managers_read on public.scheduling_assignments for select to authenticated using(public.can_manage_rev_scheduling(workspace_id));
create policy scheduling_delegated_managers_read on public.workspace_calendar_business_hours for select to authenticated using(public.can_manage_rev_scheduling(workspace_id));

-- Existing validation, locking, replay ledger and allocation guards preserved.
create or replace function public.save_rev_scheduling_worker(
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
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and public.has_rev_scheduling_management(target_workspace_id,initiating_user_id) for share;
 if not found then raise exception 'Scheduling management permission required' using errcode='42501';end if;
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

-- Existing validation, locking, replay ledger and allocation guards preserved.
create or replace function public.save_rev_worker_working_pattern(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_worker_id uuid,
 target_timezone text,target_working_days smallint[],target_start_local text,target_end_local text,
 target_effective_from date,target_effective_until date,expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.scheduling_worker_patterns;previous rev_scheduling_private.pattern_requests;
 canonical_days smallint[];request_input jsonb;result jsonb;current_version bigint;worker_active boolean;
begin
 if target_request_id is null or target_worker_id is null or expected_version is null or expected_version<0
 or target_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=target_timezone)
 or not rev_calendar_private.valid_working_days(target_working_days)
 or target_start_local is null or target_end_local is null or target_start_local !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or target_end_local !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or target_start_local>=target_end_local
 or target_effective_from is null or not pg_catalog.isfinite(target_effective_from)
 or (target_effective_until is not null and (not pg_catalog.isfinite(target_effective_until) or target_effective_until<target_effective_from))
 then raise exception 'Valid working pattern required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces w where w.id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and public.has_rev_scheduling_management(target_workspace_id,initiating_user_id) for share;
 if not found then raise exception 'Scheduling management permission required' using errcode='42501';end if;
 select array_agg(d order by d) into canonical_days from unnest(target_working_days) d;
 request_input=pg_catalog.jsonb_build_object('worker_id',target_worker_id,'timezone',target_timezone,'working_days',canonical_days,'start_local',target_start_local,'end_local',target_end_local,'effective_from',target_effective_from,'effective_until',target_effective_until,'expected_version',expected_version);
 select r.* into previous from rev_scheduling_private.pattern_requests r where r.request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Pattern request unavailable';end if;
  return previous.result;
 end if;
 select w.active into worker_active from public.scheduling_workers w where w.workspace_id=target_workspace_id and w.id=target_worker_id for update;
 if not found or worker_active is not true then raise exception 'Active worker required';end if;
 select p.version into current_version from public.scheduling_worker_patterns p where p.workspace_id=target_workspace_id and p.worker_id=target_worker_id for update;
 if not found then
  if expected_version<>0 then raise exception 'Working pattern changed';end if;
  insert into public.scheduling_worker_patterns(workspace_id,worker_id,timezone,working_days,start_local,end_local,effective_from,effective_until,updated_by_user_id)
   values(target_workspace_id,target_worker_id,target_timezone,canonical_days,target_start_local,target_end_local,target_effective_from,target_effective_until,initiating_user_id) returning * into saved;
 else
  if current_version<>expected_version then raise exception 'Working pattern changed';end if;
  update public.scheduling_worker_patterns p set timezone=target_timezone,working_days=canonical_days,start_local=target_start_local,end_local=target_end_local,effective_from=target_effective_from,effective_until=target_effective_until,version=p.version+1,updated_by_user_id=initiating_user_id,updated_at=now()
   where p.workspace_id=target_workspace_id and p.worker_id=target_worker_id returning p.* into saved;
 end if;
 result=pg_catalog.jsonb_build_object('pattern_id',saved.id,'workspace_id',saved.workspace_id,'worker_id',saved.worker_id,'timezone',saved.timezone,'working_days',saved.working_days,'start_local',saved.start_local,'end_local',saved.end_local,'effective_from',saved.effective_from,'effective_until',saved.effective_until,'version',saved.version);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
  values(target_workspace_id,initiating_user_id,'user','scheduling.pattern.saved','scheduling_worker_pattern',saved.id,pg_catalog.jsonb_build_object('worker_id',target_worker_id,'request_id',target_request_id,'previous_version',expected_version,'version',saved.version));
 insert into rev_scheduling_private.pattern_requests(request_id,workspace_id,actor_user_id,input,result) values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;

-- Existing validation, locking, replay ledger and allocation guards preserved.
create or replace function public.save_rev_worker_unavailability(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_worker_id uuid,target_unavailability_id uuid,
 target_start_at timestamptz,target_end_at timestamptz,target_category text,target_status text,expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.scheduling_worker_unavailability;existing public.scheduling_worker_unavailability;
 previous rev_scheduling_private.unavailability_requests;worker_active boolean;workspace_timezone text;request_input jsonb;result jsonb;
begin
 if target_request_id is null or target_worker_id is null or expected_version is null or expected_version<0
 or (target_unavailability_id is null and (expected_version<>0 or target_status is distinct from 'active'))
 or (target_unavailability_id is not null and expected_version=0)
 or target_start_at is null or target_end_at is null or not isfinite(target_start_at) or not isfinite(target_end_at) or target_start_at>=target_end_at
 or target_category is null or target_category not in ('leave','unavailable','sickness') or target_status is null or target_status not in ('active','cancelled')
 then raise exception 'Valid unavailable period required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces w where w.id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 select p.timezone into workspace_timezone from public.workspace_calendar_business_hours p where p.workspace_id=target_workspace_id;
 workspace_timezone=coalesce(workspace_timezone,'Europe/London');
 if target_category='sickness' and target_status='active' and (
   target_start_at<>(((target_start_at at time zone workspace_timezone)::date)::timestamp at time zone workspace_timezone)
   or target_end_at<>(((target_end_at at time zone workspace_timezone)::date)::timestamp at time zone workspace_timezone)
 ) then raise exception 'Sickness dates must use workspace-local midnight';end if;
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and public.has_rev_scheduling_management(target_workspace_id,initiating_user_id) for share;
 if not found then raise exception 'Scheduling management permission required' using errcode='42501';end if;
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
  if existing.status<>'active' then raise exception 'Unavailable period already cancelled';end if;
  if target_status='cancelled' and (existing.start_at<>target_start_at or existing.end_at<>target_end_at or existing.category<>target_category) then raise exception 'Cancellation must retain the saved interval';end if;
  update public.scheduling_worker_unavailability u set start_at=target_start_at,end_at=target_end_at,category=target_category,status=target_status,version=u.version+1,updated_by_user_id=initiating_user_id,updated_at=now()
   where u.workspace_id=target_workspace_id and u.id=target_unavailability_id returning u.* into saved;
 end if;
 result=pg_catalog.jsonb_build_object('unavailability_id',saved.id,'workspace_id',saved.workspace_id,'worker_id',saved.worker_id,'start_at',saved.start_at,'end_at',saved.end_at,'category',saved.category,'status',saved.status,'version',saved.version);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
  values(target_workspace_id,initiating_user_id,'user',case when target_status='cancelled' then 'scheduling.unavailability.cancelled' else 'scheduling.unavailability.saved' end,'scheduling_worker_unavailability',saved.id,
   pg_catalog.jsonb_build_object('worker_id',target_worker_id,'request_id',target_request_id,'category',saved.category,'previous_version',expected_version,'version',saved.version,'status',saved.status));
 insert into rev_scheduling_private.unavailability_requests(request_id,workspace_id,actor_user_id,input,result) values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;

-- Existing validation, locking, replay ledger and allocation guards preserved.
create or replace function public.save_rev_scheduling_job(
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
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and public.has_rev_scheduling_management(target_workspace_id,initiating_user_id) for share;
 if not found then raise exception 'Scheduling management permission required' using errcode='42501';end if;
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

-- Existing validation, locking, replay ledger and allocation guards preserved.
create or replace function public.save_rev_scheduling_assignment(
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
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and public.has_rev_scheduling_management(target_workspace_id,initiating_user_id) for share;
 if not found then raise exception 'Scheduling management permission required' using errcode='42501';end if;
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

-- Existing validation, locking, replay ledger and allocation guards preserved.
create or replace function public.create_rev_daily_job_sessions(
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
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and public.has_rev_scheduling_management(target_workspace_id,initiating_user_id) for share;
 if not found then raise exception 'Scheduling management permission required' using errcode='42501';end if;
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
commit;
