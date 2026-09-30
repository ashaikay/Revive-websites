-- One explicit current pattern per worker; exceptions and assignments follow separately.
create table public.scheduling_worker_patterns (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 worker_id uuid not null,
 timezone text not null check(length(trim(timezone)) between 1 and 100),
 working_days smallint[] not null check(rev_calendar_private.valid_working_days(working_days)),
 start_local text not null check(start_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 end_local text not null check(end_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 effective_from date not null,
 effective_until date,
 version bigint not null default 1 check(version>=1),
 updated_by_user_id uuid not null,
 updated_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,worker_id),
 foreign key(workspace_id,worker_id) references public.scheduling_workers(workspace_id,id),
 foreign key(workspace_id,updated_by_user_id) references public.workspace_members(workspace_id,user_id),
 check(start_local<end_local),check(effective_until is null or effective_until>=effective_from)
);
alter table public.scheduling_worker_patterns enable row level security;
revoke all on public.scheduling_worker_patterns from public,anon,authenticated;
grant select on public.scheduling_worker_patterns to authenticated;
grant select,insert,update on public.scheduling_worker_patterns to service_role;
create policy scheduling_patterns_managers_read on public.scheduling_worker_patterns for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));
create table rev_scheduling_private.pattern_requests (
 request_id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 actor_user_id uuid not null,
 input jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
revoke all on rev_scheduling_private.pattern_requests from public,anon,authenticated,service_role;

create function public.save_rev_worker_working_pattern(
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
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and m.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
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
revoke all on function public.save_rev_worker_working_pattern(uuid,uuid,uuid,uuid,text,smallint[],text,text,date,date,bigint) from public,anon,authenticated;
grant execute on function public.save_rev_worker_working_pattern(uuid,uuid,uuid,uuid,text,smallint[],text,text,date,date,bigint) to service_role;
