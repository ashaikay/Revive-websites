## Verified Outlook integration checkpoint — 30 September 2026

This checkpoint supersedes the historical Phase 1 status and restrictions below where they describe work subsequently authorized and completed.

Phase 5 remains in progress.

Verified:
- Calendar regression tests and local database validators passed in GitHub CI at commit bbf05e5.
- Availability integration code committed at 123b2a8.
- Deno entry-point checks passed.
- Seven calendar migrations applied to the hosted Revive Websites project ntbowgutwyyhhnmkadlv.
- Connection creation, OAuth start/completion, discovery, selection, and availability functions deployed.
- Dedicated REV Calendar Connections app uses delegated Calendars.Read and offline_access.
- support@fatherslegacy.net authorization saved through the browser flow.
- Calendar discovery and selection persisted; the main Calendar is selected, Birthdays is not.
- Hosted selected-calendar availability excluded the existing 8 October 2026 event at 15:00–15:30 Europe/London.
- Browser verification used http://localhost:5180/#rev.

Safety state:
- Selected-calendar read-only availability is enabled.
- Live booking remains disabled: meeting provider database gate off, live activation secret removed, and live UI hidden by default.
- Calendar connection and availability testing created no new event or invitation.

Remaining work:
- Customer disconnect and reconnect controls.
- Per-workspace business-hours configuration.
- Google calendar integration.
- Customer-calendar booking integration requires separate implementation and controlled verification; the earlier application-permission booking pilot does not prove delegated customer-calendar booking.

---

# Phase 2D.2 / 2D.2A — Read-only Supabase integration and live browser validation COMPLETE (PASS)

- Added opt-in `mock`/`supabase` provider mode; mock remains the default.
- Added browser-safe Supabase client and auth session boundary using publishable credentials only.
- Added active-membership workspace context and invalid workspace selection rejection.
- Added read-only Business Brain/profile and service reads through the repository layer.
- No live writes, database migration, RLS/policy change, quote/Telegram change, or frontend default switch.
- See `REVIVE_AI_MASTER/PHASE_2D_2_INTEGRATION_REPORT.md`.
- Live browser validation for Users A, B, and C (2026-09-13) is complete and PASS: correct workspace isolation, correct/empty Business Profile and Business Services states, no cross-tenant data, and clean logout/session clearing for each identity. Two controlled temporary-password resets were performed for Users B and C through the trusted admin path only, to fix the synthetic Auth accounts; all tenant/isolation checks used each user's normal public-client session. No RLS, schema, membership, or migration change was made. A non-blocking `net::ERR_ABORTED` anomaly on the Supabase logout network request is tracked for later investigation; it does not affect session/tenant clearing.

# Project Status

## Phase 3E.3A — Supabase CLI/config compatibility repair COMPLETE (PASS; remote untouched)

## Phase 3E.3 — Controlled remote Opportunity migration COMPLETE (PASS)

- Applied only `20260914000000_rev_opportunities_proposal.sql` to `Revive Websites` / `ntbowgutwyyhhnmkadlv` using pinned CLI `npx --yes supabase@2.117.0`.
- Credential-safe pre/post schema and data backups are retained under `REVIVE_AI_MASTER/backups/`.
- Post-deployment catalogue, RLS, ACL, composite-FK, immutability, suspended-user, constraint, suppression, REV-action, outsider, and legacy regression checks passed.
- `npm test` passed 58/58, build passed, and `npm audit` reported 0 vulnerabilities. Eight controlled fixtures remain neutralized as `TEST FIXTURE`, dormant, zero-value, and unattributed.
- No external provider, discovery, AI execution, or outbound communication was connected.

- Installed CLI `2.75.0` rejected `[experimental.pgdelta]` and `[local_smtp]`; the config was preserved unchanged and backed up at `REVIVE_AI_MASTER/backups/phase_3e_3a_config.toml.20260914.bak`.
- Project-scoped `npx supabase@2.117.0` parses and operates with the current config, preserving all local settings and migrations.
- Read-only linked history confirms `20260912162730` and `20260912170332` are applied; only `20260914000000_rev_opportunities_proposal.sql` is pending. No remote mutation occurred.
- `revive-app`: `npm test` passed 58/58 and `npm run build` passed. `npm audit` was not required because no package changes occurred.
- Phase 3E.3 deployment remains pending and must not be started automatically.

