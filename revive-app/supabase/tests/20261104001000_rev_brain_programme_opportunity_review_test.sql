\set ON_ERROR_STOP on
-- Isolated local/CI regression only. All fixture writes are rolled back.
-- rev_brain_programme_opportunity_review must reuse current-questionnaire readiness,
-- return only allowlisted ordinary profile evidence and the programme's own active jobs,
-- enforce programme/caseload access and write nothing.
BEGIN;
CREATE TEMP TABLE rev_opp_ids (key text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO rev_opp_ids
SELECT key,gen_random_uuid() FROM unnest(ARRAY[
  'owner','adviser','outsider','workspace','other_workspace','programme','other_programme','template',
  'old_snapshot','current_snapshot','p_ready','p_progress','p_ready_current','p_progress_old','p_progress_current',
  'employer','closed_employer','other_employer','contact','vac_active','vac_inactive','vac_closed_employer','vac_other_programme'
]) key;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
SELECT id,'00000000-0000-0000-0000-000000000000'::uuid,'authenticated','authenticated',
  key||'-rev-opp@example.invalid','',now(),now(),now()
FROM rev_opp_ids WHERE key IN ('owner','adviser','outsider');
INSERT INTO public.workspaces(id,name,slug,created_by)
SELECT id,'Opportunity review fixture',key||'-rev-opp-'||left(gen_random_uuid()::text,12),
  (SELECT id FROM rev_opp_ids WHERE key='owner')
FROM rev_opp_ids WHERE key IN ('workspace','other_workspace');
INSERT INTO public.workspace_members(workspace_id,user_id,role)
SELECT w.id,u.id,CASE WHEN u.key='owner' THEN 'owner' ELSE 'member' END
FROM rev_opp_ids w CROSS JOIN rev_opp_ids u
WHERE w.key='workspace' AND u.key IN ('owner','adviser','outsider');
INSERT INTO public.programme_hub_programmes(id,workspace_id,name,timezone,created_by_user_id,updated_by_user_id)
SELECT p.id,w.id,'Opportunity programme '||p.key,'Europe/London',o.id,o.id
FROM rev_opp_ids p,rev_opp_ids w,rev_opp_ids o
WHERE p.key IN ('programme','other_programme') AND w.key='workspace' AND o.key='owner';
INSERT INTO public.programme_hub_advisers(workspace_id,programme_id,user_id,created_by_user_id,updated_by_user_id)
SELECT w.id,p.id,a.id,o.id,o.id
FROM rev_opp_ids w,rev_opp_ids p,rev_opp_ids a,rev_opp_ids o
WHERE w.key='workspace' AND p.key='programme' AND a.key='adviser' AND o.key='owner';
INSERT INTO public.programme_hub_participants(id,workspace_id,programme_id,participant_key,preferred_name,case_reference,created_by_user_id,updated_by_user_id)
SELECT s.id,w.id,p.id,'rev-opp-'||s.key,'Fixture only','fixture-'||s.key,o.id,o.id
FROM rev_opp_ids s,rev_opp_ids w,rev_opp_ids p,rev_opp_ids o
WHERE s.key IN ('p_ready','p_progress') AND w.key='workspace' AND p.key='programme' AND o.key='owner';
INSERT INTO public.programme_hub_participant_advisers(workspace_id,programme_id,participant_id,adviser_user_id,created_by_user_id,updated_by_user_id)
SELECT w.id,p.id,s.id,a.id,o.id,o.id
FROM rev_opp_ids w,rev_opp_ids p,rev_opp_ids s,rev_opp_ids a,rev_opp_ids o
WHERE w.key='workspace' AND p.key='programme' AND s.key IN ('p_ready','p_progress') AND a.key='adviser' AND o.key='owner';

-- Ordinary mapped select/text answers, one unmapped ordinary answer and one restricted answer.
INSERT INTO public.programme_hub_vocational_templates(id,workspace_id,programme_id,title,status,version,sections,created_by_user_id,updated_by_user_id,published_at)
SELECT t.id,w.id,p.id,'Earlier questionnaire','draft',1,
  '[{"id":"skills","title":"Skills","questions":[
     {"id":"skills","sectionId":"skills","label":"Skills","type":"multi_select","standardField":"skills","options":["forklift","Working at heights","Driving"],"required":true,"sensitive":false},
     {"id":"text_skill","sectionId":"skills","label":"Other supported skills","type":"short_text","standardField":"skills","required":false,"sensitive":false},
     {"id":"unmapped","sectionId":"skills","label":"Other employment experience","type":"short_text","required":false,"sensitive":false},
     {"id":"restricted","sectionId":"skills","label":"Restricted skills","type":"multi_select","standardField":"skills","options":["Driving"],"required":false,"sensitive":true}]}]'::jsonb,
  o.id,o.id,NULL
