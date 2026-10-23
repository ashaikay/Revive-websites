# REV combined release PR — prepared 23 October 2026

## Target

- Repository: `ashaikay/Revive-websites`.
- Base: `phase-5l-calendar-event-creation` (the user-confirmed Netlify production branch).
- Base tip fetched during review: `adf6f9a45e9dde140698a41c5cd10e895b3b5c0f`.
- User-confirmed completed production deploy: `adf6f9a`, matching that base tip.
- Frontend rollback reference: `https://6ad550d7648aa4a4b661a6e7--rev11.netlify.app/`.
- Head: `review/rev-release-20261023`.
- Status: prepared branch and PR text; no PR was created through the API because
  GitHub API requests returned Forbidden. No production merge or deployment.

Compare/create URL:
https://github.com/ashaikay/Revive-websites/compare/phase-5l-calendar-event-creation...review%2Frev-release-20261023?expand=1

## Proposed title

Add reviewed vocational, consent and scheduling workflows with release validation

## Proposed PR body

This consolidates the saved Windows checkpoint with the subsequent review fixes:
vocational questionnaire/assessment and consent workflows, scheduling reporting
and CSV import/export, and manual meeting-reminder delivery foundations. It fixes
late-response state changes, lost edits during saves, retained-request recovery,
invalid opportunity evidence, and spreadsheet formula handling in CSV exports.

Vitest and Node boundary suites now use their intended runners. CI builds both
mock and Supabase frontends. Local verification passed 853 Vitest tests, 541 Node
tests, and both frontend builds. Earlier isolated database verification applied
all 73 project migrations and passed 21 integration suites. The reminder provider
execution constant remains false; no live integration was enabled by this work.

This PR targets the branch Netlify deploys. Treat merging as a frontend production
release trigger. Fifteen migration files and two Supabase Edge Functions are
additional to the base branch; compare them with hosted history before deciding
what needs applying/deploying. Do not infer hosted state from this Git diff.
The user-confirmed Netlify production deployment matches base commit `adf6f9a`.
Exact-head CI results and hosted backend inventory remain unverified. Review
reports are under `REVIVE_AI_MASTER/04_TESTING/`.

## Hosted state to reconcile before merge

The following are additional **files**, not a list of confirmed pending migrations:

1. `20261009170000_rev_meeting_reminder_delivery.sql`
2. `20261010230000_rev_scheduling_job_import.sql`
3. `20261019010000_rev_vocational_templates.sql`
4. `20261019011000_rev_vocational_template_operations.sql`
5. `20261019012000_rev_vocational_revisions.sql`
6. `20261019013000_rev_vocational_assessment_parity.sql`
7. `20261019020000_rev_voc_matching_summary.sql`
8. `20261019021000_rev_voc_matching_privacy_guard.sql`
9. `20261020023000_rev_voc_matching_ambiguity_fix.sql`
10. `20261020233000_rev_voc_ordinary_question_privacy_hardening.sql`
11. `20261020234000_rev_voc_convicted_label_fix.sql`
12. `20261020235000_rev_voc_restricted_answers_lockdown.sql`
13. `20261021000000_rev_voc_consent_foundation.sql`
14. `20261021001000_rev_voc_consent_operations.sql`
15. `20261021002000_rev_voc_consent_hardening.sql`

New Edge Function source directories:

- `rev-scheduling-job-import` — its database operation requires the matching import migration.
- `rev-meeting-reminder-deliver` — foundation with `PROVIDER_EXECUTION_ENABLED = false`.

Other previously existing functions are outside this two-function source delta;
their hosted source versions still need comparison where required for release.
No existing function permission, origin allowlist, email identity, or provider
credential should be inferred from Netlify's frontend settings.

## Release order

1. Use the user-confirmed completed production deploy at `adf6f9a` as the current
   frontend baseline and preserve deploy `6ad550d7648aa4a4b661a6e7` as the rollback
   reference. Recheck that baseline if another production deploy occurs before
   the release. The separate `revivewebsites` site's `main@8758bb2` deploy is not
   this app's baseline or target.
2. Confirm CI for the chosen combined commit and create/review the PR against
   `phase-5l-calendar-event-creation`; a PR can provide a Netlify Deploy Preview.
3. Inspect hosted migration history and relevant function versions read-only.
   Compare names and source with this release. Prepare only the actual missing
   backend steps; do not run an unreviewed bulk database push.
4. Apply the separately reviewed backend steps through the project's release
   process before publishing frontend features that depend on them. Keep the
   live reminder provider gate disabled. Check origin/configuration requirements
   through server settings; no server credentials belong in the frontend.
5. Verify the preview with appropriate test accounts and explicit scope. A
   preview uses a different origin from `https://rev11.netlify.app`; its own
   trusted API access must be established before calling a failed preflight an
   application regression. Do not broaden production origins to arbitrary hosts.
6. Merge/publish only after the release checks and backend compatibility are
   established. Verify the successful production deploy matches the intended
   commit, then smoke-test programme engagement, participant assessment saving,
   consent role boundaries, scheduling persistence and transfers with designated
   test records. Earlier unit/database checks do not substitute for this step.

Frontend rollback republishes the known-good Netlify deploy. It does not roll
back Supabase migrations or function deployments; handle those separately using
the reviewed backend release procedure and retained backups.

## Confirmed Netlify settings

User-supplied configuration: project `rev11`, base `revive-app`, build
`npm run build`, publish `revive-app/dist`, Netlify functions
`revive-app/netlify/functions`, Node 24.x, Ubuntu Noble 24.04. Production builds
are active. All deployment methods can deploy to production. Supabase Edge
Functions live under `revive-app/supabase/functions`; Netlify's functions setting
does not deploy them. No Netlify setting was changed during this preparation.

The user supplied two completed deploy records. `rev11` uses
`phase-5l-calendar-event-creation@adf6f9a` (reported 19 October, 00:05, 25-second
build). The separate `revivewebsites` site uses `main@8758bb2` (reported
19 October, 23:05, 22-second build). These are user-provided Netlify records,
not independently fetched API results. The latter site remains outside this
release target.

## Backend inventory and dry-run handoff

On 23 October the user supplied hosted migration-history results: 58 entries,
all matching repository versions/names, with exactly the 15 migrations above
absent from recorded history. They also searched Edge Functions and confirmed
both new function names above are missing. This does not establish absence of
manually applied SQL or compare definitions of existing functions.

Cloud has neither `SUPABASE_ACCESS_TOKEN` nor `SUPABASE_DB_PASSWORD` and is not
linked to the hosted project. No hosted dry run has run here. CLI 2.117.0 help
was checked for `db push`: `--dry-run` prints the migration plan without applying
migrations; `--include-all` includes missing versions older than recorded history;
`--skip-vault` prevents the command's otherwise documented Vault update step.

From Windows PowerShell, in `revive-app`, fetch and fast-forward the review branch,
then authenticate locally and request only the plan:

```powershell
git fetch origin
git switch review/rev-release-20261023
git pull --ff-only
npx --yes supabase@2.117.0 login
npx --yes supabase@2.117.0 db push --project-ref ntbowgutwyyhhnmkadlv --dry-run --include-all --skip-vault
```

Stop if Git reports local conflicts or the CLI reports an error. Review the plan
against all 15 filenames above before proposing an applying command. Login and
any database-password prompt happen locally; do not paste credentials into chat.
A successful plan checks migration selection/connectivity, not live SQL
compatibility or evidence of no schema drift. No deployment or applying command
is authorized by this dry-run handoff.
