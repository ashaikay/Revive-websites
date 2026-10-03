# REV Worker Scheduling and Allocation

Status: MVP priority authorised by Mike on 30 September 2026.
Worker records, working patterns and unavailable periods are implemented. Hosted save, edit, cancellation and refresh persistence have been verified. Jobs/shifts and assignment authority are next.

## Multi-day daytime sessions — local implementation complete

The existing `20261001000000_rev_daily_job_sessions.sql` migration is applied locally only. New jobs default to an explicit daily-working-hours batch: inclusive first/last dates, selected weekdays, local start/end, IANA timezone and staffing required per generated session. Each selected date creates a separate open job; no overnight interval is inferred. The range is limited to 31 calendar days.

An authenticated owner/admin Edge Function validates the exact request, resolves the caller from the session and invokes the existing service-role-only `create_rev_daily_job_sessions` RPC. Responses contain sanitized job metadata only. Unknown outcomes are not retried automatically: the canonical request remains in workspace/user-scoped session storage and only an explicit identical retry is offered. A confirmed save emits the existing `rev-scheduling-changed` event so the single central planner refreshes.

Existing job editing, cancellation and assignment remain on their existing paths. Saved intervals spanning local dates display an overnight warning and are never silently split or converted.

Validation completed on 1 October 2026:

- Scheduling endpoint/browser regressions: 61/61 passed.
- Local daily-session validator: `SCHEDULING_DAILY_SESSIONS_LOCAL=PASS`.
- Local assignment validator: `SCHEDULING_ASSIGNMENTS_LOCAL=PASS`.
- Production build: passed with the existing chunk-size advisory.
- Local migration check used `migration up --local`; no database reset and no new migration application occurred.
- No provider requests, notifications, automatic allocation, location/travel calculations or hosted deployment occurred.

Remaining limitations: overnight work is unsupported; DST gaps/folds reject the whole batch; each generated session is edited or cancelled individually after creation; worker allocation remains manual; notifications and travel/location feasibility remain deferred.

## Product workflow

Scheduling is a main-navigation module.
Setup: add workers, record their availability and skills, then create jobs/shifts.
Planning: view the weekly rota, identify unfilled work and assign suitable workers.
Changes: amend or cancel assignments with explicit conflict checks and audit evidence.

## Domain boundaries

Worker scheduling is separate from customer meeting proposals and calendar events.
A worker record does not grant application access or create a workspace membership.
An optional linked user must belong to the same workspace.
Google and Outlook integrations are not required for internal scheduling.
Assignment does not send a notification, create an external event or prove attendance.

## First-release records

- Worker: workspace, display name, active status, role labels, skill tags and optional linked workspace user.
- Working pattern: worker, timezone, weekdays, local opening/closing times and effective dates.
- Availability exception: worker, explicit UTC interval and unavailable category such as leave.
- Job/shift: workspace, title, UTC start/end, display timezone, location, required skills, staffing count and status.
- Assignment: workspace, worker, job/shift, reserved UTC interval and active/cancelled status.

Leave records contain only information needed for scheduling; medical details are excluded.
Skill tags are manager-recorded information, not proof of qualifications.
Workers and scheduling history are archived rather than deleted through normal UI flows.

## Permissions and isolation

Initial management and rota access are restricted to active owners/admins.
Member/viewer access and worker self-service are deferred until explicitly designed.
Reuse public.has_workspace_role for manager reads.
Browser clients cannot write scheduling tables directly.
Authenticated server boundaries verify the caller and workspace role.
Trusted RPCs recheck active authority within the mutation transaction.
Every relationship between scheduling records includes workspace identity.

## Assignment authority

Assignment requires an active worker and an open job/shift in the same workspace.
The complete interval must fit recorded working availability.
Missing availability blocks allocation.
Leave/unavailable exceptions block overlapping assignments.
Required skills must be present and staffing capacity must remain available.
Active assignments for the same worker cannot overlap, including across different jobs.
Intervals use [start,end): adjacent assignments are permitted.
Concurrent requests must enforce overlap and capacity protection in the database.
Repeated request IDs are idempotent; changed content under the same ID is rejected.
Stale record versions are rejected rather than silently overwritten.
Job edits, availability changes and worker deactivation must check affected assignments.
Conflicting changes require explicit reassignment or cancellation first.

## Time handling

Store assignment and job intervals as UTC instants; retain an IANA display timezone.
Evaluate working patterns in their recorded local timezone.
Reject nonexistent or ambiguous local times unless explicitly resolved.
No automatic inference of worker availability from customer calendar free/busy.
Workspace business hours may assist setup but are not implicit worker availability.

## Audit

Scheduling mutations write to the existing append-only public.audit_log.
Record verified actor, workspace, operation, resource identifiers and relevant versions.
Avoid sensitive leave descriptions and unnecessary personal data in audit metadata.
Audit writes and scheduling changes must commit atomically.

## Delivery order

1. Tenant-scoped worker records and owner/admin management.
2. Working patterns and unavailable periods.
3. Jobs/shifts and staffing requirements.
4. Atomic assignment, cancellation, capacity and overlap enforcement.
5. Weekly rota, unfilled work and conflict explanations.
6. Local security/concurrency checks, CI and controlled hosted verification.

## Verification requirements

Test owner/admin permissions, member/viewer denial, suspension and tenant isolation.
Test same-worker overlaps, adjacent intervals, leave, missing skills and full capacity.
Test concurrent allocation, repeated requests and stale updates.
Test daylight-saving transitions and persistence after refresh.
Existing customer-calendar and meeting workflows must remain intact.

