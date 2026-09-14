# Phase 3A — REV Experience & Product Foundation Specification

**Status:** Design/architecture/documentation only. No application code, schema, RLS, AI API, external integration, marketing site, or legacy quotes/Telegram change was made in this phase.

**Preconditions:** Phase 2D.2 (read-only Supabase integration) and Phase 2D.2A (live browser Auth/tenant validation for Users A, B, C) are both PASS and preserved unchanged. See `PHASE_2D_2_INTEGRATION_REPORT.md`, `PHASE_TRACKER.md`, and `SECURITY_REGISTER.md`.

---

## 1. REV Product Experience Principles

REV is positioned as **"Your AI Growth Employee"**, not an AI tool, dashboard, or chatbot. The owner should never need to understand agents, models, prompts, workflows, APIs, or automation infrastructure.

Core operating loop, always visible in spirit even when not literally rendered:

```
OBSERVE → THINK → RECOMMEND → REQUEST APPROVAL (where required) → ACT → MEASURE → LEARN → REPEAT
```

Principles:

1. **One employee, not many bots.** Specialist capabilities (outreach, research, follow-up, etc.) are skills REV uses, never separate agents the owner must configure or switch between.
2. **Commercial accountability first.** Every REV surface should be traceable back to revenue found, protected, or recovered.
3. **Supervised by default.** REV V1 remains an approval-gated employee (Autonomy Level 1). Nothing external happens without either an approval or an explicitly pre-approved rule.
4. **Calm, not theatrical.** Activity indicators must reflect real system state once implemented; no fabricated "AI thinking" animation with no backing action.
5. **Small, legible surfaces.** Every screen answers a specific owner question rather than exposing a general-purpose data browser.

---

## 2. Information Architecture

Primary navigation stays exactly as already implemented and validated in Phase 2D.2A:

```
HOME | REV | CUSTOMERS | GROWTH | BUSINESS
```

No agent picker, no bot marketplace, no separate navigation branch per specialist skill. Specialist skills are entry points *inside* REV (workspace) and CUSTOMERS/GROWTH (contextual actions), never top-level nav items.

Information hierarchy across the app (highest to lowest priority everywhere):

1. Things requiring the owner's decision (approvals, urgent follow-ups)
2. Money in motion (won, at risk, recoverable, pipeline)
3. What REV is doing right now
4. Historical detail and configuration

---

## 3. HOME — Owner Command Centre (wireframe/spec)

**Purpose:** Answer, in order: *What happened? What needs my attention? What is REV doing? Where am I making or losing money?*

**Opening state:** A short, human greeting anchored to real data, e.g. "Good morning, Mike. REV has been working while you were away." Never shown if there is nothing to report — falls back to a calm steady-state greeting instead of a fabricated update.

**Layout (top to bottom priority):**

1. **Daily Business Brief (hero band)** — a compact, scannable summary, not a wall of numbers. Suggested fields, only shown when non-zero/relevant:
   - Revenue won (period)
   - Revenue in pipeline
   - Revenue at risk
   - Recoverable revenue
   - New opportunities
   - Leads requiring attention
   - Quotes requiring follow-up
   - Upcoming appointments
   - Reputation/reviews signal
   - Goal progress (single primary goal, not a full list)
2. **Needs Your Attention** — approvals waiting + urgent follow-ups, merged into one prioritized list, capped (e.g. top 5) with a link to see all in Approval Centre.
3. **What REV Is Doing** — condensed live activity feed (3–5 lines max), links through to the REV workspace for full detail.
4. **Quick Links** — CUSTOMERS / GROWTH / BUSINESS shortcuts framed around the day's most relevant task, not a generic menu duplicate.

**Design constraint:** Never render more than one "hero" band above the fold. If Daily Brief has nothing to show (new workspace), show a brief onboarding-style empty state instead of blank cards.

---

## 4. REV — AI Employee Workspace (wireframe/spec)

**Purpose:** The central place to direct REV and see its work, not a generic chat log.

**Layout:**

1. **Objective strip** — current business goal(s) REV is actively working toward, editable/settable by the owner.
2. **Conversation/task interface** — primary column; owner can type a goal or instruction, REV responds conversationally and can propose actions.
3. **Live activity surface** — a lightweight, real, streaming list such as:
   - "REV is researching prospects…"
   - "REV found 12 opportunities…"
   - "REV is preparing follow-ups…"
   - "REV identified 3 quotes at risk…"
   - "REV is checking customer responses…"
   Each line must map to an actual backend job/state once implemented (see Cost Governor and audit log integration in section 12/18). No line may be shown without a corresponding real system event.
