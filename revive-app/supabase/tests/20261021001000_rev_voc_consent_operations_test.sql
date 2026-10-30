-- Read-only catalog assertions and unauthenticated boundary tests.
DO $test$
DECLARE f text; n text; t text;
BEGIN
 FOREACH n IN ARRAY ARRAY['rev_voc_support_consent_record','rev_voc_support_consent_withdraw','rev_voc_restricted_access_set','rev_voc_restricted_access_allowed'] LOOP
   SELECT pg_get_functiondef(p.oid) INTO f FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname=n;
   IF f IS NULL OR position('SECURITY DEFINER' IN f)=0 THEN RAISE EXCEPTION 'FAIL missing secure function %',n; END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['programme_hub_vocational_support_consents','programme_hub_vocational_restricted_access_grants','programme_hub_vocational_restricted_audit','programme_hub_vocational_restricted_answers'] LOOP
   IF has_table_privilege('authenticated','public.'||t,'SELECT') OR has_table_privilege('anon','public.'||t,'SELECT') THEN
      RAISE EXCEPTION 'FAIL direct read privilege %',t; END IF;
 END LOOP;
 IF public.rev_voc_restricted_access_allowed('00000000-0000-0000-0000-000000000000'::uuid) THEN
   RAISE EXCEPTION 'FAIL unauthenticated access'; END IF;
 RAISE NOTICE 'PASS Stage 3B5 consent operations catalog and deny-by-default checks';
END $test$;
