# Supabase Reconciliation Plan

**Prepared:** 2026-09-12  
**Target:** Existing Revive Websites project `ntbowgutwyyhhnmkadlv`  
**Status:** Planning only; no remote changes authorized

## Preconditions

1. SQL-level metadata access is made available through Docker-backed Supabase CLI dump or an authorized database password for native `pg_dump`.
2. The existing project remains linked only to `ntbowgutwyyhhnmkadlv`.
3. The remaining schema, policy, function, trigger, extension, and realtime inventory is captured in `SUPABASE_EXISTING_STATE.md`.
4. The verified inventory is reviewed against the protected marketing site, especially empty `quotes`, absent storage buckets, and `telegram-alert-ts`.
5. Phase 2D activation approval is recorded separately.

Do not create another project, reset the database, apply the Phase 2B migration wholesale, replace policies, alter Auth users, or switch the app from mocks during these steps.

## Staged Strategy

### Stage 1 — Protect and back up current state

- **Objects:** Existing schema, data, policies, Auth configuration, storage metadata, functions, and migration history.
- **Current state:** Project is active and linked. Safe metadata shows `public.quotes` with zero estimated rows, three indexes, no storage buckets, and one deployed edge function. SQL dump was blocked because Docker Desktop is unavailable.
- **Desired state:** Reproducible, access-controlled backups and an evidence snapshot.
- **Destructive:** No.
- **Data migration:** No.
- **Rollback:** Restore only through a separately approved recovery procedure; never test restore against production.
- **Risk:** High until inventory and backups are verified.

### Stage 2 — Inventory and map existing schema

- **Objects:** Schemas, tables, columns, keys, indexes, triggers, sequences, extensions, functions, and realtime publication.
- **Current state:** Partially verified. `public.quotes` and its known columns/indexes are visible; types, constraints, RLS, functions, triggers, extensions, and realtime remain unverified.
- **Desired state:** A complete object map with ownership and dependencies.
- **Destructive:** No.
- **Data migration:** No.
- **Rollback:** Delete the local evidence artifact only; no remote rollback needed.
- **Risk:** Medium.

### Stage 3 — Reconcile missing domain schema

- **Objects:** Workspaces, workspace members, business profiles/services, goals, contacts, REV actions, approvals, memory events, and audit logs.
- **Current state:** Local Phase 2B SQL is prepared. Verified remote application inventory contains only marketing `public.quotes`; the ten REV entities are not present in the visible application table inventory.
- **Desired state:** Add only missing objects, or create explicit non-destructive ALTER/data migration scripts for compatible renamed objects.
- **Destructive:** Additive changes should be non-destructive. No drops or silent type changes.
- **Data migration:** Only after a table-by-table mapping, row counts, nullability review, and dry-run validation.
- **Rollback:** Versioned down scripts for additive objects; restore from backup for data transformations.
- **Risk:** High because existing marketing objects may share the project.

### Stage 4 — Establish membership and RLS

- **Objects:** Membership helpers and policies for every tenant-owned table, including existing tables that hold business data.
- **Current state:** Unknown for `quotes` and any future tenant tables. The anon zero-row select succeeds, but that does not prove safe insert/select policy behavior.
- **Desired state:** Authenticated users can access only workspaces in which they have active membership; writes are role-controlled; no permissive `USING (true)` policies.
- **Destructive:** Policy additions can be non-destructive, but replacing or tightening existing policies can change behavior and must be staged.
- **Data migration:** Possibly required for orphaned rows or missing workspace ownership.
- **Rollback:** Versioned policy migration plus tested restore of the prior policy definition.
- **Risk:** Critical.

### Stage 5 — Connect Auth in a controlled environment

- **Objects:** Supabase Auth configuration and application session adapter.
- **Current state:** REV uses development-only mock auth. Remote Auth exposes email signup, with email/phone auto-confirm disabled; no user count or redirect configuration was collected.
- **Desired state:** Session restoration and password recovery work, then membership lookup gates workspace access.
- **Destructive:** No user deletion or provider disabling.
- **Data migration:** No; existing users must be preserved and mapped deliberately.
- **Rollback:** Feature flag back to mock provider; do not delete users.
- **Risk:** High.

