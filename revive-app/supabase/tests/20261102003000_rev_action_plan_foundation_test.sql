\set ON_ERROR_STOP on
-- Isolated local/CI regression only. All fixture writes are rolled back.
-- Versioned employment action plan: caseload authority, revision checks,
-- exact-request retries, immutable history, questionnaire review and owner review.
BEGIN;
CREATE TEMP TABLE rev_ap_ids (key text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO rev_ap_ids
SELECT key,gen_random_uuid() FROM unnest(ARRAY[
  'owner','adviser','adviser2','outsider','workspace','other_workspace','programme','template',
  'v1','v2','p1','a1','a2','a3','r1','r_stale'
]) key;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
SELECT id,'00000000-0000-0000-0000-000000000000'::uuid,'authenticated','authenticated',
  key||'-action-plan@example.invalid','',now(),now(),now()
FROM rev_ap_ids WHERE key IN ('owner','adviser','adviser2','outsider');
INSERT INTO public.workspaces(id,name,slug,created_by)
SELECT id,'Action plan fixture',key||'-action-plan-'||left(gen_random_uuid()::text,12),
  (SELECT id FROM rev_ap_ids WHERE key='owner')
FROM rev_ap_ids WHERE key IN ('workspace','other_workspace');
INSERT INTO public.workspace_members(workspace_id,user_id,role)
SELECT w.id,u.id,CASE WHEN u.key='owner' THEN 'owner' ELSE 'member' END
FROM rev_ap_ids w CROSS JOIN rev_ap_ids u
WHERE w.key='workspace' AND u.key IN ('owner','adviser','adviser2','outsider');
INSERT INTO public.programme_hub_programmes(id,workspace_id,name,timezone,created_by_user_id,updated_by_user_id)
SELECT p.id,w.id,'Action plan programme','Europe/London',o.id,o.id
FROM rev_ap_ids p,rev_ap_ids w,rev_ap_ids o
WHERE p.key='programme' AND w.key='workspace' AND o.key='owner';
INSERT INTO public.programme_hub_advisers(workspace_id,programme_id,user_id,created_by_user_id,updated_by_user_id)
SELECT w.id,p.id,a.id,o.id,o.id
FROM rev_ap_ids w,rev_ap_ids p,rev_ap_ids a,rev_ap_ids o
WHERE w.key='workspace' AND p.key='programme' AND a.key IN ('adviser','adviser2') AND o.key='owner';
INSERT INTO public.programme_hub_participants(id,workspace_id,programme_id,participant_key,preferred_name,case_reference,created_by_user_id,updated_by_user_id)
SELECT s.id,w.id,p.id,'action-plan-'||s.key,'Fixture only','fixture-'||s.key,o.id,o.id
FROM rev_ap_ids s,rev_ap_ids w,rev_ap_ids p,rev_ap_ids o
WHERE s.key='p1' AND w.key='workspace' AND p.key='programme' AND o.key='owner';
INSERT INTO public.programme_hub_participant_advisers(workspace_id,programme_id,participant_id,adviser_user_id,created_by_user_id,updated_by_user_id)
SELECT w.id,p.id,s.id,a.id,o.id,o.id
FROM rev_ap_ids w,rev_ap_ids p,rev_ap_ids s,rev_ap_ids a,rev_ap_ids o
WHERE w.key='workspace' AND p.key='programme' AND s.key='p1' AND a.key IN ('adviser','adviser2') AND o.key='owner';
-- Publish questionnaire version 1 through the snapshot guard.
INSERT INTO public.programme_hub_vocational_templates(id,workspace_id,programme_id,title,status,version,sections,created_by_user_id,updated_by_user_id,published_at)
SELECT t.id,w.id,p.id,'Employment questionnaire','draft',1,
  '[{"id":"goals","title":"Employment goals","questions":[{"id":"sector","sectionId":"goals","label":"Preferred sector","type":"multi_select","standardField":"preferred_sector","options":["Retail","Logistics"],"required":true,"sensitive":false}]}]'::jsonb,
  o.id,o.id,NULL
FROM rev_ap_ids t,rev_ap_ids w,rev_ap_ids p,rev_ap_ids o
WHERE t.key='template' AND w.key='workspace' AND p.key='programme' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_template_versions(id,workspace_id,template_id,version,title,sections,published_by_user_id,published_at)
SELECT (SELECT id FROM rev_ap_ids WHERE key='v1'),workspace_id,id,version,title,sections,updated_by_user_id,'2026-10-01T09:00:00Z'
FROM public.programme_hub_vocational_templates WHERE id=(SELECT id FROM rev_ap_ids WHERE key='template');
UPDATE public.programme_hub_vocational_templates SET status='published',published_at='2026-10-01T09:00:00Z'
WHERE id=(SELECT id FROM rev_ap_ids WHERE key='template');
GRANT SELECT ON rev_ap_ids TO authenticated, anon;

CREATE TEMP TABLE rev_ap_actions ON COMMIT DROP AS
SELECT
  jsonb_build_object('id',(SELECT id FROM rev_ap_ids WHERE key='a1')::text,'description','Update CV with warehouse experience',
    'ownerType','service_user','ownerUserId',NULL,'status','not_started','targetDate','2026-11-20') AS su_action,
  jsonb_build_object('id',(SELECT id FROM rev_ap_ids WHERE key='a2')::text,'description','Shortlist three local logistics vacancies',
    'ownerType','employment_specialist','ownerUserId',(SELECT id FROM rev_ap_ids WHERE key='adviser2')::text,
    'status','in_progress','targetDate',NULL) AS es_action;
GRANT SELECT ON rev_ap_actions TO authenticated;

SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  ws uuid := (SELECT id FROM rev_ap_ids WHERE key='workspace');
  prog uuid := (SELECT id FROM rev_ap_ids WHERE key='programme');
  p1 uuid := (SELECT id FROM rev_ap_ids WHERE key='p1');
  v1 uuid := (SELECT id FROM rev_ap_ids WHERE key='v1');
  r1 uuid := (SELECT id FROM rev_ap_ids WHERE key='r1');
  acts jsonb := (SELECT jsonb_build_array(su_action, es_action) FROM rev_ap_actions);
  result jsonb;
  retry jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ap_ids WHERE key='adviser'),true);

  result := public.rev_action_plan_read(ws,prog,p1);
  IF result->'plan' <> 'null'::jsonb OR result->'revisions' <> '[]'::jsonb
    OR result->'currentQuestionnaire'->>'templateVersionId' <> v1::text
    OR (result->>'reviewNeeded')::boolean
    OR jsonb_array_length(result->'assignedSpecialistIds') <> 2 THEN
    RAISE EXCEPTION 'FAIL empty plan read: %',result;
  END IF;
  RAISE NOTICE 'PASS assigned ES opens an empty plan linked to the current questionnaire';

  result := public.rev_action_plan_save(ws,prog,p1,r1,0,v1,'Secure a warehouse role within three months',acts);
  IF (result->>'revision')::int <> 1 OR result->>'templateVersionId' <> v1::text THEN
    RAISE EXCEPTION 'FAIL first revision: %',result;
  END IF;
  retry := public.rev_action_plan_save(ws,prog,p1,r1,0,v1,'Secure a warehouse role within three months',acts);
  IF retry <> result THEN RAISE EXCEPTION 'FAIL exact retry returned a different result: % / %',retry,result; END IF;
  RAISE NOTICE 'PASS assigned ES saves revision 1; exact retry returns the original result';

  BEGIN
    PERFORM public.rev_action_plan_save(ws,prog,p1,r1,0,v1,'A different goal',acts);
    RAISE EXCEPTION 'FAIL reused request ID with different input accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN
    PERFORM public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),0,v1,'Stale create',acts);
    RAISE EXCEPTION 'FAIL stale expected revision accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  RAISE NOTICE 'PASS reused request ID and stale revision rejected';

  BEGIN
    PERFORM public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),1,v1,'Goal',
      jsonb_build_array(jsonb_set((SELECT es_action FROM rev_ap_actions),'{ownerUserId}',
        to_jsonb((SELECT id FROM rev_ap_ids WHERE key='outsider')::text))));
    RAISE EXCEPTION 'FAIL unassigned staff member accepted as action owner';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),1,gen_random_uuid(),'Goal',acts);
    RAISE EXCEPTION 'FAIL unrelated questionnaire version accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),1,v1,'Goal',
      jsonb_build_array(jsonb_set((SELECT su_action FROM rev_ap_actions),'{targetDate}','"2026-02-30"')));
    RAISE EXCEPTION 'FAIL invalid target date accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),1,v1,'Goal',
      jsonb_build_array((SELECT su_action FROM rev_ap_actions) || '{"participantAgreed":true}'::jsonb));
    RAISE EXCEPTION 'FAIL unexpected action field accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'PASS unassigned owner, unrelated questionnaire, invalid date and extra fields rejected';

  DECLARE
    su jsonb := (SELECT su_action FROM rev_ap_actions);
    es jsonb := (SELECT es_action FROM rev_ap_actions);
    bad jsonb;
  BEGIN
    FOREACH bad IN ARRAY ARRAY[
      jsonb_set(su,'{ownerType}','null'),
      jsonb_set(es,'{ownerType}','null'),
      jsonb_set(su,'{ownerType}','1'),
      jsonb_set(su,'{ownerType}','["service_user"]'),
      jsonb_set(su,'{ownerType}','"participant"'),
      jsonb_set(su,'{ownerUserId}',es->'ownerUserId'),
      jsonb_set(es,'{ownerUserId}','null'),
      jsonb_set(es,'{ownerUserId}','"not-a-uuid"'),
      jsonb_set(su,'{status}','null'),
      jsonb_set(su,'{description}','null'),
      jsonb_set(su,'{id}','null')
    ] LOOP
      BEGIN
        PERFORM public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),1,v1,'Goal',jsonb_build_array(bad));
        RAISE EXCEPTION 'FAIL malformed action accepted: %',bad;
      EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    END LOOP;
  END;
  RAISE NOTICE 'PASS null or malformed ownerType, ownerUserId and other action fields rejected';

  BEGIN
    PERFORM 1 FROM public.programme_hub_action_plan_revisions;
    RAISE EXCEPTION 'FAIL browser role read revisions directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM public.programme_hub_action_plan_write_requests;
    RAISE EXCEPTION 'FAIL browser role read request ledger';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS no direct browser access to plan tables';

  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ap_ids WHERE key='owner'),true);
  result := public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),1,v1,'Secure a logistics role within three months',acts);
  IF (result->>'revision')::int <> 2 THEN RAISE EXCEPTION 'FAIL manager revision 2: %',result; END IF;
  result := public.rev_action_plan_read(ws,prog,p1);
  IF (result->'plan'->>'currentRevision')::int <> 2 OR jsonb_array_length(result->'revisions') <> 2
    OR (result->'revisions'->0->>'revision')::int <> 2
    OR result->'revisions'->1->>'employmentGoal' <> 'Secure a warehouse role within three months'
    OR result->'revisions'->1->'actions' <> acts THEN
    RAISE EXCEPTION 'FAIL earlier revision not preserved: %',result;
  END IF;
  RAISE NOTICE 'PASS authorised manager saves revision 2; revision 1 preserved unchanged';
