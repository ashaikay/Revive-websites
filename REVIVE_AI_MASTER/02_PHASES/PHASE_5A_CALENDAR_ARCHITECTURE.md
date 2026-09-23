# Phase 5A - Calendar & Meetings Architecture

**Status:** Architecture and planning only. No calendar provider, OAuth flow, calendar read, event creation, schema change, or infrastructure change is authorized by this document.

**Date:** 2026-09-23

---

## 1. Purpose and Safety Boundary

Phase 5 introduces a provider-independent architecture for **customer meeting scheduling**. The intended outcome is a safe path from an evidence-backed customer request to a human-approved meeting proposal and, only in a later separately authorized phase, controlled event creation.

This phase authorizes documentation and architecture planning only. It does not authorize:

- Connecting Microsoft Graph, Google Calendar, or another calendar provider.
- Requesting, changing, or granting provider permissions.
- Reading calendar events, free/busy data, or availability.
- Creating, updating, cancelling, or deleting calendar events.
- Adding migrations, RLS policies, Edge Functions, provider configuration, or browser controls.

Provider execution remains disabled. Approval remains mandatory for any future external calendar action. No autonomous scheduling is permitted.

**Excluded domains:** employee/workforce scheduling, staff allocation, shifts, leave, skills/capacity planning, location allocation, travel-time calculation, dispatch, and route optimisation. Those are separate future domains and must not be inferred from customer meeting records.

---

## 2. Domain Boundaries

The calendar domain must be distinct from email, CRM next actions, and workforce scheduling.

| Concept | Purpose | Boundary |
| --- | --- | --- |
| `CalendarConnection` | Trusted server-side provider authorization and lifecycle state for one workspace. | Never exposes access/refresh tokens to browser code or client-readable records. |
| `SelectedCalendar` | The single calendar explicitly chosen by an owner/admin for a workspace pilot. | A selected calendar is not an implicit default from an email mailbox. |
| `AvailabilityWindow` | A normalized free/busy window and scheduling rule result. | Contains only the minimum interval and status needed to assess availability. |
| `MeetingProposal` | An internal, immutable-at-approval proposal for a customer meeting. | Not a provider event and not evidence that a meeting exists. |
| `MeetingAttendee` | A proposal attendee linked to a workspace Contact where available. | Stores only minimum meeting-addressing data; it is not a workforce assignment. |
| `MeetingOutcome` | A later recorded business outcome after a meeting has occurred or been confirmed. | Does not fabricate attendance, revenue, or opportunity progression. |
| `ProviderEventReference` | Provider-specific opaque reference and terminal outcome metadata. | Created only by a later trusted event-creation boundary. |

`contacts.next_action_at` and `opportunities.next_action_at` remain reminders/next-step markers. They must not be reused as event records, availability, or evidence that a meeting was booked.

`workspace_email_mailboxes` remains email mailbox routing. It must not be reused as calendar connection storage, calendar selection, or calendar authorization evidence.

---

## 3. Workspace and Authority Rules

- Every calendar-domain record and provider operation must have an explicit `workspace_id`.
- Active workspace membership is required for every read and preparation action.
- Only an active owner or admin may select/change a workspace calendar or approve external event creation.
- Members may prepare meeting proposals only when a workspace policy explicitly permits it; they cannot approve or create an external event.
- Viewers are read-only.
- Suspended members, outsiders, and cross-workspace references are denied.
- All foreign keys linking Contact, Opportunity, Proposal, Calendar, Attendee, Outcome, or provider attempt must be composite workspace-safe keys of the form `(workspace_id, id)`.
- Workspace identity fields must be immutable after creation. A dual-workspace member must not be able to move a calendar or meeting record between tenants.

---

## 4. Provider Strategy

Calendar contracts must be provider-neutral. Provider-specific code must run only in a trusted server boundary and accept an already-authorized, immutable meeting snapshot.

### Microsoft Graph first controlled pilot

