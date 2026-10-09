# Revive AI — Revised Master Roadmap

**STRATEGIC PIVOT:** From AI website-builder to goal-driven AI employee (REV)

## Phase Sequence

| Phase | Name | Focus | Status |
| --- | --- | --- | --- |
| 0 | Baseline & Protection | Repository, public site protection, project control | ✅ Complete |
| 1 | Architecture | REV vision, system design, data model, security | ✅ Complete |
| 2A | Local App Foundation | Mock workspace experience and UI shell | ✅ Complete |
| 2B | Real Data & Security Foundation | Domain model, repositories, migrations, RLS preparation, local isolation tests | ✅ Complete |
| 2C | Controlled Data Connection | Inspect existing Supabase, reconcile schema, test RLS, then request activation approval | ✅ Complete with SQL-metadata limitation |
| 2D.2 / 2D.2A | Supabase Provider Integration & Live Browser Validation | Read-only provider mode, live Auth/tenant browser validation for Users A/B/C | ✅ Complete (PASS) |
| 3A | REV Experience Specification | Product/UX design spec for the AI Growth Employee experience | ✅ Complete (design only) |
| 3B | App Shell + HOME | Owner Command Centre, Daily Business Brief | ✅ Complete (PASS) |
| 3C | REV Employee Workspace | Central conversation/task interface, activity system | ✅ Complete (PASS) |
| 3D | Growth & Revenue Intelligence | Revenue chain, won/pipeline/at-risk/recoverable surfaces | ✅ Complete (PASS) |
| 3E | Leads & Outreach Foundation | Opportunity domain, prospect discovery boundary, fit score, approval-gated outreach | ✅ Complete (PASS, Opportunity migration deployed and verified) |
| 3F.1 | Real Opportunity Discovery Foundation | Provider router, normalized candidates/evidence, cost governor, usage ledger, compliance/quality gates, mock GROWTH workflow | ✅ Complete (PASS, mock-only; no external provider) |
| 3F.2 | Controlled UK Provider Integration | DataForSEO review, trusted adapter boundary, GB enforcement, bounded test execution | ⏸️ Blocked at credentials/trusted-runtime gate; no real call |
| 3F.2A | UK Discovery Provider Comparison | Compare DataForSEO, Google Places, Outscraper, Serper, Companies House, and Foursquare | ✅ Complete (research only; no provider connected) |
| 3F.2B | UK Business Verification Foundation | Presence model, deterministic match states, mock Companies House evidence, non-registered business handling | ✅ Complete (architecture only; £0 spend) |
| 3F.2C | Controlled Companies House Verification | Trusted server adapter, GB enforcement, deterministic registry normalization, bounded real test | ✅ Complete (PASS; one corrected real verification, £0 spend) |
| 3G | Commercial Intelligence Foundation | REV FIND, REV AUDIENCE, REV RECOVER, goal orchestration, deterministic prioritization, audience safety | ✅ Complete (PASS; no external calls or side effects) |
| 3G.1 | Commercial Plan → Supervised Action Workflow | Recommendation detail, existing REV Action/Approval handoff, approve/edit/reject, APPROVED — NOT EXECUTED | ✅ Complete (PASS; no external execution) |
| 3G.2 | Execution Readiness & Capability Policy | Capability registry, policy gates, autonomy model, kill switches, dry-run planner | ✅ Complete (PASS; execution disabled) |
| 3H | REV RECOVER Real Recovery Intelligence Foundation | Existing-data recovery signals, potential/recoverable value, prioritization, GROWTH recovery surface | ✅ Complete (PASS; 110/110 tests, build PASS, audit 0; execution disabled) |
| 4A | Owner Control Centre Foundation | Workspace-scoped owner read model, priorities, approvals, derived readiness, money/result/usage/status summaries | ✅ Complete (PASS; execution disabled) |
| 4B | Trusted Execution Boundary | Server-derived authority, action transition policy, execution contracts | ✅ Complete (PASS; local dry-run boundary only, execution disabled) |
| 4C | Durable Execution Control Plane | Additive execution/usage persistence and hardened live integration | ✅ Production migration applied + verified; execution disabled |
| 4D | First Real REV Capability: Prepare Follow-Up | Evidence-based internal draft, existing REV Action/Approval workflow, owner/admin review | ✅ Complete (PASS; no sending/provider/migration) |
| Future | Email & Replies | Email integration, reply detection, follow-up workflow | ⏳ Deferred; not enabled by Phase 4A |
| 5 | Calendar & Meetings | Calendar integration, meeting booking, scheduling | 🔄 In Progress — controlled Outlook booking verified; Phase 5E.1 outcomes and reminder preparation isolated-CI verified; neither deployed |
| 6 | Daily Brief & Analytics | Daily summary, dashboards, measurable results | ⏳ Not Started |
| 7 | Website Lead Agent | Chatbot for Revive Websites, lead qualification | ⏳ Not Started |
| 8 | Voice & Missed Calls | Phone system integration, call recovery | ⏳ Not Started |
| 9 | Marketing Expansion | Social media, reviews, reactivation campaigns | ⏳ Not Started |
| 10 | Website Generator (REV Skill) | AI website builder repositioned as REV capability | ⏳ Not Started |
| 11 | Advanced Autonomy | Autonomy levels 2-4, advanced goal optimization | ⏳ Future |
| 12 | Industry Playbooks | REV Trades, REV Property, REV Beauty, etc. | ⏳ Future |
| 13 | API & Integrations | Third-party integrations, API ecosystem | ⏳ Future |

