# Phase 3E — Opportunity Domain, Leads & Outreach Foundation

**Status:** Foundation implemented and the reviewed Opportunity migration deployed and verified remotely in Phase 3E.3. Phase 3F.1 and 3F.2B add provider-independent discovery and verification architecture in mock mode only; no external discovery or sending is connected.

---

## 1. Opportunity Domain

An **Opportunity** is a specific commercial pursuit tied to a **Contact**, and is a distinct record from it:

- **Contact** — who is the person/business, and what is the relationship/history?
- **Opportunity** — what potential commercial outcome are we pursuing with them, right now?

A single contact may have several opportunities over time (e.g. a past customer who returns with a new project). This phase adds `OpportunityRecord` as its own domain model (`src/domain/models.ts`) and repository (`OpportunityRepository`, wired into `DataProvider`/`createMockDataProvider`), following the exact same workspace-scoping pattern already used by `GoalRepository`/`ContactRepository`/`REVActionRepository`.

### Opportunity lifecycle (`OpportunityStage`)

```
new → qualified → contacted → conversation → appointment → quote → follow_up → won
                                                                              → lost
                                                                              → dormant
```

Only `new`, `qualified`, `contacted`, `follow_up`, `won`, and `dormant` can currently be derived automatically from real recorded activity (via contact/opportunity timestamps). `conversation`, `appointment`, `quote`, and `lost` are supported by the type system and can be set explicitly (e.g. a manual entry once an owner has actually sent a quote outside the system), but nothing in this phase automatically infers them — see the schema proposal below for what would be needed to derive them safely in the future.

### Revenue definitions (unchanged principle from Phase 3D, now sourced from Opportunity records)

- **WON REVENUE** — sum of `estimatedValue` for opportunities with `stage: 'won'`.
- **REVENUE IN PIPELINE** — sum of `estimatedValue` for opportunities not in `won`/`lost`/`dormant`.
- **REVENUE AT RISK** — sum of `estimatedValue` for non-terminal opportunities with no `nextActionAt` and no activity in 14+ days.
- **RECOVERABLE REVENUE** — sum of `estimatedValue` for opportunities with `stage: 'dormant'`.
- **REV GENERATED** — sum of `estimatedValue` for **won** opportunities with `attribution: 'rev_generated'`.
- **REV RECOVERED** — sum of `estimatedValue` for **won** opportunities with `attribution: 'rev_recovered'`.
- An opportunity with no `attribution` set is always `unattributed` and never receives REV credit.

---

## 2. Proposed Future Schema (NOT applied)

A local-only migration proposal was created at `revive-app/supabase/migrations/20260914000000_rev_opportunities_proposal.sql`, with its rollback at `REVIVE_AI_MASTER/rollback/20260914000000_rev_opportunities_proposal_rollback.sql`. **Neither has been applied to any Supabase project.** No `supabase db push` or equivalent remote command was run.

Proposed additions:

- `public.opportunities` — workspace-scoped, FK to `contacts(workspace_id, id)`, `stage`/`source`/`attribution` check constraints matching the frontend enums exactly, `unique(workspace_id, id)` for composite-FK safety (matching the existing `rev_core` convention).
- `public.rev_actions.opportunity_id` — additive, nullable column + composite FK, so outreach/work items can reference the opportunity they progress (alongside the existing `goal_id`/`contact_id`).
- `public.contact_suppressions` — one row per contact per workspace; presence means outreach must not be prepared for that contact.
- RLS: reuses the existing `is_active_workspace_member()` helper from `20260912162730_rev_core.sql`. No new SECURITY DEFINER function is introduced.
- Indexes: `opportunities_workspace_idx`, `opportunities_contact_idx`, `opportunities_stage_idx`, `rev_actions_opportunity_idx`.

**This proposal requires explicit approval and a separate deployment step before any remote application**, consistent with the Phase 2D.1 change-control precedent (backup → reconciliation → controlled apply → live verification).

To fully derive `conversation`/`appointment`/`quote`/`lost` automatically, a future migration would additionally need dedicated `opportunity_activities` (conversation/appointment/quote events with timestamps) and an explicit `lost` classification rule — deferred to a later phase and not designed in detail here.

