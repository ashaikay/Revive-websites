# Supported paid pilot launch checklist — 10 November 2026

Scope: employment-programme records, Employment Specialist caseloads, vocational profiles, action plans, employer engagement and review of recorded programme jobs. External vacancy search, broader REV Brain work and autonomous employment decisions are excluded and paused.

This checklist is based on production branch `phase-5l-calendar-event-creation` at `dc4563a`, current code/tests and previously recorded production evidence. Existing login/tenant walkthroughs and the controlled Outlook test were not repeated. The Outlook test is outside this pilot scope and is not evidence for Programme Hub readiness.

## Verified

- **Workspace and caseload enforcement in code/tests:** `programme_hub_local_validation.mjs` asserts exact manager and assigned-ES participant sets, cross-workspace denial, unassigned-caseload denial and suspended-user denial. `programmeHubBoundary.test.ts` checks trusted payloads and definitive permission failures. This is automated evidence, not a new hosted walkthrough.
- **Staff access suspension:** `WorkspaceTeamPanel.tsx`, `workspaceTeamUI.test.tsx` and `20261016030000_rev_workspace_staff_invitations.sql` provide confirmed owner/admin suspension with audit evidence while preserving records. Protected owner/admin accounts cannot be suspended through this control.
- **Programme-level ES authority:** the trusted `adviser` update is manager-only and versioned. This increment adds confirmed removal/restoration in the Programme Hub without deleting adviser or caseload rows.
- **Save and recovery feedback:** Programme Hub tests cover Saving, Saved, definitive errors, unknown outcomes and exact-request retry. Forms retain entered values during uncertain outcomes.
- **Basic empty/access states:** Programme Hub shows no-record/filter states and explains when programme access has not been assigned. Existing production login/tenant-isolation walkthrough evidence remains recorded in `SECURITY_REGISTER.md`; it was not rerun.

## Missing — launch blockers

- **Service-user status control:** inactive records can be filtered and history is retained, but managers have no explicit archive/reactivate control. Authority and confirmation behavior must be implemented and tested before routine pilot offboarding.
- **Other pilot record lifecycle controls:** employer, contact and recorded-job tables have durable `active` fields but no consistent supported archive/reactivate UI.
- **Current hosted release verification:** confirm the hosted migration/Edge Function inventory for the exact production commit, then complete one controlled manager/ES pilot smoke covering intake, assignment, vocational profile, action plan, employer engagement and recorded-job review. Do not infer this from older walkthroughs.
- **Operational monitoring:** no Sentry/Datadog integration, uptime monitor, alert route or tested incident notification was found in the application or deployment configuration. Error and uptime monitoring must be selected, configured and tested before paid use.
- **Recovery readiness:** define the operator, backup cadence, restore procedure, recovery targets and one recorded restore exercise for pilot data. Existing exact-request recovery protects uncertain writes but is not disaster recovery.
- **Essential onboarding/support:** provide a short written manager/ES start guide, named support channel, support hours, severity route and account/access recovery procedure. Planned walkthrough materials are not yet evidence.
- **Pilot privacy and commercial terms:** approved pilot terms, privacy information, controller/processor responsibilities, lawful basis, retention/deletion schedule, subject-rights route, subprocessor position and end-of-pilot data handling are not evidenced. These are business/legal decisions; this checklist makes no compliance claim.

## Needs decision

- Who may archive/reactivate Service users: manager-only, or assigned ES with manager oversight.
- Retention periods for Service-user records, vocational answers, action-plan versions, case notes, contact details, audit evidence and exports.
- Pilot support owner, hours, response targets, escalation path and planned-maintenance notice.
- Monitoring provider, alert recipients, uptime target and incident communications.
- Whether a suspended organisation member may later be restored with prior programme/caseload access intact; the current UI clearly warns that restoration does this.

## Non-blocking cosmetic improvements

- Refine spacing, labels and compact summaries after the blocker flows are proven.
- Add optional guided tours or video walkthroughs after the written pilot guide exists.

## Future/out of scope

- External vacancy search, job/training provider connections and broader REV Brain development.
- Autonomous ranking, eligibility decisions, applications, referrals or employment decisions.
- Archive controls for non-pilot modules and unrelated marketing-site changes.
