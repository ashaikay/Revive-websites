# Phase 2D Live vs Local Reconciliation

**Prepared:** 2026-09-12
**Remote:** Revive Websites / `ntbowgutwyyhhnmkadlv`
**Local migration:** `revive-app/supabase/migrations/0001_rev_core.sql`
**Mode:** Read-only; migration not executed

**Deployment update:** The timestamped migration `20260912162730_rev_core.sql` was later applied in Phase 2D.1C. Catalog verification then found an unexpected live `anon` grant on all three SECURITY DEFINER helpers; this report remains the pre-deployment reconciliation and must be read with the Phase 2D.1C stop record.

## Live Baseline

The redacted schema backup shows one application table in `public`: `quotes`. It has zero estimated rows, RLS enabled, two policies, three indexes, and the `quotes-telegram-alert` trigger. The public `rls_auto_enable` event-trigger function is also present. No live REV table, REV helper, REV policy, or REV trigger was discovered.

## Local Migration Inventory

| Object | Type | Purpose/dependencies | Local behavior | Classification |
| --- | --- | --- | --- | --- |
| `pgcrypto` | Extension | UUID generation through `gen_random_uuid()` | `CREATE EXTENSION IF NOT EXISTS` | REVIEW: verify installed/version before execution |
| `workspaces` | Table | Tenant root; references `auth.users(id)` | RLS enabled; select/update policies | REVIEW: Auth dependency and owner-bootstrap path require design review |
| `workspace_members` | Table | User-to-workspace membership and role | RLS enabled; select-only tenant policy in hardened local proposal | REVIEW: bootstrap/invite/role RPCs must be separately designed and tested |
| `business_profiles` | Table | One profile per workspace | RLS enabled; tenant policy | SAFE name-wise; REVIEW RLS and key shape |
| `business_services` | Table | Workspace services | RLS enabled; tenant policy; unique `(workspace_id,id)` | SAFE name-wise; REVIEW redundant unique constraint/index behavior |
| `goals` | Table | Workspace goals and progress | RLS enabled; tenant policy; unique `(workspace_id,id)` | SAFE name-wise; REVIEW date/number semantics |
| `contacts` | Table | Workspace prospects/customers | RLS enabled; tenant policy; optional Auth owner FK | SAFE name-wise; REVIEW ownership/RLS |
| `rev_actions` | Table | Proposed/executed REV actions | RLS enabled; tenant policy; composite FKs to goals/contacts | SAFE name-wise; REVIEW composite FK and action lifecycle |
| `approvals` | Table | Approval records for actions | RLS enabled; tenant policy; composite FK to actions | SAFE name-wise; REVIEW approval authorization |
| `business_memory_events` | Table | Workspace operational memory | RLS enabled; tenant policy | SAFE name-wise; REVIEW actor/entity rules |
| `audit_log` | Table | Workspace audit records | RLS enabled; tenant policy | SAFE name-wise; REVIEW append-only behavior |
| `goals_workspace_idx` | Index | Workspace query/RLS performance | `CREATE INDEX IF NOT EXISTS` | SAFE: no live name collision discovered |
| `contacts_workspace_idx` | Index | Workspace query/RLS performance | `CREATE INDEX IF NOT EXISTS` | SAFE: no live name collision discovered |
| `actions_workspace_idx` | Index | Workspace query/RLS performance | `CREATE INDEX IF NOT EXISTS` | SAFE: no live name collision discovered |
| `memory_workspace_occurred_idx` | Index | Workspace/time ordering | `CREATE INDEX IF NOT EXISTS` | SAFE: no live name collision discovered |
| `audit_workspace_timestamp_idx` | Index | Workspace/time audit lookup | `CREATE INDEX IF NOT EXISTS` | SAFE: no live name collision discovered |
| `is_active_workspace_member(uuid)` | SQL function | Security-definer active membership helper | `SECURITY DEFINER`, `search_path = ''`, schema-qualified membership/Auth references, `authenticated`-only execute grant | REVIEW: owner and live grant verification required |
| `has_workspace_role(uuid,text[])` | SQL function | Security-definer role helper | `SECURITY DEFINER`, `search_path = ''`, schema-qualified membership/Auth references, `authenticated`-only execute grant | REVIEW: owner and live grant verification required |
| `create_workspace_with_owner(text,text)` | SQL function | Atomic first-workspace and owner bootstrap | `SECURITY DEFINER`, `search_path = ''`, derives creator from `auth.uid()`, internal owner role, authenticated-only execute grant | REVIEW: live owner/grants and controlled Auth/RLS test required |
| REV policies | Policies | Tenant isolation and role management | Tenant `FOR ALL` policies; membership SELECT only; audit SELECT/INSERT only | REVIEW: bootstrap/invite RPCs and workspace creation path need tests |