---

## 3. Prospect Discovery Boundary

`ProspectDiscoveryProvider` (`src/services/prospectDiscoveryProvider.ts`) is the interface future approved data sources (business directories, approved search providers, imported lists, tender/grant portals, partner referrals, manual entry, authorised integrations) will implement. Phase 3E ships only `MockProspectDiscoveryProvider`, returning clearly-labelled demo candidates for development/demo purposes. **No unrestricted web scraping, and no claim that REV can access "all businesses on the internet."**

```
ProspectDiscoveryProvider → Research → Evidence → Fit Score → Opportunity Candidate
```

Each `ProspectCandidate` carries `whyFound`, `whyRelevant`, and an `evidence[]` list — REV never states a business need without supporting evidence.

### Fit Score

`FitScoreBreakdown` is a transparent, named-criteria structure (`serviceMatch`, `geographicMatch`, `companyTypeMatch`, `opportunityTrigger`, `contactability`), each 0–1. `computeFitScoreOverall()` averages them into a single displayed percentage — never a bare, unexplained AI confidence number.

---

## 4. Outreach Preparation & Approval

Outreach reuses the **existing** `REVActionService`/`ApprovalService` architecture from Phase 3C rather than introducing a parallel execution engine, so the **APPROVED — NOT EXECUTED** invariant is inherited automatically and verified by a unit test. `OutreachService.prepareDraft()`:

1. Checks `canPrepareOutreach()` — refuses immediately if the contact is suppressed (`doNotContact`).
2. Calls `REVActionService.propose()` with `actionType: 'outreach'`, `requiresApproval: true`, and the new `opportunityId` linkage.
3. Creates the matching `ApprovalRecord`.

No message is ever sent; there is no send integration in this phase.

### Outreach queue vocabulary (`OutreachStatus`)

```
draft → ready_for_approval → approved → queued → sent → replied → follow_up_due → converted → closed
                                                                                              → suppressed
```

`deriveOutreachStatus()` only ever returns `draft`, `ready_for_approval`, `approved`, `closed`, or `suppressed` — the states the current architecture can safely evidence. `queued`, `sent`, `replied`, `follow_up_due`, and `converted` require a future send/reply integration and are never fabricated.

---

## 5. Suppression / Compliance

`ContactRecord.doNotContact` + `suppressionReason` (frontend model; proposed `contact_suppressions` table for the future schema) block outreach preparation outright — verified by a unit test using a demo suppressed contact (`contact-2`, reason `unsubscribed`). Future compliance concepts (bounced address, invalid contact, frequency caps, duplicate prevention, audit trail) are named in `SuppressionRecord['reason']` and this document, not yet enforced beyond the single `doNotContact` gate.

---

## 6. Customers / Growth / REV / Opportunity / Outreach boundary

- **CUSTOMERS** — who are the people/businesses and what is the relationship/history?
- **GROWTH** — where are the commercial opportunities, pipeline, risks, and outcomes?
- **REV** — the employee doing/recommending the work.
- **OPPORTUNITY** — a specific commercial pursuit (may later represent a sales lead, tender, contract, grant, or partnership via `OpportunityType`).
- **OUTREACH** — one method of progressing an Opportunity, always approval-gated.

No new top-level navigation item was added; GROWTH gained an Opportunity Pipeline (using real `OpportunityRecord`s) and a Prospect Discovery section, and REV's existing Work Queue/Recommendations/Approvals surfaces now also show outreach drafts created from GROWTH, with no duplicated CRM surface.

---

## 7. Canonical Local Dev Server & Browser Testing Policy