## Current Phase
Phase 5 — CALENDAR & MEETINGS CONTROLLED OUTLOOK PILOT VERIFIED; MVP PHASE REMAINS IN PROGRESS.

## Current Objective
Return the controlled meeting pilot to its disabled safety state, preserve its durable evidence, and continue the remaining Phase 5 MVP roadmap without treating one scoped Outlook test as completion of customer calendar integration.

## Phase 5 Controlled Meeting Verification — 2026-09-29

**Latest commit:** `ed40e10`

### Verified functionality

- Meeting-proposal submission was verified through the REV UI and retained the existing approval-required workflow.
- One controlled Outlook calendar event was created for the authorised pilot workspace after approval, and the approved attendee received the invitation.
- The durable terminal `accepted_by_provider` outcome survives browser refresh and continues to display `EVENT CREATED`; invitation delivery is not inferred from provider acceptance.
- The workspace-scoped read model preserves terminal rejected and outcome-unknown states with truthful status handling.
- Owner/admin review, trusted proposal snapshot binding, exact-workspace activation, durable provider claim, one-attempt protection and unknown-outcome no-retry handling remain part of the controlled path.

### Current safety state

- The database meeting-provider gate is OFF.
- The live-workspace secret has been removed.
- `VITE_REV_MEETING_LIVE_UI_ENABLED` defaults to hidden, so the live calendar-event control is not displayed unless explicitly enabled for a controlled test.
- Dry-run reservation remains separate from live intent. No autonomous booking is enabled.

### Remaining Phase 5 MVP work — not verified complete

- Customer self-service calendar account integration for Outlook and Google, including per-tenant provider configuration, is not implemented.
- Meeting reminders are not implemented.
- RSVP tracking and response detection are not implemented.
- Meeting outcome recording into the broader customer/opportunity workflow is not complete.
- Goal-progress updates from booked or completed meetings are not complete.
- The controlled single-workspace Outlook pilot does not establish general production booking readiness or complete Phase 5 acceptance criteria.

### Next unfinished roadmap task

Implement the Phase 5 calendar-account integration foundation: customer self-service Outlook/Google connection and tenant-scoped provider configuration.

**Prerequisites:** Phase 4 durable execution controls remain in force; preserve the Phase 5 approval, trusted-snapshot, semantic-idempotency, tenant-isolation and unknown-outcome protections; define secure tenant-scoped credential/mailbox storage and revocation; review provider permissions and mailbox/calendar scope; and obtain a separate explicit authorization and controlled test plan before re-enabling any live gate or UI.

## Phase 4G.1 Closeout
- Added provider-independent request/result/service/provider contracts and the disabled `SEND_APPROVED_EMAIL` capability. No Microsoft, Google, Titan, SMTP, or other provider assumption exists in core execution code.
- `EmailExecutionAuthority` is the required trusted server boundary. It must resolve and reserve active owner/admin authority, exact tenant/action, current action version and approved fingerprint, exact approved recipient/subject/body snapshot, safety, jurisdiction, workspace policy, cost decision, and durable approved-action-version idempotency before returning authorization.
- The contract reuses Phase 4C `rev_action_executions`, approvals, action versions/fingerprints, request fingerprints, correlation/idempotency, provider usage, audit, and backend-only outcome architecture. No parallel execution persistence was introduced.
- `EmailExecutionService` validates the returned evidence, then stops at `PLATFORM_EXECUTION_ENABLED = false`. Its only successful result is `DRY RUN — NOTHING SENT`, with no provider invocation, email, usage, cost, or external effect.
- Focused Phase 4G.1 plus adjacent Phase 3G.2/4B/4C/4F tests passed 67/67; the production build passed with the existing chunk-size advisory.
- No browser wiring, `SEND` control, adapter, credentials, migration, schema, RLS, grant, RPC/function, production Supabase, or protected-system change occurred.

