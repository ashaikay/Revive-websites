# Decision Log

## 2026-09-14 - Keep Phase 4C durable authority local and disabled pending production approval
- **Decision:** Draft and rehearse the durable execution control plane only on isolated local Supabase; do not deploy it or activate execution/providers.
- **Authority:** Active owners/admins may decide approvals and prepare dry-run attempts. Members may propose ordinary work but cannot authorize execution; viewers are read-only.
- **Trust boundary:** Database roles, explicit ACLs, role-specific RLS, bound approval fingerprints, action versions, and durable idempotency control authority. Client-set custom session variables are not trusted.
- **Rollback:** Destructive rollback is allowed only before any Phase 4C policy, binding, version, execution, or usage evidence exists. After evidence exists, disable and forward-fix.
- **Consequences:** Local rehearsal is PASS, but production Phase 4C remains incomplete and requires separate preflight and deployment approval.

## 2026-09-14 - Apply Phase 4C controls without activating execution
- **Decision:** Apply only reviewed migration `20260914183000` to existing project `ntbowgutwyyhhnmkadlv` after all production preflight and backup gates passed.
- **Verification:** Production-safe 25-assertion RLS/ACL/approval/idempotency/append-only matrix passed inside a rolled-back transaction; protected quote/Telegram evidence remained identical.
- **Boundary:** No workspace policy was seeded, no execution attempt or provider usage persisted, platform execution remains false, and no provider or external action was invoked.
- **Consequences:** The durable control plane is installed. The first real capability remains a separate authorization decision.

## 2026-09-14 - Keep discovery provider-independent and mock-only in Phase 3F.1
- **Decision:** REV owns routing, qualification, evidence, cost control, compliance, deduplication, and conversion boundaries; providers only supply normalized evidence.
- **Chosen option:** Capability-based `DiscoveryProvider` contract and registry behind `DiscoveryRouter`, with deterministic mock data as the only active provider.
- **Reason:** A replaceable provider boundary prevents vendor lock-in, makes free-plan cost protection enforceable before execution, and keeps unsupported claims out of commercial workflows.
- **Consequences:** No external discovery or paid API is available yet. Provider retention terms, jurisdiction, consent, and quality must be reviewed before a real adapter is approved.

## 2026-09-14 - DataForSEO remains behind a trusted-runtime setup gate in Phase 3F.2
- **Decision:** Prepare a server-only DataForSEO Business Listings adapter, but do not instantiate or call it until credentials, billing/terms approval, a trusted execution handler, and bounded cost controls are configured.
- **Reason:** DataForSEO requires Basic Auth credentials, charges per task and item, has a published minimum payment, and retains task data for up to 365 days. Browser execution would expose credentials and bypass platform controls.
- **Consequences:** GB-only enforcement and normalization are ready for review; no real business discovery has occurred and no paid provider is active.

## 2026-09-14 - Treat Companies House as verification evidence, never a business-existence gate
- **Decision:** A missing Companies House match yields `NOT_FOUND` registry verification and leaves entity type `UNKNOWN`; it never means the business is fake, a sole trader, or commercially unsuitable.
- **Reason:** UK sole traders, partnerships, trading names, emerging businesses, pre-launch businesses, and other legitimate trading presences may not appear as a matching incorporated company.
- **Consequences:** REV maintains separate business presence, registry verification, evidence, and commercial qualification boundaries. Companies House remains optional verification, not discovery authority.

## 2026-09-14 - Keep Companies House execution server-only and stop before credentials
- **Decision:** Implement and test the real Companies House adapter behind a trusted-runtime boundary, but do not configure a key, deploy a function, or call the API until the authenticated workspace handler and provider setup are approved.
- **Reason:** Companies House API keys must not reach React/browser code, and a free API still needs workspace/platform rate limiting, idempotency, usage accounting, and failure isolation.
- **Consequences:** The adapter is ready for a controlled test; Phase 3F.2C remains blocked with £0 external spend.

