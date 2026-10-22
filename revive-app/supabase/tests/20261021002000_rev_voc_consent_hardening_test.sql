-- Read-only/catalog + unauthenticated execution tests; no participant fixtures are modified.
DO $test$
DECLARE fn text; allowed boolean;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
    AND tablename='programme_hub_vocational_restricted_access_grants'
    AND indexname='rev_voc_one_active_restricted_grant') THEN
    RAISE EXCEPTION 'Missing unique active grant index'; END IF;
 IF has_function_privilege('authenticated',
    'public.rev_voc_support_consent_withdraw(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Legacy withdrawal RPC remains callable'; END IF;
 IF NOT has_function_privilege('authenticated',
    'public.rev_voc_support_consent_withdraw(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Evidence-backed withdrawal RPC not callable'; END IF;
 SELECT pg_get_functiondef(p.oid) INTO fn FROM pg_proc p
 WHERE p.oid='public.rev_voc_restricted_access_allowed(uuid)'::regprocedure;
 IF position('restricted_vocational_support' IN fn)=0 OR position('withdrawn_at IS NULL' IN fn)=0 THEN
    RAISE EXCEPTION 'Missing consent scope or withdrawal guard'; END IF;
 SELECT pg_get_functiondef(p.oid) INTO fn FROM pg_proc p
 WHERE p.oid='public.rev_voc_restricted_access_set(uuid,uuid,text,text)'::regprocedure;
 IF position('restricted_vocational_support' IN fn)=0 THEN
    RAISE EXCEPTION 'Grant operation missing consent scope'; END IF;
 SELECT pg_get_functiondef(p.oid) INTO fn FROM pg_proc p
 WHERE p.oid='public.rev_voc_support_consent_withdraw(uuid,text,text)'::regprocedure;
 IF position('p_evidence_reference' IN fn)=0 OR position('consent_withdrawn' IN fn)=0 THEN
    RAISE EXCEPTION 'Withdrawal operation missing evidence or audit'; END IF;
 SELECT public.rev_voc_restricted_access_allowed(gen_random_uuid()) INTO allowed;
 IF allowed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Unknown assessment must deny access'; END IF;
 RAISE NOTICE 'PASS Stage 3B5 consent hardening: schema, legacy RPC lockdown and unknown assessment denial';
END $test$;