The existing Graph integration is application-only client credentials with the `.default` scope, server-side credentials, a configured workspace mailbox, and a GET-only inbox reader. It is reusable for server-only authentication discipline, error handling, configured-resource selection, and the durable Phase 4C execution model. It is not a calendar connection model.

Two Microsoft options require a separate security/permission review before any implementation:

1. **Application permissions:** organization-admin consent and application access to calendar resources. This risks broad tenant visibility and must be limited through Exchange Application RBAC or equivalent resource scoping to explicitly authorized mailboxes/calendars.
2. **Delegated OAuth:** a user grants scoped access to their selected calendar. This reduces broad app authority but introduces consent, refresh-token, revocation, offboarding, and calendar-selection lifecycle requirements.

### Google Calendar later

Google Calendar delegated OAuth is a later provider option. It requires a separate trusted OAuth lifecycle, minimum reviewed scopes, selected-calendar binding, revocation/offboarding handling, and the same tenant/approval/idempotency controls as Microsoft.

Tokens, client secrets, authorization codes, refresh tokens, and service-role credentials must remain server-only. They must never appear in React, Vite variables, browser storage, client-readable tables, logs, prompts, audit metadata, or responses.

---

## 5. Availability Policy

The first provider integration, if separately approved, is read-only availability only:

- Read free/busy status only, not unrelated event bodies, descriptions, attendee lists, attachments, or private metadata.
- Use exactly one explicitly selected workspace calendar for the initial pilot.
- Require a workspace timezone. The FatherLegacy pilot default is `Europe/London` until an owner/admin explicitly changes it.
- Define workspace working hours, buffers before/after meetings, blackout periods, and minimum notice before offering or proposing a slot.
- Normalize provider responses into intervals and busy/free status only. Never persist unrelated event bodies or attendee details.
- Treat missing timezone, missing selected calendar, permission errors, ambiguous availability, or stale provider data as unavailable/review-required, never as free.

---

## 6. Supervised Meeting Lifecycle

The meeting lifecycle is independent from the generic `rev_actions.execution_status` while remaining bound to the existing action/approval control plane:

```text
draft -> awaiting_approval -> approved_not_created -> provider_claimed -> created
                                   |                       |
                                   -> rejected              -> failed
                                                           -> outcome_unknown
```

- `draft`: internal proposal only; no provider interaction.
- `awaiting_approval`: proposal is complete enough for owner/admin review.
- `approved_not_created`: approval binds the exact event snapshot; no event exists yet.
- `provider_claimed`: a later trusted execution boundary has atomically reserved the creation attempt.
- `created`: provider accepted/created the event and an opaque provider reference is recorded.
- `rejected`: owner/admin rejected the proposal; no provider interaction.
- `failed`: trusted provider attempt ended with a known failure and evidence is recorded.
- `outcome_unknown`: the provider outcome is ambiguous. Do not blindly retry; reconcile manually or through a separately designed idempotent provider query.

An approved proposal must not be treated as booked until `created` is supported by trusted provider evidence. A meeting outcome must not be inferred merely because an event exists.

---

## 7. Trusted Creation Boundary

Any later event creation must be a new `CREATE_CALENDAR_EVENT` capability. It is disabled by default and must not share email-send authorization merely because both use Microsoft Graph.

Before a provider call, a trusted server authority must derive and validate:

1. Active owner/admin authority, explicit workspace, and the workspace policy state.
2. The selected workspace calendar and its active authorized connection.
3. Workspace-bound Contact and optional Opportunity references.
4. The exact approved proposal snapshot: calendar, timezone, start/end interval, title, attendees, location/meeting mode, and relevant instructions.
5. Current action version and immutable approval fingerprint. Material changes require a fresh approval.
6. Capability, provider configuration, jurisdiction, consent/privacy constraints, and cost policy.
7. A durable workspace-scoped idempotency key and request fingerprint for the approved event snapshot.

The provider call occurs only after an atomic durable provider claim. The boundary must record audit and provider-usage evidence and persist one terminal result. `outcome_unknown` must not cause an automatic retry because that could create duplicate customer meetings.