## 2026-09-14 - REV orchestrates FIND, AUDIENCE, and RECOVER as one commercial intelligence loop
- **Decision:** Use one deterministic commercial plan service over workspace-scoped Business Brain, goals, contacts, opportunities, discovery evidence, and cost context.
- **Reason:** REV is the employee/orchestrator; FIND, AUDIENCE, and RECOVER are routes it selects, not disconnected CRM features or separate agents.
- **Safety:** Signals are not Opportunities, recommendations are not REV Actions, and potential/recoverable value is never Won Revenue. Audience safety blocks sensitive-person profiling and allows legitimate business/channel hypotheses.
- **Consequences:** Phase 3G remains mock/internal-data only. Recommendations require approval and never execute automatically.

## 2026-09-14 - Platform execution remains disabled while readiness is developed
- **Decision:** Evaluate approved actions through a capability registry and deterministic execution policy, but produce dry-run plans only while `PLATFORM_EXECUTION_ENABLED = false`.
- **Safety:** Approval is not execution; model output is not tenant authority; external communication, financial, and high-risk capabilities remain disabled.
- **Consequences:** REV can explain readiness without producing an external side effect.

## 2026-09-14 - Keep REV RECOVER derived from existing evidence and separate from revenue
- **Decision:** Detect only recovery signals supported by current contacts/opportunities, keeping unsupported quote, invoice, renewal, and repeat-service concepts out of the product until their evidence model exists.
- **Safety:** Potential/recoverable value is not Won Revenue or REV Recovered. `NOT_FOUND`/missing data never becomes an invented estimate, and recovery analysis produces no Contact, Opportunity, Memory, outreach, or execution side effect.
- **Consequences:** REV can prioritize existing leakage before acquisition when evidence supports it, while preserving the same FIND/AUDIENCE/RECOVER orchestration and approval gates.

## 2026-09-14 - Keep commercial plan handoff supervised and reuse REV Actions/Approvals
- **Decision:** A recommendation becomes a proposed REV Action only after an explicit owner `Review Action` click; the existing REV Action and Approval services remain the sole workflow.
- **Safety:** Approve/Edit/Reject records owner intent only. Approved actions remain `APPROVED — NOT EXECUTED`; no provider, outreach, payment, booking, revenue, or attribution occurs.
- **Consequences:** GROWTH remains intelligence, REV remains supervised employee work, and execution requires a future separately approved phase.

## 2026-08-25 — Protect the live Revive Websites site as a separate public marketing surface
- **Decision:** Keep the existing marketing website untouched and isolated as a production public asset.
- **Alternatives considered:** Rewrite it into the app, inline the app into the same domain, repurpose it all at once.
- **Chosen option:** Separate the active site from the future Revive AI app with a clear boundary and a new app workspace.
- **Reason:** Minimizes risk to the live site and follows the project requirement to protect the existing website.
- **Consequences:** The public site remains stable while the customer platform is designed in controlled phases.

---

## 2026-08-25 — Use master-control documentation as the source of truth
- **Decision:** All project status, roadmap, logs, and phase tracking will live in REVIVE_AI_MASTER.
- **Alternatives considered:** Rely on ad hoc notes or conversational memory.
- **Chosen option:** Centralize permanent project state in the master-control directory.
- **Reason:** Required for continuity and handover safety.
- **Consequences:** Future sessions can resume from a single source of truth.

---

## 2026-08-25 — Do not begin application implementation before Phase 1 architecture
- **Decision:** No AI Business Hub feature development will start until the architecture specification is complete.
- **Alternatives considered:** Begin building app shell immediately.
- **Chosen option:** Finish baseline and architecture planning first.
- **Reason:** This preserves security, reduces rework, and prevents early architecture mistakes.
- **Consequences:** The app will be built in a more controlled and lower-risk sequence.

---

