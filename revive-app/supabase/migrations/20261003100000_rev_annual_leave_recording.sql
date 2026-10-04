-- Manager-recorded annual leave, immutable calculations and exact cancellation.
create table public.workspace_bank_holidays (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 holiday_date date not null check(pg_catalog.isfinite(holiday_date)),
 name text not null check(length(trim(name)) between 1 and 120 and name=trim(name)),
 status text not null check(status in ('active','cancelled')),
 version bigint not null default 1 check(version>=1),
 created_by_user_id uuid not null,
 updated_by_user_id uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,id),
 unique(workspace_id,holiday_date),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id),
 foreign key(workspace_id,updated_by_user_id) references public.workspace_members(workspace_id,user_id)
);
alter table public.workspace_bank_holidays enable row level security;
revoke all on public.workspace_bank_holidays from public,anon,authenticated,service_role;
grant select on public.workspace_bank_holidays to authenticated,service_role;
create policy workspace_bank_holidays_managers_read on public.workspace_bank_holidays for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));

alter table public.annual_leave_accounts
 add column recorded_leave_minutes integer not null default 0 check(recorded_leave_minutes>=0),
 add column deduction_status text not null default 'recording_enabled' check(deduction_status='recording_enabled');

create table public.annual_leave_absences (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 worker_id uuid not null,
 unavailability_id uuid not null,
 start_at timestamptz not null check(pg_catalog.isfinite(start_at)),
 end_at timestamptz not null check(pg_catalog.isfinite(end_at) and end_at>start_at),
 timezone text not null check(length(trim(timezone)) between 1 and 100 and timezone=trim(timezone)),
 total_deduction_minutes integer not null check(total_deduction_minutes>=0),
 status text not null check(status in ('confirmed','cancelled')),
 version bigint not null default 1 check(version>=1),
 created_by_user_id uuid not null,
 cancelled_by_user_id uuid,
 created_at timestamptz not null default now(),
 cancelled_at timestamptz,
 unique(workspace_id,id),
 unique(workspace_id,unavailability_id),
 foreign key(workspace_id,worker_id) references public.scheduling_workers(workspace_id,id),
 foreign key(workspace_id,unavailability_id) references public.scheduling_worker_unavailability(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id),
 foreign key(workspace_id,cancelled_by_user_id) references public.workspace_members(workspace_id,user_id),
 check((status='confirmed' and cancelled_by_user_id is null and cancelled_at is null) or (status='cancelled' and cancelled_by_user_id is not null and cancelled_at is not null))
);
alter table public.annual_leave_absences
 add constraint annual_leave_absences_no_overlap
 exclude using gist(workspace_id with =,worker_id with =,tstzrange(start_at,end_at,'[)') with &&)
 where(status='confirmed');
create index annual_leave_absences_worker_idx on public.annual_leave_absences(workspace_id,worker_id,start_at);
alter table public.annual_leave_absences enable row level security;
revoke all on public.annual_leave_absences from public,anon,authenticated,service_role;
grant select on public.annual_leave_absences to authenticated,service_role;
create policy annual_leave_absences_managers_read on public.annual_leave_absences for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));

