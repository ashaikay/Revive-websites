BEGIN;

-- An explicit scope guard and participant-specific adviser grant are required.
CREATE OR REPLACE FUNCTION public.rev_voc_restricted_access_allowed(p_assessment_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE a record; actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR p_assessment_id IS NULL THEN RETURN false; END IF;
  SELECT workspace_id, programme_id, participant_id INTO a
  FROM public.programme_hub_vocational_assessments WHERE id=p_assessment_id;
  IF NOT FOUND OR NOT public.rev_voc_assessment_authorised(a.workspace_id,a.programme_id,a.participant_id) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.programme_hub_vocational_support_consents c
    WHERE c.assessment_id=p_assessment_id
      AND c.workspace_id=a.workspace_id
      AND c.programme_id=a.programme_id
      AND c.participant_id=a.participant_id
      AND c.consent_scope='restricted_vocational_support'
      AND c.consent_status='granted'
      AND c.withdrawn_at IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.programme_hub_participant_advisers pa
    JOIN public.programme_hub_vocational_restricted_access_grants g
      ON g.workspace_id=pa.workspace_id AND g.programme_id=pa.programme_id
      AND g.participant_id=pa.participant_id AND g.adviser_user_id=pa.adviser_user_id
    WHERE pa.workspace_id=a.workspace_id AND pa.programme_id=a.programme_id
      AND pa.participant_id=a.participant_id AND pa.adviser_user_id=actor
      AND pa.active AND g.revoked_at IS NULL
  );
END $function$;

