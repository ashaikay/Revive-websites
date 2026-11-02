BEGIN;

-- Versioned employment action plan (first increment).
-- One plan per Service user per programme. Every save appends an immutable
-- revision linked to a published vocational questionnaire version. Tables are
-- not directly readable or writable by browsers; access is only through the
-- authorised RPCs below, which reuse the vocational caseload authorisation.
-- Revisions hold staff-recorded goals and actions only: no questionnaire
-- answers, restricted answers or consent data are copied into the plan.

CREATE TABLE public.programme_hub_action_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  programme_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  current_revision integer NOT NULL CHECK (current_revision >= 1),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, programme_id, participant_id),
  FOREIGN KEY (workspace_id, programme_id, participant_id)
    REFERENCES public.programme_hub_participants(workspace_id, programme_id, id),
  FOREIGN KEY (workspace_id, created_by_user_id) REFERENCES public.workspace_members(workspace_id, user_id),
  FOREIGN KEY (workspace_id, updated_by_user_id) REFERENCES public.workspace_members(workspace_id, user_id)
);

CREATE TABLE public.programme_hub_action_plan_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  template_version_id uuid NOT NULL REFERENCES public.programme_hub_vocational_template_versions(id),
  employment_goal text NOT NULL
    CHECK (length(employment_goal) BETWEEN 1 AND 500 AND employment_goal = btrim(employment_goal)),
  actions jsonb NOT NULL CHECK (jsonb_typeof(actions) = 'array'),
  saved_by_user_id uuid NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL UNIQUE,
  UNIQUE (plan_id, revision),
  FOREIGN KEY (workspace_id, plan_id) REFERENCES public.programme_hub_action_plans(workspace_id, id),
  FOREIGN KEY (workspace_id, saved_by_user_id) REFERENCES public.workspace_members(workspace_id, user_id)
);

CREATE TABLE public.programme_hub_action_plan_write_requests (
  request_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  actor_user_id uuid NOT NULL,
  input jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, actor_user_id) REFERENCES public.workspace_members(workspace_id, user_id)
);

ALTER TABLE public.programme_hub_action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programme_hub_action_plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programme_hub_action_plan_write_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.programme_hub_action_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.programme_hub_action_plan_revisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.programme_hub_action_plan_write_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.programme_hub_action_plans,
  public.programme_hub_action_plan_revisions TO service_role;

-- History is never overwritten or removed.
CREATE OR REPLACE FUNCTION public.rev_action_plan_revision_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  RAISE EXCEPTION 'Action plan revisions are read-only' USING ERRCODE = '42501';
END;
$fn$;
CREATE TRIGGER rev_action_plan_revision_immutable
BEFORE UPDATE OR DELETE ON public.programme_hub_action_plan_revisions
FOR EACH ROW EXECUTE FUNCTION public.rev_action_plan_revision_immutable();

CREATE OR REPLACE FUNCTION public.rev_action_plan_no_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  RAISE EXCEPTION 'Action plans cannot be deleted' USING ERRCODE = '42501';
END;
$fn$;
CREATE TRIGGER rev_action_plan_no_delete
BEFORE DELETE ON public.programme_hub_action_plans
FOR EACH ROW EXECUTE FUNCTION public.rev_action_plan_no_delete();

-- Same current-questionnaire selection as rev_voc_assessment_status.
CREATE OR REPLACE FUNCTION public.rev_action_plan_current_questionnaire(
  target_workspace_id uuid, target_programme_id uuid
) RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $fn$
  SELECT tv.id
  FROM public.programme_hub_vocational_template_versions tv
  JOIN public.programme_hub_vocational_templates t
    ON t.id = tv.template_id AND t.workspace_id = tv.workspace_id
  WHERE tv.workspace_id = target_workspace_id
    AND t.programme_id = target_programme_id
    AND t.status = 'published'
  ORDER BY tv.published_at DESC, tv.id DESC
  LIMIT 1;
$fn$;

-- An active Employment Specialist currently assigned to this Service user.
CREATE OR REPLACE FUNCTION public.rev_action_plan_specialist_assigned(
  target_workspace_id uuid, target_programme_id uuid, target_participant_id uuid, target_user_id uuid
) RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members member
    JOIN public.programme_hub_advisers adviser
      ON adviser.workspace_id = member.workspace_id
     AND adviser.programme_id = target_programme_id
     AND adviser.user_id = member.user_id
     AND adviser.active
    JOIN public.programme_hub_participant_advisers assignment
      ON assignment.workspace_id = adviser.workspace_id
     AND assignment.programme_id = adviser.programme_id
     AND assignment.adviser_user_id = adviser.user_id
     AND assignment.participant_id = target_participant_id
     AND assignment.active
    WHERE member.workspace_id = target_workspace_id
      AND member.user_id = target_user_id
      AND member.status = 'active'
  );
