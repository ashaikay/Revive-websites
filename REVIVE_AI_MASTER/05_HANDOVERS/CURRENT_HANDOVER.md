# Current Handover — Customer Outlook Verified (2026-10-09)

## Controlled booking and invitation receipt (user-verified, 2026-10-09)

- “REV customer Outlook booking test” was created in `info@revivementors.com` → Calendar for 13:30–14:00 Europe/London.
- Action: `bce04db3-73c4-49e4-8f29-c74cf49a9fd0`; execution: `88f82d82-91b3-420a-bb58-b0b0c55e4314`.
- REV recorded success and provider acceptance; the user opened the event. The invitation was found in `mike.blackwood11@gmail.com` Spam, received at 02:58.
- This verifies event creation and recipient receipt for this controlled test only. Do not generalize invitation delivery to other meetings.
- The live provider gate is disabled now. No further provider action is authorized by this checkpoint.

The REV layout tidy-up is implemented locally: compact expandable email previews; distinct Outlook connection, availability, proposal and execution-result sections; concise instructions; focused feedback beside meeting actions; and five-second dismissal for routine approval feedback. Durable execution results, errors and uncertain-outcome guidance remain. Booking and retry safeguards were not changed. The mounted regression is registered in `.github/workflows/rev-meeting-verify.yml`.

**Local verification:** Six focused UI suites passed (77/77 tests), including the new mounted regressions. `npm run build` passed; Vite emitted its existing advisory that the generated JavaScript chunk exceeds 500 kB. `git diff --check` passed. No provider call, booking, resend, gate change, hosted change, deployment or commit was made.

**Latest manual check (user-reported):** The new customer Outlook account completed discovery and calendar selection. Availability returned slots for 9 October 2026. Meeting proposal “orbis” was approved but not booked; no event was created. Commit `abf597a` (“Use workspace timezone for calendar availability default date”) is recorded, and CI was reported green.

The earlier additional-account credential-load and empty-availability blockers are resolved for this manual check. Their exact underlying causes were not all proven; do not claim otherwise. The workspace-timezone date fix addresses a demonstrated local-date boundary defect but does not prove that it caused every earlier empty result or credential-load failure.

**Safety/release state:** Live calendar booking remains disabled. “Approved but not booked” is not permission to create an event. Continue customer Outlook verification, then the remaining Phase 5 calendar MVP roadmap, preserving the feature scope freeze and CI release gates. Worker job-brief uploads and assignment emails remain planned, not implemented: private manager-uploaded briefs; recipient email separate from REV login; confirmed-assignment details and a secure brief link using a separately authorized organization sending account; duplicate-send protection; sent/failed/not-sent status; and assignment-change/cancellation updates. Calendar-read consent does not grant email-sending authority.

## REV layout tidy-up — implemented locally (2026-10-09)

- Email conversation cards show compact previews with an accessible disclosure for full messages.
- Outlook connection, availability, meeting proposals and execution results are visually distinct and grouped in workflow order.
- Meeting actions have concise, business-facing instructions and immediate progress labels.
- Approval feedback is focused beside the proposal and clears after five seconds; errors, uncertain outcomes and durable execution results remain visible.
- Transport, malformed-response and definite pre-execution refusal outcomes are distinguished without exposing raw Edge Function errors. Uncertain live outcomes direct the user to check Outlook and do not offer another booking action.
- The mounted regression is registered in `.github/workflows/rev-meeting-verify.yml`.

No booking behavior or server safeguard was changed. Live booking remains disabled; this UI change does not authorize provider calls, hosted migration or deployment.

## Selected Outlook calendar binding — local slice (2026-10-09)

The current uncommitted implementation snapshots the workspace-selected calendar, account/connection, credential revision, write-consent version and workspace binding into the durable meeting reservation. Exact retries must retain that identity and refuse changed selection; provider-attempt guards recheck selection and consent. Trusted Graph request mapping targets the selected calendar rather than the mailbox default. The additive migration is local only and has not been applied to a hosted database.

CI registration was verified and completed for all affected regressions: `verify-rev-meeting.mjs` runs the changed server boundary and provider-composition tests; the database job runs `phase6f_local_provider_lifecycle.mjs` and now also `phase6c_local_graph_adapter_validation.mjs` after migrations; the customer-calendar UI test command now includes `phase5n_microsoftGraphCalendarEvent.test.ts`. Local database scripts were not run because local Supabase and local test keys were unavailable. No live provider calls, hosted changes, deployment, commit or push.

The follow-on local delegated-token slice adds `20261009040000_rev_meeting_delegated_token.sql` and a server-only token supplier. It resolves the refresh credential only through the reserved execution target, revalidates the selected calendar, active write consent, credential scope/revision and workspace binding, then uses the existing OAuth refresh exchange and Vault-backed CAS rotation. Rotation advances the revision for matching eligible prepared reservations only, preserving their calendar identity and leaving terminal or differently bound reservations unchanged. Mocked token-exchange tests are registered through `verify-rev-meeting.mjs` and the existing calendar-discovery test path. The focused database validator `phase6g_local_delegated_token_validation.mjs` is registered after migration startup in the pending database CI workflow and covers credential load/rotation, stale revisions, revoked consent, changed selection, cross-workspace reservation denial, duplicate attempts, and prepared-versus-terminal revision updates.

