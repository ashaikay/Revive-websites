# MASTER BUILDER — Revive AI Product Vision & Platform Strategy

**Last Updated:** 2026-09-12  
**Phase:** 1 — Architecture  
**Status:** In Progress

---

## Executive Summary

Revive is transitioning from an AI website-builder product to **REV — a goal-driven AI employee platform for small businesses**.

REV operates as a persistent business agent that helps small business owners:
- **Get found** (prospecting and visibility)
- **Capture leads** (inbound and outbound qualification)
- **Respond quickly** (communication and engagement)
- **Follow up** (persistent relationship management)
- **Book meetings** (calendar and appointment management)
- **Recover lost opportunities** (reactivation and rescue)
- **Create marketing** (content and campaign generation)
- **Grow revenue** (measurable business outcomes)

REV is NOT a chatbot. It is an **autonomous business agent** working toward persistent business goals within carefully managed approval boundaries.

---

## Strategic Product Separation

### A. REVIVE WEBSITES (Existing)
- **Purpose:** Public marketing, lead acquisition, product explanation
- **Audience:** Prospective customers and external visitors
- **Functions:** Pricing, testimonials, demonstrations, signup, login
- **Status:** PROTECTED — must remain operational and unchanged
- **Deployment:** Static website (Netlify or similar)
- **Boundary:** Public internet — no authentication required

### B. REV SaaS APPLICATION (New)
- **Purpose:** Authenticated customer workspace for business goal execution
- **Audience:** Small business owners and team members
- **Functions:** Workspace, goals, leads, customers, email, approvals, business brain
- **Architecture:** Multi-tenant SaaS platform
- **Planned Subdomain:** app.[Revive domain]
- **Security:** Authentication required, strict tenant isolation
- **Boundary:** Private authenticated application

---

## Architectural Philosophy

REV is designed around the **OBSERVE → THINK → RECOMMEND → APPROVE → ACT → MEASURE → LEARN → REPEAT** operating loop.

The platform is built from **separable layers**:

```
BUSINESS GOALS & OBJECTIVES
↓
BUSINESS BRAIN (Knowledge)
↓
REV INTELLIGENCE (Reasoning)
↓
ACTION ENGINE (Execution)
↓
BUSINESS MEMORY (Persistence)
↓
MEASURABLE OUTCOMES (Results)
```

**Key Principles:**
1. **Goal-Driven:** Goals are first-class product objects, not afterthoughts
2. **Autonomous but Safe:** REV recommends and executes within explicit approval boundaries
3. **Persistent:** Operates across sessions toward long-term business objectives
4. **Measurable:** Every action connects to business outcomes and goal progress
5. **Multi-Tenant:** Strict data isolation—Business A's data never leaks into Business B
6. **Business-User-Friendly:** Simple UI for non-technical SME owners
7. **Provider-Agnostic:** Core intelligence separated from AI/email/integrations
8. **Audit-Ready:** Full action history, approval chain, and outcome tracking

---

## Product Core: The MVP Platform

Version 1 freezes around these **13 core modules**:

### Foundation Modules
1. **Business Workspace** — Isolated multi-tenant customer environment
2. **Business Brain** — Knowledge layer: business profile, services, products, locations, FAQs, brand
3. **Goals Engine** — Persistent business objectives with progress tracking
4. **Business Memory** — Structured data store for all operational information

### Action Modules
5. **REV Conversational Interface** — Agent-style chat with reasoning visibility
6. **Leads & Prospects** — First-class lead objects with qualification state
7. **Customers** — Relationship and communication history
8. **Outreach Preparation** — Research, fit analysis, scoring, draft generation
9. **Email Workflow** — Send, reply detection, threading, follow-up management
10. **Follow-Up Management** — Persistent task tracking and deadline management

### Intelligence Modules
11. **Daily Business Brief** — Proactive summary: opportunities, replies, goal progress
12. **Approval Centre** — Review, edit, approve, or reject REV recommendations and actions
13. **Basic Measurable Results** — Dashboards: leads, responses, meetings, revenue

**Strict MVP Constraint:** No feature creep. Each module is lean, focused, and proven before expansion.

---

## Future REV Capabilities (Not in V1)

These will be added as **REV Skills/Capabilities** using the same platform, not as separate products:

- **Website Lead Agent** — Chatbot for Revive Websites, feeds leads into REV
- **Appointment Booking** — Calendar integration and meeting scheduling
- **Missed-Call Recovery** — Phone system integration
- **SMS/WhatsApp** — Direct customer communication
- **REV Voice/Receptionist** — AI voice for inbound calls
- **Quote/Proposal Generation** — Document creation workflow
- **Customer Reactivation** — Win-back campaigns
- **Reviews & Referrals** — Review collection and referral management
- **Social Media** — Content posting and scheduling
- **Advertising** — Campaign creation and management
- **Website Generation** — AI website builder (repositioned as REV capability)
- **Advanced Autonomy** — Progressive autonomy levels 2-4

