# Employment action plan v1 — 2 November 2026

Branch: `feature/rev-action-plan-v1-20261102` (base `phase-5l-calendar-event-creation`).
Status: implemented in a PR. **Not applied to hosted Supabase. Not released.**

## Scope delivered

- An assigned Employment Specialist, or an authorised manager, opens **Employment action plan** from the Service-user record.
- Each revision records an employment goal and up to 20 actions. Each action has:
  - a structured owner: the Service user, or an Assigned Employment Specialist;
  - a status: Not started, In progress or Completed;
  - an optional target date.
- Every revision is linked to:
  - the programme;
  - the Service user;
  - the vocational questionnaire version it was based on.
- Each save creates a new immutable revision. Earlier revisions are shown read-only, and the database blocks UPDATE or DELETE on them.
- Saves are protected in four ways:
  - an expected-revision check (a stale save returns 40001);
  - an `audit_log` entry, with no free text in the metadata;
  - a request ledger, so an exact retry returns the original result;
  - rejection of a reused request ID with different input.
- If a newer questionnaire is published:
  - the plan is flagged **Review needed**;
  - the draft and its link stay unchanged until staff explicitly choose to link the next revision to the current questionnaire.
- If an owner ES is unassigned:
  - the action is flagged **Owner needs review**;
  - the recorded owner is preserved and never replaced automatically.
- Access is enforced in the database through `rev_voc_assessment_authorised`. The tables have no direct grants for `authenticated` or `anon`.
- The plan is not included in any Brain or matching context.
- Nothing is sent, applied for or completed automatically, and nothing records the Service user's agreement.

## Migration

- `revive-app/supabase/migrations/20261102003000_rev_action_plan_foundation.sql`

## Tests

- DB: `revive-app/supabase/tests/20261102003000_rev_action_plan_foundation_test.sql`
  - Runs in CI job `programme-hub-database`.
  - Not run locally, because local Docker is unavailable.
- UI: `revive-app/src/tests/participantActionPlanUI.test.tsx`.
- Targeted Vitest: 3 files, 88 tests passed. Also covers `vocationalAssessmentWriteState` and `programmeHubUI`.
- `npm run build` passed.

## Review blocker fixes

### Unconfirmed saves

- An unconfirmed save is kept in sessionStorage (`actionPlanRetainedRequest.ts`). It is scoped to the user, workspace, programme and Service user.
- While it is retained, editing, replacement saves, closing the plan and record navigation are blocked.
- After a refresh, the plan reopens and offers Retry save.
- Retry save resends the original payload with the original request ID.
- The retained request is cleared only after a verified save or a definitive database rejection.
- UI tests: `participantActionPlanUI` and `programmeHubUI` passed (81 tests).
- `npm run build` passed.

### Action owner validation

- `rev_action_plan_validate_actions` now rejects `ownerType` values that are null, not a string, or not one of the allowed values.
- It also rejects an invalid `ownerUserId` and null required fields.
- Before the fix, null comparisons made the rejection check evaluate to NULL instead of failing, so these actions were accepted.
- The migration was edited in place. It has not been applied to the hosted database.
- The DB regression runs in CI.
