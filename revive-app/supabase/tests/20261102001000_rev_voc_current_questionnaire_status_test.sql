\set ON_ERROR_STOP on
-- Isolated local/CI regression only. All fixture writes are rolled back.
BEGIN;
CREATE TEMP TABLE rev_voc_status_ids (key text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO rev_voc_status_ids
SELECT key,gen_random_uuid() FROM unnest(ARRAY[
  'owner','adviser','outsider','workspace','other_workspace','programme',
  'template','old_snapshot','current_snapshot','old_assessment'
]) key;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
SELECT id,'00000000-0000-0000-0000-000000000000'::uuid,'authenticated','authenticated',
  key||'-voc-status@example.invalid','',now(),now(),now()
FROM rev_voc_status_ids WHERE key IN ('owner','adviser','outsider');
INSERT INTO public.workspaces(id,name,slug,created_by)
SELECT id,'Vocational status fixture',key||'-voc-status-'||left(gen_random_uuid()::text,12),
  (SELECT id FROM rev_voc_status_ids WHERE key='owner')
FROM rev_voc_status_ids WHERE key IN ('workspace','other_workspace');
INSERT INTO public.workspace_members(workspace_id,user_id,role)
SELECT w.id,u.id,CASE WHEN u.key='owner' THEN 'owner' ELSE 'member' END
FROM rev_voc_status_ids w CROSS JOIN rev_voc_status_ids u
WHERE w.key='workspace' AND u.key IN ('owner','adviser','outsider');
INSERT INTO public.programme_hub_programmes(id,workspace_id,name,timezone,created_by_user_id,updated_by_user_id)
SELECT p.id,w.id,'Vocational status programme','Europe/London',o.id,o.id
FROM rev_voc_status_ids p,rev_voc_status_ids w,rev_voc_status_ids o
WHERE p.key='programme' AND w.key='workspace' AND o.key='owner';
INSERT INTO public.programme_hub_advisers(workspace_id,programme_id,user_id,created_by_user_id,updated_by_user_id)
SELECT w.id,p.id,a.id,o.id,o.id
FROM rev_voc_status_ids w,rev_voc_status_ids p,rev_voc_status_ids a,rev_voc_status_ids o
WHERE w.key='workspace' AND p.key='programme' AND a.key='adviser' AND o.key='owner';
INSERT INTO rev_voc_status_ids VALUES ('participant',gen_random_uuid());
INSERT INTO public.programme_hub_participants(id,workspace_id,programme_id,participant_key,preferred_name,case_reference,created_by_user_id,updated_by_user_id)
SELECT s.id,w.id,p.id,'voc-status-fixture','Fixture only','fixture-case',o.id,o.id
FROM rev_voc_status_ids s,rev_voc_status_ids w,rev_voc_status_ids p,rev_voc_status_ids o
WHERE s.key='participant' AND w.key='workspace' AND p.key='programme' AND o.key='owner';
INSERT INTO public.programme_hub_participant_advisers(workspace_id,programme_id,participant_id,adviser_user_id,created_by_user_id,updated_by_user_id)
SELECT w.id,p.id,s.id,a.id,o.id,o.id
FROM rev_voc_status_ids w,rev_voc_status_ids p,rev_voc_status_ids s,rev_voc_status_ids a,rev_voc_status_ids o
WHERE w.key='workspace' AND p.key='programme' AND s.key='participant' AND a.key='adviser' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_templates(id,workspace_id,programme_id,title,status,version,sections,created_by_user_id,updated_by_user_id,published_at)
SELECT t.id,w.id,p.id,'Earlier questionnaire','draft',1,
  '[{"id":"goals","title":"Employment goals","questions":[{"id":"goal","sectionId":"goals","label":"Preferred work","type":"short_text","required":true,"sensitive":false}]}]'::jsonb,
  o.id,o.id,NULL
FROM rev_voc_status_ids t,rev_voc_status_ids w,rev_voc_status_ids p,rev_voc_status_ids o
WHERE t.key='template' AND w.key='workspace' AND p.key='programme' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_template_versions(id,workspace_id,template_id,version,title,sections,published_by_user_id,published_at)
SELECT (SELECT id FROM rev_voc_status_ids WHERE key='old_snapshot'),workspace_id,id,version,title,sections,updated_by_user_id,'2026-10-01T09:00:00Z'
FROM public.programme_hub_vocational_templates WHERE id=(SELECT id FROM rev_voc_status_ids WHERE key='template');
UPDATE public.programme_hub_vocational_templates
SET version=3,title='Current questionnaire',
  sections='[{"id":"goals","title":"Employment goals","questions":[{"id":"goal","sectionId":"goals","label":"Preferred work","type":"short_text","required":true,"sensitive":false},{"id":"next","sectionId":"goals","label":"Next step","type":"short_text","required":true,"sensitive":false}]}]'::jsonb
WHERE id=(SELECT id FROM rev_voc_status_ids WHERE key='template');
INSERT INTO public.programme_hub_vocational_template_versions(id,workspace_id,template_id,version,title,sections,published_by_user_id,published_at)
SELECT (SELECT id FROM rev_voc_status_ids WHERE key='current_snapshot'),workspace_id,id,version,title,sections,updated_by_user_id,'2026-11-02T09:00:00Z'
FROM public.programme_hub_vocational_templates WHERE id=(SELECT id FROM rev_voc_status_ids WHERE key='template');
UPDATE public.programme_hub_vocational_templates SET status='published',published_at='2026-11-02T09:00:00Z'
WHERE id=(SELECT id FROM rev_voc_status_ids WHERE key='template');
INSERT INTO public.programme_hub_vocational_assessments(id,workspace_id,programme_id,participant_id,template_version_id,status,completed_at,created_by_user_id,updated_by_user_id)
SELECT a.id,w.id,p.id,s.id,v.id,'completed','2026-10-02T09:00:00Z'::timestamptz,o.id,o.id
FROM rev_voc_status_ids a,rev_voc_status_ids w,rev_voc_status_ids p,rev_voc_status_ids s,rev_voc_status_ids v,rev_voc_status_ids o
WHERE a.key='old_assessment' AND w.key='workspace' AND p.key='programme'
  AND s.key='participant' AND v.key='old_snapshot' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_assessment_answers(assessment_id,question_id,answer)
SELECT id,'goal','"Earlier saved answer"'::jsonb
FROM rev_voc_status_ids WHERE key='old_assessment';
INSERT INTO public.programme_hub_vocational_status_events(workspace_id,assessment_id,actor_user_id,action)
SELECT w.id,a.id,o.id,'completed' FROM rev_voc_status_ids w,rev_voc_status_ids a,rev_voc_status_ids o
WHERE w.key='workspace' AND a.key='old_assessment' AND o.key='owner';
GRANT SELECT ON rev_voc_status_ids TO authenticated;

SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  ws uuid := (SELECT id FROM rev_voc_status_ids WHERE key='workspace');
  prog uuid := (SELECT id FROM rev_voc_status_ids WHERE key='programme');
  participant uuid := (SELECT id FROM rev_voc_status_ids WHERE key='participant');
  old_snapshot uuid := (SELECT id FROM rev_voc_status_ids WHERE key='old_snapshot');
  current_snapshot uuid := (SELECT id FROM rev_voc_status_ids WHERE key='current_snapshot');
  old_assessment uuid := (SELECT id FROM rev_voc_status_ids WHERE key='old_assessment');
  current_assessment uuid;
  result jsonb;
  overview jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_voc_status_ids WHERE key='owner'),true);
  overview := public.rev_voc_assessment_status(ws,prog,participant);
  IF overview->>'status' <> 'not_started' OR overview->>'assessmentId' IS NOT NULL
    OR overview->>'templateVersionId' <> current_snapshot::text OR (overview->>'total')::int <> 2
    OR overview->'earlierCompletedAssessment'->>'assessmentId' <> old_assessment::text THEN
    RAISE EXCEPTION 'FAIL unopened current questionnaire was replaced by older completion: %',overview;
  END IF;
  RAISE NOTICE 'PASS owner overview separates unopened current questionnaire and earlier completion';

  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_voc_status_ids WHERE key='adviser'),true);
  result := public.rev_voc_assessment_draft(ws,prog,participant,current_snapshot);
  current_assessment := (result->>'assessmentId')::uuid;
  IF result->>'status' <> 'draft' OR result->'answers' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'FAIL new questionnaire inherited answers or completion';
  END IF;
  result := public.rev_voc_assessment_draft(ws,prog,participant,current_snapshot,'save',current_assessment,
    (result->>'version')::bigint,'{"goal":"Current saved answer"}'::jsonb);
  overview := public.rev_voc_assessment_status(ws,prog,participant);
  IF overview->>'status' <> 'in_progress' OR overview->>'assessmentId' <> current_assessment::text
    OR (overview->>'answered')::int <> 1 OR (overview->>'total')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL incomplete current questionnaire status: %',overview;
  END IF;
  result := public.rev_voc_assessment_selected_status(ws,prog,participant,current_assessment);
  IF result->>'status' <> overview->>'status' OR result->>'answered' <> overview->>'answered'
    OR result->>'templateVersionId' <> overview->>'templateVersionId' THEN
    RAISE EXCEPTION 'FAIL selected and overview current status disagree';
  END IF;
  RAISE NOTICE 'PASS assigned ES current overview and selected status agree without copying answers';

  result := public.rev_voc_assessment_draft(ws,prog,participant,old_snapshot);
  IF result->>'assessmentId' <> old_assessment::text OR result->>'status' <> 'completed'
    OR result->'answers' <> '{"goal":"Earlier saved answer"}'::jsonb THEN
    RAISE EXCEPTION 'FAIL reopening history did not return the saved completed assessment';
  END IF;
  result := public.rev_voc_assessment_selected_status(ws,prog,participant,old_assessment);
  IF result->>'status' <> 'completed' OR (result->>'completedAt')::timestamptz <> '2026-10-02T09:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'FAIL historical completion metadata changed';
  END IF;
  result := public.rev_voc_assessment_draft(ws,prog,participant,current_snapshot);
  IF result->>'assessmentId' <> current_assessment::text OR result->>'status' <> 'draft'
    OR result->'answers' <> '{"goal":"Current saved answer"}'::jsonb THEN
    RAISE EXCEPTION 'FAIL returning to current questionnaire lost or copied answers';
  END IF;
  RAISE NOTICE 'PASS reopening both versions preserves their distinct answers and completion';

  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_voc_status_ids WHERE key='outsider'),true);
  BEGIN
    PERFORM public.rev_voc_assessment_status(ws,prog,participant);
    RAISE EXCEPTION 'FAIL unassigned member read overview';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.rev_voc_assessment_selected_status(ws,prog,participant,old_assessment);
    RAISE EXCEPTION 'FAIL unassigned member read historical status';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.rev_voc_assessment_draft(ws,prog,participant,old_snapshot);
    RAISE EXCEPTION 'FAIL unassigned member opened history';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_voc_status_ids WHERE key='adviser'),true);
  BEGIN
    PERFORM public.rev_voc_assessment_status((SELECT id FROM rev_voc_status_ids WHERE key='other_workspace'),prog,participant);
    RAISE EXCEPTION 'FAIL foreign workspace accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.rev_voc_assessment_selected_status(ws,prog,participant,gen_random_uuid());
    RAISE EXCEPTION 'FAIL foreign assessment accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS unassigned and foreign-scope reads/opens denied';