**Verification checkpoint (2026-10-09):** GitHub Actions run #107 (`8380102`) passed both meeting and database jobs. Its committed workflow predates the delegated-token database validator and did not run `phase6g`; therefore it is evidence for the selected-calendar work at that commit, not for the new SQL validator. The pending workflow change includes `phase6g` after Supabase startup/migrations. Locally, `node scripts/verify-rev-meeting.mjs` passed all 50 server-boundary tests and the TypeScript/Vite build, including the mocked delegated-token supplier tests. The local Supabase endpoint and test keys were unavailable, so the `phase6g` database assertions have not been run locally or verified by run #107. Migration `20261009040000` remains unapplied to hosted databases. Live booking remains disabled; no live provider calls, hosted changes, deployment or commit were made.

The detailed 2026-10-08 checkpoint below is historical and superseded by this manual verification for blocker status. Historical diagnostic uncertainty remains; do not reinterpret earlier failures as having a proven common cause.

# Previous Handover — Customer Outlook Verification (2026-10-08)

**Current roadmap:** Worker Scheduling is implemented as a separate domain. The verified scope includes assignment/cancellation and planner refresh, Annual Leave management and official UK bank-holiday importing, and `all` / `any` skill matching. Continue customer-managed Outlook verification first, then the remaining Phase 5 calendar MVP roadmap. The Phase 5L scope freeze and CI release gates remain in force: no event-creation permission, booking, provider execution, or release without its separate authorization and gates.

## Completed and evidenced

- Scheduling assignment and cancellation behavior, planner updates, Annual Leave and official UK bank-holiday import have focused local/CI verification. The all/any skill-matching change is recorded as deployed and manually verified in `REVIVE_AI_MASTER/CHANGELOG.md` (2026-10-08).
- Relevant Scheduling commits include `2fdf40a` (all/any skill matching), `cfb638a` (Scheduling UI tidy-up and verified skill modes), and `ba89c50` (official UK bank-holiday import). The holiday-import work is local implementation; no hosted deployment is recorded for it.
- Customer Outlook workspace-isolation and additional-account UI checks passed CI for commits `34e15e2` and `3a9324b`. The local app uses `http://localhost:5180` to match the OAuth callback origin.
- Related committed Outlook work includes `fbb896c` (local origin handling), `cd4223d` (sanitized discovery-stage diagnostics), and `156e1b9` (fixed database refusal categories).
- Existing hosted customer-calendar connection/OAuth/discovery/selection/availability work is recorded in the 2026-09-30 Outlook checkpoint in `PROJECT_STATUS.md`. That evidence predates the current additional-account and duplicate-account UX work; it does not establish those newer changes as deployed.

## Current blocker — credential load remains unresolved

The latest reported discovery ended at `credential_load_failed` after the user confirmed “Outlook authorization saved” for a different account. The cause is **unproven**. Do not attribute this to user error, infer that credentials were persisted, or treat the UI confirmation as proof that discovery can load the saved credential.

Pause further sign-ins. A mocked mounted authorize → callback save → return/remount → discover regression now proves the frontend does not automatically invoke reconnect or cleanup between save and discovery. This rules out that particular automatic frontend action in the tested flow; it does not prove what happened in the hosted credential save/read path or explain the reported failure.

An earlier same-account attempt reached database save and encountered a constraint. That is a separate issue from the different-account `credential_load_failed`.

## Duplicate-account UX — locally tested, not released

The separate duplicate-account UX recognizes only the exact known provider-account uniqueness constraint. It shows the fixed message “This Outlook account is already connected. Use the existing connection.” and offers confirmed removal of only the unfinished connection through existing scoped cleanup authority. A mounted regression verifies the other connected account and selected calendar remain unchanged.

This UX and its related diagnostics are **tested locally but uncommitted and undeployed**. Do not present them as hosted behavior or treat the duplicate-account case as the proven cause of the current credential-load failure.

Local checks for the current uncommitted changes: mounted Outlook panel tests 11/11; related Node browser tests 20/20; discovery boundary tests 7/7; Deno entry-point check; TypeScript/Vite production build; and `git diff --check`. The build passed with Vite's existing large-chunk advisory. No hosted calls, migrations, deployment, commit, or push were performed for this local work.

## Exact next investigation step (read-only)

With sign-ins paused, obtain the latest failed discovery's request ID/time and its workspace/connection IDs from safe existing logs. Correlate the fixed `credential_load_failed` stage with the OAuth completion for that **same** workspace and connection. Using read-only metadata only, verify whether completion returned a persisted credential reference/revision and whether a credential row exists for the exact workspace/connection and expected revision; then compare those identifiers and guards with `load_rev_pending_calendar_credential` and the discovery RPC call. Report the first mismatch or state that no mismatch was found.

Do not retrieve secret contents, start or replay OAuth, invoke a provider, retry discovery, reconnect, disconnect, clear browser recovery state, modify hosted data, or deploy. If safe hosted logs/metadata are unavailable, stop and report precisely which evidence is missing. Unresolved questions are whether completion persisted credentials for the new connection, whether discovery queried the same tenant-scoped connection/revision, and whether the hosted SQL/function definition differs from the repository version.

## Planned, not implemented

Private manager-uploaded job briefs and worker assignment emails remain planned only. Each worker's recipient email must be separate from REV login identity; confirmed assignments may send shift details and a secure brief link through a separately authorized organization sending account. The future capability must prevent duplicate sends, retain `sent` / `failed` / `not_sent` status, and handle assignment changes and cancellations. Calendar-read consent is not email-sending authority. No upload, worker-recipient, brief-delivery or assignment-email execution capability is implemented or authorized.

