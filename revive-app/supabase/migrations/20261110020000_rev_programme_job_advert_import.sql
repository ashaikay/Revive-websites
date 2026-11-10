BEGIN;

ALTER TABLE public.programme_hub_vacancies
  ADD COLUMN source_text text,
  ADD COLUMN source_url text,
  ADD COLUMN source_added_at timestamptz,
  ADD COLUMN published_pay text,
  ADD COLUMN published_shifts text,
  ADD COLUMN closing_date date,
  ADD CONSTRAINT programme_hub_vacancies_source_text_length
    CHECK (source_text IS NULL OR length(source_text) BETWEEN 1 AND 20000),
  ADD CONSTRAINT programme_hub_vacancies_source_url_length
    CHECK (source_url IS NULL OR length(source_url) BETWEEN 1 AND 2000),
  ADD CONSTRAINT programme_hub_vacancies_published_pay_length
    CHECK (published_pay IS NULL OR length(published_pay) BETWEEN 1 AND 500),
  ADD CONSTRAINT programme_hub_vacancies_published_shifts_length
    CHECK (published_shifts IS NULL OR length(published_shifts) BETWEEN 1 AND 1000);

CREATE FUNCTION public.save_rev_programme_hub_job_advert_import(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_programme_id uuid,
  target_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  prior rev_programme_hub_private.write_requests;
  request_input jsonb;
  result jsonb;
  saved_id uuid;
  saved_version bigint;
  selected_employer_id uuid;
  selected_employer_contact_id uuid;
  stated_closing_date date;
  is_authorised boolean;
BEGIN
  IF target_workspace_id IS NULL OR initiating_user_id IS NULL OR target_request_id IS NULL
    OR target_programme_id IS NULL OR pg_catalog.jsonb_typeof(target_payload) <> 'object'
    OR NOT public.has_rev_module_access(target_workspace_id, initiating_user_id, 'programme')
  THEN
    RAISE EXCEPTION 'Valid programme job advert required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text, 0));
  PERFORM 1 FROM public.workspaces workspace WHERE workspace.id = target_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace unavailable'; END IF;

  request_input = pg_catalog.jsonb_build_object(
    'operation', 'job_advert_import',
    'programme_id', target_programme_id,
    'record_id', NULL,
    'expected_version', 0,
    'payload', target_payload
  );

  SELECT request.* INTO prior
  FROM rev_programme_hub_private.write_requests request
  WHERE request.request_id = target_request_id;
  IF FOUND THEN
    IF prior.workspace_id <> target_workspace_id
      OR prior.actor_user_id <> initiating_user_id
      OR prior.operation <> 'job_advert_import'
      OR prior.input <> request_input
    THEN
      RAISE EXCEPTION 'Programme request unavailable';
    END IF;
    RETURN prior.result;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members member
    WHERE member.workspace_id = target_workspace_id
      AND member.user_id = initiating_user_id
      AND member.status = 'active'
      AND (
        member.role IN ('owner', 'admin')
        OR EXISTS (
          SELECT 1
          FROM public.programme_hub_advisers adviser
          WHERE adviser.workspace_id = target_workspace_id
            AND adviser.programme_id = target_programme_id
            AND adviser.user_id = member.user_id
            AND adviser.active
        )
      )
  ) INTO is_authorised;
  IF NOT is_authorised THEN RAISE EXCEPTION 'Programme adviser required'; END IF;

  PERFORM 1
  FROM public.programme_hub_programmes programme
  WHERE programme.workspace_id = target_workspace_id
    AND programme.id = target_programme_id
    AND programme.active
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Programme unavailable'; END IF;

  IF NOT target_payload ?& ARRAY[
      'employerId', 'employerContactId', 'vacancyKey', 'title', 'workGeographyKey',
      'publishedPay', 'publishedShifts', 'requiredSkillKeys', 'closingDate',
      'sourceText', 'sourceUrl'
    ]
    OR target_payload - ARRAY[
      'employerId', 'employerContactId', 'vacancyKey', 'title', 'workGeographyKey',
      'publishedPay', 'publishedShifts', 'requiredSkillKeys', 'closingDate',
      'sourceText', 'sourceUrl'
    ] <> '{}'::jsonb
    OR pg_catalog.jsonb_typeof(target_payload->'employerId') <> 'string'
    OR pg_catalog.jsonb_typeof(target_payload->'employerContactId') <> 'string'
    OR pg_catalog.jsonb_typeof(target_payload->'vacancyKey') <> 'string'
    OR pg_catalog.jsonb_typeof(target_payload->'title') <> 'string'
    OR pg_catalog.jsonb_typeof(target_payload->'workGeographyKey') <> 'string'
    OR pg_catalog.jsonb_typeof(target_payload->'publishedPay') <> 'string'
    OR pg_catalog.jsonb_typeof(target_payload->'publishedShifts') <> 'string'
    OR pg_catalog.jsonb_typeof(target_payload->'requiredSkillKeys') <> 'array'
    OR pg_catalog.jsonb_typeof(target_payload->'closingDate') <> 'string'
    OR pg_catalog.jsonb_typeof(target_payload->'sourceText') <> 'string'
    OR pg_catalog.jsonb_typeof(target_payload->'sourceUrl') <> 'string'
    OR coalesce(length(target_payload->>'vacancyKey'), 0) NOT BETWEEN 1 AND 120
    OR target_payload->>'vacancyKey' <> pg_catalog.btrim(target_payload->>'vacancyKey')
    OR coalesce(length(target_payload->>'title'), 0) NOT BETWEEN 1 AND 200
    OR target_payload->>'title' <> pg_catalog.btrim(target_payload->>'title')
    OR length(target_payload->>'workGeographyKey') > 120
    OR target_payload->>'workGeographyKey' <> pg_catalog.btrim(target_payload->>'workGeographyKey')
    OR length(target_payload->>'publishedPay') > 500
    OR target_payload->>'publishedPay' <> pg_catalog.btrim(target_payload->>'publishedPay')
    OR length(target_payload->>'publishedShifts') > 1000
    OR target_payload->>'publishedShifts' <> pg_catalog.btrim(target_payload->>'publishedShifts')
    OR NOT rev_programme_hub_private.valid_tags(
      ARRAY(SELECT pg_catalog.jsonb_array_elements_text(target_payload->'requiredSkillKeys'))
    )
    OR coalesce(length(pg_catalog.btrim(target_payload->>'sourceText')), 0) < 1
    OR length(target_payload->>'sourceText') > 20000
    OR length(target_payload->>'sourceUrl') > 2000
    OR (
      target_payload->>'sourceUrl' <> ''
      AND target_payload->>'sourceUrl' !~ '^https?://[^[:space:]]+$'
    )
    OR (
      target_payload->>'closingDate' <> ''
      AND (
        target_payload->>'closingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        OR pg_catalog.to_char(
          pg_catalog.to_date(target_payload->>'closingDate', 'YYYY-MM-DD'),
          'YYYY-MM-DD'
        ) <> target_payload->>'closingDate'
      )
    )
  THEN
    RAISE EXCEPTION 'Valid reviewed job advert required';
  END IF;

  selected_employer_id = (target_payload->>'employerId')::uuid;
  selected_employer_contact_id = NULLIF(target_payload->>'employerContactId', '')::uuid;
  stated_closing_date = NULLIF(target_payload->>'closingDate', '')::date;

  PERFORM 1
  FROM public.programme_hub_employers employer
  WHERE employer.workspace_id = target_workspace_id
    AND employer.programme_id = target_programme_id
    AND employer.id = selected_employer_id
    AND employer.active
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Programme employer required'; END IF;

  IF selected_employer_contact_id IS NOT NULL THEN
    PERFORM 1
    FROM public.programme_hub_employer_contacts contact
    WHERE contact.workspace_id = target_workspace_id
      AND contact.programme_id = target_programme_id
      AND contact.employer_id = selected_employer_id
      AND contact.id = selected_employer_contact_id
      AND contact.active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Programme employer contact required'; END IF;
  END IF;

  INSERT INTO public.programme_hub_vacancies (
    workspace_id, programme_id, employer_id, employer_contact_id, vacancy_key, title,
    work_geography_key, required_skill_keys, desired_skill_keys, source_text, source_url,
    source_added_at, published_pay, published_shifts, closing_date, active,
    created_by_user_id, updated_by_user_id
  ) VALUES (
    target_workspace_id, target_programme_id, selected_employer_id, selected_employer_contact_id,
    target_payload->>'vacancyKey', target_payload->>'title',
    NULLIF(target_payload->>'workGeographyKey', ''),
    ARRAY(SELECT pg_catalog.jsonb_array_elements_text(target_payload->'requiredSkillKeys')),
    '{}'::text[], target_payload->>'sourceText', NULLIF(target_payload->>'sourceUrl', ''),
    pg_catalog.now(), NULLIF(target_payload->>'publishedPay', ''),
    NULLIF(target_payload->>'publishedShifts', ''), stated_closing_date, true,
    initiating_user_id, initiating_user_id
  )
  RETURNING id, version INTO saved_id, saved_version;

  result = pg_catalog.jsonb_build_object(
    'operation', 'job_advert_import',
    'record_id', saved_id,
    'workspace_id', target_workspace_id,
    'programme_id', target_programme_id,
    'version', saved_version
  );

  INSERT INTO public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) VALUES (
    target_workspace_id, initiating_user_id, 'user',
    'programme_hub.job_advert_import.created', 'programme_hub_vacancy', saved_id,
    pg_catalog.jsonb_build_object(
      'request_id', target_request_id,
      'programme_id', target_programme_id,
      'previous_version', 0,
      'version', saved_version,
      'source_url_recorded', target_payload->>'sourceUrl' <> ''
    )
  );

  INSERT INTO rev_programme_hub_private.write_requests (
    request_id, workspace_id, actor_user_id, operation, input, result
  ) VALUES (
    target_request_id, target_workspace_id, initiating_user_id,
    'job_advert_import', request_input, result
  );

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_rev_programme_hub_job_advert_import(uuid, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_rev_programme_hub_job_advert_import(uuid, uuid, uuid, uuid, jsonb)
  TO service_role;

COMMIT;
