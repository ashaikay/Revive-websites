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
DO $$
DECLARE ws uuid; prog uuid; person uuid; owner_id uuid; adviser_id uuid; assignment_id uuid; expected bigint; req uuid := gen_random_uuid(); result jsonb; replay jsonb;
BEGIN
 SELECT id INTO ws FROM rev_voc_test_ids WHERE key='workspace_a';
 SELECT id INTO prog FROM rev_voc_test_ids WHERE key='programme_a';
 SELECT id INTO person FROM rev_voc_test_ids WHERE key='participant_a';
 SELECT id INTO owner_id FROM rev_voc_test_ids WHERE key='owner_a';
 SELECT id INTO adviser_id FROM rev_voc_test_ids WHERE key='adviser_a';
 SELECT id,version INTO assignment_id,expected FROM public.programme_hub_participant_advisers WHERE workspace_id=ws AND participant_id=person;
 result := public.save_rev_programme_hub_record('participant_adviser',ws,owner_id,req,prog,assignment_id,expected,jsonb_build_object('participantId',person,'adviserUserId',adviser_id,'active',false));
 IF (result->>'version')::bigint <> expected+1 THEN RAISE EXCEPTION 'FAIL version'; END IF;
 replay := public.save_rev_programme_hub_record('participant_adviser',ws,owner_id,req,prog,assignment_id,expected,jsonb_build_object('participantId',person,'adviserUserId',adviser_id,'active',false));
 IF result <> replay THEN RAISE EXCEPTION 'FAIL retained request replay'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.programme_hub_participant_advisers WHERE id=assignment_id AND NOT active AND version=expected+1) THEN RAISE EXCEPTION 'FAIL assignment history'; END IF;
 IF (SELECT count(*) FROM public.audit_log WHERE resource_id=assignment_id AND metadata->>'request_id'=req::text) <> 1 THEN RAISE EXCEPTION 'FAIL duplicate audit'; END IF;
 BEGIN
 PERFORM public.save_rev_programme_hub_record('participant_adviser',ws,owner_id,req,prog,assignment_id,expected,jsonb_build_object('participantId',person,'adviserUserId',adviser_id,'active',true));
 RAISE EXCEPTION 'FAIL changed replay accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Programme request unavailable' THEN RAISE; END IF; END;
 BEGIN
 PERFORM public.save_rev_programme_hub_record('participant_adviser',ws,owner_id,gen_random_uuid(),prog,assignment_id,expected,jsonb_build_object('participantId',person,'adviserUserId',adviser_id,'active',true));
 RAISE EXCEPTION 'FAIL stale version accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Caseload assignment unavailable or changed' THEN RAISE; END IF; END;
 result := public.save_rev_programme_hub_record('participant_adviser',ws,owner_id,gen_random_uuid(),prog,assignment_id,expected+1,jsonb_build_object('participantId',person,'adviserUserId',adviser_id,'active',true));
 IF (result->>'version')::bigint <> expected+2 THEN RAISE EXCEPTION 'FAIL reactivation'; END IF;
 RAISE NOTICE 'PASS unassignment, exact replay, audit history, changed retry, stale version and reactivation';
END $$;
ROLLBACK;