Phase 4C `rev_action_executions` is the preferred durable control-plane candidate because it already supports workspace scope, action/approval binding, version/fingerprint checks, correlation, idempotency, locking, provider usage, audit, and backend-only outcomes. A later detailed design must determine whether a meeting-specific attempt table is necessary for provider event references and reconciliation metadata; it must not create a parallel unsafe execution path.

---

## 8. Proposed Schema for Later Review Only

**PROPOSAL ONLY - NOT AUTHORIZED OR APPLIED.** This section is a design inventory, not SQL authorization. No migration, RLS policy, function, grant, or remote schema change is approved by this document.

### `workspace_calendar_connections`

Purpose: one trusted provider authorization lifecycle per workspace/provider/connection identity.

Proposed columns/keys:

- `id`, `workspace_id`, `provider_key`, `connection_status`, `provider_account_reference`
- `token_reference` or trusted-secret reference only; never raw access/refresh tokens
- `authorized_by_user_id`, `authorized_at`, `revoked_at`, `last_verified_at`, `created_at`, `updated_at`
- `unique (workspace_id, id)` and a provider/account uniqueness rule selected after provider design

RLS intent: active members may read a minimal redacted connection status for their workspace; only owner/admin trusted flows may initiate/change connection state; token references and secret material are backend-only.

### `workspace_calendars`

Purpose: normalized provider calendar metadata and the one selected workspace calendar.

Proposed columns/keys:

- `id`, `workspace_id`, `connection_id`, `provider_calendar_reference`, `display_name`, `timezone`, `is_selected`, `active`
- `created_at`, `updated_at`; `unique (workspace_id, id)`
- one selected active calendar per workspace, enforced through a reviewed partial uniqueness rule or equivalent trusted transition

RLS intent: workspace-scoped readable metadata only; owner/admin trusted transitions select/unselect a calendar; no client token or provider-private metadata.

### `meeting_proposals`

Purpose: durable internal proposal bound to a `rev_action` and approval, before any provider event exists.

Proposed columns/keys:

- `id`, `workspace_id`, `rev_action_id`, `approval_id`, `calendar_id`
- optional `contact_id`, optional `opportunity_id`, `status`, `timezone`
- `starts_at`, `ends_at`, `title`, `location_mode`, `location_summary`, `agenda_summary`
- `proposal_version`, `approved_snapshot_fingerprint`, `created_by_user_id`, `approved_at`, `created_at`, `updated_at`
- `unique (workspace_id, id)` plus composite foreign keys to the workspace-owned action, approval, calendar, contact, and opportunity

RLS intent: members may prepare only if policy permits; owner/admin decide approval; no direct client transition to provider-claimed/created/failed/outcome-unknown states; identity fields and approved snapshots are immutable after approval.

### `meeting_attendees`

Purpose: minimum attendee addressing for a proposal.

Proposed columns/keys:

- `id`, `workspace_id`, `meeting_proposal_id`, optional `contact_id`, `email`, `display_name`, `role`, `response_status`
- `created_at`, `updated_at`; `unique (workspace_id, id)`

RLS intent: derive from the workspace proposal only, deny cross-tenant attendee insertion, and limit visibility to the minimum necessary business users. Do not import unrelated provider attendee lists.

### Provider attempt records

Preferred starting point: reuse `rev_action_executions` and `provider_usage_events` from Phase 4C for authorization, idempotency, claim, audit, and terminal outcome control. A later review may add `meeting_provider_attempts` only if it is needed for meeting-specific provider event reference, reconciliation cursor, or outcome metadata not safely represented on the existing execution record.

Any proposal-specific attempt table would include `id`, `workspace_id`, `meeting_proposal_id`, `execution_id`, `provider_key`, `provider_event_reference`, `request_fingerprint`, `idempotency_key`, `status`, `failure_code`, `created_at`, `completed_at`, and composite workspace foreign keys. It must not duplicate or weaken Phase 4C authority.

### `meeting_outcomes`

Purpose: a later explicit record of meeting result, not a provider event echo.

Proposed columns/keys:

