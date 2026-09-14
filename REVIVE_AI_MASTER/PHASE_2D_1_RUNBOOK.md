# Phase 2D.1 Migration and Controlled RLS Runbook

**Status:** Partially executed in Phase 2D.1C. Migration `20260912162730_rev_core.sql` is applied; the remaining Auth/RLS test sequence is blocked by the live anonymous helper grants.
**Project:** Revive Websites / `ntbowgutwyyhhnmkadlv`
**Production objects protected:** `public.quotes`, quote policies/indexes, `quotes-telegram-alert`, `telegram-alert-ts`, marketing website

## Stop Rules

Stop immediately on any unexpected object collision, failed backup, policy mismatch, trigger/function change, authentication failure, cross-tenant read/write, credential exposure, or test cleanup ambiguity. Do not continue after a security failure. Do not run the rollback against production without separate approval.

## Sequence

| Step | Command/action | Expected result | Rollback/stop condition |
| --- | --- | --- | --- |
| 1. Pre-flight backup | Verify `backups/pre_phase_2d/public_schema_redacted.sql`, manifest, quote baseline, and rollback artifact hashes | Backup is present, credential-safe, and readable | Stop if missing, stale, or contains a raw credential |
| 2. Confirm project | `supabase projects list`; verify ref is `ntbowgutwyyhhnmkadlv` | Existing Revive project only | Stop on any ref/name mismatch; never create a project |
| 3. Migration history | `supabase migration list --linked --workdir revive-app` | Remote historical `0001` preserved; local `20260912162730` is the only forward migration and is unapplied | Stop; do not repair remote history or push if output differs |
| 4. Apply migration | Only after explicit approval: `supabase db push --linked --workdir revive-app` | Approved REV objects created; quote objects unchanged | Stop immediately on any SQL error or unexpected diff; do not retry blindly |
| 5. Verify objects | Read-only catalog queries for tables/functions/indexes and `supabase inspect db table-stats` | Ten REV tables, approved helpers, indexes present | Roll back only through approved rollback plan; preserve quote objects |
| 6. Verify RLS | Catalog query for `relrowsecurity` on every REV table | RLS enabled on every tenant table | Stop if any tenant table lacks RLS |
| 7. Verify policies | Catalog query for policy names, roles, commands, USING/WITH CHECK | Policies match approved migration; no direct membership writes | Stop on broad or missing policy |
| 8. Verify helpers | Catalog query for owner, `prosecdef`, config/search_path, and function ACLs, including `create_workspace_with_owner(text,text)` | Helpers and bootstrap owned by migration/database owner, empty search path, authenticated-only execute, no `PUBLIC`/`anon` execute | **Observed failure:** live ACLs grant `ALL` to `anon`; stop before test identities |
| 9. Create test identities | Use temporary Auth users tagged `RLS_TEST_USER_A/B/C` in the controlled environment only | Three test identities created; no production users | Stop if environment is not explicitly non-production/controlled |
| 10. Bootstrap A | Call approved `public.create_workspace_with_owner(name, slug)` as User A with `RLS_TEST_WORKSPACE_A` | Atomic workspace + owner membership + audit event created for A | Stop if caller can choose owner/role, anon can execute, or partial rows remain |
| 11. Bootstrap B | Call the same RPC as User B with `RLS_TEST_WORKSPACE_B` | Atomic workspace + owner membership + audit event created for B | Stop if A can observe or alter B during setup |
| 12. User A positive tests | Authenticated A reads own profile/contacts/goals/actions/approvals/memory/audit | Own workspace reads succeed | Stop if any expected own read fails |
| 13. User B positive tests | Authenticated B repeats A tests for B | Own workspace reads succeed | Stop if any expected own read fails |
| 14. Cross-tenant attacks | A and B attempt foreign SELECT, INSERT, UPDATE, DELETE, approval, membership, and role changes | Every foreign operation is denied or returns no rows | Stop on one successful cross-tenant operation |
| 15. Non-member test | User C attempts both workspaces | No tenant rows or writes available | Stop on any access |
| 16. Inactive-member test | Suspend a tagged membership through approved admin path, then retry access | Access denied after suspension | Stop if stale access remains |
| 17. Role tests | Test owner/admin/member capabilities from `WORKSPACE_BOOTSTRAP_SECURITY.md` | Only approved capabilities succeed | Stop on self-promotion, owner creation by admin, or unauthorized removal |
| 18. Cross-tenant FK tests | Attempt action/approval child rows with mismatched workspace/parent IDs | Composite FK rejects them | Stop if mismatched child row is accepted |
| 19. Quote protection | Re-run quote baseline catalog queries and row count | `quotes` schema/policies/indexes/trigger unchanged | Stop and rollback only under approved procedure on any difference |
| 20. Telegram protection | Verify function name/status/version/`verify_jwt`; inspect trigger target only | Existing function and trigger unchanged | Stop on any change or notification regression |
| 21. Marketing check | Load public quote form and perform only an approved controlled test if separately authorised | Existing behavior unchanged | Stop; never use real customer data |
| 22. Cleanup | Remove only tagged test users, memberships, workspaces, and child records | Test artifacts removed; `public.quotes` untouched | Stop if cleanup scope is ambiguous |
| 23. Adapter gate | Keep mocks active until all prior results are recorded and approved | No live REV UI connection yet | Stop before adapter activation on any failed test |
| 24. Closeout | Store redacted evidence, test results, and approvals | Phase gate is reviewable | Do not start the next phase automatically |

## Required RLS Attack Matrix

For both directions A→B and B→A, test:

- Profile, contacts, goals, actions, approvals, memory, and audit SELECT
- Foreign INSERT
- Foreign UPDATE
- Foreign DELETE
- Approval decision against the foreign action
- Membership insert/update/delete and role escalation
- Child records with foreign workspace/parent IDs

All must fail. A successful query returning zero rows is acceptable where PostgreSQL RLS uses silent filtering; writes must fail or affect zero rows according to the approved API contract.

## Audit Requirements

Record job ID, workspace ID, actor, capability, approval requirement, correlation ID, operation, result, and timestamp for every privileged/system action. Never log Auth tokens, database credentials, Secret keys, Telegram secrets, or raw customer payloads.

## Rollback

Use [PHASE_2D_ROLLBACK_PLAN.md](PHASE_2D_ROLLBACK_PLAN.md) only after approval. Rollback must remove only REV objects and preserve the quote/Telegram/marketing baseline.

## Current Gate

This runbook is not executed. Phase 2D.1 is not started.