---

# Phase 2D.2 / 2D.2A handover \u2014 CLOSED (PASS)

## Phase 3E.3A handover - CLOSED (PASS; remote untouched)

## Phase 3E.3 handover - CLOSED (PASS)

The reviewed migration `20260914000000_rev_opportunities_proposal.sql` was applied to `Revive Websites` / `ntbowgutwyyhhnmkadlv` using pinned CLI `npx --yes supabase@2.117.0`. Credential-safe pre/post backups are retained in `REVIVE_AI_MASTER/backups/`.

Catalogue, ACL, RLS, production attack matrix, application regression, suppression, REV-action, and legacy quote/Telegram checks passed. Eight test opportunity rows remain clearly marked `TEST FIXTURE`, dormant, zero-value, and unattributed. The canonical live Supabase-mode app reached its login boundary at `http://127.0.0.1:5180/`. Do not connect discovery, AI execution, or outbound providers; the next step requires a separate integration review.

CLI `2.75.0` rejected `[experimental.pgdelta]` and `[local_smtp]`; the original config remains unchanged and is backed up at `REVIVE_AI_MASTER/backups/phase_3e_3a_config.toml.20260914.bak`. Use project-scoped `npx supabase@2.117.0` for future Supabase CLI inspection from the workspace root.

Existing metadata confirms `Revive Websites` / `ntbowgutwyyhhnmkadlv`. Read-only history confirms `20260912162730` and `20260912170332` are applied and only `20260914000000_rev_opportunities_proposal.sql` is pending. No relink, migration, SQL, schema, RLS, or remote history operation was performed. `npm test` passed 58/58 and `npm run build` passed. Resume Phase 3E.3 only for its separate controlled deployment procedure.

The initial Supabase integration slice is implemented behind an opt-in provider mode. Use `VITE_REV_PROVIDER_MODE=mock` for the existing application behavior. Supabase mode requires local `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values and currently supports authenticated session initialization, active workspace context, workspace switching, and read-only Business Brain/profile/services reads.

Do not enable live writes or connect the remaining operational modules. No privileged browser credential is used, no migration was created, and the frontend remains mock mode by default. See `REVIVE_AI_MASTER/PHASE_2D_2_INTEGRATION_REPORT.md`.

**Phase 2D.2A (2026-09-13) is complete and PASS.** The Supabase-mode login/sign-out UI was validated live in the shared `http://127.0.0.1:5180/` browser page for Users A, B, and C:

- User A: PASS (prior session).
- User B (`natalie_atkins2000@yahoo.co.uk`): backend Auth account verified healthy, then a controlled temporary password reset was performed once through the trusted admin path only (locally generated, never printed/committed). Live login showed only `REV RLS Workspace B`, the expected empty Business Profile, only Workspace-B-tagged services, no foreign tenant data, and a clean logout.
- User C (`wellnessatworkforyou@gmail.com`): backend Auth account verified healthy with zero authorised workspace memberships, then the same controlled reset process. Live login showed the safe "no authorised workspace" outsider state, no Workspace A/B data, and a clean logout.
- Cross-user relogin isolation and stale-workspace rejection (no client-side workspace/session persistence) both PASS.
- No RLS, policy, schema, membership, or migration change was made; legacy `public.quotes` and Telegram were untouched.
- Non-blocking tracked follow-up: `POST /auth/v1/logout?scope=global` repeatedly reports `net::ERR_ABORTED` in the browser console. Session/tenant state clearing was unaffected each time; no code was changed to silence it. See `RISKS_AND_BLOCKERS.md`.

# Current Handover — Phase 4G.1 Provider-Independent Email Execution Gateway Foundation Complete

**Date:** 2026-09-16
**Completed checkpoint:** Phase 4G.1 Provider-Independent Email Execution Gateway Foundation
**Current Phase:** Phase 4G.1 complete; REV cannot send email
**Status:** Focused and adjacent execution tests 67/67 PASS; production build PASS

Phase 4G.1 defines provider-neutral `EmailExecutionRequest`, `EmailExecutionResult`, `EmailExecutionService`, and `EmailProvider` contracts. A future trusted server implementation of `EmailExecutionAuthority` must revalidate and durably reserve active owner/admin authority, the exact tenant/action, current action version and approved fingerprint, exact approved recipient/subject/body, safety, jurisdiction, workspace policy, Cost Governor, and approved-action-version idempotency.

The design reuses Phase 4C `rev_action_executions`, approvals, fingerprints, request/correlation/idempotency architecture, provider usage, audit, and backend-only outcomes. It does not claim frontend or process-local idempotency is sufficient. The Phase 4C RPC has not been wired into an endpoint in this phase.

`SEND_APPROVED_EMAIL` and platform execution are disabled. `EmailExecutionService` stops before its optional provider and returns `DRY RUN — NOTHING SENT`; provider calls, emails, usage, cost, and external effects remain zero. No UI wiring, `SEND` control, adapter, credentials, database/Supabase, public quote/Telegram, legacy-family, marketing-site, or unrelated change occurred.

**Phase 4G.2 blockers:** separately authorize and security-review a trusted server endpoint/authority implementation, deterministic Phase 4C reservation integration, server-only provider credential storage, a selected provider adapter with provider idempotency/ambiguous-outcome handling, and backend-only outcome/usage recording. Sending remains prohibited until all are implemented and validated.

