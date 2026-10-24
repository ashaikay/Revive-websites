create table rev_scheduling_private.job_import_requests (
  request_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  actor_user_id uuid not null,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, actor_user_id) references public.workspace_members(workspace_id, user_id)
);
revoke all on rev_scheduling_private.job_import_requests from public, anon, authenticated, service_role;

create function public.import_rev_scheduling_jobs(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_batch_request_id uuid,
  target_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous rev_scheduling_private.job_import_requests;
  row_data jsonb;
  saved jsonb;
  saved_jobs jsonb = '[]'::jsonb;
  result jsonb;
begin
  if target_workspace_id is null or initiating_user_id is null or target_batch_request_id is null
    or jsonb_typeof(target_rows) <> 'array'
    or jsonb_array_length(target_rows) not between 1 and 100
  then
    raise exception 'Valid job import required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_batch_request_id::text, 0));
  perform 1 from public.workspaces workspace where workspace.id = target_workspace_id for update;
  if not found then raise exception 'Workspace unavailable'; end if;

  select request.* into previous
  from rev_scheduling_private.job_import_requests request
  where request.request_id = target_batch_request_id;
  if found then
    if previous.workspace_id <> target_workspace_id
      or previous.actor_user_id <> initiating_user_id
      or previous.input <> target_rows
    then
      raise exception 'Job import request unavailable';
    end if;
    return previous.result;
  end if;

  perform 1
  from public.workspace_members member
  where member.workspace_id = target_workspace_id
    and member.user_id = initiating_user_id
    and member.status = 'active'
    and member.role in ('owner', 'admin');
  if not found then raise exception 'Active owner or admin required'; end if;

  if exists (
    select 1
    from jsonb_array_elements(target_rows) row_value
    group by row_value->>'title', row_value->>'start_at', row_value->>'end_at', row_value->>'location'
    having count(*) > 1
  ) then
    raise exception 'Imported job duplicates existing record';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_rows) row_value
    join public.scheduling_jobs job
      on job.workspace_id = target_workspace_id
      and job.title = row_value->>'title'
      and job.start_at = (row_value->>'start_at')::timestamptz
      and job.end_at = (row_value->>'end_at')::timestamptz
      and job.location = row_value->>'location'
  ) then
    raise exception 'Imported job duplicates existing record';
  end if;

  for row_data in select value from jsonb_array_elements(target_rows)
  loop
    if jsonb_typeof(row_data) <> 'object'
      or (select array_agg(key order by key) from jsonb_object_keys(row_data) as keys(key)) <>
        array['end_at','location','request_id','required_skills','skill_requirement_mode','staffing_count','start_at','timezone','title']
    then
      raise exception 'Valid imported job required';
    end if;
    saved = public.save_rev_scheduling_job(
      target_workspace_id,
      initiating_user_id,
      (row_data->>'request_id')::uuid,
      null,
      row_data->>'title',
      (row_data->>'start_at')::timestamptz,
      (row_data->>'end_at')::timestamptz,
      row_data->>'timezone',
      row_data->>'location',
      array(select jsonb_array_elements_text(row_data->'required_skills')),
      (row_data->>'staffing_count')::integer,
      'open',
      0,
      row_data->>'skill_requirement_mode'
    );
    saved_jobs = saved_jobs || pg_catalog.jsonb_build_array(saved);
  end loop;

  result = pg_catalog.jsonb_build_object(
    'batch_request_id', target_batch_request_id,
    'workspace_id', target_workspace_id,
    'saved_count', jsonb_array_length(saved_jobs),
    'jobs', saved_jobs
  );

  insert into rev_scheduling_private.job_import_requests (
    request_id, workspace_id, actor_user_id, input, result
  ) values (
    target_batch_request_id, target_workspace_id, initiating_user_id, target_rows, result
  );

  return result;
end;
$$;

revoke all on function public.import_rev_scheduling_jobs(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_rev_scheduling_jobs(uuid, uuid, uuid, jsonb)
  to service_role;
