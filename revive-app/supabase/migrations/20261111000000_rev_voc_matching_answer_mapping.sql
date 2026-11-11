-- Opportunity review: use supported ordinary answers without exposing arbitrary text,
-- and report answered questions that are not mapped to an opportunity profile field.
-- Read-only with respect to templates, assessments, answers and history.
BEGIN;

CREATE OR REPLACE FUNCTION public.rev_voc_is_matching_safe_question(section_data jsonb, question_data jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT public.rev_voc_is_ordinary_question(section_data, question_data)
    AND pg_catalog.jsonb_typeof(section_data) = 'object'
    AND pg_catalog.jsonb_typeof(question_data) = 'object'
    AND question_data->>'standardField' IN
      ('employment_goal','preferred_sector','skills','qualifications')
    AND question_data->>'type' IN ('single_select','multi_select','short_text','long_text')
    AND (
      question_data->>'type' IN ('short_text','long_text')
      OR pg_catalog.jsonb_typeof(question_data->'options') = 'array'
    )
    AND COALESCE((question_data->>'sensitive')::boolean, true) = false
    AND COALESCE(section_data->>'title','') !~* '(medical|diagnos|disabilit|mental[[:space:]-]*health|safeguard|domestic[[:space:]-]*abuse|ethnic|religio|sexual[[:space:]-]*orient|gender[[:space:]-]*identit|criminal|offen[cs]e|conviction|sentenc|prison|probation|substance[[:space:]-]*misuse|addiction|pregnan|immigration[[:space:]-]*status|nationalit)'
    AND COALESCE(section_data->>'description','') !~* '(medical|diagnos|disabilit|mental[[:space:]-]*health|safeguard|domestic[[:space:]-]*abuse|ethnic|religio|sexual[[:space:]-]*orient|gender[[:space:]-]*identit|criminal|offen[cs]e|conviction|sentenc|prison|probation|substance[[:space:]-]*misuse|addiction|pregnan|immigration[[:space:]-]*status|nationalit)'
    AND COALESCE(question_data->>'label','') !~* '(medical|diagnos|disabilit|mental[[:space:]-]*health|safeguard|domestic[[:space:]-]*abuse|ethnic|religio|sexual[[:space:]-]*orient|gender[[:space:]-]*identit|criminal|offen[cs]e|conviction|sentenc|prison|probation|substance[[:space:]-]*misuse|addiction|pregnan|immigration[[:space:]-]*status|nationalit)'
    AND COALESCE(question_data->>'description','') !~* '(medical|diagnos|disabilit|mental[[:space:]-]*health|safeguard|domestic[[:space:]-]*abuse|ethnic|religio|sexual[[:space:]-]*orient|gender[[:space:]-]*identit|criminal|offen[cs]e|conviction|sentenc|prison|probation|substance[[:space:]-]*misuse|addiction|pregnan|immigration[[:space:]-]*status|nationalit)';
$fn$;
REVOKE ALL ON FUNCTION public.rev_voc_is_matching_safe_question(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rev_voc_is_matching_safe_question(jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.rev_voc_matching_summary(
  target_workspace_id uuid, target_programme_id uuid, target_participant_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  current_version_id uuid;
  v_assessment_id uuid;
  v_assessment_status text;
  sections_snapshot jsonb;
  summary jsonb := pg_catalog.jsonb_build_object(
    'employmentGoals','[]'::jsonb,'preferredSectors','[]'::jsonb,
    'skills','[]'::jsonb,'qualifications','[]'::jsonb,'preferredLocations','[]'::jsonb
  );
  unmapped_questions jsonb := '[]'::jsonb;
  item record;
  field_key text;
  choices jsonb;
  values_to_check jsonb;
  val jsonb;
  choice_text text;
  canonical_value text;
  allowed_value text;
  allowed_values text[];
  question_matched boolean;
  matched_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.rev_voc_assessment_authorised(
    target_workspace_id,target_programme_id,target_participant_id
  ) THEN
    RAISE EXCEPTION 'Not authorised for participant matching' USING ERRCODE='42501';
  END IF;

  SELECT tv.id INTO current_version_id
  FROM public.programme_hub_vocational_template_versions tv
  JOIN public.programme_hub_vocational_templates t
    ON t.id=tv.template_id AND t.workspace_id=tv.workspace_id
  WHERE tv.workspace_id=target_workspace_id
    AND t.programme_id=target_programme_id
    AND t.status='published'
  ORDER BY tv.published_at DESC, tv.id DESC
  LIMIT 1;

  IF current_version_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status','no_published_questionnaire','summary',summary,
      'mappedQuestionCount',0,'unmappedQuestions',unmapped_questions,
      'templateVersionId',NULL,'assessmentId',NULL);
  END IF;

  SELECT aa.id, aa.status INTO v_assessment_id, v_assessment_status
  FROM public.programme_hub_vocational_assessments aa
  WHERE aa.workspace_id=target_workspace_id
    AND aa.programme_id=target_programme_id
    AND aa.participant_id=target_participant_id
    AND aa.template_version_id=current_version_id
    AND aa.status IN ('draft','completed')
  ORDER BY CASE WHEN aa.status='draft' THEN 0 ELSE 1 END,
    aa.updated_at DESC, aa.created_at DESC, aa.id DESC
  LIMIT 1;

  IF v_assessment_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status','reassessment_required','summary',summary,
      'mappedQuestionCount',0,'unmappedQuestions',unmapped_questions,
      'templateVersionId',current_version_id,'assessmentId',NULL);
  END IF;

  IF v_assessment_status='draft' THEN
    RETURN pg_catalog.jsonb_build_object('status','assessment_in_progress','summary',summary,
      'mappedQuestionCount',0,'unmappedQuestions',unmapped_questions,
      'templateVersionId',current_version_id,'assessmentId',v_assessment_id);
  END IF;

  SELECT tv.sections INTO sections_snapshot
  FROM public.programme_hub_vocational_template_versions tv
  WHERE tv.id=current_version_id AND tv.workspace_id=target_workspace_id;
  IF sections_snapshot IS NULL OR pg_catalog.jsonb_typeof(sections_snapshot)<>'array' THEN
    RAISE EXCEPTION 'Assessment snapshot missing or invalid' USING ERRCODE='22023';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('questionId', question_data->>'id', 'label', question_data->>'label')
      ORDER BY section_order, question_order
    ),
    '[]'::jsonb
  ) INTO unmapped_questions
  FROM (
    SELECT sec.section AS section_data, q.question AS question_data,
      sec.section_order, q.question_order
    FROM pg_catalog.jsonb_array_elements(sections_snapshot) WITH ORDINALITY AS sec(section,section_order)
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(sec.section->'questions')='array'
        THEN sec.section->'questions' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS q(question,question_order)
    JOIN public.programme_hub_vocational_assessment_answers ans
      ON ans.assessment_id=v_assessment_id AND ans.question_id=q.question->>'id'
    WHERE public.rev_voc_is_ordinary_question(sec.section,q.question)
      AND ans.answer NOT IN ('null'::jsonb,'""'::jsonb,'[]'::jsonb)
      AND COALESCE(q.question->>'standardField','') NOT IN
        ('employment_goal','preferred_sector','skills','qualifications')
  ) answered_unmapped;

  FOR item IN
    SELECT sec.section AS section_data, q.question AS question_data, ans.answer
    FROM pg_catalog.jsonb_array_elements(sections_snapshot) AS sec(section)
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(sec.section->'questions')='array'
        THEN sec.section->'questions' ELSE '[]'::jsonb END
    ) AS q(question)
    JOIN public.programme_hub_vocational_assessment_answers ans
      ON ans.assessment_id=v_assessment_id AND ans.question_id=q.question->>'id'
    WHERE public.rev_voc_is_matching_safe_question(sec.section,q.question)
  LOOP
    field_key := CASE item.question_data->>'standardField'
      WHEN 'employment_goal' THEN 'employmentGoals'
      WHEN 'preferred_sector' THEN 'preferredSectors'
      WHEN 'skills' THEN 'skills'
      WHEN 'qualifications' THEN 'qualifications'
      ELSE NULL END;
    IF field_key IS NULL THEN CONTINUE; END IF;

    allowed_values := CASE field_key
      WHEN 'employmentGoals' THEN ARRAY[
        'Full-time employment','Part-time employment','Apprenticeship',
        'Traineeship','Self-employment','Work experience'
      ]::text[]
      WHEN 'preferredSectors' THEN ARRAY[
        'Construction','Retail','Warehousing','Logistics','Hospitality',
        'Health and social care','Administration','Customer service',
        'Manufacturing','Transport','Cleaning','Security','IT','Education',
        'Rail','Postal services','Traffic management'
      ]::text[]
      WHEN 'skills' THEN ARRAY[
        'Customer service','Communication','Teamwork','Time management',
        'IT skills','Microsoft Office','Forklift','Warehouse operations',
        'Stock control','Driving','Food preparation','Cleaning',
        'Construction labouring','Traffic management','Administration',
        'Cash handling','Sales','Manual handling'
      ]::text[]
      WHEN 'qualifications' THEN ARRAY[
        'CSCS card','Driving licence','Forklift licence','First aid',
        'Food hygiene','GCSE English','GCSE Maths','Functional Skills English',
        'Functional Skills Maths','SIA licence','NVQ Level 2','NVQ Level 3'
      ]::text[]
      ELSE ARRAY[]::text[] END;

    choices := item.question_data->'options';
    IF item.question_data->>'type'='single_select' THEN
      IF pg_catalog.jsonb_typeof(item.answer)<>'string' THEN CONTINUE; END IF;
      values_to_check := pg_catalog.jsonb_build_array(item.answer);
    ELSIF item.question_data->>'type'='multi_select' THEN
      IF pg_catalog.jsonb_typeof(item.answer)<>'array'
        OR pg_catalog.jsonb_array_length(item.answer)>30 THEN CONTINUE; END IF;
      values_to_check := item.answer;
    ELSE
      IF pg_catalog.jsonb_typeof(item.answer)<>'string'
        OR pg_catalog.length(item.answer #>> '{}')>4000 THEN CONTINUE; END IF;
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(split_value)), '[]'::jsonb)
      INTO values_to_check
      FROM (
        SELECT pg_catalog.btrim(part) AS split_value
        FROM pg_catalog.regexp_split_to_table(item.answer #>> '{}', E'[,;\\n\\r]+') AS parts(part)
        WHERE pg_catalog.btrim(part)<>''
        LIMIT 30
      ) split_values;
    END IF;

    question_matched := false;
    FOR val IN SELECT value FROM pg_catalog.jsonb_array_elements(values_to_check) LOOP
      IF pg_catalog.jsonb_typeof(val)<>'string' THEN CONTINUE; END IF;
      IF item.question_data->>'type' IN ('single_select','multi_select')
        AND NOT (choices @> pg_catalog.jsonb_build_array(val)) THEN CONTINUE; END IF;

      choice_text := pg_catalog.btrim(val #>> '{}');
      canonical_value := NULL;
      FOREACH allowed_value IN ARRAY allowed_values LOOP
        IF pg_catalog.lower(choice_text)=pg_catalog.lower(allowed_value) THEN
          canonical_value := allowed_value;
          EXIT;
        END IF;
      END LOOP;
      IF canonical_value IS NULL THEN CONTINUE; END IF;

      IF NOT (summary->field_key @> pg_catalog.jsonb_build_array(canonical_value)) THEN
        summary := pg_catalog.jsonb_set(
          summary, ARRAY[field_key], (summary->field_key) || pg_catalog.jsonb_build_array(canonical_value)
        );
      END IF;
      question_matched := true;
    END LOOP;
    IF question_matched THEN matched_count := matched_count + 1; END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'status','ready','summary',summary,'mappedQuestionCount',matched_count,
    'unmappedQuestions',unmapped_questions,
    'templateVersionId',current_version_id,'assessmentId',v_assessment_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rev_voc_matching_summary(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rev_voc_matching_summary(uuid,uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rev_voc_matching_summary(uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rev_brain_programme_opportunity_review(
  target_workspace_id uuid, target_programme_id uuid, target_participant_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  profile jsonb;
  vacancy_rows jsonb := '[]'::jsonb;
  total_count integer := 0;
  row_limit constant integer := 200;
BEGIN
  IF auth.uid() IS NULL
    OR NOT public.can_use_rev_module(target_workspace_id, 'programme')
    OR NOT public.rev_voc_assessment_authorised(target_workspace_id, target_programme_id, target_participant_id) THEN
    RAISE EXCEPTION 'Not authorised for participant opportunity review' USING ERRCODE = '42501';
  END IF;

  profile := public.rev_voc_matching_summary(target_workspace_id, target_programme_id, target_participant_id);

  IF profile->>'status' = 'ready' THEN
    SELECT pg_catalog.count(*)::integer INTO total_count
    FROM public.programme_hub_vacancies v
    JOIN public.programme_hub_employers e
      ON e.workspace_id = v.workspace_id AND e.programme_id = v.programme_id AND e.id = v.employer_id
    WHERE v.workspace_id = target_workspace_id AND v.programme_id = target_programme_id
      AND v.active AND e.active;

    SELECT COALESCE(pg_catalog.jsonb_agg(item ORDER BY item->>'title', item->'source'->>'vacancyId'), '[]'::jsonb)
    INTO vacancy_rows
    FROM (
      SELECT pg_catalog.jsonb_build_object(
        'source', pg_catalog.jsonb_build_object(
          'kind', 'programme_vacancy', 'vacancyId', v.id, 'recordVersion', v.version, 'updatedAt', v.updated_at),
        'title', v.title,
        'employerName', e.display_name,
        'employerSector', e.sector_key,
        'workArea', v.work_geography_key,
        'requiredSkills', pg_catalog.to_jsonb(v.required_skill_keys),
        'desiredSkills', pg_catalog.to_jsonb(v.desired_skill_keys)
      ) AS item
      FROM public.programme_hub_vacancies v
      JOIN public.programme_hub_employers e
        ON e.workspace_id = v.workspace_id AND e.programme_id = v.programme_id AND e.id = v.employer_id
      WHERE v.workspace_id = target_workspace_id AND v.programme_id = target_programme_id
        AND v.active AND e.active
      ORDER BY v.title, v.id
      LIMIT row_limit
    ) selected;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', profile->>'status',
    'profileEvidence', pg_catalog.jsonb_build_object(
      'source', 'current_vocational_questionnaire',
      'templateVersionId', profile->'templateVersionId',
      'assessmentId', profile->'assessmentId',
      'mappedQuestionCount', profile->'mappedQuestionCount',
      'unmappedQuestions', profile->'unmappedQuestions',
      'summary', profile->'summary'),
    'opportunities', vacancy_rows,
    'opportunityCount', total_count,
    'truncated', total_count > row_limit
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rev_brain_programme_opportunity_review(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rev_brain_programme_opportunity_review(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rev_brain_programme_opportunity_review(uuid, uuid, uuid) TO authenticated;

COMMIT;
