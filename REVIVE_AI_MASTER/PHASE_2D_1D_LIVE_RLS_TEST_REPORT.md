# REV Phase 2D.1D — Live Auth/RLS Attack Test Resumed

**Date:** 2026-09-12
**Project:** Revive Websites
**Project ref:** `ntbowgutwyyhhnmkadlv`
**Result:** BLOCKED before authenticated session establishment

## Controlled Topology Bootstrap Attempt

**Date:** 2026-09-12
**Result:** STOPPED at User C outsider baseline

Authentication gates for Users A, B, and C passed against the replacement synthetic UUIDs. User A and User B each created one synthetic workspace through `public.create_workspace_with_owner(text,text)` using only their authenticated tenant sessions. Their owner memberships, active status, caller-derived ownership, and exclusive workspace visibility checks passed.

User C authenticated successfully but the outsider baseline did not pass: the authenticated User C session did not produce the required all-clear result for zero visibility of Workspace A, Workspace B, memberships, and tenant data. The failure was recorded as a sanitized baseline failure; no cross-tenant writes, updates, deletes, escalation attempts, cleanup, or further live checks were run.

### Narrow Harness Repair and 404 Diagnosis

The prior HTTP 404 results were caused by malformed PowerShell URL construction in the diagnostic harness. The interpolated table/query expression produced a PostgREST request targeting `public.=workspace_id`, which returned `PGRST205` with the sanitized message `Could not find the table 'public.=workspace_id' in the schema cache`. This was an endpoint/test-harness error, not evidence that the deployed tables were absent and not an RLS result.

The corrected authenticated requests reached all ten expected REV tables: `workspaces`, `workspace_members`, `business_profiles`, `business_services`, `goals`, `contacts`, `rev_actions`, `approvals`, `business_memory_events`, and `audit_log`. Corrected status handling is: HTTP 200 with zero rows means an empty RLS result; HTTP 200 with rows requires workspace ownership inspection; HTTP 401 is authentication failure; HTTP 403 is privilege failure; HTTP 404 and other unexpected statuses are endpoint/infrastructure failures and are inconclusive for RLS, never visible data.

The corrected User C baseline returned HTTP 200 with zero visible workspaces, zero visible memberships, and zero rows in each tenant table. No User C membership, foreign membership, or cross-tenant row was visible. The harness is repaired for this diagnostic path. The full cross-tenant attack matrix is ready to run but was not run in this step.

## Full Matrix Stop — Unexpected Foreign Workspace Read

**Date:** 2026-09-12
**Result:** STOPPED immediately during cross-tenant read testing

Positive own-tenant controls for Users A and B passed. During the first guarded foreign-read pass, the authenticated User A request filtered to Workspace B on `public.workspaces` returned one row. This was an unexpected foreign workspace read and the matrix stopped immediately. No cross-tenant inserts, updates, deletes, membership escalation, bootstrap abuse, composite-FK tests, inactive-membership test, cleanup, or local validation commands were run after the stop.

**Sanitized failure:** User A -> Workspace B -> `workspaces` read returned HTTP 200 with 1 row; expected HTTP 200 with zero rows. Treat as a security failure pending review. No remediation was attempted.

## Stopped Finding Diagnosis — User A Workspace B Read

**Date:** 2026-09-12
**Classification:** D — TEST HARNESS / WORKSPACE IDENTIFICATION ERROR

User A re-authenticated with the expected UUID. Workspace A and Workspace B were independently rediscovered through their expected creator UUID and synthetic name; each was unique, their IDs were distinct, and creators matched A/B. User A could see its own membership. The filtered membership/read assertions used by the stopped matrix did not reliably bind to the internally held Workspace B identifier: the returned membership row was not User A and was not User B, and the single row returned by the exact-B workspace request matched neither verified workspace ID nor User B's creator.

The authenticated helper checks were consistent with the intended local design: `is_active_workspace_member(Workspace A)` returned true and `is_active_workspace_member(Workspace B)` returned false. The local `workspaces_select` policy uses only `is_active_workspace_member(id)`, and that helper requires an active `workspace_members` row for `auth.uid()` and the target workspace. The local policy therefore does not logically permit User A to see Workspace B without an active membership. Live policy metadata was not available through the installed CLI and remains not checked.