FROM rev_opp_ids t,rev_opp_ids w,rev_opp_ids p,rev_opp_ids o
WHERE t.key='template' AND w.key='workspace' AND p.key='programme' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_template_versions(id,workspace_id,template_id,version,title,sections,published_by_user_id,published_at)
SELECT (SELECT id FROM rev_opp_ids WHERE key='old_snapshot'),workspace_id,id,version,title,sections,updated_by_user_id,'2026-10-01T09:00:00Z'
FROM public.programme_hub_vocational_templates WHERE id=(SELECT id FROM rev_opp_ids WHERE key='template');
UPDATE public.programme_hub_vocational_templates SET version=2,title='Current questionnaire'
WHERE id=(SELECT id FROM rev_opp_ids WHERE key='template');
INSERT INTO public.programme_hub_vocational_template_versions(id,workspace_id,template_id,version,title,sections,published_by_user_id,published_at)
SELECT (SELECT id FROM rev_opp_ids WHERE key='current_snapshot'),workspace_id,id,version,title,sections,updated_by_user_id,'2026-11-02T09:00:00Z'
FROM public.programme_hub_vocational_templates WHERE id=(SELECT id FROM rev_opp_ids WHERE key='template');
UPDATE public.programme_hub_vocational_templates SET status='published',published_at='2026-11-02T09:00:00Z'
WHERE id=(SELECT id FROM rev_opp_ids WHERE key='template');

-- p_ready: completed current questionnaire. p_progress: older completed + newer incomplete.
INSERT INTO public.programme_hub_vocational_assessments(id,workspace_id,programme_id,participant_id,template_version_id,status,completed_at,created_by_user_id,updated_by_user_id)
SELECT a.id,w.id,p.id,s.id,v.id,'completed','2026-11-03T09:00:00Z'::timestamptz,o.id,o.id
FROM rev_opp_ids a,rev_opp_ids w,rev_opp_ids p,rev_opp_ids s,rev_opp_ids v,rev_opp_ids o
WHERE a.key='p_ready_current' AND w.key='workspace' AND p.key='programme' AND s.key='p_ready' AND v.key='current_snapshot' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_assessments(id,workspace_id,programme_id,participant_id,template_version_id,status,completed_at,created_by_user_id,updated_by_user_id)
SELECT a.id,w.id,p.id,s.id,v.id,'completed','2026-10-02T09:00:00Z'::timestamptz,o.id,o.id
FROM rev_opp_ids a,rev_opp_ids w,rev_opp_ids p,rev_opp_ids s,rev_opp_ids v,rev_opp_ids o
WHERE a.key='p_progress_old' AND w.key='workspace' AND p.key='programme' AND s.key='p_progress' AND v.key='old_snapshot' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_assessments(id,workspace_id,programme_id,participant_id,template_version_id,status,created_by_user_id,updated_by_user_id)
SELECT a.id,w.id,p.id,s.id,v.id,'draft',o.id,o.id
FROM rev_opp_ids a,rev_opp_ids w,rev_opp_ids p,rev_opp_ids s,rev_opp_ids v,rev_opp_ids o
WHERE a.key='p_progress_current' AND w.key='workspace' AND p.key='programme' AND s.key='p_progress' AND v.key='current_snapshot' AND o.key='owner';
INSERT INTO public.programme_hub_vocational_assessment_answers(assessment_id,question_id,answer)
SELECT id,'skills','["forklift","Working at heights"]'::jsonb FROM rev_opp_ids WHERE key='p_ready_current'
UNION ALL SELECT id,'text_skill','"Teamwork"'::jsonb FROM rev_opp_ids WHERE key='p_ready_current'
UNION ALL SELECT id,'unmapped','"case-note-secret"'::jsonb FROM rev_opp_ids WHERE key='p_ready_current'
UNION ALL SELECT id,'restricted','["Driving"]'::jsonb FROM rev_opp_ids WHERE key='p_ready_current'
UNION ALL SELECT id,'skills','["Teamwork"]'::jsonb FROM rev_opp_ids WHERE key='p_progress_old'
UNION ALL SELECT id,'skills','["Forklift"]'::jsonb FROM rev_opp_ids WHERE key='p_progress_current';
INSERT INTO public.programme_hub_vocational_status_events(workspace_id,assessment_id,actor_user_id,action)
SELECT w.id,a.id,o.id,'completed' FROM rev_opp_ids w,rev_opp_ids a,rev_opp_ids o
WHERE w.key='workspace' AND a.key IN ('p_ready_current','p_progress_old') AND o.key='owner';