- `id`, `workspace_id`, `meeting_proposal_id`, `outcome_type`, `summary`, `occurred_at`, `recorded_by_user_id`, `created_at`, `updated_at`
- `unique (workspace_id, id)` and composite workspace foreign key to the proposal

RLS intent: workspace-scoped reads; owner/admin or separately authorized recorded-outcome workflow writes; no automatic opportunity/revenue mutation without explicit, evidence-backed later rules.

---

## 9. Data Minimization, Retention, Consent, and Revocation

- Persist only the minimum free/busy intervals, selected calendar reference, approved meeting snapshot, required attendee addressing, provider event reference, and outcome evidence needed for the feature.
- Do not persist unrelated event content, private notes, attachments, attendee rosters, or provider payloads.
- Store provider tokens only as trusted server secrets/references. Define encryption, rotation, revocation, expiration, and reconnection behavior before OAuth implementation.
- Disconnection/offboarding must disable the connection and selected calendar immediately, block future availability/event operations, revoke or delete provider tokens where supported, and preserve only the minimum audit evidence required by policy.
- Provider event references are opaque identifiers. Cleanup/deletion/revocation policy must be explicit; a connection removal must never silently delete a customer event or erase required audit evidence.
- Attendee privacy requires clear lawful basis/consent review, least-privilege display, and no cross-workspace sharing.

---

## 10. Staged Delivery

| Stage | Scope | Explicit exclusion |
| --- | --- | --- |
| 5A | Provider-independent architecture, contracts, security, schema proposal, and acceptance review. | No provider, OAuth, schema, availability read, or event write. |
| 5B | Separately authorized read-only availability integration for one selected workspace calendar. | No meeting proposal or event creation. |
| 5C | Internal supervised meeting proposals and owner/admin approval. | No provider event creation. |
| 5D | Separately authorized controlled event creation through the Phase 4C durable boundary. | No autonomous creation, retry, or broad calendar access. |
| 5E | Reminders, RSVP/response ingestion, and explicit outcomes. | No fabricated attendance, revenue, or opportunity updates. |
| Later | Workforce scheduling, staff allocation, locations, travel, dispatch, and routes. | Must remain a separate product/domain decision. |

---

## 11. Decisions and Remaining Blockers

### Recommended defaults

- One explicitly selected workspace calendar.
- Provider-neutral contracts.
- Microsoft Graph as the first controlled pilot candidate.
- Required workspace timezone; `Europe/London` for FatherLegacy until explicitly changed.
- Free/busy only for the first availability integration.
- Owner/admin approval for all external event creation.
- `CREATE_CALENDAR_EVENT` disabled by default.

### Decisions/blockers before 5B or later

1. Choose Microsoft Graph application-only versus delegated OAuth after reviewing calendar ownership, consent, and least-privilege constraints.
2. Define the owner/admin calendar selection and connection/offboarding workflow.
3. Define working hours, buffers, blackout periods, minimum notice, duration rules, and ambiguous-availability behavior.
4. Approve data retention, attendee privacy, lawful-basis/consent, audit retention, and provider reference cleanup policies.
5. Review a detailed schema/RLS proposal and a provider-specific threat model before any migration or provider connection.
6. Define provider event reconciliation and `outcome_unknown` handling before event creation is authorized.

---

## 12. Acceptance Criteria for This Architecture Document

- Clearly defines provider-independent customer meeting scheduling and its excluded workforce/location/route domains.
- Preserves workspace isolation, active membership, role authority, approval binding, immutable approved snapshots, durable idempotency, audit, and fail-closed provider outcomes.
- Explicitly prohibits provider connection, calendar read, event creation, migration, RLS change, and provider permission change in Phase 5A.
- Distinguishes email mailbox routing and CRM next actions from calendar connection/event records.
- Documents a minimal-free/busy availability policy, selected-calendar rule, timezone default, and data minimization requirements.
- Labels all future schema as proposal only and defines a staged 5A through 5E delivery path.
- Leaves event creation disabled and requires a separately authorized review before any external calendar action.