## Previous Handover — Phase 4F Controlled Execution Request Foundation Complete

Phase 4F added an owner/admin-only mock dry-run request over the trusted boundary, ending at `DRY RUN — NOTHING SENT`. Its focused Phase 4B/4D/4F validation remains 39/39 PASS with build PASS; live Supabase mode has no execution-request control.

## Previous Handover — Phase 4E Live Prepared-Work Repository Integration Complete

Phase 4E connected the existing Phase 4D prepared follow-up artifact to authenticated workspace-scoped Supabase repositories and proved persistence, reload, tenant isolation, role authority, stale-review rejection, idempotency, and persisted `APPROVED — NOT SENT` against isolated local PostgREST/RLS. Its completed validation remains 14/14 focused, 1/1 real-local proof, 177/177 full tests, build PASS, audit 0 vulnerabilities, and desktop/mobile PASS.

## Previous Handover — Phase 4D Prepare Follow-Up Complete

**Date:** 2026-09-14
**Completed checkpoint:** Phase 4D First Real REV Capability — Prepare Follow-Up
**Current Phase:** Phase 4D complete; sending and provider activation are not authorized
**Status:** Focused tests 15/15 PASS; full tests 163/163 PASS; build PASS; `npm audit` 0 vulnerabilities; desktop/mobile browser PASS

Phase 4D adds an internal, deterministic prepared follow-up artifact over existing workspace recovery evidence and Business Brain context. It reuses REV Actions, Approvals, Business Memory, approval fingerprints, and execution policy rather than adding a parallel workflow or schema.

The mock REV workspace now lists supported recovery opportunities and can prepare an editable draft for owner/admin review. The review surface shows the recovery reason, objective, suggested channel, evidence, missing information, and EDIT / APPROVE / REJECT controls. Approval produces `APPROVED — NOT SENT`; action execution remains `not_executed`.

No migration or production deployment was performed. No provider was invoked, no communication was sent, cost remained £0, and the platform execution kill switch remains false. Legacy quotes, Telegram, the marketing site, and `rev-business-verify` were unchanged.

**Next authorization boundary:** Any email/SMS/provider integration, outbound delivery, Send/Execute control, or live persistence extension requires a separate approved phase.

## Previous Handover — Phase 4C Production Migration Applied + Verified

**Date:** 2026-09-14  
**Completed checkpoint:** Phase 4C Execution Control Plane production migration
**Current Phase:** Phase 4C complete; first real capability not authorized
**Status:** Production verification 25/25 PASS; local attacks 42/42; 148/148 full tests; build PASS; `npm audit` 0 vulnerabilities

The additive migration is `revive-app/supabase/migrations/20260914183000_rev_execution_control_plane.sql`; its guarded companion is `REVIVE_AI_MASTER/rollback/20260914183000_rev_execution_control_plane_rollback.sql`. The detailed evidence is in `REVIVE_AI_MASTER/PHASE_4C_LOCAL_REHEARSAL_REPORT.md`.

The migration adds disabled-by-default workspace execution policy, action-version/fingerprint approval binding, durable dry-run attempts, provider-usage evidence, idempotency locking, role-specific RLS, exact ACLs, and trusted RPCs. It was applied once to `Revive Websites` / `ntbowgutwyyhhnmkadlv` and verified with a transaction-rolled-back production matrix.

Execution remains disabled with no Execute control and no provider invocation. Public quotes and Telegram remained unchanged. Do not activate a first capability, provider, external communication, or payment action without separate explicit authorization. Do not use destructive rollback after evidence exists; disable and forward-fix.

Phase 4B adds a local trusted boundary that accepts minimal identifiers, resolves authenticated workspace authority and all policy inputs internally, binds approvals to deterministic action fingerprints, validates transition state, and returns only a disabled dry-run envelope. In-memory idempotency is explicitly non-durable and no provider is invoked.

Execution remains disabled with no Execute control. No migration, RLS change, Supabase deployment/write, provider call, external communication, financial action, legacy quote/Telegram, or `rev-business-verify` change occurred. Phase 4C requires separate approval for durable execution/idempotency/approval/audit controls and role-restricted database writes.

HOME now uses a dedicated workspace-scoped read model for TODAY, REV work, approvals, derived READY/BLOCKED status, Money REV Found, recent results, cost/usage availability, and system status. Mock mode uses deterministic repository fixtures; live mode exposes truthful unavailable states and never falls back to mock data. REV remains the detailed work/approval surface and GROWTH remains the detailed commercial surface.

Execution remains disabled with the platform execution kill switch set to false and no Execute control. Approval remains supervised; approved actions remain `APPROVED — NOT EXECUTED`. No database, RLS, Supabase, provider, production, legacy quote/Telegram, or `rev-business-verify` change occurred. Phase 4B and Phase 4C require separate explicit approval.

Phase 3H adds `RecoveryCandidate`, `RecoveryAnalysis`, and `analyzeRecovery()`. It derives supported recovery signals from existing workspace-owned Contacts and Opportunities, surfaces potential recoverable value in GROWTH, leaves missing values unknown, and marks quote/invoice/renewal/repeat-service concepts unsupported. It does not use legacy quotes, create records, attribute revenue, write memory, call providers, or send communication.

