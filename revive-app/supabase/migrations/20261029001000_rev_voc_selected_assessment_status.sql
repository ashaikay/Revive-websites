BEGIN;
CREATE OR REPLACE FUNCTION "public"."rev_voc_assessment_selected_status"("target_workspace_id" "uuid", "target_programme_id" "uuid", "target_participant_id" "uuid", "target_assessment_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  a public.programme_hub_vocational_assessments%ROWTYPE;
  v record;
  total_count integer := 0;
  answered_count integer := 0;
BEGIN
  IF NOT public.rev_voc_assessment_authorised(
    target_workspace_id, target_programme_id, target_participant_id
  ) THEN
    RAISE EXCEPTION 'Not authorised for participant assessment' USING ERRCODE='42501';
  END IF;

  -- Read exactly the assessment selected in the form, including historical snapshots.
  SELECT aa.* INTO a
  FROM public.programme_hub_vocational_assessments aa
  JOIN public.programme_hub_vocational_template_versions tv
    ON tv.id = aa.template_version_id
   AND tv.workspace_id = aa.workspace_id
  JOIN public.programme_hub_vocational_templates t
    ON t.id = tv.template_id
   AND t.workspace_id = tv.workspace_id
  WHERE aa.workspace_id = target_workspace_id
    AND aa.programme_id = target_programme_id
    AND aa.participant_id = target_participant_id
    AND aa.id = target_assessment_id
    AND aa.status IN ('draft','completed')
    AND (t.programme_id = target_programme_id OR t.programme_id IS NULL)
  ;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected assessment unavailable' USING ERRCODE='42501';
  END IF;

  SELECT sections INTO v
  FROM public.programme_hub_vocational_template_versions
  WHERE id = a.template_version_id AND workspace_id = target_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assessment snapshot missing' USING ERRCODE='22023';
  END IF;

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

  RETURN pg_catalog.jsonb_build_object(
    'status', CASE WHEN a.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
    'answered',answered_count,'total',total_count,
    'assessmentId',a.id,'templateVersionId',a.template_version_id,
    'version',a.version,'updatedAt',a.updated_at,
    'completedAt',a.completed_at,'updatedByUserId',a.updated_by_user_id
  );
END;
$$;


REVOKE ALL ON FUNCTION public.rev_voc_assessment_selected_status(uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rev_voc_assessment_selected_status(uuid,uuid,uuid,uuid) TO authenticated;
COMMIT;
