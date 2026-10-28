# Selected vocational questionnaire status — 28 October 2026

User selected published questionnaire version 3 with one ordinary aspirations
question, while the status panel said no core questionnaire was available. The
screen also claimed a newer draft existed solely because only one section was
shown. Neither display should be inferred from a zero count or a section count.

## Findings and changes

The assessment component mounted VocationalStatusPanel before the selected
snapshot's open RPC had finished. Its separate status RPC could therefore read
an older zero-question assessment. Opening a different snapshot did not trigger
a status refresh; only save/completion did. The status RPC is a participant-level
programme overview, not a selected-snapshot API.

Selected-profile status now mounts after the assessment has opened, keyed by
selected snapshot and assessment ID. The panel receives the expected assessment
ID, refetches if it changes, and refuses a returned status for another assessment.
Historical snapshot selection can still receive overview status for a different
assessment; the UI reports that the selected saved status cannot be verified,
rather than displaying its totals or inventing a missing-questionnaire warning.
Selected-version answer progress remains shown separately from unsaved answers.
Transport rejection becomes Status unavailable rather than an unhandled promise.
No status RPC signature, SQL, RLS or stored record changes were made.

Replaced the speculative one-section/newer-draft warning with factual selected
published version, core question and section counts. A valid one-section form is
not described as a failed publish, and the UI does not assert that a newer draft
exists without reading evidence. It remains explicit that draft edits are not
part of the selected published version.

The supplied version 3 has one published core question; this patch does not add
starter questions to it. If the manager wants the full starter set, explicitly
create an editable revision, add/review core questions, save and publish, then
select the new snapshot. Existing aspirations and optional support are preserved.
Existing dual ES assignments and case notes remain untouched.

## Regression checks

New mounted tests use the real assessment and status panels to prove status is
read after opening the selected snapshot. Before open, the mock server supplies
an old zero-question result; afterward it returns the selected one-question
assessment. Additional tests reject a different returned assessment ID, suppress
late results after selection changes, and handle transport rejection without
calling a failed read an empty questionnaire. Existing assessment write/scope
coverage remains in the focused run. No actual participant data or provider calls
were used. PR #4 remains unmerged pending exact-head CI and preview review.

Final validation: all 106 Vitest files / 870 tests and 548 Node tests passed
(1,418 total). Explicit Supabase frontend build and git diff --check passed.
The focused 14-test assessment/status run also passed. The initial build caught
that the Supabase query's thenable has no typed .catch; wrapping it in
Promise.resolve preserves rejection handling and passes the production build.
