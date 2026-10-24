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