## Deferred scope

Automatic allocation, worker self-service, outbound notifications, payroll, timesheets,
travel-time calculation, dispatch, route optimisation and external calendar sync.
These are not dependencies for the first supervised scheduling release.
## Optional location planning and visual planner

Authorised product requirements recorded on 30 September 2026.

Provide a simple weekly planner with workers as rows and days as columns.
Cards show job title, time, location and assignment status.
Use colours plus text labels for proposed work, assigned work, leave and conflicts.
Reflect saved changes throughout the week; show loading, stale and failed-refresh states.
Initial access remains restricted to active owners/admins.

Location-based recommendations are optional per business.
Record worker location plans separately from working availability.
Use scoped, verified job/customer locations and relevant Business Brain information.
Recommendations must respect skills, hours, leave, existing assignments and capacity.
Proximity alone does not establish feasibility; travel assumptions must be explicit.
Missing location or travel information must not be presented as confirmed feasibility.

Delivery progresses from manual allocation to recommendations and approved schedules.
Automatic allocation requires explicit business opt-in and defined operating rules.
Schedule changes must be visible and auditable; conflicts require manager attention.
Notifications require separately enabled sending, verified recipients and approval rules.
Worker self-service must not expose Business Brain, CRM or other restricted information.

These requirements follow reliable manual assignment enforcement.
Automatic allocation and notifications are not enabled by the current implementation.

## Annual leave policy foundation

Authorised on 2 October 2026. Stage 1 is limited to manager-recorded policy, frozen worker/leave-year accounts and audited allowance adjustments. It does not calculate absence deductions or a complete remaining balance.

Workspace defaults and full per-worker overrides are versioned, append-only policy revisions. Each revision records its first applicable leave-year label, allowance input unit/value, canonical integer minutes, explicit minutes per day, leave-year start month/day and whether bank holidays are included in or additional to the allowance. Configuration records contractual terms only; it is not a statutory-entitlement calculation or legal-validity decision.

Opening a worker/year account resolves the latest applicable full worker override, otherwise the latest applicable workspace default, and freezes that complete policy snapshot. Later policy changes do not rewrite an opened account. Allowance changes for an opened year use append-only signed-minute adjustments with a required reason and expected account version; they never erase the configured baseline or earlier adjustments. Every Stage 1 account is labelled `policy_only` because absence accounting and historical review are not yet implemented.

Worker leave-year account ranges cannot overlap, including when a later policy changes the leave-year start date; this is enforced transactionally without rewriting existing frozen snapshots. Known stale-version, duplicate-account, overlap and policy/date mismatch refusals may return request-bound refusal codes. All other failed or malformed outcomes remain `outcome_unknown` and must not be inferred from arbitrary database text.

Canonical accounting uses integer minutes. Examples:

- `28 days` with an explicit `7.5 hours per day` conversion freezes `12,600 minutes` (`210 hours`). The displayed day figure must always explain that conversion.
- `210 hours` freezes `12,600 minutes`; hours-per-day remains recorded for explanatory day equivalents but does not alter the entered hours.
- A `+450 minute` adjustment with a reason adds `7.5 hours`; a later `-225 minute` adjustment subtracts `3.75 hours`. Both entries and the original baseline remain auditable.
- No Stage 1 account may display or imply leave taken, future leave booked or remaining to book. Those values remain unavailable until classified absences, historical review and immutable deduction postings exist.

Existing `leave` and `unavailable` records are unchanged. No record is classified, deducted or backfilled by Stage 1. Generic unavailability must never become annual leave implicitly, and bank holidays must never be deducted without a later explicit policy-aware recorded absence.

### Leave presentation architecture

Keep Scheduling visually simple. The weekly planner remains the main view. A compact `Leave` button will later open a separate leave-management panel containing balances, record-leave controls and approval requests. Worker-level leave sections link to the same worker-specific records rather than creating a second leave system. The planner shows compact absence blocks; selecting one opens its details. Allowance settings, approval history and email status remain inside the leave panel.

This presentation architecture is recorded only. Stage 1 adds no leave UI, planner interaction, approval workflow, worker access or email delivery.

### Deferred approval and email requirements

Managers may directly record and confirm leave using their workspace-scoped authority. Future worker-submitted requests require explicit manager approval before becoming confirmed leave; submitting a request alone must not reserve leave or deduct allowance.

Future leave requests require explicit manager approval or rejection with workspace-scoped authority, current-version checks, durable request identity, identical retries and append-only audit evidence. Worker access requires a separate least-privilege design and must not expose manager-only Scheduling, CRM or Business Brain data. Approval must never be inferred from an email action or delivery result.

Committed confirmed or approved leave must update the worker's balance and weekly planner together and enforce assignment-conflict checks before saving. Conflicting assignments require explicit manager resolution; confirmation must not silently overwrite or bypass them. Cancellation must retain the original evidence, append reversal postings for the original deductions exactly once, and refresh the balance and planner from the committed cancellation.

Confirmation emails may be queued only after a successful committed leave save, never before or after a rolled-back save. Durable semantic idempotency must prevent duplicate confirmations across retries and concurrent requests for the same committed leave transition. Email failure must not undo the leave save, approval, deductions or planner state.

Any future email must be separately enabled, use a verified recipient, preserve approval and content snapshots, and record durable provider states without treating provider acceptance as delivery confirmation. Approval history and email status belong in the leave panel. Failed or unknown delivery must not change leave approval, allocation or accounting state automatically. Stage 1 sends no email and creates no approval/request records.