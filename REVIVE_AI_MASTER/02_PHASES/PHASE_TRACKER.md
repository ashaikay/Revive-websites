# Phase 2D.2 — Initial integration slice ✅ CLOSED (browser validation complete)

- Status: read-only integration implemented and reviewed; browser validation complete.
- Mock mode remains default and all operational writes remain mock-backed or disabled.
- Supabase mode currently covers auth session, active workspace context, workspace switching, and Business Brain/profile/services reads.
- No schema or database migration was required.
- Phase 2D.2A live browser validation for Users A, B, and C is complete and PASS. See the Phase 2D.2A entry below and `PHASE_2D_2_INTEGRATION_REPORT.md`.

# Phase Tracker

## Status Legend
- ✅ Complete
- 🔄 In Progress
- ⏳ Not Started
- ❌ Blocked

---

## Phase 0: Baseline & Protection ✅

**Objective:** Establish project control and protect the live marketing website

**Deliverables:**
- ✅ Repository baseline confirmed
- ✅ Public website protection established
- ✅ REVIVE_AI_MASTER project control initialized
- ✅ Risk and blocker assessment
- ✅ Deployment assumptions documented

**Date Completed:** 2026-08-25

---

## Phase 1: REV Architecture ✅

**Objective:** Complete comprehensive architecture documentation for REV AI employee platform

**Duration:** ~2-3 weeks

**Key Deliverables:**
- ✅ MASTER_BUILDER.md — Strategic vision and platform philosophy
- ✅ SYSTEM_ARCHITECTURE.md — Technical architecture, data model, security
- ✅ MASTER_ROADMAP.md — Updated phase sequence
- ✅ PROJECT_STATUS.md — Phase 1 status update
- 🔄 DECISION_LOG.md — Strategic pivot and design decisions
- 🔄 SECURITY_REGISTER.md — REV-specific security architecture
- 🔄 RISKS_AND_BLOCKERS.md — Identified risks and mitigation
- 🔄 CHANGELOG.md — Phase 1 progress
- 🔄 CURRENT_HANDOVER.md — Phase 2 handover

**Acceptance Criteria:**
- All architecture documents complete
- All strategic decisions recorded
- Technology stack selected
- Data model finalized
- Security architecture approved
- Implementation sequence agreed
- No code written
- No infrastructure provisioned

**Expected Completion:** Mid-September 2026

---

## Phase 2A: Local App Foundation ✅

**Objective:** Demonstrate the future REV experience safely with local React application code and workspace-aware mocks.

**Deliverables:**
- ✅ `revive-app/` Vite + React + TypeScript shell
- ✅ HOME / REV / CUSTOMERS / GROWTH / BUSINESS navigation
- ✅ Revive and Family Legacy workspace switching
- ✅ Workspace-scoped mock goals, leads, daily briefs, approvals, and Business Memory
- ✅ Mock REV interface with provider-agnostic AI service boundary
- ✅ Database/workspace service boundary prepared for future activation
- ✅ Responsive layout and local build validation

**Validation:**
- ✅ `npm run build`
- ✅ Browser navigation and workspace switching checks
- ✅ Workspace data separation check
- ✅ 390px responsive overflow check

**Deferred by design:** Supabase activation, authentication, live AI, email, SMS, Stripe, autonomous execution, and production deployment.

**Status:** STOP HERE pending explicit approval for the next phase.

---

## Phase 2B: Real Data & Security Foundation ✅

**Objective:** Prepare the application for a safe future real multi-tenant connection without activating Supabase or external providers.

**Deliverables:**
- ✅ Lean V1 domain model for workspaces, memberships, profiles, services, goals, contacts, REV actions, approvals, memory events, and audit logs
- ✅ Mock repository/data-provider implementation with workspace scoping
- ✅ Supabase adapter boundary with no live connection
- ✅ Development-only mock authentication boundary
- ✅ Supabase-compatible schema migration, rollback script, and defense-in-depth RLS policies
- ✅ Goals, contacts, REV action, approval, Business Memory, and audit services
- ✅ Workspace-isolation and no-network automated tests
- ✅ Fixed local development URL: `http://127.0.0.1:5180/`
- ✅ Dependency audit remediated from 10 findings to 0

**Validation:** `npm test`, `npm run build`, `npm audit`, browser navigation/workspace checks.

**Still mocked:** Supabase, auth, AI, email, SMS, calendar, payments, prospecting, and all external execution.

**Status:** STOP HERE pending explicit Phase 2C approval.

**Dependencies:** Phase 1 complete and approved

---

## Phase 2C: Existing Supabase Inspection and Connection Readiness ✅

**Objective:** Inspect the existing dedicated Revive Supabase project without changing remote state and prepare a safe reconciliation plan.

**Verified:**
- ✅ Existing project identified: `Revive Websites` / `ntbowgutwyyhhnmkadlv`
- ✅ No new project created and no remote destructive command run
- ✅ Supabase CLI `2.75.0` available
- ✅ One deployed edge function listed: `telegram-alert-ts`, active version 1
- ✅ Local REV app remains mock-only
- ✅ `npm test` passed 7/7, build passed, and `npm audit` reported 0 vulnerabilities from `revive-app`
- ✅ `http://127.0.0.1:5180/` renders the REV mock workspace
- ✅ Marketing-site files have no current diff

**Blocked:**
- ⏸️ SQL-level schema, RLS, functions, triggers, extensions, and realtime metadata require Docker-backed schema dump or an authorized database password for native `pg_dump`
- ⏸️ Node 22 verification is not reproduced in the active terminal, which reports `v20.18.0`

**Verified remote inventory:**
- ✅ Project is active and linked only to `ntbowgutwyyhhnmkadlv`
- ✅ `public.quotes` exists with estimated row count 0
- ✅ Known `quotes` columns are visible through zero-row probes; exact SQL types and constraints remain unverified
- ✅ Indexes: `quotes_pkey`, `idx_quotes_status`, `idx_quotes_created_at`
- ✅ Auth email provider enabled; signup allowed; email/phone auto-confirm disabled; listed OAuth providers disabled
- ✅ Storage bucket listing is empty
- ✅ Remote migration listing shows no applied remote migration matching local `0001`

**Deliverables:**
- ✅ `SUPABASE_EXISTING_STATE.md` — redacted inspection report and access boundary
- ✅ `SUPABASE_RECONCILIATION_PLAN.md` — staged reconciliation, backup, and rollback plan

**Stop condition:** Do not apply migrations, connect Auth, replace mocks, insert real data, or activate AI/email/SMS/voice/payments. Phase 2D.1 remains blocked until the backup/reconciliation gate is approved.

---

## Phase 2D.0: Pre-Migration Backup and Reconciliation ✅

**Objective:** Capture a credential-safe backup of the existing public schema and reconcile the local Phase 2B migration without applying it.

**Verified:**
- ✅ Docker `28.3.2`, Supabase CLI `2.75.0`, linked project `ntbowgutwyyhhnmkadlv`
- ✅ Remote schema-only dump captured; raw credential-bearing temporary file deleted
- ✅ Redacted backup stored at `backups/pre_phase_2d/public_schema_redacted.sql`
- ✅ `public.quotes` baseline recorded, including columns, constraints, indexes, RLS, policies, grants, and Telegram trigger
- ✅ Existing `quotes-telegram-alert` and `telegram-alert-ts` left untouched
- ✅ Local migration fully inventoried without execution
- ✅ No direct table/function/trigger/policy/index name collision with `public.quotes` or `quotes-telegram-alert`
- ✅ Rollback plan preserves quote data, RLS, indexes, trigger, Edge Function, and marketing behavior

**Blockers before Phase 2D.1:**
- ⏸️ Local up/down files both use migration version `0001`; propose moving the rollback artifact out of the migrations directory and obtain approval
- ⏸️ Review security-definer helper ownership/execute grants, workspace bootstrap, and tenant RLS behavior
- ⏸️ Obtain explicit approval before applying any remote migration

**Artifacts:** `QUOTES_PROTECTION_BASELINE.md`, `PHASE_2D_RECONCILIATION.md`, `PHASE_2D_ROLLBACK_PLAN.md`, and `backups/pre_phase_2d/`.

---

## Phase 2D.0.1: Tenant Security, Migration Cleanup and Global AI Access Architecture ✅

**Verified:**
- ✅ Rollback moved to `REVIVE_AI_MASTER/rollback/0001_rev_core_rollback.sql`; only the forward migration remains under `revive-app/supabase/migrations/`
- ✅ `supabase migration list --linked --workdir revive-app` now shows one local `0001` entry
- ✅ Security-definer helpers hardened locally with empty search path, schema-qualified references, and authenticated-only execution grants
- ✅ Tenant audit policy changed locally from `FOR ALL` to read/insert only
- ✅ 13 local security tests pass, including membership, inverse workspace access, cross-tenant service/approval denial, memory isolation, composite foreign-key declarations, and quote protection
- ✅ Global tenant-user/system-agent access model documented