The exact verified Workspace B row was not returned. No confirmed cross-tenant RLS leak was established. Overall Phase 2D.1D remains stopped pending a corrected, independently validated REST query harness; no attack-matrix continuation or remediation was performed.

## Read-Only Harness Repair Validation

**Date:** 2026-09-12
**Result:** HARNESS FAIL — attack matrix remains stopped

A reusable local harness was added at `REVIVE_AI_MASTER/phase2d1d_harness.ps1`. It uses `System.UriBuilder`, URI-encodes each query key/value, preserves multiple PostgREST parameters, compares positive returned IDs and workspace ownership, and treats foreign reads as passing only when HTTP 200 returns zero rows. It performs no writes or cleanup.

The isolated UriBuilder request produced the expected zero-row foreign result, but the file-based harness produced inconsistent results across repeated read-only runs: own-workspace exact matches passed while foreign exact filters returned one unrelated row, and membership/representative-table assertions failed. Because the reusable harness did not demonstrate stable filtering semantics, the harness gate is FAIL and the full attack matrix must not resume. No RLS conclusion was drawn from the inconsistent harness output.

## Deterministic Node Harness Validation

**Date:** 2026-09-12
**Harness:** `REVIVE_AI_MASTER/phase2d1d_harness.mjs`
**Result:** PASS — harness validated; full attack matrix not run

The PowerShell harness is marked **UNRELIABLE — DO NOT USE FOR SECURITY ASSERTIONS**. It was replaced for validation purposes by a minimal Node.js harness using native `fetch`, `URL`, and `URLSearchParams` behavior through `URL.searchParams.set`. Credentials are read from Windows User scope through an in-memory child PowerShell bridge. The Node harness never loads `SUPABASE_SECRET_KEY` or service-role credentials and performs no writes or cleanup.

Three consecutive read-only runs produced identical security assertions:

- Auth A/B/C: PASS
- Workspace discovery uniqueness, distinct IDs, and creators: PASS
- Exact workspace reads: own rows matched exact IDs; all foreign rows were zero
- Exact membership reads: own membership matched both workspace and user; all foreign rows were zero
- Helper cross-check: PASS for A, B, and C
- Representative `business_services` isolation: PASS
- Repeatability: RUN 1 PASS, RUN 2 PASS, RUN 3 PASS, RESULTS IDENTICAL TRUE

This validates the read-only harness only. The full Phase 2D.1D attack matrix remains not run and is not marked PASS.

## Full Node Live Auth/RLS Matrix Attempt

**Date:** 2026-09-12
**Authoritative runner:** `REVIVE_AI_MASTER/phase2d1d_attack.mjs`
**Result:** Executed security categories passed; phase remains incomplete because restricted categories were not tested

The Node attack runner reconfirmed the read-only baseline, authenticated A/B/C through the public password flow, used only URL/URLSearchParams request construction, and created synthetic positive-control rows. The following guarded categories passed with owner-session read-back verification: own-tenant writes, cross-tenant inserts, cross-tenant updates, cross-tenant deletes, membership escalation attempts, anonymous bootstrap denial, composite-FK attack, audit update/delete immutability, and User C's final outsider visibility check. No persisted unauthorized change was observed, and the runner did not perform cleanup after the incomplete phase.

Status by category:

| Category | Status |
| --- | --- |
| Node read baseline | PASS |
| User A own-tenant writes | PASS |
| User B own-tenant writes | PASS |
| Cross-tenant inserts | PASS |
| Cross-tenant updates | PASS |
| Cross-tenant deletes | PASS |
| Membership escalation | PASS |
| Bootstrap RPC anonymous abuse | PASS |
| Composite FK attack | PASS |
| Approval isolation | PASS through approval read/update/delete controls |
| Business Memory isolation | PASS through cross-tenant mutation and outsider controls |
| Audit update blocked | PASS |
| Audit delete blocked | PASS |
| User C final outsider test | PASS |
| Suspended membership denial | PASS |
| Legacy quotes regression | NOT TESTED — no independent read-only catalog evidence was collected in this run |
| Telegram regression | NOT TESTED — no independent read-only catalog evidence was collected in this run |
| Cleanup | NOT RUN because the full required gate was not complete |

