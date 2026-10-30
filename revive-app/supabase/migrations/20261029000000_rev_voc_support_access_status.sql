BEGIN;
-- Return permission metadata only. Restricted answers and consent statements remain private.
CREATE FUNCTION public.rev_voc_support_access_status(p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE a record; consent text; grants jsonb;
BEGIN
  SELECT workspace_id,programme_id,participant_id INTO a
  FROM public.programme_hub_vocational_assessments WHERE id=p_assessment_id;
  IF NOT FOUND OR auth.uid() IS NULL
    OR NOT public.rev_voc_assessment_authorised(a.workspace_id,a.programme_id,a.participant_id)
    OR NOT public.has_workspace_role(a.workspace_id,ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE='42501';
  END IF;
  SELECT c.consent_status INTO consent
  FROM public.programme_hub_vocational_support_consents c
  WHERE c.assessment_id=p_assessment_id AND c.workspace_id=a.workspace_id
    AND c.programme_id=a.programme_id AND c.participant_id=a.participant_id
    AND c.consent_scope='restricted_vocational_support';
  SELECT coalesce(jsonb_agg(g.adviser_user_id ORDER BY g.adviser_user_id),'[]'::jsonb) INTO grants
  FROM public.programme_hub_vocational_restricted_access_grants g
  WHERE g.workspace_id=a.workspace_id AND g.programme_id=a.programme_id
    AND g.participant_id=a.participant_id AND g.revoked_at IS NULL;
  RETURN jsonb_build_object('assessment_id',p_assessment_id,'consent',coalesce(consent,'none'),'grants',grants);
END $fn$;
REVOKE ALL ON FUNCTION public.rev_voc_support_access_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rev_voc_support_access_status(uuid) TO authenticated;
COMMIT;
