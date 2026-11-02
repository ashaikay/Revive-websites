# Selected questionnaire status

The profile opens a specific questionnaire snapshot, but the former status endpoint independently selects a participant assessment using template publication state and ordering. With multiple versions it can return another assessment. The frontend correctly refused to display that mismatched result, but closing and reopening could not resolve the underlying selection difference.

Added `rev_voc_assessment_selected_status` with explicit assessment ID and matching workspace, programme and participant predicates. It uses the existing assessment authorisation and ordinary-question classifier, returns no answers, and refuses missing or foreign assessments. The existing overview endpoint remains unchanged for caseload summaries. The open profile now requests the selected assessment's status and still suppresses stale or mismatched responses.

Validation: 15 focused UI tests pass; Supabase-mode production build passes. Applied the additive migration to the isolated local database and ran the rollback-only lifecycle test with two assessment snapshots, explicit historical selection, manager and assigned adviser access, foreign programme denial, and consent/access lifecycle checks. Hosted migration and preview verification remain pending.

Deployment: apply only `20261029001000_rev_voc_selected_assessment_status.sql` after the prior status-reader migration. Frontend preview will report unavailable status until that RPC exists. No answers or existing assessments are changed. The user-pasted screen still showed Mike and manager controls, so Robert's staff experience has not yet been verified.

## Current questionnaire versus earlier completion - 2 November 2026