-- Programme jobs: only the active job from an active employer in this programme is eligible.
INSERT INTO public.programme_hub_employers(id,workspace_id,programme_id,employer_key,display_name,sector_key,active,created_by_user_id,updated_by_user_id)
SELECT e.id,w.id,p.id,'rev-opp-'||e.key,'Employer '||e.key,'Warehousing',e.key<>'closed_employer',o.id,o.id
FROM rev_opp_ids e,rev_opp_ids w,rev_opp_ids p,rev_opp_ids o
WHERE w.key='workspace' AND o.key='owner'
  AND ((e.key IN ('employer','closed_employer') AND p.key='programme') OR (e.key='other_employer' AND p.key='other_programme'));
INSERT INTO public.programme_hub_employer_contacts(id,workspace_id,programme_id,employer_id,contact_key,preferred_name,business_email,created_by_user_id,updated_by_user_id)
SELECT c.id,w.id,p.id,e.id,'rev-opp-contact','Contact person','contact-person@example.invalid',o.id,o.id
FROM rev_opp_ids c,rev_opp_ids w,rev_opp_ids p,rev_opp_ids e,rev_opp_ids o
WHERE c.key='contact' AND w.key='workspace' AND p.key='programme' AND e.key='employer' AND o.key='owner';
INSERT INTO public.programme_hub_vacancies(id,workspace_id,programme_id,employer_id,employer_contact_id,vacancy_key,title,work_geography_key,required_skill_keys,desired_skill_keys,active,created_by_user_id,updated_by_user_id)
SELECT v.id,w.id,p.id,e.id,CASE WHEN v.key='vac_active' THEN c.id END,'rev-opp-'||v.key,'Job '||v.key,'Leeds',ARRAY['Forklift','Stock control'],ARRAY['Driving'],v.key<>'vac_inactive',o.id,o.id
FROM rev_opp_ids v
JOIN rev_opp_ids e ON e.key=CASE v.key WHEN 'vac_closed_employer' THEN 'closed_employer' WHEN 'vac_other_programme' THEN 'other_employer' ELSE 'employer' END
JOIN rev_opp_ids p ON p.key=CASE v.key WHEN 'vac_other_programme' THEN 'other_programme' ELSE 'programme' END
CROSS JOIN rev_opp_ids w CROSS JOIN rev_opp_ids o CROSS JOIN rev_opp_ids c
WHERE v.key IN ('vac_active','vac_inactive','vac_closed_employer','vac_other_programme') AND w.key='workspace' AND o.key='owner' AND c.key='contact';

