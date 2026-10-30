BEGIN;

CREATE TABLE IF NOT EXISTS public.programme_hub_vocational_support_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  programme_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  consent_status text NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('pending','granted','withdrawn')),
  consent_scope text NOT NULL DEFAULT 'restricted_vocational_support' CHECK (consent_scope = 'restricted_vocational_support'),
  consent_statement text,
  consent_recorded_by_user_id uuid,
  consent_recorded_at timestamptz,
  withdrawn_by_user_id uuid,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rev_voc_support_consent_assessment_fk FOREIGN KEY (workspace_id, assessment_id)
    REFERENCES public.programme_hub_vocational_assessments(workspace_id,id),
  CONSTRAINT rev_voc_support_consent_participant_fk FOREIGN KEY (workspace_id,programme_id,participant_id)
    REFERENCES public.programme_hub_participants(workspace_id,programme_id,id),
  CONSTRAINT rev_voc_support_consent_unique UNIQUE (assessment_id,consent_scope),
  CONSTRAINT rev_voc_support_consent_status_consistency CHECK (
    (consent_status='pending' AND consent_recorded_at IS NULL AND withdrawn_at IS NULL)
    OR (consent_status='granted' AND consent_recorded_at IS NOT NULL AND consent_recorded_by_user_id IS NOT NULL AND withdrawn_at IS NULL)
    OR (consent_status='withdrawn' AND consent_recorded_at IS NOT NULL AND withdrawn_at IS NOT NULL AND withdrawn_by_user_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.programme_hub_vocational_restricted_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  programme_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  adviser_user_id uuid NOT NULL,
  granted_by_user_id uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rev_voc_access_assignment_fk FOREIGN KEY (workspace_id,participant_id,adviser_user_id)
    REFERENCES public.programme_hub_participant_advisers(workspace_id,participant_id,adviser_user_id),
  CONSTRAINT rev_voc_access_participant_fk FOREIGN KEY (workspace_id,programme_id,participant_id)
    REFERENCES public.programme_hub_participants(workspace_id,programme_id,id),
  CONSTRAINT rev_voc_access_revocation_consistency CHECK ((revoked_at IS NULL) = (revoked_by_user_id IS NULL)),
  CONSTRAINT rev_voc_access_purpose_nonempty CHECK (length(btrim(purpose)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS rev_voc_one_active_restricted_grant
  ON public.programme_hub_vocational_restricted_access_grants(workspace_id,participant_id,adviser_user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.programme_hub_vocational_restricted_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  actor_user_id uuid,
  action text NOT NULL CHECK (action IN ('consent_granted','consent_withdrawn','access_granted','access_revoked','restricted_read','restricted_write','restricted_read_denied','restricted_write_denied')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT rev_voc_restricted_audit_assessment_fk FOREIGN KEY (workspace_id,assessment_id)
    REFERENCES public.programme_hub_vocational_assessments(workspace_id,id),
  CONSTRAINT rev_voc_restricted_audit_no_answer_payload CHECK (jsonb_typeof(details)='object' AND NOT (details ?| ARRAY['answer','answers','value','values']))
);

CREATE INDEX IF NOT EXISTS rev_voc_consent_participant_idx
  ON public.programme_hub_vocational_support_consents(workspace_id,participant_id);
CREATE INDEX IF NOT EXISTS rev_voc_restricted_audit_assessment_idx
  ON public.programme_hub_vocational_restricted_audit(workspace_id,assessment_id,occurred_at DESC);

ALTER TABLE public.programme_hub_vocational_support_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programme_hub_vocational_restricted_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programme_hub_vocational_restricted_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.programme_hub_vocational_support_consents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.programme_hub_vocational_restricted_access_grants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.programme_hub_vocational_restricted_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.programme_hub_vocational_restricted_audit_id_seq FROM PUBLIC, anon, authenticated;

COMMIT;
