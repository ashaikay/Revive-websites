-- REV Stage 3B3. LOCAL ONLY pending full integration/security testing and remote migration reconciliation.
BEGIN;
-- Stage 3B3: fail-closed matching-only classification. Does not change assessment UI or records.
-- Section descriptions and question descriptions are checked as well as titles/labels.
CREATE OR REPLACE FUNCTION public.rev_voc_is_matching_safe_question(section_data jsonb, question_data jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT public.rev_voc_is_ordinary_question(section_data, question_data)
    AND pg_catalog.jsonb_typeof(section_data) = 'object'
    AND pg_catalog.jsonb_typeof(question_data) = 'object'
    AND question_data->>'standardField' IN
      ('employment_goal','preferred_sector','skills','qualifications')
    AND question_data->>'type' IN ('single_select','multi_select')
    AND pg_catalog.jsonb_typeof(question_data->'options') = 'array'
    AND COALESCE((question_data->>'sensitive')::boolean, true) = false
    AND COALESCE(section_data->>'title','') !~* '(medical|diagnos|disabilit|mental[[:space:]-]*health|safeguard|domestic[[:space:]-]*abuse|ethnic|religio|sexual[[:space:]-]*orient|gender[[:space:]-]*identit|criminal|offen[cs]e|conviction|sentenc|prison|probation|substance[[:space:]-]*misuse|addiction|pregnan|immigration[[:space:]-]*status|nationalit)'
    AND COALESCE(section_data->>'description','') !~* '(medical|diagnos|disabilit|mental[[:space:]-]*health|safeguard|domestic[[:space:]-]*abuse|ethnic|religio|sexual[[:space:]-]*orient|gender[[:space:]-]*identit|criminal|offen[cs]e|conviction|sentenc|prison|probation|substance[[:space:]-]*misuse|addiction|pregnan|immigration[[:space:]-]*status|nationalit)'
    AND COALESCE(question_data->>'label','') !~* '(medical|diagnos|disabilit|mental[[:space:]-]*health|safeguard|domestic[[:space:]-]*abuse|ethnic|religio|sexual[[:space:]-]*orient|gender[[:space:]-]*identit|criminal|offen[cs]e|conviction|sentenc|prison|probation|substance[[:space:]-]*misuse|addiction|pregnan|immigration[[:space:]-]*status|nationalit)'
    AND COALESCE(question_data->>'description','') !~* '(medical|diagnos|disabilit|mental[[:space:]-]*health|safeguard|domestic[[:space:]-]*abuse|ethnic|religio|sexual[[:space:]-]*orient|gender[[:space:]-]*identit|criminal|offen[cs]e|conviction|sentenc|prison|probation|substance[[:space:]-]*misuse|addiction|pregnan|immigration[[:space:]-]*status|nationalit)';
$fn$;
REVOKE ALL ON FUNCTION public.rev_voc_is_matching_safe_question(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rev_voc_is_matching_safe_question(jsonb,jsonb) TO service_role;

-- REV Stage 3B1 hardened (pre-deployment replacement).
-- Replaces only the not-yet-deployed local Stage 3B1 migration.
-- Explicit allowlist: no arbitrary publisher-defined choices reach REV Brain.
-- If a custom choice is not recognised, map it to an approved canonical choice in a later version.
CREATE OR REPLACE FUNCTION public.rev_voc_matching_summary(
  target_workspace_id uuid, target_programme_id uuid, target_participant_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  current_version_id uuid;
  assessment_id uuid;
  sections_snapshot jsonb;
  summary jsonb := pg_catalog.jsonb_build_object(
    'employmentGoals','[]'::jsonb,'preferredSectors','[]'::jsonb,
    'skills','[]'::jsonb,'qualifications','[]'::jsonb,'preferredLocations','[]'::jsonb
  );
  item record;
  field_key text;
  choices jsonb;
  values_to_check jsonb;
  val jsonb;
  choice_text text;
  allowed_values text[];
  matched_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.rev_voc_assessment_authorised(
    target_workspace_id,target_programme_id,target_participant_id
  ) THEN
    RAISE EXCEPTION 'Not authorised for participant matching' USING ERRCODE='42501';
  END IF;

  -- Select the newest currently published questionnaire snapshot applicable to this programme.
  -- Do NOT fall back to an older completed assessment.
  SELECT tv.id INTO current_version_id
  FROM public.programme_hub_vocational_template_versions tv
  JOIN public.programme_hub_vocational_templates t
    ON t.id=tv.template_id AND t.workspace_id=tv.workspace_id
  WHERE tv.workspace_id=target_workspace_id
    AND t.status='published'
    AND (t.programme_id=target_programme_id OR t.programme_id IS NULL)
  ORDER BY t.published_at DESC NULLS LAST, tv.version DESC, tv.id DESC
  LIMIT 1;

  IF current_version_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status','no_published_questionnaire','summary',summary,'mappedQuestionCount',0);
  END IF;

  SELECT aa.id INTO assessment_id
  FROM public.programme_hub_vocational_assessments aa
  WHERE aa.workspace_id=target_workspace_id
    AND aa.programme_id=target_programme_id
    AND aa.participant_id=target_participant_id
    AND aa.template_version_id=current_version_id
    AND aa.status='completed'
  ORDER BY aa.updated_at DESC, aa.id DESC LIMIT 1;

  IF assessment_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status','reassessment_required','summary',summary,'mappedQuestionCount',0);
  END IF;

  SELECT tv.sections INTO sections_snapshot
  FROM public.programme_hub_vocational_template_versions tv
  WHERE tv.id=current_version_id AND tv.workspace_id=target_workspace_id;
  IF sections_snapshot IS NULL OR pg_catalog.jsonb_typeof(sections_snapshot)<>'array' THEN
    RAISE EXCEPTION 'Assessment snapshot missing or invalid' USING ERRCODE='22023';
  END IF;

  FOR item IN
    SELECT sec.section AS section_data, q.question AS question_data, ans.answer
    FROM pg_catalog.jsonb_array_elements(sections_snapshot) AS sec(section)
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(sec.section->'questions')='array'
        THEN sec.section->'questions' ELSE '[]'::jsonb END
    ) AS q(question)
    JOIN public.programme_hub_vocational_assessment_answers ans
      ON ans.assessment_id=assessment_id AND ans.question_id=q.question->>'id'
    WHERE public.rev_voc_is_matching_safe_question(sec.section,q.question)
  LOOP
    field_key := CASE item.question_data->>'standardField'
      WHEN 'employment_goal' THEN 'employmentGoals'
      WHEN 'preferred_sector' THEN 'preferredSectors'
      WHEN 'skills' THEN 'skills'
      WHEN 'qualifications' THEN 'qualifications'
      ELSE NULL END;
    IF field_key IS NULL THEN CONTINUE; END IF;

    -- Explicitly controlled matching vocabulary. Never export arbitrary options or free text.
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

    IF item.question_data->>'type' NOT IN ('single_select','multi_select') THEN CONTINUE; END IF;
    choices := item.question_data->'options';
    IF pg_catalog.jsonb_typeof(choices)<>'array' THEN CONTINUE; END IF;
    IF item.question_data->>'type'='single_select' THEN
      IF pg_catalog.jsonb_typeof(item.answer)<>'string' THEN CONTINUE; END IF;
      values_to_check := pg_catalog.jsonb_build_array(item.answer);
    ELSE
      IF pg_catalog.jsonb_typeof(item.answer)<>'array'
        OR pg_catalog.jsonb_array_length(item.answer)>30 THEN CONTINUE; END IF;
      values_to_check := item.answer;
    END IF;

    -- Reject entire response if any answer is not a defined option OR not in the allowlist.
    IF EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(values_to_check) AS e(value)
      WHERE pg_catalog.jsonb_typeof(e.value)<>'string'
        OR NOT (choices @> pg_catalog.jsonb_build_array(e.value))
        OR NOT ((e.value #>> '{}') = ANY(allowed_values))
    ) THEN CONTINUE; END IF;

    FOR val IN SELECT value FROM pg_catalog.jsonb_array_elements(values_to_check) LOOP
      choice_text := val #>> '{}';
      IF NOT (summary->field_key @> pg_catalog.jsonb_build_array(choice_text)) THEN
        summary := pg_catalog.jsonb_set(
          summary, ARRAY[field_key], (summary->field_key) || pg_catalog.jsonb_build_array(choice_text)
        );
      END IF;
    END LOOP;
    matched_count := matched_count + 1;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object(
    'status','ready','summary',summary,'mappedQuestionCount',matched_count
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rev_voc_matching_summary(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rev_voc_matching_summary(uuid,uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rev_voc_matching_summary(uuid,uuid,uuid) TO authenticated;

COMMIT;