4. **Recently completed work** — short list of finished REV actions with outcome (approved/rejected/executed/measured result).
5. **Recommendations** — REV-suggested next actions, distinct from items awaiting approval (recommendations are proposals; approvals are pending commitments).
6. **Approval requests** — surfaced here too (not just Approval Centre), scoped to this conversation/objective.
7. **Measurable outcomes** — a compact strip showing what REV's recent actions produced (e.g., replies generated, meetings booked, revenue influenced).

---

## 5. CUSTOMERS — Conceptual Structure

CUSTOMERS is the relationship/record layer, distinct from GROWTH (the revenue-motion layer). Structure:

- **Customer/Lead list** — segmented by lifecycle stage (new, active, dormant, reactivation candidate), not a flat CRM grid.
- **Customer detail** — conversation history, quotes, appointments, REV-recommended next action, and manual override controls.
- **Reactivation queue** — customers REV has identified as dormant-with-opportunity, feeding GROWTH's "recoverable revenue" concept.
- **Contact/communication log** — unified timeline (message, quote, appointment, note) per customer, sourced from the existing `contacts` domain model.

CUSTOMERS never shows raw internal REV reasoning; it shows outcomes and next actions only.

---

## 6. GROWTH — Revenue Intelligence Structure

GROWTH is REV's core differentiator: commercial accountability, not just activity tracking.

**Conceptual revenue chain** (product concept only, not implemented data pipeline in this phase):

```
Opportunity → Lead → Conversation → Appointment → Quote → Follow-up → Sale → Revenue → Repeat
```

**Surfaces to design for (concepts, not live financial data in Phase 3A):**

- WON REVENUE — closed/settled value attributable to a tracked opportunity
- REVENUE IN PIPELINE — open opportunities weighted by stage
- REVENUE AT RISK — stalled/aging opportunities past expected follow-up windows
- RECOVERABLE REVENUE — dormant customers/quotes REV has flagged as reactivation candidates
- REV GENERATED — value attributable to REV-initiated actions (new opportunity sourced by REV)
- REV RECOVERED — value attributable to REV reactivating a stalled/lost opportunity

**Layout:** A funnel/stage view (chain above) plus a compact "money moved by REV" summary. Every number must be traceable to an underlying record (opportunity, quote, sale) — no aggregate figure without drill-down.

---

## 7. BUSINESS — Structure

BUSINESS remains the read-oriented Business Brain surface already implemented (profile + services), extended conceptually to:

- **Business Profile** — identity, positioning, target customer, service area (existing).
- **Services** — what the business sells (existing).
- **Goals** — the business objectives REV is optimizing for (links to REV workspace objective strip).
- **Policies/Constraints** — tone, compliance limits, things REV must never claim or do (feeds Quality Gate, section 9).

No new data-entry workflows are implemented in Phase 3A; this section documents where they will live.

---

## 8. Approval Centre UX

REV V1 remains supervised. Approval Centre keeps its existing architecture (approvals table/service) and gets a consistent interaction pattern reused everywhere an approval surfaces (HOME, REV workspace, CUSTOMERS, Approval Centre itself):

```
REV NEEDS YOUR APPROVAL
<plain-language summary of the proposed action and its expected effect>
[Approve]   [Edit]   [Reject]
```

Rules:

- **Approve** executes exactly what was previewed — no silent modification between preview and execution.
- **Edit** opens an editable draft; re-submitting re-enters the Quality Gate (section 9) before becoming approvable again.
- **Reject** requires no justification but may optionally capture a reason to improve future recommendations.
- Actions requiring approval (V1 scope): outbound messages, campaigns, quotes, public posts, other external customer-facing communication, and any other external action.
- Approval Centre lists all pending approvals across the workspace; contextual approval surfaces (HOME, REV workspace) show only the most relevant subset.

---

## 9. REV Activity System

Defines how "REV is doing X" activity lines are produced and displayed, so they never become fabricated theatre:

```
Agent/Capability Work → Quality Check → Policy/Safety Check → Approval (if required) → Execution
```