**Remaining gates:**
- ⏸️ No remote migration or RLS change is authorized
- ⏸️ Workspace bootstrap, live function owners/grants, and real Supabase RLS integration tests require a separately approved migration/test environment

---

## Phase 2D.0.2: Workspace Bootstrap Design and Controlled Live RLS Test Plan ✅

**Verified/prepared:**
- ✅ First-workspace bootstrap designed as an authenticated-only atomic `SECURITY DEFINER` RPC using `auth.uid()` as the creator
- ✅ Direct tenant membership writes intentionally absent from the local migration
- ✅ Owner/admin/member capabilities and invite/role boundaries documented
- ✅ Controlled temporary-user/workspace RLS attack matrix documented
- ✅ Cleanup rules explicitly exclude `public.quotes`
- ✅ Tenant-user and trusted REV system-agent contexts remain separate
- ✅ `WORKSPACE_BOOTSTRAP_SECURITY.md` and `PHASE_2D_1_RUNBOOK.md` created

**Remaining gates:**
- ⏸️ Bootstrap RPC is local-only and must be reviewed/deployed only in a future approved migration
- ⏸️ Real Auth/RLS integration tests require explicit Phase 2D.1 approval and controlled test identities
- ⏸️ No remote schema, Auth, RLS, data, Edge Function, secret, or marketing change was made

---

## Phase 2D.0.3: Secure Workspace Bootstrap Implementation and Local Proof ✅

**Verified:**
- ✅ Added `public.create_workspace_with_owner(text,text)` to the local forward migration only
- ✅ Creator comes exclusively from `auth.uid()`; workspace ID is generated by the table default
- ✅ Owner role and active status are assigned internally
- ✅ Workspace, membership, and `workspace.created` audit insertion occur in one PL/pgSQL function transaction
- ✅ Function uses `SECURITY DEFINER`, empty search path, schema-qualified references, no dynamic SQL, and authenticated-only execution
- ✅ `PUBLIC`/anon execution is not granted
- ✅ Rollback removes the bootstrap function by exact signature
- ✅ Structural security tests now pass 15/15

**Remaining gates:**
- ⏸️ Live owner/ACL/catalog verification and real Auth/RLS execution remain for approved Phase 2D.1
- ⏸️ No remote migration, Auth change, user, workspace, or production data was created

---

## Phase 2D.1: Controlled Live Migration and RLS Verification ⛔ STOPPED AT PREFLIGHT

**Stop reason:** The linked project reported remote migration `0001`, contradicting the Phase 2D.0 baseline. Fresh schema evidence classifies the state as **HISTORY ONLY** because approved REV objects are absent. No migration, Auth identity, workspace, or RLS test was attempted.

**Required before resuming:** Reconcile the remote `0001` state against the approved local migration and quote baseline. Do not repair migration history or run `db push` until explicitly reviewed and approved.

---

## Phase 2D.1A: Remote Migration History Reconciliation and Fresh Backup Recovery ✅

**Verified:**
- ✅ Exact remote history captured: local `0001`, remote `0001`
- ✅ Local migration SHA256 captured: `AD50BB14AF2EB2FF69A84A996424315647C613ED3974DDD8F9C79B6214167479`
- ✅ Fresh redacted schema backup recovered at `backups/pre_phase_2d_1/`; raw dump deleted
- ✅ Live public schema contains `public.quotes` and `rls_auto_enable()` only; no approved REV tables/functions/policies/indexes
- ✅ Remote state classified as **HISTORY ONLY**
- ✅ Quote RLS, policies, indexes, trigger, and Telegram function remain present/unchanged
- ✅ No migration-history repair, migration push, Auth, workspace, RLS, secret, Edge Function, or marketing change occurred

**Blocker:** The source/meaning of remote migration-history row `0001` is not available through the supported read-only metadata commands. Do not repair or push until that metadata is reconciled.

---

## Phase 2D.1B: Safe Migration Renumbering Only ✅

**Verified:**
- ✅ Remote historical `0001` preserved without repair or modification
- ✅ Approved local migration copied byte-for-byte to `revive-app/supabase/migrations/20260912162730_rev_core.sql`
- ✅ Old SHA256 and new SHA256 both `AD50BB14AF2EB2FF69A84A996424315647C613ED3974DDD8F9C79B6214167479`
- ✅ Old local `0001` removed only after hash verification
- ✅ Rollback renamed to `REVIVE_AI_MASTER/rollback/20260912162730_rev_core_rollback.sql`
- ✅ Migration list shows remote `0001` and local unapplied `20260912162730`
- ✅ New migration contains no quote/Telegram references

**Stop condition:** Do not deploy the timestamped migration. Remote history remains unexplained and Phase 2D.1 live testing has not started.

---

## Phase 2D.1C: Controlled REV Core Deployment and Live Catalog Verification ⛔ FAIL / STOPPED

**Applied:** `20260912162730_rev_core.sql` only. Migration history now records local and remote `20260912162730`.

**Verified:** All ten REV tables, expected indexes, RLS enables, composite foreign keys, and quote/Telegram preservation.

**Critical failure:** Live ACL dump shows `GRANT ALL` to `anon` on `is_active_workspace_member`, `has_workspace_role`, and `create_workspace_with_owner`, despite the intended authenticated-only grants. No Auth users, workspaces, bootstrap calls, or RLS tests were created.

**Stop condition:** Do not remediate ACLs, create test users, connect the frontend, or begin Phase 2D.1D until the remote grant discrepancy is separately reviewed and approved.

---

## Phase 2D.1C.1: SECURITY DEFINER Function ACL Remediation ✅

**Verified:**
- ✅ Cause identified: core migration revoked `PUBLIC` but did not explicitly revoke `anon`; default function privileges exposed `anon` execution
- ✅ Applied only `20260912170332_rev_function_acl_hardening.sql`
- ✅ `PUBLIC` and `anon` execution revoked for all three REV SECURITY DEFINER functions
- ✅ `authenticated` execution preserved
- ✅ Live owners remain `postgres`; SECURITY DEFINER and empty search paths remain unchanged
- ✅ Quote/Telegram objects remain unchanged
- ✅ No Auth users/workspaces/bootstrap calls were made

**Next gate:** Controlled Auth/RLS testing may be considered only after final review; it was not started automatically.

---

## Phase 2D.1D: Real Auth and Cross-Tenant RLS Attack Testing ⛔ BLOCKED

**Blocker:** Synthetic Auth-user creation returned HTTP 401 through the available admin API path before User A creation. No Auth users, workspaces, bootstrap calls, or attack tests were performed.

**Report:** `PHASE_2D_1D_LIVE_RLS_TEST_REPORT.md`

**Required next action:** Provide an authorized Auth-admin mechanism or have an administrator create clearly tagged synthetic identities through the dashboard. Do not weaken RLS or use service-role access as a substitute for tenant-user JWT testing.

**Resumed result:** UUIDs were supplied for Users A/B/C, but no safe authenticated-session method was available. Testing remains blocked before workspace bootstrap.

---

## Phase 2D.2A: Live Browser Auth/Tenant Validation ✅ PASS

**Date:** 2026-09-13

**Result:** All three synthetic identities validated live in the shared browser against `ntbowgutwyyhhnmkadlv`. Phase 2D.2 is formally closed.

- **User A:** PASS (prior session).
- **User B** (`natalie_atkins2000@yahoo.co.uk`, UUID `d288c613-84f8-4530-b988-9984008427c4`): Auth account verified healthy (exists, UUID match, email confirmed, enabled, correct Workspace B membership). A controlled temporary password reset was performed once through the trusted admin path after a browser-only login discrepancy, using only a locally held environment-variable password never printed or committed. Subsequent live browser login showed only `REV RLS Workspace B` (Workspace A not visible), the expected empty Business Profile state, only Workspace-B-tagged services, and no foreign tenant data. Logout returned the UI to a clean sign-in state.
- **User C** (`wellnessatworkforyou@gmail.com`, UUID `be0b5874-4264-4f36-869b-f16ab689c33b`): Auth account verified healthy with zero authorised workspace memberships (confirmed outsider). A controlled temporary password reset was performed the same way. Live browser login produced the safe "No active workspace is available for this account." state with no Workspace A/B data and no Business Profile/Services leakage. Logout returned the UI to a clean sign-in state.
- **Cross-user relogin isolation:** PASS — signing in as User C immediately after a User B logout showed no residual Workspace B data.
- **Stale workspace rejection:** PASS by design — direct inspection of `localStorage`/`sessionStorage` after logout showed both empty; the app persists no client-side workspace/session identifier, so authorization is always re-derived from the live server session.
- **Local/tenant session clearing:** PASS — confirmed via direct storage inspection, not just visual inference.
- **Non-blocking follow-up:** `POST /auth/v1/logout?scope=global` repeatedly reported `net::ERR_ABORTED` in the browser console on every sign-out observed. UI sign-out, storage clearing, and cross-user isolation were unaffected each time. This is tracked as a non-blocking investigation item; no authentication code was changed to silence it.

