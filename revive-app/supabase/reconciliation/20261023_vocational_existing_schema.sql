-- Target: ntbowgutwyyhhnmkadlv, reviewed hosted export supplied 23 October 2026.
-- Manual reconciliation, NOT an automatically applied migration.
-- No rows, tables, policies, triggers or migration history are changed.
-- Retains existing service_role EXECUTE grants; removes excess client helper grants.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $guard$
begin
  if md5(pg_get_functiondef('public.rev_vocational_validate_sections(jsonb)'::regprocedure)) is distinct from '2e97cf654052b73f7654f5aeaf433d11' then
    raise exception 'Hosted definition changed: rev_vocational_validate_sections(jsonb). Stop and recompare.';
  end if;
  if md5(pg_get_functiondef('public.rev_vocational_version_insert_guard()'::regprocedure)) is distinct from '4510446dacdc80a03f6208b0a32b709e' then
    raise exception 'Hosted definition changed: rev_vocational_version_insert_guard(). Stop and recompare.';
  end if;
end;
$guard$;

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

revoke all on function public.rev_vocational_validate_sections(jsonb)
from public, anon, authenticated;
revoke all on function public.rev_vocational_version_insert_guard()
from public, anon, authenticated;
commit;