### Stage 6 — Implement the repository adapter

- **Objects:** `revive-app` repository interfaces and Supabase adapter.
- **Current state:** Adapter intentionally throws and the mock provider is active.
- **Desired state:** Application services call a tested Supabase implementation; React remains provider-agnostic.
- **Destructive:** No.
- **Data migration:** No.
- **Rollback:** Keep mock provider as a feature-flagged fallback.
- **Risk:** High until RLS integration tests pass.

### Stage 7 — Seed development workspaces

- **Objects:** Non-production development/test workspaces only.
- **Current state:** Revive and Family Legacy exist only as local mock fixtures.
- **Desired state:** Seed data only in an explicitly designated non-production environment after approval.
- **Destructive:** No; never seed real customer data.
- **Data migration:** No real business/customer data.
- **Rollback:** Delete only approved development fixture rows by known IDs.
- **Risk:** Medium.

### Stage 8 — Cross-tenant and security verification

- **Objects:** RLS policies, membership helpers, repository queries, Auth sessions, storage policies, and RPCs.
- **Current state:** Local mock isolation tests pass; remote enforcement is untested.
- **Desired state:** Cross-workspace reads and writes fail; role boundaries and storage paths are tested.
- **Destructive:** No.
- **Data migration:** No.
- **Rollback:** Disable activation flag and retain mock provider.
- **Risk:** Critical until proven.

### Stage 9 — Selectively replace mocks

- **Objects:** Provider selection and individual application services.
- **Current state:** All REV data and Auth remain mocked. Existing marketing Supabase client remains separate and unchanged.
- **Desired state:** Replace one read/write slice at a time after evidence and approval.
- **Destructive:** No.
- **Data migration:** Only per approved slice.
- **Rollback:** Re-enable mock provider.
- **Risk:** Medium.

## Backup and Rollback Procedure

Before any Phase 2D schema change:

1. Record the project reference, timestamp, CLI version, and operator identity.
2. Export schema-only SQL for all relevant schemas, including functions, policies, triggers, extensions, and grants.
3. Export data separately with row counts and checksums where practical; protect exports as sensitive data.
4. Record Auth configuration metadata without exporting personal user details or secrets. Do not delete or alter users.
5. Record storage bucket names, visibility, object counts, and policy definitions. Treat object data as a separate backup concern.
6. Capture deployed edge-function names/versions and deployment configuration references without logging secrets.
7. Capture migration history and the exact SQL artifact intended for review.
8. Store backups in encrypted, access-controlled storage outside the application repository; never commit dumps, keys, tokens, or PII.
9. Review a dry-run diff against the backup and obtain approval before execution.
10. For rollback, stop application writes, preserve incident evidence, restore only through the approved recovery runbook, and verify RLS/auth/storage behavior before reopening access.

No backup or restore was executed in Phase 2C because no destructive Phase 2D change is authorized. A schema dump was attempted but could not run because the Supabase CLI requires Docker Desktop; native `pg_dump` also requires an authorized database password.

## Exact Phase 2D Entry Actions

1. Obtain Docker Desktop or an authorized database password for native `pg_dump`.
2. Capture schema-only SQL including all relevant schemas, policies, functions, triggers, extensions, grants, and realtime publication.
3. Complete the table-by-table compatibility matrix, including exact `quotes` types, constraints, and policy definitions.
4. Review the empty marketing `quotes` table, absent storage buckets, and `telegram-alert-ts` coexistence and secret handling.
5. Execute backups using the procedure above.
6. Obtain explicit approval for additive schema work and RLS changes.
7. Apply and test one migration slice at a time, never using the Phase 2B rollback script against the existing project.
8. Keep mocks active until Auth, membership, RLS, repository, and cross-tenant tests pass.
9. Stop before any AI, email, SMS, voice, payment, or external communication activation.