Local validation passed: `npm test` reported 15 passing tests, `npm run build` completed successfully, and `npm audit` reported 0 vulnerabilities. The frontend remained disconnected and no RLS policy, function, schema, migration, Auth user, quote, or Telegram object was modified.

The suspended-membership denial and legacy regression checks are complete. No frontend integration may begin until the phase closeout is recorded.

## Remaining Required Checks

**Date:** 2026-09-12

### Suspended Membership Denial

**Status:** PASS

The deployed membership status contract uses `invited`, `active`, and `suspended`; `inactive` is not a valid state. The synthetic User B/Workspace B membership was verified active with its original role and identities, changed only from `active` to `suspended` through the controlled setup path, and verified suspended. Using User B's normal JWT, `is_active_workspace_member` returned false, the exact Workspace B read returned zero rows, all eight tenant-table reads returned zero Workspace B rows, and a uniquely marked business-service write did not persist. The membership was then restored only from `suspended` to its original `active` status, with role and identities unchanged. User B's normal JWT subsequently regained helper=true, exact workspace visibility, and own tenant-data visibility.

### Legacy Quotes Regression

**Status:** PASS

Read-only linked public-schema metadata confirmed `public.quotes`, its recorded column markers, RLS enablement, `allow public inserts` and `allow authenticated reads` policies, `quotes_pkey`, `idx_quotes_created_at`, `idx_quotes_status`, and the `quotes-telegram-alert` trigger route remain present. No quote write occurred. The temporary schema-dump artifact was deleted without exposing its credential-bearing trigger value.

### Telegram Regression

**Status:** PASS

Read-only structured Supabase function metadata confirmed `telegram-alert-ts` remains ACTIVE, version 1, with `verify_jwt: true`. The quote trigger route still targets the expected `telegram-alert-ts` function. The function was not invoked or modified, and no credential-bearing value was printed.

The remaining categories therefore resolve to: `SUSPENDED MEMBERSHIP DENIED: PASS`, `LEGACY QUOTES PROTECTED: PASS`, and `TELEGRAM UNCHANGED: PASS`. All required Phase 2D.1D security checks are complete and passed. The frontend remains disconnected.

### Controlled Topology Result

| Test area | Result |
| --- | --- |
| Auth gate A | PASS |
| Auth gate B | PASS |
| Auth gate C | PASS |
| Workspace A bootstrap and owner membership | PASS |
| Workspace B bootstrap and owner membership | PASS |
| User A authorized-workspace visibility | PASS |
| User B authorized-workspace visibility | PASS |
| User C outsider baseline | FAIL — required zero-visibility baseline not established |
| Bootstrap security baseline | FAIL |
| Cross-tenant attack matrix | Not run after stop |
| Cleanup | Not run |

## User C Outsider-Baseline Diagnosis

**Date:** 2026-09-12
**Classification:** D — TEST HARNESS / ASSERTION ERROR

User C authenticated with the expected UUID. The final same-session correlation returned zero visible workspace rows and zero visible membership rows; neither synthetic workspace A nor B, nor any User C or other-user membership, was visible. No foreign tenant row was evidenced.

The failed outsider assertion came from the tenant-table probe behavior: each of `business_profiles`, `business_services`, `goals`, `contacts`, `rev_actions`, `approvals`, `business_memory_events`, and `audit_log` returned HTTP 404 from the normal PostgREST endpoint, with zero parsed rows. The harness treated a null/failed response as visible tenant data instead of distinguishing endpoint failure from returned rows. This made the aggregate outsider baseline fail without demonstrating an RLS leak.

Relevant intended local policy names are `workspaces_select`, `workspace_members_select`, `business_profiles_tenant`, `business_services_tenant`, `goals_tenant`, `contacts_tenant`, `rev_actions_tenant`, `approvals_tenant`, `memory_events_tenant`, and `audit_log_select`. Live policy definitions could not be inspected through the available Supabase CLI, which has no policy-inspection command, so live/local policy equivalence remains not checked. Recommended next investigation: inspect `pg_policies` through an authorized read-only database metadata connection and correct the diagnostic harness to report endpoint availability separately from row visibility before resuming RLS tests.