## Phase 4F Closeout
- Added an owner/admin-only request wrapper over the existing trusted execution boundary. Members and viewers cannot request execution, and cross-workspace resources remain undisclosed.
- Authority and policy are resolved again immediately before the dry run, including active membership, action state, approval fingerprint, capability, audience safety, jurisdiction, workspace execution-preparation policy, provider configuration, cost, and autonomy.
- Only `PREPARE_FOLLOW_UP` plans that are `ready_for_dry_run` may return the fixed terminal result `DRY RUN — NOTHING SENT`; platform execution and envelope execution remain false, with zero provider calls, £0 provider cost, and no external effect.
- Successful first requests write request/completion audit records. Mock idempotency is process-local; Phase 4C remains the durable execution-control architecture for any future trusted server integration.
- Mock mode shows `REQUEST EXECUTION` only for eligible approved owner/admin work. Live Supabase mode exposes no request control because no trusted server endpoint is authorized. No `SEND` control exists.
- Focused Phase 4B/4D/4F tests passed 39/39 and the production build passed. No full-suite, audit, Supabase, or browser validation was required for this isolated no-schema foundation.
- No migration, RLS, grant, function, provider integration, production Supabase, protected quote/Telegram, marketing-site, or `rev-business-verify` change occurred.

## Phase 4E Closeout
- Connected the Phase 4D prepared follow-up capability to authenticated workspace-scoped Supabase repositories without adding a parallel workflow or schema.
- Reused `rev_actions`, `approvals`, Business Memory, contacts, opportunities, Phase 4C action versions/fingerprints, role-specific RLS, and the trusted approval decision RPC.
- Deterministic IDs provide retry-safe preparation. Fresh repository/session reload, owner/admin edit/approve/reject, member preparation restrictions, viewer read-only behavior, tenant isolation, stale review rejection, and `APPROVED — NOT SENT` persistence passed against isolated local PostgREST/RLS.
- Focused tests passed 14/14 plus the temporary real-local integration proof 1/1. Previously completed final gates remain 177/177 full tests, build PASS, audit 0 vulnerabilities, and desktop/mobile PASS.
- `PLATFORM_EXECUTION_ENABLED = false`; workspace execution remains OFF; no Send/Execute control, provider call, external communication, execution attempt, or provider usage exists. Cost remained £0.
- No migration, RLS, grant, function, production Supabase, protected quote/Telegram, marketing-site, or `rev-business-verify` change occurred.

## Phase 4D Closeout
- Added a deterministic, workspace-scoped `PreparedFollowUpArtifact` and `FollowUpPreparationService` over existing recovery evidence, Business Brain context, REV Actions, Approvals, and Business Memory.
- Supported preparation covers current evidence-backed dormant lead, stale/no-next-action opportunity, and former-customer recovery paths. Unsupported or unsafe evidence remains blocked; suppressed contacts are refused.
- Owner/admin may edit, approve, or reject. Members may prepare but cannot review. Approval binds the edited action content and results in `APPROVED — NOT SENT` with `executionStatus = not_executed`.
- REV displays recovery opportunities and the prepared draft, objective, channel, evidence, missing information, and review controls. No Send or Execute control exists.
- Validation: focused Phase 4D tests 15/15; full suite 163/163; build PASS; `npm audit` 0 vulnerabilities; desktop and 390x844 browser checks PASS without overflow.
- No migration, Supabase deployment/write, provider call, external communication, production execution, legacy quote/Telegram, marketing-site, or `rev-business-verify` change occurred.

## Phase 4C Local Rehearsal
- Drafted `20260914183000_rev_execution_control_plane.sql` and its guarded rollback companion.
- Rehearsed only against local Supabase project `revive-app`; no linked push, remote SQL, or production mutation occurred.
- Local attack matrix passed 42/42; catalog ACL/RLS audit, rollback evidence guard, empty-state rollback, adjacent attack regression, 7/7 focused tests, 148/148 full tests, build, and zero-vulnerability audit all passed.
- Durable records remain dry-run infrastructure only. Platform execution is false, no provider was called, and no Execute control exists.
- See `REVIVE_AI_MASTER/PHASE_4C_LOCAL_REHEARSAL_REPORT.md`.