$fn$;

CREATE OR REPLACE FUNCTION public.rev_action_plan_validate_actions(target_actions jsonb)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = '' AS $fn$
DECLARE
  item jsonb;
  seen text[] := ARRAY[]::text[];
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  allowed_keys constant text[] := ARRAY['id','description','ownerType','ownerUserId','status','targetDate'];
  item_keys text[];
BEGIN
  IF target_actions IS NULL OR pg_catalog.jsonb_typeof(target_actions) <> 'array'
    OR pg_catalog.jsonb_array_length(target_actions) > 20 THEN
    RAISE EXCEPTION 'Invalid action plan actions' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(target_actions) LOOP
    IF pg_catalog.jsonb_typeof(item) <> 'object' THEN
      RAISE EXCEPTION 'Invalid action plan actions' USING ERRCODE = '22023';
    END IF;
    item_keys := ARRAY(SELECT pg_catalog.jsonb_object_keys(item));
    IF NOT (item_keys @> allowed_keys AND item_keys <@ allowed_keys)
      OR pg_catalog.jsonb_typeof(item->'id') <> 'string'
      OR (item->>'id') !~ uuid_pattern
      OR (item->>'id') = ANY (seen)
      OR pg_catalog.jsonb_typeof(item->'description') <> 'string'
      OR length(item->>'description') NOT BETWEEN 1 AND 300
      OR (item->>'description') <> btrim(item->>'description')
      OR pg_catalog.jsonb_typeof(item->'status') <> 'string'
      OR (item->>'status') NOT IN ('not_started', 'in_progress', 'completed')
      OR NOT (
        ((item->>'ownerType') = 'service_user' AND pg_catalog.jsonb_typeof(item->'ownerUserId') = 'null')
        OR ((item->>'ownerType') = 'employment_specialist'
          AND pg_catalog.jsonb_typeof(item->'ownerUserId') = 'string'
          AND (item->>'ownerUserId') ~ uuid_pattern)
      )
      OR NOT (
        pg_catalog.jsonb_typeof(item->'targetDate') = 'null'
        OR (pg_catalog.jsonb_typeof(item->'targetDate') = 'string'
          AND (item->>'targetDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      ) THEN
      RAISE EXCEPTION 'Invalid action plan actions' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.jsonb_typeof(item->'targetDate') = 'string' THEN
      BEGIN
        IF pg_catalog.to_char((item->>'targetDate')::date, 'YYYY-MM-DD') <> (item->>'targetDate') THEN
          RAISE EXCEPTION 'Invalid action target date' USING ERRCODE = '22023';
        END IF;
      EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
        RAISE EXCEPTION 'Invalid action target date' USING ERRCODE = '22023';
      END;
    END IF;
    seen := seen || (item->>'id');
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rev_action_plan_read(
  target_workspace_id uuid, target_programme_id uuid, target_participant_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  plan public.programme_hub_action_plans%ROWTYPE;
  current_version public.programme_hub_vocational_template_versions%ROWTYPE;
  latest public.programme_hub_action_plan_revisions%ROWTYPE;
  latest_actions jsonb := '[]'::jsonb;
  revisions jsonb := '[]'::jsonb;
  specialists jsonb;
BEGIN
  IF NOT public.rev_voc_assessment_authorised(target_workspace_id, target_programme_id, target_participant_id) THEN
    RAISE EXCEPTION 'Not authorised for participant action plan' USING ERRCODE = '42501';
  END IF;

  SELECT tv.* INTO current_version
  FROM public.programme_hub_vocational_template_versions tv
  WHERE tv.id = public.rev_action_plan_current_questionnaire(target_workspace_id, target_programme_id);

  SELECT COALESCE(pg_catalog.jsonb_agg(assignment.adviser_user_id ORDER BY assignment.adviser_user_id), '[]'::jsonb)
    INTO specialists
  FROM public.programme_hub_participant_advisers assignment
  WHERE assignment.workspace_id = target_workspace_id
    AND assignment.programme_id = target_programme_id
    AND assignment.participant_id = target_participant_id
    AND assignment.active
    AND public.rev_action_plan_specialist_assigned(
      target_workspace_id, target_programme_id, target_participant_id, assignment.adviser_user_id);

  SELECT p.* INTO plan
  FROM public.programme_hub_action_plans p
  WHERE p.workspace_id = target_workspace_id
    AND p.programme_id = target_programme_id
    AND p.participant_id = target_participant_id;

  IF plan.id IS NOT NULL THEN
    SELECT r.* INTO latest
    FROM public.programme_hub_action_plan_revisions r
    WHERE r.workspace_id = target_workspace_id AND r.plan_id = plan.id AND r.revision = plan.current_revision;

    -- The owner is preserved as recorded; a change in assignment is flagged, never replaced.
    SELECT COALESCE(pg_catalog.jsonb_agg(
      action.value || pg_catalog.jsonb_build_object('ownerNeedsReview',
        (action.value->>'ownerType') = 'employment_specialist'
        AND NOT public.rev_action_plan_specialist_assigned(
          target_workspace_id, target_programme_id, target_participant_id, (action.value->>'ownerUserId')::uuid))
      ORDER BY action.ordinality), '[]'::jsonb)
      INTO latest_actions
    FROM pg_catalog.jsonb_array_elements(latest.actions) WITH ORDINALITY AS action(value, ordinality);

    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'revision', r.revision,
      'employmentGoal', r.employment_goal,
      'actions', CASE WHEN r.revision = latest.revision THEN latest_actions ELSE r.actions END,
      'templateVersionId', r.template_version_id,
      'questionnaireTitle', tv.title,
      'questionnaireVersion', tv.version,
      'savedByUserId', r.saved_by_user_id,
      'savedAt', r.saved_at
    ) ORDER BY r.revision DESC), '[]'::jsonb)
      INTO revisions
    FROM public.programme_hub_action_plan_revisions r
    JOIN public.programme_hub_vocational_template_versions tv ON tv.id = r.template_version_id
    WHERE r.workspace_id = target_workspace_id AND r.plan_id = plan.id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'plan', CASE WHEN plan.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'planId', plan.id, 'currentRevision', plan.current_revision, 'updatedAt', plan.updated_at) END,
    'revisions', revisions,
    'currentQuestionnaire', CASE WHEN current_version.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'templateVersionId', current_version.id, 'title', current_version.title, 'version', current_version.version) END,
    'reviewNeeded', latest.id IS NOT NULL AND current_version.id IS NOT NULL
      AND latest.template_version_id <> current_version.id,
    'assignedSpecialistIds', specialists
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rev_action_plan_save(
  target_workspace_id uuid, target_programme_id uuid, target_participant_id uuid,
  target_request_id uuid, expected_revision integer, target_template_version_id uuid,
  target_goal text, target_actions jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  actor uuid := auth.uid();
  request_input jsonb;
  prior public.programme_hub_action_plan_write_requests%ROWTYPE;
  plan public.programme_hub_action_plans%ROWTYPE;
  previous public.programme_hub_action_plan_revisions%ROWTYPE;
  current_version_id uuid;
  next_revision integer;
  saved public.programme_hub_action_plan_revisions%ROWTYPE;
  item jsonb;
  result_value jsonb;
BEGIN
  IF actor IS NULL OR target_workspace_id IS NULL OR target_programme_id IS NULL
    OR target_participant_id IS NULL OR target_request_id IS NULL
    OR NOT public.rev_voc_assessment_authorised(target_workspace_id, target_programme_id, target_participant_id) THEN
    RAISE EXCEPTION 'Not authorised for participant action plan' USING ERRCODE = '42501';
  END IF;
  IF expected_revision IS NULL OR expected_revision < 0 OR target_template_version_id IS NULL
    OR target_goal IS NULL OR length(target_goal) NOT BETWEEN 1 AND 500 OR target_goal <> btrim(target_goal) THEN
    RAISE EXCEPTION 'Invalid action plan' USING ERRCODE = '22023';
  END IF;
  PERFORM public.rev_action_plan_validate_actions(target_actions);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('rev_action_plan:' || target_participant_id::text, 0));

  request_input := pg_catalog.jsonb_build_object(
    'programmeId', target_programme_id, 'participantId', target_participant_id,
    'expectedRevision', expected_revision, 'templateVersionId', target_template_version_id,
    'goal', target_goal, 'actions', target_actions);
  SELECT r.* INTO prior FROM public.programme_hub_action_plan_write_requests r
  WHERE r.request_id = target_request_id;
  IF FOUND THEN
    IF prior.workspace_id <> target_workspace_id OR prior.actor_user_id <> actor
      OR prior.input <> request_input THEN
      RAISE EXCEPTION 'Request ID already used' USING ERRCODE = '40001';
    END IF;
    RETURN prior.result;
  END IF;

  PERFORM 1
  FROM public.programme_hub_participants participant
  JOIN public.programme_hub_programmes programme
    ON programme.workspace_id = participant.workspace_id
   AND programme.id = participant.programme_id
   AND programme.active
  WHERE participant.workspace_id = target_workspace_id
    AND participant.programme_id = target_programme_id
    AND participant.id = target_participant_id
    AND participant.active
  FOR SHARE OF participant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Participant unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT p.* INTO plan FROM public.programme_hub_action_plans p
  WHERE p.workspace_id = target_workspace_id AND p.programme_id = target_programme_id
    AND p.participant_id = target_participant_id
  FOR UPDATE;
  IF plan.id IS NULL THEN
    IF expected_revision <> 0 THEN
      RAISE EXCEPTION 'Action plan changed' USING ERRCODE = '40001';
    END IF;
  ELSE
    IF expected_revision <> plan.current_revision THEN
      RAISE EXCEPTION 'Action plan changed' USING ERRCODE = '40001';
    END IF;
    SELECT r.* INTO previous FROM public.programme_hub_action_plan_revisions r
    WHERE r.workspace_id = target_workspace_id AND r.plan_id = plan.id AND r.revision = plan.current_revision;
  END IF;

  -- A revision links to the current questionnaire, or keeps the plan's existing link
  -- until a reviewer chooses to move it. Newer questionnaires never rewrite the plan.
  current_version_id := public.rev_action_plan_current_questionnaire(target_workspace_id, target_programme_id);
  IF target_template_version_id IS DISTINCT FROM current_version_id
    AND (previous.id IS NULL OR target_template_version_id <> previous.template_version_id) THEN
    RAISE EXCEPTION 'Action plan questionnaire link unavailable' USING ERRCODE = '22023';
  END IF;

  -- An Employment Specialist owner must be assigned, unless the same action keeps
  -- the owner already recorded in history (flagged for review, never replaced).
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(target_actions) LOOP
    IF (item->>'ownerType') = 'employment_specialist'
      AND NOT public.rev_action_plan_specialist_assigned(
        target_workspace_id, target_programme_id, target_participant_id, (item->>'ownerUserId')::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(previous.actions, '[]'::jsonb)) earlier(value)
        WHERE earlier.value->>'id' = item->>'id'
          AND earlier.value->>'ownerType' = 'employment_specialist'
          AND earlier.value->>'ownerUserId' = item->>'ownerUserId'
      ) THEN
      RAISE EXCEPTION 'Action owner must be an assigned Employment Specialist' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF plan.id IS NULL THEN
    INSERT INTO public.programme_hub_action_plans (
      workspace_id, programme_id, participant_id, current_revision, created_by_user_id, updated_by_user_id
    ) VALUES (
      target_workspace_id, target_programme_id, target_participant_id, 1, actor, actor
    ) RETURNING * INTO plan;
    next_revision := 1;
  ELSE
    next_revision := plan.current_revision + 1;
    UPDATE public.programme_hub_action_plans
      SET current_revision = next_revision, updated_by_user_id = actor, updated_at = now()
      WHERE workspace_id = target_workspace_id AND id = plan.id
      RETURNING * INTO plan;
  END IF;

  INSERT INTO public.programme_hub_action_plan_revisions (
    workspace_id, plan_id, revision, template_version_id, employment_goal, actions, saved_by_user_id, request_id
  ) VALUES (
    target_workspace_id, plan.id, next_revision, target_template_version_id, target_goal, target_actions, actor, target_request_id
  ) RETURNING * INTO saved;

  result_value := pg_catalog.jsonb_build_object(
    'planId', plan.id, 'revision', saved.revision,
    'templateVersionId', saved.template_version_id, 'savedAt', saved.saved_at);

  -- Audit metadata excludes free-text goal and action content.
  INSERT INTO public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) VALUES (
    target_workspace_id, actor, 'user', 'programme_hub.action_plan.revision_saved',
    'programme_hub_action_plan', plan.id,
    pg_catalog.jsonb_build_object(
      'request_id', target_request_id, 'programme_id', target_programme_id,
      'participant_id', target_participant_id, 'revision', saved.revision,
      'template_version_id', saved.template_version_id,
      'action_count', pg_catalog.jsonb_array_length(target_actions)));

  INSERT INTO public.programme_hub_action_plan_write_requests (
    request_id, workspace_id, actor_user_id, input, result
  ) VALUES (target_request_id, target_workspace_id, actor, request_input, result_value);

  RETURN result_value;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rev_action_plan_revision_immutable(),
  public.rev_action_plan_no_delete(),
  public.rev_action_plan_current_questionnaire(uuid, uuid),
  public.rev_action_plan_specialist_assigned(uuid, uuid, uuid, uuid),
  public.rev_action_plan_validate_actions(jsonb),
  public.rev_action_plan_read(uuid, uuid, uuid),
  public.rev_action_plan_save(uuid, uuid, uuid, uuid, integer, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rev_action_plan_read(uuid, uuid, uuid),
  public.rev_action_plan_save(uuid, uuid, uuid, uuid, integer, uuid, text, jsonb)
  TO authenticated;

COMMIT;
