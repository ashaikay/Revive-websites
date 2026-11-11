-- Recognise clear certificate and licence questions as employment-evidence candidates.
-- Function definition only; templates, assessments, answers and history remain unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.rev_voc_is_matching_candidate_question(section_data jsonb, question_data jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT public.rev_voc_is_ordinary_question(section_data, question_data)
    AND (
      COALESCE(section_data->>'title','') || ' ' ||
      COALESCE(section_data->>'description','') || ' ' ||
      COALESCE(question_data->>'label','') || ' ' ||
      COALESCE(question_data->>'description','')
    ) ~* '(skills?|experience|qualifications?|certificates?|licen[cs]es?|training|sectors?|industr(y|ies)|career|job|role|occupation|employment[[:space:]]+(goal|aspiration|outcome)|(kind|type)[[:space:]]+of[[:space:]]+work|work[[:space:]]+(interest|preference)|work[[:space:]]+(would|do)[[:space:]]+you[[:space:]]+(like|want|prefer|explore))'
    AND (
      COALESCE(section_data->>'title','') || ' ' ||
      COALESCE(section_data->>'description','') || ' ' ||
      COALESCE(question_data->>'label','') || ' ' ||
      COALESCE(question_data->>'description','')
    ) !~* '(contact|phone|email|address|date[[:space:]]+of[[:space:]]+birth|dob|national[[:space:]]+insurance|emergency[[:space:]]+contact|next[[:space:]]+of[[:space:]]+kin|support|help|barrier|housing|benefit|appointment|childcare|personal[[:space:]]+detail)';
$fn$;
REVOKE ALL ON FUNCTION public.rev_voc_is_matching_candidate_question(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rev_voc_is_matching_candidate_question(jsonb,jsonb) TO service_role;

COMMIT;
