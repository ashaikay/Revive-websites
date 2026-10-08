-- Skill matching ignores ASCII capitalisation, surrounding whitespace and repeated whitespace.
-- Saved labels are unchanged; only the allocation comparison uses the canonical key.
-- Whole-tag equality only: no substring, prefix or fuzzy matching.
-- Mirrors skillKey() in src/services/skillMatching.ts; keep both definitions identical.
create function rev_scheduling_private.skill_key(tag text)
returns text language sql immutable strict set search_path='' as $$
 select pg_catalog.translate(
  pg_catalog.btrim(pg_catalog.regexp_replace(tag,'['||pg_catalog.chr(32)||pg_catalog.chr(9)||pg_catalog.chr(10)||pg_catalog.chr(11)||pg_catalog.chr(12)||pg_catalog.chr(13)||']+',' ','g'),' '),
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
$$;
revoke all on function rev_scheduling_private.skill_key(text) from public,anon,authenticated,service_role;

create function rev_scheduling_private.skills_cover(required text[],held text[])
returns boolean language sql immutable set search_path='' as $$
 select not exists(
  select 1 from pg_catalog.unnest(coalesce(required,'{}'::text[])) r
  where not exists(select 1 from pg_catalog.unnest(coalesce(held,'{}'::text[])) h where rev_scheduling_private.skill_key(h)=rev_scheduling_private.skill_key(r)));
$$;
revoke all on function rev_scheduling_private.skills_cover(text[],text[]) from public,anon,authenticated,service_role;

-- Same guards as 20260930090000; only the skill comparison changes.
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
 if not rev_scheduling_private.skills_cover(job.required_skills,worker.skill_tags) then raise exception 'Required skills missing';end if;
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
  if exists(select 1 from public.scheduling_assignments a join public.scheduling_jobs j on j.workspace_id=a.workspace_id and j.id=a.job_id where a.workspace_id=new.workspace_id and a.worker_id=new.id and a.status='active' and (not new.active or not rev_scheduling_private.skills_cover(j.required_skills,new.skill_tags))) then raise exception 'Cancel affected assignments before changing worker';end if;
 elsif tg_table_name='scheduling_worker_patterns' then
  if tg_op='UPDATE' and new.worker_id<>old.worker_id then raise exception 'Worker identity cannot change';end if;
  if exists(select 1 from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.worker_id=new.worker_id and a.status='active' and not rev_scheduling_private.pattern_covers(new.timezone,new.working_days,new.start_local,new.end_local,new.effective_from,new.effective_until,a.start_at,a.end_at)) then raise exception 'Cancel affected assignments before changing availability';end if;
 elsif tg_table_name='scheduling_worker_unavailability' then
  if tg_op='UPDATE' and new.worker_id<>old.worker_id then raise exception 'Worker identity cannot change';end if;
  if new.status='active' and exists(select 1 from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.worker_id=new.worker_id and a.status='active' and a.start_at<new.end_at and new.start_at<a.end_at) then raise exception 'Cancel affected assignments before adding unavailability';end if;
 elsif tg_table_name='scheduling_jobs' then
  if exists(select 1 from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.job_id=new.id and a.status='active') then
   if new.status<>'open' or new.start_at<>old.start_at or new.end_at<>old.end_at or new.timezone<>old.timezone or new.location<>old.location or new.required_skills<>old.required_skills or new.staffing_count<(select count(*) from public.scheduling_assignments a where a.workspace_id=new.workspace_id and a.job_id=new.id and a.status='active') then raise exception 'Cancel affected assignments before changing job';end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function rev_scheduling_private.guard_scheduling_change() from public,anon,authenticated,service_role;