CREATE TEMP TABLE rev_opp_before ON COMMIT DROP AS
SELECT md5(string_agg(row_text,'|' ORDER BY row_text)) AS fingerprint FROM (
  SELECT aa.id::text||aa.status||coalesce(aa.completed_at::text,'')||aa.updated_at::text AS row_text
  FROM public.programme_hub_vocational_assessments aa WHERE aa.workspace_id=(SELECT id FROM rev_opp_ids WHERE key='workspace')
  UNION ALL
  SELECT ans.assessment_id::text||ans.question_id||ans.answer::text FROM public.programme_hub_vocational_assessment_answers ans
  WHERE ans.assessment_id IN (SELECT id FROM rev_opp_ids)
  UNION ALL
  SELECT v.id::text||v.version::text||v.updated_at::text FROM public.programme_hub_vacancies v WHERE v.workspace_id=(SELECT id FROM rev_opp_ids WHERE key='workspace')
  UNION ALL
  SELECT 'plans:'||count(*)::text FROM public.programme_hub_action_plans ap WHERE ap.workspace_id=(SELECT id FROM rev_opp_ids WHERE key='workspace')
) rows;
GRANT SELECT ON rev_opp_ids TO authenticated, anon;

SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  ws uuid := (SELECT id FROM rev_opp_ids WHERE key='workspace');
  prog uuid := (SELECT id FROM rev_opp_ids WHERE key='programme');
  ready_id uuid := (SELECT id FROM rev_opp_ids WHERE key='p_ready');
  progress_id uuid := (SELECT id FROM rev_opp_ids WHERE key='p_progress');
  result jsonb;
  job jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_opp_ids WHERE key='adviser'),true);
  result := public.rev_brain_programme_opportunity_review(ws,prog,ready_id);
  IF result->>'status' <> 'ready'
    OR result->'profileEvidence'->>'assessmentId' <> (SELECT id::text FROM rev_opp_ids WHERE key='p_ready_current')
    OR result->'profileEvidence'->>'templateVersionId' <> (SELECT id::text FROM rev_opp_ids WHERE key='current_snapshot')
    OR result->'profileEvidence'->'summary'->'skills' <> '["Forklift","Teamwork"]'::jsonb
    OR (result->'profileEvidence'->>'mappedQuestionCount')::integer <> 2
    OR result->'profileEvidence'->'unmappedQuestions'
      <> '[{"label":"Other employment experience","questionId":"unmapped"}]'::jsonb
    OR (result->'profileEvidence')::text LIKE '%Working at heights%'
    OR (result->'profileEvidence')::text LIKE '%Driving%'
    OR (result->'profileEvidence')::text LIKE '%case-note-secret%'
    OR result->'profileEvidence'->'summary' <> public.rev_voc_matching_summary(ws,prog,ready_id)->'summary' THEN
    RAISE EXCEPTION 'FAIL ready profile evidence: %',result;
  END IF;
  RAISE NOTICE 'PASS supported ordinary answers contribute independently and unmapped labels exclude answer values';

  IF pg_catalog.jsonb_array_length(result->'opportunities') <> 1 OR (result->>'opportunityCount')::int <> 1
    OR (result->>'truncated')::boolean THEN
    RAISE EXCEPTION 'FAIL programme job selection: %',result->'opportunities';
  END IF;
  job := result->'opportunities'->0;
  IF job->'source'->>'kind' <> 'programme_vacancy'
    OR job->'source'->>'vacancyId' <> (SELECT id::text FROM rev_opp_ids WHERE key='vac_active')
    OR job->'requiredSkills' <> '["Forklift","Stock control"]'::jsonb
    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(job) k)
      <> ARRAY['desiredSkills','employerName','employerSector','requiredSkills','source','title','workArea']
    OR result::text LIKE '%contact-person@example.invalid%' OR result::text LIKE '%Contact person%' THEN
    RAISE EXCEPTION 'FAIL job shape or contact leak: %',job;
  END IF;
  RAISE NOTICE 'PASS only active programme jobs from active employers are returned, without employer contacts';

  result := public.rev_brain_programme_opportunity_review(ws,prog,progress_id);
  IF result->>'status' <> 'assessment_in_progress'
    OR result->'opportunities' <> '[]'::jsonb
    OR result->'profileEvidence'->'summary'->'skills' <> '[]'::jsonb
    OR result::text LIKE '%Teamwork%' THEN
    RAISE EXCEPTION 'FAIL older completed + newer incomplete was not "not ready": %',result;
  END IF;
  RAISE NOTICE 'PASS older completed + newer incomplete questionnaire is not ready and uses no older answers';

  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_opp_ids WHERE key='owner'),true);
  IF public.rev_brain_programme_opportunity_review(ws,prog,ready_id)->>'status' <> 'ready' THEN
    RAISE EXCEPTION 'FAIL authorised manager denied';
  END IF;
  RAISE NOTICE 'PASS authorised manager receives the same review';

  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_opp_ids WHERE key='outsider'),true);
  BEGIN
    PERFORM public.rev_brain_programme_opportunity_review(ws,prog,ready_id);
    RAISE EXCEPTION 'FAIL unassigned member read opportunity review';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_opp_ids WHERE key='adviser'),true);
  BEGIN
    PERFORM public.rev_brain_programme_opportunity_review(ws,(SELECT id FROM rev_opp_ids WHERE key='other_programme'),ready_id);
    RAISE EXCEPTION 'FAIL other programme accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.rev_brain_programme_opportunity_review((SELECT id FROM rev_opp_ids WHERE key='other_workspace'),prog,ready_id);
    RAISE EXCEPTION 'FAIL foreign workspace accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM public.rev_brain_programme_opportunity_review(ws,prog,ready_id);
    RAISE EXCEPTION 'FAIL unauthenticated caller accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS unassigned, other-programme, foreign-workspace and unauthenticated callers denied';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $test$
