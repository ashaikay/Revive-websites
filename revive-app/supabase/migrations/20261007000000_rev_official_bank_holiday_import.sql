-- Server-fetched snapshots; only explicit reviewed confirmation changes calendar authority.
create table rev_scheduling_private.bank_holiday_import_previews (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 actor_user_id uuid not null,
 worker_id uuid not null,
 calendar_id uuid,
 region text not null check(region in ('england-and-wales','scotland','northern-ireland')),
 calendar_year integer not null check(calendar_year between 1000 and 9999),
 events jsonb not null,
 snapshot jsonb not null,
 review jsonb not null,
 source text not null check(source='https://www.gov.uk/bank-holidays.json'),
 fetched_at timestamptz not null check(pg_catalog.isfinite(fetched_at)),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id),
 foreign key(workspace_id,worker_id) references public.scheduling_workers(workspace_id,id),
 foreign key(workspace_id,calendar_id) references public.annual_leave_calendars(workspace_id,id)
);
create table rev_scheduling_private.bank_holiday_import_requests (
 request_id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 actor_user_id uuid not null,
 input jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
create table rev_scheduling_private.bank_holiday_import_sources (
 holiday_id uuid primary key,
 workspace_id uuid not null,
 holiday_version bigint not null,
 preview_id uuid not null references rev_scheduling_private.bank_holiday_import_previews(id),
 foreign key(workspace_id,holiday_id) references public.workspace_bank_holidays(workspace_id,id)
);
revoke all on rev_scheduling_private.bank_holiday_import_previews,
 rev_scheduling_private.bank_holiday_import_requests,rev_scheduling_private.bank_holiday_import_sources
 from public,anon,authenticated,service_role;

create function public.import_rev_annual_leave_bank_holidays(
 target_action text,target_workspace_id uuid,initiating_user_id uuid,target_worker_id uuid,
 target_calendar_id uuid,target_region text,target_year integer,target_events jsonb,target_fetched_at timestamptz,
 target_preview_id uuid,target_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 preview rev_scheduling_private.bank_holiday_import_previews;
 previous rev_scheduling_private.bank_holiday_import_requests;
 calendar public.annual_leave_calendars;
 assignment public.annual_leave_worker_calendars;
 year_row public.annual_leave_calendar_years;
 holiday public.workspace_bank_holidays;
 snapshot jsonb;
 request_input jsonb;
 result jsonb;
 event jsonb;
 conflicts jsonb='[]'::jsonb;
 preserved jsonb='[]'::jsonb;
 additions integer=0;
 existing integer=0;
 selected_region_code text;
 region_name text;
 saved jsonb;
 calendar_count integer;
begin
 if target_action is null or target_action not in ('preview','confirm') or target_worker_id is null
  or (target_action='preview' and (
   target_region is null or target_region not in ('england-and-wales','scotland','northern-ireland')
   or target_year is null or target_year not between 1000 and 9999
   or target_events is null or pg_catalog.jsonb_typeof(target_events)<>'array'
   or target_fetched_at is null or not pg_catalog.isfinite(target_fetched_at)
   or target_fetched_at>now()+interval '1 minute' or target_fetched_at<now()-interval '5 minutes'
   or target_preview_id is not null or target_request_id is not null))
  or (target_action='confirm' and (
   target_preview_id is null or target_request_id is null or target_calendar_id is not null
   or target_region is not null or target_year is not null or target_events is not null or target_fetched_at is not null))
 then raise exception 'Valid official holiday import required';end if;
 if target_action='confirm' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 end if;
 perform 1 from public.workspaces where id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members where workspace_id=target_workspace_id and user_id=initiating_user_id and status='active' and role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 request_input=pg_catalog.jsonb_build_object('preview_id',target_preview_id,'worker_id',target_worker_id);
 if target_action='confirm' then
  select * into previous from rev_scheduling_private.bank_holiday_import_requests where request_id=target_request_id;
  if found then
   if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Official holiday request unavailable';end if;
   return previous.result;
  end if;
  select * into preview from rev_scheduling_private.bank_holiday_import_previews
  where id=target_preview_id and workspace_id=target_workspace_id and actor_user_id=initiating_user_id and worker_id=target_worker_id;
  if not found then raise exception 'Official holiday preview changed';end if;
  target_calendar_id=preview.calendar_id;
  target_region=preview.region;
  target_year=preview.calendar_year;
  target_events=preview.events;
  target_fetched_at=preview.fetched_at;
 end if;
 perform 1 from public.scheduling_workers where workspace_id=target_workspace_id and id=target_worker_id and active for update;
 if not found then raise exception 'Worker unavailable';end if;
 selected_region_code=case target_region when 'england-and-wales' then 'GB-EAW' when 'scotland' then 'GB-SCT' else 'GB-NIR' end;
 region_name=case target_region when 'england-and-wales' then 'England and Wales' when 'scotland' then 'Scotland' else 'Northern Ireland' end;
 if target_calendar_id is null then
  select count(*) into calendar_count from public.annual_leave_calendars c
  where c.workspace_id=target_workspace_id and c.status='active'
   and (c.region_code=selected_region_code
    or (target_region='england-and-wales' and c.region_code in ('GB-ENG','GB-WLS')));
  if calendar_count>1 then raise exception 'Annual leave calendar unavailable';end if;
  select * into calendar from public.annual_leave_calendars c
  where c.workspace_id=target_workspace_id and c.status='active'
   and (c.region_code=selected_region_code
    or (target_region='england-and-wales' and c.region_code in ('GB-ENG','GB-WLS')));
 else
  select * into calendar from public.annual_leave_calendars where workspace_id=target_workspace_id and id=target_calendar_id and status='active';
  if not found or not (calendar.region_code=selected_region_code or (target_region='england-and-wales' and calendar.region_code in ('GB-ENG','GB-WLS'))) then raise exception 'Annual leave calendar unavailable';end if;
 end if;
 select * into assignment from public.annual_leave_worker_calendars where workspace_id=target_workspace_id and worker_id=target_worker_id;
 select * into year_row from public.annual_leave_calendar_years where workspace_id=target_workspace_id and calendar_id=calendar.id and calendar_year=target_year;
 snapshot=pg_catalog.jsonb_build_object(
  'calendar_id',calendar.id,'calendar_version',calendar.version,'assignment_id',assignment.calendar_id,'assignment_version',assignment.version,
  'revision',year_row.revision,
  'holidays',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'date',holiday_date,'name',name,'status',status,'version',version) order by holiday_date),'[]'::jsonb)
   from public.workspace_bank_holidays where workspace_id=target_workspace_id and calendar_id=calendar.id and extract(year from holiday_date)=target_year));
 if target_action='confirm' and snapshot<>preview.snapshot then raise exception 'Official holiday preview changed';end if;
 if pg_catalog.jsonb_array_length(target_events) not between 1 and 100 then raise exception 'Valid official holiday dates required';end if;
 for event in select value from pg_catalog.jsonb_array_elements(target_events) loop
  if pg_catalog.jsonb_typeof(event)<>'object' or (select count(*) from pg_catalog.jsonb_object_keys(event))<>2
   or not (event ? 'date' and event ? 'title')
   or pg_catalog.jsonb_typeof(event->'date')<>'string' or pg_catalog.jsonb_typeof(event->'title')<>'string'
   or (event->>'date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or extract(year from (event->>'date')::date)<>target_year
   or length(trim(event->>'title')) not between 1 and 120 or trim(event->>'title')<>event->>'title'
  then raise exception 'Valid official holiday dates required';end if;
  select * into holiday from public.workspace_bank_holidays
  where workspace_id=target_workspace_id and calendar_id=calendar.id and holiday_date=(event->>'date')::date;
  if not found then additions=additions+1;
  elsif holiday.name=event->>'title' and holiday.status='active' and exists(
   select 1 from rev_scheduling_private.bank_holiday_import_sources s
   join rev_scheduling_private.bank_holiday_import_previews p on p.id=s.preview_id
   where s.workspace_id=target_workspace_id and s.holiday_id=holiday.id and s.holiday_version=holiday.version and p.region=target_region
  ) then existing=existing+1;
  else conflicts=conflicts||pg_catalog.jsonb_build_array((event->>'date')||': existing entry "'||holiday.name||'" is preserved.');end if;
 end loop;
 if (select count(distinct value->>'date') from pg_catalog.jsonb_array_elements(target_events))<>pg_catalog.jsonb_array_length(target_events) then raise exception 'Valid official holiday dates required';end if;
 for holiday in select * from public.workspace_bank_holidays where workspace_id=target_workspace_id and calendar_id=calendar.id and extract(year from holiday_date)=target_year and status='active' loop
  if not exists(select 1 from pg_catalog.jsonb_array_elements(target_events) e where (e->>'date')::date=holiday.holiday_date) then
   if exists(select 1 from rev_scheduling_private.bank_holiday_import_sources where holiday_id=holiday.id and holiday_version=holiday.version) then
    conflicts=conflicts||pg_catalog.jsonb_build_array(holiday.holiday_date::text||': previously imported "'||holiday.name||'" is absent from the official response; resolve manually.');
   else preserved=preserved||pg_catalog.jsonb_build_array(holiday.holiday_date::text||': '||holiday.name);end if;
  end if;
 end loop;
 if target_action='preview' then
  insert into rev_scheduling_private.bank_holiday_import_previews(workspace_id,actor_user_id,worker_id,calendar_id,region,calendar_year,events,snapshot,review,source,fetched_at)
  values(target_workspace_id,initiating_user_id,target_worker_id,calendar.id,target_region,target_year,target_events,snapshot,
   pg_catalog.jsonb_build_object('conflicts',conflicts,'preserved',preserved,'additions',additions,'existing',existing),
   'https://www.gov.uk/bank-holidays.json',target_fetched_at) returning * into preview;
  return pg_catalog.jsonb_build_object('action','preview','workspaceId',target_workspace_id,'workerId',target_worker_id,'previewId',preview.id,
   'calendarId',calendar.id,'calendarName',coalesce(calendar.name,region_name),'region',target_region,'calendarYear',target_year,
   'holidays',target_events,'conflicts',conflicts,'preserved',preserved,'additions',additions,'existing',existing,'source',preview.source,'fetchedAt',target_fetched_at);
 end if;
 if pg_catalog.jsonb_array_length(conflicts)>0 then raise exception 'Official holiday conflicts';end if;
 if calendar.id is null then
  saved=public.configure_rev_annual_leave_calendar(target_workspace_id,initiating_user_id,gen_random_uuid(),'save_calendar',null,null,region_name,selected_region_code,'active',null,0);
  calendar.id=(saved->>'calendar_id')::uuid;
 end if;
 if assignment.calendar_id is distinct from calendar.id then
  perform public.configure_rev_annual_leave_calendar(target_workspace_id,initiating_user_id,gen_random_uuid(),'assign_worker',calendar.id,target_worker_id,null,null,null,null,coalesce(assignment.version,0));
 end if;
 for event in select value from pg_catalog.jsonb_array_elements(target_events) loop
  if not exists(select 1 from public.workspace_bank_holidays where workspace_id=target_workspace_id and calendar_id=calendar.id and holiday_date=(event->>'date')::date) then
   saved=public.save_rev_workspace_bank_holiday(target_workspace_id,initiating_user_id,gen_random_uuid(),calendar.id,null,(event->>'date')::date,event->>'title','active',0);
   insert into rev_scheduling_private.bank_holiday_import_sources(holiday_id,workspace_id,holiday_version,preview_id)
   values((saved->>'holiday_id')::uuid,target_workspace_id,(saved->>'version')::bigint,preview.id);
  end if;
 end loop;
 select * into year_row from public.annual_leave_calendar_years where workspace_id=target_workspace_id and calendar_id=calendar.id and calendar_year=target_year;
 saved=public.configure_rev_annual_leave_calendar(target_workspace_id,initiating_user_id,gen_random_uuid(),'confirm_year',calendar.id,null,null,null,null,target_year,coalesce(year_row.revision,0));
 result=pg_catalog.jsonb_build_object('action','confirm','workspaceId',target_workspace_id,'workerId',target_worker_id,'requestId',target_request_id,
  'previewId',preview.id,'calendarId',calendar.id,'calendarYear',target_year,'revision',saved->'revision','confirmedRevision',saved->'confirmed_revision',
  'source',preview.source,'fetchedAt',preview.fetched_at,'additions',additions,'existing',existing);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
 values(target_workspace_id,initiating_user_id,'user','scheduling.annual_leave_calendar.official_import','annual_leave_calendar',calendar.id,
  pg_catalog.jsonb_build_object('request_id',target_request_id,'preview_id',preview.id,'source',preview.source,'fetched_at',preview.fetched_at,'region',target_region,'calendar_year',target_year,'additions',additions,'existing',existing));
 insert into rev_scheduling_private.bank_holiday_import_requests(request_id,workspace_id,actor_user_id,input,result)
 values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;
revoke all on function public.import_rev_annual_leave_bank_holidays(text,uuid,uuid,uuid,uuid,text,integer,jsonb,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.import_rev_annual_leave_bank_holidays(text,uuid,uuid,uuid,uuid,text,integer,jsonb,timestamptz,uuid,uuid) to service_role;
