-- Stage 3B5: tighten the existing ordinary-assessment boundary.
-- No sensitive answers are enabled by this migration. No schema/data changes.
-- Apply to local development only after review; never reset or push remotely.
BEGIN;
CREATE OR REPLACE FUNCTION public.rev_voc_is_ordinary_question(section_data jsonb, question_data jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT pg_catalog.jsonb_typeof(section_data) = 'object'
    AND pg_catalog.jsonb_typeof(question_data) = 'object'
    AND question_data ? 'sensitive'
    AND question_data->>'sensitive' = 'false'
    AND COALESCE(section_data->>'title','') !~* '(medical|diagnos|disabilit|mental[[:space:]-]*health|safeguard|domestic[[:space:]-]*abuse|ethnic|religio|sexual[[:space:]-]*orient|gender[[:space:]-]*identit|criminal|offen[cs]e|conviction|sentenc|prison|probation|resettlement|restricted|substance[[:space:]-]*misuse|addiction|pregnan|immigration[[:space:]-]*status|nationalit)'
    AND COALESCE(section_data->>'description','') !~* '(medical|diagnos|disabilit|mental[[:space:]-]*health|safeguard|domestic[[:space:]-]*abuse|ethnic|religio|sexual[[:space:]-]*orient|gender[[:space:]-]*identit|criminal|offen[cs]e|conviction|sentenc|prison|probation|resettlement|restricted|substance[[:space:]-]*misuse|addiction|pregnan|immigration[[:space:]-]*status|nationalit)'
    AND COALESCE(question_data->>'label','') !~* '(medical|diagnos|disabilit|mental[[:space:]-]*health|safeguard|domestic[[:space:]-]*abuse|ethnic|religio|sexual[[:space:]-]*orient|gender[[:space:]-]*identit|criminal|offen[cs]e|conviction|sentenc|prison|probation|resettlement|restricted|substance[[:space:]-]*misuse|addiction|pregnan|immigration[[:space:]-]*status|nationalit)'
    AND COALESCE(question_data->>'description','') !~* '(medical|diagnos|disabilit|mental[[:space:]-]*health|safeguard|domestic[[:space:]-]*abuse|ethnic|religio|sexual[[:space:]-]*orient|gender[[:space:]-]*identit|criminal|offen[cs]e|conviction|sentenc|prison|probation|resettlement|restricted|substance[[:space:]-]*misuse|addiction|pregnan|immigration[[:space:]-]*status|nationalit)';
$fn$;
REVOKE ALL ON FUNCTION public.rev_voc_is_ordinary_question(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rev_voc_is_ordinary_question(jsonb,jsonb) TO service_role;
COMMIT;
