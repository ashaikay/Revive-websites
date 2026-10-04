-- Annual Leave Stage 2 review corrections: explicit holiday calendars and legacy cancellation.
create table public.annual_leave_calendars (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 name text not null check(length(trim(name)) between 1 and 120 and name=trim(name)),
 region_code text not null check(region_code=upper(region_code) and region_code~'^[A-Z0-9][A-Z0-9-]{1,19}$'),
 status text not null check(status in ('active','inactive')),
 version bigint not null default 1 check(version>=1),
 created_by_user_id uuid not null,
 updated_by_user_id uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,id),
 unique(workspace_id,name),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id),
 foreign key(workspace_id,updated_by_user_id) references public.workspace_members(workspace_id,user_id)
);
alter table public.annual_leave_calendars enable row level security;
revoke all on public.annual_leave_calendars from public,anon,authenticated,service_role;
grant select on public.annual_leave_calendars to authenticated,service_role;
create policy annual_leave_calendars_managers_read on public.annual_leave_calendars for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));

create table public.annual_leave_worker_calendars (
 workspace_id uuid not null,
 worker_id uuid not null,
 calendar_id uuid not null,
 version bigint not null default 1 check(version>=1),
 created_by_user_id uuid not null,
 updated_by_user_id uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(workspace_id,worker_id),
 foreign key(workspace_id,worker_id) references public.scheduling_workers(workspace_id,id),
 foreign key(workspace_id,calendar_id) references public.annual_leave_calendars(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id),
 foreign key(workspace_id,updated_by_user_id) references public.workspace_members(workspace_id,user_id)
);
alter table public.annual_leave_worker_calendars enable row level security;
revoke all on public.annual_leave_worker_calendars from public,anon,authenticated,service_role;
grant select on public.annual_leave_worker_calendars to authenticated,service_role;
create policy annual_leave_worker_calendars_managers_read on public.annual_leave_worker_calendars for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));

create table public.annual_leave_calendar_years (
 workspace_id uuid not null,
 calendar_id uuid not null,
 calendar_year integer not null check(calendar_year between 1000 and 9999),
 revision bigint not null default 1 check(revision>=1),
 confirmed_revision bigint check(confirmed_revision>=1 and confirmed_revision<=revision),
 confirmed_by_user_id uuid,
 confirmed_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key(workspace_id,calendar_id,calendar_year),
 foreign key(workspace_id,calendar_id) references public.annual_leave_calendars(workspace_id,id),
 foreign key(workspace_id,confirmed_by_user_id) references public.workspace_members(workspace_id,user_id),
 check((confirmed_revision is null and confirmed_by_user_id is null and confirmed_at is null)
  or (confirmed_revision=revision and confirmed_by_user_id is not null and confirmed_at is not null))
);
alter table public.annual_leave_calendar_years enable row level security;
revoke all on public.annual_leave_calendar_years from public,anon,authenticated,service_role;
grant select on public.annual_leave_calendar_years to authenticated,service_role;
create policy annual_leave_calendar_years_managers_read on public.annual_leave_calendar_years for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));

with source_holiday as (
 select distinct on (h.workspace_id) h.workspace_id,h.created_by_user_id,h.updated_by_user_id
 from public.workspace_bank_holidays h
 order by h.workspace_id,h.created_at,h.id
)
insert into public.annual_leave_calendars(workspace_id,name,region_code,status,created_by_user_id,updated_by_user_id)
select workspace_id,'Migrated workspace calendar','UNSPECIFIED','active',created_by_user_id,updated_by_user_id
from source_holiday;

alter table public.workspace_bank_holidays add column calendar_id uuid;
update public.workspace_bank_holidays h
set calendar_id=c.id
from public.annual_leave_calendars c
where c.workspace_id=h.workspace_id and c.name='Migrated workspace calendar';
alter table public.workspace_bank_holidays alter column calendar_id set not null;
alter table public.workspace_bank_holidays
 add foreign key(workspace_id,calendar_id) references public.annual_leave_calendars(workspace_id,id);
alter table public.workspace_bank_holidays drop constraint workspace_bank_holidays_workspace_id_holiday_date_key;
alter table public.workspace_bank_holidays
 add constraint workspace_bank_holidays_calendar_date_key unique(workspace_id,calendar_id,holiday_date);