END;
$test$;
RESET ROLE;

DO $test$
BEGIN
  IF (SELECT count(*) FROM public.programme_hub_vocational_assessments WHERE participant_id=(SELECT id FROM rev_voc_status_ids WHERE key='participant')) <> 2
    OR (SELECT count(*) FROM public.programme_hub_vocational_status_events WHERE workspace_id=(SELECT id FROM rev_voc_status_ids WHERE key='workspace')) <> 1 THEN
    RAISE EXCEPTION 'FAIL assessment history or completion events changed';
  END IF;
  RAISE NOTICE 'PASS no duplicate assessment, automatic completion or history rewrite';
END;
$test$;
UPDATE public.programme_hub_participant_advisers SET active=false
WHERE participant_id=(SELECT id FROM rev_voc_status_ids WHERE key='participant');
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_voc_status_ids WHERE key='adviser'),true);
  BEGIN
    PERFORM public.rev_voc_assessment_status(
      (SELECT id FROM rev_voc_status_ids WHERE key='workspace'),
      (SELECT id FROM rev_voc_status_ids WHERE key='programme'),
      (SELECT id FROM rev_voc_status_ids WHERE key='participant'));
    RAISE EXCEPTION 'FAIL revoked ES retained overview access';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS revoked ES denied';
END;
$test$;
ROLLBACK;
