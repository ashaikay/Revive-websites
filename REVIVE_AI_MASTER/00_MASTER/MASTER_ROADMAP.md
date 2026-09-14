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
| 4 | Email & Replies | Email integration, reply detection, follow-up workflow | ⏳ Not Started — explicit approval required |
| 5 | Calendar & Meetings | Calendar integration, meeting booking, scheduling | ⏳ Not Started |
| 6 | Daily Brief & Analytics | Daily summary, dashboards, measurable results | ⏳ Not Started |
| 7 | Website Lead Agent | Chatbot for Revive Websites, lead qualification | ⏳ Not Started |
| 8 | Voice & Missed Calls | Phone system integration, call recovery | ⏳ Not Started |
| 9 | Marketing Expansion | Social media, reviews, reactivation campaigns | ⏳ Not Started |
| 10 | Website Generator (REV Skill) | AI website builder repositioned as REV capability | ⏳ Not Started |
| 11 | Advanced Autonomy | Autonomy levels 2-4, advanced goal optimization | ⏳ Future |
| 12 | Industry Playbooks | REV Trades, REV Property, REV Beauty, etc. | ⏳ Future |
| 13 | API & Integrations | Third-party integrations, API ecosystem | ⏳ Future |

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