insert into public.annual_leave_calendar_years(workspace_id,calendar_id,calendar_year)
select distinct workspace_id,calendar_id,extract(year from holiday_date)::integer
from public.workspace_bank_holidays;

alter table public.annual_leave_calculation_segments
 add column source_calendar_id uuid,
 add column source_calendar_name text,
 add column source_calendar_region_code text,
 add column source_calendar_year integer,
 add column source_calendar_year_confirmed_revision bigint;
alter table public.annual_leave_calculation_segments
 add foreign key(workspace_id,source_calendar_id) references public.annual_leave_calendars(workspace_id,id),
 add check(
  (source_calendar_id is null and source_calendar_name is null and source_calendar_region_code is null and source_calendar_year is null and source_calendar_year_confirmed_revision is null)
  or
  (source_calendar_id is not null and source_calendar_name is not null and source_calendar_region_code is not null
   and source_calendar_year between 1000 and 9999 and source_calendar_year_confirmed_revision>=1)
 );

create table rev_scheduling_private.annual_leave_calendar_requests (
 request_id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 actor_user_id uuid not null,
 input jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
create table rev_scheduling_private.legacy_leave_cancellation_requests (
 request_id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 actor_user_id uuid not null,
 input jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
revoke all on rev_scheduling_private.annual_leave_calendar_requests,rev_scheduling_private.legacy_leave_cancellation_requests from public,anon,authenticated,service_role;

create function public.configure_rev_annual_leave_calendar(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_action text,
 target_calendar_id uuid,target_worker_id uuid,target_name text,target_region_code text,target_status text,
 target_calendar_year integer,expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 previous rev_scheduling_private.annual_leave_calendar_requests;
 saved_calendar public.annual_leave_calendars;
 saved_assignment public.annual_leave_worker_calendars;
 saved_year public.annual_leave_calendar_years;
 request_input jsonb;
 result jsonb;
begin
 if target_request_id is null or target_action not in ('save_calendar','assign_worker','confirm_year') or expected_version is null or expected_version<0
  or (target_action='save_calendar' and (
   target_worker_id is not null or target_calendar_year is not null
   or target_name is null or length(trim(target_name)) not between 1 and 120 or target_name<>trim(target_name)
   or target_region_code is null or target_region_code<>upper(target_region_code) or target_region_code!~'^[A-Z0-9][A-Z0-9-]{1,19}$'
   or target_status not in ('active','inactive')
   or (target_calendar_id is null and (expected_version<>0 or target_status<>'active'))
   or (target_calendar_id is not null and expected_version=0)
  ))
  or (target_action='assign_worker' and (
   target_calendar_id is null or target_worker_id is null or target_name is not null or target_region_code is not null or target_status is not null or target_calendar_year is not null
  ))
  or (target_action='confirm_year' and (
   target_calendar_id is null or target_worker_id is not null or target_name is not null or target_region_code is not null or target_status is not null
   or target_calendar_year not between 1000 and 9999
  ))
 then raise exception 'Valid annual leave calendar configuration required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces where id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members where workspace_id=target_workspace_id and user_id=initiating_user_id and status='active' and role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 request_input=pg_catalog.jsonb_build_object(
  'action',target_action,'calendar_id',target_calendar_id,'worker_id',target_worker_id,'name',target_name,
  'region_code',target_region_code,'status',target_status,'calendar_year',target_calendar_year,'expected_version',expected_version
 );
 select * into previous from rev_scheduling_private.annual_leave_calendar_requests where request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Annual leave calendar request unavailable';end if;
  return previous.result;
 end if;
 if target_action='save_calendar' then
  if target_calendar_id is null then
   begin
    insert into public.annual_leave_calendars(workspace_id,name,region_code,status,created_by_user_id,updated_by_user_id)
    values(target_workspace_id,target_name,target_region_code,'active',initiating_user_id,initiating_user_id)
    returning * into saved_calendar;
   exception when unique_violation then raise exception 'Annual leave calendar already exists';
   end;
  else
   select * into saved_calendar from public.annual_leave_calendars where workspace_id=target_workspace_id and id=target_calendar_id for update;
   if not found or saved_calendar.version<>expected_version then raise exception 'Annual leave calendar changed';end if;
   update public.annual_leave_calendars
   set name=target_name,region_code=target_region_code,status=target_status,version=version+1,updated_by_user_id=initiating_user_id,updated_at=now()
   where workspace_id=target_workspace_id and id=target_calendar_id returning * into saved_calendar;
   update public.annual_leave_calendar_years
   set revision=revision+1,confirmed_revision=null,confirmed_by_user_id=null,confirmed_at=null,updated_at=now()
   where workspace_id=target_workspace_id and calendar_id=target_calendar_id;
  end if;
  result=pg_catalog.jsonb_build_object('action',target_action,'calendar_id',saved_calendar.id,'workspace_id',saved_calendar.workspace_id,'name',saved_calendar.name,'region_code',saved_calendar.region_code,'status',saved_calendar.status,'version',saved_calendar.version);
 elsif target_action='assign_worker' then
  perform 1 from public.scheduling_workers where workspace_id=target_workspace_id and id=target_worker_id for update;
  if not found then raise exception 'Worker unavailable';end if;
  perform 1 from public.annual_leave_calendars where workspace_id=target_workspace_id and id=target_calendar_id and status='active' for share;
  if not found then raise exception 'Annual leave calendar unavailable';end if;
  select * into saved_assignment from public.annual_leave_worker_calendars where workspace_id=target_workspace_id and worker_id=target_worker_id for update;
  if found then
   if saved_assignment.version<>expected_version then raise exception 'Worker annual leave calendar changed';end if;
   update public.annual_leave_worker_calendars
   set calendar_id=target_calendar_id,version=version+1,updated_by_user_id=initiating_user_id,updated_at=now()
   where workspace_id=target_workspace_id and worker_id=target_worker_id returning * into saved_assignment;
  else
   if expected_version<>0 then raise exception 'Worker annual leave calendar changed';end if;
   insert into public.annual_leave_worker_calendars(workspace_id,worker_id,calendar_id,created_by_user_id,updated_by_user_id)
   values(target_workspace_id,target_worker_id,target_calendar_id,initiating_user_id,initiating_user_id)
   returning * into saved_assignment;
  end if;
  result=pg_catalog.jsonb_build_object('action',target_action,'workspace_id',saved_assignment.workspace_id,'worker_id',saved_assignment.worker_id,'calendar_id',saved_assignment.calendar_id,'version',saved_assignment.version);
 else
  perform 1 from public.annual_leave_calendars where workspace_id=target_workspace_id and id=target_calendar_id and status='active' for share;
  if not found then raise exception 'Annual leave calendar unavailable';end if;
  select * into saved_year from public.annual_leave_calendar_years
  where workspace_id=target_workspace_id and calendar_id=target_calendar_id and calendar_year=target_calendar_year for update;
  if found then
   if saved_year.revision<>expected_version then raise exception 'Annual leave calendar year changed';end if;
   update public.annual_leave_calendar_years
   set confirmed_revision=revision,confirmed_by_user_id=initiating_user_id,confirmed_at=now(),updated_at=now()
   where workspace_id=target_workspace_id and calendar_id=target_calendar_id and calendar_year=target_calendar_year
   returning * into saved_year;
  else
   if expected_version<>0 then raise exception 'Annual leave calendar year changed';end if;
   insert into public.annual_leave_calendar_years(workspace_id,calendar_id,calendar_year,revision,confirmed_revision,confirmed_by_user_id,confirmed_at)
   values(target_workspace_id,target_calendar_id,target_calendar_year,1,1,initiating_user_id,now())
   returning * into saved_year;
  end if;
  result=pg_catalog.jsonb_build_object('action',target_action,'workspace_id',saved_year.workspace_id,'calendar_id',saved_year.calendar_id,'calendar_year',saved_year.calendar_year,'revision',saved_year.revision,'confirmed_revision',saved_year.confirmed_revision);
 end if;
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
 values(target_workspace_id,initiating_user_id,'user','scheduling.annual_leave_calendar.'||target_action,'annual_leave_calendar',coalesce(target_calendar_id,saved_calendar.id),
  pg_catalog.jsonb_build_object('request_id',target_request_id,'worker_id',target_worker_id,'calendar_year',target_calendar_year,'version',coalesce(saved_calendar.version,saved_assignment.version,saved_year.revision)));
 insert into rev_scheduling_private.annual_leave_calendar_requests(request_id,workspace_id,actor_user_id,input,result)
 values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;

drop function public.save_rev_workspace_bank_holiday(uuid,uuid,uuid,uuid,date,text,text,bigint);
create function public.save_rev_workspace_bank_holiday(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_calendar_id uuid,target_holiday_id uuid,
 target_holiday_date date,target_name text,target_status text,expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 saved public.workspace_bank_holidays;
 existing public.workspace_bank_holidays;
 previous rev_scheduling_private.bank_holiday_requests;
 request_input jsonb;
 result jsonb;
 old_year integer;
 new_year integer;
begin
 if target_request_id is null or target_calendar_id is null or target_holiday_date is null or not pg_catalog.isfinite(target_holiday_date)
  or target_name is null or length(trim(target_name)) not between 1 and 120 or target_name<>trim(target_name)
  or target_status not in ('active','cancelled') or expected_version is null or expected_version<0
  or (target_holiday_id is null and (target_status<>'active' or expected_version<>0))
  or (target_holiday_id is not null and expected_version=0)
 then raise exception 'Valid bank holiday required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces where id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members where workspace_id=target_workspace_id and user_id=initiating_user_id and status='active' and role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 perform 1 from public.annual_leave_calendars where workspace_id=target_workspace_id and id=target_calendar_id and status='active' for share;
 if not found then raise exception 'Annual leave calendar unavailable';end if;
 request_input=pg_catalog.jsonb_build_object('calendar_id',target_calendar_id,'holiday_id',target_holiday_id,'holiday_date',target_holiday_date,'name',target_name,'status',target_status,'expected_version',expected_version);
 select * into previous from rev_scheduling_private.bank_holiday_requests where request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Bank holiday request unavailable';end if;
  return previous.result;
 end if;
 new_year=extract(year from target_holiday_date)::integer;
 if target_holiday_id is null then
  begin
   insert into public.workspace_bank_holidays(workspace_id,calendar_id,holiday_date,name,status,created_by_user_id,updated_by_user_id)
   values(target_workspace_id,target_calendar_id,target_holiday_date,target_name,'active',initiating_user_id,initiating_user_id) returning * into saved;
  exception when unique_violation then raise exception 'Bank holiday already exists';
  end;
 else
  select * into existing from public.workspace_bank_holidays where workspace_id=target_workspace_id and calendar_id=target_calendar_id and id=target_holiday_id for update;
  if not found or existing.version<>expected_version then raise exception 'Bank holiday changed';end if;
  old_year=extract(year from existing.holiday_date)::integer;
  update public.workspace_bank_holidays
  set holiday_date=target_holiday_date,name=target_name,status=target_status,version=version+1,updated_by_user_id=initiating_user_id,updated_at=now()
  where workspace_id=target_workspace_id and id=target_holiday_id returning * into saved;
 end if;
 insert into public.annual_leave_calendar_years(workspace_id,calendar_id,calendar_year)
 values(target_workspace_id,target_calendar_id,new_year)
 on conflict(workspace_id,calendar_id,calendar_year) do update
 set revision=annual_leave_calendar_years.revision+1,confirmed_revision=null,confirmed_by_user_id=null,confirmed_at=null,updated_at=now();
 if old_year is not null and old_year<>new_year then
  update public.annual_leave_calendar_years
  set revision=revision+1,confirmed_revision=null,confirmed_by_user_id=null,confirmed_at=null,updated_at=now()
  where workspace_id=target_workspace_id and calendar_id=target_calendar_id and calendar_year=old_year;
 end if;
 result=pg_catalog.jsonb_build_object('holiday_id',saved.id,'workspace_id',saved.workspace_id,'calendar_id',saved.calendar_id,'holiday_date',saved.holiday_date,'name',saved.name,'status',saved.status,'version',saved.version);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
 values(target_workspace_id,initiating_user_id,'user','scheduling.bank_holiday.saved','workspace_bank_holiday',saved.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'calendar_id',saved.calendar_id,'holiday_date',saved.holiday_date,'status',saved.status,'version',saved.version));
 insert into rev_scheduling_private.bank_holiday_requests(request_id,workspace_id,actor_user_id,input,result)
 values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;

create or replace function public.record_rev_annual_leave(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_worker_id uuid,
 target_start_at timestamptz,target_end_at timestamptz,expected_accounts jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 previous rev_scheduling_private.annual_leave_record_requests;
 worker public.scheduling_workers;
 pattern public.scheduling_worker_patterns;
 calendar_assignment public.annual_leave_worker_calendars;
 leave_calendar public.annual_leave_calendars;
 calendar_year public.annual_leave_calendar_years;
 account public.annual_leave_accounts;
 holiday public.workspace_bank_holidays;
 absence public.annual_leave_absences;
 unavailable public.scheduling_worker_unavailability;
 expected_item jsonb;
 canonical_expected jsonb;
 request_input jsonb;
 result jsonb;
 account_results jsonb='[]'::jsonb;
 first_date date;
 last_date date;
 local_date date;
 scheduled_start timestamptz;
 scheduled_end timestamptz;
 calculated_start timestamptz;
 calculated_end timestamptz;
 deduction integer;
 total integer=0;
 account_deduction integer;
 expected_count integer;
 actual_count integer;
begin
 if target_request_id is null or target_worker_id is null or target_start_at is null or target_end_at is null
  or not pg_catalog.isfinite(target_start_at) or not pg_catalog.isfinite(target_end_at) or target_start_at>=target_end_at
  or target_start_at<>date_trunc('minute',target_start_at) or target_end_at<>date_trunc('minute',target_end_at)
  or target_end_at-target_start_at>interval '370 days'
  or expected_accounts is null or pg_catalog.jsonb_typeof(expected_accounts)<>'array'
  or pg_catalog.jsonb_array_length(expected_accounts) not between 1 and 4
 then raise exception 'Valid annual leave record required';end if;
 begin
  for expected_item in select value from pg_catalog.jsonb_array_elements(expected_accounts) loop
   if (select array_agg(key order by key) from pg_catalog.jsonb_object_keys(expected_item) key)<>array['account_id','version']
    or (expected_item->>'account_id')::uuid is null or (expected_item->>'version')::bigint<1
   then raise exception 'Valid annual leave record required';end if;
  end loop;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Valid annual leave record required';
 end;
 select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('account_id',value->>'account_id','version',(value->>'version')::bigint) order by value->>'account_id'),count(distinct value->>'account_id')
 into canonical_expected,expected_count from pg_catalog.jsonb_array_elements(expected_accounts);
 if expected_count<>pg_catalog.jsonb_array_length(expected_accounts) then raise exception 'Valid annual leave record required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces where id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members where workspace_id=target_workspace_id and user_id=initiating_user_id and status='active' and role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 request_input=pg_catalog.jsonb_build_object('worker_id',target_worker_id,'start_at',target_start_at,'end_at',target_end_at,'expected_accounts',canonical_expected);
 select * into previous from rev_scheduling_private.annual_leave_record_requests where request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Annual leave record request unavailable';end if;
  return previous.result;
 end if;
 select * into worker from public.scheduling_workers where workspace_id=target_workspace_id and id=target_worker_id for update;
 if not found or not worker.active then raise exception 'Active worker required';end if;
 select * into pattern from public.scheduling_worker_patterns where workspace_id=target_workspace_id and worker_id=target_worker_id for share;
 if not found then raise exception 'Working pattern unavailable';end if;
 select * into calendar_assignment from public.annual_leave_worker_calendars where workspace_id=target_workspace_id and worker_id=target_worker_id for share;
 if not found then raise exception 'Annual leave calendar unavailable';end if;
 select * into leave_calendar from public.annual_leave_calendars where workspace_id=target_workspace_id and id=calendar_assignment.calendar_id and status='active' for share;
 if not found then raise exception 'Annual leave calendar unavailable';end if;
 first_date=(target_start_at at time zone pattern.timezone)::date;
 last_date=((target_end_at-interval '1 microsecond') at time zone pattern.timezone)::date;
 if first_date<pattern.effective_from or (pattern.effective_until is not null and last_date>pattern.effective_until) then raise exception 'Working pattern unavailable';end if;
 if exists(
  select 1 from (select distinct extract(year from day)::integer calendar_year from pg_catalog.generate_series(first_date,last_date,interval '1 day') day) required
  where not exists(
   select 1 from public.annual_leave_calendar_years y
   where y.workspace_id=target_workspace_id and y.calendar_id=leave_calendar.id and y.calendar_year=required.calendar_year
    and y.confirmed_revision=y.revision
  )
 ) then raise exception 'Annual leave calendar year unconfirmed';end if;
 perform 1 from public.annual_leave_calendar_years y
 where y.workspace_id=target_workspace_id and y.calendar_id=leave_calendar.id
  and y.calendar_year between extract(year from first_date)::integer and extract(year from last_date)::integer
 for share;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_workspace_id::text||':'||target_worker_id::text,1));
 if exists(select 1 from public.scheduling_assignments where workspace_id=target_workspace_id and worker_id=target_worker_id and status='active' and start_at<target_end_at and target_start_at<end_at) then raise exception 'Cancel affected assignments before recording annual leave';end if;
 if exists(select 1 from public.annual_leave_absences where workspace_id=target_workspace_id and worker_id=target_worker_id and status='confirmed' and start_at<target_end_at and target_start_at<end_at) then raise exception 'Annual leave overlaps existing leave';end if;
 perform 1 from public.annual_leave_accounts
 where workspace_id=target_workspace_id and worker_id=target_worker_id and leave_year_start<=last_date and first_date<leave_year_end_exclusive
 for update;
 if exists(
  select 1 from pg_catalog.generate_series(first_date,last_date,interval '1 day') day
  where not exists(select 1 from public.annual_leave_accounts a where a.workspace_id=target_workspace_id and a.worker_id=target_worker_id and day::date>=a.leave_year_start and day::date<a.leave_year_end_exclusive)
 ) then raise exception 'Annual leave account unavailable';end if;
 select count(*) into actual_count from public.annual_leave_accounts
 where workspace_id=target_workspace_id and worker_id=target_worker_id and leave_year_start<=last_date and first_date<leave_year_end_exclusive;
 if actual_count<>expected_count or exists(
  select 1 from public.annual_leave_accounts a
  where a.workspace_id=target_workspace_id and a.worker_id=target_worker_id and a.leave_year_start<=last_date and first_date<a.leave_year_end_exclusive
   and not exists(select 1 from pg_catalog.jsonb_array_elements(canonical_expected) item where (item->>'account_id')::uuid=a.id and (item->>'version')::bigint=a.version)
 ) then raise exception 'Annual leave account changed';end if;
 perform pg_catalog.set_config('rev.authoritative_annual_leave','on',true);
 insert into public.scheduling_worker_unavailability(workspace_id,worker_id,start_at,end_at,category,status,created_by_user_id,updated_by_user_id)
 values(target_workspace_id,target_worker_id,target_start_at,target_end_at,'leave','active',initiating_user_id,initiating_user_id) returning * into unavailable;
 insert into public.annual_leave_absences(workspace_id,worker_id,unavailability_id,start_at,end_at,timezone,total_deduction_minutes,status,created_by_user_id)
 values(target_workspace_id,target_worker_id,unavailable.id,target_start_at,target_end_at,pattern.timezone,0,'confirmed',initiating_user_id) returning * into absence;
 for local_date in select day::date from pg_catalog.generate_series(first_date,last_date,interval '1 day') day loop
  select * into account from public.annual_leave_accounts
  where workspace_id=target_workspace_id and worker_id=target_worker_id and local_date>=leave_year_start and local_date<leave_year_end_exclusive;
  select * into calendar_year from public.annual_leave_calendar_years
  where workspace_id=target_workspace_id and calendar_id=leave_calendar.id and annual_leave_calendar_years.calendar_year=extract(year from local_date)::integer;
  select * into holiday from public.workspace_bank_holidays
  where workspace_id=target_workspace_id and calendar_id=leave_calendar.id and holiday_date=local_date and status='active';
  scheduled_start=null;scheduled_end=null;calculated_start=null;calculated_end=null;deduction=0;
  if extract(isodow from local_date)::smallint=any(pattern.working_days) then
   begin
    scheduled_start=rev_scheduling_private.unique_local_instant(local_date+pattern.start_local::time,pattern.timezone);
    scheduled_end=rev_scheduling_private.unique_local_instant(local_date+pattern.end_local::time,pattern.timezone);
   exception when raise_exception then raise exception 'Working pattern local time ambiguous';
   end;
   calculated_start=greatest(target_start_at,scheduled_start);
   calculated_end=least(target_end_at,scheduled_end);
   if calculated_start<calculated_end then deduction=extract(epoch from calculated_end-calculated_start)::integer/60;else calculated_start=null;calculated_end=null;end if;
  end if;
  if holiday.id is not null and account.bank_holiday_treatment='additional' then deduction=0;end if;
  insert into public.annual_leave_calculation_segments(
   workspace_id,absence_id,worker_id,account_id,local_date,segment_kind,scheduled_start_at,scheduled_end_at,calculated_start_at,calculated_end_at,deduction_minutes,
   source_pattern_id,source_pattern_version,source_timezone,source_working_days,source_start_local,source_end_local,source_effective_from,source_effective_until,
   source_account_version,source_policy_id,source_policy_version,source_bank_holiday_treatment,source_holiday_id,source_holiday_version,source_holiday_name,
   source_calendar_id,source_calendar_name,source_calendar_region_code,source_calendar_year,source_calendar_year_confirmed_revision
  ) values(
   target_workspace_id,absence.id,target_worker_id,account.id,local_date,
   case when holiday.id is not null and account.bank_holiday_treatment='additional' then 'bank_holiday_additional'
    when holiday.id is not null then 'bank_holiday_included'
    when scheduled_start is null then 'non_working' else 'working' end,
   scheduled_start,scheduled_end,calculated_start,calculated_end,deduction,
   pattern.id,pattern.version,pattern.timezone,pattern.working_days,pattern.start_local,pattern.end_local,pattern.effective_from,pattern.effective_until,
   account.version,account.policy_id,account.policy_version,account.bank_holiday_treatment,holiday.id,holiday.version,holiday.name,
   leave_calendar.id,leave_calendar.name,leave_calendar.region_code,calendar_year.calendar_year,calendar_year.confirmed_revision
  );
  total=total+deduction;
 end loop;
 update public.annual_leave_absences set total_deduction_minutes=total where workspace_id=target_workspace_id and id=absence.id returning * into absence;
 for account in
  select a.* from public.annual_leave_accounts a
  where a.workspace_id=target_workspace_id and a.worker_id=target_worker_id and a.leave_year_start<=last_date and first_date<a.leave_year_end_exclusive
  order by a.id
 loop
  select coalesce(sum(deduction_minutes),0)::integer into account_deduction from public.annual_leave_calculation_segments
  where workspace_id=target_workspace_id and absence_id=absence.id and account_id=account.id;
  if account.configured_allowance_minutes+account.adjustment_total_minutes-account.recorded_leave_minutes<account_deduction then raise exception 'Annual leave balance insufficient';end if;
  update public.annual_leave_accounts
  set recorded_leave_minutes=recorded_leave_minutes+account_deduction,version=version+1,updated_by_user_id=initiating_user_id,updated_at=now()
  where workspace_id=target_workspace_id and id=account.id and version=account.version returning * into account;
  insert into public.annual_leave_postings(workspace_id,absence_id,segment_id,account_id,posting_kind,minutes,account_version,created_by_user_id)
  select target_workspace_id,absence.id,id,account.id,'deduction',deduction_minutes,account.version,initiating_user_id
  from public.annual_leave_calculation_segments
  where workspace_id=target_workspace_id and absence_id=absence.id and account_id=account.id and deduction_minutes>0;
  account_results=account_results||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
   'account_id',account.id,'version',account.version,'deducted_minutes',account_deduction,
   'remaining_minutes',account.configured_allowance_minutes+account.adjustment_total_minutes-account.recorded_leave_minutes
  ));
 end loop;
 result=pg_catalog.jsonb_build_object('absence_id',absence.id,'unavailability_id',unavailable.id,'workspace_id',target_workspace_id,'worker_id',target_worker_id,'start_at',target_start_at,'end_at',target_end_at,'timezone',pattern.timezone,'status','confirmed','version',absence.version,'total_deduction_minutes',total,'accounts',account_results);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
 values(target_workspace_id,initiating_user_id,'user','scheduling.annual_leave.recorded','annual_leave_absence',absence.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'worker_id',target_worker_id,'calendar_id',leave_calendar.id,'total_deduction_minutes',total,'version',absence.version));
 insert into rev_scheduling_private.annual_leave_record_requests(request_id,workspace_id,actor_user_id,input,result)
 values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
