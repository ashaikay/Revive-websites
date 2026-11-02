\set ON_ERROR_STOP on
-- Isolated local/CI regression only. All fixture writes are rolled back.
-- rev_voc_matching_summary must use the same current questionnaire and current
-- assessment as rev_voc_assessment_status and never export older-version answers.
BEGIN;
CREATE TEMP TABLE rev_voc_match_ids (key text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO rev_voc_match_ids
SELECT key,gen_random_uuid() FROM unnest(ARRAY[
  'owner','adviser','outsider','workspace','other_workspace','programme','template',
  'old_snapshot','current_snapshot','p1','p2','p1_old','p1_current_completed','p1_current_draft',
  'p2_old','p2_current_draft','global_template','global_snapshot','p1_global'
]) key;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
SELECT id,'00000000-0000-0000-0000-000000000000'::uuid,'authenticated','authenticated',
  key||'-voc-match@example.invalid','',now(),now(),now()
FROM rev_voc_match_ids WHERE key IN ('owner','adviser','outsider');
INSERT INTO public.workspaces(id,name,slug,created_by)
SELECT id,'Vocational matching fixture',key||'-voc-match-'||left(gen_random_uuid()::text,12),
  (SELECT id FROM rev_voc_match_ids WHERE key='owner')
FROM rev_voc_match_ids WHERE key IN ('workspace','other_workspace');
INSERT INTO public.workspace_members(workspace_id,user_id,role)
SELECT w.id,u.id,CASE WHEN u.key='owner' THEN 'owner' ELSE 'member' END
FROM rev_voc_match_ids w CROSS JOIN rev_voc_match_ids u
WHERE w.key='workspace' AND u.key IN ('owner','adviser','outsider');
INSERT INTO public.programme_hub_programmes(id,workspace_id,name,timezone,created_by_user_id,updated_by_user_id)
SELECT p.id,w.id,'Vocational matching programme','Europe/London',o.id,o.id
FROM rev_voc_match_ids p,rev_voc_match_ids w,rev_voc_match_ids o
WHERE p.key='programme' AND w.key='workspace' AND o.key='owner';
INSERT INTO public.programme_hub_advisers(workspace_id,programme_id,user_id,created_by_user_id,updated_by_user_id)
SELECT w.id,p.id,a.id,o.id,o.id
FROM rev_voc_match_ids w,rev_voc_match_ids p,rev_voc_match_ids a,rev_voc_match_ids o
WHERE w.key='workspace' AND p.key='programme' AND a.key='adviser' AND o.key='owner';
INSERT INTO public.programme_hub_participants(id,workspace_id,programme_id,participant_key,preferred_name,case_reference,created_by_user_id,updated_by_user_id)
SELECT s.id,w.id,p.id,'voc-match-'||s.key,'Fixture only','fixture-'||s.key,o.id,o.id
FROM rev_voc_match_ids s,rev_voc_match_ids w,rev_voc_match_ids p,rev_voc_match_ids o
WHERE s.key IN ('p1','p2') AND w.key='workspace' AND p.key='programme' AND o.key='owner';
INSERT INTO public.programme_hub_participant_advisers(workspace_id,programme_id,participant_id,adviser_user_id,created_by_user_id,updated_by_user_id)
SELECT w.id,p.id,s.id,a.id,o.id,o.id
FROM rev_voc_match_ids w,rev_voc_match_ids p,rev_voc_match_ids s,rev_voc_match_ids a,rev_voc_match_ids o
WHERE w.key='workspace' AND p.key='programme' AND s.key IN ('p1','p2') AND a.key='adviser' AND o.key='owner';
-- Both versions contain the same ordinary, allowlisted matching question.
INSERT INTO public.programme_hub_vocational_templates(id,workspace_id,programme_id,title,status,version,sections,created_by_user_id,updated_by_user_id,published_at)
SELECT t.id,w.id,p.id,'Earlier questionnaire','draft',1,
  '[{"id":"goals","title":"Employment goals","questions":[{"id":"sector","sectionId":"goals","label":"Preferred sector","type":"multi_select","standardField":"preferred_sector","options":["Retail","Logistics","Construction"],"required":true,"sensitive":false}]}]'::jsonb,
  o.id,o.id,NULL
FROM rev_voc_match_ids t,rev_voc_match_ids w,rev_voc_match_ids p,rev_voc_match_ids o
WHERE t.key='template' AND w.key='workspace' AND p.key='programme' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_template_versions(id,workspace_id,template_id,version,title,sections,published_by_user_id,published_at)
SELECT (SELECT id FROM rev_voc_match_ids WHERE key='old_snapshot'),workspace_id,id,version,title,sections,updated_by_user_id,'2026-10-01T09:00:00Z'
FROM public.programme_hub_vocational_templates WHERE id=(SELECT id FROM rev_voc_match_ids WHERE key='template');
UPDATE public.programme_hub_vocational_templates SET version=2,title='Current questionnaire'
WHERE id=(SELECT id FROM rev_voc_match_ids WHERE key='template');
INSERT INTO public.programme_hub_vocational_template_versions(id,workspace_id,template_id,version,title,sections,published_by_user_id,published_at)
SELECT (SELECT id FROM rev_voc_match_ids WHERE key='current_snapshot'),workspace_id,id,version,title,sections,updated_by_user_id,'2026-11-02T09:00:00Z'
FROM public.programme_hub_vocational_templates WHERE id=(SELECT id FROM rev_voc_match_ids WHERE key='template');
UPDATE public.programme_hub_vocational_templates SET status='published',published_at='2026-11-02T09:00:00Z'
WHERE id=(SELECT id FROM rev_voc_match_ids WHERE key='template');
-- Older completed assessments for both participants (historical answers must stay put).
INSERT INTO public.programme_hub_vocational_assessments(id,workspace_id,programme_id,participant_id,template_version_id,status,completed_at,created_by_user_id,updated_by_user_id)
SELECT a.id,w.id,p.id,s.id,v.id,'completed','2026-10-02T09:00:00Z'::timestamptz,o.id,o.id
FROM rev_voc_match_ids a
JOIN rev_voc_match_ids s ON s.key=split_part(a.key,'_',1)
CROSS JOIN rev_voc_match_ids w CROSS JOIN rev_voc_match_ids p CROSS JOIN rev_voc_match_ids v CROSS JOIN rev_voc_match_ids o
WHERE a.key IN ('p1_old','p2_old') AND w.key='workspace' AND p.key='programme' AND v.key='old_snapshot' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_assessment_answers(assessment_id,question_id,answer)
SELECT id,'sector','["Retail"]'::jsonb FROM rev_voc_match_ids WHERE key IN ('p1_old','p2_old');
INSERT INTO public.programme_hub_vocational_status_events(workspace_id,assessment_id,actor_user_id,action)
SELECT w.id,a.id,o.id,'completed' FROM rev_voc_match_ids w,rev_voc_match_ids a,rev_voc_match_ids o
WHERE w.key='workspace' AND a.key IN ('p1_old','p2_old') AND o.key='owner';
-- p2: newer current questionnaire is only partially completed.
INSERT INTO public.programme_hub_vocational_assessments(id,workspace_id,programme_id,participant_id,template_version_id,status,created_by_user_id,updated_by_user_id)
SELECT a.id,w.id,p.id,s.id,v.id,'draft',o.id,o.id
FROM rev_voc_match_ids a,rev_voc_match_ids w,rev_voc_match_ids p,rev_voc_match_ids s,rev_voc_match_ids v,rev_voc_match_ids o
WHERE a.key='p2_current_draft' AND w.key='workspace' AND p.key='programme' AND s.key='p2' AND v.key='current_snapshot' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_assessment_answers(assessment_id,question_id,answer)
SELECT id,'sector','["Construction"]'::jsonb FROM rev_voc_match_ids WHERE key='p2_current_draft';
-- A later programme-agnostic template is never the programme's current questionnaire
-- in rev_voc_assessment_status or the form, so it must not make matching ready.
INSERT INTO public.programme_hub_vocational_templates(id,workspace_id,programme_id,title,status,version,sections,created_by_user_id,updated_by_user_id,published_at)
SELECT t.id,w.id,NULL,'Workspace-wide questionnaire','draft',1,
  '[{"id":"goals","title":"Employment goals","questions":[{"id":"sector","sectionId":"goals","label":"Preferred sector","type":"multi_select","standardField":"preferred_sector","options":["Retail","Logistics","Construction"],"required":true,"sensitive":false}]}]'::jsonb,
  o.id,o.id,NULL
FROM rev_voc_match_ids t,rev_voc_match_ids w,rev_voc_match_ids o
WHERE t.key='global_template' AND w.key='workspace' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_template_versions(id,workspace_id,template_id,version,title,sections,published_by_user_id,published_at)
SELECT (SELECT id FROM rev_voc_match_ids WHERE key='global_snapshot'),workspace_id,id,version,title,sections,updated_by_user_id,'2026-11-05T09:00:00Z'
FROM public.programme_hub_vocational_templates WHERE id=(SELECT id FROM rev_voc_match_ids WHERE key='global_template');
UPDATE public.programme_hub_vocational_templates SET status='published',published_at='2026-11-05T09:00:00Z'
WHERE id=(SELECT id FROM rev_voc_match_ids WHERE key='global_template');
INSERT INTO public.programme_hub_vocational_assessments(id,workspace_id,programme_id,participant_id,template_version_id,status,completed_at,created_by_user_id,updated_by_user_id)
SELECT a.id,w.id,p.id,s.id,v.id,'completed','2026-11-05T10:00:00Z'::timestamptz,o.id,o.id
FROM rev_voc_match_ids a,rev_voc_match_ids w,rev_voc_match_ids p,rev_voc_match_ids s,rev_voc_match_ids v,rev_voc_match_ids o
WHERE a.key='p1_global' AND w.key='workspace' AND p.key='programme' AND s.key='p1' AND v.key='global_snapshot' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_assessment_answers(assessment_id,question_id,answer)
SELECT id,'sector','["Construction"]'::jsonb FROM rev_voc_match_ids WHERE key='p1_global';
CREATE TEMP TABLE rev_voc_match_before ON COMMIT DROP AS
SELECT aa.id,aa.status,aa.completed_at,aa.updated_at,ans.question_id,ans.answer
FROM public.programme_hub_vocational_assessments aa
LEFT JOIN public.programme_hub_vocational_assessment_answers ans ON ans.assessment_id=aa.id
WHERE aa.workspace_id=(SELECT id FROM rev_voc_match_ids WHERE key='workspace');
GRANT SELECT ON rev_voc_match_ids TO authenticated, anon;

SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  ws uuid := (SELECT id FROM rev_voc_match_ids WHERE key='workspace');
  prog uuid := (SELECT id FROM rev_voc_match_ids WHERE key='programme');
  p1 uuid := (SELECT id FROM rev_voc_match_ids WHERE key='p1');
  p2 uuid := (SELECT id FROM rev_voc_match_ids WHERE key='p2');
  current_snapshot uuid := (SELECT id FROM rev_voc_match_ids WHERE key='current_snapshot');
  result jsonb;
  overview jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_voc_match_ids WHERE key='adviser'),true);

  result := public.rev_voc_matching_summary(ws,prog,p1);
  IF result->>'status' <> 'reassessment_required' OR result->>'templateVersionId' <> current_snapshot::text
    OR result->>'assessmentId' IS NOT NULL OR (result->>'mappedQuestionCount')::int <> 0
    OR result->'summary'->'preferredSectors' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'FAIL unopened current questionnaire fell back to older completion: %',result;
  END IF;
  RAISE NOTICE 'PASS older completed + newer unopened questionnaire is not ready; workspace-wide template ignored';

  result := public.rev_voc_matching_summary(ws,prog,p2);
  overview := public.rev_voc_assessment_status(ws,prog,p2);
  IF result->>'status' <> 'assessment_in_progress'
    OR result->>'assessmentId' <> (SELECT id::text FROM rev_voc_match_ids WHERE key='p2_current_draft')
    OR result->>'assessmentId' <> overview->>'assessmentId'
    OR result->>'templateVersionId' <> overview->>'templateVersionId'
    OR overview->>'status' <> 'in_progress'
    OR result->'summary'->'preferredSectors' <> '[]'::jsonb
    OR (result->>'mappedQuestionCount')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL older completed + newer incomplete exported answers or disagreed with status: % / %',result,overview;
  END IF;
  RAISE NOTICE 'PASS older completed + newer incomplete returns assessment_in_progress without older or draft answers';