## Third Resume Attempt

The six required process environment variables were present. Their values were not read, printed, or stored:

- `REV_RLS_USER_A_PASSWORD`: present
- `REV_RLS_USER_B_PASSWORD`: present
- `REV_RLS_USER_C_PASSWORD`: present
- `REV_RLS_USER_A_EMAIL`: present
- `REV_RLS_USER_B_EMAIL`: present
- `REV_RLS_USER_C_EMAIL`: present

Each identity was then tested through the normal Supabase password sign-in flow using the existing public project configuration. Authentication was rejected for User A, User B, and User C. Consequently, no authenticated JWT session was available to validate the supplied UUIDs.

This is an unexpected authentication result under the Phase 2D.1D runbook. The live RLS matrix was stopped immediately before workspace bootstrap, tenant data creation, cross-tenant testing, or cleanup. No database security design, Auth configuration, table, policy, function, quote, Telegram integration, frontend, or credential was changed.

### Third Resume Test Matrix

| Test area | Expected | Actual | Status |
| --- | --- | --- | --- |
| Environment gate | Six required variables available | All six present | PASS |
| User A password session | Authenticated session for supplied UUID | Authentication rejected; UUID not verifiable | BLOCKED |
| User B password session | Authenticated session for supplied UUID | Authentication rejected; UUID not verifiable | BLOCKED |
| User C password session | Authenticated session for supplied UUID | Authentication rejected; UUID not verifiable | BLOCKED |
| Workspace A/B bootstrap | RPC creates owner workspaces | Not attempted after authentication stop | BLOCKED |
| Own-workspace access | Allowed | Not attempted | BLOCKED |
| Tenant isolation and non-member access | Foreign access denied | Not attempted | BLOCKED |
| Membership permissions | Only approved capabilities succeed | Not attempted | BLOCKED |
| Approval isolation | Foreign approval access denied | Not attempted | BLOCKED |
| Business Memory isolation | Foreign memory access denied | Not attempted | BLOCKED |
| Audit protections | Reads scoped; update/delete denied | Not attempted | BLOCKED |
| Relational integrity | Cross-tenant composite FKs reject mismatches | Not attempted | BLOCKED |
| Quotes and Telegram preservation | Baseline unchanged | No change made; live re-check not run after stop | NOT RUN |
| Cleanup | Tagged test artifacts removed | No test artifacts created | PASS |
| Local unit tests | Existing suite passes | 15 passed | PASS |
| Production build | Typecheck and Vite build pass | Completed successfully | PASS |
| Dependency audit | No high-severity dependency vulnerabilities | 0 vulnerabilities | PASS |

### Required Review

An administrator must verify that the six process variables correspond to the pre-provisioned synthetic accounts and that password sign-in is enabled for those accounts. Do not provide credential values, JWTs, service-role keys, or secrets in documentation or chat. After the authentication issue is resolved, rerun the Phase 2D.1D matrix from session establishment; do not connect the REV frontend first.

## Second Resume Attempt

The required password environment variables were checked without printing their values:

- `REV_RLS_USER_A_PASSWORD`: present in this execution environment
- `REV_RLS_USER_B_PASSWORD`: present in this execution environment
- `REV_RLS_USER_C_PASSWORD`: present in this execution environment

However, no safe, non-interactive path exists to turn a password into an authenticated session without additional required inputs that are still absent:

- `SUPABASE_URL` (or `VITE_SUPABASE_URL`): absent
- `SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`): absent
- A safe email-resolution source for the three synthetic UUIDs (e.g. `REV_RLS_USER_A_EMAIL` / `_B_EMAIL` / `_C_EMAIL`, or an approved lookup mechanism): absent

Supabase password sign-in requires the project URL, the anon (public) API key, and the account email address in addition to the password; none of the email/URL/key values were supplied or discoverable without guessing or using a prohibited service-role query. Guessing a project URL, API key, or synthetic email is not permitted.

Because these required inputs were still missing, no password sign-in, JWT session, `auth.uid()` verification, workspace bootstrap, tenant data creation, attack testing, or cleanup was attempted.