END;
$test$;
RESET ROLE;

DO $test$
BEGIN
  BEGIN
    UPDATE public.programme_hub_action_plan_revisions SET employment_goal='Overwritten'
    WHERE workspace_id=(SELECT id FROM rev_ap_ids WHERE key='workspace');
    RAISE EXCEPTION 'FAIL revision overwritten';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.programme_hub_action_plan_revisions
    WHERE workspace_id=(SELECT id FROM rev_ap_ids WHERE key='workspace');
    RAISE EXCEPTION 'FAIL revision deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS revisions cannot be updated or deleted, even by the database owner';
END;
$test$;

-- A newer questionnaire is published after the plan was saved.
UPDATE public.programme_hub_vocational_templates SET status='draft',version=2,title='Employment questionnaire 2026'
WHERE id=(SELECT id FROM rev_ap_ids WHERE key='template');
INSERT INTO public.programme_hub_vocational_template_versions(id,workspace_id,template_id,version,title,sections,published_by_user_id,published_at)
SELECT (SELECT id FROM rev_ap_ids WHERE key='v2'),workspace_id,id,version,title,sections,updated_by_user_id,'2026-11-01T09:00:00Z'
FROM public.programme_hub_vocational_templates WHERE id=(SELECT id FROM rev_ap_ids WHERE key='template');
UPDATE public.programme_hub_vocational_templates SET status='published',published_at='2026-11-01T09:00:00Z'
WHERE id=(SELECT id FROM rev_ap_ids WHERE key='template');

SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  ws uuid := (SELECT id FROM rev_ap_ids WHERE key='workspace');
  prog uuid := (SELECT id FROM rev_ap_ids WHERE key='programme');
  p1 uuid := (SELECT id FROM rev_ap_ids WHERE key='p1');
  v1 uuid := (SELECT id FROM rev_ap_ids WHERE key='v1');
  v2 uuid := (SELECT id FROM rev_ap_ids WHERE key='v2');
  acts jsonb := (SELECT jsonb_build_array(su_action, es_action) FROM rev_ap_actions);
  result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ap_ids WHERE key='adviser'),true);
  result := public.rev_action_plan_read(ws,prog,p1);
  IF NOT (result->>'reviewNeeded')::boolean
    OR result->'currentQuestionnaire'->>'templateVersionId' <> v2::text
    OR result->'revisions'->0->>'templateVersionId' <> v1::text
    OR (result->'plan'->>'currentRevision')::int <> 2
    OR result->'revisions'->0->'actions'->0->>'description' <> 'Update CV with warehouse experience' THEN
    RAISE EXCEPTION 'FAIL newer questionnaire changed the plan or was not flagged: %',result;
  END IF;
  RAISE NOTICE 'PASS newer questionnaire flags review; saved plan unchanged';

  result := public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),2,v1,'Secure a logistics role within three months',acts);
  IF result->>'templateVersionId' <> v1::text
    OR NOT (public.rev_action_plan_read(ws,prog,p1)->>'reviewNeeded')::boolean THEN
    RAISE EXCEPTION 'FAIL keeping the existing questionnaire link: %',result;
  END IF;
  result := public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),3,v2,'Secure a logistics role within three months',acts);
  result := public.rev_action_plan_read(ws,prog,p1);
  IF (result->>'reviewNeeded')::boolean OR result->'revisions'->0->>'templateVersionId' <> v2::text
    OR result->'revisions'->1->>'templateVersionId' <> v1::text THEN
    RAISE EXCEPTION 'FAIL reviewed link to the current questionnaire: %',result;
  END IF;
  RAISE NOTICE 'PASS revision can keep its link until a reviewer links the current questionnaire';