exception when exclusion_violation then raise exception 'Annual leave overlaps existing leave';
end $$;

create function public.cancel_rev_legacy_annual_leave(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_worker_id uuid,
 target_unavailability_id uuid,expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 previous rev_scheduling_private.legacy_leave_cancellation_requests;
 saved public.scheduling_worker_unavailability;
 request_input jsonb;
 result jsonb;
begin
 if target_request_id is null or target_worker_id is null or target_unavailability_id is null or expected_version is null or expected_version<1
 then raise exception 'Valid legacy annual leave cancellation required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces where id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members where workspace_id=target_workspace_id and user_id=initiating_user_id and status='active' and role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 request_input=pg_catalog.jsonb_build_object('worker_id',target_worker_id,'unavailability_id',target_unavailability_id,'expected_version',expected_version);
 select * into previous from rev_scheduling_private.legacy_leave_cancellation_requests where request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Legacy annual leave cancellation request unavailable';end if;
  return previous.result;
 end if;
 select * into saved from public.scheduling_worker_unavailability
 where workspace_id=target_workspace_id and worker_id=target_worker_id and id=target_unavailability_id for update;
 if not found or saved.category<>'leave' or saved.version<>expected_version then raise exception 'Legacy annual leave changed';end if;
 if exists(select 1 from public.annual_leave_absences where workspace_id=target_workspace_id and unavailability_id=target_unavailability_id)
 then raise exception 'Annual leave accounting cancellation required';end if;
 if saved.status<>'active' then raise exception 'Legacy annual leave already cancelled';end if;
 perform pg_catalog.set_config('rev.authoritative_annual_leave','on',true);
 update public.scheduling_worker_unavailability
 set status='cancelled',version=version+1,updated_by_user_id=initiating_user_id,updated_at=now()
 where workspace_id=target_workspace_id and id=target_unavailability_id and version=expected_version returning * into saved;
 result=pg_catalog.jsonb_build_object(
  'unavailability_id',saved.id,'workspace_id',saved.workspace_id,'worker_id',saved.worker_id,
  'start_at',saved.start_at,'end_at',saved.end_at,'category',saved.category,'status',saved.status,'version',saved.version
 );
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
 values(target_workspace_id,initiating_user_id,'user','scheduling.legacy_annual_leave.cancelled','scheduling_worker_unavailability',saved.id,
  pg_catalog.jsonb_build_object('request_id',target_request_id,'worker_id',saved.worker_id,'previous_version',expected_version,'version',saved.version,'accounting_changed',false));
 insert into rev_scheduling_private.legacy_leave_cancellation_requests(request_id,workspace_id,actor_user_id,input,result)
 values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;

revoke all on function public.configure_rev_annual_leave_calendar(uuid,uuid,uuid,text,uuid,uuid,text,text,text,integer,bigint) from public,anon,authenticated;
grant execute on function public.configure_rev_annual_leave_calendar(uuid,uuid,uuid,text,uuid,uuid,text,text,text,integer,bigint) to service_role;
revoke all on function public.save_rev_workspace_bank_holiday(uuid,uuid,uuid,uuid,uuid,date,text,text,bigint) from public,anon,authenticated;
grant execute on function public.save_rev_workspace_bank_holiday(uuid,uuid,uuid,uuid,uuid,date,text,text,bigint) to service_role;
revoke all on function public.cancel_rev_legacy_annual_leave(uuid,uuid,uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.cancel_rev_legacy_annual_leave(uuid,uuid,uuid,uuid,uuid,bigint) to service_role;