Phase 3G.2 adds capability definitions, deterministic execution policy, audit-ready execution context, autonomy defaults, platform/capability disable controls, cost/risk/audience/jurisdiction gates, and dry-run plans. REV displays readiness but never shows an Execute control. Approval remains distinct from execution and revenue. No provider or external action is connected.

Phase 3G.1 adds `CommercialActionService` and the GROWTH `Review Action` handoff into the existing REV Action/Approval architecture. Proposals preserve route, goal, rationale, evidence reference, potential value, confidence, and approval requirement. Approval produces `APPROVED — NOT EXECUTED`; rejection has no commercial side effect. No outbound work, provider call, revenue, attribution, or persistence schema change occurs.

Phase 3G adds `CommercialSignal`, `CommercialHypothesis`, `AudienceHypothesis`, `CommercialRecommendation`, and `CommercialPlan` plus `buildCommercialPlan()`. REV now ranks FIND, AUDIENCE, and RECOVER routes from existing workspace-scoped evidence. Recovery is based on existing stale/dormant/former-customer records; audience hypotheses are generic and safety-gated. No recommendation creates an action or executes work. Potential value and Money REV Found remain separate from Won Revenue.

Phase 3F.2C deployed the independent `rev-business-verify` Edge Function with JWT validation and active workspace authorization. Six initial GB requests returned HTTP 400; the defect was corrected by trimming the server key and encoding `API_KEY:` through a tested GET/no-body request builder. Exactly one permitted real profile retest returned `VERIFIED / EXACT` for company `00000006`. Non-GB, anonymous, and cross-workspace checks passed. Total real provider calls: 7; spend remained £0. No commercial side effect occurred.

Phase 3F.2B adds `BusinessPresenceRecord`, deterministic verification/match states, typed entity handling, provenance, and `MockCompaniesHouseVerificationProvider`. Companies House is explicitly verification evidence only. `NOT_FOUND` never implies a fake business or sole trader, and no entity type is guessed. No external call or persistence change occurred.

Phase 3F.2A report: `REVIVE_AI_MASTER/01_ARCHITECTURE/PHASE_3F_2A_UK_DISCOVERY_PROVIDER_COMPARISON.md`. Do not pay the DataForSEO `$50` minimum. The preferred direction is a hybrid: a legally cleared POI discovery source for candidates, optional Companies House verification for incorporated UK businesses, then REV normalization and explicit qualification. Google Places is not persistence-safe for copied business records under current Maps terms; Outscraper is the cheapest discovery test but needs written retention/licensing confirmation.

Phase 3F.2 reviewed the official DataForSEO Business Listings API and prepared the server-only adapter at `revive-app/src/server/dataForSeoBusinessDiscoveryProvider.ts`. Do not import it into React or configure credentials in `VITE_*`. No DataForSEO account funding or API request has occurred. Before resuming, configure generated API login/password directly in a trusted server environment, set a development ceiling at or below `£10`, approve provider retention/licensing, and deploy an authenticated handler with workspace/global cost checks, idempotency, and rate limiting.

---

## Exact Point Development Reached

Phase 2B is complete. Phase 2C and Phase 2D.0 confirmed the existing `Revive Websites` Supabase project is active, linked only to `ntbowgutwyyhhnmkadlv`, and contains the protected `public.quotes` production workflow. A credential-safe public schema backup, quote baseline, reconciliation report, and rollback plan are complete. The local `revive-app/` remains mock-only.

**Stop condition:** Do not apply migrations, enable real authentication, connect live AI, send email, perform prospect research, run autonomous agents, use Stripe, voice, social, or production deployment. Complete SQL-level inventory and obtain explicit Phase 2D approval first.

**Local URL:** `http://127.0.0.1:5180/`

**Validation:** `npm test`, `npm run build`, `npm audit` (0 vulnerabilities), browser navigation/workspace checks.

**Phase 2C/2D.0 documents:** `SUPABASE_EXISTING_STATE.md`, `QUOTES_PROTECTION_BASELINE.md`, `PHASE_2D_RECONCILIATION.md`, `PHASE_2D_ROLLBACK_PLAN.md`, and `backups/pre_phase_2d/`.

**Phase 2D.0.1 documents:** `REV_GLOBAL_ACCESS_SECURITY_MODEL.md`; the rollback artifact is now `REVIVE_AI_MASTER/rollback/0001_rev_core_rollback.sql`. The forward migration remains local-only and has hardened security-definer/audit policies.

**Phase 2D.0.2 documents:** `WORKSPACE_BOOTSTRAP_SECURITY.md` and `PHASE_2D_1_RUNBOOK.md`. The bootstrap RPC is implemented in the local forward migration only; no remote migration, Auth change, test identity, or workspace was created.

**Phase 2D.1 status:** Stopped at preflight. Remote history reports `0001 | 0001`, while fresh public-schema evidence classifies the state as **HISTORY ONLY**. Fresh checkpoint: `backups/pre_phase_2d_1/`. Do not run `db push` or repair migration history without explicit review. See `PHASE_2D_1A_MIGRATION_RECONCILIATION.md`.

**Phase 2D.1B status:** Local migration renumbering is complete. Use `revive-app/supabase/migrations/20260912162730_rev_core.sql` and `REVIVE_AI_MASTER/rollback/20260912162730_rev_core_rollback.sql` for future review. Neither has been deployed or executed.

