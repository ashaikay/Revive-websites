\set ON_ERROR_STOP on
-- LOCAL-ONLY integration test. No migration. All fixture writes are rolled back.
BEGIN;
CREATE TEMP TABLE rev_voc_test_ids (key text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO rev_voc_test_ids(key,id)
SELECT key,gen_random_uuid() FROM unnest(ARRAY['owner_a','adviser_a','outsider_a','owner_b','workspace_a','workspace_b','programme_a','programme_b','participant_a','template_a','template_version_a','assessment_a']) key;
-- Supabase Auth users are disposable fixtures inside the test transaction.
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
SELECT id,'00000000-0000-0000-0000-000000000000'::uuid,'authenticated','authenticated',key||'-rev-voc-fixture@example.invalid','',now(),now(),now()
FROM rev_voc_test_ids WHERE key IN ('owner_a','adviser_a','outsider_a','owner_b');
INSERT INTO public.workspaces(id,name,slug,created_by)
VALUES
((SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),'REV isolated test A','rev-voc-test-a-'||left(gen_random_uuid()::text,12),(SELECT id FROM rev_voc_test_ids WHERE key='owner_a')),
((SELECT id FROM rev_voc_test_ids WHERE key='workspace_b'),'REV isolated test B','rev-voc-test-b-'||left(gen_random_uuid()::text,12),(SELECT id FROM rev_voc_test_ids WHERE key='owner_b'));
INSERT INTO public.workspace_members(workspace_id,user_id,role)
VALUES
((SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'),'owner'),
((SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),(SELECT id FROM rev_voc_test_ids WHERE key='adviser_a'),'member'),
((SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),(SELECT id FROM rev_voc_test_ids WHERE key='outsider_a'),'member'),
((SELECT id FROM rev_voc_test_ids WHERE key='workspace_b'),(SELECT id FROM rev_voc_test_ids WHERE key='owner_b'),'owner');
INSERT INTO public.programme_hub_programmes(id,workspace_id,name,timezone,created_by_user_id,updated_by_user_id)
VALUES
((SELECT id FROM rev_voc_test_ids WHERE key='programme_a'),(SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),'Test Programme A','Europe/London',(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'),(SELECT id FROM rev_voc_test_ids WHERE key='owner_a')),
((SELECT id FROM rev_voc_test_ids WHERE key='programme_b'),(SELECT id FROM rev_voc_test_ids WHERE key='workspace_b'),'Test Programme B','Europe/London',(SELECT id FROM rev_voc_test_ids WHERE key='owner_b'),(SELECT id FROM rev_voc_test_ids WHERE key='owner_b'));
INSERT INTO public.programme_hub_advisers(workspace_id,programme_id,user_id,created_by_user_id,updated_by_user_id)
VALUES ((SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),(SELECT id FROM rev_voc_test_ids WHERE key='programme_a'),(SELECT id FROM rev_voc_test_ids WHERE key='adviser_a'),(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'),(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'));
INSERT INTO public.programme_hub_participants(id,workspace_id,programme_id,participant_key,preferred_name,case_reference,created_by_user_id,updated_by_user_id)
VALUES ((SELECT id FROM rev_voc_test_ids WHERE key='participant_a'),(SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),(SELECT id FROM rev_voc_test_ids WHERE key='programme_a'),'rev-test-'||left(gen_random_uuid()::text,12),'Fixture Only','fixture-case',(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'),(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'));
INSERT INTO public.programme_hub_participant_advisers(workspace_id,programme_id,participant_id,adviser_user_id,created_by_user_id,updated_by_user_id)
VALUES ((SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),(SELECT id FROM rev_voc_test_ids WHERE key='programme_a'),(SELECT id FROM rev_voc_test_ids WHERE key='participant_a'),(SELECT id FROM rev_voc_test_ids WHERE key='adviser_a'),(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'),(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'));
INSERT INTO public.programme_hub_vocational_templates(id,workspace_id,programme_id,title,status,sections,created_by_user_id,updated_by_user_id)
VALUES ((SELECT id FROM rev_voc_test_ids WHERE key='template_a'),(SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),(SELECT id FROM rev_voc_test_ids WHERE key='programme_a'),'Test vocational template','draft','[]'::jsonb,(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'),(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'));
INSERT INTO public.programme_hub_vocational_template_versions(id,workspace_id,template_id,version,title,sections,published_by_user_id)
VALUES ((SELECT id FROM rev_voc_test_ids WHERE key='template_version_a'),(SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),(SELECT id FROM rev_voc_test_ids WHERE key='template_a'),1,'Test vocational template','[]'::jsonb,(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'));
INSERT INTO public.programme_hub_vocational_assessments(id,workspace_id,programme_id,participant_id,template_version_id,created_by_user_id,updated_by_user_id)
VALUES ((SELECT id FROM rev_voc_test_ids WHERE key='assessment_a'),(SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),(SELECT id FROM rev_voc_test_ids WHERE key='programme_a'),(SELECT id FROM rev_voc_test_ids WHERE key='participant_a'),(SELECT id FROM rev_voc_test_ids WHERE key='template_version_a'),(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'),(SELECT id FROM rev_voc_test_ids WHERE key='owner_a'));
INSERT INTO rev_voc_test_ids(key,id) VALUES ('second_version',gen_random_uuid()),('second_assessment',gen_random_uuid());
UPDATE public.programme_hub_vocational_templates SET version=2 WHERE id=(SELECT id FROM rev_voc_test_ids WHERE key='template_a');
INSERT INTO public.programme_hub_vocational_template_versions(id,workspace_id,template_id,version,title,sections,published_by_user_id)
SELECT (SELECT id FROM rev_voc_test_ids WHERE key='second_version'),workspace_id,template_id,2,title,sections,published_by_user_id
FROM public.programme_hub_vocational_template_versions WHERE id=(SELECT id FROM rev_voc_test_ids WHERE key='template_version_a');
INSERT INTO public.programme_hub_vocational_assessments(id,workspace_id,programme_id,participant_id,template_version_id,created_by_user_id,updated_by_user_id)
SELECT (SELECT id FROM rev_voc_test_ids WHERE key='second_assessment'),workspace_id,programme_id,participant_id,
(SELECT id FROM rev_voc_test_ids WHERE key='second_version'),created_by_user_id,updated_by_user_id
FROM public.programme_hub_vocational_assessments WHERE id=(SELECT id FROM rev_voc_test_ids WHERE key='assessment_a');
GRANT SELECT ON rev_voc_test_ids TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE ass uuid; owner_a uuid; adviser_a uuid; outsider_a uuid; owner_b uuid; result jsonb;
BEGIN
 SELECT id INTO ass FROM rev_voc_test_ids WHERE key='assessment_a';
 SELECT id INTO owner_a FROM rev_voc_test_ids WHERE key='owner_a';
 SELECT id INTO adviser_a FROM rev_voc_test_ids WHERE key='adviser_a';
 SELECT id INTO outsider_a FROM rev_voc_test_ids WHERE key='outsider_a';
 SELECT id INTO owner_b FROM rev_voc_test_ids WHERE key='owner_b';
 PERFORM set_config('request.jwt.claim.sub',adviser_a::text,true);
 IF public.rev_voc_restricted_access_allowed(ass) THEN RAISE EXCEPTION 'FAIL adviser access before consent'; END IF;
 BEGIN
  PERFORM public.rev_voc_support_consent_record(ass,'test-evidence-001','Participant gave documented informed consent for this test');
  RAISE EXCEPTION 'FAIL adviser recorded consent';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.rev_voc_restricted_access_set(ass,adviser_a,'grant','Case support permission');
  RAISE EXCEPTION 'FAIL adviser self-granted access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS adviser cannot consent or self-grant';
 PERFORM set_config('request.jwt.claim.sub',outsider_a::text,true);
 IF public.rev_voc_restricted_access_allowed(ass) THEN RAISE EXCEPTION 'FAIL unassigned member access'; END IF;
 RAISE NOTICE 'PASS unassigned member denied';
 PERFORM set_config('request.jwt.claim.sub',owner_b::text,true);
 IF public.rev_voc_restricted_access_allowed(ass) THEN RAISE EXCEPTION 'FAIL cross-workspace access'; END IF;
 BEGIN
  PERFORM public.rev_voc_support_consent_record(ass,'test-evidence-002','Cross workspace attempted consent record');
  RAISE EXCEPTION 'FAIL cross-workspace consent write';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS cross-workspace denied';
 PERFORM set_config('request.jwt.claim.sub',owner_a::text,true);
 result:=public.rev_voc_assessment_selected_status((SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),(SELECT id FROM rev_voc_test_ids WHERE key='programme_a'),(SELECT id FROM rev_voc_test_ids WHERE key='participant_a'),ass);
 IF result->>'assessmentId' <> ass::text THEN RAISE EXCEPTION 'FAIL selected assessment replaced by newer snapshot'; END IF;
 BEGIN
 PERFORM public.rev_voc_assessment_selected_status((SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),(SELECT id FROM rev_voc_test_ids WHERE key='programme_b'),(SELECT id FROM rev_voc_test_ids WHERE key='participant_a'),ass);
 RAISE EXCEPTION 'FAIL foreign programme selected status';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 result:=public.rev_voc_support_access_status(ass);
 IF result->>'consent' <> 'none' OR result->'grants' <> '[]'::jsonb THEN RAISE EXCEPTION 'FAIL initial status'; END IF;
 result:=public.rev_voc_support_consent_record(ass,'evidence-test-003','Participant provided informed consent recorded in test evidence');
 IF result->>'status' IS DISTINCT FROM 'granted' THEN RAISE EXCEPTION 'FAIL consent not granted: %',result; END IF;
 result:=public.rev_voc_restricted_access_set(ass,adviser_a,'grant','Vocational support for participant');
 result:=public.rev_voc_support_access_status(ass);
 IF result->>'assessment_id' <> ass::text OR result->>'consent' <> 'granted' OR NOT (result->'grants' @> jsonb_build_array(adviser_a)) OR (SELECT count(*) FROM jsonb_object_keys(result)) <> 3 THEN RAISE EXCEPTION 'FAIL status metadata'; END IF;
 RAISE NOTICE 'PASS owner recorded consent and granted adviser access';
 PERFORM set_config('request.jwt.claim.sub',adviser_a::text,true);
 result:=public.rev_voc_assessment_selected_status((SELECT id FROM rev_voc_test_ids WHERE key='workspace_a'),(SELECT id FROM rev_voc_test_ids WHERE key='programme_a'),(SELECT id FROM rev_voc_test_ids WHERE key='participant_a'),ass);
 IF result->>'assessmentId' <> ass::text THEN RAISE EXCEPTION 'FAIL assigned adviser selected status'; END IF;
 IF NOT public.rev_voc_restricted_access_allowed(ass) THEN RAISE EXCEPTION 'FAIL assigned adviser denied despite grant'; END IF;
 BEGIN
 PERFORM public.rev_voc_support_access_status(ass);
 RAISE EXCEPTION 'FAIL adviser read manager metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS authorised adviser allowed';
 PERFORM set_config('request.jwt.claim.sub',owner_a::text,true);
 result:=public.rev_voc_restricted_access_set(ass,adviser_a,'revoke',NULL);
 PERFORM set_config('request.jwt.claim.sub',adviser_a::text,true);
 IF public.rev_voc_restricted_access_allowed(ass) THEN RAISE EXCEPTION 'FAIL access after grant revocation'; END IF;
 RAISE NOTICE 'PASS revoked adviser denied';
 PERFORM set_config('request.jwt.claim.sub',owner_a::text,true);
 result:=public.rev_voc_restricted_access_set(ass,adviser_a,'grant','Renewed participant support access');
 PERFORM set_config('request.jwt.claim.sub',adviser_a::text,true);
 IF NOT public.rev_voc_restricted_access_allowed(ass) THEN RAISE EXCEPTION 'FAIL regrant'; END IF;
 PERFORM set_config('request.jwt.claim.sub',owner_a::text,true);
 result:=public.rev_voc_support_consent_withdraw(ass,'withdrawal-evidence-004','Participant requested withdrawal of consent during a recorded meeting');
 IF result->>'status' IS DISTINCT FROM 'withdrawn' THEN RAISE EXCEPTION 'FAIL withdrawal: %',result; END IF;
 PERFORM set_config('request.jwt.claim.sub',adviser_a::text,true);
 IF public.rev_voc_restricted_access_allowed(ass) THEN RAISE EXCEPTION 'FAIL access after withdrawal'; END IF;
 PERFORM set_config('request.jwt.claim.sub',owner_a::text,true);
 result:=public.rev_voc_support_access_status(ass);
 IF result->>'consent' <> 'withdrawn' THEN RAISE EXCEPTION 'FAIL withdrawn status'; END IF;
 PERFORM set_config('request.jwt.claim.sub',owner_b::text,true);
 BEGIN
 PERFORM public.rev_voc_support_access_status(ass);
 RAISE EXCEPTION 'FAIL cross workspace status';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS withdrawal immediately denies access';
END $$;
RESET ROLE;
ROLLBACK;
