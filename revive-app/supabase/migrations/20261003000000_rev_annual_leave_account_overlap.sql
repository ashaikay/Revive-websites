-- Prevent overlapping frozen worker/year accounts while preserving existing snapshots.
create extension if not exists btree_gist with schema extensions;
set search_path=public,extensions,pg_catalog;

alter table public.annual_leave_accounts
 add constraint annual_leave_accounts_no_overlap
 exclude using gist (
  workspace_id with =,
  worker_id with =,
  daterange(leave_year_start,leave_year_end_exclusive,'[)') with &&
 );

create or replace function public.open_rev_annual_leave_account(
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
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_workspace_id::text||':'||target_worker_id::text,0));
 if exists(select 1 from public.annual_leave_accounts where workspace_id=target_workspace_id and worker_id=target_worker_id and leave_year_start=target_leave_year_start) then raise exception 'Annual leave account already exists';end if;
 year_number=extract(year from target_leave_year_start)::integer;
 select p.* into policy from public.annual_leave_policies p where p.workspace_id=target_workspace_id and p.worker_id=target_worker_id and p.effective_from_leave_year<=year_number order by p.effective_from_leave_year desc,p.version desc limit 1;scope='worker';
 if not found then select p.* into policy from public.annual_leave_policies p where p.workspace_id=target_workspace_id and p.worker_id is null and p.effective_from_leave_year<=year_number order by p.effective_from_leave_year desc,p.version desc limit 1;scope='workspace';end if;
 if not found then raise exception 'Annual leave policy unavailable';end if;
 if extract(month from target_leave_year_start)::integer<>policy.leave_year_start_month or extract(day from target_leave_year_start)::integer<>policy.leave_year_start_day then raise exception 'Leave year start does not match policy';end if;
 if exists(
  select 1 from public.annual_leave_accounts
  where workspace_id=target_workspace_id and worker_id=target_worker_id
   and pg_catalog.daterange(leave_year_start,leave_year_end_exclusive,'[)')&&pg_catalog.daterange(target_leave_year_start,(target_leave_year_start+interval '1 year')::date,'[)')
 ) then raise exception 'Annual leave account overlaps existing year';end if;
 begin
  insert into public.annual_leave_accounts(workspace_id,worker_id,leave_year_start,leave_year_end_exclusive,policy_id,policy_version,policy_scope,effective_from_leave_year,allowance_input_unit,allowance_input_value,configured_allowance_minutes,hours_per_day_minutes,bank_holiday_treatment,created_by_user_id,updated_by_user_id)
  values(target_workspace_id,target_worker_id,target_leave_year_start,(target_leave_year_start+interval '1 year')::date,policy.id,policy.version,scope,policy.effective_from_leave_year,policy.allowance_input_unit,policy.allowance_input_value,policy.allowance_minutes,policy.hours_per_day_minutes,policy.bank_holiday_treatment,initiating_user_id,initiating_user_id) returning * into saved;
 exception when exclusion_violation then raise exception 'Annual leave account overlaps existing year';
 end;
 result=pg_catalog.jsonb_build_object('account_id',saved.id,'workspace_id',saved.workspace_id,'worker_id',saved.worker_id,'leave_year_start',saved.leave_year_start,'leave_year_end_exclusive',saved.leave_year_end_exclusive,'policy_id',saved.policy_id,'policy_version',saved.policy_version,'policy_scope',scope,'allowance_input_unit',saved.allowance_input_unit,'allowance_input_value',saved.allowance_input_value,'configured_allowance_minutes',saved.configured_allowance_minutes,'hours_per_day_minutes',saved.hours_per_day_minutes,'bank_holiday_treatment',saved.bank_holiday_treatment,'adjustment_total_minutes',saved.adjustment_total_minutes,'accounting_status',saved.accounting_status,'version',saved.version);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata) values(target_workspace_id,initiating_user_id,'user','scheduling.annual_leave_account.opened','annual_leave_account',saved.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'worker_id',target_worker_id,'leave_year_start',target_leave_year_start,'policy_id',policy.id,'policy_version',policy.version,'accounting_status','policy_only'));
 insert into rev_scheduling_private.annual_leave_account_requests(request_id,workspace_id,actor_user_id,input,result) values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);return result;
end $$;

revoke all on function public.open_rev_annual_leave_account(uuid,uuid,uuid,uuid,date,bigint) from public,anon,authenticated;
grant execute on function public.open_rev_annual_leave_account(uuid,uuid,uuid,uuid,date,bigint) to service_role;
