-- Explicit per-workspace policy. No defaults/backfill or availability activation.
create function rev_calendar_private.valid_working_days(days smallint[])
returns boolean language sql immutable set search_path='' as $$
 select days is not null and coalesce(array_ndims(days)=1,false) and cardinality(days) between 1 and 7
   and not exists(select 1 from unnest(days) d where d is null or d not between 1 and 7)
   and (select count(distinct d) from unnest(days) d)=cardinality(days);
$$;
revoke all on function rev_calendar_private.valid_working_days(smallint[]) from public,anon,authenticated;
grant execute on function rev_calendar_private.valid_working_days(smallint[]) to service_role;

create table public.workspace_calendar_business_hours (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 timezone text not null check(length(trim(timezone)) between 1 and 100),
 working_days smallint[] not null check(rev_calendar_private.valid_working_days(working_days)),
 business_start_local text not null check(business_start_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 business_end_local text not null check(business_end_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 version bigint not null default 1 check(version>=1),
 updated_by_user_id uuid not null,
 updated_at timestamptz not null default now(),
 constraint business_hours_ordered check(business_start_local<business_end_local),
 foreign key(workspace_id,updated_by_user_id) references public.workspace_members(workspace_id,user_id)
);
alter table public.workspace_calendar_business_hours enable row level security;
revoke all on public.workspace_calendar_business_hours from public,anon,authenticated;
grant select on public.workspace_calendar_business_hours to authenticated;
grant select,insert,update,delete on public.workspace_calendar_business_hours to service_role;
create policy business_hours_managers_read on public.workspace_calendar_business_hours for select to authenticated using(public.has_workspace_role(workspace_id,array['owner','admin']));

create function public.save_rev_calendar_business_hours(target_workspace_id uuid,initiating_user_id uuid,target_timezone text,target_working_days smallint[],target_start_local text,target_end_local text,expected_version bigint)
returns table(workspace_id uuid,timezone text,working_days smallint[],business_start_local text,business_end_local text,version bigint)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare current_version bigint; saved public.workspace_calendar_business_hours;
begin
 if expected_version is null or expected_version<0 or not rev_calendar_private.valid_working_days(target_working_days)
   or target_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names t where t.name=target_timezone)
   or target_start_local is null or target_end_local is null
   or target_start_local !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or target_end_local !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or target_start_local>=target_end_local then raise exception 'Valid business hours required'; end if;
 perform 1 from public.workspaces w where w.id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable'; end if;
 perform 1 from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=initiating_user_id and m.status='active' and m.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required'; end if;
 select p.version into current_version from public.workspace_calendar_business_hours p where p.workspace_id=target_workspace_id for update;
 if not found then
   if expected_version<>0 then raise exception 'Business hours changed'; end if;
   insert into public.workspace_calendar_business_hours(workspace_id,timezone,working_days,business_start_local,business_end_local,updated_by_user_id)
     values(target_workspace_id,target_timezone,(select array_agg(d order by d) from unnest(target_working_days) d),target_start_local,target_end_local,initiating_user_id) returning * into saved;
 else
   if expected_version<>current_version then raise exception 'Business hours changed'; end if;
   update public.workspace_calendar_business_hours p set timezone=target_timezone,working_days=(select array_agg(d order by d) from unnest(target_working_days) d),business_start_local=target_start_local,business_end_local=target_end_local,version=p.version+1,updated_by_user_id=initiating_user_id,updated_at=now() where p.workspace_id=target_workspace_id returning p.* into saved;
 end if;
 return query select saved.workspace_id,saved.timezone,saved.working_days,saved.business_start_local,saved.business_end_local,saved.version;
end $$;
revoke all on function public.save_rev_calendar_business_hours(uuid,uuid,text,smallint[],text,text,bigint) from public,anon,authenticated;
grant execute on function public.save_rev_calendar_business_hours(uuid,uuid,text,smallint[],text,text,bigint) to service_role;