- **Canonical local development URL:** `http://127.0.0.1:5180/`. Duplicate dev servers on 5181 (and other stray ports) were stopped; a single instance now runs on 5180.
- **Preferred start command:** `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5180` from `revive-app/` (equivalent to `npx vite --host 127.0.0.1 --port 5180`; the local binary form avoids an interactive "install vite" prompt in this environment).
- For every significant UI phase: run automated tests, production build, `npm audit`, desktop visual review, mobile visual review, and inspect console/runtime errors. Use MOCK MODE for populated visual reviews.
- Full User A/B/C authentication + isolation testing is required only when a change affects authentication, session handling, workspace selection, repository access, RLS, workspace membership, tenant isolation, or another security-sensitive data boundary. Phase 3E touched none of these, so live-user browser re-validation was not required; automated regression (57/57 tests) plus the unaffected, already-validated live-mode empty-state pattern (Phase 3B/3C/3D) serve as the baseline.

---

## 8. Cost / Abuse Control (documented, not implemented)

Future controls to integrate with the planned REV Cost Governor: prospect-search limits, duplicate search prevention, research depth limits, per-workspace outreach limits, daily send caps, rate limiting, expensive data-provider limits, AI model routing, and suppression enforcement at send time. None of these are implemented in Phase 3E; there is no real external execution to limit yet.

---

## 9. Phase 3F Recommendation

Before any real prospect discovery or sending is connected, Phase 3F should cover, in order:

1. Review and (if approved) apply the proposed Opportunity/suppression migration to a non-production environment, with the same backup → reconciliation → controlled-apply → live-RLS-verification sequence used in Phase 2D.1.
2. Design the `opportunity_activities` (conversation/appointment/quote) schema needed to safely derive the remaining pipeline stages.
3. Select and integrate exactly one authorised discovery/data source behind `ProspectDiscoveryProvider`, with documented cost/abuse limits, before considering any live send integration.
4. Only after the above: design the reply-detection provider boundary and a real (still approval-gated) send integration.

---

## 10. Phase 3E.1 Architecture/Security Review (pre-deployment, no remote change)

**Date:** 2026-09-14. **Remote database touched:** NO — this was a local, static review only.

### Contact ↔ Opportunity cardinality

Confirmed correct: `OpportunityRecord.contactId` points **from** Opportunity **to** Contact (many opportunities may reference one contact). `ContactRecord` has **no** `opportunityId` field and was never given one — the only linkage field added elsewhere is `REVActionRecord.opportunityId` (an action referencing the opportunity it progresses), which does not constrain contact-opportunity cardinality. No change required.

### Corrections made to the local (still unapplied) migration as a result of this review

- **Money type:** `estimated_value` and the new `probability` column now use `numeric(12, 2)` / `numeric(3, 2)` instead of unscaled `numeric`, plus explicit non-negative/0–1 range checks. (Floating point was never used.)
- **Currency:** added `check (currency ~ '^[A-Z]{3}$')` so the column stays ISO-4217-shaped and international-ready, while still defaulting to `'GBP'` for V1.
- **Delete strategy:** replaced the single `for all` policy on `opportunities` with **select/insert/update policies only — no delete policy** — so commercial/attribution history can never be hard-deleted through the API; the intended path to end an opportunity is `stage = 'lost'` or `'dormant'`, not row deletion. `contact_suppressions` keeps its `for all` policy since removing a suppression row is a legitimate compliance action.
- **Update safety:** added a plain (non-`SECURITY DEFINER`) `BEFORE UPDATE` trigger, `prevent_opportunity_identity_mutation()`, that blocks changes to `workspace_id`, `contact_id`, `created_at`, and `created_by_type` after insert. This closes a subtle gap: the standard `using(...) with check(...)` RLS idiom (used consistently across every existing Phase 2B tenant table) permits a member of **two** workspaces to move a row between them, because both the old and new `workspace_id` would independently satisfy `is_active_workspace_member()`. This is a pre-existing structural property of the whole `rev_core` RLS pattern, not something newly introduced by this proposal; the trigger is a deliberate, additive hardening for the new table only.
- **Idempotency:** the `rev_actions.opportunity_id` foreign key is now added inside a guarded `DO` block (`IF NOT EXISTS ... THEN ALTER TABLE ADD CONSTRAINT`) since plain `ADD CONSTRAINT` has no `IF NOT EXISTS` form in PostgreSQL, matching the idempotent style used everywhere else in the file.
- **Index:** added `opportunities_next_action_idx (workspace_id, next_action_at)` to support the at-risk/attention query pattern; did not add indexes for `updated_at`, `source`, or `attribution` alone since no current query pattern filters/sorts by those independently of `workspace_id` + another column already indexed.