### Outcomes / Programme Hub — Employer Engagement / IPS foundation

Employer Engagement for employment-support and Individual Placement and Support (IPS) organisations is the pre-existing employment-support plan from 21 September 2026, clarified on 8 October 2026. It is not a new product module and belongs inside **Outcomes / Programme Hub**.

This capability remains distinct from:

- commercial GROWTH contacts, leads, opportunities, revenue and attribution;
- worker Scheduling jobs, assignments, availability, sickness and Annual Leave;
- outbound email execution and autonomous provider actions.

The foundation covers tenant-scoped employers, employer contacts, vacancies, minimal participant employment profiles, explicit adviser assignment and caseload access, deterministic evidence-based matching, version-bound adviser review of outreach drafts that remain **Approved — not sent**, explicit employment outcomes and traceable programme reporting.

Participant residency eligibility, vacancy-search geography and service-delivery geography are separate contracts. Matching postcode areas are never proof of residency or programme eligibility. Programme rules are versioned and effective-dated, exceptions are explicit and audited, and missing evidence produces `needs_review`.

Tenant spreadsheet columns, import templates and employment-outcome vocabularies remain configurable. They must be confirmed from the organisation's actual materials before implementation rather than invented by REV. Future voice updates may propose structured changes, but an adviser must review and confirm them before any durable write.

The canonical architecture and decision boundary are documented in `REVIVE_AI_MASTER/01_ARCHITECTURE/OUTCOMES_PROGRAMME_HUB_EMPLOYER_ENGAGEMENT_IPS.md`.

**Implementation state:** the first tenant-neutral foundation is implemented and is now integrated into the existing authenticated REV app. Programme configuration, employers, employer contacts, vacancies, minimal participant employment profiles, explicit advisers and caseload assignments use version-bound, service-only, idempotent audited writes. The migration and save function are recorded as deployed; this integration does not deploy or alter hosted data. Required tenant contracts remain unconfigured and show **Needs review**. Matching, outreach drafts, outcomes, reporting, spreadsheet import and voice capture are not implemented.

### Planned worker briefs and assignment communications — not implemented

Future worker scheduling scope: managers may upload a private job brief; each worker has a recipient email separate from a REV login; confirmed assignments may send shift details and a secure brief link using the organisation's separately authorised sending account. The capability must prevent duplicate sends, track `sent` / `failed` / `not_sent`, and send appropriate updates when an assignment changes or is cancelled. Calendar read consent is not email-sending authority. This requirement is planned only: it is not implemented, enabled or authorised, and must receive its own security, permission, delivery and idempotency review before execution work.

### Current Phase 5 boundary

The controlled customer Outlook booking and Gmail invitation receipt on 9 October 2026 are verified for that exact test only. They do not establish general booking availability. Phase 5E.1 explicit meeting outcomes and manual channel-neutral reminder-draft preparation are committed and verified in isolated CI but not deployed. Reminder preparation has no delivery behavior. Live booking and email-sending gates remain disabled. Reminder timing/delivery and RSVP/response ingestion remain unfinished.

### Scheduling month planner and sickness recording — implemented and locally tested, not released

The existing Scheduling domain now has a full-width Week/Month planner toggle. Week remains the default. Month navigation uses Previous month, Next month and Today controls, a Monday-first grid, the existing workspace-scoped planner reads and refresh/stale behavior, shared date/timezone/worker/location controls, labelled job/assignment/leave/unavailable/sickness entries, and keyboard-accessible overflow details.

Sickness reuses the existing workspace-scoped worker-unavailability record, restrictive RLS, service-only trusted write, request idempotency, optimistic versions, terminal cancellation, assignment-overlap guards and append-only audit path. Owners/admins record inclusive first/last sickness dates in the durable workspace timezone; the browser, trusted boundary and database enforce half-open workspace-local-midnight UTC intervals without assuming 24-hour days. No diagnosis, symptom, medical note or other health detail is accepted. Annual Leave records, postings and balances stay separate.