## Phase 4C Production Closeout
- Applied only migration `20260914183000` to `Revive Websites` / `ntbowgutwyyhhnmkadlv` after a credential-safe production baseline.
- Production security verification passed 25/25 and rolled back all transaction-local fixtures. Control-plane tables remain empty and workspace execution policies remain unseeded/default OFF.
- Protected quote/Telegram before/after fingerprint matched exactly; Edge Function metadata was unchanged.
- Full tests passed 148/148; build passed; `npm audit` reported 0 vulnerabilities.
- `PLATFORM_EXECUTION_ENABLED = false`; no Execute button, provider call, external communication, payment action, or production execution attempt occurred.

## Phase 4B Closeout
- Validation: 21/21 focused Phase 4B tests passed; adjacent approval/policy/control-centre bundle passed 42/42; full validation passed 141/141; build passed; `npm audit` reported 0 vulnerabilities.
- Caller input is limited to request, workspace, and action identifiers. Authenticated actor context is separate, and active membership/role, action, approval, capability, workspace settings, safety, jurisdiction, provider state, and cost are resolved inside the boundary.
- Approval decisions capture a deterministic action fingerprint. Missing or stale fingerprints require fresh approval, and invalid lifecycle/execution transitions are blocked.
- Idempotency is scoped by actor, workspace, and request ID, but is process-local and explicitly non-durable. Durable jobs, fingerprints, locks, and audit persistence remain Phase 4C work.
- Every result is a dry-run envelope with `executionEnabled: false` and `providerInvoked: false`. No Execute control, provider call, external communication, or financial action was added.
- No migration, RLS change, Supabase deployment, production write, legacy quote/Telegram change, or `rev-business-verify` change occurred.
- Phase 4C is NOT STARTED and requires explicit approval and migration/security review.

## Phase 4A Closeout
- Validation: 10/10 focused Phase 4A tests passed; the focused HOME bundle passed 15/15; full validation passed 120/120; build passed; `npm audit` reported 0 vulnerabilities.
- HOME uses a dedicated workspace-scoped read model. Mock mode aggregates deterministic repository records; live mode exposes truthful unavailable states and never falls back to mock data.
- `READY` and `BLOCKED` are derived from the existing execution policy/dry-run planner and are not stored lifecycle states.
- Potential Value, Recoverable Value, Pipeline Value, Won Revenue, REV Recovered, and REV Generated remain separate. Action completion does not create revenue.
- Execution remains disabled, no Execute control exists, and approved actions remain `APPROVED — NOT EXECUTED`.
- No migration, Supabase deployment, provider call, production write, legacy quote/Telegram change, or `rev-business-verify` change occurred.
- Next phase: Phase 4B was subsequently completed. Phase 4C is NOT STARTED and requires explicit approval.

## Phase 3H Closeout
- Validation: 110/110 tests passed; build passed; `npm audit` reported 0 vulnerabilities.
- Execution remains disabled with the platform execution kill switch set to false. No Execute control exists; approval remains supervised and approved actions remain `APPROVED — NOT EXECUTED`.
- Next phase: Phase 4 — NOT STARTED. Implementation requires explicit approval.

## Status Summary
✅ Phase 0 Complete — Baseline and public site protection confirmed  
✅ Phase 1 Complete — Architecture designed and documented  
✅ Phase 2A Complete — Local application foundation with mocks  
✅ Phase 2B Complete — Domain, repository, migration, RLS, auth, audit, and isolation-test foundation  
✅ Phase 2C Complete — Existing Supabase inspected and documented  
✅ Phase 2D.0 Complete — Pre-migration backup and reconciliation prepared; no migration applied  
✅ Phase 2D.0.1 Complete — Local tenant-security review, migration cleanup, and global REV access architecture prepared  
✅ Phase 2D.0.2 Complete — Workspace bootstrap design and controlled live RLS test plan prepared  
✅ Phase 2D.0.3 Complete — Secure workspace bootstrap implemented in the local migration and structurally tested  
⛔ Phase 2D.1 Stopped at preflight — remote `0001` is **HISTORY ONLY** by current schema evidence; fresh backup recovered  
✅ Phase 2D.1D Complete — Live Auth/RLS attack matrix passed; suspended-membership, legacy-quotes, and Telegram regressions all PASS  
✅ Phase 2D.2 Complete — Read-only Supabase provider integration reviewed  
✅ Phase 2D.2A Complete — Live browser validation PASS for Users A, B, and C; cross-user relogin isolation and stale-workspace rejection confirmed  

