# Existing Revive Supabase State

**Inspection date:** 2026-09-12  
**Phase:** 2D.0 — Pre-Migration Backup and Reconciliation  
**Inspection mode:** Read-only; no remote database changes performed

## Project Identification

- **Project:** Revive Websites
- **Project reference:** `ntbowgutwyyhhnmkadlv`
- **Project URL:** `https://ntbowgutwyyhhnmkadlv.supabase.co`
- **Identification source:** Authenticated Supabase CLI project listing and successful `supabase link`
- **Current remote state:** Active. `supabase link --project-ref ntbowgutwyyhhnmkadlv --workdir revive-app` completed successfully.
- **New project created:** No
- **Local project link created:** Yes, to the exact existing reference only

The project list also showed separate Song Music, Mothers Legacy, and fathers leagacy projects. None was used for REV.

## Local Connection Findings

- Root `.env` exists but is empty.
- `revive-app` has no `.env` or live Supabase client. It is now safely linked for CLI inspection; the generated `.temp` metadata contains the project reference and is not an application connection.
- `revive-app/src/data/supabaseAdapter.ts` is an intentional throwing boundary; the app remains mock-only.
- The protected marketing site contains a public client `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `config.js` and uses `@supabase/supabase-js` to insert quote submissions. Values are intentionally not reproduced here.
- No `SERVICE_ROLE` reference or service-role secret was found in the repository scan.
- Supabase CLI is installed at version `2.75.0`.

The marketing site anon key is client-visible configuration, not a service-role credential. Its JWT role is `anon` and its project reference matches `ntbowgutwyyhhnmkadlv`.

## Remote Inspection Results

| Area | Result | Confidence / blocker |
| --- | --- | --- |
| Schemas | `public` captured in the redacted schema dump | Backup artifact: `backups/pre_phase_2d/public_schema_redacted.sql` |
| Tables and columns | `public.quotes` confirmed with the complete column/type/default/nullability definition captured in `QUOTES_PROTECTION_BASELINE.md` | Exact SQL definition is preserved in the redacted schema backup |
| Row presence | `public.quotes` estimated row count `0`; zero-row select returned `Content-Range: */0` | Safe read-only metadata only; no records retrieved |
| Primary and foreign keys | `quotes_pkey` on `quotes.id`; no foreign keys discovered on `quotes` | Captured in redacted schema dump |
| Indexes | `public.quotes_pkey`, `public.idx_quotes_status`, `public.idx_quotes_created_at` | Captured in redacted schema dump |
| Triggers, sequences, extensions | `quotes-telegram-alert`; `pgcrypto`-backed UUID default; public `rls_auto_enable` event-trigger function | No REV trigger exists; captured in redacted schema dump |
| RLS enabled state | Enabled on `public.quotes` | Captured in redacted schema dump |
| RLS policies and expressions | `allow public inserts` / anon / INSERT / `WITH CHECK (true)`; `allow authenticated reads` / authenticated / SELECT / `USING (true)` | Captured in redacted schema dump |
| PostgreSQL/RPC/security-definer functions | `public.rls_auto_enable()` is `SECURITY DEFINER`, `search_path = pg_catalog`; trigger helper is `supabase_functions.http_request` | No REV helper exists remotely; captured public function definition is redacted-safe |
| Auth configuration/state | Email provider enabled; signup allowed; email and phone auto-confirm disabled; anonymous users and listed OAuth providers disabled; no user count exposed by safe public endpoint | User count and redirect/site URL configuration require management access; no user details collected |
| Storage buckets/policies | `0` buckets returned by the authenticated anon metadata request | No bucket policies or objects exist to inventory |
| Migration history | Local `0001` appears in the local column; remote column is blank in `supabase migration list --linked` | No applied remote migration corresponding to local `0001` was shown |
| Realtime publication/table configuration | Not verified | Requires SQL/management metadata access |
| Edge functions | **One verified:** `telegram-alert-ts`, slug `telegram-alert-ts`, status `ACTIVE`, version `1`, `verify_jwt: true`, updated 2026-03-20 21:26:52 UTC | Read-only Functions API listing and source download succeeded. Source reads Telegram secrets and sends the notification; no Supabase credential use was found. |

The marketing code indicates a `quotes` table insert and public storage paths named `public_images`. The `quotes` table is verified; no `public_images` bucket currently exists in the storage bucket listing.

### Verified `quotes` table surface

The public insert client and zero-row column probes identify the following fields. Types, nullability, defaults, primary-key column, and constraints remain SQL-level unknown: `id`, `full_name`, `business_name`, `email`, `phone`, `contact_method`, `project_type`, `current_url`, `business_type`, `target_audience`, `page_count`, `budget`, `selected_package`, `payment_option`, `maintenance_plan`, `design_addons`, `pages_needed`, `features_needed`, `branding_ready`, `content_ready`, `assets_ready`, `launch_date`, `start_soon`, `deposit_ok`, `project_details`, `status`, and `created_at`.

## Phase 2B Comparison

Phase 2B prepared these entities:

- `workspaces`
- `workspace_members`
- `business_profiles`
- `business_services`
- `goals`
- `contacts`
- `rev_actions`
- `approvals`
- `business_memory_events`
- `audit_log`

| Proposed entity | Classification | Current remote evidence | Required next step |
| --- | --- | --- | --- |
| All ten entities above | **D — Missing from verified application table inventory** | Redacted public schema shows only `public.quotes` as an application table | Create only after Phase 2D.1 approval |
| Marketing `quotes` object | Outside Phase 2B scope; exists and is empty by estimate | `public.quotes`, zero estimated rows, three indexes, public anon zero-row select allowed | Preserve; review its insert policy and abuse controls before any RLS work |

No migration, rename, policy replacement, or data change is authorized by this inspection. The local Phase 2B migration is a proposal only and must not be applied blindly.

## Security Findings

- **CRITICAL — Remote tenant isolation not yet implemented.** No Phase 2B tenant tables exist in the captured public schema. Do not connect REV until the approved migration and RLS tests are complete.
- **HIGH — Marketing client writes to `quotes`.** The public anon-key path is expected for browser Supabase clients; the exact anon INSERT and authenticated SELECT policies are preserved in the baseline and must not be broadened.
- **MEDIUM — Storage paths are stale or undocumented.** Marketing HTML references `public_images`, but the current bucket listing is empty.
- **LOW — No local service-role exposure found.** Repository scan found no service-role reference; remote secrets and deployed function secrets were not inspected.
- **LOW — No live REV connection exists.** `revive-app` uses mock auth and mock data, which prevents accidental production access during this phase.

## Telegram Trigger Security Follow-up

- Deployed function `telegram-alert-ts` is active, version 1, with `verify_jwt: true`.
- Read-only download of the deployed function shows it only parses the webhook payload, reads `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, and calls Telegram. It does not use `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, or another Supabase credential, and it does not perform caller validation itself.
- Deployed secret names include `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_URL`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`. Secret values were not read or printed. The proposed `revive_database_webhook_secret` was not present.
- The exact `quotes-telegram-alert` trigger definition is captured in the redacted schema backup. It remains an `AFTER INSERT` HTTP POST to `telegram-alert-ts` with the legacy Authorization credential redacted.
- **STOP:** Do not replace the trigger with an `apikey`-only call in Phase 2D.0. With `verify_jwt: true`, compatibility of the modern Secret-key header must be independently verified in the later Telegram remediation phase. No trigger/function/Auth/storage change was made.

## Auth and Access Design Readiness

Future activation must preserve this sequence:

```text
Supabase Auth identity
  -> workspace_members membership
  -> selected workspace authorization
  -> database RLS enforcement
```

Login must not grant access to every workspace. The future adapter must implement login, signup, logout, password recovery, session restoration, and membership lookup through application services and repository interfaces. React components must not call Supabase directly.

## Phase 2D.0 Decision

Phase 2D.0 backup and reconciliation preparation is complete. The existing project is active and linked, the public schema was captured locally in a credential-safe redacted dump, and the quote/Telegram baseline is documented. No destructive or remote data operation was performed.

**Required Phase 2D.1 prerequisite:** Resolve the duplicate local migration-version presentation, review the security-definer/RLS bootstrap behavior, preserve the quote baseline, and obtain explicit migration approval.