END;
$test$;
RESET ROLE;

-- adviser2 owns an action, then is unassigned from this Service user.
UPDATE public.programme_hub_participant_advisers SET active=false
WHERE participant_id=(SELECT id FROM rev_ap_ids WHERE key='p1')
  AND adviser_user_id=(SELECT id FROM rev_ap_ids WHERE key='adviser2');

SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  ws uuid := (SELECT id FROM rev_ap_ids WHERE key='workspace');
  prog uuid := (SELECT id FROM rev_ap_ids WHERE key='programme');
  p1 uuid := (SELECT id FROM rev_ap_ids WHERE key='p1');
  v2 uuid := (SELECT id FROM rev_ap_ids WHERE key='v2');
  acts jsonb := (SELECT jsonb_build_array(su_action, es_action) FROM rev_ap_actions);
  result jsonb;
  latest jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ap_ids WHERE key='adviser'),true);
  result := public.rev_action_plan_read(ws,prog,p1);
  latest := result->'revisions'->0->'actions';
  IF (latest->0->>'ownerNeedsReview')::boolean OR NOT (latest->1->>'ownerNeedsReview')::boolean
    OR latest->1->>'ownerUserId' <> (SELECT id::text FROM rev_ap_ids WHERE key='adviser2')
    OR jsonb_array_length(result->'assignedSpecialistIds') <> 1 THEN
    RAISE EXCEPTION 'FAIL unassigned owner not flagged or was replaced: %',result;
  END IF;
  result := public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),4,v2,'Secure a logistics role within three months',
    jsonb_build_array(jsonb_set(acts->0,'{status}','"completed"'), acts->1));
  IF (result->>'revision')::int <> 5 THEN RAISE EXCEPTION 'FAIL preserving recorded owner: %',result; END IF;
  BEGIN
    PERFORM public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),5,v2,'Goal',
      jsonb_build_array(acts->0, acts->1, jsonb_set(acts->1,'{id}',to_jsonb((SELECT id FROM rev_ap_ids WHERE key='a3')::text))));
    RAISE EXCEPTION 'FAIL new action assigned to unassigned ES';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),5,v2,'Goal',
      jsonb_build_array(jsonb_set(jsonb_set(acts->0,'{ownerType}','"employment_specialist"'),'{ownerUserId}',acts->1->'ownerUserId'), acts->1));
    RAISE EXCEPTION 'FAIL existing action reassigned to unassigned ES';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'PASS unassigned owner flagged and preserved, never newly assigned';

  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ap_ids WHERE key='adviser2'),true);
  BEGIN
    PERFORM public.rev_action_plan_read(ws,prog,p1);
    RAISE EXCEPTION 'FAIL unassigned ES read plan';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ap_ids WHERE key='outsider'),true);
  BEGIN
    PERFORM public.rev_action_plan_read(ws,prog,p1);
    RAISE EXCEPTION 'FAIL non-caseload member read plan';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.rev_action_plan_save(ws,prog,p1,gen_random_uuid(),5,v2,'Goal','[]'::jsonb);
    RAISE EXCEPTION 'FAIL non-caseload member saved plan';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ap_ids WHERE key='adviser'),true);
  BEGIN
    PERFORM public.rev_action_plan_read((SELECT id FROM rev_ap_ids WHERE key='other_workspace'),prog,p1);
    RAISE EXCEPTION 'FAIL foreign workspace accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.rev_action_plan_save(ws,gen_random_uuid(),p1,gen_random_uuid(),5,v2,'Goal','[]'::jsonb);
    RAISE EXCEPTION 'FAIL foreign programme accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM public.rev_action_plan_read(ws,prog,p1);
    RAISE EXCEPTION 'FAIL unauthenticated caller accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS unassigned ES, non-caseload, foreign-scope and unauthenticated callers denied';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $test$