**Phase 2D.1C status:** The migration was applied, but verification stopped after discovering live `anon` execution grants on all three SECURITY DEFINER helpers. No Auth users/workspaces or RLS tests were created. Treat the project as blocked pending ACL remediation review.

**Phase 2D.1C.1 status:** Applied `20260912170332_rev_function_acl_hardening.sql`. Live ACLs now show `PUBLIC=NO`, `anon=NO`, `authenticated=YES` for all three helpers. No Auth users/workspaces or RLS tests have been created/run.

**Phase 2D.1D status:** Blocked before identity creation. Available Auth-admin API returned HTTP 401; see `PHASE_2D_1D_LIVE_RLS_TEST_REPORT.md`. No synthetic users, workspaces, or tenant data were created.

The resumed attempt received three synthetic UUIDs but could not establish user JWT sessions without credentials or OTP access. No test operation was run.

The expected password environment variables are absent in the current terminal environment. Resume only when those variables are securely present to the process; never place their values in chat, files, logs, or documentation.

**Telegram security stop:** The deployed function requires JWT verification (`verify_jwt: true`). Its source uses only Telegram secrets, but the exact database trigger and legacy service-role dependency could not be inspected without Docker or the database password. No Telegram trigger change was made.

---

## Phase 1 Architecture Context

**Phase 1 is now COMPLETE.**

The strategic product pivot from AI website-builder to REV (goal-driven AI employee) has been fully designed and documented. All architectural decisions have been made, all risks identified and mitigated, and all security requirements specified.

### What Changed from Phase 0
- Product completely repositioned (website builder → AI employee)
- Architecture redesigned (single-business → multi-tenant)
- 13 new phases defined (was 14, now with different focus)
- 15 strategic/architectural decisions recorded
- 15 risks identified with mitigation plans
- Comprehensive security architecture designed
- Technology stack selected
- Implementation sequence planned

### What Did NOT Change
- ✅ Revive Websites marketing site: PROTECTED and UNCHANGED
- ✅ Existing files and repository structure: INTACT
- ✅ Git history and branches: UNTOUCHED
- ✅ No code written, no infrastructure provisioned

---

## Last Successful Task Completed

### Task 1: Strategic Vision Documented
- ✅ MASTER_BUILDER.md written (comprehensive product vision)
- ✅ New product direction clearly defined (REV AI employee)
- ✅ Repositioning strategy for website builder (REV skill)
- ✅ Industry playbooks architecture designed
- ✅ Internal test workspace strategy defined

### Task 2: Technical Architecture Designed
- ✅ SYSTEM_ARCHITECTURE.md written (550+ lines)
- ✅ Data model with multi-tenant isolation designed
- ✅ REV reasoning loop specified
- ✅ Action Engine architecture defined
- ✅ Approval Centre workflow designed
- ✅ Integration architecture (pluggable providers) planned
- ✅ Technology stack selected (React + Node + PostgreSQL + Claude)
- ✅ Deployment strategy documented

### Task 3: Project Planning Completed
- ✅ MASTER_ROADMAP.md updated (13 phases, new sequence)
- ✅ PHASE_TRACKER.md written (detailed per-phase deliverables)
- ✅ PROJECT_STATUS.md updated (Phase 1 status)
- ✅ Implementation sequence proposed (V0.1-V0.7+)

### Task 4: Decisions Recorded
- ✅ DECISION_LOG.md written (15 strategic decisions)
- ✅ Strategic pivot documented
- ✅ Architectural choices justified
- ✅ Trade-offs analyzed
- ✅ Alternatives considered for each decision

### Task 5: Security Architected
- ✅ SECURITY_REGISTER.md written (400+ lines)
- ✅ Multi-tenant isolation strategy (RLS at database layer)
- ✅ Authentication & authorization model
- ✅ Secrets management strategy
- ✅ Prompt injection defense designed
- ✅ Approval gate for safety (Level 1 autonomy)
- ✅ Compliance requirements identified (GDPR, CAN-SPAM)
- ✅ Audit logging strategy
- ✅ Threat model and response plans

### Task 6: Risks Identified
- ✅ RISKS_AND_BLOCKERS.md written (350+ lines)
- ✅ 15 risks identified with mitigations
- ✅ No active blockers found
- ✅ Phase gates defined
- ✅ Contingency plans drafted
- ✅ Safety requirements specified

### Task 7: Documentation Updated
- ✅ CHANGELOG.md updated (Phase 1 summary)
- ✅ Repository current state documented
- ✅ Files modified list recorded

---

## Current System State

### Revive Websites (Public Marketing Site)
- Status: ✅ OPERATIONAL and PROTECTED
- Files: Unchanged from baseline
- Deployment: Netlify (static)
- Content: HTML/CSS/JavaScript marketing website
- Functionality: Lead capture, pricing, testimonials, signup

### REV AI Platform (Private Customer App)
- Status: 🔄 DESIGNED, NOT YET BUILT
- Architecture: Multi-tenant workspace
- Data Model: Complete, awaiting implementation
- Security: RLS-based isolation (to be implemented)
- Technology: React + Node + PostgreSQL + Claude (selected)
- First Phase Target: Phase 2 (App Foundation)

### Project Control System
- Status: ✅ COMPLETE
- Master-Control Directory: REVIVE_AI_MASTER/
- Documentation: 10+ files, 3000+ lines
- Decision Log: 15 recorded decisions
- Risk Register: 15 identified risks, all with mitigations
- Phase Plan: 13 phases defined with dependencies

