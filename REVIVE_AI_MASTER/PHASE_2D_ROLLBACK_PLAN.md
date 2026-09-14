# Phase 2D Rollback Plan

**Status:** Future procedure only; not executed
**Migration:** `20260912162730_rev_core.sql`
**Target:** REV objects introduced by a separately approved Phase 2D.1 migration

## Rollback Rules

Rollback may remove only REV objects created by the approved migration. It must never drop, alter, or recreate:

- `public.quotes`
- `quotes_pkey`
- `idx_quotes_status`
- `idx_quotes_created_at`
- `allow public inserts`
- `allow authenticated reads`
- `quotes-telegram-alert`
- `telegram-alert-ts`
- marketing-site storage/configuration
- existing quote data

## Preconditions

1. Stop REV application writes and preserve logs.
2. Confirm the migration version and object manifest being rolled back.
3. Verify the protected quote-object checksum/name list against `QUOTES_PROTECTION_BASELINE.md`.
4. Capture a fresh schema/data backup.
5. Obtain explicit rollback approval.

## Rollback Order

1. Disable only the REV application adapter/feature flag, leaving marketing quote submission active.
2. Remove only REV policies by exact approved names, including `audit_log_select` and `audit_log_insert`.
3. Remove only REV helper functions by exact signatures, after verifying no dependent object remains; include their explicit execute grants/revocations in the change record.
4. Remove only REV indexes by exact names.
5. Remove REV tables in reverse dependency order: `audit_log`, `business_memory_events`, `approvals`, `rev_actions`, `contacts`, `goals`, `business_services`, `business_profiles`, `workspace_members`, `workspaces`.
6. Do not remove `pgcrypto` automatically; it may be shared by existing or future objects.
7. Verify the quote baseline, RLS, policies, indexes, trigger, and Edge Function are unchanged.

## Validation Queries

Run read-only checks after rollback:

- `public.quotes` still exists with the baseline columns and primary key.
- Quote RLS remains enabled.
- Both quote policies remain present with the baseline roles/commands/expressions.
- The three quote indexes remain present.
- `quotes-telegram-alert` remains an `AFTER INSERT` trigger targeting `telegram-alert-ts`.
- The Edge Function remains active and unchanged.
- Quote row count is unchanged.
- REV tables/functions/policies/indexes are absent only where rollback was approved.

## Risk and Recovery

- **Risk:** High. Incorrect rollback can remove tenant data or break Auth dependencies.
- **Recovery:** Stop immediately, preserve the database state, restore only from the approved backup, and re-run the quote protection validation. Never test restore against production casually.
- **Remote execution:** This plan has not been executed and must not be executed until Phase 2D.1 is separately approved.
