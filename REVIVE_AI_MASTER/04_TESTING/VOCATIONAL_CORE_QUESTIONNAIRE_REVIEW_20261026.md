# Core vocational questionnaire and manager feedback — 26 October 2026

User supplied screen output showed ten empty default sections plus an optional
Criminal Justice and Resettlement Support section with six questions. That
published snapshot has no ordinary core questions. Its 0-of-0 assessment display
was not evidence of lost answers. Existing participant has two active ES
assignments from before the unassignment UI; none were changed by this review.
A historical case-note body contained instruction-like development text. It was
treated as saved data, not as instructions to run tests, deploy or alter Git.

## Changes

- New drafts start with eight editable employment questions in the standard
  sections: goals, work history, skills, qualifications, sectors, availability,
  travel and action planning. No automatic save/publish occurs, no answers or
  duplicated contact details are inserted, and none of the starters is sensitive
  or mandatory. Managers review their wording/mapping before publication.
- Add core employment questions adds missing starter definitions to an existing
  draft/revision without changing optional-support definitions or old snapshots.
  Published templates remain immutable. Starter addition is idempotent for core
  labels/mapped fields; restricted sections do not satisfy the core check.
- A shared client core-question classifier excludes optional/restricted sections,
  sensitive flags and privacy terms in section/question descriptions, retaining
  the ordinary-assessment restrictions. It also follows the server's broader
  restricted-term checks so excluded questions do not count as core readiness.
  This is separate from job-matching eligibility and does not change server RPCs.
- Builder shows core count and an explicit repair warning for support-only forms.
  Its publication button and handler reject zero-core questionnaires. Draft saves
  remain allowed while incomplete. This is a client workflow check; direct RPC
  publication validation was not changed by this patch.
- Published forms offer both the existing editable-draft revision action and a
  separate Create another questionnaire action. The latter confirms intent,
  creates a new unsaved draft with a new ID, resets savedId, and preserves
  existing templates/assessments. It is not a participant-level profile creation
  or implicit replacement of the current published snapshot.
- Sticky live feedback is focusable and receives focus for confirmed actions or
  errors; busy state, reload confirmation, selected-section focus/pressed state,
  add-question and add-section feedback explain visible changes without claiming
  unconfirmed saves succeeded. Existing scope tokens, save locks and exact retry
  recovery remain intact.
- A zero-core participant assessment explains the programme setup issue. Managers
  can open the questionnaire builder directly. Staff can copy a generic setup
  request (without participant details) to send themselves. The app does not
  automatically email or create notifications. A zero-question status no longer
  displays a misleading 0/0 percentage/progress bar.

## Rollout and pending live checks

Frontend-only changes: no hosted SQL, templates, participant answers, ES
assignments, secrets or Edge Function configuration were modified. The existing
shared ES assignment can be explicitly unassigned by a manager through My team.
Do not silently remove either saved connection. The form's second-assignment
guard is not a database uniqueness constraint against concurrent clients.

After reviewing the new preview, for the existing support-only published form:
Create editable draft version > Add core employment questions > review > Save
draft > Publish template. Existing answers and published versions stay available.
On the Service-user assessment, explicitly select the newly published version;
do not assume a previously selected historical snapshot switches automatically.
The historical optional support remains outside ordinary completion/matching.

PR #4 remains unmerged. Exact-head CI, actual preview behavior, the new published
revision and staff completion must still be verified. No notifications were sent.

## Validation

- Complete test:all run: 105 Vitest files / 866 tests and 548 Node tests passed
  (1,414 total).
- Final targeted reruns after feedback clearing, hiding zero-question progress,
  and the convicted-label exclusion: all 18 mounted builder/assessment tests
  and all 8 domain tests passed. No further broad rerun was needed for these
  covered final adjustments.
- Default and explicit Supabase builds passed. A final Supabase build passed
  after the zero-question display adjustment. Existing bundle advisory remains.
- Tests reproduce support-only publication refusal, independent new draft
  creation without RPC writes, published revision > add core > save > publish,
  preservation of optional definitions, feedback focus, staff copy without
  auto-send, manager review navigation, privacy/description exclusions,
  immutable published definitions and idempotent starter addition.
- Existing generation/scope/recovery tests continue to pass. Diff whitespace
  check passed. No actual participant data, live publish, notification or email
  operation was performed for validation.