**Protected systems:** No RLS, policy, schema, membership role/status, workspace, or migration change was made during Phase 2D.2A. The two password resets used the trusted admin/secret path solely to inspect/fix the synthetic Auth accounts; all tenant/isolation assertions were performed through each user's own normal public-client session. Legacy `public.quotes` and the Telegram integration were not touched.

---

## Phase 3A: REV Experience & Product Foundation Specification ✅ COMPLETE (design only)

**Date:** 2026-09-13

**Result:** Implementation-ready UX/product specification created at `01_ARCHITECTURE/PHASE_3A_REV_EXPERIENCE_SPEC.md`, covering product principles, information architecture, HOME, REV workspace, CUSTOMERS, GROWTH, BUSINESS, Approval Centre, REV activity system, Quality Gate concept, specialist skills, Bid/Grant Writer evidence rule, motion strategy, responsive/mobile rules, empty/loading/error states, accessibility, free-plan implications, and future Cost Governor implications.

- No application code, database schema, RLS, AI API, external integration, marketing-site, or legacy quotes/Telegram change was made.
- Phase 2D.2/2D.2A evidence is preserved unchanged.
- Revised near-term sequence: Phase 3A (this phase) → 3B App Shell + HOME → 3C REV Employee Workspace → 3D Growth & Revenue Intelligence → 3E Leads & Outreach Foundation.

---

## Phase 3B: App Shell + HOME ✅ COMPLETE (PASS)

**Date:** 2026-09-13/14

**Result:** Implemented the REV app shell and HOME/Owner Command Centre per `01_ARCHITECTURE/PHASE_3A_REV_EXPERIENCE_SPEC.md`, validated in both mock and live Supabase modes.

- **App shell** (`Navigation.tsx`): active-page highlighting with `aria-current`, focus-visible rings, de-emphasized workspace switcher, and a REV nav approval-count badge (mock mode only — approvals are not yet live-readable).
- **HOME** (`HomeDashboard.tsx`): restructured into Daily Business Brief, "Where the Money Is" revenue snapshot (computed only from existing lead records — no invented figures), Attention/Approvals, REV Activity (sourced from existing `REVAction` mock records), and Goal Progress. In Supabase mode, HOME renders a distinct, honest live command centre with clearly labelled empty states for Daily Brief/Revenue/Attention/Activity, since those repositories remain mock-only per Phase 2D.2 scope — no fabricated business performance is shown.
- **Motion foundation:** added `rev-fade-up`/`rev-fade-in` Tailwind keyframes/utilities, applied once per section entrance; fully disabled under `prefers-reduced-motion: reduce`.
- **No direct Supabase calls were added to React components**; HOME/Navigation only read `dataProviderMode` and existing store/service data, following the same pattern already used by `BusinessModule`.
- **Tests:** added `tests/phase3b_home.test.ts` (5 tests) covering the revenue-snapshot logic (won/pipeline/at-risk/recoverable), asserting it never fabricates a figure for empty data. Full suite: 22/22 passed. Production build and `npm audit` (0 vulnerabilities) both passed.
- **Live browser validation:** User C (outsider, no workspace) and User B (`REV RLS Workspace B`) both validated live against `ntbowgutwyyhhnmkadlv` post-implementation. Workspace isolation, BUSINESS profile/services scoping, and clean logout all confirmed with no cross-tenant data. Desktop and mobile (390×844) HOME layouts reviewed visually.
- **Incident during validation (self-corrected):** a dev-server restart (needed to pick up an unrelated Tailwind config fix) dropped `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`, causing `SupabaseAuthProvider.signIn` to throw before ever reaching Supabase. This was masked by `App.tsx` mapping every sign-in exception to the same generic "The sign-in details could not be verified." message. The dev server was restarted correctly (same public project URL/anon key already present in `config.js`); no application code was changed. **Tracked follow-up:** distinguish configuration/infrastructure sign-in failures from real credential rejection in `App.tsx`'s error mapping (not yet implemented, pending approval).
- No database schema, RLS, migration, membership, legacy quotes/Telegram, or marketing-site change was made.

---

## Phase 3C: REV Employee Workspace ✅ COMPLETE (PASS)

**Date:** 2026-09-14

**Result:** Rebuilt `REVInterface.tsx` as the REV Employee Workspace per the Phase 3A spec, built on the existing Phase 2B repository/service layer (`GoalService`, `REVActionService`, `ApprovalService`) rather than the flat Phase 2A mock arrays, so it exercises the same tenant-scoped architecture already validated in Phase 2B/2D.