## Strategic Pivot Confirmed
Revive is transitioning from an AI website-builder product to **REV — a goal-driven AI employee platform for small businesses**.

REV helps small business owners:
- Get found (prospecting)
- Capture leads (qualification)
- Respond quickly (communication)
- Follow up (persistence)
- Book meetings (appointments)
- Recover opportunities (reactivation)
- Create marketing (content)
- Grow revenue (measured outcomes)

## Confirmed System State
- Existing Revive Websites marketing site is operational and protected
- REV customer application foundation exists locally in `revive-app/`; real customer infrastructure remains inactive
- Master project control system is initialized and documented
- Technology stack selected: React + Node.js + PostgreSQL with provider-agnostic AI orchestration
- Multi-tenant architecture designed with strict tenant isolation
- REV reasoning loop and autonomy model defined
- Existing dedicated Supabase project identified as `Revive Websites` (`ntbowgutwyyhhnmkadlv`); no new project created
- Supabase CLI `2.75.0` is installed and `revive-app` is linked only to `ntbowgutwyyhhnmkadlv`
- Remote inventory confirms `public.quotes` (estimated 0 rows), three indexes, email Auth enabled, zero storage buckets, and `telegram-alert-ts` active version 1
- SQL-level public schema, quote RLS/policies, functions, trigger, grants, and indexes are captured in the redacted backup; REV realtime configuration remains outside the public schema backup and requires separate review
- `revive-app` remains mock-only and the protected marketing site has no current diff
- Phase 2B validation from `revive-app`: 7/7 tests passed, build passed, and `npm audit` reported 0 vulnerabilities
- Active terminal Node version was `v20.18.0`, not the previously recorded `v22.23.2`; this environment discrepancy must be resolved before treating Node 22 validation as reproduced
- Credential-safe public schema backup captured at `REVIVE_AI_MASTER/backups/pre_phase_2d/public_schema_redacted.sql`; raw credential-bearing dump was temporary and deleted
- `public.quotes` baseline, live-vs-local reconciliation, and rollback plan are documented
- Phase 2D.1 is not approved: migration-history layout, security-definer/RLS review, and explicit migration approval remain prerequisites
- Local migration now uses hardened security-definer helpers and append/read-only audit policies; these changes have not been deployed
- Global REV tenant-user/system-agent access model is documented in `REV_GLOBAL_ACCESS_SECURITY_MODEL.md`
- Workspace bootstrap, invite/role model, and controlled RLS runbook are documented in `WORKSPACE_BOOTSTRAP_SECURITY.md` and `PHASE_2D_1_RUNBOOK.md`; no bootstrap RPC was implemented or deployed
- `create_workspace_with_owner(text,text)` is implemented in the local migration only; no remote deployment or live identity test occurred
- Phase 2D.1 did not apply a migration or create users/workspaces; see `PHASE_2D_1_PREFLIGHT_BLOCKER.md`
- Phase 2D.1A classified the remote state as **HISTORY ONLY**: remote `0001` exists in migration history, but approved REV schema objects are absent
- Fresh redacted checkpoint is at `REVIVE_AI_MASTER/backups/pre_phase_2d_1/`; reconciliation report is `PHASE_2D_1A_MIGRATION_RECONCILIATION.md`
- Approved REV migration was renumbered locally to `20260912162730_rev_core.sql` with an identical SHA256; remote `0001` was preserved and not repaired
- Matching rollback is `REVIVE_AI_MASTER/rollback/20260912162730_rev_core_rollback.sql`
- Phase 2D.1C applied the approved migration, but stopped catalog verification before Auth testing because live ACLs grant `anon` execution on the three SECURITY DEFINER helpers, including `create_workspace_with_owner`
- Phase 2D.1C.1 applied `20260912170332_rev_function_acl_hardening.sql`; live ACL verification now shows no `PUBLIC`/`anon` execution and authenticated execution preserved
- Phase 2D.1D stopped before Auth testing because the available Auth-admin API path returned HTTP 401; no synthetic users or workspaces were created
- Phase 2D.1D resumed with three supplied synthetic UUIDs, but authenticated sessions could not be established without passwords, OTP access, or JWTs; no bootstrap or RLS test ran
- Required `REV_RLS_USER_A_PASSWORD`, `REV_RLS_USER_B_PASSWORD`, and `REV_RLS_USER_C_PASSWORD` variables are absent in the current execution environment; live Auth/RLS testing remains blocked before sign-in