---

## Files Changed (Phase 1)

### Created/Significantly Rewritten
1. `REVIVE_AI_MASTER/00_MASTER/MASTER_BUILDER.md` — Strategic vision (NEW)
2. `REVIVE_AI_MASTER/01_ARCHITECTURE/SYSTEM_ARCHITECTURE.md` — Technical design (COMPLETE REWRITE)
3. `REVIVE_AI_MASTER/00_MASTER/MASTER_ROADMAP.md` — Phase sequence (MAJOR UPDATE)
4. `REVIVE_AI_MASTER/02_PHASES/PHASE_TRACKER.md` — Phase details (MAJOR UPDATE)
5. `REVIVE_AI_MASTER/00_MASTER/PROJECT_STATUS.md` — Current status (MAJOR UPDATE)
6. `REVIVE_AI_MASTER/03_DECISIONS/DECISION_LOG.md` — Decisions recorded (MAJOR UPDATE)
7. `REVIVE_AI_MASTER/06_SECURITY/SECURITY_REGISTER.md` — Security architecture (MAJOR UPDATE)
8. `REVIVE_AI_MASTER/RISKS_AND_BLOCKERS.md` — Risk register (MAJOR UPDATE)
9. `REVIVE_AI_MASTER/CHANGELOG.md` — Phase 1 recorded (UPDATED)

### Preserved (Unchanged)
- All files in `public/` (website assets)
- `src/` (website source code)
- `index.html`, `book.html`, `thankyou.html` (website pages)
- `config.js` (website config)
- `.git/` (version history)
- `README.md` (existing documentation)

---

## Outstanding Questions / Decision Points

These were deferred to Phase 2 or later:

1. **Email Provider Selection** — Which email service? (Gmail, Outlook, custom)
   - Deferred to: Phase 4 (Email & Replies)
   - Impact: Core feature, requires OAuth integration

2. **Supabase vs. Self-Managed PostgreSQL** — Which postgres deployment?
   - Decision: Use Supabase (managed, easier)
   - Status: To be activated in Phase 2

3. **Frontend UI Framework** — Shadcn/UI, Ant Design, or custom?
   - Decision: Shadcn/UI (accessible, component-based)
   - Status: To be decided in Phase 2

4. **LLM Rate Limiting** — Per-user, per-workspace, or global?
   - Decision: Per-workspace monthly quota
   - Status: To implement in Phase 2

5. **Initial Industry Playbook** — Which vertical to launch with?
   - Options: Trades, Property, Beauty, Automotive, Professional Services
   - Recommendation: Start with Trades (plumbing, HVAC, electrical)
   - Status: To decide based on customer demand

---

## Exact Next Action

### FOR APPROVAL:

**Stakeholders should review:**
1. MASTER_BUILDER.md — Strategic vision (does it align?)
2. SYSTEM_ARCHITECTURE.md — Technical design (is it sound?)
3. DECISION_LOG.md — Were decisions reasonable?
4. SECURITY_REGISTER.md — Are security requirements adequate?
5. RISKS_AND_BLOCKERS.md — Are risks identified and mitigated?

**Approval Gate Checklist:**
- [ ] Product vision reviewed and approved
- [ ] Architecture reviewed and approved
- [ ] Security requirements reviewed and approved
- [ ] Risk mitigation plans reviewed and approved
- [ ] Phase 2 scope understood and approved
- [ ] Implementation sequence approved
- [ ] Budget/timeline implications understood

### FOR PHASE 2 DEVELOPMENT:

**Phase 2 Scope (App Foundation):**
- Application shell (routing, layout, components)
- Authentication system (signup, login, password reset)
- Workspace creation and RBAC
- Business Brain initial schema and UI
- Goals module (create, read, update, delete, track)
- REV chat interface (basic conversational)
- Approval Centre UI (pending approvals, review interface)
- Business Memory foundation (data persistence)
- Dashboard home screen
- Deployment to staging environment

**Phase 2 Duration:** Estimated 4 weeks

**Phase 2 Handoff Requirements:**
- [ ] Phase 1 approved by stakeholders
- [ ] Development team onboarded (read MASTER_BUILDER.md, SYSTEM_ARCHITECTURE.md)
- [ ] Development environment set up (Node, PostgreSQL, React)
- [ ] Security requirements understood (RLS testing critical)
- [ ] Technology stack confirmed (React, Node, PostgreSQL, Claude)
- [ ] Initial project scaffolding created
- [ ] CI/CD pipeline configured
- [ ] Staging environment created (Supabase, Vercel, or similar)

---

## Commands Required to Resume Phase 2

```powershell
# Navigate to project root
cd "C:\Users\Mike\client-websites\projects\Revive-Websites"

# Check git status (should be clean)
git status

# View current architecture
cat REVIVE_AI_MASTER/00_MASTER/MASTER_BUILDER.md
cat REVIVE_AI_MASTER/01_ARCHITECTURE/SYSTEM_ARCHITECTURE.md

# Create Phase 2 branch
git checkout -b phase-2-app-foundation

# Verify no changes to public site
git diff index.html book.html thankyou.html

# Begin Phase 2 implementation (scaffold new project structure)
# mkdir -p revive-app/src/{api,components,pages,utils,types}
# npm init -y
# npm install react react-dom typescript @types/react
# ... etc
```

