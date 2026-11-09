-- REV Brain: review-only opportunity context for one Service user.
-- Profile evidence comes only from rev_voc_matching_summary (current questionnaire, ordinary
-- allowlisted answers). Opportunities come only from the programme's own active vacancies.
-- Employer contacts, case notes, action plans and restricted answers are never returned.
-- Read-only: nothing is written, sent, applied for or changed.
BEGIN;
CREATE FUNCTION public.rev_brain_programme_opportunity_review(
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
