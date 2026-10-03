-- Manager-recorded annual-leave policy foundations only. Absence accounting is not implemented here.
create table public.annual_leave_policies (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 worker_id uuid,
 version bigint not null check(version>=1),
 effective_from_leave_year integer not null check(effective_from_leave_year between 1900 and 9998),
 allowance_input_unit text not null check(allowance_input_unit in ('hours','days')),
 allowance_input_value numeric(12,4) not null check(allowance_input_value>=0),
 allowance_minutes integer not null check(allowance_minutes>=0),
 hours_per_day_minutes integer not null check(hours_per_day_minutes between 1 and 1440),
 leave_year_start_month smallint not null check(leave_year_start_month between 1 and 12),
 leave_year_start_day smallint not null check(leave_year_start_day between 1 and 31),
 bank_holiday_treatment text not null check(bank_holiday_treatment in ('included','additional')),
 created_by_user_id uuid not null,
 created_at timestamptz not null default now(),
 unique(workspace_id,id),
 unique nulls not distinct(workspace_id,worker_id,version),
 foreign key(workspace_id,worker_id) references public.scheduling_workers(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id),
 check(make_date(2001,leave_year_start_month,leave_year_start_day) is not null),
 check((allowance_input_unit='hours' and allowance_input_value*60=allowance_minutes)
    or (allowance_input_unit='days' and allowance_input_value*hours_per_day_minutes=allowance_minutes))
);
create index annual_leave_policies_scope_idx on public.annual_leave_policies(workspace_id,worker_id,effective_from_leave_year desc,version desc);
alter table public.annual_leave_policies enable row level security;
revoke all on public.annual_leave_policies from public,anon,authenticated,service_role;
grant select on public.annual_leave_policies to authenticated,service_role;
create policy annual_leave_policies_managers_read on public.annual_leave_policies for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));

create table public.annual_leave_accounts (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 worker_id uuid not null,
 leave_year_start date not null,
 leave_year_end_exclusive date not null,
 policy_id uuid not null,
 policy_version bigint not null check(policy_version>=1),
 policy_scope text not null check(policy_scope in ('workspace','worker')),
 effective_from_leave_year integer not null,
 allowance_input_unit text not null check(allowance_input_unit in ('hours','days')),
 allowance_input_value numeric(12,4) not null,
 configured_allowance_minutes integer not null check(configured_allowance_minutes>=0),
 hours_per_day_minutes integer not null check(hours_per_day_minutes between 1 and 1440),
 bank_holiday_treatment text not null check(bank_holiday_treatment in ('included','additional')),
 adjustment_total_minutes integer not null default 0,
 accounting_status text not null default 'policy_only' check(accounting_status='policy_only'),
 version bigint not null default 1 check(version>=1),
 created_by_user_id uuid not null,
 updated_by_user_id uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,id),
 unique(workspace_id,worker_id,leave_year_start),
 foreign key(workspace_id,worker_id) references public.scheduling_workers(workspace_id,id),
 foreign key(workspace_id,policy_id) references public.annual_leave_policies(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id),
 foreign key(workspace_id,updated_by_user_id) references public.workspace_members(workspace_id,user_id),
 check(leave_year_end_exclusive=(leave_year_start+interval '1 year')::date)
);
create index annual_leave_accounts_worker_idx on public.annual_leave_accounts(workspace_id,worker_id,leave_year_start desc);
alter table public.annual_leave_accounts enable row level security;
revoke all on public.annual_leave_accounts from public,anon,authenticated,service_role;
grant select on public.annual_leave_accounts to authenticated,service_role;
create policy annual_leave_accounts_managers_read on public.annual_leave_accounts for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));

