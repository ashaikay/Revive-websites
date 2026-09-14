# Phase 2D.0 Pre-Migration Backup Manifest

**Captured:** 2026-09-12
**Project:** Revive Websites
**Project ref:** `ntbowgutwyyhhnmkadlv`
**Scope:** Local, read-only public schema backup

## Artifacts

- `public_schema_redacted.sql` — credential-safe schema-only dump of the remote `public` schema.
- Raw dump was written temporarily outside the repository and deleted immediately after redaction.

## Safety Checks

- Legacy JWT match count in raw dump: 1; replaced with `<REDACTED_LEGACY_SERVICE_ROLE_JWT>`.
- Secret-key pattern match count in raw dump: 0.
- Raw credential-bearing dump retained: No.
- Remote changes made: None.
- Data contents included: No; schema-only dump.

## Captured Objects

The redacted dump preserves the current `public` schema objects, including `public.quotes`, its primary key, indexes, RLS policies, grants, `quotes-telegram-alert`, and the public `rls_auto_enable` event-trigger function.

## Restoration Boundary

This artifact is evidence for reconciliation, not a migration or restore script. Do not execute it against the existing project without a separately approved recovery procedure.
