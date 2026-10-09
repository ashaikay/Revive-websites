# Phase 5L — Controlled Calendar Event Creation Preflight

**Status:** Architecture and permission preflight only. Event creation remains disabled.

## Objective

Define the only acceptable future path from an approved `meeting_proposal` to one Microsoft Graph calendar event.

Phase 5L does not grant provider permissions, enable a capability, deploy code, create an event, send an invitation or alter production data.

## Non-negotiable safety state

- `CREATE_CALENDAR_EVENT` remains `false`.
- Availability reads and event writes remain separate capabilities.
- Approval records intent only.
- Email execution authority does not authorize calendar execution.
- No browser-supplied mailbox, calendar ID, provider token, approval state, fingerprint, idempotency key or provider event ID is trusted.
- No event update, cancellation, RSVP handling, recurrence, reminders, rescheduling or autonomous booking is authorized.

## Trusted lifecycle

1. An authenticated owner or admin requests execution for an existing workspace action.
2. The server loads the meeting proposal, REV action, approval and workspace membership.
3. The action must be `meeting_proposal`, `approved`, `not_executed` and require approval.
4. The action must remain at the exact approved action version.
5. The stored approval must bind the same workspace and action.
6. The approval fingerprint must match the current material action fingerprint.
7. The proposal must match the approved proposal version and immutable request fingerprint.
8. The server resolves the trusted provider connection, mailbox and calendar.
9. A durable execution attempt is acquired before token acquisition or provider mutation.
10. Only after every check passes may a future adapter request one event creation.

Material proposal changes require a new action version and fresh owner or admin approval.

## Durable idempotency

The future execution path must reuse the existing Phase 4C `rev_action_executions` control plane.

- Lock by workspace and approved action version.
- Use a workspace/action/version-scoped idempotency key.
- Bind the attempt to an immutable request fingerprint.
- A completed retry returns the stored result without another provider call.
- An in-progress or `outcome_unknown` attempt must not retry automatically.
- A timeout after Graph may have accepted the event becomes `outcome_unknown`.
- Reconciliation is mandatory before any uncertain attempt can be retried.

## Microsoft permission preflight

A future pilot would require:

- Microsoft Graph application permission `Calendars.ReadWrite`.
- Tenant administrator consent.
- Exchange Online role `Application Calendars.ReadWrite`.
- Assignment to the existing support-mailbox-only management scope.
- Verification that `support@fatherslegacy.net` is in scope.
- Verification that a separate normal mailbox is out of scope before production use.
- Confirmation that existing `Mail.Read`, `Mail.Send` and `Calendars.Read` assignments remain unchanged.

Graph consent alone is insufficient. Mailbox-scoped Exchange application RBAC is also mandatory.

## Safe outcome categories

- `created`
- `already_created`
- `denied`
- `provider_rejected`
- `outcome_unknown`
- `persistence_failed_after_provider`

No raw token, provider response, attendee details, notes or confidential internal identifiers may appear in browser errors or production logs.

## Kill switches

- Keep `CREATE_CALENDAR_EVENT=false`.
- Keep the server-only event-creation environment gate disabled.
- Remove the scoped Exchange role assignment or Graph consent if provider access must be revoked.
- Restore the previous Edge Function version without deleting audit or execution evidence.

## Authorization boundary

Phase 5L does **not** authorize `Calendars.ReadWrite`, provider mutation code, migrations, deployment, secrets, production enablement or a live calendar event.

Those require a separate reviewed implementation phase and explicit authorization.

## Local delegated-consent slice

The repository contains an additive customer-Outlook consent path for an owner or admin to explicitly request `Calendars.ReadWrite` on an already selected calendar. The verified scope is stored as private consent metadata; existing read-only credentials are not upgraded.

The local-only migration `20261009030000_rev_meeting_selected_outlook_binding.sql` binds a durable meeting reservation to the workspace's selected calendar, connection, credential revision, provider account/calendar references, timezone and consent version. Exact retries retain that target and refuse a changed selection; provider claims recheck the selected calendar and consent. The trusted Graph mapping now addresses that calendar rather than the mailbox default calendar.

This is not authorization to apply the migration to a hosted database, make live OAuth/provider calls, deploy, create events or change `CREATE_CALENDAR_EVENT=false`. The customer-delegated credential exchange for a future live event call remains a prerequisite; booking stays disabled until that execution path is separately reviewed and authorized.