create table public.annual_leave_adjustments (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 account_id uuid not null,
 worker_id uuid not null,
 leave_year_start date not null,
 adjustment_minutes integer not null check(adjustment_minutes<>0),
 reason text not null check(length(trim(reason)) between 1 and 500 and reason=trim(reason)),
 account_version bigint not null check(account_version>=2),
 created_by_user_id uuid not null,
 created_at timestamptz not null default now(),
 unique(workspace_id,id),
 foreign key(workspace_id,account_id) references public.annual_leave_accounts(workspace_id,id),
 foreign key(workspace_id,worker_id) references public.scheduling_workers(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id)
);
create index annual_leave_adjustments_account_idx on public.annual_leave_adjustments(workspace_id,account_id,created_at);
alter table public.annual_leave_adjustments enable row level security;
revoke all on public.annual_leave_adjustments from public,anon,authenticated,service_role;
grant select on public.annual_leave_adjustments to authenticated,service_role;
create policy annual_leave_adjustments_managers_read on public.annual_leave_adjustments for select to authenticated
 using(public.has_workspace_role(workspace_id,array['owner','admin']));

create table rev_scheduling_private.annual_leave_policy_requests (
 request_id uuid primary key,workspace_id uuid not null references public.workspaces(id),actor_user_id uuid not null,
 input jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
create table rev_scheduling_private.annual_leave_account_requests (
 request_id uuid primary key,workspace_id uuid not null references public.workspaces(id),actor_user_id uuid not null,
 input jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
create table rev_scheduling_private.annual_leave_adjustment_requests (
 request_id uuid primary key,workspace_id uuid not null references public.workspaces(id),actor_user_id uuid not null,
 input jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
revoke all on rev_scheduling_private.annual_leave_policy_requests,rev_scheduling_private.annual_leave_account_requests,rev_scheduling_private.annual_leave_adjustment_requests from public,anon,authenticated,service_role;

create function rev_scheduling_private.prevent_annual_leave_evidence_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Annual leave evidence is append-only';end $$;
revoke all on function rev_scheduling_private.prevent_annual_leave_evidence_mutation() from public,anon,authenticated,service_role;
create trigger annual_leave_policies_append_only before update or delete on public.annual_leave_policies for each row execute function rev_scheduling_private.prevent_annual_leave_evidence_mutation();
create trigger annual_leave_adjustments_append_only before update or delete on public.annual_leave_adjustments for each row execute function rev_scheduling_private.prevent_annual_leave_evidence_mutation();
create function rev_scheduling_private.protect_annual_leave_account_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or new.workspace_id<>old.workspace_id or new.worker_id<>old.worker_id or new.leave_year_start<>old.leave_year_start or new.leave_year_end_exclusive<>old.leave_year_end_exclusive
 or new.policy_id<>old.policy_id or new.policy_version<>old.policy_version or new.policy_scope<>old.policy_scope or new.effective_from_leave_year<>old.effective_from_leave_year
 or new.allowance_input_unit<>old.allowance_input_unit or new.allowance_input_value<>old.allowance_input_value or new.configured_allowance_minutes<>old.configured_allowance_minutes
 or new.hours_per_day_minutes<>old.hours_per_day_minutes or new.bank_holiday_treatment<>old.bank_holiday_treatment or new.accounting_status<>old.accounting_status
 or new.created_by_user_id<>old.created_by_user_id or new.created_at<>old.created_at
 then raise exception 'Annual leave account snapshot is immutable';end if;
 return new;
end $$;
revoke all on function rev_scheduling_private.protect_annual_leave_account_snapshot() from public,anon,authenticated,service_role;
create trigger annual_leave_account_snapshot_guard before update or delete on public.annual_leave_accounts for each row execute function rev_scheduling_private.protect_annual_leave_account_snapshot();

create function public.save_rev_annual_leave_policy(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_worker_id uuid,
 target_effective_from_leave_year integer,target_allowance_input_unit text,target_allowance_input_value numeric,
 target_allowance_minutes integer,target_hours_per_day_minutes integer,target_leave_year_start_month smallint,
 target_leave_year_start_day smallint,target_bank_holiday_treatment text,expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.annual_leave_policies;previous rev_scheduling_private.annual_leave_policy_requests;
 request_input jsonb;result jsonb;current_version bigint;
begin
 if target_request_id is null or expected_version is null or expected_version<0 or target_effective_from_leave_year not between 1900 and 9998
 or target_allowance_input_unit not in ('hours','days') or target_allowance_input_value is null or target_allowance_input_value<0
 or target_allowance_minutes is null or target_allowance_minutes<0 or target_hours_per_day_minutes not between 1 and 1440
 or target_leave_year_start_month not between 1 and 12 or target_leave_year_start_day not between 1 and 31
 or target_bank_holiday_treatment not in ('included','additional')
 or (target_allowance_input_unit='hours' and target_allowance_input_value*60<>target_allowance_minutes)
 or (target_allowance_input_unit='days' and target_allowance_input_value*target_hours_per_day_minutes<>target_allowance_minutes)
 then raise exception 'Valid annual leave policy required';end if;
 begin perform make_date(2001,target_leave_year_start_month,target_leave_year_start_day);exception when others then raise exception 'Valid annual leave policy required';end;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces where id=target_workspace_id for update;if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members where workspace_id=target_workspace_id and user_id=initiating_user_id and status='active' and role in ('owner','admin') for share;if not found then raise exception 'Active owner or admin required';end if;
 if target_worker_id is not null then perform 1 from public.scheduling_workers where workspace_id=target_workspace_id and id=target_worker_id for share;if not found then raise exception 'Worker unavailable';end if;end if;
 request_input=pg_catalog.jsonb_build_object('worker_id',target_worker_id,'effective_from_leave_year',target_effective_from_leave_year,'allowance_input_unit',target_allowance_input_unit,'allowance_input_value',target_allowance_input_value,'allowance_minutes',target_allowance_minutes,'hours_per_day_minutes',target_hours_per_day_minutes,'leave_year_start_month',target_leave_year_start_month,'leave_year_start_day',target_leave_year_start_day,'bank_holiday_treatment',target_bank_holiday_treatment,'expected_version',expected_version);
 select * into previous from rev_scheduling_private.annual_leave_policy_requests where request_id=target_request_id;
 if found then if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Annual leave policy request unavailable';end if;return previous.result;end if;
 perform 1 from public.annual_leave_policies where workspace_id=target_workspace_id and worker_id is not distinct from target_worker_id for update;
 select max(version) into current_version from public.annual_leave_policies where workspace_id=target_workspace_id and worker_id is not distinct from target_worker_id;
 if coalesce(current_version,0)<>expected_version then raise exception 'Annual leave policy changed';end if;
 insert into public.annual_leave_policies(workspace_id,worker_id,version,effective_from_leave_year,allowance_input_unit,allowance_input_value,allowance_minutes,hours_per_day_minutes,leave_year_start_month,leave_year_start_day,bank_holiday_treatment,created_by_user_id)
 values(target_workspace_id,target_worker_id,expected_version+1,target_effective_from_leave_year,target_allowance_input_unit,target_allowance_input_value,target_allowance_minutes,target_hours_per_day_minutes,target_leave_year_start_month,target_leave_year_start_day,target_bank_holiday_treatment,initiating_user_id) returning * into saved;
 result=pg_catalog.jsonb_build_object('policy_id',saved.id,'workspace_id',saved.workspace_id,'worker_id',saved.worker_id,'version',saved.version,'effective_from_leave_year',saved.effective_from_leave_year,'allowance_input_unit',saved.allowance_input_unit,'allowance_input_value',saved.allowance_input_value,'allowance_minutes',saved.allowance_minutes,'hours_per_day_minutes',saved.hours_per_day_minutes,'leave_year_start_month',saved.leave_year_start_month,'leave_year_start_day',saved.leave_year_start_day,'bank_holiday_treatment',saved.bank_holiday_treatment);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata) values(target_workspace_id,initiating_user_id,'user','scheduling.annual_leave_policy.saved','annual_leave_policy',saved.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'worker_id',target_worker_id,'previous_version',expected_version,'version',saved.version,'effective_from_leave_year',saved.effective_from_leave_year));
 insert into rev_scheduling_private.annual_leave_policy_requests(request_id,workspace_id,actor_user_id,input,result) values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);return result;
end $$;

create function public.open_rev_annual_leave_account(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_worker_id uuid,target_leave_year_start date,expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare policy public.annual_leave_policies;saved public.annual_leave_accounts;previous rev_scheduling_private.annual_leave_account_requests;request_input jsonb;result jsonb;year_number integer;scope text;
begin
 if target_request_id is null or target_worker_id is null or target_leave_year_start is null or not pg_catalog.isfinite(target_leave_year_start) or expected_version<>0 then raise exception 'Valid annual leave account required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces where id=target_workspace_id for update;if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members where workspace_id=target_workspace_id and user_id=initiating_user_id and status='active' and role in ('owner','admin') for share;if not found then raise exception 'Active owner or admin required';end if;
 perform 1 from public.scheduling_workers where workspace_id=target_workspace_id and id=target_worker_id for share;if not found then raise exception 'Worker unavailable';end if;
 request_input=pg_catalog.jsonb_build_object('worker_id',target_worker_id,'leave_year_start',target_leave_year_start,'expected_version',expected_version);
 select * into previous from rev_scheduling_private.annual_leave_account_requests where request_id=target_request_id;
 if found then if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Annual leave account request unavailable';end if;return previous.result;end if;
 if exists(select 1 from public.annual_leave_accounts where workspace_id=target_workspace_id and worker_id=target_worker_id and leave_year_start=target_leave_year_start) then raise exception 'Annual leave account already exists';end if;
 year_number=extract(year from target_leave_year_start)::integer;
 select p.* into policy from public.annual_leave_policies p where p.workspace_id=target_workspace_id and p.worker_id=target_worker_id and p.effective_from_leave_year<=year_number order by p.effective_from_leave_year desc,p.version desc limit 1;scope='worker';
 if not found then select p.* into policy from public.annual_leave_policies p where p.workspace_id=target_workspace_id and p.worker_id is null and p.effective_from_leave_year<=year_number order by p.effective_from_leave_year desc,p.version desc limit 1;scope='workspace';end if;
 if not found then raise exception 'Annual leave policy unavailable';end if;
 if extract(month from target_leave_year_start)::integer<>policy.leave_year_start_month or extract(day from target_leave_year_start)::integer<>policy.leave_year_start_day then raise exception 'Leave year start does not match policy';end if;
 insert into public.annual_leave_accounts(workspace_id,worker_id,leave_year_start,leave_year_end_exclusive,policy_id,policy_version,policy_scope,effective_from_leave_year,allowance_input_unit,allowance_input_value,configured_allowance_minutes,hours_per_day_minutes,bank_holiday_treatment,created_by_user_id,updated_by_user_id)
 values(target_workspace_id,target_worker_id,target_leave_year_start,(target_leave_year_start+interval '1 year')::date,policy.id,policy.version,scope,policy.effective_from_leave_year,policy.allowance_input_unit,policy.allowance_input_value,policy.allowance_minutes,policy.hours_per_day_minutes,policy.bank_holiday_treatment,initiating_user_id,initiating_user_id) returning * into saved;
 result=pg_catalog.jsonb_build_object('account_id',saved.id,'workspace_id',saved.workspace_id,'worker_id',saved.worker_id,'leave_year_start',saved.leave_year_start,'leave_year_end_exclusive',saved.leave_year_end_exclusive,'policy_id',saved.policy_id,'policy_version',saved.policy_version,'policy_scope',saved.policy_scope,'allowance_input_unit',saved.allowance_input_unit,'allowance_input_value',saved.allowance_input_value,'configured_allowance_minutes',saved.configured_allowance_minutes,'hours_per_day_minutes',saved.hours_per_day_minutes,'bank_holiday_treatment',saved.bank_holiday_treatment,'adjustment_total_minutes',saved.adjustment_total_minutes,'accounting_status',saved.accounting_status,'version',saved.version);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata) values(target_workspace_id,initiating_user_id,'user','scheduling.annual_leave_account.opened','annual_leave_account',saved.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'worker_id',target_worker_id,'leave_year_start',target_leave_year_start,'policy_id',policy.id,'policy_version',policy.version,'accounting_status','policy_only'));
 insert into rev_scheduling_private.annual_leave_account_requests(request_id,workspace_id,actor_user_id,input,result) values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);return result;
