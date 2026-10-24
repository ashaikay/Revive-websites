# Staff invitation and preview review — 24 October 2026

User testing on PR #4 preview reported: account creation claimed email confirmation
for an already registered email; clicking a later confirmation led to localhost;
a newly accepted staff member saw only Outcomes and no adviser assignment; saving
through rev-programme-hub-save returned an OPTIONS 403 from the preview origin.
The visible workspace was FatherLegacy. No workspace membership, module grants,
programme assignments, Auth settings, secrets or hosted functions were changed
by this code review.

## Changes

- Invitation creation no longer claims confirmation mail was sent when signup
  returns no session. Supabase can conceal an existing account behind a successful
  response. The UI explains this and provides existing Sign in and password
  recovery actions. It does not invent an account-existence lookup or expose a
  service key. If signup returns an authenticated session, the account can accept
  the invitation explicitly; no automatic team joining or role grant occurs.
- The unassigned staff screen explains programme registration, Service user
  assignments, section permissions and checking the selected workspace. Existing
  role/RLS/module checks remain unchanged. Outcomes-only is valid when the
  manager has granted only that section; membership does not imply programme
  adviser registration. A new mounted test checks guidance and absence of
  manager controls or writes.
- The Programme Hub save entry point can append
  REV_PROGRAMME_HUB_ADDITIONAL_ALLOWED_ORIGINS to existing configured origins.
  This enables review of the exact deploy-preview-4--rev11.netlify.app origin
  without overwriting unknown existing server settings. The boundary still uses
  exact matches and normal authentication/role/database checks. No automatic
  permission for all Netlify previews is introduced. The legacy explicit empty
  configuration and fallback remain unchanged.

## Hosted follow-up

The frontend already requests same-origin signup and password-recovery return
URLs. A confirmation landing at localhost requires inspection of hosted Auth
URL Configuration and possibly the confirmation email template. Local
supabase/config.toml is not proof of hosted Auth settings and must not be pushed
wholesale to change them. Obtain the current Site URL and redirect list; preserve
other legitimate integrations. Review the standard ConfirmationURL template if
redirects still fail after the allowed URLs are corrected. Request fresh email
links after fixing configuration; don't reuse consumed links or delete accounts.

To enable only this preview for the existing save endpoint, pull the reviewed
code, set REV_PROGRAMME_HUB_ADDITIONAL_ALLOWED_ORIGINS to
https://deploy-preview-4--rev11.netlify.app, deploy only rev-programme-hub-save,
and verify OPTIONS 204 plus exact allow-origin. Other programme endpoints use
different origin configuration and remain outside this scoped setting. Their
preview access must be assessed separately when tested.

Confirm intended workspace before any staff access changes. A failed preflight
can prevent adviser registration from saving; it cannot establish Robert's
current assignments. No automatic promotion, all-section grants or migration
is included. Keep PR #4 unmerged until preview and hosted settings are verified.

## Validation

- Complete `npm run test:all`: 105 Vitest files / 856 tests plus 547 Node tests,
  all passed (1,403 total).
- Default and explicit Supabase frontend builds passed; existing bundle-size
  advisory remains.
- New tests cover indistinguishable existing-account responses, session-returning
  signup without automatic invitation acceptance, staff guidance without manager
  controls, additive exact-preview preflight without authority calls, unlisted
  and lookalike preview rejection, and legacy/empty configuration.
- git diff --check passed. Hosted email delivery, redirect configuration and
  preview writes were not exercised by these local checks.

## Caseload scope and Auth configuration follow-up

User confirmed hosted Auth Site URL is http://localhost:3000 and the sole allowed
redirect is https://rev11.netlify.app/**. The signup code requests the current
preview origin; it is not allowlisted, so Auth can fall back to the localhost
Site URL. Proposed dashboard changes: Site URL https://rev11.netlify.app and add
https://deploy-preview-4--rev11.netlify.app/** while retaining the production
redirect entry. These are hosted Auth dashboard changes, separate from Edge
Function CORS. Do not delete or recreate existing staff accounts to test them.

A further user report exposed a dashboard scope bug: CompactCaseload received all
programme participants while its list/pagination used the selected ES/status/search
filters. It now receives the full filtered caseload (before pagination), so KPI
and unassigned totals match the chosen scope. Shared participants appear once in
each ES's caseload as intended; equal counts can be correct where assignments
overlap. New mounted regression changes all/owner/other ES/unassigned, active
status and search with shared plus separate assignments and verifies totals,
visible rows and page counts without writes. Existing export tests retain their
full-match/across-page guarantees.

Caseload UI separators, record labels, range labels and the shared footer now
use plain ASCII punctuation. No participant names or persisted records are
rewritten. Existing app source contained correct Unicode punctuation rather than
the reported mojibake; simplifying the UI avoids those punctuation bytes in
these labels without claiming a proven root cause for an older deployed bundle.
The dashboard heading is Caseload summary instead of My Caseload for manager
views. Job readiness, work outcomes and employment percentage remain unavailable
in the current data contract: do not invent progress from assignment counts.

Caseload validation: full Vitest run passed 104 unaffected files; twenty cases in
the Programme Hub file initially failed because its shared open-record selector
was incorrectly updated to the list-row colon separator rather than the article
hyphen separator. Corrected that test helper and reran the entire Programme Hub
file: all 70 tests passed, including the new scope regression. All 547 Node tests
passed separately. Explicit Supabase build and git diff --check passed. No
application source changed after the broad run; the final correction was only
the shared test helper. GitHub must verify the pushed head before release.