END;
$test$;
RESET ROLE;

-- p1: complete the current questionnaire; only current-version answers are exported.
INSERT INTO public.programme_hub_vocational_assessments(id,workspace_id,programme_id,participant_id,template_version_id,status,completed_at,created_by_user_id,updated_by_user_id,updated_at)
SELECT a.id,w.id,p.id,s.id,v.id,'completed','2026-11-03T09:00:00Z'::timestamptz,o.id,o.id,'2026-11-03T09:00:00Z'::timestamptz
FROM rev_voc_match_ids a,rev_voc_match_ids w,rev_voc_match_ids p,rev_voc_match_ids s,rev_voc_match_ids v,rev_voc_match_ids o
WHERE a.key='p1_current_completed' AND w.key='workspace' AND p.key='programme' AND s.key='p1' AND v.key='current_snapshot' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_assessment_answers(assessment_id,question_id,answer)
SELECT id,'sector','["Logistics"]'::jsonb FROM rev_voc_match_ids WHERE key='p1_current_completed';
INSERT INTO rev_voc_match_before
SELECT aa.id,aa.status,aa.completed_at,aa.updated_at,ans.question_id,ans.answer
FROM public.programme_hub_vocational_assessments aa
LEFT JOIN public.programme_hub_vocational_assessment_answers ans ON ans.assessment_id=aa.id
WHERE aa.id=(SELECT id FROM rev_voc_match_ids WHERE key='p1_current_completed');
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_voc_match_ids WHERE key='adviser'),true);
  result := public.rev_voc_matching_summary(
    (SELECT id FROM rev_voc_match_ids WHERE key='workspace'),
    (SELECT id FROM rev_voc_match_ids WHERE key='programme'),
    (SELECT id FROM rev_voc_match_ids WHERE key='p1'));
  IF result->>'status' <> 'ready'
    OR result->>'assessmentId' <> (SELECT id::text FROM rev_voc_match_ids WHERE key='p1_current_completed')
    OR result->'summary'->'preferredSectors' <> '["Logistics"]'::jsonb
    OR (result->>'mappedQuestionCount')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL completed current questionnaire summary: %',result;
  END IF;
  RAISE NOTICE 'PASS completed current questionnaire is ready with current answers only';