- Every activity line displayed to the owner must correspond to a real, loggable unit of work (a job/task record), even while the underlying capability is still mock/local in earlier phases.
- Activity lines have a lifecycle: `queued → in_progress → completed | blocked_on_approval | failed`.
- The UI subscribes to real state transitions; it does not simulate progress with timers or fixed-duration animations.
- Completed activity feeds "Recently completed work" (REV workspace, section 4) and the Daily Brief (section 3).

**Quality Gate (future logic, documented only in Phase 3A):**

Quality Gate is the mandatory checkpoint between REV producing work and that work becoming approvable/executable. It will eventually verify:

- Factual accuracy against Business Brain/Business Memory (no invented facts)
- Tone/brand consistency
- Business rule compliance (pricing, service area, capacity)
- Duplicate detection (don't re-contact/re-quote unnecessarily)
- Unsupported claims (flagged as `EVIDENCE REQUIRED`, see section 12)
- Risk classification (does this need approval, and at what severity)
- Regulatory/compliance constraints (GDPR, CAN-SPAM, sector-specific rules)

No Quality Gate logic is implemented in Phase 3A; this is a specification for future phases.

---

## 10. Daily Business Brief

Already introduced in section 3 (HOME). Additional rules:

- The Brief is generated once per day (or on-demand refresh) and is a **summary of change**, not a live-updating ticker — it should feel like a briefing, not a stock ticker.
- Every Brief line must be explainable ("why is revenue at risk £X?" → drill-down to the underlying opportunities).
- The Brief adapts to workspace maturity: a brand-new workspace gets an onboarding-oriented Brief ("Let's set your first goal"), not a broken/empty dashboard.

---

## 11. Specialist REV Skills — Architecture

Specialist capabilities plug into the single REV employee as **skills**, each with a consistent contract:

```
Skill name → Trigger (owner request or REV-initiated) → Inputs required →
Quality Gate → Approval (if required) → Execution → Measured outcome
```

Documented specialist skills (concepts, none implemented in Phase 3A):

- Outreach
- Lead Research
- Follow-Up
- Marketing
- Reviews/Reputation
- Bid Writer (see section 12)
- Grant Writer (shares Bid Writer's evidence discipline)
- Website/Conversion
- Customer Reactivation
- Scheduling
- Business Research

The owner interacts with REV, not with named bots; skill attribution is visible only as context ("REV used its Lead Research skill to find these 12 opportunities") rather than as a switchable persona.

---

## 12. Bid / Grant Writer (future capability, documented)

```
Find opportunity → Fit/eligibility analysis → Requirements extraction →
Evidence check → Draft → Quality Gate → Approval → Future submission
```

**Critical rule (non-negotiable, carried into all future implementation):** REV must never invent turnover, accreditations, policies, experience, outcomes, case studies, or qualifications. Any required fact not present in Business Brain/Business Memory must be rendered in the draft as:

```
EVIDENCE REQUIRED: <what is missing>
```

Drafts containing any `EVIDENCE REQUIRED` marker cannot pass Quality Gate or reach Approval until resolved by the owner supplying the missing evidence.

---

## 13. Motion / Visual Experience Strategy

**Desired feel:** human, energetic, intelligent, commercially focused, modern, simple, alive.

**Use purposeful motion for:**

- REV activity transitions (activity line appears/updates, not looping spinners)
- Cards entering/updating (Daily Brief, opportunity cards) — single subtle transition, not repeated
- Goal progress changes
- Approval notifications appearing
- Opportunity discovery (a new opportunity card animates in once)
- Completed work state change (pending → done)
- Daily Brief section transitions when refreshed

**Avoid:**

- Excessive animation or constant idle motion
- Gimmicky "AI thinking" effects with no backing state
- Generic dark-purple AI SaaS visual clichés
- Motion that competes with legibility during daily operational use

**Marketing vs. app:** the public marketing site (`index.html`, etc., already protected) may be more expressive; the operational REV app must stay calm enough for repeated daily use by a busy owner.

---

## 14. Responsive / Mobile Experience Rules

Mobile is not a shrunk desktop dashboard. Mobile navigation priority order:

```
Daily Brief → Approvals → REV conversation → Urgent opportunities → Customer follow-ups
```

Rules:

- Mobile HOME leads with the Daily Brief and the attention list; GROWTH/CUSTOMERS/BUSINESS become secondary tabs reached via the existing primary nav, collapsed into an icon/label bar.
- Approval actions (Approve/Edit/Reject) must be reachable within one tap from a mobile push/notification-style entry point (future notification channel; not implemented in Phase 3A).
- REV workspace on mobile prioritizes the conversation/activity feed over the full multi-column desktop layout; recommendations and outcomes collapse into expandable sections.
- No functionality is mobile-exclusive or desktop-exclusive; only information density and ordering change.

---

## 15. Empty / Loading / Error States

- **Empty (new workspace):** Every primary surface (HOME, REV, CUSTOMERS, GROWTH, BUSINESS) has a dedicated first-run empty state that explains what will appear and how to get started (e.g., "Set your first goal to see REV get to work"), not a bare "no data" message. This matches the already-implemented BUSINESS empty state ("No business profile has been created for this workspace.").
- **Loading:** Skeleton/placeholder states reflect the eventual layout shape; no indefinite spinners without a timeout/fallback message.
- **Error:** Errors are owner-facing in plain language (no stack traces, table names, or internal identifiers), with a retry action where applicable, and never silently fail an approval-gated action.
- **Auth/session errors:** Reuse the existing safe login-form error pattern validated in Phase 2D.2A; never expose backend error codes verbatim to the owner.

---

## 16. Accessibility Requirements

- All interactive elements (nav buttons, Approve/Edit/Reject, workspace selector) must be keyboard-operable and screen-reader labeled, consistent with the existing accessible nav/button markup already observed in the live app.
- Color must never be the sole signal for status (e.g., "at risk" revenue needs an icon/label, not just red text).
- Motion (section 13) must respect `prefers-reduced-motion`; all purposeful animations need a reduced/instant fallback.
- Minimum text contrast follows WCAG AA across HOME, REV, CUSTOMERS, GROWTH, BUSINESS.
- Daily Brief and activity feed updates must be announced to assistive technology in a non-disruptive way (e.g., polite live region), not forced focus jumps.

---

## 17. Free Plan — UX Implications (concept only, no billing implemented)

Potential future free tier, documented for product planning only:

```
£0 forever
1 workspace
1 REV employee
Limited REV actions/month
Business Brain
Controlled Business Memory
Daily Brief
Limited customers/leads
Basic opportunities
Basic approvals
Limited integrations
```

UX implications to design for later:

- Usage limits must be visible before they are hit (e.g., "3 of 10 REV actions used this month"), never a silent hard stop.
- Upgrade prompts appear contextually at the point of limitation, not as generic upsell banners.
- Free-tier Daily Brief and Approval Centre remain fully functional — the differentiator is action volume and advanced autonomy, not core safety/visibility features.

---

## 18. Future Cost Governor — UX Implications (concept only, not implemented)

**REV Cost Governor** (future backend concept) will:

- Classify task cost and route simple tasks to cheaper models or deterministic/database operations where AI is unnecessary
- Reserve stronger models for justified cases
- Limit deep research depth
- Control memory retrieval scope
- Track expensive external actions

**Memory tiers** (concept only):

```
Working Memory → Business Memory → Customer Memory → Long-Term Summaries → Audit/Event History
```

REV must never send a customer's complete business history to a model on every request; retrieval is scoped and tiered.

**UX implication:** The REV activity system (section 9) should eventually be able to show *why* something took longer or used a deeper capability (e.g., "REV used deep research for this" as a small, optional badge), without exposing model names, prompts, or infrastructure detail to the owner.

---

## 19. Implementation Sequence — Phase 3B Onward

```
Phase 3A — REV Experience Specification (this document; design only)
Phase 3B — App Shell + HOME
Phase 3C — REV Employee Workspace
Phase 3D — Growth & Revenue Intelligence
Phase 3E — Leads & Outreach Foundation
```

Each of 3B–3E should independently pass the same gates already proven in Phase 2D.2/2D.2A before moving on: mock-first implementation, explicit approval before any live/write Supabase connection, RLS/tenant isolation testing with real browser validation for multiple synthetic users, and no change to legacy `public.quotes`/Telegram behavior.

---

## Competitive Design Principle

REV should not become a clone of any existing AI business-software product. Explicit differentiation:

**YOUR AI GROWTH EMPLOYEE** — with commercial accountability: find opportunities → progress opportunities → recover missed revenue → help win business → measure results.

No proprietary layouts, imagery, wording, or visual assets from any competitor are to be copied; only the general lesson that AI business software can feel active, visual, and proactive is carried forward.
