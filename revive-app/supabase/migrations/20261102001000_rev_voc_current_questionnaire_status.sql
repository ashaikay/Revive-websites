BEGIN;

CREATE OR REPLACE FUNCTION public.rev_voc_assessment_status(
  target_workspace_id uuid, target_programme_id uuid, target_participant_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  a public.programme_hub_vocational_assessments%ROWTYPE;
  v public.programme_hub_vocational_template_versions%ROWTYPE;
  earlier_completion jsonb;
  total_count integer := 0;
  answered_count integer := 0;
BEGIN
  IF NOT public.rev_voc_assessment_authorised(
    target_workspace_id, target_programme_id, target_participant_id
  ) THEN
    RAISE EXCEPTION 'Not authorised for participant assessment' USING ERRCODE='42501';
  END IF;

  -- Match the form's current questionnaire, even before an assessment is opened.
  SELECT tv.* INTO v
  FROM public.programme_hub_vocational_template_versions tv
  JOIN public.programme_hub_vocational_templates t
    ON t.id = tv.template_id AND t.workspace_id = tv.workspace_id
  WHERE tv.workspace_id = target_workspace_id
    AND t.programme_id = target_programme_id
    AND t.status = 'published'
  ORDER BY tv.published_at DESC, tv.id DESC
  LIMIT 1;

  SELECT pg_catalog.jsonb_build_object(
    'assessmentId', aa.id, 'templateVersionId', tv.id,
    'questionnaireTitle', tv.title, 'questionnaireVersion', tv.version,
    'completedAt', aa.completed_at
  ) INTO earlier_completion
  FROM public.programme_hub_vocational_assessments aa
  JOIN public.programme_hub_vocational_template_versions tv
    ON tv.id = aa.template_version_id AND tv.workspace_id = aa.workspace_id
  JOIN public.programme_hub_vocational_templates t
    ON t.id = tv.template_id AND t.workspace_id = tv.workspace_id
  WHERE aa.workspace_id = target_workspace_id
    AND aa.programme_id = target_programme_id
    AND aa.participant_id = target_participant_id
    AND aa.status = 'completed'
    AND (t.programme_id = target_programme_id OR t.programme_id IS NULL)
    AND tv.id IS DISTINCT FROM v.id
  ORDER BY aa.completed_at DESC, aa.id DESC
  LIMIT 1;

  IF v.id IS NOT NULL THEN
    SELECT aa.* INTO a
    FROM public.programme_hub_vocational_assessments aa
    WHERE aa.workspace_id = target_workspace_id
      AND aa.programme_id = target_programme_id
      AND aa.participant_id = target_participant_id
      AND aa.template_version_id = v.id
      AND aa.status IN ('draft', 'completed')
    ORDER BY CASE WHEN aa.status = 'draft' THEN 0 ELSE 1 END,
      aa.updated_at DESC, aa.created_at DESC, aa.id DESC
    LIMIT 1;

    SELECT count(*)::integer, count(ans.question_id)::integer
    INTO total_count, answered_count
    FROM pg_catalog.jsonb_array_elements(v.sections) AS s(section)
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(s.section->'questions') = 'array'
        THEN s.section->'questions' ELSE '[]'::jsonb END
    ) AS q(question)
    LEFT JOIN public.programme_hub_vocational_assessment_answers ans
      ON ans.assessment_id = a.id
      AND ans.question_id = q.question->>'id'
      AND ans.answer <> 'null'::jsonb
      AND ans.answer <> '""'::jsonb
      AND ans.answer <> '[]'::jsonb
    WHERE public.rev_voc_is_ordinary_question(s.section, q.question);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', CASE WHEN a.id IS NULL THEN 'not_started'
      WHEN a.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
    'answered', answered_count, 'total', total_count,
    'assessmentId', a.id, 'templateVersionId', v.id, 'version', a.version,
    'updatedAt', a.updated_at, 'completedAt', a.completed_at,
    'updatedByUserId', a.updated_by_user_id,
    'questionnaire', CASE WHEN v.id IS NULL THEN NULL ELSE
      pg_catalog.jsonb_build_object('templateVersionId', v.id, 'title', v.title, 'version', v.version) END,
    'earlierCompletedAssessment', earlier_completion
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rev_voc_assessment_status(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rev_voc_assessment_status(uuid,uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.rev_voc_assessment_draft(
  target_workspace_id uuid, target_programme_id uuid, target_participant_id uuid,
  target_template_version_id uuid, target_action text DEFAULT 'open',
  target_assessment_id uuid DEFAULT NULL, expected_version bigint DEFAULT NULL,
  target_answers jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $_$
declare
  actor uuid := auth.uid();
  v record; a public.programme_hub_vocational_assessments%rowtype;
  s jsonb; q jsonb; key text; val jsonb; qtype text; opts jsonb;
  permitted jsonb := '{}'::jsonb; found_question boolean; blocked boolean;
  ids text[] := '{}';
begin
  if actor is null or not public.rev_voc_assessment_authorised(target_workspace_id,target_programme_id,target_participant_id)
  then raise exception 'Not authorised for participant assessment' using errcode='42501'; end if;
  if target_action not in ('open','save') then raise exception 'Unsupported action' using errcode='22023'; end if;
  select v0.id,v0.sections into v
  from public.programme_hub_vocational_template_versions v0
  join public.programme_hub_vocational_templates t
    on t.id=v0.template_id and t.workspace_id=v0.workspace_id
  where v0.id=target_template_version_id and v0.workspace_id=target_workspace_id
    and (t.programme_id=target_programme_id or t.programme_id is null)
    and t.status in ('published','archived');
  if not found then raise exception 'Published questionnaire version not found' using errcode='22023'; end if;

  if target_action='open' and target_assessment_id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      target_workspace_id::text || ':' || target_participant_id::text || ':' || target_template_version_id::text,0));
    -- Reopening a completed snapshot must not create an empty replacement draft.
    select * into a from public.programme_hub_vocational_assessments
      where workspace_id=target_workspace_id and programme_id=target_programme_id
        and participant_id=target_participant_id and template_version_id=target_template_version_id
        and status in ('draft','completed')
      order by case when status='draft' then 0 else 1 end,
        updated_at desc,created_at desc,id desc limit 1 for update;
    if not found then
      insert into public.programme_hub_vocational_assessments
        (workspace_id,programme_id,participant_id,template_version_id,created_by_user_id,updated_by_user_id)
      values (target_workspace_id,target_programme_id,target_participant_id,target_template_version_id,actor,actor)
      returning * into a;
      insert into public.programme_hub_vocational_assessment_audit(workspace_id,assessment_id,actor_user_id,action)
      values (target_workspace_id,a.id,actor,'created');
    end if;
  else
    if target_assessment_id is null then raise exception 'Assessment id required' using errcode='22023'; end if;
    select * into a from public.programme_hub_vocational_assessments
      where id=target_assessment_id and workspace_id=target_workspace_id
        and programme_id=target_programme_id and participant_id=target_participant_id
        and template_version_id=target_template_version_id for update;
    if not found then raise exception 'Assessment not found' using errcode='22023'; end if;
  end if;

  if target_action='save' then
    if a.status <> 'draft' then raise exception 'Assessment is not editable' using errcode='22023'; end if;
    if expected_version is null or expected_version <> a.version then
      raise exception 'Assessment changed; reload before saving' using errcode='40001'; end if;
    if target_answers is null or pg_catalog.jsonb_typeof(target_answers)<>'object'
      or (select count(*) from pg_catalog.jsonb_object_keys(target_answers))>200 then
      raise exception 'Invalid answer payload' using errcode='22023'; end if;
    for key,val in select * from pg_catalog.jsonb_each(target_answers) loop
      found_question := false; blocked := false;
      for s in select value from pg_catalog.jsonb_array_elements(v.sections) loop
        for q in select value from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(s->'questions')='array' then s->'questions' else '[]'::jsonb end
        ) loop
          if q->>'id'=key then
            found_question := true;
            blocked := NOT public.rev_voc_is_ordinary_question(s,q);
            qtype := q->>'type'; opts := q->'options';
            exit;
          end if;
        end loop;
        exit when found_question;
      end loop;
      if not found_question or blocked then raise exception 'Question unavailable for ordinary assessment' using errcode='42501'; end if;
      if val <> 'null'::jsonb then
        if qtype in ('short_text','long_text','date','single_select','yes_no_prefer_not') then
          if pg_catalog.jsonb_typeof(val)<>'string' or length(val #>> '{}')>4000 then
            raise exception 'Invalid text answer' using errcode='22023'; end if;
          if qtype='short_text' and length(val #>> '{}')>500 then raise exception 'Answer too long' using errcode='22023'; end if;
          if qtype='date' and (val #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date' using errcode='22023'; end if;
          if qtype='single_select' and not opts @> pg_catalog.jsonb_build_array(val) then raise exception 'Invalid selection' using errcode='22023'; end if;
          if qtype='yes_no_prefer_not' and (val #>> '{}') not in ('yes','no','prefer_not_to_say') then raise exception 'Invalid choice' using errcode='22023'; end if;
        elsif qtype='number' then
          if pg_catalog.jsonb_typeof(val)<>'number' then raise exception 'Invalid number' using errcode='22023'; end if;
        elsif qtype='checkbox' then
          if pg_catalog.jsonb_typeof(val)<>'boolean' then raise exception 'Invalid checkbox' using errcode='22023'; end if;
        elsif qtype='multi_select' then
          if pg_catalog.jsonb_typeof(val)<>'array' or pg_catalog.jsonb_array_length(val)>100
            or exists (select 1 from pg_catalog.jsonb_array_elements(val) x where not opts @> pg_catalog.jsonb_build_array(x.value))
          then raise exception 'Invalid multi-selection' using errcode='22023'; end if;
        else raise exception 'Unsupported question type' using errcode='22023'; end if;
      end if;
      ids := pg_catalog.array_append(ids,key);
      if val='null'::jsonb then
        delete from public.programme_hub_vocational_assessment_answers where assessment_id=a.id and question_id=key;
      else
        insert into public.programme_hub_vocational_assessment_answers(assessment_id,question_id,answer)
        values(a.id,key,val)
        on conflict (assessment_id,question_id) do update set answer=excluded.answer,updated_at=now();
      end if;
    end loop;
    update public.programme_hub_vocational_assessments
      set version=version+1,updated_by_user_id=actor,updated_at=now()
      where id=a.id returning * into a;
    insert into public.programme_hub_vocational_assessment_audit(workspace_id,assessment_id,actor_user_id,action,changed_question_ids)
      values(target_workspace_id,a.id,actor,'saved',ids);
  end if;
  insert into public.programme_hub_vocational_assessment_audit(workspace_id,assessment_id,actor_user_id,action)
    values(target_workspace_id,a.id,actor,'read');
  SELECT coalesce(pg_catalog.jsonb_object_agg(ans.question_id,ans.answer),'{}'::jsonb)
    INTO permitted
  FROM pg_catalog.jsonb_array_elements(v.sections) AS sec(section)
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
    CASE WHEN pg_catalog.jsonb_typeof(sec.section->'questions')='array'
      THEN sec.section->'questions' ELSE '[]'::jsonb END
  ) AS item(question)
  JOIN public.programme_hub_vocational_assessment_answers ans
    ON ans.assessment_id=a.id AND ans.question_id=item.question->>'id'
  WHERE public.rev_voc_is_ordinary_question(sec.section,item.question);
  return pg_catalog.jsonb_build_object('assessmentId',a.id,'version',a.version,'status',a.status,'answers',permitted);
end;
$_$;

COMMIT;