END;
$test$;
RESET ROLE;

-- p1: a newer same-version draft (e.g. reassessment) is the current assessment, as in status.
INSERT INTO public.programme_hub_vocational_assessments(id,workspace_id,programme_id,participant_id,template_version_id,status,created_by_user_id,updated_by_user_id,updated_at)
SELECT a.id,w.id,p.id,s.id,v.id,'draft',o.id,o.id,'2026-11-04T09:00:00Z'::timestamptz
FROM rev_voc_match_ids a,rev_voc_match_ids w,rev_voc_match_ids p,rev_voc_match_ids s,rev_voc_match_ids v,rev_voc_match_ids o
WHERE a.key='p1_current_draft' AND w.key='workspace' AND p.key='programme' AND s.key='p1' AND v.key='current_snapshot' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_assessment_answers(assessment_id,question_id,answer)
SELECT id,'sector','["Construction"]'::jsonb FROM rev_voc_match_ids WHERE key='p1_current_draft';
INSERT INTO rev_voc_match_before
SELECT aa.id,aa.status,aa.completed_at,aa.updated_at,ans.question_id,ans.answer
FROM public.programme_hub_vocational_assessments aa
LEFT JOIN public.programme_hub_vocational_assessment_answers ans ON ans.assessment_id=aa.id
WHERE aa.id=(SELECT id FROM rev_voc_match_ids WHERE key='p1_current_draft');
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  ws uuid := (SELECT id FROM rev_voc_match_ids WHERE key='workspace');
  prog uuid := (SELECT id FROM rev_voc_match_ids WHERE key='programme');
  p1 uuid := (SELECT id FROM rev_voc_match_ids WHERE key='p1');
  result jsonb;
  overview jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_voc_match_ids WHERE key='adviser'),true);
  result := public.rev_voc_matching_summary(ws,prog,p1);
  overview := public.rev_voc_assessment_status(ws,prog,p1);
  IF result->>'status' <> 'assessment_in_progress'
    OR result->>'assessmentId' <> (SELECT id::text FROM rev_voc_match_ids WHERE key='p1_current_draft')
    OR result->>'assessmentId' <> overview->>'assessmentId'
    OR overview->>'status' <> 'in_progress'
    OR result->'summary'->'preferredSectors' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'FAIL same-version draft/completed selection disagrees with status: % / %',result,overview;
  END IF;
  RAISE NOTICE 'PASS same-version draft and completed follow the status selection (draft is current, not ready)';

  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_voc_match_ids WHERE key='owner'),true);
  result := public.rev_voc_matching_summary(ws,prog,p1);
  IF result->>'status' <> 'assessment_in_progress' THEN
    RAISE EXCEPTION 'FAIL owner saw a different readiness state: %',result;
  END IF;
  RAISE NOTICE 'PASS owner receives the same readiness state';

  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_voc_match_ids WHERE key='outsider'),true);
  BEGIN
    PERFORM public.rev_voc_matching_summary(ws,prog,p1);
    RAISE EXCEPTION 'FAIL unassigned member read matching summary';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_voc_match_ids WHERE key='adviser'),true);
  BEGIN
    PERFORM public.rev_voc_matching_summary((SELECT id FROM rev_voc_match_ids WHERE key='other_workspace'),prog,p1);
    RAISE EXCEPTION 'FAIL foreign workspace accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.rev_voc_matching_summary(ws,gen_random_uuid(),p1);
    RAISE EXCEPTION 'FAIL foreign programme accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM public.rev_voc_matching_summary(ws,prog,p1);
    RAISE EXCEPTION 'FAIL unauthenticated caller accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS unassigned, foreign-scope and unauthenticated callers denied';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $test$