---

## Industry Playbooks Architecture

REV is designed so specialized playbooks can be added without duplicating core platform.

Each playbook contains:
- Domain-specific knowledge and terminology
- Pre-configured workflows
- Qualification rules and templates
- Compliance requirements and rate limits
- KPI definitions and success metrics

**Planned Industry Playbooks:**
- **REV Trades** — Plumbers, electricians, HVAC (quote → appointment → follow-up → repeat)
- **REV Property** — Real estate (buyer/seller qualification → viewing → offer)
- **REV Beauty** — Salons, spas (booking → service → rebooking)
- **REV Automotive** — Car dealers and services (enquiry → appointment → follow-up)
- **REV Professional Services** — Consulting, legal, accounting (lead → consultation → proposal)

Each playbook operates on the same core REV engine with different configuration, not separate codebases.

---

## Multi-Tenant Business Memory Architecture

**Critical Requirement:** Strict tenant isolation from day 1.

Every business workspace contains isolated operational data:

### Business Profile
- Business name, registration, location(s)
- Service areas and operating hours
- Brand guidelines, logo, tone

### Business Knowledge
- Services and products catalog
- Pricing (where applicable)
- FAQs and policies
- Uploaded documents and knowledge base

### Business Relationships
- Leads and prospects (with scores, stage, value)
- Customers (with history, lifetime value)
- Partnerships and connections

### Business Operations
- Goals and objectives
- Campaigns and outreach
- Email conversations
- Meeting schedules
- Quotes and proposals
- Tasks and follow-ups
- REV recommendations and actions

### Business Intelligence
- Opportunity scores
- Revenue tracking (won, lost, pipeline)
- Goal progress
- Performance metrics
- Historical outcomes

**Tenant Isolation Strategy:**
- Authentication enforces workspace membership
- Row-Level Security (RLS) filters all queries by workspace ID
- No query can access data outside the requesting workspace
- Audit logs record who accessed what, when, why
- Data export/deletion respects workspace boundaries

---

## REV Autonomy Model

REV progresses through defined autonomy levels:

### **Level 1 — ASSISTANT** (V1 Default)
- REV researches, analyzes, and drafts
- REV makes recommendations
- **Human must approve** before external action
- Typical approval time: < 2 hours
- Actions requiring approval: outbound campaigns, customer responses, pricing commitments

### **Level 2 — SUPERVISED**
- REV can execute pre-approved routine actions
- Important decisions escalate for approval
- Example: Follow-up emails to existing prospects (pre-approved template)

### **Level 3 — AUTONOMOUS**
- REV works toward goals within explicit business rules
- Automatic escalation for exceptions
- Example: Prospect research and scoring (rule-based thresholds)

### **Level 4 — ADVANCED AGENT**
- REV optimizes across goal types
- Requests human input for strategic decisions only

**V1 Safety:** Favour human approval. Maximize operator visibility and control.

---

## The Approval Centre

The **Approval Centre** is a first-class product module where operators review REV's recommendations and actions.

### Approval Workflow
1. REV identifies an opportunity or generates a recommendation
2. Recommendation appears in Approval Centre with:
   - REV's reasoning (visible)
   - Impact forecast
   - Proposed action (draft or prepared message)
   - Historical context
3. Operator can:
   - **APPROVE** — REV executes exactly as drafted
   - **EDIT** — Change the draft, then approve
   - **REJECT** — Decline and provide feedback
4. Action is recorded with approval timestamp and operator identity
5. Outcome is tracked and feeds back into REV's learning

**Audit Trail:** Every approval, edit, rejection, and execution is logged with:
- Timestamp
- Operator ID
- Original recommendation
- Approval state
- Actual execution
- Outcome (if applicable)

---

## Business Brain Architecture

The **Business Brain** is REV's common knowledge layer about the business.

### Onboarding Flow (Eventual Target)
1. Operator provides business website
2. Operator provides basic information: name, services, pricing, locations
3. REV analyzes permitted business materials
4. REV constructs initial Business Brain structure
5. Operator reviews, corrects, refines
6. Business Brain becomes the reference for all REV capabilities

### Business Brain Contents
- Who are we? (business profile, brand, values)
- What do we do? (services, products, pricing)
- Where do we operate? (locations, service areas)
- Who do we serve? (ideal customer profile, target markets)
- What makes us different? (differentiators, competitive advantages)
- How do we work? (processes, workflows, policies)
- What's our knowledge? (FAQs, common objections, technical info)
- What's our history? (past campaigns, learnings, outcomes)