BEGIN
  BEGIN
    PERFORM public.rev_action_plan_read(
      (SELECT id FROM rev_ap_ids WHERE key='workspace'),
      (SELECT id FROM rev_ap_ids WHERE key='programme'),
      (SELECT id FROM rev_ap_ids WHERE key='p1'));
    RAISE EXCEPTION 'FAIL anon executed action plan read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS anon has no execute grant';
END;
$test$;
RESET ROLE;

DO $test$
DECLARE ws uuid := (SELECT id FROM rev_ap_ids WHERE key='workspace');
BEGIN
  IF (SELECT count(*) FROM public.programme_hub_action_plans WHERE workspace_id=ws) <> 1
    OR (SELECT count(*) FROM public.programme_hub_action_plan_revisions WHERE workspace_id=ws) <> 5
    OR (SELECT count(*) FROM public.programme_hub_action_plan_write_requests WHERE workspace_id=ws) <> 5
    OR (SELECT count(*) FROM public.audit_log WHERE workspace_id=ws
        AND action='programme_hub.action_plan.revision_saved') <> 5
    OR EXISTS (SELECT 1 FROM public.audit_log WHERE workspace_id=ws
        AND action='programme_hub.action_plan.revision_saved'
        AND (metadata::text ILIKE '%logistics%' OR metadata::text ILIKE '%warehouse%')) THEN
    RAISE EXCEPTION 'FAIL revision, retry ledger or audit history mismatch';
  END IF;
  RAISE NOTICE 'PASS one audit entry per revision, no duplicates from retries, no free text in audit';
END;
$test$;
ROLLBACK;
