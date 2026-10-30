# Vocational assessment write-state review — 23 October 2026

Review of the combined checkpoint and validation branches identified an assessment
UI defect: answer inputs remained editable while save/completion requests were
pending. A save response replaced the answer state and cleared the dirty flag,
discarding any edits typed during the request. Completion could similarly leave
newly typed, unpersisted answers displayed as completed/read-only.

Write callbacks also lacked the context guards used by the existing load effects.
When the component was reused for a different participant while a request was in
flight, the previous response could overwrite the new assessment's answers or
completion state. An old failure/finalizer could replace new feedback or clear a
new write's busy state. This was reproduced with deferred responses in mounted
component tests; it is not a claim of a database/RLS bypass.

## Changes

- Answer controls and the profile open/close button are disabled during writes.
  Questionnaire selection was already disabled during these operations.
- A synchronous write lock prevents overlapping save/completion requests before
  the disabled state renders.
- Unique context tokens bind responses to workspace, programme, participant,
  questionnaire, and the current mount. Navigating away and returning to the same
  identity creates a new token, so an earlier response still cannot apply.
- Stale success, failure, and finalizer callbacks are ignored. Context-specific
  feedback and presentation state are reset when the participant scope changes.
  This does not cancel a database request already sent for the previous profile.
- Remaining corrupted middle dots/minus signs in this component were repaired
  directly in UTF-8 source and are covered by a rendering regression test.
- CI now explicitly compiles the Supabase frontend as well as the default mock
  frontend. The mock-mode bundle omits live-only screens; a mock build alone was
  insufficient evidence that the deployed frontend path bundles successfully.

## Evidence

- Before the fix, the initial four mounted regression tests had three failures
  and one pass (the existing failed-save preservation path).
- After the fix, all eight new mounted regression tests passed. They cover pending
  save/completion controls, failed-save preservation, stale save success, stale
  failure while another save is pending, stale completion, navigate-away-and-back,
  readable punctuation, and React StrictMode through the pending-save test.
- All 68 Programme Hub tests passed with the changed component.
- `npm run build` passed in default mode.
- `VITE_REV_PROVIDER_MODE=supabase npm run build` passed, transforming the full
  live frontend. Existing bundle-size advisories remain.
- `git diff --check` passed.

No migration, Supabase RPC contract, permission/consent rule, provider gate,
hosted function, or Netlify deployment was changed. No live-provider request was
made. The earlier 21-suite local database evidence is recorded separately in
`LOCAL_DATABASE_VALIDATION_20261023.md`; it was not rerun for this UI-only change.
The full unit suites are registered in CI, but CI completion and production
browser behavior are not established by these local focused checks.
