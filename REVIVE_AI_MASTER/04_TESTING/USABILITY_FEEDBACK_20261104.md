# Usability feedback increment — 2026-11-04

Branch `feature/rev-usability-feedback-20261104`, stacked on PR #9. No migration. PR #9's migration is already applied.

## Scope
1. **Vocational sections.** When a section opens, it scrolls into view at its heading. Smooth scrolling is turned off when the user prefers reduced motion. Keyboard focus moves to the section heading, except while the user is typing in a field. Answers, progress and the questionnaire-switch protections are unchanged.
2. **Opportunities.** Each job shows:
   - evidence counts;
   - the supported requirements;
   - the requirements not yet evidenced.

   Sources, profile evidence, limitations and suggested steps are collapsed under **Details**. When matching evidence is unavailable, REV says so and does not imply the participant lacks the skills.
3. **Save feedback.**
   - **Vocational profile:** a persistent `Save status` live region shows "Saving...", "Unsaved changes" or "All changes saved". It shows "All changes saved" only after the server confirms the save. A server error code is shown as a definitive failure. Any other failure is reported as "Save not confirmed": answers stay on screen, and a retry sends the same expected version, so an earlier save that did reach the server cannot be overwritten.
   - **Action plan:** adds a "Saving action plan..." status. Its retained exact-request recovery is unchanged.

## Deferred
- ES "New Service user" intake.
- Archive/status controls.
- Help/FAQ page.

## Validation
- Vitest: opportunity review, vocational write-state, Programme Hub and action-plan UI tests all passed. On this loaded machine they needed `--testTimeout=30000`. One test's own 15-second limit was exceeded in the full run, and it passed when run alone.
- Node: 10 opportunity-foundation tests passed.
- `npm run build` passed (the chunk-size warning is pre-existing).