---

## Guidance for Resuming Phase 2

### Before Starting
1. **Read All Documentation** (2-3 hours)
   - MASTER_BUILDER.md (strategic vision)
   - SYSTEM_ARCHITECTURE.md (technical design)
   - DECISION_LOG.md (understand why decisions were made)

2. **Understand Key Concepts** (1 hour)
   - Multi-tenant architecture with RLS
   - Goals as first-class objects
   - Approval Centre for autonomy control
   - Business Brain as knowledge layer
   - Provider abstraction pattern

3. **Assess Infrastructure** (1 hour)
   - Supabase PostgreSQL account setup
   - Vercel or Netlify account for frontend
   - Claude API account for AI
   - Testing framework (Jest, React Testing Library)

### During Phase 2
1. **Security is Non-Negotiable**
   - Test RLS policies thoroughly (every PR)
   - Never trust frontend for auth or RBAC
   - Encrypt integration credentials
   - Audit log every significant action

2. **Follow Technology Stack Exactly**
   - React + TypeScript (frontend)
   - Node.js + TypeScript (backend)
   - PostgreSQL with RLS (database)
   - Claude API (AI reasoning)

3. **Test Multi-Tenant Isolation**
   - Unit test each RLS policy
   - Integration tests for cross-workspace rejection
   - Penetration tests for data leakage
   - Database audit for permission bypasses

4. **Record All Decisions**
   - Add to DECISION_LOG.md as you make choices
   - Document trade-offs
   - Note blockers and solutions
   - Keep stakeholders informed

### Testing Strategy
- Unit tests for business logic
- Integration tests for API endpoints
- RLS isolation tests (critical)
- Security tests (prompt injection, auth bypass)
- Performance tests (database queries)
- E2E tests for user workflows

### Documentation
- Keep README.md updated (setup instructions)
- Document API endpoints as built
- Create runbook for common tasks
- Update PHASE_TRACKER.md as features complete

---

## Known Risks Entering Phase 2

**Critical:** Multi-tenant RLS isolation
- Mitigation: Extensive testing framework
- Responsibility: QA Lead

**High:** AI reasoning quality
- Mitigation: Prompt engineering + approval gate
- Responsibility: AI Lead

**High:** Database performance
- Mitigation: Indexing strategy + monitoring
- Responsibility: Backend Lead

See RISKS_AND_BLOCKERS.md for full risk register.

---

## Known Issues to Address in Phase 2

1. **Generic Template Text on Public Site**
   - Action: Replace with final Revive branding
   - Timeline: Before Phase 7 production launch
   - Responsibility: Marketing

2. **Supabase Anon Key in Config**
   - Action: Keep as client-side config (never expose in docs/logs)
   - Timeline: Handled in Phase 2 security review
   - Responsibility: Security Lead

3. **No Automated Tests Yet**
   - Action: Build testing framework in Phase 2
   - Timeline: Before Phase 3
   - Responsibility: QA Lead

4. **No CI/CD Pipeline**
   - Action: Set up GitHub Actions in Phase 2
   - Timeline: Before Phase 2 complete
   - Responsibility: DevOps Lead

---

## Phase 1 Statistics

| Metric | Count |
| --- | --- |
| Strategic Decisions Made | 15 |
| Risks Identified | 15 |
| Active Blockers | 0 |
| Documents Created/Updated | 9 |
| Total Documentation Lines | 3000+ |
| Architecture Diagrams (text) | 5+ |
| Implementation Phases | 13 |
| Core MVP Modules | 13 |
| Code Written | 0 (architecture only) |

---

## Phase Gate Criteria

✅ **Phase 1 Complete When:**
- ✅ All architecture documents finished
- ✅ All decisions recorded
- ✅ All risks identified
- ✅ All security requirements specified
- ✅ Technology stack selected
- ✅ Implementation sequence agreed
- ✅ No code written (architecture only)
- ✅ Ready for stakeholder approval

⏳ **Phase 2 Can Begin When:**
- [ ] Phase 1 approved by stakeholders
- [ ] Funding/budget approved
- [ ] Development team assigned
- [ ] Infrastructure provisioned
- [ ] CI/CD pipeline configured
- [ ] Development environment ready

---

## Summary for Handoff

**To:** Phase 2 Development Team  
**From:** Phase 1 Architecture Team  
**Date:** 2026-09-12

**Status:** Complete and Ready  
**Quality:** High — All decisions justified, risks mitigated  
**Risk Level:** Medium (but manageable with mitigation plans)  
**Recommended Start:** After stakeholder approval  

**Key Files to Review (in order):**
1. MASTER_BUILDER.md (1 hour) — Strategic vision
2. SYSTEM_ARCHITECTURE.md (2 hours) — Technical design
3. SECURITY_REGISTER.md (1 hour) — Security requirements
4. PHASE_TRACKER.md (30 min) — Phase breakdown
5. DECISION_LOG.md (30 min) — Decisions + rationale
6. RISKS_AND_BLOCKERS.md (30 min) — Risks + mitigations

**Total Onboarding Time:** ~5-6 hours

**Critical Success Factors:**
- Understand multi-tenant architecture (RLS)
- Take security seriously (test isolation thoroughly)
- Follow technology stack (no substitutions without approval)
- Record decisions as made (maintain decision log)
- Test early and often (especially RLS policies)

**You are cleared to proceed when approved.** ✅
