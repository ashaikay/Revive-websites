-- Run against LOCAL Supabase after applying the foundation migration.
-- No test data is created; all assertions are read-only.
DO $test$
DECLARE
  table_name text;
  role_name text;
  row_security_enabled boolean;
  policy_count integer;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'programme_hub_vocational_support_consents',
    'programme_hub_vocational_restricted_access_grants',
    'programme_hub_vocational_restricted_audit',
    'programme_hub_vocational_restricted_answers'
  ] LOOP
    SELECT relrowsecurity INTO row_security_enabled
    FROM pg_class WHERE oid = ('public.' || table_name)::regclass;
    IF row_security_enabled IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'FAIL RLS disabled: %', table_name;
    END IF;
    SELECT count(*) INTO policy_count FROM pg_policies
    WHERE schemaname='public' AND tablename=table_name;
    IF policy_count <> 0 THEN
      RAISE EXCEPTION 'FAIL unexpected RLS policies: %', table_name;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_table_privilege(role_name,'public.' || table_name,'SELECT')
         OR has_table_privilege(role_name,'public.' || table_name,'INSERT')
         OR has_table_privilege(role_name,'public.' || table_name,'UPDATE')
         OR has_table_privilege(role_name,'public.' || table_name,'DELETE') THEN
        RAISE EXCEPTION 'FAIL direct table privileges: % on %',role_name,table_name;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'PASS Stage 3B5 consent foundation: four tables deny direct application access';
END;
$test$;