## 2026-09-12 — STRATEGIC PIVOT: From Website Builder to AI Employee (REV)
- **Decision:** Revive transforms from an AI website-builder product to REV — a goal-driven AI employee platform for small businesses.
- **Alternatives considered:**
  1. Continue with website builder as primary product
  2. Pivot to chatbot-only product
  3. Pivot to AI employee with website building as side feature
- **Chosen option:** Goal-driven AI employee (REV) with website builder repositioned as a REV skill/capability.
- **Reason:** 
  - Website builder alone has limited defensibility
  - Small business owners care about business outcomes (revenue, leads, meetings)
  - REV as business employee is more valuable and defensible
  - Website generation becomes more powerful when informed by Business Brain
  - Multi-tenant architecture supports many vertical playbooks
  - Measurable ROI justifies higher price points
  - Long-term acquisition appeal as mature SaaS
- **Consequences:**
  - Complete architecture redesign (multi-tenant, not single-business)
  - Focus shifts from feature volume to business intelligence
  - Product complexity higher but business value much greater
  - Implementation sequence completely reordered
  - Security and tenant isolation become critical requirements
  - All documentation must be rewritten

---

## 2026-09-12 — Goals as First-Class Product Objects
- **Decision:** Goals are not tasks or sub-features—they are first-class product objects with rich structure.
- **Alternatives considered:**
  1. Goals as simple text labels
  2. Goals as tasks with higher priority
  3. Goals embedded in other features
- **Chosen option:** Goals as full objects with target values, timeframe, progress tracking, strategies, and outcome recording.
- **Reason:**
  - REV's primary purpose is moving businesses toward goals
  - Every action should be evaluated by impact on goals
  - Outcome tracking requires goal anchoring
  - Enables goal-driven recommendations and autonomy
- **Consequences:**
  - Data model complexity increases
  - All features must integrate with goals
  - Daily Brief centered on goal progress
  - Approval Centre considers goal impact

---

## 2026-09-12 — Multi-Tenant Workspace Isolation with Row-Level Security
- **Decision:** Strict tenant isolation enforced at database level (RLS) from day 1, not as an afterthought.
- **Alternatives considered:**
  1. Row-Level Security added later
  2. Application-level filtering (less safe)
  3. Separate database per tenant (operationally complex)
- **Chosen option:** PostgreSQL RLS policies on all tables, enforced by database constraints.
- **Reason:**
  - Maximum security (database-level, not application-level)
  - No risk of query bugs leaking data
  - Simpler to test and audit
  - Reduces operational complexity vs. per-tenant databases
  - Industry best practice for multi-tenant SaaS
- **Consequences:**
  - Requires PostgreSQL (not SQLite)
  - Slightly higher complexity in schema design
  - Must be tested exhaustively
  - All queries automatically scoped to workspace

---

## 2026-09-12 — Business Brain as Knowledge Layer
- **Decision:** REV operates from a shared knowledge layer (Business Brain) rather than conversational memory alone.
- **Alternatives considered:**
  1. Rely on LLM conversational memory
  2. Business Brain in external documents
  3. Business Brain as task definitions
- **Chosen option:** Business Brain as structured database with business profile, services, locations, FAQs, policies, brand.
- **Reason:**
  - Structured data is more reliable than conversational memory
  - Enables consistent personalization across channels
  - Allows version history and auditing
  - Supports multi-user workflows (team members update brain)
  - Foundation for industry playbooks and advanced features
- **Consequences:**
  - Additional data model complexity
  - Onboarding requires Business Brain setup
  - Updates to brain must be reviewed
  - Tools for Business Brain management required

---

## 2026-09-12 — Approval Centre for REV Autonomy Control
- **Decision:** V1 defaults to Autonomy Level 1 (Assistant)—all external actions require human approval. Advanced autonomy levels deferred.
- **Alternatives considered:**
  1. Full autonomy from day 1
  2. Approval optional for some actions
  3. Autonomy levels per action type
