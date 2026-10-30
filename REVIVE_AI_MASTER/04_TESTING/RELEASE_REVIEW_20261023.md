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

The user subsequently supplied the Netlify project settings: production branch
`phase-5l-calendar-event-creation`, base `revive-app`, build `npm run build`,
publish directory `revive-app/dist`, Node.js 24.x, and branch deployments limited
to that production branch. Deploy Previews are enabled for pull requests targeting
that branch. The production branch was fetched and still points to
`adf6f9a45e9dde140698a41c5cd10e895b3b5c0f`. This establishes the configured target
and current Git tip. The user then supplied the completed production deploy:
`rev11` at `adf6f9a`, with immutable deploy URL
`https://6ad550d7648aa4a4b661a6e7--rev11.netlify.app/`. The configured branch,
published deploy and fetched Git tip now agree based on that user-provided
Netlify evidence. The separate Netlify site `revivewebsites` deploys `main` at
`8758bb2` and is not the target of this REV release.

The release delta against that target includes 15 additional migration files
and two new Supabase functions. Their presence in the diff does not establish
which are already applied/deployed in the hosted project. Merging into the
production branch can trigger Netlify; it does not deploy Supabase migrations
or functions. The reported Netlify functions directory is for Netlify Functions,
not these Supabase Edge Functions.

GitHub API access returned Forbidden for PR queries and the production deployment
metadata endpoint, so a pull request and hosted CI/deployment status could not be
managed or verified here. Git fetch/push works. The prepared branch is available
through that route, and the release PR target is now known.

Before production release, confirm the current hosted migration/function
inventory. Review the combined branch against the confirmed production target
and deployed commit, establish CI results for the selected release
commit, and perform the hosted programme/scheduling/consent smoke checks through
the intended release process. Prior user confirmation that engagement works on
Netlify is evidence for that earlier deployed version, not for this new branch.
See `../05_HANDOVERS/RELEASE_PR_DRAFT_20261023.md` for the concrete PR target,
release delta, and deployment order.

## Hosted migration history supplied on 23 October 2026

The user supplied the JSON result of the read-only query against
`supabase_migrations.schema_migrations` for the intended hosted project.
It contains 58 unique versions. All 58 versions and names match repository
migration filenames; there are no hosted-only versions or name mismatches.
The latest recorded version is `20261018220000`.

Exactly the 15 release-delta migrations listed in
`../05_HANDOVERS/RELEASE_PR_DRAFT_20261023.md` are absent from this history:
meeting reminder delivery, scheduling job import, and the 13 vocational
migrations from `20261019010000` through `20261021002000`.
This establishes recorded history, not a comparison of live SQL definitions:
manually executed SQL may exist without a migration-history entry. No migration
was executed or history repaired during this comparison.

Two missing versions (`20261009170000` and `20261010230000`) precede the latest
recorded hosted version. A future CLI rollout must explicitly review these
out-of-order migrations in its dry-run plan; a default latest-only migration
push is insufficient. Do not mark them applied without establishing that their
SQL is present. Hosted Edge Function inventory, exact-release CI, and the
production rollout remain outstanding.