create table public.annual_leave_calculation_segments (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null,
 absence_id uuid not null,
 worker_id uuid not null,
 account_id uuid not null,
 local_date date not null,
 segment_kind text not null check(segment_kind in ('working','non_working','bank_holiday_included','bank_holiday_additional')),
 scheduled_start_at timestamptz,
 scheduled_end_at timestamptz,
 calculated_start_at timestamptz,
 calculated_end_at timestamptz,
 deduction_minutes integer not null check(deduction_minutes>=0),
 source_pattern_id uuid not null,
 source_pattern_version bigint not null check(source_pattern_version>=1),
 source_timezone text not null,
 source_working_days smallint[] not null,
 source_start_local text not null,
 source_end_local text not null,
 source_effective_from date not null,
 source_effective_until date,
 source_account_version bigint not null check(source_account_version>=1),
 source_policy_id uuid not null,
 source_policy_version bigint not null check(source_policy_version>=1),
 source_bank_holiday_treatment text not null check(source_bank_holiday_treatment in ('included','additional')),
 source_holiday_id uuid,
 source_holiday_version bigint,
 source_holiday_name text,
 created_at timestamptz not null default now(),
 unique(workspace_id,id),
 unique(workspace_id,absence_id,local_date),
 foreign key(workspace_id,absence_id) references public.annual_leave_absences(workspace_id,id),
 foreign key(workspace_id,worker_id) references public.scheduling_workers(workspace_id,id),
 foreign key(workspace_id,account_id) references public.annual_leave_accounts(workspace_id,id),
 foreign key(workspace_id,source_pattern_id) references public.scheduling_worker_patterns(workspace_id,id),
 foreign key(workspace_id,source_policy_id) references public.annual_leave_policies(workspace_id,id),
 foreign key(workspace_id,source_holiday_id) references public.workspace_bank_holidays(workspace_id,id),
 check((scheduled_start_at is null and scheduled_end_at is null) or (scheduled_start_at is not null and scheduled_end_at>scheduled_start_at)),
 check((calculated_start_at is null and calculated_end_at is null) or (calculated_start_at is not null and calculated_end_at>calculated_start_at)),
 check((source_holiday_id is null and source_holiday_version is null and source_holiday_name is null) or (source_holiday_id is not null and source_holiday_version is not null and source_holiday_name is not null))
);
alter table public.annual_leave_calculation_segments enable row level security;
revoke all on public.annual_leave_calculation_segments from public,anon,authenticated,service_role;
grant select on public.annual_leave_calculation_segments to authenticated,service_role;
create policy annual_leave_segments_managers_read on public.annual_leave_calculation_segments for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));

create table public.annual_leave_postings (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null,
 absence_id uuid not null,
 segment_id uuid,
 account_id uuid not null,
 posting_kind text not null check(posting_kind in ('deduction','reversal')),
 minutes integer not null check((posting_kind='deduction' and minutes>0) or (posting_kind='reversal' and minutes<0)),
 account_version bigint not null check(account_version>=1),
 reverses_posting_id uuid,
 created_by_user_id uuid not null,
 created_at timestamptz not null default now(),
 unique(workspace_id,id),
 unique(reverses_posting_id),
 foreign key(workspace_id,absence_id) references public.annual_leave_absences(workspace_id,id),
 foreign key(workspace_id,segment_id) references public.annual_leave_calculation_segments(workspace_id,id),
 foreign key(workspace_id,account_id) references public.annual_leave_accounts(workspace_id,id),
 foreign key(workspace_id,reverses_posting_id) references public.annual_leave_postings(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id),
 check((posting_kind='deduction' and segment_id is not null and reverses_posting_id is null) or (posting_kind='reversal' and segment_id is null and reverses_posting_id is not null))
);
create index annual_leave_postings_account_idx on public.annual_leave_postings(workspace_id,account_id,created_at);
alter table public.annual_leave_postings enable row level security;
revoke all on public.annual_leave_postings from public,anon,authenticated,service_role;
grant select on public.annual_leave_postings to authenticated,service_role;
create policy annual_leave_postings_managers_read on public.annual_leave_postings for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));