- **Chosen option:** Mandatory approval gate for all external actions in V1. Progress to Level 2-4 in future phases.
- **Reason:**
  - Prioritizes safety and operator control
  - Maximizes operator visibility and learning
  - Reduces risk of AI mistakes affecting business
  - Allows operators to refine prompts and strategies
  - Builds trust with early customers
- **Consequences:**
  - Slower action execution (approval delay ~2 hours)
  - Approval Centre is critical product feature
  - Operator must be responsive
  - Later autonomy levels require trust building

---

## 2026-09-12 — Action Engine with Provider Abstraction
- **Decision:** Action Engine (email, calendar, SMS, etc.) abstracts provider implementations. Providers are pluggable.
- **Alternatives considered:**
  1. Hardcoded to one provider per channel
  2. Direct provider calls throughout codebase
  3. Monolithic integration layer
- **Chosen option:** Provider interface with pluggable implementations, allowing provider replacement.
- **Reason:**
  - Avoids lock-in to single provider
  - Allows testing with mock providers
  - Supports customer provider preferences
  - Simplifies testing and reliability
  - Cost management (switch to cheaper provider if needed)
- **Consequences:**
  - Initial abstraction work
  - Slightly higher architectural complexity
  - Easier to add new integration channels

---

## 2026-09-12 — No Paid External Services in Phase 1
- **Decision:** Phase 1 uses free/cheap services only (free tier Claude/GPT, no email provider, no SMS, no data enrichment).
- **Alternatives considered:**
  1. Connect production services immediately
  2. Limited paid services (e.g., just email)
  3. Free tier only where possible
- **Chosen option:** Completely free/cheap until production-ready. Credits/metering system designed but deferred.
- **Reason:**
  - Keeps early development cost low
  - Avoids production credentials in development
  - Allows architecture to stabilize before scaling
  - Reduces financial risk of design mistakes
  - Can add premium features and paid services later
- **Consequences:**
  - Limited email provider options
  - No SMS/WhatsApp until Phase 4+
  - AI usage limited (free tier)
  - Prospect data limited
  - Production will require service activation

---

## 2026-09-12 — Website Builder Repositioned as REV Skill (Not Core Product)
- **Decision:** AI website generator becomes a REV capability/skill, not the center of the platform.
- **Alternatives considered:**
  1. Keep website builder as primary product
  2. Website builder as separate product
  3. Website builder removed entirely
- **Chosen option:** Website generation as a REV skill, informed by Business Brain and campaign context.
- **Reason:**
  - Website builder alone is commodity
  - When informed by Business Brain and campaign, it's much more valuable
  - Reduces feature complexity for V1 (deferred to Phase 10)
  - Aligns with goal-driven philosophy
  - Owners can say "REV, create a page for this campaign"
- **Consequences:**
  - Website builder doesn't ship in V0.1-V0.6
  - Not a differentiator until later
  - Requires Business Brain to be useful
  - Deferred to Phase 10

---

## 2026-09-12 — Industry Playbooks Architecture
- **Decision:** Vertical playbooks (Trades, Property, Beauty, etc.) use single REV core with different configuration, not separate codebases.
- **Alternatives considered:**
  1. One codebase per vertical
  2. Generic one-size-fits-all
  3. Playbooks hard-coded to platform
- **Chosen option:** Playbook as configuration (workflows, templates, rules, compliance) on top of single REV engine.
- **Reason:**
  - Reduces maintenance burden
  - Enables rapid expansion to new verticals
  - Consistent user experience across verticals
  - Shared research and learning across industries
  - Increases acquisition targets
- **Consequences:**
  - Playbook framework required in architecture
  - Configuration management complexity
  - Requires flexible templating system
  - Testing across playbooks increases coverage

---

## 2026-09-12 — Internal Test Workspaces (Revive, Family Legacy)
- **Decision:** Revive and Family Legacy become the first real workspaces, using REV to grow their own businesses.
- **Alternatives considered:**
  1. Internal testing separate from product
  2. Mock test data only
  3. No internal dogfooding