-- Preserve the original single-argument RPC name, but disable it to prevent
-- unaudited withdrawals. Clients must migrate to the evidence-backed RPC.
CREATE OR REPLACE FUNCTION public.rev_voc_support_consent_withdraw(p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Use evidence-backed consent withdrawal RPC' USING ERRCODE='0A000';
END $function$;

-- Evidence reference is an external document/reference identifier, not raw
-- sensitive content. Statement records the participant's withdrawal instruction.
CREATE OR REPLACE FUNCTION public.rev_voc_support_consent_withdraw(
  p_assessment_id uuid, p_evidence_reference text, p_statement text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE a record; actor uuid := auth.uid(); changed uuid;
BEGIN
  SELECT workspace_id, programme_id, participant_id INTO a
  FROM public.programme_hub_vocational_assessments WHERE id=p_assessment_id FOR UPDATE;
  IF NOT FOUND OR actor IS NULL
    OR NOT public.rev_voc_assessment_authorised(a.workspace_id,a.programme_id,a.participant_id) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE='42501';
  END IF;
  IF length(btrim(coalesce(p_evidence_reference,''))) < 8
     OR length(p_evidence_reference)>300
     OR length(btrim(coalesce(p_statement,''))) < 20
     OR length(p_statement)>2000 THEN
    RAISE EXCEPTION 'Withdrawal evidence reference and participant instruction required' USING ERRCODE='22023';
  END IF;
  UPDATE public.programme_hub_vocational_support_consents
    SET consent_status='withdrawn', withdrawn_by_user_id=actor,
        withdrawn_at=now(), updated_at=now()
    WHERE assessment_id=p_assessment_id
      AND workspace_id=a.workspace_id
      AND programme_id=a.programme_id
      AND participant_id=a.participant_id
      AND consent_scope='restricted_vocational_support'
      AND consent_status='granted'
    RETURNING id INTO changed;
  IF changed IS NULL THEN
    RAISE EXCEPTION 'No active consent to withdraw' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.programme_hub_vocational_restricted_audit
    (workspace_id,assessment_id,actor_user_id,action,details)
  VALUES (a.workspace_id,p_assessment_id,actor,'consent_withdrawn',
    jsonb_build_object('evidence_reference',btrim(p_evidence_reference),
                       'instruction_recorded',true));
  RETURN jsonb_build_object('status','withdrawn','assessment_id',p_assessment_id);
END $function$;

-- Harden existing grant operation: consent scope and participant identity
-- must match, and duplicate grants fail with a clear error before INSERT.
CREATE OR REPLACE FUNCTION public.rev_voc_restricted_access_set(
 p_assessment_id uuid, p_adviser_user_id uuid, p_action text, p_purpose text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE a record; actor uuid := auth.uid(); changed uuid;
BEGIN
 SELECT workspace_id,programme_id,participant_id INTO a
 FROM public.programme_hub_vocational_assessments WHERE id=p_assessment_id FOR UPDATE;
 IF NOT FOUND OR actor IS NULL OR NOT public.rev_voc_assessment_authorised(a.workspace_id,a.programme_id,a.participant_id)
    OR NOT public.has_workspace_role(a.workspace_id,ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE='42501'; END IF;
 IF p_adviser_user_id IS NULL THEN
    RAISE EXCEPTION 'Adviser user ID required' USING ERRCODE='22023'; END IF;
 IF p_action='grant' THEN
   IF length(btrim(coalesce(p_purpose,'')))<8 OR length(p_purpose)>500 THEN
      RAISE EXCEPTION 'Access purpose required' USING ERRCODE='22023'; END IF;
   IF NOT EXISTS (SELECT 1 FROM public.programme_hub_participant_advisers pa
     WHERE pa.workspace_id=a.workspace_id AND pa.programme_id=a.programme_id
       AND pa.participant_id=a.participant_id AND pa.adviser_user_id=p_adviser_user_id AND pa.active) THEN
     RAISE EXCEPTION 'Active participant adviser assignment required' USING ERRCODE='42501'; END IF;
   IF NOT EXISTS (SELECT 1 FROM public.programme_hub_vocational_support_consents c
      WHERE c.assessment_id=p_assessment_id AND c.workspace_id=a.workspace_id
        AND c.programme_id=a.programme_id AND c.participant_id=a.participant_id
        AND c.consent_scope='restricted_vocational_support'
        AND c.consent_status='granted' AND c.withdrawn_at IS NULL) THEN
     RAISE EXCEPTION 'Active participant consent required' USING ERRCODE='42501'; END IF;
   IF EXISTS (SELECT 1 FROM public.programme_hub_vocational_restricted_access_grants g
      WHERE g.workspace_id=a.workspace_id AND g.programme_id=a.programme_id
        AND g.participant_id=a.participant_id AND g.adviser_user_id=p_adviser_user_id
        AND g.revoked_at IS NULL) THEN
     RAISE EXCEPTION 'Active adviser grant already exists' USING ERRCODE='23505'; END IF;
   INSERT INTO public.programme_hub_vocational_restricted_access_grants
    (workspace_id,programme_id,participant_id,adviser_user_id,granted_by_user_id,purpose)
   VALUES(a.workspace_id,a.programme_id,a.participant_id,p_adviser_user_id,actor,btrim(p_purpose))
   RETURNING id INTO changed;
   INSERT INTO public.programme_hub_vocational_restricted_audit(workspace_id,assessment_id,actor_user_id,action,details)
   VALUES(a.workspace_id,p_assessment_id,actor,'access_granted',jsonb_build_object('adviser_user_id',p_adviser_user_id));
 ELSIF p_action='revoke' THEN
   UPDATE public.programme_hub_vocational_restricted_access_grants
   SET revoked_by_user_id=actor,revoked_at=now()
   WHERE workspace_id=a.workspace_id AND programme_id=a.programme_id
    AND participant_id=a.participant_id AND adviser_user_id=p_adviser_user_id AND revoked_at IS NULL
   RETURNING id INTO changed;
   IF changed IS NULL THEN RAISE EXCEPTION 'No active grant' USING ERRCODE='22023'; END IF;
   INSERT INTO public.programme_hub_vocational_restricted_audit(workspace_id,assessment_id,actor_user_id,action,details)
   VALUES(a.workspace_id,p_assessment_id,actor,'access_revoked',jsonb_build_object('adviser_user_id',p_adviser_user_id));
 ELSE RAISE EXCEPTION 'Action must be grant or revoke' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('action',p_action,'grant_id',changed);
END $function$;

REVOKE ALL ON FUNCTION public.rev_voc_support_consent_withdraw(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rev_voc_support_consent_withdraw(uuid,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rev_voc_support_consent_withdraw(uuid) FROM PUBLIC, anon, authenticated;
COMMIT;