### Source vs. Attribution

Confirmed distinct and not conflated: `source` (`OpportunitySource`) answers "where did this originate" (e.g. `referral`, `rev_prospect_discovery`); `attribution` (`AttributionCategory`) answers "what role did REV play" (e.g. `rev_assisted`). An opportunity sourced via `rev_prospect_discovery` is not automatically `rev_generated` in the code — both fields are set independently when an opportunity is created (see `GrowthArea.handlePrepareOutreach`).

### REV revenue counting rule — confirmed enforced

Creating an opportunity with `attribution: 'rev_generated'` does **not** by itself count as revenue. `computeOpportunityRevenue()` only ever sums `revGenerated`/`revRecovered` from opportunities whose **`stage === 'won'`** AND whose `attribution` matches. A new/pipeline-stage opportunity with `rev_generated` attribution contributes only to `pipeline`, never to `revGenerated`, until it is actually won — covered by a new explicit test (`does not count REV-generated revenue merely because an opportunity was created with that attribution`). "Prepare outreach" (`OutreachService.prepareDraft`) creates a `REVActionRecord`/`ApprovalRecord` only; it never touches revenue totals.

### Cross-workspace FK safety

Not possible: `opportunities.contact_id` and `rev_actions.opportunity_id` both use **composite** foreign keys of the form `foreign key (workspace_id, x_id) references <table>(workspace_id, id)`, identical to the existing `rev_actions`→`goals`/`contacts` pattern in `20260912162730_rev_core.sql`. Because the referenced table has `unique (workspace_id, id)`, a row cannot reference an id that belongs to a different `workspace_id` — this is exactly the class of attack exercised (and passed) in Phase 2D.1D's composite-FK test.

### RLS policy intent (plain English)

- **SELECT** — a user may see an opportunity only if they hold an active membership in that opportunity's workspace.
- **INSERT** — a user may create an opportunity only in a workspace they actively belong to; there is no path to insert into a workspace the caller is not a member of.
- **UPDATE** — a user may update an opportunity only if they were (and remain) an active member of its workspace; the new identity-immutability trigger additionally blocks changing which workspace/contact the row belongs to, regardless of membership overlap.
- **DELETE** — denied entirely (no policy exists for delete), so commercial/attribution evidence cannot be destroyed via the API.
- Suspended members and outsider (User C-style) sessions remain blocked exactly as today, because all four operations still route through the same `is_active_workspace_member()` helper already proven against suspended-membership and outsider-baseline attacks in Phase 2D.1D.

### Insert / application-layer safety

- **Database constraints:** `NOT NULL`/`CHECK` constraints reject invalid `stage`/`source`/`opportunity_type`/`attribution`/`currency`/`probability` values outright, independent of any RLS or frontend logic.
- **RLS:** enforces workspace membership for the insert itself (see above); a caller cannot target a foreign `workspace_id`.
- **Application validation:** `OutreachService.canPrepareOutreach()` blocks draft creation for suppressed contacts before any database write is attempted (defense in depth, not a substitute for the database-level constraints above).

No system/audit field can be spoofed at insert: `created_by_type` is constrained to the same three actor types used everywhere else (`user`/`rev`/`system`), and there is no separate privileged "system-only" field a normal insert could misuse.

### Function ACL risk

**One** new function is introduced: `public.prevent_opportunity_identity_mutation()`. It is a plain trigger function (no `SECURITY DEFINER`), so it executes with the invoking role's own privileges and does not bypass RLS; it requires no `GRANT EXECUTE` to `anon`/`authenticated`/`PUBLIC` because trigger functions are invoked implicitly by the trigger mechanism, not called directly by client roles. This avoids the exact class of problem discovered in Phase 2D.1C (unexpected `anon` grants on `SECURITY DEFINER` helpers).

### Legacy protection