create table rev_scheduling_private.bank_holiday_requests (
 request_id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 actor_user_id uuid not null,
 input jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
create table rev_scheduling_private.annual_leave_record_requests (
 request_id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 actor_user_id uuid not null,
 input jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
create table rev_scheduling_private.annual_leave_cancellation_requests (
 request_id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 actor_user_id uuid not null,
 input jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
revoke all on rev_scheduling_private.bank_holiday_requests,rev_scheduling_private.annual_leave_record_requests,rev_scheduling_private.annual_leave_cancellation_requests from public,anon,authenticated,service_role;

create trigger annual_leave_segments_append_only before update or delete on public.annual_leave_calculation_segments
 for each row execute function rev_scheduling_private.prevent_annual_leave_evidence_mutation();
create trigger annual_leave_postings_append_only before update or delete on public.annual_leave_postings
 for each row execute function rev_scheduling_private.prevent_annual_leave_evidence_mutation();

create function rev_scheduling_private.guard_authoritative_annual_leave_unavailability()
returns trigger language plpgsql set search_path='' as $$
begin
 if (new.category='leave' or (tg_op='UPDATE' and old.category='leave'))
  and pg_catalog.current_setting('rev.authoritative_annual_leave',true) is distinct from 'on'
 then raise exception 'Annual leave requires authoritative recording';end if;
 return new;
end $$;
revoke all on function rev_scheduling_private.guard_authoritative_annual_leave_unavailability() from public,anon,authenticated,service_role;
create trigger authoritative_annual_leave_unavailability_guard before insert or update on public.scheduling_worker_unavailability
 for each row execute function rev_scheduling_private.guard_authoritative_annual_leave_unavailability();

create function public.save_rev_workspace_bank_holiday(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_holiday_id uuid,
 target_holiday_date date,target_name text,target_status text,expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.workspace_bank_holidays;existing public.workspace_bank_holidays;previous rev_scheduling_private.bank_holiday_requests;request_input jsonb;result jsonb;
begin
 if target_request_id is null or target_holiday_date is null or not pg_catalog.isfinite(target_holiday_date) or target_name is null or length(trim(target_name)) not between 1 and 120 or target_name<>trim(target_name) or target_status not in ('active','cancelled') or expected_version is null or expected_version<0
  or (target_holiday_id is null and (target_status<>'active' or expected_version<>0))
  or (target_holiday_id is not null and expected_version=0)
 then raise exception 'Valid bank holiday required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces where id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members where workspace_id=target_workspace_id and user_id=initiating_user_id and status='active' and role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 request_input=pg_catalog.jsonb_build_object('holiday_id',target_holiday_id,'holiday_date',target_holiday_date,'name',target_name,'status',target_status,'expected_version',expected_version);
 select * into previous from rev_scheduling_private.bank_holiday_requests where request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Bank holiday request unavailable';end if;
  return previous.result;
 end if;
 if target_holiday_id is null then
  begin
   insert into public.workspace_bank_holidays(workspace_id,holiday_date,name,status,created_by_user_id,updated_by_user_id)
   values(target_workspace_id,target_holiday_date,target_name,'active',initiating_user_id,initiating_user_id) returning * into saved;
  exception when unique_violation then raise exception 'Bank holiday already exists';
  end;
 else
  select * into existing from public.workspace_bank_holidays where workspace_id=target_workspace_id and id=target_holiday_id for update;
  if not found or existing.version<>expected_version then raise exception 'Bank holiday changed';end if;
  update public.workspace_bank_holidays
  set holiday_date=target_holiday_date,name=target_name,status=target_status,version=version+1,updated_by_user_id=initiating_user_id,updated_at=now()
  where workspace_id=target_workspace_id and id=target_holiday_id returning * into saved;
 end if;
 result=pg_catalog.jsonb_build_object('holiday_id',saved.id,'workspace_id',saved.workspace_id,'holiday_date',saved.holiday_date,'name',saved.name,'status',saved.status,'version',saved.version);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
 values(target_workspace_id,initiating_user_id,'user','scheduling.bank_holiday.saved','workspace_bank_holiday',saved.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'holiday_date',saved.holiday_date,'status',saved.status,'version',saved.version));
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
 first_date=(target_start_at at time zone pattern.timezone)::date;
 last_date=((target_end_at-interval '1 microsecond') at time zone pattern.timezone)::date;
 if first_date<pattern.effective_from or (pattern.effective_until is not null and last_date>pattern.effective_until) then raise exception 'Working pattern unavailable';end if;
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
  select * into holiday from public.workspace_bank_holidays
  where workspace_id=target_workspace_id and holiday_date=local_date and status='active';
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
   source_account_version,source_policy_id,source_policy_version,source_bank_holiday_treatment,source_holiday_id,source_holiday_version,source_holiday_name
  ) values(
   target_workspace_id,absence.id,target_worker_id,account.id,local_date,
   case when holiday.id is not null and account.bank_holiday_treatment='additional' then 'bank_holiday_additional'
    when holiday.id is not null then 'bank_holiday_included'
    when scheduled_start is null then 'non_working' else 'working' end,
   scheduled_start,scheduled_end,calculated_start,calculated_end,deduction,
   pattern.id,pattern.version,pattern.timezone,pattern.working_days,pattern.start_local,pattern.end_local,pattern.effective_from,pattern.effective_until,
   account.version,account.policy_id,account.policy_version,account.bank_holiday_treatment,holiday.id,holiday.version,holiday.name
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
 values(target_workspace_id,initiating_user_id,'user','scheduling.annual_leave.recorded','annual_leave_absence',absence.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'worker_id',target_worker_id,'total_deduction_minutes',total,'version',absence.version));
 insert into rev_scheduling_private.annual_leave_record_requests(request_id,workspace_id,actor_user_id,input,result)
 values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
exception when exclusion_violation then raise exception 'Annual leave overlaps existing leave';
end $$;

create function public.cancel_rev_annual_leave(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_absence_id uuid,
 expected_version bigint,expected_accounts jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 previous rev_scheduling_private.annual_leave_cancellation_requests;
 absence public.annual_leave_absences;
 account public.annual_leave_accounts;
 posting public.annual_leave_postings;
 expected_item jsonb;
 canonical_expected jsonb;
 request_input jsonb;
 result jsonb;
 account_results jsonb='[]'::jsonb;
 expected_count integer;
 actual_count integer;
 reversed integer=0;
 account_reversed integer;
begin
 if target_request_id is null or target_absence_id is null or expected_version is null or expected_version<1
  or expected_accounts is null or pg_catalog.jsonb_typeof(expected_accounts)<>'array'
  or pg_catalog.jsonb_array_length(expected_accounts) not between 1 and 4
 then raise exception 'Valid annual leave cancellation required';end if;
 begin
  for expected_item in select value from pg_catalog.jsonb_array_elements(expected_accounts) loop
   if (select array_agg(key order by key) from pg_catalog.jsonb_object_keys(expected_item) key)<>array['account_id','version']
    or (expected_item->>'account_id')::uuid is null or (expected_item->>'version')::bigint<1
   then raise exception 'Valid annual leave cancellation required';end if;
  end loop;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Valid annual leave cancellation required';
 end;
 select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('account_id',value->>'account_id','version',(value->>'version')::bigint) order by value->>'account_id'),count(distinct value->>'account_id')
 into canonical_expected,expected_count from pg_catalog.jsonb_array_elements(expected_accounts);
 if expected_count<>pg_catalog.jsonb_array_length(expected_accounts) then raise exception 'Valid annual leave cancellation required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces where id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members where workspace_id=target_workspace_id and user_id=initiating_user_id and status='active' and role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 request_input=pg_catalog.jsonb_build_object('absence_id',target_absence_id,'expected_version',expected_version,'expected_accounts',canonical_expected);
 select * into previous from rev_scheduling_private.annual_leave_cancellation_requests where request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Annual leave cancellation request unavailable';end if;
  return previous.result;
 end if;
 select * into absence from public.annual_leave_absences where workspace_id=target_workspace_id and id=target_absence_id for update;
 if not found or absence.version<>expected_version then raise exception 'Annual leave changed';end if;
 if absence.status='cancelled' then raise exception 'Annual leave already cancelled';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_workspace_id::text||':'||absence.worker_id::text,1));
 perform 1 from public.annual_leave_accounts a
 where a.workspace_id=target_workspace_id and exists(select 1 from public.annual_leave_calculation_segments s where s.workspace_id=target_workspace_id and s.absence_id=absence.id and s.account_id=a.id)
 for update;
 select count(distinct account_id) into actual_count from public.annual_leave_calculation_segments where workspace_id=target_workspace_id and absence_id=absence.id;
 if actual_count<>expected_count or exists(
  select 1 from public.annual_leave_accounts a
  where a.workspace_id=target_workspace_id and exists(select 1 from public.annual_leave_calculation_segments s where s.workspace_id=target_workspace_id and s.absence_id=absence.id and s.account_id=a.id)
   and not exists(select 1 from pg_catalog.jsonb_array_elements(canonical_expected) item where (item->>'account_id')::uuid=a.id and (item->>'version')::bigint=a.version)
 ) then raise exception 'Annual leave account changed';end if;
 for account in
  select a.* from public.annual_leave_accounts a
  where a.workspace_id=target_workspace_id and exists(select 1 from public.annual_leave_calculation_segments s where s.workspace_id=target_workspace_id and s.absence_id=absence.id and s.account_id=a.id)
  order by a.id
 loop
  account_reversed=0;
  for posting in
   select p.* from public.annual_leave_postings p
   where p.workspace_id=target_workspace_id and p.absence_id=absence.id and p.account_id=account.id and p.posting_kind='deduction'
   order by p.id
  loop
   if exists(select 1 from public.annual_leave_postings where reverses_posting_id=posting.id) then raise exception 'Annual leave already cancelled';end if;
   insert into public.annual_leave_postings(workspace_id,absence_id,account_id,posting_kind,minutes,account_version,reverses_posting_id,created_by_user_id)
   values(target_workspace_id,absence.id,account.id,'reversal',-posting.minutes,account.version+1,posting.id,initiating_user_id);
   account_reversed=account_reversed+posting.minutes;
  end loop;
  if account.recorded_leave_minutes<account_reversed then raise exception 'Annual leave account changed';end if;
  update public.annual_leave_accounts
  set recorded_leave_minutes=recorded_leave_minutes-account_reversed,version=version+1,updated_by_user_id=initiating_user_id,updated_at=now()
  where workspace_id=target_workspace_id and id=account.id and version=account.version returning * into account;
  reversed=reversed+account_reversed;
  account_results=account_results||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
   'account_id',account.id,'version',account.version,
   'remaining_minutes',account.configured_allowance_minutes+account.adjustment_total_minutes-account.recorded_leave_minutes
  ));
 end loop;
 perform pg_catalog.set_config('rev.authoritative_annual_leave','on',true);
 update public.scheduling_worker_unavailability
 set status='cancelled',version=version+1,updated_by_user_id=initiating_user_id,updated_at=now()
 where workspace_id=target_workspace_id and id=absence.unavailability_id and status='active';
 if not found then raise exception 'Annual leave changed';end if;
 update public.annual_leave_absences
 set status='cancelled',version=version+1,cancelled_by_user_id=initiating_user_id,cancelled_at=now()
 where workspace_id=target_workspace_id and id=absence.id and version=absence.version returning * into absence;
 result=pg_catalog.jsonb_build_object('absence_id',absence.id,'workspace_id',absence.workspace_id,'worker_id',absence.worker_id,'status',absence.status,'version',absence.version,'reversed_minutes',reversed,'accounts',account_results);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
 values(target_workspace_id,initiating_user_id,'user','scheduling.annual_leave.cancelled','annual_leave_absence',absence.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'worker_id',absence.worker_id,'reversed_minutes',reversed,'version',absence.version));
 insert into rev_scheduling_private.annual_leave_cancellation_requests(request_id,workspace_id,actor_user_id,input,result)
 values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;

revoke all on function public.save_rev_workspace_bank_holiday(uuid,uuid,uuid,uuid,date,text,text,bigint) from public,anon,authenticated;
grant execute on function public.save_rev_workspace_bank_holiday(uuid,uuid,uuid,uuid,date,text,text,bigint) to service_role;
revoke all on function public.record_rev_annual_leave(uuid,uuid,uuid,uuid,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.record_rev_annual_leave(uuid,uuid,uuid,uuid,timestamptz,timestamptz,jsonb) to service_role;
revoke all on function public.cancel_rev_annual_leave(uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.cancel_rev_annual_leave(uuid,uuid,uuid,uuid,bigint,jsonb) to service_role;
