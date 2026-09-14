# Phase 4C Execution Control Plane Production Migration Report

**Date:** 2026-09-14
**Status:** PRODUCTION MIGRATION APPLIED + VERIFIED
**Project:** Revive Websites / `ntbowgutwyyhhnmkadlv`
**Migration:** `20260914183000_rev_execution_control_plane.sql`

## Scope

- Drafted `20260914183000_rev_execution_control_plane.sql` and a guarded rollback companion.
- Rehearsed only against isolated local Supabase project `revive-app` (`127.0.0.1:55321`, database port `55322`) with pinned CLI `2.117.0`.
- No linked push, remote SQL, production migration, provider call, external communication, Execute control, or platform execution enablement occurred.
- `public.quotes`, quote indexes/policies/trigger, Telegram, the marketing site, and `rev-business-verify` were not changed.

## Drafted Controls

- Disabled-by-default workspace execution policy with supervised autonomy and zero cost ceilings.
- Durable dry-run execution attempts, workspace-scoped idempotency uniqueness and advisory locking.
- Action versions and deterministic approval fingerprints; legacy unbound or stale approvals cannot authorize preparation.
- Owner/admin-only approval and dry-run preparation RPCs; member proposals remain supported and viewers remain read-only.
- Backend-only result recording and provider-usage evidence; ordinary authenticated DML cannot forge execution, usage, or audit evidence.
- Explicit table/function ACLs, role-specific RLS policies, immutable evidence triggers, composite workspace foreign keys, and hardened routine search paths.

## Local Validation

- Clean local migration application: PASS.
- Catalog audit: 3/3 new tables have RLS; 11 reviewed operation-specific policies; zero broad `ALL` policies; zero anonymous authority-table grants; zero authenticated evidence-write grants.
- Routine audit: two postgres-owned `SECURITY DEFINER` user RPCs with empty search paths; backend result routine is `SECURITY INVOKER`, unavailable to `authenticated`, and executable by `service_role` only.
- Phase 4C local Auth/RLS/ACL matrix: 42/42 assertions PASS.
- Adjacent tenant/opportunity attack regression: PASS.
- Rollback evidence guard: PASS; populated evidence blocks destructive rollback.
- Empty-state rollback rehearsal: PASS; Phase 4C objects removed and local quote catalog unchanged.
- Focused migration/rollback tests: 7/7 PASS.
- Full application tests: 148/148 PASS.
- Production build: PASS.
- `npm audit`: 0 vulnerabilities.

The Supabase CLI intermittently exceeded its Storage or pg-meta health-check window after successful local migration application. Settled containers and catalogs were inspected each time; a clean stop/start completed successfully for the final attack rehearsal. This was local tooling behavior, not a migration or application failure.

## Security Findings Resolved During Rehearsal

- Rejected a custom session setting as a trust marker because `authenticated` can set arbitrary custom settings. Trusted transitions now depend on database execution role provenance.
- Corrected runtime-invalid schema qualification of `COALESCE` found by exercising the preparation RPC.
- Preserved legacy proposal compatibility by normalizing `rev_actions.execution_status` to `not_executed` and retaining established proposal/attribution insert behavior.
- Removed inherited anonymous privileges from action, approval, audit, policy, execution, and provider-usage authority tables.

## Production Deployment and Verification

- Preflight confirmed the exact linked target and only migration `20260914183000` pending. Migration SHA-256: `A53110C0C7360A2BED1C93E519685409456BE37812DE0AB2874ED07A481D6560`.
- Credential-safe pre/post schema evidence and aggregate counts are retained under `REVIVE_AI_MASTER/backups/pre_phase_4c_production_20260914/`; raw dumps were deleted.
- The migration was applied once with pinned CLI `2.117.0`; no seed, role file, unrelated migration, Edge Function, or rollback was applied.
- Production-safe verification passed 25/25 assertions inside one transaction that ended with `ROLLBACK`. No fixture, approval decision, policy row, execution attempt, provider usage event, provider call, or external communication persisted.
- Owner and admin approval passed. Member approval, viewer writes, inactive/non-member access, cross-tenant access, direct execution/usage writes, and audit forgery were denied.
- Stale and legacy-unbound approvals cannot authorize preparation. Idempotency uniqueness/locking and append-only evidence controls were verified.
- Workspace policy defaults remain execution OFF, `always_ask`, and zero cost ceilings. `PLATFORM_EXECUTION_ENABLED` remains false and no Execute control exists.
- The protected quote/Telegram fingerprint was identical before and after: `29575E57749D82AEBC9F9AF220B4573ABFD3AA87135F46D78310DCAA7478950E`. Telegram Edge Function version/hash/status were unchanged.
- Final validation: 148/148 tests passed, build passed, and `npm audit` reported 0 vulnerabilities.

## Next Gate

Phase 4C installs authority and persistence controls only. The first real REV execution capability, provider activation, external communication, payment action, or Execute control requires separate explicit authorization.