Confirmed: the proposal does not reference or modify `public.quotes`, its RLS policies, its indexes, `quotes-telegram-alert`, `telegram-alert-ts`, or any marketing-site file.

### Rollback review

`REVIVE_AI_MASTER/rollback/20260914000000_rev_opportunities_proposal_rollback.sql` was updated to match the revised migration: it drops only the trigger, trigger function, the three `opportunities` policies, the `contact_suppressions` policy, the four new indexes, the `contact_suppressions` table, the `rev_actions.opportunity_id` column/constraint, and the `opportunities` table — all objects created by this proposal and nothing else. It does not touch `is_active_workspace_member()`, `has_workspace_role()`, `create_workspace_with_owner()`, or any pre-existing table/index/policy.

### Suppression model decision

V1 remains a single suppression row per contact per workspace (option B: dedicated `contact_suppressions` table), not a boolean-only field on `Contact` — chosen so a future per-channel model (email unsubscribed but SMS/phone still permitted) can be added later by widening the primary key to `(workspace_id, contact_id, channel)` without a breaking redesign. This is documented directly in the migration file's comments rather than built now.

### Outreach data model boundary

No `outreach_messages`/`outreach_attempts` table is introduced in this phase. `OutreachAttemptRecord` and `deriveOutreachStatus()` remain a TypeScript-only view derived from the existing `REVActionRecord`/`ApprovalRecord` state; a dedicated persisted outreach table is deferred until a real send/reply integration exists and needs its own history (draft → send → reply timestamps) that `rev_actions` was never designed to hold.

### Bid/Grant/Partnership compatibility

`OpportunityType` (`commercial_lead | tender | contract | grant | partnership`) is a generic column on the same `opportunities` table — confirmed no separate/duplicate commercial system is required. Fields that are genuinely generic (`stage`, `source`, `attribution`, `estimated_value`, `probability`) apply to every type; anything genuinely specialist to bid/grant work (e.g. a deadline, a submission reference, an evidence checklist) is intentionally left to a future extension table keyed by `(workspace_id, opportunity_id)` rather than added speculatively now.

### Test plan for after any future approved deployment (not run — no remote deployment occurred)

User A/B own-tenant read/write; User B cannot read/write User A's opportunities; User C (outsider) sees zero rows; suspended-membership denial; foreign-contact-injection rejected by the composite FK; workspace-spoof rejected by RLS insert check; cross-tenant update/delete rejected; the new identity-immutability trigger specifically tested against a user who is a member of two workspaces; attribution/no-fabricated-revenue check re-run against live data once deployed; suppression continues to block outreach preparation. This mirrors the Phase 2D.1D attack matrix and would reuse the same Node harness pattern.

---

## 11. Phase 3E.2 — Local Migration Rehearsal + RLS Attack Matrix (remote database NOT touched)

**Date:** 2026-09-14. All work in this section ran against a **local-only** Supabase/Postgres stack (Docker), never the linked remote Revive project.

### Environment

- A separate local Supabase project (`project_id = "revive-app"`) was initialised in `revive-app/supabase/config.toml` with every port shifted (+1000, e.g. API `55321`, DB `55322`) specifically so it could run alongside an unrelated pre-existing local Supabase stack (`famous-ai-codes`) already on this machine without any interference. That unrelated stack's containers were never started, stopped, or modified by this work — verified by container name before and after.
- `[analytics]` (Logflare) was disabled in the local config; it is an optional local-dev-only observability component unrelated to this migration and was repeatedly failing its own health check for unrelated reasons, which otherwise aborted `supabase start`.
- `supabase start`/`supabase db reset` applied all three existing migrations, including `20260914000000_rev_opportunities_proposal.sql`, cleanly and without error, confirming the proposal is syntactically and referentially valid against a real Postgres instance.

### Function ACL hardening (requested explicitly, now done)

Per direct catalog inspection (`pg_proc`), `prevent_opportunity_identity_mutation()`:

- `prosecdef = f` — confirmed **not** `SECURITY DEFINER`.
- `proconfig = {"search_path=\"\""}` — explicit empty `search_path`, matching the hardened style of the existing helpers.
- `proacl = {postgres=X/postgres, service_role=X/postgres}` — **no** `PUBLIC`, `anon`, or `authenticated` entries at all. The migration now contains explicit `REVOKE ALL ... FROM PUBLIC/anon/authenticated` statements rather than relying on default privileges, directly addressing the Phase 2D.1C lesson. The rehearsal proved this revocation does not impair the trigger — every immutability test below still fired correctly.

### Attack matrix result — 51/51 checks passed

| Area | Result |
| --- | --- |
| Contact cardinality (3 opportunities on one contact) | PASS |
| User A / User B own-tenant read + insert | PASS |
| User A→B / B→A cross-tenant read | BLOCKED (0 rows) |
| User C outsider read (both workspaces) | BLOCKED (0 rows) |
| Cross-tenant contact injection (`workspace_id=A`, `contact_id` from B) | BLOCKED by composite FK |
| Workspace spoof insert (A→B, B→A) | BLOCKED by RLS insert check |
| Cross-workspace move by a **dual-member** user | BLOCKED by the new trigger (the exact gap identified in the 3E.1 review) |
| `contact_id` / `created_at` / `created_by_type` mutation | BLOCKED by the same trigger |
| Permitted field update (`stage`) | Still works normally |
| Delete (own-tenant and cross-tenant) | DENIED (no delete policy exists) |
| Suspended membership (select/insert/update) | DENIED; access restored correctly after reactivation |
| Invalid `stage` / `source` / `attribution` | REJECTED by CHECK constraints; valid values accepted |
| Creating `stage='new'` with `attribution='rev_generated'` | Allowed, but confirmed **not** `won` — the revenue rule stays an application-layer read (`computeOpportunityRevenue`), never a fabricated DB fact |
| Transition to `stage='won'` with `attribution='rev_generated'` | Allowed — first point revenue counting would apply |
| Money: decimal, zero, negative | Decimal/zero accepted; negative REJECTED |
| Currency: GBP/USD/EUR valid; lowercase/4-letter/2-letter | Valid ones accepted; all three invalid forms REJECTED |
| Probability: 0, 0.5, 1 valid; -0.01, 1.01 | Valid accepted; both invalid REJECTED |
| Suppression create + cross-tenant read/delete | Isolated; cross-tenant delete BLOCKED |
| `rev_actions.opportunity_id` referencing a foreign-workspace opportunity | BLOCKED by composite FK; same-tenant link ALLOWED |

No test used a privileged/service-role credential for a tenant assertion; the service role was used only for fixture setup (creating the three local test users and toggling membership status), exactly mirroring the Phase 2D.1D precedent.

### Rollback and reapply rehearsal (local only)

- Applied `REVIVE_AI_MASTER/rollback/20260914000000_rev_opportunities_proposal_rollback.sql` locally. Catalog inspection afterward confirmed `opportunities` and `contact_suppressions` were gone, `rev_actions.opportunity_id` was gone, and **all** pre-existing tables (`workspaces`, `workspace_members`, `business_profiles`, `business_services`, `goals`, `contacts`, `rev_actions`, `approvals`, `business_memory_events`, `audit_log`) and **all** pre-existing functions (`is_active_workspace_member`, `has_workspace_role`, `create_workspace_with_owner`) remained untouched.
- Reapplied the migration locally immediately afterward with no errors, proving both the forward and rollback paths independently.

### Regression

`npm test` (58/58), `npm run build`, and `npm audit` (0 vulnerabilities) all passed after this work, with no application code changed as part of the rehearsal itself (only the migration's function-ACL hardening and the local-only `supabase/config.toml` were added/edited).

### Outcome

The local rehearsal stack was stopped afterward (`supabase stop`, scoped to `project_id=revive-app` only); the unrelated `famous-ai-codes` local project was confirmed running before and after, untouched throughout. **The remote/linked Revive Supabase project was not touched at any point in Phase 3E.1 or 3E.2.** The corrected migration is now rehearsed and evidenced locally; it still requires an explicit human approval decision before any future application to the real Revive Supabase project, which should also include a re-run of this same attack matrix against that environment post-deployment.