### Usage Across REV
- **Prospecting:** Who is a good fit?
- **Outreach:** How to personalize the message?
- **Responses:** How to handle this inquiry?
- **Pricing:** What should we quote?
- **Escalation:** What decision authority does this require?

---

## Goals Engine

**Goals are first-class product objects.**

Every goal contains:

```
{
  objective: "Book 5 sales meetings this month",
  metric: "meetings_booked",
  target_value: 5,
  timeframe: "monthly",
  current_progress: 2,
  status: "on_track" | "at_risk" | "stalled",
  priority: "high" | "medium" | "low",
  strategies: [...],          // Associated campaigns and playbooks
  associated_leads: [...],    // Which prospects contribute to this goal?
  associated_actions: [...],  // What has REV done for this goal?
  results: {...},             // Outcome tracking
  owner: "...",               // Who owns this goal?
  created_at: "...",
  updated_at: "..."
}
```

### Goal-Driven REV
Every action REV considers is evaluated against: **"Which goal does this move us toward?"**

REV continuously recommends actions ranked by impact on goal progress.

### Daily Business Brief Integration
The home experience is anchored on goals:

```
Good morning, [Owner].

GOAL: Book 5 new sales meetings this month
├─ Progress: 2/5 (40%)
├─ Current hot leads: 3
├─ Replies needing attention: 4
└─ Meetings scheduled: 1

REV WORKED WHILE YOU WERE AWAY
├─ Prospects researched: 14
├─ Strong matches identified: 8
├─ Outreach messages prepared: 6
└─ Replies received: 3

REV RECOMMENDS
"Respond to the highest-value opportunity first."

[APPROVE] [REVIEW] [REJECT]
```

---

## Future Features: Website Builder

The AI website-builder capability is **not removed**—it's repositioned.

**Old Model:** Website builder is the center of Revive
**New Model:** Website builder is a REV capability/skill

### REV-Powered Website Generation
1. REV already understands the business through the Business Brain
2. Owner says: "REV, create a landing page for our new boiler installation offer"
3. REV uses:
   - Business knowledge (brand, services, tone)
   - Campaign context (goals, target audience)
   - Previous performance (what worked before)
4. REV drafts the page
5. Operator reviews and approves
6. Page is published

This is **far more valuable** than an isolated website generator because it's contextual and integrated.

---

## Proposed Implementation Sequence

### V0.1 — Foundation
- Application shell and architecture
- Authentication and workspace isolation
- Business Brain structure and UI
- Goals module
- REV conversational interface
- Leads and customers (basic)
- Business Memory layer
- Daily Business Brief
- Approval Centre

### V0.2 — Outreach
- Opportunity research workflow
- Prospect fit analysis and scoring
- Outreach message preparation
- Email integration (read-only connection)
- Reply detection and threading
- Follow-up task creation

### V0.3 — Calendar
- Calendar integration
- Meeting booking
- Meeting reminders

### V0.4 — Website Lead Agent
- Chatbot for Revive Websites
- Lead capture into REV

### V0.5+ — Future Capabilities
- Voice/missed calls
- SMS/WhatsApp
- Social media
- Reviews and reactivation
- Advanced autonomy

---

## Long-Term Positioning

REV is architected as a **serious commercial SaaS** that could eventually be acquisition-quality.

### Defensibility Factors
1. Business operational memory (multi-year learning)
2. Goal and outcome history (track record of ROI)
3. Workflow intelligence (what works for this business type)
4. Industry playbooks (verticalized intelligence)
5. Business integrations (calendar, email, systems)
6. Measurable ROI (revenue attributed to REV)
7. Customer usage history (switching cost)
8. Reliable action infrastructure (proven consistency)
9. Security and tenant isolation (enterprise-grade)
10. Increasing usefulness as REV learns (network effects)

---

## Constraints & Guardrails

### DO NOT
- Modify or risk the existing Revive Websites marketing site
- Connect/reconnect Supabase, Stripe, or paid APIs during this phase
- Perform major application implementation
- Start customer-facing feature development
- Deploy any customer data processing

### DO
- Complete all architecture documentation
- Record all strategic decisions
- Plan for multi-tenant isolation from day 1
- Identify and mitigate risks
- Propose practical implementation sequence

---

## Master Authority

The Master Builder orchestrates and maintains:
- Product vision and strategy
- Architecture decisions
- Implementation sequencing
- Security and tenant isolation
- Risk management
- Documentation and handover
- Phase gate approvals

**Current Operator:** AI Architecture Phase 1  
**Next Gate:** Phase 1 architecture complete and approved
