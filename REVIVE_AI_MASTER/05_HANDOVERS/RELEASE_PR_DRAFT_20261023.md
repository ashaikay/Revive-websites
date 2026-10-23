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

### Hosted dry-run result supplied by user

The Windows CLI 2.117.0 dry run succeeded against project
`ntbowgutwyyhhnmkadlv` using the exact command above. Its output selected exactly
all 15 expected migrations, in ascending version order, and stated migrations
would not be pushed. A local `.sql.before-eof-fix.bak` file was correctly skipped
because it is not a migration filename. No Vault update, migration application,
function deployment, or frontend release was requested by that command.
The result establishes connectivity and migration selection; applying the SQL
against the existing hosted schema remains unverified. Production application
requires explicit authorization before removing `--dry-run`.

### Hosted application stopped on pre-existing vocational schema

User output reports successful application of `20261009170000` and
`20261010230000`, followed by SQLSTATE 42P07 at the first CREATE TABLE in
`20261019010000`: `public.programme_hub_vocational_templates` already exists.
The failing migration explicitly starts a transaction. No later migration is
reported as attempted. Verify recorded history before further action.
This confirms schema/history drift; migration selection alone did not establish
absence of manually applied SQL. Do not retry, drop existing tables, add blanket
IF NOT EXISTS, or repair history without comparing existing definitions, RLS,
grants, functions and triggers with the intended migration effects. No function
deployment or Netlify release has been performed as part of this handoff.

### User-confirmed hosted database rollout completion

Subsequent user CLI output confirmed all four baseline versions in both local
and remote migration history. A new dry run selected exactly the nine later
versions. The user then applied those nine versions with `--include-all
--skip-vault`; output listed each application and ended `Finished supabase db
push` without errors. Together with the prior two successful applications and
four reconciled history entries, all 73 repository migration versions are now
accounted for by the supplied evidence. This is user-supplied execution evidence,
not an independently queried final history or hosted functional smoke test.

Next step: deploy only `rev-scheduling-job-import` and
`rev-meeting-reminder-deliver`, using CLI `functions deploy` with explicit names,
project ref and `--use-api` (server-side bundling avoids local Docker). CLI 2.117.0
help confirms this syntax. Keep verify_jwt=true from project configuration and
reminder provider execution false. No secrets or origin settings are changed by
these proposed deployment commands. Both use existing server secret
REV_CALENDAR_OAUTH_ALLOWED_ORIGIN, which still needs hosted origin verification.
No function deployment has yet been reported.

### User-confirmed Edge Function deployment

The user ran CLI 2.117.0 `functions deploy` with the two explicit names,
`--project-ref ntbowgutwyyhhnmkadlv --use-api`. Output listed the source assets
and confirmed both functions deployed. No no-verify-jwt flag was used; source
configuration keeps JWT verification enabled and the reminder provider gate
false. No frontend release occurred.

Cloud attempted read-only OPTIONS preflights for both endpoints using origin
`https://rev11.netlify.app` and requested headers
`apikey,authorization,content-type,x-client-info`. Both attempts were blocked by
the execution environment's outbound proxy with tunnel 403 before reaching
Supabase. This is not a Supabase preflight result. Browser/Windows verification
of hosted CORS and authenticated behavior remains outstanding.

### Hosted import preflight refusal and scheduling configuration correction

User OPTIONS request from `https://rev11.netlify.app` reached edge runtime and
returned empty 403 without CORS headers. This matches the import boundary's
origin-refusal path; hosted secret values have not been inspected. The import
entry point read only REV_CALENDAR_OAUTH_ALLOWED_ORIGIN, unlike existing
scheduling entry points which prefer REV_SCHEDULING_ALLOWED_ORIGINS and use the
comma-separated scheduling origin resolver. Updated import to use that same
configuration preference and resolver without changing shared helper behavior,
server secrets, JWT checks, roles, or writes.

Five focused Node boundary tests pass, including two new preflight regressions:
configured Netlify/development origins succeed without authentication or writes;
missing/unconfigured/unlisted/lookalike origins fail without CORS access.
Hosted redeployment and a new OPTIONS check are required. If the configured
scheduling allowlist itself omits rev11, this code change alone will not permit
it; inspect the intended configuration before changing any shared secrets.
Reminder endpoint preflight remains unverified and its provider gate is false.

### Scheduling preflight verified; reminder-specific origin prepared

User confirmed import redeployment, then supplied OPTIONS 204 with exact
Access-Control-Allow-Origin https://rev11.netlify.app, POST/OPTIONS methods and
all four requested headers. This verifies import CORS, not authenticated writes.
Reminder OPTIONS returned empty 403 from edge runtime. It still used the shared
calendar single-origin setting; its value is uninspected.

Added REV_MEETING_REMINDER_ALLOWED_ORIGIN, scoped to the reminder entry point,
with the previous calendar setting retained only as fallback. Explicit empty
configuration remains fail-closed. The single-origin resolver remains unchanged.
The proposed setting is https://rev11.netlify.app, with no slash; existing calendar
and scheduling secret values must remain unchanged. Ten focused reminder boundary
and orchestrator tests pass, including origin override/fallback, exact-production
preflight, unlisted/lookalike rejection, authentication/roles, explicit consent,
and the disabled provider gate. No actual provider or production request issued.

User handoff: pull Git changes, set only the reminder-specific origin through
CLI secrets set, deploy only rev-meeting-reminder-deliver using --use-api, then
repeat the OPTIONS check. Provider execution remains false and verify_jwt=true.
This setting/deployment has not yet been reported as performed.