- **Chosen option:** Revive and Family Legacy use REV in production as first customers.
- **Reason:**
  - Proves product value internally
  - Generates real case studies
  - Identifies missing features early
  - Builds confidence in product
  - Easy iteration with direct feedback
  - Family Legacy remains separate tenant (not special-cased)
- **Consequences:**
  - Internal team learns platform deeply
  - Real business data in system
  - Potential for cross-workspace scenarios (testing features)
  - First live outcome tracking available

---

## 2026-09-12 — Technology Stack Selection
- **Decision:** React + Node.js + PostgreSQL with provider-agnostic AI orchestration; Anthropic, OpenAI, and future compatible providers remain pluggable
- **Alternatives considered:**
  1. Next.js (more opinionated than React)
  2. Python backend (less suitable for real-time)
  3. Different database (SQLite for simple, MySQL for cost)
  4. Claude only (no fallback)
- **Chosen option:** React (flexible), Node.js (fast, scalable), PostgreSQL (RLS support), Claude (primary), GPT fallback.
- **Reason:**
  - React: Large ecosystem, flexible, component-based
  - Node.js: Event-driven, real-time capable, same language as frontend (eventual)
  - PostgreSQL: RLS support, mature, open-source, Supabase option
  - Claude: Better reasoning, lower hallucination, Anthropic reliability
  - GPT fallback: If Claude unavailable, alternate provider
- **Consequences:**
  - JavaScript/TypeScript across stack (consistency)
  - PostgreSQL operational requirements
  - Claude API costs increase with scale
  - RLS testing required
  - TypeScript reduces runtime errors

---

## 2026-09-12 — Implement Phase 1 First (Architecture Only)
- **Decision:** Phase 1 is purely architecture and documentation. No code implementation in Phase 1.
- **Alternatives considered:**
  1. Write code while designing (concurrent design + development)
  2. Skip documentation, proceed to Phase 2 immediately
  3. Minimal documentation, iterate later
- **Chosen option:** Complete all architecture, design, data models, and decisions before writing code.
- **Reason:**
  - Prevents rework and refactoring later
  - Ensures all stakeholders aligned before implementation
  - Catches design flaws early (low cost to change)
  - Provides clear specification for Phase 2
  - Reduces implementation risk
- **Consequences:**
  - Phase 1 timeline ~2-3 weeks (slower to first code)
  - But reduces Phase 2-6 timeline (better specification)
  - Clear handover to development team
  - Fewer surprises during implementation

---

## 2026-09-12 — Proposed V0.1-V0.7+ Implementation Sequence
- **Decision:** Implement in 7+ phases: Foundation, Outreach, Calendar, Website Lead Agent, Voice, Marketing, Website Builder, Advanced features.
- **Reason:** Each phase adds value incrementally, tests integration, and allows learning before next phase.
- **Sequence:**
  - V0.1: Core app, auth, workspace, business brain, goals, approval centre
  - V0.2: Outreach and prospect research
  - V0.3: Calendar and meetings
  - V0.4: Website lead chatbot
  - V0.5: Voice/missed calls
  - V0.6: Marketing expansion
  - V0.7+: Website builder, advanced autonomy, playbooks
- **Consequences:**
  - MVP available by V0.3 (core business features)
  - Website builder deferred (not blocking MVP)
  - Clear production readiness gates between phases
  - Can pause/pivot between phases based on feedback

---

## Architecture Review & Approval Gates

All strategic decisions above are documented and ready for review.

**Decision Categories:**
- ✅ Product Direction (Strategic Pivot, Goals, MVP scope)
- ✅ Architecture (Multi-tenant, Business Brain, Action Engine)
- ✅ Technology (Stack selection)
- ✅ Implementation (Phases, Autonomy model)
- ✅ Safety (Approval Centre, Security, Audit trails)

**Next Action:** Approval to proceed from strategic stakeholders before Phase 2 begins.
