# Combined release review — 23 October 2026

This branch combines checkpoint `1b27fef`, runner fixes `50b36f3`, local database
validation `5b198e8`, and assessment write-state fixes `2d00f40`, plus the fixes
below. Review scope was the checkpoint's vocational/consent workflows, opportunity
evidence handling, scheduling transfers, and their validation/release tooling.
This is focused review evidence, not an exhaustive audit of all historical code.

## Confirmed findings and fixes

| Finding | Resulting behavior |
| --- | --- |
| An invalid supplied expiry parsed to null and was treated as absent; malformed HTTPS prefixes passed source validation | Invalid dates, impossible ISO calendar dates, invalid current time, and malformed/non-HTTPS URLs require evidence verification and cannot produce a review score. Valid optional expiry for prospects remains supported. |
| Consent inputs remained editable during a write; callbacks could update a reused panel under a new assessment | All evidence/adviser controls lock during the operation. Unique assessment tokens and a synchronous operation lock prevent late success, failure, and finalizer callbacks from changing another operation. Server consent/role rules are unchanged. |
| Template save, publication, and revision callbacks lacked the context guards already used for template loading | Writes now check the current workspace/programme/user generation. New scopes reset transient state and locks. Old callbacks cannot change the new template or clear its busy state. The original pending request remains available for exact retry in its original scope. |
| A retained-save parse failure was overwritten by the subsequent load, allowing new writes despite an unresolved prior save | Recovery failure now has persistent state and a visible warning. New saves, publication, revision creation, and editing stay blocked; the retained record is preserved. |
| CSV quoting did not prevent worker/job values from being interpreted as spreadsheet formulas | Dangerous formula prefixes, including leading whitespace/control characters, receive a literal-text apostrophe before standard CSV quoting. Ordinary text, dates, numbers, and quote escaping remain unchanged. Database values are not rewritten. |

The earlier assessment write-state/encoding fix is documented separately in
`VOCATIONAL_WRITE_STATE_REVIEW_20261023.md`.

## Validation

- `npm run test:all`: 105 Vitest files / 853 tests passed; 541 Node tests passed.
- New panel tests reproduce stale-context writes, preserve failed-save evidence,
  check pending controls and withdrawal confirmation, and block malformed
  retained-save recovery. Six of the initial nine panel regression tests failed
  before their fixes; the separate recovery regression also failed before its fix.
- All eight formula-prefix regression cases failed against the original CSV
  serializer and pass after the fix. Ordinary CSV serialization also passes.
- Opportunity tests reproduce invalid expiry, malformed source URLs, impossible
  retrieval dates and an invalid current-time input, while preserving valid
  timestamp evidence and prospect behavior.
- `npm run build` and `VITE_REV_PROVIDER_MODE=supabase npm run build` passed.
  The existing bundle-size advisories remain.
- `git diff --check` passed.

Spreadsheet behavior was verified at the serialized CSV boundary; Excel and
LibreOffice were not launched. These are local checks, not GitHub Actions or
hosted browser evidence. Current CI registers both runners and both build modes.

The earlier local database report established 73 fresh migrations and 21 passing
integration suites. This review does not change migrations, RPC signatures, RLS,
provider gates, credentials, or live infrastructure, so those database suites
were not repeated for these client/pure-service changes.

## Release status

The combined branch is prepared for code review. The documentation-only master
index change from `main` has been incorporated to preserve its project priorities.
The review branch has not been merged into `main` or a production branch, and
nothing has been deployed or applied to hosted Supabase by this review.

The user does not know which branch Netlify uses for `rev11.netlify.app`.
Repository inspection found no declaration establishing that deployment branch;
it remains unverified. GitHub API access also returned Forbidden in this session,
so a pull request and hosted CI status could not be managed or verified here.
Git fetch/push works and the prepared branch is available through that route.

Before production release, establish the Netlify production branch/commit and
current hosted migration/function inventory. Review the combined branch against
that baseline, establish CI results for the selected release commit, and perform
the hosted programme/scheduling/consent smoke checks through the intended release
process. Prior user confirmation that engagement works on Netlify is evidence
for that earlier deployed version, not for this new branch.
