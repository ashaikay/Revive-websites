# Local database integration validation — 23 October 2026

Validated on an isolated cloud Docker host, starting from checkpoint `1b27fef`
and test-runner commit `50b36f3`. No hosted Supabase changes, production
credentials, provider calls, email delivery, or Netlify deployment were involved.

## Results

- All 73 committed project migrations applied to a fresh PostgreSQL 17 database.
- `npm run test:db:local`: 21/21 suites passed, including a repeat run using the
  saved command after correcting the reminder fixture.
- `npm run test:node`: 536/536 tests passed, including three local endpoint and
  binding guard tests.
- The parent commit's 826/826 Vitest tests and production build passed. This
  change adds validation tooling and fixes a test harness; application source,
  database migrations, permission checks, and provider enablement are unchanged.

| Local validation scope | Result |
| --- | --- |
| Ordinary/restricted vocational-question privacy | Passed |
| Consent foundation, operations, and hardening | Passed (three SQL suites) |
| Authenticated consent access boundary | Passed |
| Consent lifecycle across roles and workspaces | Passed |
| Programme Hub and employer engagement | Passed (two API harnesses) |
| Workspace staff, module access, Scheduling management | Passed (three API harnesses) |
| Worker records, patterns, unavailability/sickness | Passed (three API harnesses) |
| Annual leave stages 1 and 2 | Passed (two API harnesses) |
| Scheduling jobs, daily sessions, assignments, import | Passed (four API harnesses) |
| Reminder delivery authority and idempotency | Passed |

The reminder harness verifies consent, disabled-by-default capability, role and
tenant restrictions, concurrent claims, exact replay, stale approval invalidation,
unknown-outcome handling, and prevention of a second provider attempt. It models
provider outcomes through local database RPCs; it does not send email.

## Harness corrections

The original reminder fixture always required draft creation to succeed, including
for a deliberately unbooked meeting. The database correctly rejected that draft
with `Provider-accepted meeting required`. The harness now asserts that refusal
and continues to test approval denial. No database guard was relaxed.

The concurrent claim check also assumed that the owner's request always won.
Replay now uses the actor and request ID of whichever claim actually succeeded.
At-most-one-claim, no-resend, audit, and provider-outcome assertions remain enabled.

## Reproducing the checks

Use the committed Supabase configuration, Node.js 22.18+ or 24, Docker, and pinned
CLI `supabase@2.117.0`. Start a disposable local stack using the repository's CI
instructions, then run `npm run test:db:local` from `revive-app/`.
The runner reads local bindings without printing them and refuses hosted or
wrong-port endpoints. Both service-key aliases are overwritten so a pre-existing
binding cannot select a different credential. Results are stored under the
gitignored `revive-app/local-db-validation.local/` directory.

Cloud-specific startup required these supported runtime settings:

- `SUPABASE_HOME=/workspace/.supabase-cli` and
  `npm_config_cache=/workspace/.npm`, because the default home paths are read-only.
- `SUPABASE_USE_SLIM_IMAGES=true`, because the default full image downloads hit
  disk limits. Official slim images from `ghcr.io/supabase/cli/` downloaded with
  checksum verification. The default ECR registry returned 403; Docker Hub was
  also verified reachable before choosing the smaller official images.
- Optional services were excluded with
  `--exclude studio,storage-api,realtime,edge-runtime,imgproxy,logflare,vector,postgres-meta,supavisor`.

The environment's injected proxy sent the auth container's built-in loopback
health probe through egress, producing a false HTTP 403. A direct loopback probe
with `docker exec supabase_auth_revive-app wget -Y off -q -O - http://127.0.0.1:9999/health`
returned the GoTrue health response. Startup used `--ignore-health-check` only
after that diagnosis; all 15 authenticated local API harnesses then passed.
The Docker auth health label still reports unhealthy in this cloud setup. This
workaround is specific to that proxy/probe issue, not a normal startup default.

There is no committed `supabase/seed.sql`; startup warned about its absent pattern.
No seed data was needed, and the tests created their own local fixtures.

## Remaining release scope

This is local integration evidence, not hosted migration, production provider,
browser, or Netlify smoke-test evidence. Other historical provider/calendar
integration harnesses outside the 15 listed above were not rerun in this step.
Review the combined checkpoint and fixes before merging. Hosted migrations,
function deployments, provider configuration, and production release remain
separate actions.