end $$;

create function public.save_rev_annual_leave_adjustment(
 target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_account_id uuid,target_adjustment_minutes integer,target_reason text,expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.annual_leave_accounts;saved public.annual_leave_adjustments;previous rev_scheduling_private.annual_leave_adjustment_requests;request_input jsonb;result jsonb;
begin
 if target_request_id is null or target_account_id is null or target_adjustment_minutes is null or target_adjustment_minutes=0 or target_reason is null or length(trim(target_reason)) not between 1 and 500 or target_reason<>trim(target_reason) or expected_version is null or expected_version<1 then raise exception 'Valid annual leave adjustment required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces where id=target_workspace_id for update;if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members where workspace_id=target_workspace_id and user_id=initiating_user_id and status='active' and role in ('owner','admin') for share;if not found then raise exception 'Active owner or admin required';end if;
 request_input=pg_catalog.jsonb_build_object('account_id',target_account_id,'adjustment_minutes',target_adjustment_minutes,'reason',target_reason,'expected_version',expected_version);
 select * into previous from rev_scheduling_private.annual_leave_adjustment_requests where request_id=target_request_id;
 if found then if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Annual leave adjustment request unavailable';end if;return previous.result;end if;
 select * into account from public.annual_leave_accounts where workspace_id=target_workspace_id and id=target_account_id for update;
 if not found or account.version<>expected_version then raise exception 'Annual leave account changed';end if;
 update public.annual_leave_accounts set adjustment_total_minutes=adjustment_total_minutes+target_adjustment_minutes,version=version+1,updated_by_user_id=initiating_user_id,updated_at=now() where workspace_id=target_workspace_id and id=target_account_id returning * into account;
 insert into public.annual_leave_adjustments(workspace_id,account_id,worker_id,leave_year_start,adjustment_minutes,reason,account_version,created_by_user_id)
 values(target_workspace_id,account.id,account.worker_id,account.leave_year_start,target_adjustment_minutes,target_reason,account.version,initiating_user_id) returning * into saved;
 result=pg_catalog.jsonb_build_object('adjustment_id',saved.id,'workspace_id',saved.workspace_id,'account_id',saved.account_id,'worker_id',saved.worker_id,'leave_year_start',saved.leave_year_start,'adjustment_minutes',saved.adjustment_minutes,'reason',saved.reason,'account_version',saved.account_version,'adjustment_total_minutes',account.adjustment_total_minutes,'accounting_status',account.accounting_status);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata) values(target_workspace_id,initiating_user_id,'user','scheduling.annual_leave_adjustment.saved','annual_leave_adjustment',saved.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'account_id',account.id,'worker_id',account.worker_id,'leave_year_start',account.leave_year_start,'adjustment_minutes',saved.adjustment_minutes,'reason',saved.reason,'previous_version',expected_version,'account_version',account.version,'accounting_status','policy_only'));
 insert into rev_scheduling_private.annual_leave_adjustment_requests(request_id,workspace_id,actor_user_id,input,result) values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);return result;
end $$;

revoke all on function public.save_rev_annual_leave_policy(uuid,uuid,uuid,uuid,integer,text,numeric,integer,integer,smallint,smallint,text,bigint) from public,anon,authenticated;
grant execute on function public.save_rev_annual_leave_policy(uuid,uuid,uuid,uuid,integer,text,numeric,integer,integer,smallint,smallint,text,bigint) to service_role;
revoke all on function public.open_rev_annual_leave_account(uuid,uuid,uuid,uuid,date,bigint) from public,anon,authenticated;
grant execute on function public.open_rev_annual_leave_account(uuid,uuid,uuid,uuid,date,bigint) to service_role;
revoke all on function public.save_rev_annual_leave_adjustment(uuid,uuid,uuid,uuid,integer,text,bigint) from public,anon,authenticated;
grant execute on function public.save_rev_annual_leave_adjustment(uuid,uuid,uuid,uuid,integer,text,bigint) to service_role;