Fix branch: `fix/vocational-status-consistency-20261102`, based on production-branch merge `4726fee` (`origin/phase-5l-calendar-event-creation`, including merged PR #5). The original worktree's navigation edits are untouched.

The caseload overview used `rev_voc_assessment_status`, which chose among existing assessments. A newly published questionnaire with no assessment could therefore leave an earlier completion looking like the current status. Its template-publication/version ordering also differed from the form's snapshot-publication ordering. The form already read the selected assessment through `rev_voc_assessment_selected_status`, but both panels used an unqualified "Vocational profile" label. Separately, `rev_voc_assessment_draft`'s open action searched only drafts and could create an empty draft when reopening a completed snapshot.

The new migration, `20261102001000_rev_voc_current_questionnaire_status.sql`:

- Resolves the latest snapshot of a published programme questionnaire first, using snapshot publication time and ID (the same ordering as the form).
- Reports the current questionnaire as not started when no assessment exists, without creating an assessment. Returns its title/version and separate metadata for the most recent earlier completed assessment; returns no answers.
- Keeps existing drafts available. If there is no draft for the selected snapshot, opening reuses its saved completed assessment read-only rather than creating an empty replacement. Both overview and open use the same assessment-selection ordering.
- Leaves all saved answers, existing assessments, completion timestamps/events, save/version checks, authorisation helpers, ordinary-question filtering, RLS and consent rules unchanged. There is no answer copying, automatic completion or data migration.

The caseload now labels **Current questionnaire** and **Earlier completed assessment** separately. The form labels the selected questionnaire **Current** or **Earlier**, including title and questionnaire version, and verifies both assessment and snapshot identity in status replies. Opening, saving or explicitly completing a profile refreshes its caseload status. A legacy overview response without questionnaire identity is explicitly unavailable rather than mislabelled as current.

Validation:

- 125 tests passed across 7 Programme Hub/vocational Vitest files, including a mounted assigned-ES regression with an older completed questionnaire and a newer incomplete questionnaire, distinct saved answers, history navigation, save refresh and no automatic completion or manager controls.
- Four isolated SQL suites passed: ordinary-question privacy, authenticated boundary, consent lifecycle and the new current-questionnaire/history regression. Coverage includes an unopened current questionnaire, current partial answers, earlier completion/answers, no duplicate assessment or completion event, assigned ES access, unassigned/foreign-scope denial and revoked ES denial.
- All SQL changes, including locally missing selected-status/support-status prerequisites, were tested inside rollback-only transactions against `supabase_db_revive-app`. No local function replacement or fixture data was retained. The new SQL regression is wired into the existing Programme Hub database CI job and is also discovered by the local database runner.
- Default and Supabase-mode TypeScript/production builds passed once each; the existing chunk-size advisory remains.
- Follow-up: added an explicit component regression (`vocationalStatusPanel.test.tsx`) rendering the caseload panel and both selected panels together for an older completed assessment plus a newer incomplete questionnaire. It asserts the caseload shows **Current questionnaire: In progress** with the earlier completion listed separately, never **Current questionnaire: Completed**; the current selection shows **Current questionnaire: In progress**/Not completed; and the earlier selection shows **Earlier questionnaire: Completed** with no completion or draft writes. The mounted hub regression was renamed to make the scenario explicit. Rerun: 122 tests in the 6 Programme Hub/vocational Vitest files passed; both builds passed again.

Release state: **not deployed**. This fix requires review/application of the new migration before releasing its frontend; the earlier selected-status migration remains a prerequisite. No hosted database changes, production deployment, merge or CI polling was performed. Authenticated hosted verification remains pending.

## Historical empty-questionnaire warning - 2 November 2026

Earlier questionnaires with no core questions now say: "This earlier questionnaire contains no core employment questions. Select the current questionnaire to continue." Neither the staff manager-setup request nor the manager review action appears in this historical context. The selected-status panel also suppresses its programme-setup warning for an explicitly earlier questionnaire. Current-questionnaire setup warnings and actions remain unchanged. No database, answer, completion, save or permission logic changed.

Trace at production base `4726fee`: `CompactCaseload` rendered `VocationalStatusPanel` without an assessment ID. That called `rev_voc_assessment_status` and displayed `Completed` only when its selected row had `status = 'completed'`. The old RPC selected among existing draft/completed assessments, ordered by template publication state/time, questionnaire version, completed-before-draft, assessment update time and creation time. It did not select the current questionnaire first. This proves the source of the badge, but does not identify Robert's historical row or prove that questionnaire v3 was completed.

Hosted evidence is needed to identify the assessment. The following single read-only query returns metadata only for one participant and reproduces the checked-in old selector's ranking. Replace the three UUID placeholders locally. Rank 1 identifies today's candidate(s) under the old ordering; ties are deliberately retained because the old selector had no final unique tie-breaker. If records or template publication metadata have changed since the original badge, these results cannot by themselves prove the original point-in-time selection.

```sql
WITH scope(workspace_id, programme_id, participant_id) AS (
  VALUES ('WORKSPACE_UUID'::uuid, 'PROGRAMME_UUID'::uuid, 'PARTICIPANT_UUID'::uuid)
), ranked AS (
  SELECT aa.id AS assessment_id, aa.template_version_id,
    tv.title AS questionnaire_title, tv.version AS questionnaire_version,
    aa.status AS assessment_status, aa.completed_at,
    aa.updated_at, aa.created_at,
    t.status AS template_status, t.published_at AS template_published_at,
    tv.published_at AS questionnaire_published_at,
    rank() OVER (ORDER BY
      CASE WHEN t.status = 'published' THEN 0 ELSE 1 END,
      t.published_at DESC NULLS LAST, tv.version DESC,
      CASE WHEN aa.status = 'completed' THEN 0 ELSE 1 END,
      aa.updated_at DESC, aa.created_at DESC
    ) AS legacy_choice_rank
  FROM public.programme_hub_vocational_assessments aa
  JOIN scope s ON aa.workspace_id = s.workspace_id
    AND aa.programme_id = s.programme_id AND aa.participant_id = s.participant_id
  JOIN public.programme_hub_vocational_template_versions tv
    ON tv.id = aa.template_version_id AND tv.workspace_id = aa.workspace_id
  JOIN public.programme_hub_vocational_templates t
    ON t.id = tv.template_id AND t.workspace_id = tv.workspace_id
  WHERE aa.status IN ('draft', 'completed')
    AND (t.programme_id = s.programme_id OR t.programme_id IS NULL)
)
SELECT legacy_choice_rank, assessment_id, template_version_id,
  questionnaire_title, questionnaire_version, assessment_status, completed_at,
  updated_at, created_at, template_status, template_published_at,
  questionnaire_published_at
FROM ranked
ORDER BY legacy_choice_rank, assessment_id;
```

Validation: 20 tests passed in the targeted vocational-status and assessment-write suites, including earlier empty-questionnaire navigation, unchanged current saved answers, no save/completion writes on history navigation, and preserved current-questionnaire staff/manager setup actions. One TypeScript/Vite build passed with the existing chunk-size advisory. No hosted query, migration, deployment, merge or CI polling was performed.