- **Structure:** REV header/status (Ready / Working / Waiting for approval, derived only from real action/approval state — no fake "thinking" animation), Current Objective (from the active `GoalRecord`), REV conversation/task input (demo reasoning via the existing mock `AIService`, explicitly labelled "Demo reasoning only — REV AI execution is not connected yet."), Work Queue (`REVActionRecord`s mapped to Planned/Waiting for approval/Approved — not executed/Rejected/Cancelled/Completed/Blocked), Recommendations (derived from each action's `rationale`), Approvals (wired to the real `ApprovalService.decide`, preserving the existing APPROVED — NOT EXECUTED invariant), Recently Completed, Outcomes (bounded to Phase 3D), and a static REV Skills capability list (informational only, not operational).
- **Quality Gate concept:** each work item shows a `Quality gate` label (Draft/Ready for approval/Checked/Needs evidence); an action without a `rationale` is tagged `EVIDENCE REQUIRED` rather than presented as verified.
- **Live (Supabase) mode:** a distinct workspace view renders honest empty states for objective/input/work queue/recommendations/approvals/completed/outcomes, since goals/actions/approvals repositories remain mock-only per Phase 2D.2 scope; no mock data leaks into live mode.
- **No new backend execution:** no AI API, autonomous jobs, email/SMS/WhatsApp/voice/social/payments/scraping were added. Approving a REV action still only sets `status: 'approved'` with `executionStatus: 'not_executed'` — verified in both the browser and a unit test.
- **No direct Supabase calls were added to React components**; the same `dataProviderMode` branch pattern already used by `HomeDashboard`/`BusinessModule` was reused.
- **Motion/mobile:** section entrances reuse the existing `rev-motion-in` utility (respects `prefers-reduced-motion`); mobile reorders to Objective → Input → Approvals → Work Queue → Recommendations → Completed → Outcomes via responsive Tailwind `order-*` classes, confirmed at 390×844.
- **Tests:** added `tests/phase3c_rev_workspace.test.ts` (4 tests) covering tenant-scoped goal/action/approval reads and the non-executing approve/reject invariant, plus the evidence-required quality-gate label. Full suite: 30/30 passed. Build and `npm audit` (0 vulnerabilities) both passed.
- **Live browser validation:** User B's live REV page showed correct honest empty states with the right workspace context; approving/rejecting an action in mock mode correctly updated status, quality gate, and cleared the approvals section without executing anything; User C's existing no-workspace guard (pre-existing, workspace-agnostic) was confirmed unaffected.
- No database schema, RLS, migration, membership, legacy quotes/Telegram, or marketing-site change was made.

---

## Phase 3D: Growth & Revenue Intelligence ✅ COMPLETE (PASS)

**Date:** 2026-09-14

**Result:** Rebuilt `GrowthArea.tsx` as the GROWTH commercial-intelligence surface, built on the existing Phase 2B `ContactRecord`/`ContactService` architecture (same foundation as Phase 3C), with all derivation logic in a new pure module `services/growthIntelligenceService.ts`.

**Revenue definitions (explicit):**
- **WON REVENUE:** sum of `estimatedValue` for contacts with `lifecycle === 'customer'`.
- **REVENUE IN PIPELINE:** sum of `estimatedValue` for contacts with `lifecycle` in (`prospect`, `lead`).
- **REVENUE AT RISK:** sum of `estimatedValue` for `lead`-lifecycle contacts with no scheduled `nextActionAt` and no interaction recorded in the last 14 days.
- **RECOVERABLE REVENUE:** sum of `estimatedValue` for contacts with `lifecycle === 'former_customer'`.
- **REV GENERATED:** sum of `estimatedValue` for **won** contacts explicitly tagged `attribution: 'rev_generated'`.
- **REV RECOVERED:** sum of `estimatedValue` for **won** contacts explicitly tagged `attribution: 'rev_recovered'`.
- No figure is ever inferred from a recommendation alone; a contact with no `attribution` set is always treated as `unattributed` and receives zero REV credit.

**Attribution rule:** added `AttributionCategory` (`owner_generated | rev_generated | rev_assisted | rev_recovered | unattributed`) as an optional field on `ContactRecord` (frontend/mock domain model only — not a Supabase schema/migration change). REV only receives credit where this field is explicitly set; absence always means `unattributed`.

**Opportunity pipeline:** `deriveOpportunityStage()` maps only what the current `ContactRecord` model can honestly evidence: `new`, `qualified`, `contacted`, `follow_up`, `won`, `dormant`. The full conceptual chain from the product spec (`New → Qualified → Contacted → Conversation → Appointment → Quote → Follow-up → Won → Lost → Dormant`) is shown as a reference legend, with `Conversation`, `Appointment`, `Quote`, and `Lost` explicitly labelled as not yet derivable — see **Proposed Future Schema** below.

**Customers vs Growth boundary:** CUSTOMERS answers "who are the people/businesses and what is the relationship/history"; GROWTH answers "where are the commercial opportunities, pipeline, risks and outcomes." Both currently read the same `ContactRecord` repository through their own service layer (`ContactService`); GROWTH adds no new persistent writes.

**Bid/Grant opportunities:** represented as a single, clearly labelled "Example concept — not a real opportunity" card in mock mode only (matching the spec's example fields exactly: Potential value/Fit/Deadline/Evidence status, all "Not yet assessed"/"—"). Live mode shows only an honest "Not connected in live mode" empty state; no example card is rendered live.

**Mock mode demo data:** four additional `ContactRecord` fixtures (`contact-5`..`contact-8`) were added to `seedFixtures.ts`, clearly commented as Phase 3D demo-only data, to demonstrate won/dormant/attribution states; these are never sent to Supabase and Phase 2B isolation tests (`phase2b.test.ts`) continue to pass unchanged.

**Supabase/live mode:** every GROWTH section (money requiring attention, revenue intelligence, opportunity pipeline, recommendations, sources & attribution, bid/grant, outcomes) renders a distinct, honest "Not connected in live mode" empty state; no mock data or fabricated figures can reach live mode because `LiveGrowthArea` contains no data reads at all.

**Tests:** added `tests/phase3d_growth.test.ts` (14 tests) covering revenue-bucket correctness, at-risk/attribution/source rules, and the explicit guarantee that no REV credit is assigned without recorded evidence. Full suite: 44/44 passed. Build and `npm audit` (0 vulnerabilities) both passed.

**Visual review:** mock-mode GROWTH reviewed at desktop (1280×900) and mobile (390×844) widths, confirming the requested mobile priority order (Money requiring attention → Revenue intelligence → REV recommendations → Opportunity pipeline → outcomes). Live-mode/no-workspace behaviour was validated by automated regression (existing Phase 2D.2/3B/3C browser evidence remains the baseline) plus static code review confirming `LiveGrowthArea` is structurally identical in pattern to the already-validated `HomeDashboard`/`REVInterface` live branches; no new live-user browser test was required because this phase does not touch authentication, workspace authorization, RLS, or tenant isolation.

**Proposed future Opportunity schema (not created, for review only):** a persistent `opportunities` concept would need explicit records for `conversation`, `appointment`, and `quote` events (with timestamps and linkage back to a `contact_id`/`goal_id`), plus a `lost` outcome distinct from `dormant`, before the full conceptual pipeline stage list can be honestly derived. This is deferred to Phase 3E+ and requires its own migration review; no schema or migration was created in Phase 3D.

**Phase 3E requirements (carried forward):** real opportunity/source discovery (website enquiry capture, REV prospect discovery, tender/grant discovery), the proposed Opportunity schema above, and connecting live Supabase reads for contacts/goals/actions/approvals under an explicitly approved write/read boundary.

- No database schema, RLS, migration, membership, legacy quotes/Telegram, or marketing-site change was made.

---

## Phase 3E: Leads & Outreach Foundation + Opportunity Domain Design ✅ COMPLETE (PASS)

**Date:** 2026-09-14

**Result:** Implemented the Opportunity domain, prospect-discovery boundary, fit-score model, and approval-gated outreach preparation. Full detail: `01_ARCHITECTURE/PHASE_3E_OPPORTUNITY_DOMAIN.md`.

- **Opportunity domain:** new `OpportunityRecord`/`OpportunityRepository`, distinct from `ContactRecord`, workspace-scoped through the same repository pattern as Goals/Contacts/REVActions.
- **Schema proposal (NOT applied):** local-only migration `revive-app/supabase/migrations/20260914000000_rev_opportunities_proposal.sql` + rollback `REVIVE_AI_MASTER/rollback/20260914000000_rev_opportunities_proposal_rollback.sql`. No remote migration was applied; this requires separate explicit approval.
- **Prospect discovery:** `ProspectDiscoveryProvider` interface + `MockProspectDiscoveryProvider` (demo-only, no unrestricted scraping); each candidate carries `whyFound`/`whyRelevant`/`evidence[]` and a transparent, named-criteria Fit Score (never a bare AI confidence number).
- **Outreach:** reuses the existing Phase 3C `REVActionService`/`ApprovalService` architecture, inheriting the APPROVED — NOT EXECUTED invariant automatically (verified by test). Suppressed contacts (`doNotContact`) are refused outright before any draft is created.
- **GROWTH UI:** Opportunity Pipeline now sourced from real `OpportunityRecord`s (superseding the Phase 3D interim contact-derived stage list, which remains valid/tested but unused by the UI); added a Prospect Discovery section with a working "Prepare outreach" flow that creates a Contact + Opportunity + approval-gated outreach draft, live-verified end-to-end in the browser (the new draft correctly appeared in REV's Work Queue/Recommendations/Approval Centre).
- **Canonical dev server:** consolidated to a single instance on `http://127.0.0.1:5180/`; duplicate port-5181 server stopped.
- **Tests:** added `tests/phase3e_opportunity.test.ts` (13 tests) covering workspace scoping, Contact/Opportunity separation, revenue/attribution rules, at-risk derivation, fit-score averaging, discovery scoping, non-executing outreach approval, and suppression enforcement. Full suite: 57/57 passed. Build and `npm audit` (0 vulnerabilities) both passed.
- **Live browser validation:** not required and not re-run — this phase does not touch authentication, session handling, workspace selection, RLS, or tenant isolation; existing Phase 2D.2/3B/3C/3D evidence remains the security baseline. Mock-mode visual review completed at desktop and mobile widths on the canonical port-5180 server.
- No database schema, RLS, membership, legacy quotes/Telegram, or marketing-site change was made. No AI API, external discovery, or external sending was connected.

---

## Phase 3E.2: Local Opportunity Migration Rehearsal + RLS Attack Matrix ✅ COMPLETE (PASS, remote untouched)

**Date:** 2026-09-14

**Result:** Rehearsed the corrected Opportunity migration against a dedicated **local** Supabase/Docker stack (never the remote/linked Revive project) and ran a 51-check attack matrix mirroring Phase 2D.1D. Full detail: `01_ARCHITECTURE/PHASE_3E_OPPORTUNITY_DOMAIN.md` §11.

- **Function ACL hardening (explicitly requested):** confirmed via direct `pg_proc` catalog inspection that `prevent_opportunity_identity_mutation()` is not `SECURITY DEFINER`, has an explicit empty `search_path`, and — after adding explicit `REVOKE ALL ... FROM PUBLIC/anon/authenticated` to the migration — has **no** grants for those roles at all (only `postgres`/`service_role`), directly addressing the Phase 2D.1C lesson.
- **51/51 attack-matrix checks passed:** contact cardinality, own-tenant CRUD, cross-tenant read/insert/update/delete denial, User C outsider denial, cross-tenant contact injection blocked by the composite FK, workspace-spoof blocked by RLS, cross-workspace move by a **dual-member** user blocked by the new trigger (the exact gap flagged in 3E.1), suspended-membership denial with correct restoration, stage/source/attribution CHECK constraints, money/currency/probability validation, suppression isolation, and `rev_actions.opportunity_id` composite-FK tenant integrity.
- **Rollback + reapply rehearsed locally:** rollback removed only the objects this proposal created; all pre-existing tables/functions (including `is_active_workspace_member`, `has_workspace_role`, `create_workspace_with_owner`) were confirmed untouched by catalog inspection; the migration reapplied cleanly afterward.
- **No interference with unrelated local infrastructure:** the local rehearsal used shifted ports and a distinct `project_id` specifically so it would not conflict with an unrelated pre-existing local Supabase stack (`famous-ai-codes`) already running on this machine; that stack was confirmed running, untouched, before and after.
- **Remote database:** not touched at any point. No `supabase db push`, remote migration, or remote SQL was executed.
- Regression: `npm test` 58/58, build passed, `npm audit` 0 vulnerabilities.
- Still requires an explicit human approval decision before any future application to the real Revive Supabase project.

---

## Phase 3E.3A: Supabase CLI/config compatibility repair COMPLETE (PASS; remote untouched)

**Date:** 2026-09-14

**Result:** The Phase 3E.3 preflight blocker was isolated to CLI/config compatibility. CLI `2.75.0` rejected `[experimental.pgdelta]` and `[local_smtp]`; the config was backed up and left unchanged. Project-scoped `npx supabase@2.117.0` is compatible and was used for inspection.

- Backup: `REVIVE_AI_MASTER/backups/phase_3e_3a_config.toml.20260914.bak`.
- Existing link metadata: `Revive Websites` / `ntbowgutwyyhhnmkadlv`; no relink was performed.
- Remote history: `20260912162730` and `20260912170332` applied; only `20260914000000_rev_opportunities_proposal.sql` pending; no unexpected migration.
- `npm test`: 58/58 passed. `npm run build`: passed. `npm audit`: not run because no package changes occurred.
- No remote database, migration, SQL, schema, RLS, or migration-history mutation occurred. Phase 3E.3 deployment is not complete.

## Phase 3E.3: Controlled remote Opportunity migration COMPLETE (PASS)

**Date:** 2026-09-14

- Applied only `20260914000000_rev_opportunities_proposal.sql` to `Revive Websites` / `ntbowgutwyyhhnmkadlv` with pinned `npx --yes supabase@2.117.0`; dry-run confirmed one migration before execution.
- Credential-safe pre/post schema and data backups are retained under `REVIVE_AI_MASTER/backups/`.
- Catalogue confirmed new tables, constraints, indexes, composite FKs, immutable trigger, RLS, and policies. Trigger function is postgres-owned, not SECURITY DEFINER, uses an empty search_path, and has no PUBLIC/anon/authenticated direct execution surface.
- Production attack matrix passed all checks, including A/B own-tenant access and isolation, outsider C denial, spoof/FK attacks, dual-membership immutability, delete denial, suspended-user restoration, constraints, suppression isolation, and REV-action linkage.
- `npm test` 58/58, build, and `npm audit` (0 vulnerabilities) passed. Canonical live Supabase-mode app reached its login boundary at `http://127.0.0.1:5180/`.
- Legacy quotes and Telegram remained unchanged. Eight controlled opportunity fixtures remain explicitly marked `TEST FIXTURE`, dormant, zero-value, and unattributed. No external providers or outreach execution were connected.

## Phase 3F.1: Real Opportunity Discovery Foundation COMPLETE (PASS; mock-only)

**Date:** 2026-09-14

- Added provider-independent `DiscoveryRequest`, normalized `DiscoveryCandidate`, typed FACT/INFERENCE/EVIDENCE_REQUIRED evidence, provider capability contract/registry, and router.
- Added deterministic `MockBusinessDiscoveryProvider` for GB business discovery only; no network, API key, paid service, scraping, or live discovery is connected.
- Added allowance-aware `CostGovernor`, append-oriented in-memory usage ledger, provider identity deduplication, conservative `ComplianceGate`, and candidate conversion `QualityGate`.
- GROWTH mock mode now presents normalized candidates with evidence, fit, cost allowance, qualification state, and Review/Qualify/Prepare/Dismiss actions. Live Supabase mode remains an honest no-live-discovery state.
- Tests: 67/67 passed; build passed; `npm audit` found 0 vulnerabilities. Desktop and 390x844 mock review passed without horizontal overflow; live mode displayed no mock discoveries.
- No database, migration, legacy quote/Telegram, or marketing-site change occurred.

## Phase 3F.2: Controlled UK Provider Integration BLOCKED (safe stop)

**Date:** 2026-09-14

- Reviewed official DataForSEO Business Listings documentation and recorded findings in `REVIVE_AI_MASTER/PHASE_3F_2_PROVIDER_REVIEW.md`.
- Confirmed the Live Business Listings endpoint, Basic Auth requirement, UK location support, official rate limits, per-task/per-item billing, `$50` minimum payment, and published 365-day provider task-data retention.
- Prepared an unbundled server-only DataForSEO normalization adapter at `revive-app/src/server/dataForSeoBusinessDiscoveryProvider.ts`. It enforces `GB`, requires a UK location, bounds request size/cost configuration, maps only permitted facts, omits raw payloads/personal enrichment, and maps provider failures safely.
- No DataForSEO credentials or development budget configuration are present. No real provider request, account funding, paid service, contact enrichment, outreach, AI call, database migration, or remote Supabase change occurred.
- The existing Vite app has no deployed trusted server handler; the adapter remains uninstantiated and cannot be called from React. A trusted execution handler with workspace/global CostGovernor, idempotency, and rate limiting must be approved before any request.
- Regression: 69/69 tests passed, build passed, `npm audit` found 0 vulnerabilities, and the browser bundle contains zero DataForSEO secret variable names.

## Phase 3F.2A: UK Discovery Provider Comparison COMPLETE (PASS; research only)

**Date:** 2026-09-14

- Compared DataForSEO, Google Places (New), Outscraper, Serper, Companies House, and Foursquare using current official documentation where accessible. Full report: `REVIVE_AI_MASTER/01_ARCHITECTURE/PHASE_3F_2A_UK_DISCOVERY_PROVIDER_COMPARISON.md`.
- Decision: do not authorize the DataForSEO `$50` payment. Companies House is the strongest persistence/verification source but not a local-business discovery replacement. Outscraper is the cheapest advertised actual-discovery test, but its scraping model and persistent-storage rights require written review. Google has strong UK coverage and free SKU allowances, but its current Maps terms prohibit copying/saving business names/addresses and permit indefinite storage mainly for Place IDs.
- Recommended architecture: POI discovery provider only after licensing confirmation -> optional Companies House verification -> REV normalization/evidence/quality gate -> explicit qualification -> Contact/Opportunity. No raw provider payloads or personal enrichment by default.
- No provider account, credential, payment, API call, Edge Function, database migration, remote change, scraping, enrichment, AI, or outreach occurred.

## Phase 3F.2B: UK Business Verification Foundation COMPLETE (PASS; architecture-only)

**Date:** 2026-09-14

- Added provider-independent business identity, presence, verification result, entity type, verification state, match strength, provenance, and verification-provider contracts.
- Added deterministic `MockCompaniesHouseVerificationProvider`; exact/strong matches verify, multiple plausible matches remain ambiguous, and no match remains `NOT_FOUND` with `entityType = UNKNOWN`.
- Explicitly preserves credible trading presence when registry evidence is absent. No absence-based inference of sole trader, partnership, trading name, emerging, pre-launch, or fake business is permitted.
- No Companies House API connection, credentials, external spend, Edge Function, database migration, Contact/Opportunity write, Business Memory write, or revenue attribution occurred.
- Full architecture record: `REVIVE_AI_MASTER/01_ARCHITECTURE/PHASE_3F_2B_UK_BUSINESS_VERIFICATION_FOUNDATION.md`.

## Phase 3F.2C: Controlled Companies House Verification COMPLETE (PASS; bounded)

**Date:** 2026-09-14

- Rechecked official Companies House documentation: API-key HTTP Basic Auth, REST company search/profile APIs, 600 requests per five minutes, free public API access, TLS, key-security guidance, and public-register reuse requirements.
- Added the server-only `CompaniesHouseVerificationProvider` at `revive-app/src/server/companiesHouseVerificationProvider.ts`. It enforces GB before fetch, normalizes permitted registry facts, excludes officers/PSC/personal data, preserves deterministic exact/strong/ambiguous/not-found matching, and maps auth/rate-limit/unavailable/malformed failures distinctly.
- `rev-business-verify` was deployed only to `Revive Websites` / `ntbowgutwyyhhnmkadlv` with `verify_jwt = true`; `telegram-alert-ts` was not redeployed.
- Authenticated User A workspace authorization passed. Anonymous requests returned 401; cross-workspace User B and outsider User C requests returned 403 without provider calls.
- The server-side secret was available to the function. Six initial GB requests returned sanitized HTTP 400; the request-construction defect was fixed by trimming the key and encoding `API_KEY:` through a tested GET/no-body builder. Exactly one permitted real profile retest succeeded as `VERIFIED / EXACT` for company `00000006`. Non-GB returned `NOT_APPLICABLE` with provider call count 0.
- Total real Companies House provider requests: 7. External spend remained £0.
- No Contact/Opportunity/REV action/Business Memory/revenue/outreach side effect occurred. No database migration or legacy quote/Telegram/marketing-site change occurred.
- Focused adapter/verification tests passed 12/12; full validation passed 81/81, build, and audit zero vulnerabilities.
- No further provider calls are authorized in this phase. Do not continue into discovery, enrichment, or outreach.

## Phase 3G: Commercial Intelligence Foundation COMPLETE (PASS; deterministic/mock-only)

**Date:** 2026-09-14

- Added provider-independent commercial models and `buildCommercialPlan()` for the unified REV FIND / REV AUDIENCE / REV RECOVER loop.
- Recovery uses existing workspace records only: dormant opportunities, stale open opportunities, missing next actions, and former customers. No fake production records or unsupported invoice/renewal signals were added.
- FIND consumes existing mock discovery candidates; Companies House remains verification only. AUDIENCE uses Business Brain/services to produce generic legitimate channel hypotheses without sensitive-person profiling.
- Added deterministic prioritization with explainable score dimensions and approval-required recommendations. Signals remain distinct from Opportunities and REV Actions; recommendations never auto-execute.
- Full suite: 90/90 passed; `npm audit` found 0 vulnerabilities; build passed; desktop and 390x844 review passed with no horizontal overflow.
- No external providers, Companies House calls, paid AI, outreach, database migration, production DB, legacy quotes/Telegram, marketing-site, Stripe, or Family Legacy systems were connected.

## Phase 3G.1: Commercial Plan -> Supervised Action Workflow COMPLETE (PASS)

**Date:** 2026-09-14

- Added `CommercialActionService`, reusing existing `REVActionService.propose()` and `ApprovalService`/approval repository. Recommendations remain separate from Actions and are proposed only after an explicit owner click.
- GROWTH `REV'S PLAN` now offers `Review Action`, handing one recommendation into REV's existing approval queue. The handoff is idempotent by recommendation ID and preserves goal, route, rationale, evidence reference, potential value, confidence, and approval requirement.
- REV approval cards now explain what REV proposes, why, potential/value boundaries, expected external cost, and `External effect: NONE. Execution is disabled in this phase.` Approve/Edit/Reject controls remain available before resolution.
- Approval produces `approved` plus `executionStatus = not_executed`; rejection records intent only. No outreach, provider call, Contact/Opportunity mutation, revenue, attribution, or automatic execution occurs.
- Audience recommendations marked `review_required` or `prohibited` cannot become actions. Fixed same-millisecond REV Action ID collision with a random suffix.
- Focused supervised tests: 5/5 passed. Full suite: 103/103 passed; build passed; `npm audit` found 0 vulnerabilities. Mock desktop/mobile review passed; live mode restored and shows no mock data.
- No database migration, external provider, Companies House, DataForSEO, paid AI, Stripe, outreach, legacy quote/Telegram, marketing-site, or Family Legacy change occurred.

## Phase 3G.2: Execution Readiness & Capability Policy COMPLETE (PASS; execution disabled)

**Date:** 2026-09-14

- Added provider-independent capability definitions for prepare-only, research/read-only, external communication, financial, high-risk, and business-verification operations.
- Added deterministic execution policy and dry-run planning with approval, workspace, provider, country, cost, audience safety, autonomy, capability, and platform kill-switch checks.
- Platform execution is disabled by default. External communication, financial, and high-risk capabilities are disabled; default autonomy is `always_ask`. No Execute control was added.
- Added audit-ready execution context fields for job, workspace, action, goal, recommendation, route, capability, actor, approval, provider, country, jurisdiction, cost, risk, autonomy, correlation, and creation time.
- REV displays execution readiness and expandable dry-run policy details. Approved preparation can be assessed for dry run; unapproved/provider-backed/disabled/sensitive actions are blocked or require review.
- Focused policy tests: 8/8 passed. Full suite: 103/103 passed; build passed; `npm audit` found 0 vulnerabilities. Mock desktop/mobile review passed; live mode restored on port 5180 with no mock data shown.
- No provider calls, outreach, financial action, database migration, Supabase change, legacy quote/Telegram change, or marketing-site change occurred.

## Phase 3: Leads & Outreach ⏳

## Phase 3H: REV RECOVER Real Recovery Intelligence Foundation COMPLETE (PASS; no external communication)

**Date:** 2026-09-14

- Added `RecoveryCandidate` and `RecoveryAnalysis` as derived, workspace-scoped domain views. No recovery persistence schema or migration was added.
- Supported signals are `DORMANT_LEAD`, `STALE_OPPORTUNITY`, `NO_NEXT_ACTION`, and `FORMER_CUSTOMER_REACTIVATION`, using only existing lifecycle, stage, activity/update, next-action, and estimated-value fields.
- `QUOTE_FOLLOW_UP`, `REPEAT_SERVICE`, `RENEWAL_DUE`, and `UNPAID_INVOICE` are explicitly `NOT_YET_SUPPORTED` because the current REV model has no safe workspace-scoped evidence for them; legacy `public.quotes` was not reused.
- Potential/recoverable value is summed only from explicit recorded estimated values. Missing value remains unknown; findings are not Won Revenue, REV Recovered, or attribution.
- Added GROWTH `MONEY REV FOUND` summary with truthful potential-value language and supported-signal count. Live mode remains an honest unconnected state with no mock recovery values.
- Recovery candidates can feed the existing commercial recommendation and supervised action workflow; no recommendation, action, approval, or dry-run executes communication.
- Execution remains disabled with the platform execution kill switch set to false and no Execute control. Approval remains supervised; approved actions remain `APPROVED — NOT EXECUTED`.
- Focused recovery tests: 7/7 passed. Full suite: 110/110 passed; build passed; `npm audit` found 0 vulnerabilities. Desktop and 390x844 review passed without overflow; live mode restored.
- No external providers, Companies House calls, outreach, database migration, Supabase change, legacy quote/Telegram change, marketing-site, Stripe, or Family Legacy change occurred.
- Next phase: Phase 4A — subsequently completed below.

## Phase 4A: Owner Control Centre Foundation COMPLETE (PASS; read-model only)

**Date:** 2026-09-14

- Added one workspace-scoped Owner Control Centre read model over existing repositories, commercial intelligence, recovery analysis, opportunity revenue, approval records, execution policy, and Cost Governor boundaries.
- Rebuilt HOME around eight concise owner sections: TODAY, REV IS WORKING ON, NEEDS YOUR APPROVAL, READY / BLOCKED, MONEY REV FOUND, RECENT RESULTS, COST / USAGE, and SYSTEM STATUS.
- Kept approval decisions in REV. HOME links to the existing approval surface and introduces no second approval or write path.
- `READY` and `BLOCKED` remain derived dry-run views. Real execution is disabled and no Execute control exists.
- Mock mode uses deterministic workspace fixtures. Live mode has explicit unavailable states and no mock fallback or leakage.
- Potential, recoverable, pipeline, won, REV recovered, and REV generated values remain separate; completed work is not treated as revenue.
- Focused Phase 4A tests passed 10/10; focused HOME regression bundle passed 15/15; full suite passed 120/120; build passed; `npm audit` reported 0 vulnerabilities.
- Desktop and 390x844 browser validation passed with no document/content overflow; live mode was restored on `127.0.0.1:5180` and showed the authenticated sign-in boundary with no mock leakage.
- No migration, RLS change, Supabase deployment, external call, production write, execution enablement, `public.quotes`, Telegram, or `rev-business-verify` change occurred.

## Phase 4B: Trusted Execution Boundary COMPLETE (PASS; execution disabled)

**Date:** 2026-09-14

- Added minimal trusted request/auth/config/envelope contracts and a workspace-scoped `TrustedExecutionBoundaryService`.
- Authority, role, action, approval, capability, workspace switch, provider state, audience safety, jurisdiction, autonomy, and cost are resolved inside the boundary rather than accepted as caller assertions.
- Added deterministic approval fingerprints, stale-approval rejection, lifecycle transition checks, and actor/workspace/request-scoped in-memory idempotency with an explicit non-durable limitation.
- Every envelope keeps `executionEnabled: false` and `providerInvoked: false`; external communication, financial, high-risk, and platform execution remain disabled.
- Focused Phase 4B tests passed 21/21; adjacent regression bundle passed 42/42; full suite passed 141/141; build passed; `npm audit` reported 0 vulnerabilities.
- No migration, RLS change, Supabase deployment/write, provider call, external action, Execute control, legacy quote/Telegram, or `rev-business-verify` change occurred.

## Phase 4C: Durable Execution Control Plane PRODUCTION APPLIED + VERIFIED

**Date:** 2026-09-14
**Production status:** Migration `20260914183000` applied and verified on `ntbowgutwyyhhnmkadlv`

- Drafted additive workspace policy, action-version/approval-fingerprint, durable dry-run attempt, provider-usage, audit, RLS, ACL, trigger, and RPC controls.
- Missing policy means disabled; defaults are `execution_enabled = false`, `always_ask`, and zero provider-cost ceilings.
- Owner/admin may approve and prepare dry runs; members may propose ordinary work but cannot authorize; viewers are read-only; suspended users and outsiders are denied.
- Local migration/catalog, 42/42 Auth/RLS/ACL attacks, adjacent regression, guarded and empty-state rollback, 7/7 focused tests, 148/148 full tests, build, and audit all passed.
- Platform execution remains false. No provider, external action, Execute control, remote migration, production write, quote/Telegram, marketing-site, or `rev-business-verify` change occurred.

- Production-safe verification passed 25/25 inside a transaction ending in rollback; no fixtures, policies, execution attempts, or usage events persisted.
- Protected quote/Telegram fingerprint and Telegram Edge Function metadata were unchanged before/after.
- Final application validation passed 148/148 tests, build, and zero-vulnerability audit.

**Stop condition:** Do not activate execution, a provider, external communication, payments, or an Execute control without separate explicit authorization.

## Phase 4D: First Real REV Capability — Prepare Follow-Up COMPLETE (PASS; internal-only)

**Date:** 2026-09-14

- Added a typed prepared follow-up artifact using existing REV Action fields for editable material content and Business Memory structured data for recovery linkage, evidence, objective, channel, and missing information. No schema change was required.
- Reused the canonical REV Action and Approval workflow. Each recovery candidate creates at most one `prepare_follow_up` action and approval.
- Drafts use only workspace-owned Business Brain, Contact, Opportunity, Goal, and Recovery evidence. Missing context is disclosed rather than invented.
- Suppressed contacts, review-required safety states, unsupported signals, cross-workspace records, and unauthorized reviewers are blocked.
- Active members may prepare; only owner/admin may edit, approve, or reject. Approval fingerprints bind edited subject/body content.
- REV now exposes Recovery Opportunities and `REV PREPARED THIS FOR YOU` with EDIT / APPROVE / REJECT and `APPROVED — NOT SENT`. There is no Send or Execute control.
- Focused Phase 4D tests passed 15/15; full suite passed 163/163; build passed; `npm audit` reported 0 vulnerabilities.
- Desktop 1440x1000 and mobile 390x844 browser checks passed with no overflow, no internal marker leakage, and successful edit/save/approve interaction.
- No migration, Supabase deployment/write, external provider, external communication, execution attempt, legacy quote/Telegram, marketing-site, or `rev-business-verify` change occurred.

**Stop condition:** Do not add sending, provider-backed delivery, execution controls, or production persistence changes without a separately authorized phase.

## Phase 4E: Live Prepared-Work Repository Integration COMPLETE (PASS; approved not sent)

**Date:** 2026-09-16

- Connected `PREPARE_FOLLOW_UP` to the authenticated live repository while preserving the Phase 4D artifact and Phase 4C action/approval authority model.
- Reused existing `rev_actions`, `approvals`, Business Memory, contacts, opportunities, role-specific RLS, action versions/fingerprints, and trusted decision RPC. No schema extension was required.
- Prepared artifacts persist and reload through deterministic action, approval, and memory linkage. Retries return the existing artifact without duplicates.
- Owner/admin may prepare, edit, approve, and reject. Members may prepare but cannot authorize. Viewers are read-only. Cross-tenant reads and writes are denied.
- Real isolated local Supabase/PostgREST/RLS validation passed for persistence, fresh repository/session reload, stale-review rejection, role authority, tenant isolation, idempotency, and persisted `APPROVED — NOT SENT` state.
- Focused tests passed 14/14; full suite passed 177/177; build passed; audit reported 0 vulnerabilities; desktop/mobile review passed.
- Platform execution is false, workspace execution is OFF, execution/provider evidence rows are zero, no Send/Execute control exists, no provider was invoked, no external communication occurred, and cost remained £0.
- No migration, RLS, grant, function, production Supabase, legacy quote/Telegram, marketing-site, or `rev-business-verify` change occurred.

**Stop condition:** Do not add sending, provider-backed delivery, execution activation, payments, or production configuration changes without a separately authorized phase.

## Phase 4F: Controlled Execution Request Foundation COMPLETE (PASS; dry run only)

**Date:** 2026-09-16

- Added a controlled owner/admin-only request boundary for approved `PREPARE_FOLLOW_UP` work. Members, viewers, stale approvals, cross-tenant access, blocked policies, external providers, and nonzero provider costs are denied.
- The trusted boundary reruns authoritative pre-execution validation and accepts only `ready_for_dry_run`; every accepted result is `DRY RUN — NOTHING SENT` with no provider invocation, external communication, execution, or cost.
- Successful first requests produce request/completion audit records. Matching process-local retries replay without duplicate audit; Phase 4C remains the durable control plane for future server-owned integration.
- Mock mode exposes `REQUEST EXECUTION` for eligible approved owner/admin artifacts. Live Supabase mode has no request control because a trusted server endpoint is not authorized. No `SEND` control exists.
- Focused Phase 4B/4D/4F tests passed 39/39 and the production build passed.
- No schema, migration, RLS, grant, function, production Supabase, provider, protected quote/Telegram, marketing-site, or `rev-business-verify` change occurred.

**Stop condition:** Do not add a live execution endpoint, provider-backed delivery, sending, payments, or execution activation without a separately authorized phase and security review.

## Phase 4G.1: PROVIDER-INDEPENDENT EMAIL EXECUTION GATEWAY FOUNDATION COMPLETE (PASS; no email sent)

**Date:** 2026-09-16

- Added provider-neutral email execution request/result/service/provider contracts and a trusted server authority reservation contract. No provider adapter was implemented.
- Future eligibility requires an active owner/admin, exact workspace and approved `PREPARE_FOLLOW_UP` action, matching action/approval version and fingerprint, exact approved recipient/subject/body snapshot, allowed safety/jurisdiction/workspace policy, Cost Governor approval, and durable approved-action-version idempotency.
- Designed the authority boundary to reuse Phase 4C durable execution attempts, correlation/idempotency, request and approval fingerprints, provider usage evidence, audit, and backend-only outcome recording. No parallel persistence path exists.
- `SEND_APPROVED_EMAIL` and platform execution remain disabled. The service stops at `DRY RUN — NOTHING SENT`; provider calls, emails, usage, external effects, and cost are zero.
- Focused and adjacent execution tests passed 67/67; the production build passed. No UI wiring or `SEND` control was added.
- No migration, schema, RLS, grant, RPC/function, production Supabase, provider credential, protected quote/Telegram, legacy-family, marketing-site, or unrelated change occurred.

**Stop condition:** Do not implement Phase 4G.2 server/RPC integration, provider credentials or adapter, live outcome transitions, or sending without separate authorization and security review.
## Phase 4G.2B: Controlled Microsoft Graph Email Execution COMPLETE (PASS)

**Date:** 2026-09-22

- Implemented the trusted server-side Microsoft Graph email execution path for approved `PREPARE_FOLLOW_UP` actions.
- Reused the existing Phase 4C durable execution control plane, approval fingerprints, workspace authority, suppression controls, idempotency and audit boundaries.
- Microsoft Graph credentials remain server-side only. Exchange Application RBAC restricts the application to the authorised sender mailbox.
- Final suppression status is rechecked immediately before the provider claim/send boundary.
- Fixed the final suppression query to use an existing `contact_suppressions` field rather than the nonexistent `id` column.
- Completed one controlled live FatherLegacy test through the full REV workflow: preparation -> approval -> durable execution claim -> Microsoft Graph -> provider acceptance.
- Microsoft Graph returned provider acceptance and the test recipient independently confirmed receipt.
- The execution record reached `succeeded / accepted_by_provider`. Provider acceptance remains distinct from confirmed delivery.
- The tested execution/action/version must never be retried.
- Microsoft Graph client-secret rotation was completed after testing; the superseded exposed secret was deleted.
- Temporary diagnostic logging was removed from the local implementation.
- Final regression: 34/34 test files and 263/263 tests passed; `git diff --check` passed.
- Final completion commit: `d212cd3` (`Complete controlled Microsoft Graph email execution`).
- After the controlled test, the server-side provider execution gate was returned to `false`.
- Live external email execution is therefore OFF by default.

**Safety state:** No autonomous sending. Approval remains mandatory. Provider execution is disabled by default.

## Phase 4G.3–4G.5: Reusable Email & Replies Capability COMPLETE (PASS)

**Date:** 2026-09-23

- Trusted read-only Microsoft Graph inbox ingestion, workspace mailbox routing, idempotent inbound-message persistence, and tenant-safe contact/opportunity matching are complete.
- Inbound classification and reply-intent detection now produce recommended supervised actions, with durable REV action and approval creation and approval/rejection through the existing control plane.
- Read-only chronological email conversation history is complete, including business-relevant triage into Customer conversations, Needs review, and collapsed Automated mail; unknown unlinked messages remain conservatively visible for review.
- Stored messages are retained. Triage does not delete or mutate email, and conversation history exposes no Reply, Send, Compose, or Execute control.
- Provider email execution is disabled, no autonomous sending is enabled, and approval remains mandatory for supervised REV actions.
- Full regression passed: 44 files and 330 tests. Production build passed. Live FatherLegacy workspace validation completed. PR #1 and PR #2 merged into main.

**Next phase:** Phase 5 — Calendar & Meetings planning and architecture review. No calendar provider, event creation or external scheduling is authorized by this tracker update.

---
**Objective:** Build lead management and outreach workflow

**Estimated Duration:** 4 weeks

**Deliverables:**
- Lead creation and management UI
- Lead qualification workflow
- Prospect research capability
- Lead scoring algorithm
- Outreach message preparation
- Email template management
- Draft generation and review
- Lead interaction tracking
- Conversation threading

**Acceptance Criteria:**
- Leads can be created, imported, and organized
- Leads can be scored by fit and engagement
- Outreach workflows can be created
- Message drafts generated and reviewed
- Lead interactions tracked over time

**Dependencies:** Phase 2 complete

---

## Future: Email & Replies ⏳

**Objective:** Integrate email and build reply detection workflow

**Estimated Duration:** 3 weeks

**Deliverables:**
- Email account integration (OAuth)
- Outbound email sending capability
- Reply detection and threading
- Email history tracking
- Automated follow-up creation
- Reply sentiment analysis (basic)
- Email template personalization

**Acceptance Criteria:**
- Email accounts can be connected
- Emails can be sent through connected account
- Replies are automatically detected
- Conversation threads preserved
- Follow-up tasks created automatically

**Dependencies:** Owner Control Centre and trusted execution foundations complete, plus separate explicit integration approval

---

## Phase 5: Calendar & Meetings ⏳

**Objective:** Integrate calendar and enable meeting booking

**Estimated Duration:** 3 weeks

**Deliverables:**
- Calendar account integration (Google, Outlook)
- Meeting creation capability
- Availability checking and scheduling
- Meeting reminders
- RSVP tracking and response detection
- Meeting outcome recording
- Goal progress update from meetings

**Acceptance Criteria:**
- Calendar events can be created
- Availability is checked before booking
- RSVPs are tracked
- Meeting outcomes update lead status
- Goal progress reflects meetings booked

**Dependencies:** Phase 4 complete

---

## Phase 6: Daily Brief & Analytics ⏳

**Objective:** Build proactive daily briefing and outcome measurement

**Estimated Duration:** 3 weeks

**Deliverables:**
- Daily Brief generation (email/in-app)
- Goal progress dashboard
- Opportunity dashboard (hot leads)
- Revenue tracking (pipeline, won, lost)
- REV activity summary
- Approval Centre statistics
- Performance metrics

**Acceptance Criteria:**
- Daily Brief generated each morning
- Dashboards reflect real-time data
- Revenue tracking works
- Goal progress visualized
- Metrics exported for analysis

**Dependencies:** Phase 5 complete

---

## Phase 7: Website Lead Agent ⏳

**Objective:** Build chatbot for Revive Websites that feeds leads into REV

**Estimated Duration:** 2 weeks

**Deliverables:**
- Chatbot integration on Revive Websites
- Lead qualification questions
- Lead capture into REV workspace
- Warm handoff workflow
- Notification to business owner

**Acceptance Criteria:**
- Chatbot appears on Revive Websites
- Captures visitor information
- Creates lead in REV automatically
- Business owner notified

**Dependencies:** Phase 6 complete

---

## Phase 8: Voice & Missed Calls ⏳

**Objective:** Add phone system integration and missed-call recovery

**Estimated Duration:** 3 weeks

**Deliverables:**
- Phone system integration
- Incoming call detection
- Call transcription (basic)
- Missed call capture as lead
- Automatic callback follow-up
- Call history tracking

**Acceptance Criteria:**
- Missed calls detected and logged
- Automatic follow-up triggered
- Call transcripts stored
- Lead created from missed call

**Dependencies:** Phase 7 complete

---

## Phase 9: Marketing Expansion ⏳

**Objective:** Add social media, reviews, and customer reactivation

**Estimated Duration:** 4 weeks

**Deliverables:**
- Social media content scheduling
- Review collection workflow
- Review management dashboard
- Customer reactivation campaigns
- Campaign templates
- Performance tracking

**Acceptance Criteria:**
- Content can be scheduled to social
- Reviews can be collected and displayed
- Reactivation campaigns can be created
- Campaign performance tracked

**Dependencies:** Phase 8 complete

---

## Phase 10: Website Generator (REV Skill) ⏳

**Objective:** Build AI website generator as a REV capability

**Estimated Duration:** 4 weeks

**Deliverables:**
- Website template system
- AI page generation (using Business Brain)
- Template customization UI
- Preview and editing
- Publishing workflow
- Domain management (future)

**Acceptance Criteria:**
- Pages can be generated using Business Brain
- Templates are customizable
- Pages can be previewed and edited
- Pages can be published

**Dependencies:** Phase 9 complete

---

## Phase 11: Advanced Autonomy ⏳

**Objective:** Enable autonomy levels 2-4

**Estimated Duration:** Ongoing

**Deliverables:**
- Pre-approved action templates
- Rule-based auto-execution
- Escalation workflows
- Advanced goal optimization
- Autonomous campaign management

**Acceptance Criteria:**
- Level 2: Pre-approved templates skip approval
- Level 3: Rules-based execution with escalation
- Level 4: Goal-optimizing autonomy
- All actions logged and auditable

**Dependencies:** Phase 10 complete (optional)

---

## Phase 12: Industry Playbooks ⏳

**Objective:** Add industry-specific playbooks (Trades, Property, Beauty, etc.)

**Estimated Duration:** Ongoing

**Deliverables:**
- REV Trades (plumbing, electrical, HVAC)
- REV Property (real estate)
- REV Beauty (salons, spas)
- REV Automotive (car dealers)
- REV Professional Services (consulting, law)
- Playbook selection on signup
- Industry-specific workflows
- Compliance rules per industry

**Acceptance Criteria:**
- Playbooks available at signup
- Workflows match industry needs
- Compliance rules enforced
- Industry-specific KPIs tracked

**Dependencies:** Phase 10 complete (optional)

---

## Phase 13: API & Integrations ⏳

**Objective:** Build public API and third-party integrations

**Estimated Duration:** Ongoing

**Deliverables:**
- Public REST API
- OAuth2 for partner apps
- Webhook support
- Integration marketplace
- Partner documentation

**Acceptance Criteria:**
- API fully documented
- Partners can integrate
- Webhooks working
- Rate limits enforced

**Dependencies:** Phase 10 complete (optional)

---

## Critical Path

```
Phase 0 ✅
   ↓
Phase 1 🔄
   ↓
Phase 2 ⏳ (App Foundation)
   ↓
Phase 3 ⏳ (Leads & Outreach)
   ↓
Phase 4 ⏳ (Email)
   ↓
Phase 5 ⏳ (Calendar)
   ↓
Phase 6 ⏳ (Daily Brief)
   ↓
Phase 7 ⏳ (Website Lead Agent)
   ├─→ Phase 8 ⏳ (Voice) — Optional, can run in parallel
   ├─→ Phase 9 ⏳ (Marketing) — Optional, can run in parallel
   └─→ Phase 10+ ⏳ (Advanced features)
```

## Phase Dependencies

```
Required Sequential Path:
0 → 1 → 2 → 3 → 4 → 5 → 6

Optional Parallel Work (after Phase 6):
6 ↓
├─→ 7 (Website Lead Agent)
├─→ 8 (Voice)
├─→ 9 (Marketing)
├─→ 10 (Website Generator)
├─→ 11 (Advanced Autonomy)
├─→ 12 (Industry Playbooks)
└─→ 13 (API & Integrations)
```

## Phase Gating

Each phase is gated by:
1. Previous phase complete and approved
2. All deliverables accepted
3. All acceptance criteria met
4. All risks identified and mitigated
5. Handover documentation complete

**No phase may begin until the prior phase is officially closed.**

---

## Current Blockers
None — Phase 1 is proceeding on schedule.

## Outstanding Risks
- Multi-tenant isolation complexity (mitigation: exhaustive testing)
- Prompt injection attacks (mitigation: safe prompt design)
- Email provider integration challenges (mitigation: using established provider)
- Approval Centre workflow complexity (mitigation: starting simple, adding features incrementally)

See RISKS_AND_BLOCKERS.md for full risk register.
