-- Apply together with 20261019010000_rev_vocational_templates.sql.
begin;

-- Published snapshots are inserted only through the checked publish function.
-- Existing immutable UPDATE/DELETE trigger remains in place.
create or replace function public.rev_vocational_validate_sections(p_sections jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare s jsonb; q jsonb; sid text; qid text; seen_sections text[] := '{}'; seen_questions text[] := '{}'; field_type text;
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) > 40 then return false; end if;
  for s in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(s->'id') is distinct from 'string' or jsonb_typeof(s->'title') is distinct from 'string'
      or length(btrim(s->>'title')) not between 1 and 160 or jsonb_typeof(s->'questions') is distinct from 'array'
      or jsonb_array_length(s->'questions') > 100 then return false; end if;
    sid := s->>'id';
    if length(sid) not between 1 and 120 or sid = any(seen_sections) then return false; end if;
    seen_sections := array_append(seen_sections,sid);
    for q in select value from jsonb_array_elements(s->'questions') loop
      if jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(q->'id') is distinct from 'string'
        or jsonb_typeof(q->'label') is distinct from 'string' or length(btrim(q->>'label')) not between 1 and 240
        or jsonb_typeof(q->'required') is distinct from 'boolean' or jsonb_typeof(q->'sensitive') is distinct from 'boolean'
        or q->>'sectionId' is distinct from sid then return false; end if;
      qid := q->>'id'; field_type := q->>'type';
      if length(qid) not between 1 and 120 or qid = any(seen_questions) or field_type is null or field_type not in
        ('short_text','long_text','number','date','single_select','multi_select','checkbox','yes_no_prefer_not') then return false; end if;
      seen_questions := array_append(seen_questions,qid);
      if field_type in ('single_select','multi_select') and
        (jsonb_typeof(q->'options') is distinct from 'array' or jsonb_array_length(q->'options') = 0
         or jsonb_array_length(q->'options') > 100) then return false; end if;
       if field_type in ('single_select','multi_select') then
         if exists (select 1 from jsonb_array_elements(q->'options') opt
                    where jsonb_typeof(opt.value) is distinct from 'string'
                       or length(btrim(opt.value #>> '{}')) not between 1 and 160) then return false; end if;
       end if;
      if q ? 'standardField' and q->'standardField' <> 'null'::jsonb and q->>'standardField' not in
        ('employment_goal','preferred_sector','skills','qualifications','work_history','availability','travel_radius','employment_status') then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;

-- Enforce insert validity even if a privileged backend attempts a direct insert.
create or replace function public.rev_vocational_version_insert_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare t public.programme_hub_vocational_templates;
begin
  select * into t from public.programme_hub_vocational_templates
   where workspace_id = new.workspace_id and id = new.template_id for update;
  if not found or t.status <> 'draft' or new.version <> t.version
    or new.title is distinct from t.title or new.sections is distinct from t.sections
    or not public.rev_vocational_validate_sections(new.sections)
    or new.published_by_user_id is distinct from t.updated_by_user_id then
    raise exception 'Invalid vocational publication snapshot' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger rev_vocational_version_insert_guard
before insert on public.programme_hub_vocational_template_versions
for each row execute function public.rev_vocational_version_insert_guard();

-- A dedicated ledger avoids assuming the allowed operation values in REV's existing ledger.
create table public.rev_vocational_write_requests (
  request_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  actor_user_id uuid not null,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id,actor_user_id)
    references public.workspace_members(workspace_id,user_id)
);
alter table public.rev_vocational_write_requests enable row level security;
revoke all on public.rev_vocational_write_requests from public,anon,authenticated;
grant all on public.rev_vocational_write_requests to service_role;

-- Database writes are performed only by these authenticated, actor-bound RPCs.
create or replace function public.save_rev_vocational_template(
  target_workspace_id uuid, target_request_id uuid, target_template_id uuid,
  expected_version bigint, target_programme_id uuid, target_title text,
  target_description text, target_sections jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); t public.programme_hub_vocational_templates; result_value jsonb;
begin
  if actor is null or target_workspace_id is null or target_request_id is null
    or not public.has_workspace_role(target_workspace_id,array['owner','admin'])
    or not public.can_use_rev_module(target_workspace_id,'programme') then
    raise exception 'Programme manager required' using errcode = '42501';
  end if;
  if expected_version is null or expected_version < 0 or target_title is null
    or length(target_title) not between 1 and 160 or target_title <> btrim(target_title)
    or length(coalesce(target_description,'')) > 2000
    or not public.rev_vocational_validate_sections(target_sections) then
    raise exception 'Invalid vocational template' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
  perform 1 from public.workspaces where id = target_workspace_id and status = 'active' for update;
  if not found then raise exception 'Workspace unavailable' using errcode = '42501'; end if;
  if target_programme_id is not null then
    perform 1 from public.programme_hub_programmes
     where workspace_id = target_workspace_id and id = target_programme_id and active for share;
    if not found then raise exception 'Programme unavailable' using errcode = '42501'; end if;
  end if;
  select result into result_value from public.rev_vocational_write_requests
    where request_id = target_request_id and workspace_id = target_workspace_id
      and actor_user_id = actor and input = jsonb_build_object(
        'templateId',target_template_id,'expectedVersion',expected_version,
        'programmeId',target_programme_id,'title',target_title,
        'description',coalesce(target_description,''),'sections',target_sections);
  if found then return result_value; end if;
  if exists(select 1 from public.rev_vocational_write_requests where request_id = target_request_id) then
    raise exception 'Request ID already used' using errcode = '40001';
  end if;
  if target_template_id is null then
    if expected_version <> 0 then raise exception 'Expected version must be zero' using errcode='40001'; end if;
    insert into public.programme_hub_vocational_templates
      (workspace_id,programme_id,title,description,sections,created_by_user_id,updated_by_user_id)
    values (target_workspace_id,target_programme_id,target_title,coalesce(target_description,''),target_sections,actor,actor)
    returning * into t;
  else
    select * into t from public.programme_hub_vocational_templates
     where workspace_id = target_workspace_id and id = target_template_id for update;
    if not found or t.version <> expected_version or t.status <> 'draft'
      or t.programme_id is distinct from target_programme_id then
      raise exception 'Template unavailable, published or changed' using errcode='40001';
    end if;
    update public.programme_hub_vocational_templates set title = target_title,
      description = coalesce(target_description,''), sections = target_sections,
      version = version + 1, updated_by_user_id = actor, updated_at = now()
    where workspace_id = target_workspace_id and id = target_template_id returning * into t;
  end if;
  result_value := jsonb_build_object('id',t.id,'workspaceId',t.workspace_id,
    'programmeId',t.programme_id,'version',t.version,'status',t.status);
  insert into public.rev_vocational_write_requests
    (request_id,workspace_id,actor_user_id,input,result)
  values (target_request_id,target_workspace_id,actor,
    jsonb_build_object('templateId',target_template_id,'expectedVersion',expected_version,
      'programmeId',target_programme_id,'title',target_title,'description',coalesce(target_description,''),'sections',target_sections),result_value);
  return result_value;
end;
$$;

create or replace function public.publish_rev_vocational_template(
  target_workspace_id uuid, target_template_id uuid, expected_version bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); t public.programme_hub_vocational_templates; result_value jsonb;
begin
  if actor is null or not public.has_workspace_role(target_workspace_id,array['owner','admin'])
    or not public.can_use_rev_module(target_workspace_id,'programme') then
    raise exception 'Programme manager required' using errcode='42501';
  end if;
  select * into t from public.programme_hub_vocational_templates
    where workspace_id = target_workspace_id and id = target_template_id for update;
  if not found or t.status <> 'draft' or t.version <> expected_version
    or not public.rev_vocational_validate_sections(t.sections) then
    raise exception 'Template unavailable, invalid or changed' using errcode='40001';
  end if;
  if t.programme_id is not null and not exists (
    select 1 from public.programme_hub_programmes
    where workspace_id = target_workspace_id and id = t.programme_id and active
  ) then raise exception 'Programme unavailable' using errcode='42501'; end if;
  -- The snapshot trigger verifies exact agreement with the locked draft.
  update public.programme_hub_vocational_templates
    set updated_by_user_id = actor, updated_at = now()
    where workspace_id = target_workspace_id and id = target_template_id;
  insert into public.programme_hub_vocational_template_versions
    (workspace_id,template_id,version,title,sections,published_by_user_id)
  values (target_workspace_id,target_template_id,t.version,t.title,t.sections,actor);
  update public.programme_hub_vocational_templates set status = 'published', published_at = now(),
    updated_by_user_id = actor, updated_at = now()
    where workspace_id = target_workspace_id and id = target_template_id;
  result_value := jsonb_build_object('id',target_template_id,'version',t.version,'status','published');
  return result_value;
end;
$$;

revoke all on function public.rev_vocational_validate_sections(jsonb),
  public.rev_vocational_version_insert_guard(),
  public.save_rev_vocational_template(uuid,uuid,uuid,bigint,uuid,text,text,jsonb),
  public.publish_rev_vocational_template(uuid,uuid,bigint) from public,anon;
grant execute on function public.save_rev_vocational_template(uuid,uuid,uuid,bigint,uuid,text,text,jsonb),
  public.publish_rev_vocational_template(uuid,uuid,bigint) to authenticated;

commit;