## Collision Review

| Object category | Result |
| --- | --- |
| Table names | No collision with live `public.quotes`; all ten proposed names are new in the captured public schema |
| Function names | No collision with live `public.rls_auto_enable`; proposed helper names are new in the captured public schema |
| Trigger names | Local migration creates no triggers; no collision with `quotes-telegram-alert` |
| Policy names | Proposed names are new; existing quote policies remain untouched |
| Index names | Proposed names are new; quote indexes remain untouched |
| Enum/type names | No custom enum or type is created; inline text checks are used |
| Extension requirements | `pgcrypto` is required for UUID defaults; verify existing extension state before applying |
| Auth dependencies | `auth.users(id)` is referenced by workspaces, members, contacts, and approvals; Auth must remain available |
| Foreign keys | Composite workspace-scoped FKs require parent keys and insertion order; validate before migration |
| Grants/default privileges | Migration defines no explicit grants. Existing/default privilege behavior must be reviewed before exposure |
| RLS helper functions | Two `SECURITY DEFINER` functions use `search_path = ''`, schema-qualified references, and revoke public execution/grant authenticated execution in the local proposal; verify owner/grants live before deployment |
| UUID generation | Uses `gen_random_uuid()` from `pgcrypto`; verify extension before execution |
| Timestamps | Uses `now()` and `timestamptz`; consistent with PostgreSQL but validate application serialization |

## Quotes and Telegram Safety

Executing `0001_rev_core.sql` as written does not reference, alter, replace, drop, or grant against:

- `public.quotes`
- `quotes-telegram-alert`
- `telegram-alert-ts`

It is therefore **SAFE by direct object-name interaction** for the quote/Telegram objects. It is still **BLOCKED for execution** until the migration-history duplicate presentation, Auth bootstrap, security-definer grants, and RLS behavior are separately reviewed and approved.

## Migration History Finding

Local files:

- `0001_rev_core.sql` — forward migration
- `REVIVE_AI_MASTER/rollback/0001_rev_core_rollback.sql` — rollback artifact

The rollback artifact was moved outside `supabase/migrations/`. The CLI now shows one local `0001` entry with no matching remote migration. No remote migration history was repaired or changed.

## Classification Summary

- **SAFE:** New table/index names do not collide with captured live quote objects; migration contains no quote/Telegram references.
- **REVIEW:** `pgcrypto`, Auth dependencies, membership bootstrap, grants, helper functions, policy semantics, composite foreign keys, and application timestamp/UUID assumptions.
- **REVIEW:** Audit policy is now append/read-only for tenant users; service-side audit writes require the future privileged backend path.
- **REVIEW:** A future `create_workspace_with_owner` SECURITY DEFINER RPC is required because the migration intentionally provides no direct tenant membership bootstrap write policy.
- **REVIEW:** `create_workspace_with_owner(text,text)` is now implemented locally with internal owner assignment and audit insertion; it is not deployed.
- **CONFLICT:** None identified by the captured public schema.
- **BLOCKER:** Do not execute until the corrected migration layout is approved, the exact security-definer and RLS behavior is reviewed in a controlled environment, and a backup/rollback approval exists.