BEGIN
  BEGIN
    PERFORM public.rev_voc_matching_summary(
      (SELECT id FROM rev_voc_match_ids WHERE key='workspace'),
      (SELECT id FROM rev_voc_match_ids WHERE key='programme'),
      (SELECT id FROM rev_voc_match_ids WHERE key='p1'));
    RAISE EXCEPTION 'FAIL anon executed matching summary';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS anon has no execute grant';
END;
$test$;
RESET ROLE;

UPDATE public.programme_hub_participant_advisers SET active=false
WHERE participant_id=(SELECT id FROM rev_voc_match_ids WHERE key='p1');
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_voc_match_ids WHERE key='adviser'),true);
  BEGIN
    PERFORM public.rev_voc_matching_summary(
      (SELECT id FROM rev_voc_match_ids WHERE key='workspace'),
      (SELECT id FROM rev_voc_match_ids WHERE key='programme'),
      (SELECT id FROM rev_voc_match_ids WHERE key='p1'));
    RAISE EXCEPTION 'FAIL revoked ES retained matching access';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS revoked ES denied';
END;
$test$;
RESET ROLE;

DO $test$
BEGIN
  IF EXISTS (
    (SELECT * FROM rev_voc_match_before)
    EXCEPT
    (SELECT aa.id,aa.status,aa.completed_at,aa.updated_at,ans.question_id,ans.answer
     FROM public.programme_hub_vocational_assessments aa
     LEFT JOIN public.programme_hub_vocational_assessment_answers ans ON ans.assessment_id=aa.id
     WHERE aa.workspace_id=(SELECT id FROM rev_voc_match_ids WHERE key='workspace'))
  ) OR (SELECT count(*) FROM public.programme_hub_vocational_assessments
        WHERE workspace_id=(SELECT id FROM rev_voc_match_ids WHERE key='workspace')) <> 6
    OR (SELECT count(*) FROM public.programme_hub_vocational_status_events
        WHERE workspace_id=(SELECT id FROM rev_voc_match_ids WHERE key='workspace')) <> 2 THEN
    RAISE EXCEPTION 'FAIL matching summary changed answers, statuses or completion history';
  END IF;
  RAISE NOTICE 'PASS answers, statuses and completion history unchanged';
END;
$test$;
ROLLBACK;