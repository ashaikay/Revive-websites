# REV Brain opportunity review v1 (2026-11-04)

Branch `feature/rev-brain-opportunity-review-20261104`, from `phase-5l-calendar-event-creation` after PR #8 merged (`a988a39`).

## Journey

An assigned Employment Specialist, or an authorised manager, opens a Service-user record and selects **Review opportunities**. REV lists the existing active jobs from that programme.

## Kept separate and traceable

| Part | Source |
| --- | --- |
| Profile evidence | `rev_voc_matching_summary`. It uses only the completed current questionnaire, with ordinary allowlisted answers. The questionnaire version and assessment IDs are returned. |
| Opportunity source | Active `programme_hub_vacancies` from active employers in the same programme, each with its record ID, version and update time. External vacancy search is shown as not available. |
| Supported matches | Each match names the profile field that supports it. |
| Missing evidence | Requirements with no recorded questionnaire evidence. These are not treated as missing skills. |
| Uncertainty | Unrecorded sector or work area, sector differences, untested travel, and requirements matched by exact wording only. |
| Proposed next steps | Suggestions for staff only. Nothing is applied for, sent, placed or changed in the action plan. |

There is no score. Counts describe recorded evidence and are labelled as not a likelihood of employment.

## States

- **Loading**
- **Read failure**, including denied access and unverifiable responses
- **Not ready:**
  - no published questionnaire;
  - current questionnaire not started;
  - current questionnaire in progress.

  Older answers are never used.
- **No active jobs**
- **Results**

## Privacy and access

The RPC `rev_brain_programme_opportunity_review` is `SECURITY DEFINER`. It requires the programme module and `rev_voc_assessment_authorised`, which is the same programme and caseload authority used by the vocational profile and the action plan.

It never returns:
- employer contacts;
- case notes;
- action-plan content;
- restricted or sensitive answers.

It writes nothing.

## Migration

- `revive-app/supabase/migrations/20261104001000_rev_brain_programme_opportunity_review.sql`
- Read-only function, granted only to `authenticated`.
- Not applied to the hosted database.

## Tests

- **DB:** `revive-app/supabase/tests/20261104001000_rev_brain_programme_opportunity_review_test.sql`
  - Runs in CI job `programme-hub-database`; not run locally because local Docker is unavailable.
  - Covers:
    - readiness for an older completed assessment with a newer incomplete questionnaire;
    - exclusion of restricted answers;
    - job scope;
    - no employer contact leak;
    - manager, unassigned, other-programme, foreign-workspace, unauthenticated, anon and removed-ES access;
    - no changes to answers, completion history, jobs or action plans.
- **UI:** `src/tests/participantOpportunityReviewUI.test.tsx` (11 tests), plus `programmeHubUI` and `participantActionPlanUI`.
  - 98 tests passed.
- **Node:** `src/tests/revBrainOpportunityFoundation.test.ts` passed (10 tests).
- **Build:** `npm run build` (`tsc` and Vite) passed.

## Next, not built

Approved external vacancy search can be added as a second opportunity source, with its own evidence of origin and retrieval date. The existing `assessOpportunity` evidence checks are intended for that work.