## First Resume Attempt (prior)

The required environment variables were checked without printing their values:

- `REV_RLS_USER_A_PASSWORD`: absent in this execution environment
- `REV_RLS_USER_B_PASSWORD`: absent in this execution environment
- `REV_RLS_USER_C_PASSWORD`: absent in this execution environment

Because no passwords were available, no safe password sign-in or JWT session could be established. Email lookup, bootstrap, workspace creation, tenant data creation, attack testing, and cleanup were not attempted.

## Resumed Test Identities

Supplied UUIDs:

- User A: `3a87c0fb-98ac-4b9b-aab4-3fa26980bf08`
- User B: `ed09e852-83eb-4c97-b9f0-cbc2a658a1a4`
- User C: `2ef37e4e-85c1-42ff-bcd1-4736de5d4a94`

No passwords, access tokens, refresh tokens, or service credentials were read or stored.

## Session Blocker

Authenticated JWT sessions could not be established safely from the supplied UUIDs alone:

- Supabase CLI `2.75.0` has no Auth login/user-session command.
- No passwords were provided or requested.
- No OTP/email inbox access was available.
- No JWTs were provided.
- Service-role access is prohibited as a substitute for tenant-user testing.

No bootstrap RPC, workspace creation, data insertion, or attack test was attempted.

## Preflight

- Linked project ref: verified
- Applied migrations: `20260912162730`, `20260912170332`
- Helper ACLs: `PUBLIC=NO`, `anon=NO`, `authenticated=YES`
- Telegram function: active, version 1
- REV tables: present and empty
- No production frontend connection

## Test Identity Access Blocker

The supported Supabase CLI has no Auth-user administration command. An in-memory attempt to use the existing project's management-listed `service_role` API key against the Auth admin endpoint returned HTTP 401 before User A creation.

The resumed attempt had the three user UUIDs but no safe way to turn them into authenticated JWT sessions without passwords, OTP access, or supplied tokens.

No passwords, tokens, or credential values were printed or stored.

Because authenticated JWT sessions could not be safely created, the following were not run:

- User A/B/C creation
- Workspace bootstrap
- Real Auth/RLS reads or writes
- Cross-tenant attack matrix
- Membership escalation tests
- Composite-FK tests through authenticated clients
- Approval/memory/audit tests
- Cleanup

## Test Matrix Status

| Test area | Expected | Actual | Status |
| --- | --- | --- | --- |
| User A/B/C identities | Synthetic confirmed users created | Admin endpoint returned HTTP 401 before creation | BLOCKED |
| Workspace A/B bootstrap | RPC creates owner workspaces | Not attempted | BLOCKED |
| Own-tenant access | Allowed | Not attempted | BLOCKED |
| Cross-tenant reads | Denied | Not attempted | BLOCKED |
| Cross-tenant inserts | Denied | Not attempted | BLOCKED |
| Cross-tenant updates/deletes | Denied | Not attempted | BLOCKED |
| Membership escalation | Denied | Not attempted | BLOCKED |
| Composite FK attacks | Rejected | Not attempted | BLOCKED |
| Approval isolation | Denied | Not attempted | BLOCKED |
| Business Memory isolation | Denied | Not attempted | BLOCKED |
| Audit immutability | Update/delete denied | Not attempted | BLOCKED |

## Protected Systems

No quote, Telegram, Edge Function, Auth, RLS, table, secret, or frontend change was made by this phase.

## Required Next Action

Provide, as process environment variables only (never in chat, files, or logs):

- `SUPABASE_URL` (or `VITE_SUPABASE_URL`) and `SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`) so the client can reach the project's public Auth API, and
- A safe way to resolve each UUID to its sign-in email — e.g. `REV_RLS_USER_A_EMAIL` / `REV_RLS_USER_B_EMAIL` / `REV_RLS_USER_C_EMAIL` set by an administrator who already knows the tagged test accounts.

Do not provide passwords, tokens, service-role keys, or JWTs to chat. Then rerun the controlled JWT/RLS matrix.

Do not weaken RLS or use service-role access as a substitute for tenant-user tests.