BEGIN
  BEGIN
    PERFORM public.rev_brain_programme_opportunity_review(
      (SELECT id FROM rev_opp_ids WHERE key='workspace'),
      (SELECT id FROM rev_opp_ids WHERE key='programme'),
      (SELECT id FROM rev_opp_ids WHERE key='p_ready'));
    RAISE EXCEPTION 'FAIL anon executed opportunity review';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS anon has no execute grant';
END;
$test$;
RESET ROLE;

UPDATE public.programme_hub_participant_advisers SET active=false
WHERE participant_id=(SELECT id FROM rev_opp_ids WHERE key='p_ready');
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_opp_ids WHERE key='adviser'),true);
  BEGIN
    PERFORM public.rev_brain_programme_opportunity_review(
      (SELECT id FROM rev_opp_ids WHERE key='workspace'),
      (SELECT id FROM rev_opp_ids WHERE key='programme'),
      (SELECT id FROM rev_opp_ids WHERE key='p_ready'));
    RAISE EXCEPTION 'FAIL removed ES retained opportunity access';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS ES removed from the caseload is denied';
END;
$test$;
RESET ROLE;
UPDATE public.programme_hub_participant_advisers SET active=true
WHERE participant_id=(SELECT id FROM rev_opp_ids WHERE key='p_ready');

DO $test$
DECLARE after_fingerprint text;
BEGIN
  SELECT md5(string_agg(row_text,'|' ORDER BY row_text)) INTO after_fingerprint FROM (
    SELECT aa.id::text||aa.status||coalesce(aa.completed_at::text,'')||aa.updated_at::text AS row_text
    FROM public.programme_hub_vocational_assessments aa WHERE aa.workspace_id=(SELECT id FROM rev_opp_ids WHERE key='workspace')
    UNION ALL
    SELECT ans.assessment_id::text||ans.question_id||ans.answer::text FROM public.programme_hub_vocational_assessment_answers ans
    WHERE ans.assessment_id IN (SELECT id FROM rev_opp_ids)
    UNION ALL
    SELECT v.id::text||v.version::text||v.updated_at::text FROM public.programme_hub_vacancies v WHERE v.workspace_id=(SELECT id FROM rev_opp_ids WHERE key='workspace')
    UNION ALL
    SELECT 'plans:'||count(*)::text FROM public.programme_hub_action_plans ap WHERE ap.workspace_id=(SELECT id FROM rev_opp_ids WHERE key='workspace')
  ) rows;
  IF after_fingerprint IS DISTINCT FROM (SELECT fingerprint FROM rev_opp_before) THEN
    RAISE EXCEPTION 'FAIL opportunity review changed answers, completion history, jobs or action plans';
  END IF;
  RAISE NOTICE 'PASS review is read-only: answers, completion history, jobs and action plans unchanged';
END;
$test$;
ROLLBACK;