## Phase 2C Inspection Record

The read-only report is in `REVIVE_AI_MASTER/SUPABASE_EXISTING_STATE.md`. Phase 2D.0 artifacts are `QUOTES_PROTECTION_BASELINE.md`, `PHASE_2D_RECONCILIATION.md`, and `PHASE_2D_ROLLBACK_PLAN.md`. The project is active and safely linked to the existing reference only. No remote migrations, resets, policy changes, Auth changes, storage changes, data inserts, or external communications were performed.

## Completed Work (Phase 1)
✅ Strategic product vision documented in MASTER_BUILDER.md  
✅ Comprehensive system architecture in SYSTEM_ARCHITECTURE.md  
✅ Data model with multi-tenant isolation designed  
✅ Security architecture with RLS and tenant isolation  
✅ REV autonomy model (4 levels) defined  
✅ Approval Centre workflow designed  
✅ Integration architecture (pluggable providers)  
✅ Cost control strategy (Phase 1 low cost, future metering)  
✅ Industry playbooks structure defined  
✅ Internal test workspace strategy (Revive, Family Legacy)  
✅ Implementation sequence proposed (V0.1 through V0.7+)  
✅ Master roadmap updated with new phase sequence  

## In Progress (Phase 1)
🔄 Recording strategic decisions in DECISION_LOG.md  
🔄 Updating SECURITY_REGISTER.md with REV-specific requirements  
🔄 Documenting identified risks and blockers  
🔄 Completing handover documentation  
🔄 Final Phase 1 report generation  

## Key Architecture Decisions
1. ✅ Separate Revive Websites (public) from REV app (private)
2. ✅ Multi-tenant workspace model with RLS
3. ✅ Goals as first-class product objects
4. ✅ Business Brain as knowledge layer
5. ✅ Approval Centre for autonomy control (Level 1 default)
6. ✅ Provider-agnostic action engine
7. ✅ No paid external services in Phase 1
8. ✅ Website builder repositioned as REV skill
9. ✅ Industry playbooks architecture designed
10. ✅ Internal test workspaces (Revive, Family Legacy)

## Known Issues & Risks
- Public site contains some generic template text (will be updated during brand finalization)
- Client-side config contains Supabase anon key (sensitive, treated as client config)
- No production deployment or integrations activated (intentional for Phase 1)
- REV reasoning requires careful prompt engineering (security requirement)
- Multi-tenant isolation must be tested exhaustively before production

## Next Task
Add authenticated owner/admin Outlook disconnect controls using the existing credential-revocation authority. Verify stored credentials are removed, calendars become inactive/unselected, and subsequent availability reads fail closed. Then complete reconnect handling and per-workspace business-hours configuration. Google integration remains unfinished. Live booking remains disabled.
## Phase Gate
Phase 1 is COMPLETE when:
- All documentation is written
- All decisions are logged
- All security requirements are specified
- All risks are identified and mitigated
- Implementation sequence is agreed
- Approval to proceed to Phase 2

**Phase 2 will NOT begin until Phase 1 is approved.**

## Guardrails
- ❌ Do not modify the live public Revive Websites
- ❌ Do not connect Supabase, Stripe, or paid APIs
- ❌ Do not begin feature development
- ❌ Do not deploy any customer data processing
- ✅ Do complete all architecture documentation
- ✅ Do record all decisions
- ✅ Do identify and mitigate risks