This enhancement is implemented and locally tested only. It is not committed, CI-verified, migrated to hosted Supabase, deployed, manually verified or released. The additive sickness migration and updated Edge Function remain unapplied to hosted environments. No notification, provider call or execution-gate change is included.

### REV Business Guide and Video Walkthroughs — planned, not created

A user-facing REV Business Guide and short captioned video walkthroughs are required product documentation within the existing scope, not a new feature module. Produce them progressively as workflows stabilize, update them whenever the UI or behavior changes, and finalize the complete set before launch. No guide or video has yet been created, reviewed or released.

The documentation set must cover every existing planned REV module:

- HOME and Daily Brief, goals, priorities, activity and analytics.
- REV workspace, approvals, prepared work, follow-ups and durable action results.
- GROWTH, leads, opportunity discovery and verification, outreach preparation and REV RECOVER.
- Customers, contacts, suppressions, conversation history and future email/reply workflows.
- Business Brain/profile, services, workspace settings and permissions.
- Calendar and Meetings: connection, selection, availability, proposals, approval, controlled booking status, RSVP/reminders when implemented, and manually recorded meeting outcomes.
- Scheduling: workers, skills, patterns, availability, jobs, assignments, planner, Annual Leave, bank holidays and the planned worker-brief/assignment-communication capability.
- Website Lead Agent, Voice and Missed Calls, Marketing Expansion, Website Generator, Advanced Autonomy, Industry Playbooks, and API/Integrations as those planned modules stabilize.

For each module, the guide and matching video must:

1. Explain what the module does and how it benefits a business.
2. Identify who can use it and the setup, workspace role, consent, connection or other permission required.
3. Provide step-by-step instructions using realistic tenant-neutral examples and demo data.
4. Describe expected results, durable status indicators, common errors, uncertainty safeguards and recovery steps.
5. Include a short captioned video walkthrough supported by equivalent written instructions.

All examples and recordings must use tenant-neutral demo data and expose no customer information, credentials, tokens, private environment values or provider secrets. Every page and video must label capability state accurately as **implemented**, **verified** or **planned**; controlled verification must not be presented as general availability. Booking, RSVP, meeting outcome and external-send status must remain distinct.

## Core Product Evolution

### From: AI Website Builder
- Centered on website generation
- Builder as primary product
- Lead capture as byproduct

### To: REV — AI Business Employee
- Centered on business goals
- REV as primary agent
- Website building as REV skill
- Focus on measurable business outcomes (revenue, leads, meetings)

## Phase 0 Outcome
✅ Repository baseline confirmed  
✅ Public marketing site protected  
✅ Master project control initialized  
✅ Deployment and security risks identified  

## Phase 1 Deliverables (In Progress)
✅ MASTER_BUILDER.md — Strategic vision and architecture philosophy  
✅ SYSTEM_ARCHITECTURE.md — Technical architecture, data model, security  
✅ Updated MASTER_ROADMAP.md — New phase sequence  
🔄 DECISION_LOG.md — Strategic pivot decisions  
🔄 SECURITY_REGISTER.md — REV-specific security requirements  
🔄 RISKS_AND_BLOCKERS.md — Phase 1 identified risks  
🔄 PROJECT_STATUS.md — Phase 1 status  
🔄 PHASE_TRACKER.md — Updated phase details  
🔄 CHANGELOG.md — Phase 1 initiated  
🔄 CURRENT_HANDOVER.md — Phase 1 handover instructions  

## Strategic Boundary (Protected)

**PUBLIC:** Revive Websites (Static Marketing)
- Explains Revive and REV
- Pricing, testimonials, demonstrations
- Lead capture form (feeds to REV)
- Signup/login links
- Status: Protected, must remain operational

**PRIVATE:** REV SaaS Application (app.revive.domain)
- Authenticated multi-tenant platform
- Business workspace for each customer
- Goals, leads, customers, intelligence
- Email, calendar, approvals
- Action engine for business growth
- Status: To be built in controlled phases

**Critical Rule:** Never mix public site and customer data in same runtime

## Implementation Principles

1. **Protect the existing marketing site**
2. **Complete all architecture before coding**
3. **Multi-tenant isolation from day 1**
4. **Progress through defined phases**
5. **No paid services until production-ready**
6. **Record all decisions in DECISION_LOG.md**
7. **Do not begin Phase 2 until Phase 1 complete**

## Delivery Loop

REV development follows small **BUILD → TEST → PROVE → IMPROVE** releases. Dates are planning signals, not committed waterfall estimates. Each phase stops at a reviewable gate before external infrastructure or customer data is introduced.

Phase 2B local URL: `http://127.0.0.1:5180/`

Phase 2C local validation remains mock-only. The existing Revive Supabase project is active and linked as `ntbowgutwyyhhnmkadlv`; SQL-level schema/RLS metadata must be captured before Phase 2D work.
