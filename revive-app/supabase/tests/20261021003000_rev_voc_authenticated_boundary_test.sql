-- Stage 3B5 authenticated negative boundary tests; LOCAL DB ONLY.
-- Runs in a transaction and always rolls back. No fixture data needed.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE
  f text;
  old_api boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    RAISE EXCEPTION 'Missing authenticated role';
  END IF;
  FOREACH f IN ARRAY ARRAY[
    'rev_voc_restricted_access_allowed(uuid)',
    'rev_voc_restricted_access_set(uuid,uuid,text,text)',
    'rev_voc_support_consent_record(uuid,text,text)',
    'rev_voc_support_consent_withdraw(uuid,text,text)'
  ] LOOP
    IF to_regprocedure('public.'||f) IS NULL THEN
      RAISE EXCEPTION 'Missing expected RPC %',f;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated','public.rev_voc_support_consent_withdraw(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Legacy unaudited withdrawal RPC still executable';
  END IF;
  RAISE NOTICE 'PASS RPC presence and legacy withdrawal disabled';
END $test$;

-- Test using the same SQL role as PostgREST, with no JWT identity.
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  unknown_id uuid := 'e61193a7-f20a-4a2f-b00d-1c91b03d9654';
  actor_id uuid := 'd15c1b6b-c1aa-49f4-b56b-c8b69d0a851e';
  denied boolean;
  err text;
BEGIN
  IF public.rev_voc_restricted_access_allowed(unknown_id) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Unknown assessment unexpectedly allowed';
  END IF;
  BEGIN
    PERFORM public.rev_voc_support_consent_record(unknown_id,'evidence-test-reference','Participant has explicitly agreed to this support');
    RAISE EXCEPTION 'FAIL unauthenticated consent record succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.rev_voc_restricted_access_set(unknown_id,actor_id,'grant','Documented support purpose');
    RAISE EXCEPTION 'FAIL unauthenticated grant succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.rev_voc_support_consent_withdraw(unknown_id,'withdrawal-evidence-reference','Participant requested withdrawal of consent');
    RAISE EXCEPTION 'FAIL unauthenticated withdrawal succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS authenticated SQL role with absent JWT cannot use operations';
END $test$;

-- Simulate an authenticated JWT identity that has no valid assessment.
SELECT set_config('request.jwt.claim.sub','d15c1b6b-c1aa-49f4-b56b-c8b69d0a851e',true);
DO $test$
DECLARE
  unknown_id uuid := 'e61193a7-f20a-4a2f-b00d-1c91b03d9654';
  actor_id uuid := 'd15c1b6b-c1aa-49f4-b56b-c8b69d0a851e';
BEGIN
  IF public.rev_voc_restricted_access_allowed(unknown_id) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Non-member actor allowed on unknown assessment';
  END IF;
  BEGIN
    PERFORM public.rev_voc_support_consent_record(unknown_id,'evidence-test-reference','Participant has explicitly agreed to this support');
    RAISE EXCEPTION 'FAIL non-member consent record succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.rev_voc_restricted_access_set(unknown_id,actor_id,'grant','Documented support purpose');
    RAISE EXCEPTION 'FAIL non-member grant succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.rev_voc_support_consent_withdraw(unknown_id,'withdrawal-evidence-reference','Participant requested withdrawal of consent');
    RAISE EXCEPTION 'FAIL non-member withdrawal succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS unknown-assessment denial with authenticated JWT identity';
END $test$;
RESET ROLE;
ROLLBACK;
