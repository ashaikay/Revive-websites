# REV Phase 2D.1A — Migration History Reconciliation

**Date:** 2026-09-12
**Project:** Revive Websites
**Project ref:** `ntbowgutwyyhhnmkadlv`
**Mode:** Reconciliation record; local renumbering is complete and the timestamped migration was later applied in Phase 2D.1C

## Migration History Evidence

Command:

```text
supabase migration list --linked --workdir revive-app
```

Observed:

```text
Local | Remote | Time (UTC)
0001  | 0001   | 0001
```

Local migration:

- Old file: `revive-app/supabase/migrations/0001_rev_core.sql`
- Old SHA256: `AD50BB14AF2EB2FF69A84A996424315647C613ED3974DDD8F9C79B6214167479`
- New file: `revive-app/supabase/migrations/20260912162730_rev_core.sql`
- New SHA256: `AD50BB14AF2EB2FF69A84A996424315647C613ED3974DDD8F9C79B6214167479`
- Hashes identical: **YES**
- New rollback file: `REVIVE_AI_MASTER/rollback/20260912162730_rev_core_rollback.sql`
- Old local `0001` removed: **YES**
- Migration directory contains only the new timestamped forward migration.

The migration-history schema could not be dumped as `supabase_migrations`; the CLI returned `pg_dump: no matching schemas were found`. The CLI migration list confirms the remote historical version `0001`, but no remote migration name, checksum, SQL text, or timestamp metadata beyond the displayed version/time columns was available through the supported read-only command. The remote `0001` was preserved and not repaired.

## Remote State Classification

**Classification: A — HISTORY ONLY**

Evidence:

- Fresh schema-only dump contains only the application table `public.quotes` and public function `rls_auto_enable()`.
- None of the ten proposed REV tables exists in the fresh public-schema dump or table statistics.
- None of the three proposed REV helper functions exists.
- None of the proposed REV policies or indexes exists.
- `public.quotes` remains the only table reported by live table statistics.

This classification described the pre-deployment state. The approved REV migration is now locally renumbered and has subsequently been applied as `20260912162730`; its live ACL verification failed because `anon` received explicit execution grants on the SECURITY DEFINER helpers.

## Live-vs-Local Object Matrix

| Object | Local definition expected | Live exists | Definition match | Security-sensitive difference | Later action |
| --- | --- | --- | --- | --- | --- |
| `workspaces` | Tenant root table, Auth creator FK, RLS | NO | NO | Missing | Investigate remote history before any repair |
| `workspace_members` | Workspace/user membership, roles/status, RLS | NO | NO | Missing | Same |
| `business_profiles` | Workspace profile, RLS | NO | NO | Missing | Same |
| `business_services` | Workspace services, RLS/index | NO | NO | Missing | Same |
| `goals` | Workspace goals, RLS/index | NO | NO | Missing | Same |
| `contacts` | Workspace contacts, RLS/index | NO | NO | Missing | Same |
| `rev_actions` | Workspace actions, composite parent FKs, RLS/index | NO | NO | Missing | Same |
| `approvals` | Workspace approvals, composite action FK, RLS | NO | NO | Missing | Same |
| `business_memory_events` | Workspace memory, RLS/index | NO | NO | Missing | Same |
| `audit_log` | Workspace audit records, append/read-only tenant policy, RLS/index | NO | NO | Missing | Same |
| `is_active_workspace_member(uuid)` | SECURITY DEFINER, empty search path, authenticated-only execution | NO | UNKNOWN | No live helper | Do not assume remote function exists |
| `has_workspace_role(uuid,text[])` | SECURITY DEFINER, empty search path, authenticated-only execution | NO | UNKNOWN | No live helper | Same |
| `create_workspace_with_owner(text,text)` | SECURITY DEFINER atomic bootstrap, `auth.uid()`, internal owner, authenticated-only execution | NO | UNKNOWN | No live bootstrap | Same |
| REV policies | Tenant policies; no direct membership mutation; audit SELECT/INSERT | NO | UNKNOWN | No live RLS | Same |
| REV indexes | Five workspace/time indexes | NO | UNKNOWN | No live indexes | Same |
| `pgcrypto` | Required by local UUID defaults | Not established by public dump | UNKNOWN | Extension metadata not captured as a public object | Verify only after approved path |

## Existing Quote Protection

Fresh backup confirms:

- `public.quotes`: present
- Estimated rows: `0`
- RLS: enabled
- Policies: `allow public inserts`, `allow authenticated reads`
- Indexes: `quotes_pkey`, `idx_quotes_status`, `idx_quotes_created_at`
- Trigger: `quotes-telegram-alert`, `AFTER INSERT`
- Target: `telegram-alert-ts`
- Edge Function: active, version 1, `verify_jwt: true`
- No quote or Telegram changes made

## Source of Remote `0001`

- **Classification:** UNKNOWN
- **Confirmed:** The current authenticated CLI reports remote `0001`; the current session did not run `db push`, `migration repair`, `db reset`, or migration SQL.
- **Confirmed:** The fresh public schema does not contain the approved REV objects.
- **Repository evidence:** No tracked repository history contains `supabase db push` or `migration repair`.
- **Possible explanations:** A prior untracked/local session, an external operator, or a migration-history record not represented by the current public schema. No explanation is asserted without migration-table metadata.

## Fresh Backup

- Fresh backup: **PASS**
- Safe path: `REVIVE_AI_MASTER/backups/pre_phase_2d_1/public_schema_redacted.sql`
- Manifest: `REVIVE_AI_MASTER/backups/pre_phase_2d_1/CHECKPOINT_MANIFEST.md`
- Raw deleted: **YES**
- Secret scan: no JWT-shaped value and no `sb_secret_` literal in safe copy
- Backup contains quotes table, RLS, policies, indexes, and trigger: **YES**

## Recommended Later Action

Do not repair migration history or run `supabase db push` yet. First obtain an authorized read-only method to inspect the migration metadata source and determine what remote `0001` represents. Then compare that migration's SQL/object manifest against the protected quote baseline and approved local migration. Only after explicit review should a new reconciliation migration or controlled history action be proposed.

## Commands That Must Not Yet Run

- `supabase db push`
- `supabase migration repair`
- `supabase db reset`
- Any rollback SQL
- Any migration SQL through SQL editor
- Auth user/workspace creation
- Bootstrap RPC execution

## Local Validation

- Tests: 15 passing
- Build: passing
- Audit: 0 vulnerabilities
- REV frontend: remains mock-backed

**Remote changes:** None.
